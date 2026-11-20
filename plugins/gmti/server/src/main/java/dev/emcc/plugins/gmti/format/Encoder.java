package dev.emcc.plugins.gmti.format;

import dev.emcc.sdk.model.Position;
import java.util.List;
import org.jspecify.annotations.Nullable;

/**
 * Encodes packets (AEDP chapter 3), the inverse of {@link Decoder}. Pure. Values are rounded to their
 * field's resolution and limited to its range; longitudes may be given −180 to 180 or 0 to 360.
 *
 * <p>The existence mask of a dwell follows the fields it has; its reports must all have the same
 * fields (a sender with mixed reports splits them into segments of the same indices, AEDP 3.4.32).
 * An empty dwell sets no report bits.
 */
public final class Encoder {

  private Encoder() {}

  /** One packet: the header, with {@code P2} counted, and the segments in their order. */
  public static byte[] packet(PacketHeader h, List<? extends Segment> segments) {
    var w = new ByteWriter();
    w.alpha(h.version(), 2);
    w.u32(0); // P2, written at the end
    w.alpha(h.nationality(), 2).u8(h.classification()).alpha(h.classificationSystem(), 2).u16(h.securityCode()).u8(h.exercise());
    w.alpha(h.platformId(), 10).u32(h.missionId()).u32(h.jobId());
    for (Segment s : segments) {
      segment(w, s);
    }
    w.putU32(2, w.size());
    return w.toBytes();
  }

  /** The bytes {@code segment} takes in a packet, its 5-byte header included. */
  public static int size(Segment segment) {
    var w = new ByteWriter();
    segment(w, segment);
    return w.size();
  }

  private static void segment(ByteWriter w, Segment s) {
    int start = w.size();
    w.u8(s.type()).u32(0);
    switch (s) {
      case Mission m -> mission(w, m);
      case Dwell d -> dwell(w, d);
      case JobDefinition j -> jobDefinition(w, j);
      case PlatformLocation l -> platformLocation(w, l);
      case FreeText f -> w.alpha(f.originator(), 10).alpha(f.recipient(), 10).alpha(f.text(), Math.max(1, f.text().length()));
      case Skipped k -> w.zeros((int) Math.max(0, k.size() - Decoder.SEGMENT_HEADER));
    }
    w.putU32(start + 1, w.size() - start);
  }

  private static void mission(ByteWriter w, Mission m) {
    w.alpha(m.missionPlan(), 12).alpha(m.flightPlan(), 12).u8(m.platformType()).alpha(m.platformConfiguration(), 10);
    w.u16(m.year()).u8(m.month()).u8(m.day());
  }

  private static void jobDefinition(ByteWriter w, JobDefinition j) {
    w.u32(j.jobId()).u8(j.sensorType()).alpha(j.sensorModel(), 6).u8(j.filtering()).u8(j.priority());
    for (Position p : j.boundingArea()) {
      w.u32(Angles.toSa32(p.latitude())).u32(Angles.toBa32(p.longitude()));
    }
    w.u8(j.radarMode()).u16(j.revisitInterval()).u16(j.alongTrackError()).u16(j.crossTrackError()).u16(j.altitudeError());
    w.u8(j.trackError()).u16(j.speedError()).u16(j.slantRangeError()).u16(Angles.toBa16(j.crossRangeError()));
    w.u16(j.radialVelocityError()).u8(j.minimumDetectableVelocity()).u8(j.detectionProbability()).u8(j.falseAlarmDensity());
    w.u8(j.terrainModel()).u8(j.geoidModel());
  }

  private static void platformLocation(ByteWriter w, PlatformLocation l) {
    w.u32(l.time()).u32(Angles.toSa32(l.latitude())).u32(Angles.toBa32(l.longitude())).u32(s32(l.altitude() * 100));
    w.u16(Angles.toBa16(l.track())).u32(u32(l.speed() * 1000)).u8(s8(l.verticalVelocity() * 10));
  }

