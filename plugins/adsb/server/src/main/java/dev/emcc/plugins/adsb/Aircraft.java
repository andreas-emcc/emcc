package dev.emcc.plugins.adsb;

import org.jspecify.annotations.Nullable;

/**
 * What a link knows of one aircraft: the values of its last lines, merged. A value a line does not
 * carry keeps the value of an earlier line. Records compare by value, so two states that say the
 * same are equal (a line that changes nothing sends nothing).
 *
 * @param icao24 the ICAO 24-bit address, six upper-case hex digits
 * @param callsign the callsign, or {@code null}
 * @param altitudeFt barometric altitude in feet, or {@code null}
 * @param groundSpeedKt ground speed in knots, or {@code null}
 * @param trackDegrees track in degrees, or {@code null}
 * @param verticalRateFpm vertical rate in feet per minute, or {@code null}
 * @param squawk the squawk code, or {@code null}
 * @param emergency the emergency flag, or {@code null} when unknown
 * @param onGround the on-ground flag, or {@code null} when unknown
 * @param latitude WGS84 latitude, or {@code null} before a position
 * @param longitude WGS84 longitude, or {@code null} before a position
 */
public record Aircraft(
    String icao24,
    @Nullable String callsign,
    @Nullable Integer altitudeFt,
    @Nullable Double groundSpeedKt,
    @Nullable Double trackDegrees,
    @Nullable Integer verticalRateFpm,
    @Nullable String squawk,
    @Nullable Boolean emergency,
    @Nullable Boolean onGround,
    @Nullable Double latitude,
    @Nullable Double longitude) {

  /** A state with nothing but its address. */
  static Aircraft unknown(String icao24) {
    return new Aircraft(icao24, null, null, null, null, null, null, null, null, null, null);
  }

  /** Whether the aircraft has a position, so that it can be shown. */
  public boolean hasPosition() {
    return latitude != null && longitude != null;
  }

  /** This state with the values {@code message} carries; the others are kept. */
  Aircraft merge(Sbs1.Message message) {
    return new Aircraft(
        icao24,
        message.callsign() != null ? message.callsign() : callsign,
        message.altitudeFt() != null ? message.altitudeFt() : altitudeFt,
        message.groundSpeedKt() != null ? message.groundSpeedKt() : groundSpeedKt,
        message.trackDegrees() != null ? message.trackDegrees() : trackDegrees,
        message.verticalRateFpm() != null ? message.verticalRateFpm() : verticalRateFpm,
        message.squawk() != null ? message.squawk() : squawk,
        message.emergency() != null ? message.emergency() : emergency,
        message.onGround() != null ? message.onGround() : onGround,
        message.latitude() != null ? message.latitude() : latitude,
        message.longitude() != null ? message.longitude() : longitude);
  }
}
