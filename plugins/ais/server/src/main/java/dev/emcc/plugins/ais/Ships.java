package dev.emcc.plugins.ais;

import dev.emcc.plugins.ais.codec.AisMessage;
import dev.emcc.plugins.ais.codec.AisStatic;
import dev.emcc.plugins.ais.transport.Link;
import dev.emcc.plugins.ais.transport.TransportMsg;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.store.ObjectWriter;
import dev.emcc.sdk.worker.WorkerRef;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
import org.jspecify.annotations.Nullable;

/**
 * The ships in the object store (brief sections 3 and 4): the worker's helper that turns decoded AIS
 * messages into writes through the SDK's {@link ObjectWriter} (SDK 1.4.0), which owns the target layer of
 * each link, finds the ships again by external identity, keeps at most one change request in flight per ship
 * and lets the latest write win. It is owned by the {@code links} worker and used only from its handler.
 *
 * <p>What stays here is AIS: the static data each link has heard of its ships (per link, in the worker), the
 * latest position of a ship that waits to be written, and what a ship looks like ({@link ShipMapper}). A ship
 * that two links receive belongs to the link that made it: the other link's messages update it. The plugin never
 * deletes ships: ECore expires and removes them (the data type's defaults).
 */
public final class Ships {

  private static final long EXPIRE_EVERY_TICKS = 60;

  /** Counts on the link's task (the monitor view); {@code ref.count} of the link's connection. */
  public interface Counter {
    void count(String name, long delta);
  }

  /** A position that has not been written yet, or may need writing again. */
  private record Pending(String link, AisMessage.Position position, Instant at) {}

  private static final class LinkState {
    Link link;
    final Counter counter;
    final StaticCache cache = new StaticCache();

    LinkState(Link link, Counter counter) {
      this.link = link;
      this.counter = counter;
    }
  }

  private final PluginContext context;
  private final Clock clock;
  private @Nullable ObjectWriter writer;
  private final Map<String, LinkState> links = new LinkedHashMap<>();
  /** The newest position of each ship that has one waiting; dropped when the stored ship shows it. */
  private final Map<Integer, Pending> pending = new HashMap<>();
  private long tick;

  public Ships(PluginContext context, Clock clock) {
    this.context = context;
    this.clock = clock;
  }

  /** Called with the first message the worker handles: creates the writer, which subscribes and starts its timer. */
  public void bind(WorkerRef<TransportMsg> worker) {
    if (writer == null) {
      writer = ObjectWriter.create(context, worker, ShipMapper.NAMESPACE, TransportMsg.Writer::new);
      writer.fieldSet(ShipMapper.FIELD_SET);
      writer.start();
    }
  }

  /** Passes one of the writer's replies back to it. */
  public void onWriter(ObjectWriter.Reply reply) {
    if (writer != null) {
      writer.handle(reply);
    }
  }

  public void stop() {
    if (writer != null) {
      writer.stop();
    }
  }

  // ---------------------------------------------------------------- links

  /** The links as the settings now have them: new ones are added, changed ones follow the new layer, label and identity, gone ones forgotten. */
  public void links(List<Link> wanted, Function<String, Counter> counters) {
    Set<String> names = new HashSet<>();
    wanted.forEach(l -> names.add(l.name()));
    links.keySet().removeIf(name -> !names.contains(name));
    var targets = new ArrayList<ObjectWriter.Target>();
    for (Link link : wanted) {
      LinkState state = links.get(link.name());
      if (state == null) {
        state = new LinkState(link, counters.apply(link.name()));
        links.put(link.name(), state);
      }
      state.link = link;
      targets.add(new ObjectWriter.Target(link.name(), link.target(), link.label(), toOldNames(state.counter)));
    }
    if (writer != null) {
      writer.targets(targets);
    }
  }

  /** The writer's counters under the names the plugin has always shown: ships created, updated, rejected. */
  private static ObjectWriter.Counter toOldNames(Counter counter) {
    return (name, delta) -> {
      switch (name) {
        case "objects created" -> counter.count("ships created", delta);
        case "objects updated" -> counter.count("ships updated", delta);
        default -> {
          counter.count(name, delta);
          if (name.startsWith("rejected: ")) {
            counter.count("ships rejected", delta);
          }
        }
      }
    };
  }

  /** What the link did so far, and the name of its layer once known. */
  public ObjectWriter.Stats stats(String link) {
    return writer == null ? new ObjectWriter.Stats(0, 0, 0, null) : writer.stats(link);
  }

  // ---------------------------------------------------------------- messages

