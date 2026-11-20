package dev.emcc.plugins.cot;

import dev.emcc.plugins.cot.codec.CotEvent;
import dev.emcc.plugins.cot.codec.CotMapper;
import dev.emcc.plugins.cot.codec.CotXml;
import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.ClassificationLimit;
import dev.emcc.sdk.LayerChoice;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.channel.ChannelCapability;
import dev.emcc.sdk.channel.ChannelItem;
import dev.emcc.sdk.channel.ChannelSpec;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.model.ChangeEvent;
import dev.emcc.sdk.model.EntityType;
import dev.emcc.sdk.model.ExternalRef;
import dev.emcc.sdk.model.FieldRef;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Operation;
import dev.emcc.sdk.model.TimeAttributes;
import dev.emcc.sdk.store.ObjectQuery;
import dev.emcc.sdk.store.StoreUpdate;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * The output of the {@code out} and {@code both} links (brief functions 14, 17 to 21), run by the
 * {@code applier} worker: it subscribes to the objects of the links' source layers, turns each
 * create and update into a CoT event and posts it to the link's connection task, and sends an event
 * that is stale at once for an object that leaves what the link sends.
 *
 * <ul>
 *   <li><b>One subscription per source layer</b>, however many links use it, in View's workspace
 *       only (ACA note N9: a query without a workspace means every workspace).
 *   <li><b>When a link comes up</b> it sends the current objects of its layers, paced; a new snapshot
 *       after a gap is compared with what was held, and what is missing is sent as stale.
 *   <li><b>An object is never sent back</b> to the link it came from (its data source, or its last change).
 *   <li><b>Only real changes go out:</b> an object is sent again only when its event differs from the
 *       last one in anything but its times and TAK's flow tags, except for the refresh (brief
 *       function 18) and for an event that is stale at once.
 *   <li><b>Skips are counted</b> per reason: not a symbol, no CoT type, above the highest
 *       classification, unknown limit, expired, backlog.
 * </ul>
 */
final class OutputEngine {

  /** What the engine needs from the worker that owns it. */
  interface Host {
    WorkerRef<ApplierMsg> self();

    long tick();

    /** Logs a warning at most once a minute per link; says whether it was logged. */
    boolean warn(LinkRuntime link, String message, Object... args);

    Iterable<LinkRuntime> links();

    /** The status has changed. */
    void changed();
  }

  /** Objects posted to a link's task per tick when it comes up or refreshes, so that a large layer does not flood the inbox. */
  private static final int PER_TICK = 5_000;
  /**
   * Events posted to a link's task per tick without pacing. The inbox holds 20 000 and drops the oldest when it is full,
   * so a burst beyond this waits in the paced queue instead of being lost.
   */
  private static final int WINDOW = 10_000;
  private static final String VIEW = "core.view";

  /** The objects of one source layer, and the subscription that keeps them. */
  private static final class Feed {
    final UUID layer;
    final long generation;
    @Nullable Cancellable subscription;
    final Map<UUID, MapObject> objects = new HashMap<>();

    Feed(UUID layer, long generation) {
      this.layer = layer;
      this.generation = generation;
    }
  }

  private final PluginContext context;
  private final Clock clock;
  private final Host host;
  private final Map<UUID, Feed> feeds = new HashMap<>();
  private long generations;

  private final LinkOutput.Caps caps;
  /** The uids emc2 made up for what any link sent: the echo of one is not an object (see {@link SentUids}). */
  private final SentUids sentUids;

  OutputEngine(PluginContext context, Clock clock, LinkOutput.Caps caps, Host host) {
    this.context = context;
    this.clock = clock;
    this.caps = caps;
    this.host = host;
    this.sentUids = new SentUids(caps.items());
  }

  /**
   * Whether {@code uid} is one that an output link of this plugin sent for an object of {@code layer}, with a uid made up here: an event
   * for it that would land in the same layer is the echo of what was sent.
   */
  boolean wasSentFrom(String uid, UUID layer) {
    return sentUids.sentFrom(uid, layer, clock.instant());
  }

  /**
   * Remembers the uid of an event sent for an object of a source layer, if emc2 made it up (the id of an object not made from CoT).
   * Channel items are not remembered: a sender such as the simulator expects its tracks back through another link.
   */
  private void sentUid(String uid, UUID id, UUID layer, Instant stale, Instant now) {
    if (uid.equals(id.toString())) {
      sentUids.remember(uid, layer, stale, now);
    }
  }

