package dev.emcc.plugins.gmti.in;

import dev.emcc.plugins.gmti.format.Dwell;
import dev.emcc.plugins.gmti.format.Edition;
import dev.emcc.plugins.gmti.format.FreeText;
import dev.emcc.plugins.gmti.format.JobDefinition;
import dev.emcc.plugins.gmti.format.Mission;
import dev.emcc.plugins.gmti.format.Packet;
import dev.emcc.plugins.gmti.format.PacketHeader;
import dev.emcc.plugins.gmti.format.PlatformLocation;
import dev.emcc.plugins.gmti.format.Segment;
import dev.emcc.plugins.gmti.format.Skipped;
import dev.emcc.plugins.gmti.format.TargetReport;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Position;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import org.jspecify.annotations.Nullable;

/**
 * The state of one {@code in} link across packets (brief section 4), and what each packet makes:
 * platform fixes, dwell areas and detections, handed to a {@link Sink}. It lives in the link's
 * worker (per link, not per connection), so a reconnect keeps it. No clock of its own: every call
 * gets {@code now}.
 *
 * <ul>
 *   <li><b>The reference day</b> per platform and mission ({@code P8}, {@code P9}): the latest
 *       mission segment's, applied to later dwells only (pitfall 25). A dwell or platform location
 *       before its mission waits, at most {@value #MAX_WAITING} per platform for {@link #WAIT}, then
 *       is dropped and counted ({@code dropped: no mission}).
 *   <li><b>The job definition</b> per platform and job ({@code P8}, {@code J1}); {@code J5} 255 ends
 *       the job, and the coverage goes when that job drew it. Its dwell areas stay (M8, T-195).
 *   <li><b>Every dwell its own area</b> (M8, T-195; owner TP A; replaces M6's one area per dwell
 *       index, T-169): each dwell with a size gives one {@link AreaFix}, known by its recorded time,
 *       {@code D2} and {@code D3}. Nothing here keeps or removes them: their fade and their data
 *       type's expiry do (owner, A: no list and no cap).
 *   <li><b>The coverage</b> per platform (T-158; brief section 3, "The coverage"): the latest job
 *       definition's bounding area. Written at a job definition whose corners differ from the drawn
 *       ones, else refreshed at most once every {@link #COVERAGE_REFRESH} while the platform's dwells
 *       or job definitions come, with the time of its latest dwell (before its first dwell, the time
 *       the job definition arrived). Not drawn while its corners enclose no area, nor while the
 *       link's {@code coverage} setting is off.
 *   <li><b>The cap</b> of reports per dwell, counted across the segments of one dwell (pitfall 14):
 *       a dwell is {@code P8}, {@code P10}, its time, {@code D2} and {@code D3} (owner, Q3).
 *   <li><b>The time</b>: as recorded, or as received (A1): every time shifted by one offset, so that
 *       the link's newest dwell is now.
 * </ul>
 */
public final class Receiver {

  /** The most packets' segments waiting for a mission segment, per platform. */
  public static final int MAX_WAITING = 100;
  /** How long a dwell waits for its mission segment. */
  public static final Duration WAIT = Duration.ofSeconds(10);
  /** A drawn coverage with the same corners is written again at most this often (T-158; AEDP 3.7: the job definition's period). */
  public static final Duration COVERAGE_REFRESH = Duration.ofSeconds(30);

  private static final int MAX_MISSIONS = 256;
  private static final int MAX_JOBS = 1_024;
  private static final int MAX_DWELLS = 4_096;

  /** The link's {@code time} setting (A1). */
  public enum TimeMode { AS_RECORDED, AS_RECEIVED }

  /** Where a packet's results go: the link's worker, or a test. */
  public interface Sink {
    /** The platform at a dwell or a platform location. */
    void platform(PlatformFix fix);

    /** One dwell's own area (M8, T-195): written once, never updated or removed. */
    void area(AreaFix fix);

    /** The platform's coverage (T-158): replaced, or removed when {@code fix.coverage()} is {@code null}. */
    void coverage(CoverageFix fix);

    /** One report, within the cap. */
    void detection(DetectionFix fix);

    /** A counter of the link: skips, drops, values out of range. */
    void count(String name, long delta);

    /** A free text segment (logged at debug, brief section 2). */
    void freeText(String platformId, FreeText text);

    /** A version ({@code P1}) the link sees for the first time, other than "30" and "41", the two gmti writes (logged once per link). */
    void version(String version);
  }

