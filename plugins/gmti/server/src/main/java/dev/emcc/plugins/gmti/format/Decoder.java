package dev.emcc.plugins.gmti.format;

import dev.emcc.sdk.model.Position;
import java.util.ArrayList;
import java.util.List;
import org.jspecify.annotations.Nullable;

/**
 * Decodes one packet (AEDP chapter 3). Pure: no I/O, no state. Received bytes are untrusted: every
 * size is checked, and a packet whose sizes do not add up is refused as {@link Decoded#MALFORMED},
 * never with an exception that escapes (playbook, work package 1).
 *
 * <p>Rules (the reference's 3.6 and pitfalls 4, 17, 24):
 * <ul>
 *   <li><b>every version</b> ({@code P1}) is read the same way, by the existence mask alone; the
 *       standard's conditions on fields are advice for senders, not checks here;
 *   <li>a dwell's mask must name the mandatory fields, and a position form for its reports;
 *   <li>a dwell segment in a packet whose {@code P10} is 0 is malformed (AEDP 3.4);
 *   <li>a dwell's fields must fill its segment exactly; a fixed-size segment may be longer than its
 *       body (the rest is passed over), never shorter;
 *   <li>report bits mean nothing when {@code D5} is 0; spare mask bits are ignored.
 * </ul>
 */
public final class Decoder {

  /** The packet header's size. */
  public static final int HEADER = 32;
  /** A segment header's size. */
  public static final int SEGMENT_HEADER = 5;
  /** The largest packet a link takes (the brief, section 4; reference 1.2). */
  public static final int MAX_PACKET = 65_535;

  private Decoder() {}

  /** {@code P2} from a packet header's first six bytes at {@code offset}. */
  public static long packetSize(byte[] bytes, int offset) {
    return new ByteReader(bytes, offset + 2, offset + 6).u32();
  }

  /** Decodes {@code bytes}, which hold exactly one packet. */
  public static Decoded decode(byte[] bytes) {
    return decode(bytes, 0, bytes.length);
  }

  /** Decodes the {@code length} bytes at {@code offset}, which hold exactly one packet. */
  public static Decoded decode(byte[] bytes, int offset, int length) {
    if (length > MAX_PACKET) {
      return Decoded.refused(Decoded.TOO_LONG, length + " bytes");
    }
    if (length < HEADER) {
      return Decoded.refused(Decoded.MALFORMED, "shorter than a packet header");
    }
    try {
      int end = offset + length;
      ByteReader r = new ByteReader(bytes, offset, end);
      String version = r.alpha(2);
      long size = r.u32();
      if (size != length) {
        return Decoded.refused(Decoded.MALFORMED, "P2 says " + size + " bytes, the packet has " + length);
      }
      var header = new PacketHeader(version, r.alpha(2), r.u8(), r.alpha(2), r.u16(), r.u8(), r.alpha(10), r.u32(), r.u32());
      var segments = new ArrayList<Segment>();
      int[] outOfRange = {0};
      while (r.remaining() > 0) {
        if (r.remaining() < SEGMENT_HEADER) {
          return Decoded.refused(Decoded.MALFORMED, "a segment header past the packet's end");
        }
        int type = r.u8();
        long segmentSize = r.u32();
        if (segmentSize < SEGMENT_HEADER || segmentSize - SEGMENT_HEADER > r.remaining()) {
          return Decoded.refused(Decoded.MALFORMED, "segment type " + type + " of " + segmentSize + " bytes past the packet's end");
        }
        int from = r.position();
        int to = from + (int) (segmentSize - SEGMENT_HEADER);
        var body = new ByteReader(bytes, from, to);
        switch (type) {
          case Segment.MISSION -> segments.add(mission(body));
          case Segment.DWELL -> {
            if (header.jobId() == 0) {
              return Decoded.refused(Decoded.MALFORMED, "a dwell in a packet of job 0");
            }
            segments.add(dwell(body, outOfRange));
            if (body.remaining() != 0) {
              return Decoded.refused(Decoded.MALFORMED, "a dwell's mask does not fill its segment (" + body.remaining() + " bytes left)");
            }
          }
          case Segment.JOB_DEFINITION -> segments.add(jobDefinition(body));
          case Segment.PLATFORM_LOCATION -> segments.add(platformLocation(body));
          case Segment.FREE_TEXT -> segments.add(freeText(body));
          default -> segments.add(new Skipped(type, segmentSize));
        }
        r.skip(to - r.position());
      }
      return Decoded.of(new Packet(header, segments, length, outOfRange[0]));
    } catch (ByteReader.Malformed e) {
      return Decoded.refused(Decoded.MALFORMED, e.getMessage());
    }
  }

