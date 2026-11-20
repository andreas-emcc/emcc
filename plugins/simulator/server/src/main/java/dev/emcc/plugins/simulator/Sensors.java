package dev.emcc.plugins.simulator;

import dev.emcc.sdk.channel.ChannelId;
import dev.emcc.sdk.channel.ChannelInfo;
import dev.emcc.sdk.channel.ChannelItem;
import dev.emcc.sdk.channel.ChannelKind;
import dev.emcc.sdk.channel.ChannelList;
import dev.emcc.sdk.channel.Channels;
import dev.emcc.sdk.channel.SensorType;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Modifiers;
import dev.emcc.sdk.model.ObjectProperties;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.Relation;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.SplittableRandom;
import java.util.TreeMap;
import java.util.UUID;
import java.util.function.Function;
import org.jspecify.annotations.Nullable;

/**
 * The simulation's sensors (brief functions 27 to 30 and 36 to 39; CR-0033 to CR-0035, CR-0039 point
 * 7, CR-0040): ground radars, which send each revisit as its dwells, and generic sensors, which send
 * one report per revisit. Owned by the engine
 * worker, which gives it the picture at each tick; it never writes to the store itself, but says
 * which platforms need their relations written.
 *
 * <p>Each sensor is keyed by its platform track's id, which is also its id in sensor reports. Its
 * random numbers come from a generator seeded from that id, so a test with fixed ids sees the same
 * detections (A94).
 */
final class Sensors {

  static final String PAIRING = "gmti.pairing";
  /** CR-0035: the simulator's own kind, for detected tracks a chosen output leaves out (function 30). */
  static final String BEYOND = "simulator.beyond-reach";

  /** One sensor. Mutable; owned by the engine worker. */
  static final class Sensor {
    final UUID platform;
    SensorSettings settings;
    final Outputs outputs;
    final SplittableRandom random;
    /** When its next revisit starts; null while the simulation does not run. */
    @Nullable Instant next;
    /** A ground radar's revisit whose dwells are not all sent yet (function 37). */
    @Nullable Revisit revisit;
    /** A Systematic ground radar's pass under way (function 50); null in Random and while it does not look. */
    @Nullable Scan scan;
    /** Function 50: the targets a Systematic scan found, revisited by dwells of their own, by track. */
    final Map<UUID, Found> found = new LinkedHashMap<>();
    /** The revisits begun, which number them (CR-0040). */
    long revisits;
    /** The last revisit's detections, and its area's near edge. */
    List<Detector.Seen> last = List.of();
    double nearEdge;
    /** What its platform's relations should be, by kind; null before its first revisit. */
    @Nullable Map<String, List<UUID>> desired;
    /** CR-0035: the chosen outputs that leave out some of the last revisit's tracks, by name. */
    List<String> outOfRange = List.of();
    long looks;
    long overCap;
    /** Function 43: the drawn dwells, by dwell index; at most one revisit's. */
    final TreeMap<Integer, Drawn> drawn = new TreeMap<>();
    /** The sequence number at which {@link #drawn} last changed. */
    long drawnChanged;

    Sensor(UUID platform, SensorSettings settings, ChannelList list) {
      this.platform = platform;
      this.settings = settings;
      this.outputs = new Outputs(ChannelKind.SENSOR_REPORTS, settings.type());
      this.random = new SplittableRandom(platform.getMostSignificantBits() ^ platform.getLeastSignificantBits());
      outputs.listed(list);
      outputs.choose(settings.outputs());
    }
  }

  /**
   * A ground radar's revisit (function 37): its dwells, planned at its start, each sent at the tick
   * its time has come.
   *
   * @param targets the chosen targets, by the planned dwells' indexes
   * @param sent how many of its dwells were sent, in its one element
   * @param seen what its dwells sent so far, for the pairing and the warning at its last dwell
   */
  record Revisit(long number, Instant start, Duration interval, Dwells.Search area, List<Detector.Chosen> targets, List<Dwells.Planned> dwells,
      int[] sent, List<Detector.Seen> seen) {
    Instant time(int dwell) {
      return start.plusNanos(interval.toNanos() * dwell);
    }
  }

  /**
   * A Systematic ground radar's pass (function 50, T-197): its cells in the order scanned, the next
   * one to send, its dwells sent so far (scan and target dwells together) and what they found.
   *
   * <p>Its cells are extents from the search area's start; each is sent round where the platform is,
   * turned with its heading, when the cell's dwell is sent (M9, owner YW).
   */
  static final class Scan {
    final long number;
    final List<Dwells.Extent> cells;
    int cell;
    int sent;
    Instant slot;
    final List<Detector.Seen> seen = new ArrayList<>();

