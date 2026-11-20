package dev.emcc.sdk.model;

import org.jspecify.annotations.Nullable;

/**
 * A WGS84 position: <b>longitude first</b>, then latitude, in decimal degrees, and an optional
 * altitude in metres above the ellipsoid (HAE). The constructor rejects values out of range, which
 * catches many swapped coordinates (a latitude above 90).
 *
 * <pre>{@code
 * Position stockholm = Position.of(18.0686, 59.3293);     // lon, lat
 * Position withAltitude = Position.of(18.1012, 59.3507, 45.2);
 * }</pre>
 *
 * @param longitude -180 to 180
 * @param latitude -90 to 90
 * @param altitude metres above the WGS84 ellipsoid, or {@code null}
 */
public record Position(double longitude, double latitude, @Nullable Double altitude) {

  public Position {
    if (!(longitude >= -180 && longitude <= 180)) {
      throw new IllegalArgumentException("longitude must be -180..180 (lon, lat order!): " + longitude);
    }
    if (!(latitude >= -90 && latitude <= 90)) {
      throw new IllegalArgumentException("latitude must be -90..90 (lon, lat order!): " + latitude);
    }
    if (altitude != null && !Double.isFinite(altitude)) {
      throw new IllegalArgumentException("altitude must be finite: " + altitude);
    }
  }

  public static Position of(double longitude, double latitude) {
    return new Position(longitude, latitude, null);
  }

  public static Position of(double longitude, double latitude, double altitude) {
    return new Position(longitude, latitude, altitude);
  }
}