  private static Mission mission(ByteReader r) {
    fixed(r, Mission.SIZE, "mission");
    return new Mission(r.alpha(12), r.alpha(12), r.u8(), r.alpha(10), r.u16(), r.u8(), r.u8());
  }

  private static JobDefinition jobDefinition(ByteReader r) {
    fixed(r, JobDefinition.SIZE, "job definition");
    long jobId = r.u32();
    int sensorType = r.u8();
    String model = r.alpha(6);
    int filtering = r.u8();
    int priority = r.u8();
    var corners = new ArrayList<Position>(4);
    for (int i = 0; i < 4; i++) {
      double lat = Angles.fromSa32(r.s32());
      double lon = Angles.longitude(Angles.fromBa32(r.u32()));
      corners.add(Position.of(lon, lat));
    }
    return new JobDefinition(jobId, sensorType, model, filtering, priority, corners, r.u8(), r.u16(), r.u16(), r.u16(), r.u16(), r.u8(),
        r.u16(), r.u16(), Angles.fromBa16(r.u16()), r.u16(), r.u8(), r.u8(), r.u8(), r.u8(), r.u8());
  }

  private static PlatformLocation platformLocation(ByteReader r) {
    fixed(r, PlatformLocation.SIZE, "platform location");
    long time = r.u32();
    double lat = Angles.fromSa32(r.s32());
    double lon = Angles.longitude(Angles.fromBa32(r.u32()));
    double alt = r.s32() / 100.0;
    double track = Angles.fromBa16(r.u16());
    double speed = r.u32() / 1000.0;
    double vertical = r.s8() / 10.0;
    return new PlatformLocation(time, lat, lon, alt, track, speed, vertical);
  }

  private static FreeText freeText(ByteReader r) {
    String originator = r.alpha(10);
    String recipient = r.alpha(10);
    int n = r.remaining();
    String text = r.alpha(Math.min(n, FreeText.MAX_KEPT));
    r.skip(r.remaining());
    return new FreeText(originator, recipient, text);
  }

  private static void fixed(ByteReader r, int size, String what) {
    if (r.remaining() < size) {
      throw new ByteReader.Malformed("a " + what + " segment shorter than " + size + " bytes");
    }
  }

  private static Dwell dwell(ByteReader r, int[] outOfRange) {
    long mask = r.s64();
    if ((mask & Dwell.MANDATORY_MASK) != Dwell.MANDATORY_MASK) {
      throw new ByteReader.Malformed("a dwell mask without its mandatory fields");
    }
    int revisit = r.u16();
    int dwellIndex = r.u16();
    boolean last = r.u8() != 0;
    int count = r.u16();
    long time = r.u32();
    double sensorLat = Angles.fromSa32(r.s32());
    double sensorLon = Angles.longitude(Angles.fromBa32(r.u32()));
    double sensorAlt = r.s32() / 100.0;
    Double latScale = has(mask, 10) ? Angles.fromSa32(r.s32()) : null;
    Double lonScale = has(mask, 11) ? Angles.fromBa32(r.u32()) : null;
    Double alongErr = has(mask, 12) ? r.u32() / 100.0 : null;
    Double crossErr = has(mask, 13) ? r.u32() / 100.0 : null;
    Double altErr = has(mask, 14) ? r.u16() / 100.0 : null;
    Double track = has(mask, 15) ? Angles.fromBa16(r.u16()) : null;
    Double speed = has(mask, 16) ? r.u32() / 1000.0 : null;
    Double vertical = has(mask, 17) ? r.s8() / 10.0 : null;
    Integer trackErr = has(mask, 18) ? r.u8() : null;
    Double speedErr = has(mask, 19) ? r.u16() / 1000.0 : null;
    Double verticalErr = has(mask, 20) ? r.u16() / 100.0 : null;
    Double heading = has(mask, 21) ? Angles.fromBa16(r.u16()) : null;
    Double pitch = has(mask, 22) ? Angles.fromSa16(r.s16()) : null;
    Double roll = has(mask, 23) ? Angles.fromSa16(r.s16()) : null;
    double areaLat = Angles.fromSa32(r.s32());
    double areaLon = Angles.longitude(Angles.fromBa32(r.u32()));
    double range = Angles.fromB16(r.u16());
    double angle = Angles.fromBa16(r.u16());
    Double sensorHeading = has(mask, 28) ? Angles.fromBa16(r.u16()) : null;
    Double sensorPitch = has(mask, 29) ? Angles.fromSa16(r.s16()) : null;
    Double sensorRoll = has(mask, 30) ? Angles.fromSa16(r.s16()) : null;
    Double mdv = has(mask, 31) ? r.u8() / 10.0 : null;
    var reports = new ArrayList<TargetReport>(count);
    if (count > 0) {
      boolean full = hasReport(mask, 2) && hasReport(mask, 3);
      boolean reduced = hasReport(mask, 4) && hasReport(mask, 5);
      if (!full && !reduced) {
        throw new ByteReader.Malformed("a dwell with reports but no position form in its mask");
      }
      if (!full && (latScale == null || lonScale == null)) {
        throw new ByteReader.Malformed("reduced positions without the scale factors D10 and D11");
      }
      for (int i = 0; i < count; i++) {
        TargetReport report = report(r, mask, areaLat, areaLon, latScale, lonScale);
        if (report == null) {
          outOfRange[0]++;
        } else {
          reports.add(report);
        }
      }
    }
    return new Dwell(revisit, dwellIndex, last, time, sensorLat, sensorLon, sensorAlt, latScale, lonScale, alongErr, crossErr, altErr, track,
        speed, vertical, trackErr, speedErr, verticalErr, heading, pitch, roll, areaLat, areaLon, range, angle, sensorHeading, sensorPitch,
        sensorRoll, mdv, reports);
  }