    Scan(long number, List<Dwells.Extent> cells, Instant slot) {
      this.number = number;
      this.cells = cells;
      this.slot = slot;
    }
  }

  /**
   * Function 50: a found target, where it was last measured, when its next own dwell is due, and how
   * many of its own dwells in a row found nothing (3 drop it).
   */
  record Found(Position measured, Instant due, int misses) {}

  /** Function 50: a found target is dropped after this many of its own dwells in a row find nothing (the owner's answer A). */
  static final int MISSES = 3;

  /** Function 43: a dwell as the web part draws it: its index, its revisit's number, its time and its area as sent. */
  record Drawn(int index, long revisit, Instant time, Geometry.ArcBand area) {}

  /** What one revisit sees of a track: from the engine's picture. */
  interface View {
    /** The content an object has at this tick, or null when it is gone. */
    @Nullable MapObjectContent content(UUID id);

    /** Whether a track is hidden by an event (function 13). */
    boolean hidden(UUID id);

    /** Every track of the simulation. */
    List<UUID> tracks();
  }

  private final Map<UUID, Sensor> all = new LinkedHashMap<>();
  /** Only for the list of channels the Sensors panel offers. */
  private final Outputs offer = new Outputs(ChannelKind.SENSOR_REPORTS);
  private ChannelList list = ChannelList.empty();
  /** Platforms whose relations should be written: after a revisit, or when what is beyond changed. */
  private final Set<UUID> relationsDue = new LinkedHashSet<>();
  /** Platforms of removed sensors: their relations of the sensor's kinds are cleared once. */
  private final Set<UUID> cleared = new LinkedHashSet<>();
  long reports;
  /**
   * Function 43: the drawn dwells' sequence number, raised at every change. It starts at the plugin's
   * start, in microseconds since the epoch, so that a number from before a restart is never taken for
   * a later one.
   */
  private long drawnSeq;
  /** The number from which a reader must take every set again: a sensor removed, or a reset. */
  private long drawnWhole;

  Map<UUID, Sensor> all() {
    return all;
  }

  @Nullable Sensor get(UUID platform) {
    return all.get(platform);
  }

  void put(UUID platform, SensorSettings settings) {
    Sensor s = all.get(platform);
    if (s == null) {
      all.put(platform, new Sensor(platform, settings, list));
      cleared.remove(platform);
    } else {
      s.settings = settings;
      s.revisit = null; // a revisit begun goes; the next follows at its time
      s.scan = null; // so does a pass (function 50), with what it found
      s.found.clear();
      if (!s.drawn.isEmpty()) {
        s.drawn.clear(); // its drawn dwells were of the old settings (function 43)
        s.drawnChanged = ++drawnSeq;
      }
      s.outputs.choose(settings.outputs());
      judge(s, true);
    }
  }

  void remove(UUID platform) {
    Sensor s = all.remove(platform);
    if (s != null) {
      cleared.add(platform);
      relationsDue.add(platform);
      drawnWhole = ++drawnSeq; // its dwells go, and its set (function 43)
    }
  }

  /** Function 43: the drawn dwells' numbers start at {@code start} (the plugin's start), in microseconds. */
  void startDrawn(Instant start) {
    drawnSeq = Math.max(drawnSeq, start.getEpochSecond() * 1_000_000L + start.getNano() / 1_000);
    drawnWhole = drawnSeq;
  }

  /** Function 43: on a reset the drawn dwells of these platforms' sensors go; all of them with {@code null}. */
  void clearDrawn(@Nullable Set<UUID> platforms) {
    boolean any = false;
    for (Sensor s : all.values()) {
      if ((platforms == null || platforms.contains(s.platform)) && !s.drawn.isEmpty()) {
        s.drawn.clear();
        s.drawnChanged = ++drawnSeq;
        any = true;
      }
    }
    if (any) {
      drawnWhole = drawnSeq;
    }
  }

  long drawnSeq() {
    return drawnSeq;
  }

  /** A new list of channels: each sensor's outputs are judged again at once (function 29, CR-0035). */
  void listed(ChannelList channels, boolean running) {
    list = channels;
    offer.listed(channels);
    for (Sensor s : all.values()) {
      s.outputs.listed(channels);
      judge(s, running);
    }
  }

  /** The platforms whose relations should be written now; the caller writes them, and drops those it need not. */
  Set<UUID> relationsDue() {
    return relationsDue;
  }

