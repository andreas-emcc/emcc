package dev.emcc.sdk.geo;

import dev.emcc.sdk.model.Position;
import java.util.Objects;

/**
 * SDK 1.2.0: a point along a {@link GeodesicPath} ({@link GeodesicPath#at}).
 *
 * @param position where it is; it has the altitude of its leg's start
 * @param azimuth the direction of travel there, degrees clockwise from true north, 0 to below 360
 * @param leg the index of its leg: 0 for the leg from the first to the second point
 * @param fraction how far along that leg, 0 to 1
 */
public record PathPoint(Position position, double azimuth, int leg, double fraction) {

  public PathPoint {
    Objects.requireNonNull(position, "position");
    if (leg < 0 || !(fraction >= 0 && fraction <= 1)) {
      throw new IllegalArgumentException("leg must be >= 0 and fraction 0..1: " + leg + ", " + fraction);
    }
  }
}
