package dev.emcc.sdk.geo;

import dev.emcc.sdk.model.Position;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import net.sf.geographiclib.Geodesic;
import net.sf.geographiclib.GeodesicData;
import net.sf.geographiclib.GeodesicLine;

/**
 * SDK 1.2.0: geodesics on the WGS84 ellipsoid (CR-0025 part 7), as the data model's edges are
 * (model rule 10, ADR-0019). Positions are longitude, latitude (ADR-0007); altitudes are passed
 * through and not used. Azimuths are degrees clockwise from true north, 0 to below 360. Pure
 * functions without state, for any worker and for compute workers.
 *
 * <p>It is built on GeographicLib-Java (Charles Karney's algorithms, accurate to nanometres), which
 * stays behind these types: a plugin uses only {@code Geodesy}, {@link GeodesicLeg}, {@link
 * GeodesicPath} and {@link PathPoint}, never the library ({@code PluginRules}).
 *
 * <pre>{@code
 * GeodesicLeg leg = Geodesy.inverse(from, to);                 // distanceMetres, initialAzimuth, finalAzimuth
 * Position p = Geodesy.direct(from, 45, 10_000);               // 10 km north-east of from
 * GeodesicPath route = Geodesy.path(waypoints);                // lengthMetres(), legLengths()
 * PathPoint now = route.at(speedMetresPerSecond * elapsedSeconds);
 * }</pre>
 */
public final class Geodesy {

  private static final Geodesic WGS84 = Geodesic.WGS84;

  private Geodesy() {}

  /**
   * The geodesic from {@code from} to {@code to}: its length and its azimuths at both ends. For two
   * equal positions the length is 0 and the azimuths are GeographicLib's convention (180).
   */
  public static GeodesicLeg inverse(Position from, Position to) {
    Objects.requireNonNull(from, "from");
    Objects.requireNonNull(to, "to");
    GeodesicData g = WGS84.Inverse(from.latitude(), from.longitude(), to.latitude(), to.longitude());
    return new GeodesicLeg(g.s12, azimuth(g.azi1), azimuth(g.azi2));
  }

  /**
   * The position {@code distanceMetres} from {@code from} along the geodesic that leaves it at
   * {@code azimuthDegrees}. It keeps {@code from}'s altitude.
   *
   * @throws IllegalArgumentException if the azimuth or the distance is not finite
   */
  public static Position direct(Position from, double azimuthDegrees, double distanceMetres) {
    Objects.requireNonNull(from, "from");
    if (!Double.isFinite(azimuthDegrees) || !Double.isFinite(distanceMetres)) {
      throw new IllegalArgumentException("azimuth and distance must be finite: " + azimuthDegrees + ", " + distanceMetres);
    }
    GeodesicData g = WGS84.Direct(from.latitude(), from.longitude(), azimuthDegrees, distanceMetres);
    return position(g, from);
  }

  /**
   * A path along {@code points}, each leg the geodesic between two points in a row, as a line's
   * edges are (model rule 10).
   *
   * @throws IllegalArgumentException with fewer than two points
   */
  public static GeodesicPath path(List<Position> points) {
    List<Position> copy = List.copyOf(Objects.requireNonNull(points, "points"));
    if (copy.size() < 2) {
      throw new IllegalArgumentException("a path needs at least two points: " + copy.size());
    }
    var lines = new ArrayList<GeodesicLine>(copy.size() - 1);
    var lengths = new ArrayList<Double>(copy.size() - 1);
    for (int i = 0; i + 1 < copy.size(); i++) {
      Position a = copy.get(i);
      Position b = copy.get(i + 1);
      GeodesicLine line = WGS84.InverseLine(a.latitude(), a.longitude(), b.latitude(), b.longitude());
      lines.add(line);
      lengths.add(line.Distance());
    }
    List<GeodesicLine> legs = List.copyOf(lines);
    return new GeodesicPath(copy, List.copyOf(lengths), (leg, metres) -> {
      GeodesicData g = legs.get(leg).Position(metres);
      return new PathPoint(position(g, copy.get(leg)), azimuth(g.azi2), leg, 0);
    });
  }

  /** {@code degrees} as 0 to below 360. */
  static double azimuth(double degrees) {
    double a = degrees % 360;
    if (a < 0) {
      a += 360;
    }
    return a >= 360 ? 0 : a + 0.0; // + 0.0 turns -0.0 into 0.0
  }

  private static Position position(GeodesicData g, Position altitudeOf) {
    double lon = g.lon2 > 180 ? g.lon2 - 360 : g.lon2 < -180 ? g.lon2 + 360 : g.lon2;
    double lat = Math.max(-90, Math.min(90, g.lat2));
    return new Position(lon, lat, altitudeOf.altitude());
  }
}