  /**
   * The platform's relations with the sensor's kinds replaced, other kinds kept (ADR-0051; {@code
   * Relation.replace}). {@code gmti.pairing} only when it is declared; {@code simulator.beyond-reach}
   * always. A removed sensor's kinds are emptied.
   */
  List<Relation> relations(UUID platform, List<Relation> stored, boolean pairingDeclared) {
    Sensor s = all.get(platform);
    Map<String, List<UUID>> desired = s == null ? (cleared.contains(platform) ? Map.of(PAIRING, List.of(), BEYOND, List.of()) : null) : s.desired;
    if (desired == null) {
      return stored;
    }
    List<Relation> result = stored;
    for (var e : desired.entrySet()) {
      if (e.getKey().equals(PAIRING) && !pairingDeclared) {
        continue;
      }
      result = Relation.replace(result, e.getKey(), e.getValue());
    }
    return result;
  }

  /** The relations of {@code platform} were written, or need not be. */
  void written(UUID platform) {
    relationsDue.remove(platform);
    if (!all.containsKey(platform)) {
      cleared.remove(platform);
    }
  }

  /**
   * At a tick: each sensor whose platform exists and is not hidden looks when its revisit is due
   * (A93). A generic sensor sends one report to each chosen output (function 38); a ground radar plans
   * its revisit's dwells and sends each dwell whose time has come (function 37), so a tick may send
   * several. While the simulation does not run nothing is looked at or sent, and the warning goes.
   */
  void tick(Instant now, boolean running, View view, Channels channels, long staleSeconds) {
    for (Sensor s : all.values()) {
      if (!running) {
        s.next = null;
        s.revisit = null;
        s.scan = null;
        s.found.clear();
        if (!s.outOfRange.isEmpty()) {
          s.outOfRange = List.of();
        }
        continue;
      }
      MapObjectContent platform = view.content(s.platform);
      if (platform == null || !(platform.geometry() instanceof Geometry.Point point) || view.hidden(s.platform)) {
        s.revisit = null; // a hidden or missing platform sends nothing (A104): its revisit begun goes, so no late dwells follow
        s.scan = null;
        s.found.clear(); // and what its scan found, so no burst of overdue own dwells follows when it is back (review of e4563fea, remark 4)
        if (platform == null && !s.drawn.isEmpty()) {
          s.drawn.clear(); // a missing platform's dwells go (function 43)
          s.drawnChanged = ++drawnSeq;
        }
        continue;
      }
      if (s.next == null) {
        s.next = now;
      }
      if (s.settings.type() == SensorType.GROUND_RADAR && s.settings.mode() == SensorSettings.Mode.SYSTEMATIC) {
        scan(s, now, platform, point.coordinates(), view, channels, staleSeconds);
        continue;
      }
      for (int guard = 0; guard < 1_000; guard++) {
        if (s.revisit == null) {
          if (now.isBefore(s.next)) {
            break;
          }
          // A revisit starts at its time, or now when that is a tick or more ago (a pause, a hidden platform).
          Instant start = Duration.between(s.next, now).compareTo(Duration.ofSeconds(1)) < 0 ? s.next : now;
          begin(s, start, platform, point.coordinates(), view, channels, staleSeconds);
        }
        if (s.revisit == null || !dwells(s, now, platform, point.coordinates(), view, channels, staleSeconds)) {
          break;
        }
      }
    }
  }

  /** The platform's heading, from its symbol's modifiers. */
  private static @Nullable Double direction(MapObjectContent platform) {
    Modifiers m = platform.symbol() == null ? null : platform.symbol().modifiers();
    return m == null || m.direction() == null ? null : Detector.normal(m.direction());
  }

  private static @Nullable Double speed(MapObjectContent platform) {
    Modifiers m = platform.symbol() == null ? null : platform.symbol().modifiers();
    return m == null || m.speed() == null || !(m.speed() >= 0) ? null : m.speed();
  }

  /** Every visible track but the platform, at this tick. */
  private static List<Detector.Target> targets(Sensor s, View view) {
    List<Detector.Target> targets = new ArrayList<>();
    for (UUID id : view.tracks()) {
      MapObjectContent c = id.equals(s.platform) || view.hidden(id) ? null : view.content(id);
      if (c != null && c.geometry() instanceof Geometry.Point p) {
        Modifiers tm = c.symbol() == null ? null : c.symbol().modifiers();
        targets.add(new Detector.Target(id, c, p.coordinates(), tm == null ? null : tm.speed(), tm == null ? null : tm.direction()));
      }
    }
    return targets;
  }

