package dev.emcc.plugins.gmti.out;

import dev.emcc.plugins.gmti.format.Dwell;
import dev.emcc.plugins.gmti.format.Encoder;
import dev.emcc.plugins.gmti.format.JobDefinition;
import dev.emcc.plugins.gmti.format.Mission;
import dev.emcc.plugins.gmti.format.PacketHeader;
import dev.emcc.plugins.gmti.format.Segment;
import dev.emcc.plugins.gmti.format.TargetReport;
import dev.emcc.sdk.Classifications;
import dev.emcc.sdk.ClassificationLimit;
import dev.emcc.sdk.channel.ChannelItem;
import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Modifiers;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.zip.CRC32;
import org.jspecify.annotations.Nullable;

/**
 * What an {@code out} link makes of each {@link ChannelItem.SensorReport} (brief section 3, "Out"; reference
 * 4.3): its packets, each with the packet header and a mission segment, the job definition before the
 * sensor's first dwell and at least every 30 s, and the dwell in segments of at most {@code
 * maxReportsPerSegment} reports, packed into packets that fit the link ({@code 65 535} bytes over
 * TCP, one datagram over UDP). With the link's {@code oneSegmentPerPacket} (T-159; on by default,
 * owner MY) each of these segments goes in a packet of its own instead, in the same order: the
 * mission once per report, the job when due, then each dwell segment. Pure; it lives in the link's
 * worker.
 *
 * <p>The sensor (CR-0033, owner JW): {@code P8} from its name (the ACA's R2), its values in the
 * format's units ({@link SensorFields}); what a field cannot hold is "no statement" or left out, and
 * named in {@link Result#notHeld}. A dwell without a sensor (a sender built before CR-0033,
 * assumption B2) gets "SIM" and seven hex digits of the sensor's id as {@code P8} and "no
 * statement" for the rest. The job's bounding area is the sensor's job area ({@link JobArea}; T-168),
 * else the box round the dwell area, and a changed job area sends the job definition again.
 *
 * <p>A revisit's dwells (CR-0040): with the report's {@code Sequence}, {@code D2} is its revisit
 * modulo 65 536, {@code D3} its dwell and {@code D4} its last of the revisit; without one, the
 * link's own revisit count, {@code D3} 0 and {@code D4} set, as in M5.
 *
 * <p>The mission (CR-0034, owner KF): {@code M1} is the sensor's mission with the characters
 * outside the basic set as "?", as {@code P8} (the ACA's R3), cut to 12; {@code P9} is the CRC-32
 * of the whole text's UTF-8 bytes, 0 as 1 (R2), the same across restarts, links and releases.
 * Without a mission, {@code M1} is spaces and {@code P9} the second of the link's start day.
 */
public final class Sender {

  /** The largest {@code D6}, an unsigned 32-bit count of milliseconds. */
  static final long MAX_DWELL_TIME = 0xFFFF_FFFFL;

  /** {@code M1}'s length in characters. */
  static final int MISSION_PLAN = 12;

  /** The job definition is sent again after this long (AEDP 3.7). */
  public static final Duration JOB_EVERY = Duration.ofSeconds(30);

  /**
   * How deep beyond its near edge a dwell's area goes out, in metres: twice {@code D26}'s 255.99 km
   * (CR-0035, owner KL and KM; G12). The out channels declare it as their {@code maxAreaDepth}, and
   * a deeper area is cut there, its detections beyond left out and counted ({@link DwellArea}).
   */
  public static final double MAX_AREA_DEPTH_METRES = 511_980.0;

  /**
   * The link's settings for sending.
   *
   * @param nationality {@code P3} and {@code P5}, two characters
   * @param exercise {@code P7} 129 instead of 1
   * @param maxReportsPerSegment at most this many reports per dwell segment
   * @param maxPacket the largest packet the link carries
   * @param linkLabel the least a packet says ({@code P4}): an empty dwell gets it (the ACA's R7)
   * @param highest detections above it are not sent (ADR-0037 point 8)
   * @param names the policy's classifications for {@code P4} 1 to 5
   * @param oneSegmentPerPacket each segment in a packet of its own, with its own packet header (T-159, owner MV A and MY;
   *     criterion 22); {@code false}: one packet per sensor report, more only when it does not fit
   */
  public record Settings(
      String nationality, boolean exercise, int maxReportsPerSegment, int maxPacket, SecurityLabel linkLabel, ClassificationLimit highest,
      List<String> names, boolean oneSegmentPerPacket) {
    public Settings {
      names = List.copyOf(names);
    }

    /** One packet per sensor report, as before T-159. */
    public Settings(
        String nationality, boolean exercise, int maxReportsPerSegment, int maxPacket, SecurityLabel linkLabel, ClassificationLimit highest,
        List<String> names) {
      this(nationality, exercise, maxReportsPerSegment, maxPacket, linkLabel, highest, names, false);
    }
  }