  /**
   * The platform at {@code time}.
   *
   * @param mission the platform's latest mission segment
   * @param job the job definition of the packet's job, or {@code null} (none received, or a platform location)
   */
  public record PlatformFix(
      String platformId, PacketHeader header, Instant time, Position position, @Nullable Double direction, @Nullable Double speed,
      Mission mission, @Nullable JobDefinition job) {}

  /**
   * One dwell's area at {@code time} (M8, T-195).
   *
   * @param dwellTime the dwell's time as recorded, UTC ms: with {@code D2} and {@code D3} its key, so a dwell received again is the
   *     same area, and a later dwell with a wrapped {@code D2} another (PCA-gmti's point 1, 2026-11-13)
   */
  public record AreaFix(String platformId, PacketHeader header, Instant time, Geometry area, long jobId, int revisitIndex, int dwellIndex,
      long dwellTime) {
    public AreaFix {
      Objects.requireNonNull(area, "area: a dwell without a size has no area (A4)");
    }
  }

  /**
   * The platform's coverage at {@code time} (T-158); {@code null} removes it.
   *
   * @param jobId the job whose bounding area it is ({@code J1})
   */
  public record CoverageFix(String platformId, PacketHeader header, Instant time, Geometry.@Nullable Polygon coverage, long jobId) {}

  /**
   * One report.
   *
   * @param key the report's identity within the link (the external id after {@code <link>/}): {@code
   *     <P8>/<P10>/<dwell time, UTC ms>/<D2>/<D3>/<D32.1 or its place>} (owner, Q3)
   * @param dwell the dwell segment the report came in
   * @param job the job definition of the packet's job, for nominal errors
   */
  public record DetectionFix(String platformId, String key, PacketHeader header, Instant time, Dwell dwell, TargetReport report, @Nullable JobDefinition job) {}

  private record MissionKey(String platformId, long missionId) {}

  private record JobKey(String platformId, long jobId) {}

  private record Waiting(PacketHeader header, Segment segment, Instant since) {}

  /** A platform's coverage: the corners of its latest job definition, and what was written of them. */
  private static final class Cover {
    List<Position> corners;
    long jobId;
    PacketHeader header;
    boolean drawn;
    boolean changed = true;
    Instant written = Instant.MIN;

    Cover(List<Position> corners, long jobId, PacketHeader header) {
      this.corners = corners;
      this.jobId = jobId;
      this.header = header;
    }
  }

  private final Map<MissionKey, Mission> missions = bounded(MAX_MISSIONS);
  private final Map<JobKey, JobDefinition> jobs = bounded(MAX_JOBS);
  private final Map<String, Integer> written = bounded(MAX_DWELLS);
  private final Map<String, Cover> covers = bounded(MAX_JOBS);
  private final Map<String, Instant> lastDwell = bounded(MAX_JOBS);
  private final Map<String, ArrayDeque<Waiting>> waiting = new HashMap<>();
  private final Set<String> versions = new HashSet<>();
  private int cap;
  private TimeMode timeMode;
  private boolean coverage;
  private @Nullable Instant newest;
  private Duration offset = Duration.ZERO;

  /** A receiver that draws the coverage, as the link's {@code coverage} setting does by default. */
  public Receiver(int cap, TimeMode timeMode) {
    this(cap, timeMode, true);
  }

  /**
   * @param cap the link's {@code maxReportsPerDwell}
   * @param timeMode the link's {@code time}
   * @param coverage the link's {@code coverage}: whether the sensors' coverages are drawn (T-158)
   */
  public Receiver(int cap, TimeMode timeMode, boolean coverage) {
    this.cap = cap;
    this.timeMode = timeMode;
    this.coverage = coverage;
  }

  /** New settings, at once (work package 3: no reconnect). A changed time mode starts its offset afresh. */
  public void settings(int newCap, TimeMode newMode) {
    this.cap = newCap;
    if (newMode != timeMode) {
      newest = null;
      offset = Duration.ZERO;
    }
    this.timeMode = newMode;
  }

  /**
   * New settings with the {@code coverage} switch (T-158). Switched off, every drawn coverage is
   * removed through {@code sink}; switched on, each is drawn at its platform's next dwell or job
   * definition.
   */
  public void settings(int newCap, TimeMode newMode, boolean newCoverage, Sink sink) {
    settings(newCap, newMode);
    if (coverage && !newCoverage) {
      for (var e : covers.entrySet()) {
        Cover c = e.getValue();
        if (c.drawn) {
          c.drawn = false;
          sink.coverage(new CoverageFix(e.getKey(), c.header, c.written, null, c.jobId));
        }
      }
    }
    this.coverage = newCoverage;
  }