  /** A revisit begins: a generic sensor looks and sends at once; a ground radar plans its dwells. */
  private void begin(Sensor s, Instant start, MapObjectContent platform, Position at, View view, Channels channels, long staleSeconds) {
    SensorSettings settings = s.settings;
    Duration revisit = Duration.ofMillis(Math.round(settings.revisitSeconds() * 1000));
    Double direction = direction(platform);
    List<Detector.Target> targets = targets(s, view);
    long number = s.revisits++;
    if (settings.type() == SensorType.GENERIC) {
      s.next = start.plus(revisit);
      Detector.Look look = Detector.generic(at, targets, settings, s.random);
      s.overCap += look.overCap();
      finish(s, look.seen(), look.nearEdge());
      send(s, start, platform, at, look.area(), look.seen(), null, channels, staleSeconds);
      return;
    }
    double heading = direction == null ? 0 : direction;
    Dwells.Search area = Dwells.Search.of(at, heading, settings);
    List<Detector.Chosen> chosen = Detector.chosen(at, heading, targets, settings, s.random);
    List<Dwells.Polar> polar = chosen.stream().map(c -> new Dwells.Polar(area.relative(c.bearing()), c.distance())).toList();
    List<Dwells.Polar> others = targets.stream().map(t -> area.polar(t.position())).toList();
    double offset = s.random.nextDouble(); // the revisit's random draw: where its empty dwells start (M7-S4)
    List<Dwells.Planned> planned = Dwells.plan(area, polar, others, settings, offset);
    Duration interval = Duration.ofNanos(Math.round(settings.dwellInterval() * 1e9));
    Duration length = interval.multipliedBy(planned.size());
    s.next = start.plus(length.compareTo(revisit) > 0 ? length : revisit); // at least the revisit interval; longer when it needs more dwells
    s.revisit = new Revisit(number, start, interval, area, chosen, planned, new int[] {0}, new ArrayList<>());
  }

  /** Sends the ground radar's dwells whose time has come; true when its revisit ended. */
  private boolean dwells(Sensor s, Instant now, MapObjectContent platform, Position at, View view, Channels channels, long staleSeconds) {
    Revisit r = s.revisit;
    if (r == null) {
      return false;
    }
    while (r.sent()[0] < r.dwells().size() && !r.time(r.sent()[0]).isAfter(now)) {
      int k = r.sent()[0]++;
      Dwells.Planned dwell = r.dwells().get(k);
      // T-193: the dwell lies round the platform where it is now, the position its report gives, with the
      // revisit's planned bearings; a receiver reads an area off its sensor as far wider than it is.
      Dwells.Search here = r.area().at(at);
      List<Detector.Seen> seen = new ArrayList<>();
      List<Dwells.Polar> truths = new ArrayList<>();
      List<Dwells.Polar> reports = new ArrayList<>();
      for (int index : dwell.targets()) {
        Detector.Chosen c = r.targets().get(index);
        MapObjectContent content = view.hidden(c.id()) ? null : view.content(c.id());
        if (content == null || !(content.geometry() instanceof Geometry.Point p)) {
          continue; // gone or hidden since the revisit began (A6)
        }
        Position measured = Detector.measure(at, p.coordinates(), s.settings, s.random);
        Dwells.Polar truth = here.polar(p.coordinates());
        truths.add(truth);
        reports.add(here.polar(measured));
        seen.add(new Detector.Seen(c.id(), content, truth.distance(), measured));
      }
      // Placed again over its targets from here (function 37's rules), then grown to cover what is reported of them.
      Dwells.Extent extent = truths.isEmpty() ? dwell.extent() : Dwells.over(here, dwell.extent(), truths, s.settings);
      for (Dwells.Polar reported : reports) {
        extent = extent.cover(reported.bearing(), reported.distance());
      }
      r.seen().addAll(seen);
      boolean last = k == r.dwells().size() - 1;
      // Beyond 65 535 dwells (a revisit interval over a dwell interval of more than that) the last index is repeated.
      var sequence = new ChannelItem.SensorReport.Sequence(r.number(), Math.min(k, ChannelItem.SensorReport.Sequence.MAX_DWELLS_PER_REVISIT), last);
      Geometry.ArcBand band = here.band(extent);
      draw(s, new Drawn(k, r.number(), r.time(k), band), last);
      send(s, r.time(k), platform, at, band, seen, sequence, channels, staleSeconds);
    }
    if (r.sent()[0] < r.dwells().size()) {
      return false;
    }
    s.revisit = null;
    finish(s, r.seen(), Detector.nearEdge(s.settings));
    return true;
  }