  /**
   * One dwell's packets.
   *
   * @param aboveHighest detections left out, above the link's highest classification
   * @param beyondReach detections left out, farther from the sensor than the cut area reaches (owner, JS)
   * @param labelMapped false when the packet's label had no {@code P4} among the names (then 1, top secret, is sent)
   * @param notHeld the fields whose value this dwell could not send, each once ({@code D26} when the area was cut,
   *     {@link #areaCut()}; the sensor's values; a report's {@code D32.6} or {@code D32.7}), counted as {@code not held: <field>}
   * @param missionCut the sensor's mission was cut to {@code M1}'s 12 characters, true on the sensor's first such dwell
   *     only: counted once per sensor while the link runs (CR-0034)
   */
  public record Result(
      List<byte[]> packets, String platformId, int detections, int aboveHighest, int beyondReach, boolean labelMapped, List<String> notHeld,
      boolean missionCut) {
    public Result {
      packets = List.copyOf(packets);
      notHeld = List.copyOf(notHeld);
    }

    /** Whether the area was cut: deeper than {@link Sender#MAX_AREA_DEPTH_METRES} beyond its near edge, {@code D26} 255.99 km (CR-0035). */
    public boolean areaCut() {
      return notHeld.contains("D26");
    }
  }

  private static final class SensorState {
    final String platformId;
    final long jobId;
    int revisit = -1;
    @Nullable Instant lastJob;
    /** The job area of the job definition last sent (T-168): a changed one sends the job definition again. */
    Geometry.@Nullable Polygon jobArea;
    boolean missionCut;
    /** Whether a job area sent as its box was counted (owner, 2026-11-10: once per sensor). */
    boolean jobAreaBoxed;

    SensorState(String platformId, long jobId) {
      this.platformId = platformId;
      this.jobId = jobId;
    }
  }

  private final Classifications classifications;
  private final long missionId;
  private LocalDate day;
  private Instant midnight;
  private final Map<UUID, SensorState> sensors = new LinkedHashMap<>();
  private final Set<String> platformIds = new HashSet<>();
  private Settings settings;
  private long nextJob = 1;

  /**
   * @param start when the link started: its reference day ({@code M5}–{@code M7}) and the mission id of a sensor without a
   *     mission ({@code P9}, the second of that day) stay while it runs, unless a dwell lies outside the 49.7 days {@code D6} can
   *     count: then the day moves to the dwell's
   */
  public Sender(Settings settings, Classifications classifications, Instant start) {
    this.settings = Objects.requireNonNull(settings, "settings");
    this.classifications = Objects.requireNonNull(classifications, "classifications");
    this.day = LocalDate.ofInstant(start, ZoneOffset.UTC);
    this.midnight = day.atStartOfDay(ZoneOffset.UTC).toInstant();
    this.missionId = Duration.between(midnight, start).toSeconds();
  }

  /** New settings at once (no reconnect); the sensors keep their ids and counters. */
  public void settings(Settings value) {
    this.settings = Objects.requireNonNull(value, "settings");
  }