  /** Segments waiting for their mission segment, over all platforms. */
  public int waiting() {
    return waiting.values().stream().mapToInt(ArrayDeque::size).sum();
  }

  /** One packet, its segments in order. */
  public void packet(Packet packet, Instant now, Sink sink) {
    PacketHeader h = packet.header();
    if (!Edition.written(h.version()) && versions.add(h.version())) {
      sink.version(h.version());
    }
    if (packet.valuesOutOfRange() > 0) {
      sink.count("value out of range", packet.valuesOutOfRange());
    }
    for (Segment s : packet.segments()) {
      switch (s) {
        case Mission m -> mission(h, m, now, sink);
        case JobDefinition j -> job(h, j, now, sink);
        case Dwell d -> placed(h, d, now, sink);
        case PlatformLocation l -> placed(h, l, now, sink);
        case FreeText f -> {
          sink.count("skipped: segment " + f.type(), 1);
          sink.freeText(h.platformId(), f);
        }
        case Skipped k -> sink.count("skipped: segment " + k.type(), 1);
      }
    }
  }

  /** Drops what waited too long for its mission segment. Called once a second. */
  public void tick(Instant now, Sink sink) {
    for (Iterator<ArrayDeque<Waiting>> it = waiting.values().iterator(); it.hasNext(); ) {
      ArrayDeque<Waiting> queue = it.next();
      while (!queue.isEmpty() && !queue.peekFirst().since().plus(WAIT).isAfter(now)) {
        queue.pollFirst();
        sink.count("dropped: no mission", 1);
      }
      if (queue.isEmpty()) {
        it.remove();
      }
    }
  }

  private void mission(PacketHeader h, Mission m, Instant now, Sink sink) {
    if (m.referenceDay() == null) {
      sink.count("value out of range", 1);
      return;
    }
    missions.put(new MissionKey(h.platformId(), h.missionId()), m);
    ArrayDeque<Waiting> queue = waiting.get(h.platformId());
    if (queue == null) {
      return;
    }
    var still = new ArrayDeque<Waiting>();
    for (Waiting w : queue) {
      if (w.header().missionId() == h.missionId()) {
        apply(w.header(), w.segment(), m, now, sink);
      } else {
        still.add(w);
      }
    }
    if (still.isEmpty()) {
      waiting.remove(h.platformId());
    } else {
      waiting.put(h.platformId(), still);
    }
  }

  private void job(PacketHeader h, JobDefinition j, Instant now, Sink sink) {
    String id = h.platformId();
    var key = new JobKey(id, j.jobId());
    if (!j.ended()) {
      jobs.put(key, j);
      Cover c = covers.get(id);
      if (c == null) {
        c = new Cover(j.boundingArea(), j.jobId(), h);
        covers.put(id, c);
      } else if (!c.corners.equals(j.boundingArea())) {
        c.corners = j.boundingArea();
        c.changed = true;
      }
      c.jobId = j.jobId();
      c.header = h;
      drawCoverage(id, c, lastDwell.getOrDefault(id, now), now, sink);
      return;
    }
    jobs.remove(key); // its dwell areas stay until they expire (M8, T-195)
    Cover c = covers.get(id);
    if (c != null && c.jobId == j.jobId()) {
      covers.remove(id);
      if (c.drawn) {
        sink.coverage(new CoverageFix(id, h, now, null, j.jobId()));
      }
    }
  }

  /**
   * Writes the platform's coverage when it is not drawn yet or its corners changed, else when the
   * last write is {@link #COVERAGE_REFRESH} old; removes it when its corners enclose no area.
   *
   * @param time the coverage's time: its platform's latest dwell's, or the job definition's arrival
   */
  private void drawCoverage(String id, Cover c, Instant time, Instant now, Sink sink) {
    if (!coverage) {
      return;
    }
    Geometry.Polygon shape = CoverageShape.of(c.corners);
    if (shape == null) {
      if (c.drawn) {
        c.drawn = false;
        sink.coverage(new CoverageFix(id, c.header, time, null, c.jobId));
      }
      return;
    }
    if (c.drawn && !c.changed && now.isBefore(c.written.plus(COVERAGE_REFRESH))) {
      return;
    }
    c.drawn = true;
    c.changed = false;
    c.written = now;
    sink.coverage(new CoverageFix(id, c.header, time, shape, c.jobId));
  }