  /** A position report (types 1, 2, 3, 18, 19). */
  public void position(String link, AisMessage.Position m) {
    LinkState state = links.get(link);
    if (state == null || writer == null) {
      return; // the link was removed from the settings
    }
    remember(state, m.mmsi(), m.statics());
    pending.put(m.mmsi(), new Pending(link, m, clock.instant()));
    write(link, m.mmsi());
  }

  /** Static data (types 5 and 24): kept for the ship, and written to it if it exists or a position waits. */
  public void statics(String link, AisMessage.StaticReport m) {
    LinkState state = links.get(link);
    if (state == null || writer == null) {
      return;
    }
    boolean added = remember(state, m.mmsi(), m.statics());
    if (writer.object(ShipMapper.mmsiText(m.mmsi())) == null && !pending.containsKey(m.mmsi())) {
      if (added) {
        state.counter.count("static data kept", 1); // waits for the ship's first position
      }
      return;
    }
    write(link, m.mmsi());
  }

  /** @return whether the ship is new to the link's cache */
  private boolean remember(LinkState state, int mmsi, AisStatic said) {
    StaticCache.Put put = state.cache.put(mmsi, said, clock.millis());
    if (put.forgotten() > 0) {
      state.counter.count("static data forgotten", put.forgotten());
    }
    return put.added();
  }

  private void write(String link, int mmsi) {
    ObjectWriter w = writer;
    if (w != null) {
      w.write(link, ShipMapper.mmsiText(mmsi), (stored, layerId) -> build(link, mmsi, stored, layerId));
    }
  }

  /** What to write for a ship now: from the stored ship, the waiting position and what the links have heard. */
  private @Nullable MapObjectContent build(String link, int mmsi, @Nullable MapObject stored, java.util.UUID layerId) {
    Pending p = pending.get(mmsi);
    if (p != null && stored != null && shows(stored.content(), p)) {
      pending.remove(mmsi); // the store already shows it
      p = null;
    }
    LinkState from = links.get(link);
    if (stored == null) {
      if (p == null || from == null) {
        return null;
      }
      AisStatic statics = staticsFor(from, mmsi).merge(p.position().statics());
      var placement = new ShipMapper.Placement(from.link.name(), layerId, labelOf(from), from.link.identity(), from.link.symbolType());
      return ShipMapper.position(placement, p.position(), statics, p.at(), null);
    }
    MapObjectContent content = stored.content();
    LinkState owner = links.get(content.dataSource()); // the link that made it keeps its identity and label
    StandardIdentity identity = owner != null ? owner.link.identity() : ShipMapper.identityOf(content.symbol());
    SymbolType symbolType = owner != null ? owner.link.symbolType()
        : content.symbol() != null && content.symbol().isVessel() ? SymbolType.VESSEL : SymbolType.APP6;
    SecurityLabel label = owner != null ? labelOf(owner) : content.label();
    LinkState source = p != null ? links.get(p.link()) : from;
    AisStatic statics = ShipMapper.staticsOf(content).merge(source == null ? AisStatic.EMPTY : staticsFor(source, mmsi));
    if (p != null) {
      var placement = new ShipMapper.Placement(content.dataSource(), content.layerId(), label, identity, symbolType);
      return ShipMapper.position(placement, p.position(), statics.merge(p.position().statics()), p.at(), content.style());
    }
    return ShipMapper.refresh(content, mmsi, statics, identity, symbolType);
  }

  /** Whether the stored ship has this position at this time (the same time alone is not enough: a test clock stands still). */
  private static boolean shows(MapObjectContent stored, Pending p) {
    var at = ((dev.emcc.sdk.model.Geometry.Point) stored.geometry()).coordinates();
    return stored.time() != null && p.at().equals(stored.time().observed())
        && at.longitude() == p.position().lon() && at.latitude() == p.position().lat();
  }

  private AisStatic staticsFor(LinkState link, int mmsi) {
    AisStatic known = link.cache.get(mmsi);
    return known == null ? AisStatic.EMPTY : known;
  }

  private SecurityLabel labelOf(LinkState link) {
    SecurityLabel label = link.link.label();
    return label != null ? label : context.defaultLabel();
  }

  // ---------------------------------------------------------------- time

  /** Once a second. */
  public void tick() {
    tick++;
    if (tick % EXPIRE_EVERY_TICKS == 0) {
      long now = clock.millis();
      for (LinkState link : links.values()) {
        int n = link.cache.expire(now);
        if (n > 0) {
          link.counter.count("static data forgotten", n);
        }
      }
    }
  }
}