  public Result dwell(ChannelItem.SensorReport item) {
    SensorState s = sensors.computeIfAbsent(item.sensorId(), id -> newSensor(id, item.sensor()));
    // D2 to D4 (CR-0040): from the report's sequence, else as in M5: the link's own revisit count, dwell 0, the revisit's last
    ChannelItem.SensorReport.Sequence sequence = item.sequence();
    if (sequence == null) {
      s.revisit = (s.revisit + 1) & 0xFFFF;
    }
    int revisit = sequence == null ? s.revisit : (int) (sequence.revisit() % 65_536);
    int dwellNumber = sequence == null ? 0 : sequence.dwell();
    boolean lastOfRevisit = sequence == null || sequence.lastOfRevisit();

    Position sensor = item.platform();
    DwellArea.Fields area = DwellArea.of(item.area(), sensor);
    var kept = new ArrayList<ChannelItem.Detection>();
    int above = 0;
    int beyond = 0;
    for (ChannelItem.Detection d : item.detections()) {
      if (!classifications.within(d.content().label(), settings.highest())) {
        above++;
      } else if (area.cut() && Geodesy.inverse(area.origin(), at(d)).distanceMetres() > area.reach()) {
        beyond++; // outside the cut area: a packet never reports a target outside its own area (JS)
      } else {
        kept.add(d);
      }
    }
    SecurityLabel top = settings.linkLabel();
    for (ChannelItem.Detection d : kept) {
      if (classifications.compare(d.content().label(), ClassificationLimit.of(top)) == Classifications.Comparison.HIGHER) {
        top = d.content().label();
      }
    }
    int p4 = settings.names().indexOf(top.classification()) + 1;
    boolean mapped = p4 > 0;
    if (!mapped) {
      p4 = 1; // a label the names do not know is sent as the most restrictive, never lower
    }
    String mission = item.sensor() == null ? null : item.sensor().mission();
    String plan = mission == null ? "" : basic(mission);
    boolean missionCut = plan.length() > MISSION_PLAN && !s.missionCut;
    s.missionCut |= missionCut;
    var header = new PacketHeader(PacketHeader.VERSION, settings.nationality(), p4, settings.nationality(), 0, settings.exercise() ? 129 : 1,
        s.platformId, mission == null ? missionId : missionId(mission), s.jobId);

    long millis = Duration.between(midnight, item.time()).toMillis();
    if (millis < 0 || millis > MAX_DWELL_TIME) {
      // D6 holds about 49.7 days: a dwell outside them moves the reference day; every packet says it (mission segment)
      day = LocalDate.ofInstant(item.time(), ZoneOffset.UTC);
      midnight = day.atStartOfDay(ZoneOffset.UTC).toInstant();
      millis = Duration.between(midnight, item.time()).toMillis();
    }
    var notHeld = new LinkedHashSet<String>();
    if (area.cut()) {
      notHeld.add("D26");
    }
    double rangeToCentre = Geodesy.inverse(sensor, Position.of(area.longitude(), area.latitude())).distanceMetres();
    SensorFields values = SensorFields.of(item.sensor(), rangeToCentre);
    notHeld.addAll(values.notHeld());
    Dwell.Builder dwell = Dwell.of(revisit, dwellNumber, millis, sensor.latitude(), sensor.longitude(), sensor.altitude() == null ? 0 : sensor.altitude(),
        area.latitude(), area.longitude(), area.rangeHalfExtent(), area.angleHalfExtent()).lastDwell(lastOfRevisit);
    if (values.reportErrors() && !kept.isEmpty()) {
      dwell.sensorPositionError(0.0, 0.0, 0.0); // the reports' D32.12 and D32.13 need D12 to D14 (AEDP 3.4.32.12): none stated
    }
    if (values.track() != null) {
      dwell.sensorMotion(values.track(), values.speed(), 0.0);
    }
    dwell.minimumDetectableVelocity(values.dwellMinimumSpeed());
    Dwell body = dwell.build();

    var lead = new ArrayList<Segment>();
    lead.add(Mission.on(day, 255, cut(plan, MISSION_PLAN), "emcc"));
    // The job definition: before the sensor's first dwell, with the next dwell when its job area changes (AEDP 3.7: the actual
    // area whenever it differs; T-168), and at least every 30 s
    Geometry.Polygon jobArea = item.sensor() == null ? null : item.sensor().jobArea();
    if (s.lastJob == null || !item.time().isBefore(s.lastJob.plus(JOB_EVERY)) || !Objects.equals(jobArea, s.jobArea)) {
      s.lastJob = item.time();
      s.jobArea = jobArea;
      JobArea.Corners corners = JobArea.of(jobArea, item.area());
      if (corners.boxed() && !s.jobAreaBoxed) {
        s.jobAreaBoxed = true;
        notHeld.add("J6"); // J6-J13 hold a convex four-corner area only: its box goes (owner, 2026-11-10)
      }
      lead.add(job(s.jobId, corners.corners(), values));
    }
    List<Dwell> segments = segments(body, reports(sensor, kept, values, notHeld), header, lead);
    return new Result(packets(header, lead, segments), s.platformId, kept.size(), above, beyond, mapped, List.copyOf(notHeld), missionCut);
  }

