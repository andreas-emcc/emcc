package dev.emcc.plugins.gmti.in;

import dev.emcc.plugins.gmti.format.Angles;
import dev.emcc.plugins.gmti.format.Dwell;
import dev.emcc.sdk.geo.GeodesicLeg;
import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Position;
import org.jspecify.annotations.Nullable;

/**
 * A dwell's area as emc2's shape (reference 4.1 and 4.2; brief section 3): an {@code ArcBand}
 * centred on the sensor, between the range half extent either side of the area's centre and the
 * dwell angle half extent either side of the bearing to it.
 */
public final class AreaShape {

  /** A centre closer to the sensor than this has no bearing: the area is a circle round the sensor. */
  private static final double NO_BEARING_METRES = 1.0;

  private AreaShape() {}

  /**
   * The shape, or {@code null} while {@code D26} or {@code D27} is 0 (A4: the area is hidden).
   * {@code D27} of 180° or more, or a centre on the sensor, is a {@code Circle} of the outer radius.
   */
  public static @Nullable Geometry of(Dwell d) {
    if (!(d.rangeHalfExtent() > 0) || !(d.angleHalfExtent() > 0)) {
      return null;
    }
    Position sensor = Position.of(d.sensorLongitude(), d.sensorLatitude());
    Position centre = Position.of(d.areaLongitude(), d.areaLatitude());
    GeodesicLeg leg = Geodesy.inverse(sensor, centre);
    double half = d.rangeHalfExtent() * 1_000.0;
    double outer = leg.distanceMetres() + half;
    if (d.angleHalfExtent() >= 180.0 || leg.distanceMetres() < NO_BEARING_METRES) {
      return new Geometry.Circle(sensor, outer);
    }
    double inner = Math.max(0.0, leg.distanceMetres() - half);
    double bearing = leg.initialAzimuth();
    return new Geometry.ArcBand(
        sensor, inner, outer, Angles.normalise360(bearing - d.angleHalfExtent()), Angles.normalise360(bearing + d.angleHalfExtent()));
  }
}