  // ---------------------------------------------------------------- what to send: the links and their layers

  /** Brings the subscriptions and the links' output state in line with the settings and the running tasks. */
  void sync() {
    syncChannels();
    Set<UUID> wanted = new HashSet<>();
    var changed = new ArrayList<LinkRuntime>();
    for (LinkRuntime link : host.links()) {
      boolean sends = link.config.enabled() && link.config.problem() == null && link.config.direction().sends() && link.task != null;
      if (!sends) {
        link.output = null;
        continue;
      }
      LinkOutput out = link.output;
      if (out == null) {
        out = new LinkOutput(caps);
        link.output = out;
      }
      Set<UUID> layers = new HashSet<>();
      for (LayerChoice choice : link.config.sourceLayers()) {
        if (choice.id() != null) {
          layers.add(choice.id());
        }
      }
      // What was sent from a layer the link no longer sends from stops: stale at once.
      for (UUID id : new ArrayList<>(out.sent.keySet())) {
        if (!layers.contains(out.sent.get(id).layer())) {
          leave(link, out, id);
        }
      }
      out.layers.clear();
      out.layers.addAll(layers);
      wanted.addAll(layers);
      String key = layers + "|" + link.config.limit();
      if (!key.equals(out.key)) {
        out.key = key;
        changed.add(link);
      }
    }
    for (UUID layer : new ArrayList<>(feeds.keySet())) {
      if (!wanted.contains(layer)) {
        Feed gone = feeds.remove(layer);
        if (gone.subscription != null) {
          gone.subscription.cancel();
        }
      }
    }
    for (UUID layer : wanted) {
      if (!feeds.containsKey(layer)) {
        var feed = new Feed(layer, ++generations);
        feeds.put(layer, feed);
        feed.subscription = context.store().subscribe(ObjectQuery.all().inLayer(layer).inWorkspaces(VIEW), host.self(),
            update -> new ApplierMsg.SourceUpdate(layer, feed.generation, update));
      }
    }
    for (LinkRuntime link : changed) { // only a link whose layers or limit changed is looked at again
      if (link.output != null && link.output.up) {
        reevaluate(link, link.output);
      }
    }
  }

  // ---------------------------------------------------------------- the channels (brief function 15)

  /**
   * Offers each enabled {@code out} or {@code both} link as an output channel, and withdraws the channel of a link that is
   * disabled, has a problem or no longer sends. A channel stays through a reconnect and a change of the link's host or port;
   * a renamed link is a removed one and a new one, so its old id goes and the new one is offered.
   */
  private void syncChannels() {
    for (LinkRuntime link : host.links()) {
      boolean offers = link.config.enabled() && link.config.problem() == null && link.config.direction().sends();
      if (offers && link.channel == null) {
        String name = link.config.name();
        try {
          link.channel = context.channels().offer(
              ChannelSpec.of(name, name, "cot").can(ChannelCapability.DELETE).fields(List.of(
                  new FieldRef(CotMapper.NAMESPACE, "team"), new FieldRef(CotMapper.NAMESPACE, "role"), new FieldRef(CotMapper.NAMESPACE, "staleSeconds"))).fieldSet(CotMapper.FIELD_SET),
              host.self(), item -> new ApplierMsg.FromChannel(name, item));
        } catch (IllegalArgumentException | IllegalStateException e) {
          host.warn(link, "link {}: its output channel cannot be offered: {}", name, Text.clean(String.valueOf(e.getMessage())));
        }
      } else if (!offers) {
        forget(link);
      }
    }
  }

  /** The link goes (or no longer sends): its channel is withdrawn, so that a sender sees it as missing. */
  void forget(LinkRuntime link) {
    if (link.channel != null) {
      link.channel.withdraw();
      link.channel = null;
    }
  }