  /**
   * The reports of the kept detections: full precision, {@code D32.6} with an altitude, {@code D32.7} with a speed and direction,
   * {@code D32.12} and {@code D32.13} from the sensor. A height or radial speed its {@code S16} cannot hold is left out and named in
   * {@code notHeld} (the ACA's R3), never clamped.
   */
  private static List<TargetReport> reports(Position sensor, List<ChannelItem.Detection> detections, SensorFields values, Set<String> notHeld) {
    var reports = new ArrayList<TargetReport>(detections.size());
    for (int i = 0; i < detections.size(); i++) {
      MapObjectContent c = detections.get(i).content();
      Position at = at(detections.get(i));
      var r = TargetReport.at(at.latitude(), at.longitude()).index(i).classification(SimulatedClass.of(c.symbol())).classificationProbability(100)
          .slantRangeError(values.reportRangeError()).crossRangeError(values.reportCrossRangeError());
      if (at.altitude() != null) {
        long metres = Math.round(at.altitude());
        if (metres >= Short.MIN_VALUE && metres <= Short.MAX_VALUE) {
          r.height((int) metres);
        } else {
          notHeld.add("D32.6");
        }
      }
      Modifiers m = c.symbol() == null ? null : c.symbol().modifiers();
      if (m != null && m.speed() != null && m.direction() != null) {
        double bearing = Geodesy.inverse(sensor, at).initialAzimuth();
        long cms = Math.round(m.speed() * Math.cos(Math.toRadians(m.direction() - bearing)) * 100); // away from the sensor positive
        if (cms >= Short.MIN_VALUE && cms <= Short.MAX_VALUE) {
          r.radialVelocity(cms / 100.0);
        } else {
          notHeld.add("D32.7");
        }
      }
      reports.add(r.build());
    }
    return reports;
  }

  /** A detection's position: its content's {@code Point} (the SDK's {@code Detection}). */
  private static Position at(ChannelItem.Detection d) {
    return ((Geometry.Point) d.content().geometry()).coordinates();
  }

  /** Reports with the same fields go together; each group in segments of at most the cap; an empty dwell is one segment. */
  private List<Dwell> segments(Dwell body, List<TargetReport> reports, PacketHeader header, List<Segment> lead) {
    if (reports.isEmpty()) {
      return List.of(body);
    }
    var groups = new LinkedHashMap<String, List<TargetReport>>();
    for (TargetReport r : reports) {
      groups.computeIfAbsent((r.height() != null) + "/" + (r.radialVelocity() != null), k -> new ArrayList<>()).add(r);
    }
    var out = new ArrayList<Dwell>();
    for (List<TargetReport> group : groups.values()) {
      int perSegment = Math.max(1, Math.min(settings.maxReportsPerSegment(), fitting(body, group.getFirst(), lead)));
      for (int from = 0; from < group.size(); from += perSegment) {
        out.add(body.withReports(group.subList(from, Math.min(group.size(), from + perSegment))));
      }
    }
    return out;
  }

  /** How many reports like {@code sample} fit one packet with the lead segments (alone, with one segment per packet). */
  private int fitting(Dwell body, TargetReport sample, List<Segment> lead) {
    int empty = Encoder.size(body);
    int one = Encoder.size(body.withReports(List.of(sample)));
    int used = 32 + empty;
    if (!settings.oneSegmentPerPacket()) {
      for (Segment s : lead) {
        used += Encoder.size(s);
      }
    }
    return (settings.maxPacket() - used) / Math.max(1, one - empty);
  }