  /**
   * Function 50 (T-197): a Systematic ground radar sends one dwell per dwell interval, back to back
   * across passes; the Revisit interval is not used. Each slot is a found target's own dwell when one is
   * due (the earliest, sharing it with the due ones whose dwells would overlap it), else the pass's next
   * cell. A pass ends at its last cell, which carries {@code lastOfRevisit} and sets the pairing and the
   * warning; the next starts one dwell interval later, from where the platform is then.
   */
  private void scan(Sensor s, Instant now, MapObjectContent platform, Position at, View view, Channels channels, long staleSeconds) {
    SensorSettings settings = s.settings;
    Duration interval = Duration.ofNanos(Math.round(settings.dwellInterval() * 1e9));
    if (s.scan == null) {
      if (now.isBefore(s.next)) {
        return;
      }
      // As a revisit: at its time, or now when that is a tick or more ago (a pause, a hidden platform).
      s.scan = pass(s, Duration.between(s.next, now).compareTo(Duration.ofSeconds(1)) < 0 ? s.next : now, platform, at);
    }
    List<Detector.Target> targets = targets(s, view);
    // M9 (owner YW, YW2 A): the scan turns with the platform. Each dwell's bearings are taken from the
    // platform's heading when it is sent, round where the platform is then (T-193), so every dwell lies
    // inside the arc; the pass goes on from its next cell in the turned frame.
    Double direction = direction(platform);
    double heading = direction == null ? 0 : direction;
    Dwells.Search here = Dwells.Search.of(at, heading, settings);
    // M9 (owner YV A): a found target's own dwell is centred on where it truly is at the dwell's time, as
    // the detector sees it; where it was last measured only when it is gone or hidden.
    Map<UUID, Position> truth = new LinkedHashMap<>();
    targets.forEach(one -> truth.put(one.id(), one.position()));
    Function<UUID, Dwells.Polar> where = id -> here.polar(truth.getOrDefault(id, s.found.get(id).measured()));
    for (int guard = 0; guard < 10_000 && !s.scan.slot.isAfter(now); guard++) {
      Scan pass = s.scan;
      Instant t = pass.slot;
      List<Detector.Chosen> chosen = Detector.chosen(at, heading, targets, settings, s.random);
      outside(s, t, here, where);
      List<UUID> due = due(s, t, here, where);
      boolean last;
      Dwells.Extent extent;
      if (due.isEmpty()) {
        extent = pass.cells.get(pass.cell++);
        last = pass.cell == pass.cells.size();
      } else {
        List<Dwells.Polar> aims = due.stream().map(where).toList();
        Dwells.Extent first = Dwells.around(here, aims.getFirst(), settings);
        extent = aims.size() == 1 ? first : Dwells.over(here, first, aims, settings);
        last = false;
      }
      List<Detector.Seen> seen = new ArrayList<>();
      for (Detector.Chosen c : chosen) {
        if (seen.size() >= settings.maxDetections()) {
          break; // the nearest first (Detector.chosen), at most "most detections per dwell"
        }
        Dwells.Polar polar = new Dwells.Polar(here.relative(c.bearing()), c.distance());
        if (!extent.holds(polar.bearing(), polar.distance())) {
          continue;
        }
        MapObjectContent content = view.content(c.id());
        if (content == null || !(content.geometry() instanceof Geometry.Point p)) {
          continue;
        }
        Position measured = Detector.measure(at, p.coordinates(), settings, s.random);
        seen.add(new Detector.Seen(c.id(), content, c.distance(), measured));
      }
      track(s, t, due, seen, settings);
      int k = pass.sent++;
      var sequence = new ChannelItem.SensorReport.Sequence(pass.number, Math.min(k, ChannelItem.SensorReport.Sequence.MAX_DWELLS_PER_REVISIT), last);
      Geometry.ArcBand band = here.band(extent);
      pass.seen.addAll(seen);
      draw(s, new Drawn(k, pass.number, t, band), last);
      send(s, t, platform, at, band, seen, sequence, channels, staleSeconds);
      if (last) {
        // One detection per track for the pairing: a target may be in a scan dwell and in its own dwells (function 50).
        Map<UUID, Detector.Seen> once = new LinkedHashMap<>();
        pass.seen.forEach(one -> once.put(one.id(), one));
        finish(s, List.copyOf(once.values()), Detector.nearEdge(settings));
        s.scan = pass(s, t.plus(interval), platform, at);
      } else {
        pass.slot = t.plus(interval);
      }
    }
    s.next = s.scan.slot;
  }

  /**
   * A new pass, its first dwell at {@code slot}: its cells, from where the platform is and how it heads
   * now. Only the job area's choice of cells is made with this heading (function 50); each cell's
   * bearings are taken from the heading when it is sent ({@link #scan}).
   */
  private Scan pass(Sensor s, Instant slot, MapObjectContent platform, Position at) {
    Double direction = direction(platform);
    Dwells.Search area = Dwells.Search.of(at, direction == null ? 0 : direction, s.settings);
    return new Scan(s.revisits++, Dwells.scan(area, s.settings), slot);
  }