  /**
   * A sender's item for a link's channel. <b>It goes out as it comes</b>, also when its content is unchanged (a sender's next
   * item is its refresh), with the same rules as an object of a source layer for the type, the classification, the expiry and
   * the stale time; no comparison with what was sent before. A removal goes out as an event that is stale at once, made from
   * the identity kept when the item was sent. Items that arrive while the link has no connection wait in the task's inbox,
   * which keeps only the latest per object, and go out when it is up again.
   */
  void onChannelItem(ApplierMsg.FromChannel message) {
    LinkRuntime link = null;
    for (LinkRuntime candidate : host.links()) {
      if (candidate.config.name().equals(message.link())) {
        link = candidate;
      }
    }
    LinkOutput out = link == null ? null : link.output;
    if (link == null || out == null || link.task == null) {
      return; // the link went, or has no task: nothing to send to
    }
    switch (message.item()) {
      case ChannelItem.Update update -> sendItem(link, out, update);
      case ChannelItem.Removal removal -> {
        retract(link, out, removal.id());
      }
      case ChannelItem.SensorReport report -> {
        // cot's channels take ground truth only (ChannelSpec's default) and ECore refuses other kinds, so no SensorReport arrives: send nothing
      }
    }
    host.changed();
  }

  private void sendItem(LinkRuntime link, LinkOutput out, ChannelItem.Update update) {
    MapObjectContent content = update.content();
    if (content.dataSource().equals(link.config.name())) {
      return; // never back to the link it came from
    }
    ClassificationLimit limit = ClassificationLimit.from(link.config.limit(), context.defaultLabel());
    if (!context.classifications().knows(limit)) {
      skip(link, out, "unknown limit");
      retract(link, out, update.id());
      return;
    }
    if (!context.classifications().within(content.label(), limit)) {
      // a track sent before and raised above the limit: TAK is told it is gone, as for an object of a source layer
      skip(link, out, "above the highest classification");
      retract(link, out, update.id());
      return;
    }
    Instant now = clock.instant();
    TimeAttributes time = content.time();
    if (expired(time, now)) {
      skip(link, out, "expired");
      return;
    }
    CotMapper.Encoded encoded = CotMapper.encode(update.id().toString(), content, now, staleOf(content, time, now, link));
    if (encoded.skip() != null) {
      skip(link, out, encoded.skip().text());
      return;
    }
    CotEvent event = encoded.event();
    boolean firstWhileDown = !out.up && !out.items.containsKey(update.id());
    if (!postItem(link, out, update.id(), CotXml.write(event), time == null ? null : time.expires())) {
      return;
    }
    if (out.items.size() >= out.caps.items() && !out.items.containsKey(update.id())) {
      forgetStaleItems(out, now); // room first from what TAK has dropped already
    }
    if (out.items.size() < out.caps.items() || out.items.containsKey(update.id())) {
      out.items.put(update.id(), new LinkOutput.Identity(event.uid(), event.type(), event.lat(), event.lon(), event.hae(), event.stale()));
      if (firstWhileDown) {
        out.neverSent.add(update.id());
      }
    } else {
      skip(link, out, "removal not kept"); // sent, but a removal of it cannot be sent; counted, and warned about once a minute
    }
  }

  /**
   * Posts the event of a channel item to the link's task. While the link is down it waits there, one per object, and no more than
   * {@link LinkOutput.Caps#waiting()} objects wait: past that the item is not posted and counted as "dropped". False if it was not posted.
   */
  private boolean postItem(LinkRuntime link, LinkOutput out, UUID id, String xml, @Nullable Instant expires) {
    if (link.task == null) {
      return false;
    }
    if (!out.up && !out.waiting.contains(id) && out.waiting.size() >= out.caps.waiting()) {
      skip(link, out, "dropped");
      return false;
    }
    out.window++;
    SendResult result = link.task.post(new LinkInbox.Send(id, xml, expires));
    if (result != SendResult.ACCEPTED) {
      skip(link, out, result == SendResult.DROPPED ? "dropped" : "backlog");
      return false;
    }
    if (!out.up) {
      out.waiting.add(id);
    }
    return true;
  }

  /** Forgets the identities whose stale time has passed: TAK has dropped those tracks, and a sender that stopped sends no removal. */
  private static void forgetStaleItems(LinkOutput out, Instant now) {
    out.items.values().removeIf(identity -> !identity.staleAt().isAfter(now));
    if (!out.neverSent.isEmpty()) {
      out.neverSent.removeIf(id -> !out.items.containsKey(id));
    }
  }