  private static void dwell(ByteWriter w, Dwell d) {
    long reportMask = 0;
    if (!d.reports().isEmpty()) {
      reportMask = d.reports().getFirst().maskBits();
      for (TargetReport r : d.reports()) {
        if (r.maskBits() != reportMask) {
          throw new IllegalArgumentException("the reports of one dwell segment must have the same fields");
        }
        if (r.reduced() && (d.latitudeScale() == null || d.longitudeScale() == null)) {
          throw new IllegalArgumentException("reduced positions need the scale factors D10 and D11");
        }
      }
    }
    w.s64(d.bodyMask() | reportMask);
    w.u16(d.revisitIndex()).u16(d.dwellIndex()).u8(d.lastDwell() ? 1 : 0).u16(d.reports().size()).u32(d.time());
    w.u32(Angles.toSa32(d.sensorLatitude())).u32(Angles.toBa32(d.sensorLongitude())).u32(s32(d.sensorAltitude() * 100));
    if (d.latitudeScale() != null) {
      w.u32(Angles.toSa32(d.latitudeScale()));
    }
    if (d.longitudeScale() != null) {
      w.u32(Angles.toBa32(d.longitudeScale()));
    }
    optU32(w, d.alongTrackError(), 100);
    optU32(w, d.crossTrackError(), 100);
    optU16(w, d.altitudeError(), 100);
    if (d.sensorTrack() != null) {
      w.u16(Angles.toBa16(d.sensorTrack()));
    }
    optU32(w, d.sensorSpeed(), 1000);
    if (d.sensorVerticalVelocity() != null) {
      w.u8(s8(d.sensorVerticalVelocity() * 10));
    }
    if (d.trackError() != null) {
      w.u8(clamp(d.trackError(), 0, 255));
    }
    optU16(w, d.speedError(), 1000);
    optU16(w, d.verticalVelocityError(), 100);
    if (d.platformHeading() != null) {
      w.u16(Angles.toBa16(d.platformHeading()));
    }
    if (d.platformPitch() != null) {
      w.u16(Angles.toSa16(d.platformPitch()));
    }
    if (d.platformRoll() != null) {
      w.u16(Angles.toSa16(d.platformRoll()));
    }
    w.u32(Angles.toSa32(d.areaLatitude())).u32(Angles.toBa32(d.areaLongitude()));
    w.u16(Angles.toB16(d.rangeHalfExtent())).u16(Angles.toBa16(d.angleHalfExtent()));
    if (d.sensorHeading() != null) {
      w.u16(Angles.toBa16(d.sensorHeading()));
    }
    if (d.sensorPitch() != null) {
      w.u16(Angles.toSa16(d.sensorPitch()));
    }
    if (d.sensorRoll() != null) {
      w.u16(Angles.toSa16(d.sensorRoll()));
    }
    if (d.minimumDetectableVelocity() != null) {
      w.u8(clamp(Math.round(d.minimumDetectableVelocity() * 10), 0, 255));
    }
    for (TargetReport r : d.reports()) {
      report(w, d, r);
    }
  }

  private static void report(ByteWriter w, Dwell d, TargetReport r) {
    if (r.index() != null) {
      w.u16(clamp(r.index(), 0, 65_535));
    }
    if (r.reduced()) {
      w.u16(s16((r.latitude() - d.areaLatitude()) / d.latitudeScale()));
      w.u16(s16(signedDegrees(r.longitude() - d.areaLongitude()) / d.longitudeScale()));
      // (the delta is in −180..180, so a dwell across the prime meridian keeps small deltas: Guide E.7)
    } else {
      w.u32(Angles.toSa32(r.latitude())).u32(Angles.toBa32(r.longitude()));
    }
    if (r.height() != null) {
      w.u16(s16(r.height()));
    }
    if (r.radialVelocity() != null) {
      w.u16(s16(r.radialVelocity() * 100));
    }
    optU16(w, r.wrapVelocity(), 100);
    if (r.snr() != null) {
      w.u8(s8(r.snr()));
    }
    if (r.classification() != null) {
      w.u8(clamp(r.classification(), 0, 255));
    }
    if (r.classificationProbability() != null) {
      w.u8(clamp(r.classificationProbability(), 0, 255));
    }
    optU16(w, r.slantRangeError(), 100);
    optU16(w, r.crossRangeError(), 10);
    if (r.heightError() != null) {
      w.u8(clamp(r.heightError(), 0, 255));
    }
    optU16(w, r.radialVelocityError(), 100);
    if (r.truthApplication() != null) {
      w.u8(clamp(r.truthApplication(), 0, 255));
    }
    if (r.truthEntity() != null) {
      w.u32(r.truthEntity());
    }
    if (r.rcs() != null) {
      w.u8(s8(r.rcs() * 2));
    }
  }

  /** A difference of longitudes brought into −180 to 180, so that a dwell across the prime meridian or 180° encodes small deltas. */
  private static double signedDegrees(double d) {
    double a = Angles.normalise360(d);
    return a >= 180.0 ? a - 360.0 : a;
  }

  private static void optU32(ByteWriter w, @Nullable Double v, double factor) {
    if (v != null) {
      w.u32(u32(v * factor));
    }
  }

  private static void optU16(ByteWriter w, @Nullable Double v, double factor) {
    if (v != null) {
      w.u16(clamp(Math.round(v * factor), 0, 65_535));
    }
  }

  private static int clamp(long v, long min, long max) {
    return (int) Math.max(min, Math.min(max, v));
  }

  private static int s8(double v) {
    return clamp(Math.round(v), Byte.MIN_VALUE, Byte.MAX_VALUE);
  }

  private static int s16(double v) {
    return clamp(Math.round(v), Short.MIN_VALUE, Short.MAX_VALUE);
  }

  private static int s32(double v) {
    return clamp(Math.round(v), Integer.MIN_VALUE, Integer.MAX_VALUE);
  }

  private static long u32(double v) {
    return Math.max(0, Math.min(0xFFFF_FFFFL, Math.round(v)));
  }
}