  /**
   * Packs the segments into packets of at most {@code maxPacket} bytes; each packet has the mission segment, the first the job too.
   * With one segment per packet (T-159), each segment goes alone in that order, under the same header ({@code P2} each packet's size).
   */
  private List<byte[]> packets(PacketHeader header, List<Segment> lead, List<Dwell> segments) {
    var packets = new ArrayList<byte[]>();
    if (settings.oneSegmentPerPacket()) {
      for (Segment s : lead) {
        packets.add(Encoder.packet(header, List.of(s)));
      }
      for (Dwell d : segments) {
        packets.add(Encoder.packet(header, List.of(d)));
      }
      return packets;
    }
    var current = new ArrayList<Segment>(lead);
    int size = 32;
    for (Segment s : lead) {
      size += Encoder.size(s);
    }
    boolean hasDwell = false;
    int missionSize = Encoder.size(lead.getFirst());
    for (Dwell d : segments) {
      int n = Encoder.size(d);
      if (hasDwell && size + n > settings.maxPacket()) {
        packets.add(Encoder.packet(header, current));
        current = new ArrayList<>(List.of(lead.getFirst()));
        size = 32 + missionSize;
      }
      current.add(d);
      size += n;
      hasDwell = true;
    }
    packets.add(Encoder.packet(header, current));
    return packets;
  }

  /**
   * The job: {@code J15} and {@code J21}, {@code J22}, {@code J24}, {@code J25} from the sensor; the platform's own errors
   * ({@code J16}–{@code J20}), {@code J23} and {@code J26} no statement.
   */
  private static JobDefinition job(long jobId, List<Position> boundingArea, SensorFields v) {
    return new JobDefinition(jobId, JobDefinition.NONE_8, "SIM", 0, 1, boundingArea, JobDefinition.MODE_MTI, v.revisit(),
        JobDefinition.NONE_16, JobDefinition.NONE_16, JobDefinition.NONE_16, JobDefinition.NONE_8, JobDefinition.NONE_16, v.slantRangeError(),
        v.crossRangeAngle(), JobDefinition.NONE_16, v.minimumSpeed(), v.probability(), JobDefinition.NONE_8, 0, 0);
  }

  /**
   * The sensor's {@code P8}, kept while the link runs (brief, "The sensor"; the ACA's R2): its name with each character outside
   * {@code 0x20}-{@code 0x7E} as "?", cut to 10; when another sensor on the link holds it, the first free of the name cut to 8 and
   * "~2" to "~9", then cut to 7 and "~10" to "~99". Without a sensor, or with all 99 taken, "SIM" and seven hex digits of its id (B2).
   */
  private SensorState newSensor(UUID id, ChannelItem.@Nullable Sensor sensor) {
    String platformId = null;
    if (sensor != null) {
      String name = basic(sensor.name());
      platformId = take(cut(name, 10));
      for (int n = 2; n <= 99 && platformId == null; n++) {
        platformId = take(cut(name, n < 10 ? 8 : 7) + "~" + n);
      }
    }
    if (platformId == null) {
      platformId = hexId(id);
    }
    return new SensorState(platformId, nextJob++);
  }

  /** "SIM" and the first unused seven hex digits of the sensor's id (assumption B2), unique on the link. */
  private String hexId(UUID sensor) {
    String hex = sensor.toString().replace("-", "").toUpperCase(Locale.ROOT);
    for (int from = 0; from + 7 <= hex.length(); from++) {
      String id = take("SIM" + hex.substring(from, from + 7));
      if (id != null) {
        return id;
      }
    }
    return "SIM" + String.format(Locale.ROOT, "%07d", nextJob); // 26 ids taken by clashes: not to be expected
  }

  /** The id when no sensor on the link holds it yet; spaces at the end do not count, as {@code P8} pads with them. */
  private @Nullable String take(String id) {
    return platformIds.add(id.stripTrailing()) ? id : null;
  }

  /**
   * A mission's {@code P9} (CR-0034, the ACA's R2; the brief names the function, a contract between releases): the CRC-32
   * (ISO-HDLC, {@link CRC32}) of the whole text as UTF-8, before any replacement or cut, as an unsigned 32-bit number; 0 is
   * sent as 1.
   */
  static long missionId(String mission) {
    var crc = new CRC32();
    crc.update(mission.getBytes(StandardCharsets.UTF_8));
    long value = crc.getValue();
    return value == 0 ? 1 : value;
  }

  /** Each character outside the basic set {@code 0x20}-{@code 0x7E} as "?", one per code point. */
  static String basic(String name) {
    var b = new StringBuilder(name.length());
    name.codePoints().forEach(c -> b.append(c >= 0x20 && c <= 0x7E ? (char) c : '?'));
    return b.toString();
  }

  private static String cut(String s, int length) {
    return s.length() <= length ? s : s.substring(0, length);
  }
}