  /** What was sent for a channel item goes stale at once, and its identity is forgotten. Nothing is sent for one never sent. */
  private void retract(LinkRuntime link, LinkOutput out, UUID id) {
    LinkOutput.Identity known = out.items.remove(id);
    boolean neverReached = out.neverSent.remove(id);
    if (known == null || neverReached) {
      // nothing was remembered, or TAK never had the item (its first event still waits for the connection): nothing goes out,
      // and a waiting update is replaced by nothing
      if (link.task != null && out.waiting.contains(id)) {
        link.task.post(LinkInbox.Send.nothing(id));
      }
      return;
    }
    if (known.staleAt().isAfter(clock.instant())) { // after its stale time TAK has dropped it: nothing to remove
      postItem(link, out, id, staleXml(known.uid(), known.type(), known.lat(), known.lon(), known.hae()), null);
    }
  }

  /** Stops all subscriptions (the plugin stops). */
  void stop() {
    feeds.values().forEach(f -> {
      if (f.subscription != null) {
        f.subscription.cancel();
      }
    });
    feeds.clear();
  }

  /** The link's connection is up: everything of its layers goes out again, paced. */
  void connected(LinkRuntime link) {
    LinkOutput out = link.output;
    if (out == null) {
      return;
    }
    out.up = true;
    out.waiting.clear(); // what waited in the task's inbox is written now
    out.neverSent.clear();
    out.sent.clear();
    out.initial.clear();
    for (UUID layer : out.layers) {
      Feed feed = feeds.get(layer);
      if (feed != null) {
        out.initial.addAll(feed.objects.keySet());
      }
    }
    drain(link, out, PER_TICK);
  }

  /** Sends up to {@code budget} of the objects that wait for the link's first send; returns what is left of the budget. */
  private int drain(LinkRuntime link, LinkOutput out, int budget) {
    while (budget > 0 && !out.initial.isEmpty()) {
      MapObject object = objectOf(out, out.initial.poll());
      if (object != null) {
        consider(link, out, object, false, true);
        budget--;
      }
    }
    return budget;
  }

  /** The link's connection is gone: nothing is posted until it is up again. */
  void disconnected(LinkRuntime link) {
    LinkOutput out = link.output;
    if (out != null) {
      out.up = false;
      out.initial.clear();
    }
  }

  // ---------------------------------------------------------------- the store

  void onSourceUpdate(ApplierMsg.SourceUpdate message) {
    Feed feed = feeds.get(message.layer());
    if (feed == null || feed.generation != message.generation()) {
      return; // a subscription that was cancelled
    }
    switch (message.update()) {
      case StoreUpdate.Snapshot snapshot -> {
        Map<UUID, MapObject> before = new HashMap<>(feed.objects);
        feed.objects.clear();
        for (MapObject object : snapshot.objects()) {
          if (object.content().layerId().equals(feed.layer)) {
            feed.objects.put(object.id(), object);
          }
        }
        for (LinkRuntime link : usersOf(feed)) {
          LinkOutput out = link.output;
          for (UUID id : before.keySet()) {
            if (!feed.objects.containsKey(id)) {
              leaveFrom(link, out, id, feed);
            }
          }
          for (MapObject object : feed.objects.values()) {
            MapObject old = before.get(object.id());
            if (old == null || old.version() != object.version()) {
              consider(link, out, object, false, false);
            }
          }
        }
      }
      case StoreUpdate.Changes changes -> {
        for (ChangeEvent event : changes.events()) {
          if (event.entityType() != EntityType.OBJECT) {
            continue;
          }
          if (event.operation() == Operation.DELETE) {
            if (feed.objects.remove(event.entityId()) != null) {
              leaveAll(feed, event.entityId());
            }
          } else if (event.state() instanceof MapObject object) {
            if (object.content().layerId().equals(feed.layer)) {
              feed.objects.put(object.id(), object);
              for (LinkRuntime link : usersOf(feed)) {
                consider(link, link.output, object, false, false);
              }
            } else if (feed.objects.remove(object.id()) != null) {
              leaveAll(feed, object.id()); // moved to another layer
            }
          }
        }
      }
    }
    host.changed();
  }

  /** Time passes (once a second): objects still to send after the link came up, and the refresh of what has not changed. */
  void tick(LinkRuntime link) {
    LinkOutput out = link.output;
    if (out == null) {
      return;
    }
    out.tick(host.tick());
    forgetStaleItems(out, clock.instant());
    if (!out.up) {
      return;
    }
    int budget = drain(link, out, PER_TICK);
    int refresh = link.config.refreshSeconds();
    if (refresh <= 0 || budget <= 0) {
      return;
    }
    var due = new ArrayList<UUID>();
    for (Map.Entry<UUID, LinkOutput.Sent> entry : out.sent.entrySet()) {
      if (due.size() < budget && host.tick() - entry.getValue().tick() >= refresh) {
        due.add(entry.getKey());
      }
    }
    Instant now = clock.instant();
    for (UUID id : due) {
      MapObject object = objectOf(out, id);
      if (object == null || expired(object.content().time(), now)) {
        out.sent.remove(id); // gone, or expired: an object whose expiry has passed is not sent again
      } else {
        consider(link, out, object, true, true);
      }
    }
  }