  /**
   * M9 (owner YW2 A): a found target due at {@code t} that lies outside the arc then (its bearing off the
   * start and end bearings from the heading) gets no own dwell; it counts as one of its {@link #MISSES}.
   * One beyond the ranges still gets its dwell, which finds nothing (criterion 75).
   */
  private static void outside(Sensor s, Instant t, Dwells.Search here, Function<UUID, Dwells.Polar> where) {
    Instant next = t.plusNanos(Math.round(s.settings.targetRevisitSeconds() * 1e9));
    for (UUID id : List.copyOf(s.found.keySet())) {
      if (!s.found.get(id).due().isAfter(t) && !here.inArc(where.apply(id))) {
        missed(s, id, next);
      }
    }
  }

  /**
   * The found targets whose own dwell is due at {@code t}: the earliest due, then the other due ones
   * whose dwells would overlap its dwell, so they share it (function 50). Empty when none is due.
   */
  private static List<UUID> due(Sensor s, Instant t, Dwells.Search here, Function<UUID, Dwells.Polar> where) {
    UUID earliest = null;
    for (var e : s.found.entrySet()) {
      if (!e.getValue().due().isAfter(t) && (earliest == null || e.getValue().due().isBefore(s.found.get(earliest).due()))) {
        earliest = e.getKey();
      }
    }
    if (earliest == null) {
      return List.of();
    }
    Dwells.Extent first = Dwells.around(here, where.apply(earliest), s.settings);
    List<UUID> due = new ArrayList<>(List.of(earliest));
    for (var e : s.found.entrySet()) {
      if (!e.getKey().equals(earliest) && !e.getValue().due().isAfter(t) && first.overlaps(Dwells.around(here, where.apply(e.getKey()), s.settings))) {
        due.add(e.getKey());
      }
    }
    return due;
  }

  /** One of a found target's own dwells found nothing, or was not sent: due again at {@code next}, or dropped at the {@link #MISSES}th in a row. */
  private static void missed(Sensor s, UUID id, Instant next) {
    Found f = s.found.get(id);
    if (f.misses() + 1 >= MISSES) {
      s.found.remove(id);
    } else {
      s.found.put(id, new Found(f.measured(), next, f.misses() + 1));
    }
  }

  /**
   * Function 50's track-while-scan after one dwell at {@code t}: a track seen in a scan dwell is found,
   * its own dwell due a Target revisit later; a found target seen again is measured anew. Each target
   * whose own dwell this was is due again a Target revisit later, or, after {@link #MISSES} of its own
   * dwells in a row found nothing, dropped until the scan finds it again.
   */
  private static void track(Sensor s, Instant t, List<UUID> own, List<Detector.Seen> seen, SensorSettings settings) {
    Instant next = t.plusNanos(Math.round(settings.targetRevisitSeconds() * 1e9));
    Map<UUID, Detector.Seen> byId = new LinkedHashMap<>();
    seen.forEach(one -> byId.put(one.id(), one));
    for (UUID id : own) {
      Detector.Seen again = byId.get(id);
      if (again != null) {
        s.found.put(id, new Found(again.measured(), next, 0));
      } else {
        missed(s, id, next);
      }
    }
    if (!own.isEmpty()) {
      return; // a target dwell finds no new targets: only the scan does ("Found: a track detected in a scan dwell")
    }
    for (Detector.Seen one : seen) {
      Found f = s.found.get(one.id());
      s.found.put(one.id(), f == null ? new Found(one.measured(), next, 0) : new Found(one.measured(), f.due(), 0));
    }
  }

  /**
   * Function 43 (owner, Q57 A): a dwell replaces the drawn dwell of its index, and a revisit's last
   * dwell removes the drawn dwells of higher indices, so the latest revisit stays whole while the next
   * sweeps across it.
   */
  private void draw(Sensor s, Drawn dwell, boolean last) {
    s.drawn.put(dwell.index(), dwell);
    if (last) {
      s.drawn.tailMap(dwell.index(), false).clear();
    }
    s.drawnChanged = ++drawnSeq;
  }

  /** A revisit ended: its detections give the pairing and the warning (functions 29 and 30). */
  private void finish(Sensor s, List<Detector.Seen> seen, double nearEdge) {
    s.looks++;
    s.last = List.copyOf(seen);
    s.nearEdge = nearEdge;
    judge(s, true);
    relationsDue.add(s.platform);
  }