  /** A dwell or platform location: placed now when its mission is known, else waits. */
  private void placed(PacketHeader h, Segment s, Instant now, Sink sink) {
    Mission m = missions.get(new MissionKey(h.platformId(), h.missionId()));
    if (m != null) {
      apply(h, s, m, now, sink);
      return;
    }
    ArrayDeque<Waiting> queue = waiting.computeIfAbsent(h.platformId(), k -> new ArrayDeque<>());
    if (queue.size() >= MAX_WAITING) {
      queue.pollFirst();
      sink.count("dropped: no mission", 1);
    }
    queue.addLast(new Waiting(h, s, now));
  }

  private void apply(PacketHeader h, Segment s, Mission m, Instant now, Sink sink) {
    if (s instanceof Dwell d) {
      dwell(h, d, m, now, sink);
    } else if (s instanceof PlatformLocation l) {
      Instant t = shift(recorded(m, l.time()), now);
      var at = Position.of(l.longitude(), l.latitude(), l.altitude());
      sink.platform(new PlatformFix(h.platformId(), h, t, at, l.track(), l.speed(), m, null));
    }
  }

  private void dwell(PacketHeader h, Dwell d, Mission m, Instant now, Sink sink) {
    Instant recorded = recorded(m, d.time());
    Instant t = shift(recorded, now);
    String id = h.platformId();
    JobDefinition job = jobs.get(new JobKey(id, h.jobId()));
    Double direction = d.platformHeading() != null ? d.platformHeading() : d.sensorTrack();
    var sensor = Position.of(d.sensorLongitude(), d.sensorLatitude(), d.sensorAltitude());
    sink.platform(new PlatformFix(id, h, t, sensor, direction, d.sensorSpeed(), m, job));
    Geometry area = AreaShape.of(d);
    if (area != null) { // none while D26 or D27 is 0 (A4); never updated or removed here (T-195)
      sink.area(new AreaFix(id, h, t, area, h.jobId(), d.revisitIndex(), d.dwellIndex(), recorded.toEpochMilli()));
    }
    lastDwell.put(id, t);
    Cover c = covers.get(id);
    if (c != null) {
      c.header = h; // the latest packet's label
      drawCoverage(id, c, t, now, sink); // its refresh, with this dwell's time
    }
    if (d.reports().isEmpty()) {
      return; // an empty dwell moves the platform and the area only (pitfall 13)
    }
    String dwellKey = id + "/" + h.jobId() + "/" + recorded.toEpochMilli() + "/" + d.revisitIndex() + "/" + d.dwellIndex();
    int before = written.getOrDefault(dwellKey, 0);
    int take = Math.min(Math.max(0, cap - before), d.reports().size());
    for (int i = 0; i < take; i++) {
      TargetReport r = d.reports().get(i);
      String report = r.index() != null ? r.index().toString() : place(r);
      sink.detection(new DetectionFix(id, dwellKey + "/" + report, h, t, d, r, job));
    }
    written.put(dwellKey, before + take);
    if (take < d.reports().size()) {
      sink.count("skipped: over cap", d.reports().size() - take);
    }
  }

  /** A report without an index is known by its place, to 1e-7° (assumption B6). */
  private static String place(TargetReport r) {
    return String.format(Locale.ROOT, "%.7f,%.7f", r.longitude(), r.latitude());
  }

  private static Instant recorded(Mission m, long millis) {
    LocalDate day = m.referenceDay();
    return day.atStartOfDay(ZoneOffset.UTC).toInstant().plusMillis(millis);
  }

  private Instant shift(Instant recorded, Instant now) {
    if (timeMode == TimeMode.AS_RECORDED) {
      return recorded;
    }
    if (newest == null || recorded.isAfter(newest)) {
      newest = recorded;
      offset = Duration.between(recorded, now);
    }
    return recorded.plus(offset);
  }

  private static <K, V> Map<K, V> bounded(int max) {
    return new LinkedHashMap<>(16, 0.75f, true) {
      private static final long serialVersionUID = 1L;

      @Override
      protected boolean removeEldestEntry(Map.Entry<K, V> eldest) {
        return size() > max;
      }
    };
  }
}
