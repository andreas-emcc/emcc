package dev.emcc.plugins.cot.codec;

import java.time.Instant;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * A CoT event as read from, or written to, XML (TAK protocol version 0): the parts the plugin maps
 * to core fields, and everything it keeps unchanged for the way back. Immutable, so it can travel
 * in a message.
 *
 * <pre>{@code
 * <event version="2.0" uid="ANDROID-1" type="a-f-G-U-C-I" how="m-g" time=… start=… stale=…>
 *   <point lat="59.3507" lon="18.1012" hae="45.2" ce="9999999.0" le="9999999.0"/>
 *   <detail><contact callsign="VIPER 2"/><track course="270" speed="4.2"/></detail>
 * </event>
 * }</pre>
 *
 * @param uid the event's uid, globally unique by CoT's design; 1 to 512 characters
 * @param type the CoT type, e.g. {@code a-f-G-U-C-I}
 * @param how how the position was obtained, e.g. {@code m-g}
 * @param version the CoT version, usually {@code 2.0}
 * @param time when the event was generated (the observation time), or {@code null}
 * @param start from when it is valid, or {@code null}
 * @param stale when it becomes stale, or {@code null}
 * @param access the {@code access} attribute, kept unchanged
 * @param qos the {@code qos} attribute, kept unchanged
 * @param opex the {@code opex} attribute, kept unchanged
 * @param caveat the {@code caveat} attribute, kept unchanged
 * @param releasableTo the {@code releasableTo} attribute, kept unchanged
 * @param lat latitude, -90 to 90, WGS84
 * @param lon longitude, -180 to 180, WGS84
 * @param hae height above the ellipsoid in metres, or {@code null}; CoT's {@code 9999999.0} means unknown
 * @param ce circular error, as written, or {@code null}
 * @param le linear error, as written, or {@code null}
 * @param callsign {@code detail/contact/@callsign}, or {@code null}
 * @param remarks the trimmed text of {@code detail/remarks}, or {@code null}
 * @param course {@code detail/track/@course}, degrees from true north, or {@code null}
 * @param speed {@code detail/track/@speed}, metres per second, or {@code null}
 * @param detail the whole content of {@code <detail>} as XML text, exactly as received, or {@code null}
 * @param group {@code detail/__group}: the team and role, each only if one of TAK's own values, or {@code null}
 */
public record CotEvent(
    String uid,
    String type,
    @Nullable String how,
    @Nullable String version,
    @Nullable Instant time,
    @Nullable Instant start,
    @Nullable Instant stale,
    @Nullable String access,
    @Nullable String qos,
    @Nullable String opex,
    @Nullable String caveat,
    @Nullable String releasableTo,
    double lat,
    double lon,
    @Nullable Double hae,
    @Nullable String ce,
    @Nullable String le,
    @Nullable String callsign,
    @Nullable String remarks,
    @Nullable Double course,
    @Nullable Double speed,
    @Nullable String detail,
    @Nullable CotGroup group) {

  /** The value CoT uses for an unknown height, error, course or speed. */
  public static final double UNKNOWN = 9999999.0;

  public CotEvent {
    Objects.requireNonNull(uid, "uid");
    Objects.requireNonNull(type, "type");
    if (uid.isEmpty() || uid.length() > 512) {
      throw new IllegalArgumentException("uid must be 1..512 characters");
    }
    if (type.isEmpty() || type.length() > 128) {
      throw new IllegalArgumentException("type must be 1..128 characters");
    }
    if (!(lat >= -90 && lat <= 90)) {
      throw new IllegalArgumentException("latitude must be -90..90: " + lat);
    }
    if (!(lon >= -180 && lon <= 180)) {
      throw new IllegalArgumentException("longitude must be -180..180: " + lon);
    }
    if (hae != null && !Double.isFinite(hae)) {
      throw new IllegalArgumentException("hae must be finite: " + hae);
    }
    if (course != null && !Double.isFinite(course)) {
      throw new IllegalArgumentException("course must be finite: " + course);
    }
    if (speed != null && !Double.isFinite(speed)) {
      throw new IllegalArgumentException("speed must be finite: " + speed);
    }
  }

  /** The same event with other times. */
  public CotEvent withTimes(@Nullable Instant newTime, @Nullable Instant newStart, @Nullable Instant newStale) {
    return new CotEvent(uid, type, how, version, newTime, newStart, newStale, access, qos, opex, caveat, releasableTo, lat, lon, hae, ce, le,
        callsign, remarks, course, speed, detail, group);
  }

  /** The same event with another detail text. */
  public CotEvent withDetail(@Nullable String newDetail) {
    return new CotEvent(uid, type, how, version, time, start, stale, access, qos, opex, caveat, releasableTo, lat, lon, hae, ce, le,
        callsign, remarks, course, speed, newDetail, group);
  }

  /** An atom: a unit, equipment or installation with a symbol ({@code a-…}). */
  public boolean isAtom() {
    return type.startsWith("a-");
  }

  /** A map point such as a waypoint or a spot ({@code b-m-p-…}). */
  public boolean isMapPoint() {
    return type.equals("b-m-p") || type.startsWith("b-m-p-");
  }

  /** Whether the plugin shows this event on the map: atoms and map points. Everything else is counted and dropped. */
  public boolean isShown() {
    return isAtom() || isMapPoint();
  }
}