  /** One report to each chosen output. */
  private void send(Sensor s, Instant time, MapObjectContent platform, Position at, Geometry area, List<Detector.Seen> seen,
      ChannelItem.SensorReport.@Nullable Sequence sequence, Channels channels, long staleSeconds) {
    if (!s.outputs.any()) {
      return;
    }
    Instant expires = time.plusSeconds(staleSeconds);
    ChannelItem.Sensor described = described(s.settings, platform, direction(platform), speed(platform));
    s.outputs.send(channels, set -> {
      List<ChannelItem.Detection> detections = new ArrayList<>();
      for (Detector.Seen one : seen) {
        MapObjectContent c = Engine.expiring(one.content(), expires);
        c = new MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), c.layerId(), new Geometry.Point(one.measured()), c.symbol(),
            c.style(), c.properties(), c.label(), c.extensions(), c.fieldSets(), c.relations());
        detections.add(new ChannelItem.Detection(one.id(), Outputs.withSet(c, set)));
      }
      return new ChannelItem.SensorReport(s.platform, at, time, area, detections, described).withSequence(sequence);
    });
    reports++;
  }

  /** CR-0033 and CR-0034: what the sensor says of itself; with "Detect all in range" no errors, no minimum speed, and a probability of 1. */
  static ChannelItem.Sensor described(SensorSettings s, MapObjectContent platform, @Nullable Double direction, @Nullable Double speed) {
    Duration revisit = Duration.ofMillis(Math.round(s.revisitSeconds() * 1000));
    String name = name(platform, s);
    ChannelItem.Sensor sensor;
    if (s.type() == SensorType.GENERIC) {
      // Function 38: the position error both ways, the probability, no minimum speed.
      sensor = new ChannelItem.Sensor(name, s.mission(), revisit, s.positionError(), s.positionError(), null, s.detectionProbability(), direction, speed);
    } else if (s.detectAll()) {
      sensor = new ChannelItem.Sensor(name, s.mission(), revisit, null, null, null, 1.0, direction, speed);
    } else {
      sensor = new ChannelItem.Sensor(name, s.mission(), revisit, s.rangeError(), s.crossRangeError(), s.minimumDetectableSpeed(),
          s.detectionProbability(), direction, speed);
    }
    return sensor.withType(s.type()).withJobArea(s.jobArea());
  }

  /** The platform's name, cut to 64 characters, or "Ground radar" or "Generic sensor" (functions 29 and 36). */
  static String name(@Nullable MapObjectContent platform, SensorSettings settings) {
    ObjectProperties p = platform == null ? null : platform.properties();
    String name = p == null || p.name() == null ? "" : p.name().strip();
    if (name.isEmpty()) {
      return settings.unnamed();
    }
    return name.length() > ChannelItem.Sensor.MAX_NAME ? name.substring(0, ChannelItem.Sensor.MAX_NAME).strip() : name;
  }

  /**
   * CR-0035 (function 29): which of the last revisit's tracks a chosen output leaves out (its true
   * distance beyond the near edge plus the output's depth), the warning's outputs, and the kinds the
   * platform's relations should have (function 30). A change marks the platform's relations due.
   */
  private void judge(Sensor s, boolean running) {
    Set<UUID> beyond = new LinkedHashSet<>();
    List<String> names = new ArrayList<>();
    for (ChannelId id : s.outputs.chosen()) {
      ChannelInfo info = s.outputs.info(id).orElse(null);
      Double depth = info == null || s.outputs.missing(id) ? null : info.maxAreaDepth();
      if (depth == null) {
        continue;
      }
      boolean leaves = false;
      for (Detector.Seen seen : s.last) {
        if (seen.distance() > s.nearEdge + depth) {
          beyond.add(seen.id());
          leaves = true;
        }
      }
      if (leaves) {
        names.add(info.name());
      }
    }
    s.outOfRange = running ? List.copyOf(names) : List.of();
    if (s.looks == 0) {
      return;
    }
    List<UUID> paired = s.last.stream().map(Detector.Seen::id).filter(id -> !beyond.contains(id)).toList();
    Map<String, List<UUID>> desired = Map.of(PAIRING, paired, BEYOND, List.copyOf(beyond));
    if (!desired.equals(s.desired)) {
      s.desired = desired;
      relationsDue.add(s.platform);
    }
  }

  // ---------------------------------------------------------------- JSON

  /** {@code GET /sensors}: the channels that take sensor reports, and every sensor (function 27; A95). */
  JsonObject json(View view, boolean running, boolean pairingDeclared) {
    List<JsonValue> sensors = new ArrayList<>();
    for (Sensor s : all.values()) {
      MapObjectContent platform = view.content(s.platform);
      JsonObject outputs = s.outputs.json();
      sensors.add(JsonObject.builder()
          .put("platform", JsonString.of(s.platform.toString()))
          .put("name", JsonString.of(name(platform, s.settings)))
          .put("missing", JsonBoolean.of(platform == null))
          .put("settings", s.settings.json())
          .put("outputs", outputs.get("chosen"))
          .put("outOfRange", new JsonArray(s.outOfRange.stream().map(n -> (JsonValue) JsonString.of(n)).toList()))
          .put("detections", JsonNumber.of(s.last.size()))
          .build());
    }
    return JsonObject.builder()
        .put("running", JsonBoolean.of(running))
        .put("pairing", JsonBoolean.of(pairingDeclared))
        .put("channels", offer.json().get("channels"))
        .put("sensors", new JsonArray(sensors))
        .put("dwells", JsonNumber.of(drawnSeq))
        .build();
  }

  /**
   * {@code GET /sensors/dwells} (function 43): the drawn dwells with the sequence number {@code seq}.
   * With {@code since} the sets of the sensors that changed after it ({@code whole} false), or every
   * set ({@code whole} true) when a sensor went or a reset came after it, or without {@code since};
   * null when nothing changed after it (304).
   */
  @Nullable JsonObject drawnJson(@Nullable Long since) {
    boolean whole = since == null || since < drawnWhole || since > drawnSeq;
    if (!whole && since == drawnSeq) {
      return null;
    }
    List<JsonValue> list = new ArrayList<>();
    for (Sensor s : all.values()) {
      if (!whole && s.drawnChanged <= since) {
        continue;
      }
      List<JsonValue> dwells = new ArrayList<>();
      for (Drawn d : s.drawn.values()) {
        dwells.add(JsonObject.builder()
            .put("index", JsonNumber.of(d.index()))
            .put("revisit", JsonNumber.of(d.revisit()))
            .put("time", JsonString.of(d.time().toString()))
            .put("area", arcBand(d.area()))
            .build());
      }
      list.add(JsonObject.builder().put("platform", JsonString.of(s.platform.toString())).put("dwells", new JsonArray(dwells)).build());
    }
    return JsonObject.builder().put("seq", JsonNumber.of(drawnSeq)).put("whole", JsonBoolean.of(whole)).put("sensors", new JsonArray(list)).build();
  }

  /** An {@code ArcBand} as the data model's JSON writes it (lon, lat). */
  static JsonObject arcBand(Geometry.ArcBand a) {
    return JsonObject.builder()
        .put("type", JsonString.of("ArcBand"))
        .put("center", JsonArray.of(JsonNumber.of(a.center().longitude()), JsonNumber.of(a.center().latitude())))
        .put("innerRadius", JsonNumber.of(a.innerRadius()))
        .put("outerRadius", JsonNumber.of(a.outerRadius()))
        .put("startBearing", JsonNumber.of(a.startBearing()))
        .put("endBearing", JsonNumber.of(a.endBearing()))
        .build();
  }

  /** The sensors as the state document keeps them (function 27: saved with the simulator's own state). */
  JsonArray saved() {
    List<JsonValue> list = new ArrayList<>();
    all.values().forEach(s -> list.add(JsonObject.builder().put("platform", JsonString.of(s.platform.toString())).put("settings", s.settings.json()).build()));
    return new JsonArray(list);
  }

  /** The sensors of a state document; an entry it cannot read is skipped. */
  static Map<UUID, SensorSettings> read(@Nullable JsonValue value) {
    Map<UUID, SensorSettings> result = new LinkedHashMap<>();
    if (!(value instanceof JsonArray list)) {
      return result;
    }
    for (JsonValue v : list.values()) {
      if (v instanceof JsonObject o && o.get("platform") instanceof JsonString p && o.get("settings") instanceof JsonObject settings) {
        try {
          result.put(UUID.fromString(p.value()), SensorSettings.stored(settings));
        } catch (IllegalArgumentException | SensorSettings.Invalid e) {
          // skipped: not a sensor
        }
      }
    }
    return result;
  }

  /** The status's part (function 17a); with sensors and no {@code gmti.pairing} declared, it says so (function 30). */
  String status(boolean pairingDeclared, View view) {
    if (all.isEmpty()) {
      return "sensors 0";
    }
    long missing = all.keySet().stream().filter(id -> view.content(id) == null).count();
    long over = all.values().stream().mapToLong(s -> s.overCap).sum();
    return "sensors " + all.size() + (missing == 0 ? "" : " (" + missing + " missing)") + ", sensor reports " + reports
        + ", sensor detections over cap " + over + (pairingDeclared ? "" : ", no pairing written (gmti.pairing is not declared: gmti is not loaded)");
  }
}