  // ---------------------------------------------------------------- one object, one link

  /** Sends the object if it passes everything, and has changed (or {@code force}: the refresh). */
  private void consider(LinkRuntime link, LinkOutput out, MapObject object, boolean force, boolean paced) {
    if (!out.up) {
      return;
    }
    UUID id = object.id();
    if (isEcho(link, object)) {
      out.sent.remove(id); // never sent back, and not due again at every tick
      return;
    }
    MapObjectContent content = object.content();
    ClassificationLimit limit = ClassificationLimit.from(link.config.limit(), context.defaultLabel());
    if (!context.classifications().knows(limit)) {
      rejected(link, out, id, "unknown limit", true);
      return;
    }
    if (!context.classifications().within(content.label(), limit)) {
      rejected(link, out, id, "above the highest classification", true);
      return;
    }
    Instant now = clock.instant();
    TimeAttributes time = content.time();
    if (expired(time, now)) {
      rejected(link, out, id, "expired", false);
      return;
    }
    CotMapper.Encoded encoded = CotMapper.encode(uidOf(object), content, now, staleOf(content, time, now, link));
    if (encoded.skip() != null) {
      rejected(link, out, id, encoded.skip().text(), false);
      return;
    }
    CotEvent event = encoded.event();
    String digest = digest(CotXml.signature(event));
    LinkOutput.Sent previous = out.sent.get(id);
    if (!force && previous != null && previous.digest().equals(digest)) {
      if (!previous.layer().equals(content.layerId())) {
        // moved from one source layer to another: nothing to send, but it is the other layer's now
        out.sent.put(id, new LinkOutput.Sent(digest, previous.tick(), content.layerId(), previous.uid(), previous.type(), previous.lat(), previous.lon(), previous.hae()));
      }
      return; // only real changes go out
    }
    if (!paced && out.window >= WINDOW) {
      out.initial.add(id); // a burst: the rest goes out paced, at the next ticks
      return;
    }
    if (post(link, out, id, CotXml.write(event))) {
      out.sent.put(id, new LinkOutput.Sent(digest, host.tick(), content.layerId(), event.uid(), event.type(), event.lat(), event.lon(), event.hae()));
      sentUid(event.uid(), id, content.layerId(), event.stale(), now);
    }
  }

  /** Counts a skip, and if what was sent before no longer may be (a classification), sends it as stale at once. */
  private void rejected(LinkRuntime link, LinkOutput out, UUID id, String reason, boolean leaves) {
    skip(link, out, reason);
    if (leaves) {
      leave(link, out, id);
    } else {
      out.sent.remove(id);
    }
  }

  /** The object leaves what the link sends: one event that is stale at once, made from what was sent before. */
  private void leave(LinkRuntime link, LinkOutput out, UUID id) {
    LinkOutput.Sent sent = out.sent.remove(id);
    if (sent == null || !out.up) {
      return;
    }
    if (post(link, out, id, staleXml(sent.uid(), sent.type(), sent.lat(), sent.lon(), sent.hae()))) {
      Instant now = clock.instant();
      sentUid(sent.uid(), id, sent.layer(), now, now);
    }
  }

  /** One event that is stale at once for what was sent: its uid, type and position, and nothing else. */
  private String staleXml(String uid, String type, double lat, double lon, @Nullable Double hae) {
    Instant now = clock.instant();
    var event = new CotEvent(uid, type, "h-e", "2.0", now, now, now, null, null, null, null, null, lat, lon, hae,
        null, null, null, null, null, null, null, null);
    return CotXml.write(event);
  }

  private void leaveAll(Feed feed, UUID id) {
    for (LinkRuntime link : usersOf(feed)) {
      leaveFrom(link, link.output, id, feed);
    }
  }