  /** One report; {@code null} when its position is off the earth (a value out of range, left out). */
  private static @Nullable TargetReport report(
      ByteReader r, long mask, double areaLat, double areaLon, @Nullable Double latScale, @Nullable Double lonScale) {
    Integer index = hasReport(mask, 1) ? r.u16() : null;
    double lat = Double.NaN;
    double lon = Double.NaN;
    boolean reduced = false;
    if (hasReport(mask, 2)) {
      lat = Angles.fromSa32(r.s32());
    }
    if (hasReport(mask, 3)) {
      lon = Angles.longitude(Angles.fromBa32(r.u32()));
    }
    if (hasReport(mask, 4)) {
      short dLat = r.s16();
      if (Double.isNaN(lat) && latScale != null) {
        lat = areaLat + dLat * latScale;
        reduced = true;
      }
    }
    if (hasReport(mask, 5)) {
      short dLon = r.s16();
      if (Double.isNaN(lon) && lonScale != null) {
        lon = Angles.longitude(areaLon + dLon * lonScale);
      }
    }
    var b = TargetReport.at(lat, lon).index(index).reduced(reduced);
    b.height(hasReport(mask, 6) ? (int) r.s16() : null);
    b.radialVelocity(hasReport(mask, 7) ? r.s16() / 100.0 : null);
    b.wrapVelocity(hasReport(mask, 8) ? r.u16() / 100.0 : null);
    b.snr(hasReport(mask, 9) ? r.s8() : null);
    b.classification(hasReport(mask, 10) ? r.u8() : null);
    b.classificationProbability(hasReport(mask, 11) ? r.u8() : null);
    b.slantRangeError(hasReport(mask, 12) ? r.u16() / 100.0 : null);
    b.crossRangeError(hasReport(mask, 13) ? r.u16() / 10.0 : null);
    b.heightError(hasReport(mask, 14) ? r.u8() : null);
    b.radialVelocityError(hasReport(mask, 15) ? r.u16() / 100.0 : null);
    Integer application = hasReport(mask, 16) ? r.u8() : null;
    Long entity = hasReport(mask, 17) ? r.u32() : null;
    b.truthTag(application, entity);
    b.rcs(hasReport(mask, 18) ? r.s8() / 2.0 : null);
    if (!(lat >= -90.0 && lat <= 90.0) || Double.isNaN(lon)) {
      return null;
    }
    return b.build();
  }

  private static boolean has(long mask, int k) {
    return (mask & Dwell.bodyBit(k)) != 0;
  }

  private static boolean hasReport(long mask, int n) {
    return (mask & Dwell.reportBit(n)) != 0;
  }
}