  /**
   * The object is no longer in this feed's layer. It leaves what the link sends only if it was sent from this layer: one
   * that moved to another source layer of the same link is that layer's now, and the two subscriptions have no order.
   */
  private void leaveFrom(LinkRuntime link, LinkOutput out, UUID id, Feed feed) {
    LinkOutput.Sent sent = out.sent.get(id);
    if (sent != null && sent.layer().equals(feed.layer)) {
      leave(link, out, id);
    }
  }

  /** After a change of the link's settings: what it sends is looked at again, and what no longer passes is sent as stale. */
  private void reevaluate(LinkRuntime link, LinkOutput out) {
    for (UUID layer : out.layers) {
      Feed feed = feeds.get(layer);
      if (feed != null) {
        for (MapObject object : new ArrayList<>(feed.objects.values())) {
          consider(link, out, object, false, false);
        }
      }
    }
  }

  /** Posts one event to the link's task; false (and a skip "backlog") if the task is gone. Not recorded as sent then. */
  private boolean post(LinkRuntime link, LinkOutput out, UUID id, String xml) {
    if (link.task == null) {
      return false;
    }
    out.window++;
    SendResult result = link.task.post(new LinkInbox.Send(id, xml));
    if (result != SendResult.ACCEPTED) {
      skip(link, out, "backlog");
      return false;
    }
    return true;
  }

  private void skip(LinkRuntime link, LinkOutput out, String reason) {
    out.skip(reason);
    if (link.task != null) {
      link.task.count("skipped: " + reason, 1);
    }
    host.warn(link, "link {}: skipped an object: {}", link.config.name(), reason);
    host.changed();
  }

  // ---------------------------------------------------------------- helpers

  private List<LinkRuntime> usersOf(Feed feed) {
    var users = new ArrayList<LinkRuntime>();
    for (LinkRuntime link : host.links()) {
      if (link.output != null && link.output.layers.contains(feed.layer)) {
        users.add(link);
      }
    }
    return users;
  }

  private @Nullable MapObject objectOf(LinkOutput out, UUID id) {
    for (UUID layer : out.layers) {
      Feed feed = feeds.get(layer);
      MapObject object = feed == null ? null : feed.objects.get(id);
      if (object != null) {
        return object;
      }
    }
    return null;
  }

  /** An object is not sent back to the link it came from: not when that is its data source, nor when its last change came in on it. */
  private static boolean isEcho(LinkRuntime link, MapObject object) {
    String name = link.config.name();
    return object.content().dataSource().equals(name) || name.equals(object.meta().modified().by().system());
  }

  /** The uid of the event: the external identity for an object that came from CoT, the object's id for the others. */
  private static String uidOf(MapObject object) {
    ExternalRef ref = object.meta().externalRef();
    return ref != null && ref.system().equals(CotMapper.NAMESPACE) ? ref.id() : object.id().toString();
  }

  private static boolean expired(@Nullable TimeAttributes time, Instant now) {
    return time != null && time.expires() != null && !time.expires().isAfter(now);
  }

  /**
   * {@code @stale}, the first that applies: the object's expiry if it is in the future; else now plus the object's
   * {@code staleSeconds}; else now plus the link's.
   */
  private static Instant staleOf(MapObjectContent content, @Nullable TimeAttributes time, Instant now, LinkRuntime link) {
    if (time != null && time.expires() != null && time.expires().isAfter(now)) {
      return time.expires();
    }
    JsonObject ext = content.extensions().get(CotMapper.NAMESPACE);
    if (ext != null && ext.get("staleSeconds") instanceof JsonNumber n) {
      try {
        long seconds = n.bigDecimalValue().longValueExact();
        if (seconds >= 1 && seconds <= 86_400) {
          return now.plusSeconds(seconds);
        }
      } catch (ArithmeticException e) {
        // not a whole number: the link's time
      }
    }
    return now.plusSeconds(link.config.staleSeconds());
  }

  /** A short digest of an event's text: what the worker keeps instead of the text. */
  private static String digest(String text) {
    try {
      byte[] hash = MessageDigest.getInstance("SHA-256").digest(text.getBytes(StandardCharsets.UTF_8));
      var hex = new StringBuilder(32);
      for (int i = 0; i < 16; i++) {
        hex.append(String.format("%02x", hash[i]));
      }
      return hex.toString();
    } catch (NoSuchAlgorithmException e) {
      throw new IllegalStateException("SHA-256 is part of every Java platform", e);
    }
  }
}
