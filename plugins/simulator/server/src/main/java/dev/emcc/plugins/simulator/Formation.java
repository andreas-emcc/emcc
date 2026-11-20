package dev.emcc.plugins.simulator;

import dev.emcc.plugins.simulator.RouteDefinition.Member;
import dev.emcc.sdk.geo.GeodesicLeg;
import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.model.Position;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * A formation's geometry (brief function 12, Q16, A13; open question 14): its centre is the mean of
 * the objects' positions and altitudes when they are assigned, and each object's offset from it is
 * recorded forward, sideways and in altitude, relative to the direction of the route's first leg.
 * While it runs, the shape turns with the direction of travel.
 */
final class Formation {

  /** An object as it is when assigned. */
  record Placed(UUID id, Position position) {}

  /**
   * The members and the centre's altitude of a formation of {@code objects}, for a route whose first
   * leg leaves in {@code firstAzimuth} degrees.
   */
  record Shape(List<Member> members, @Nullable Double altitude) {}

  private Formation() {}

  static Shape of(List<Placed> objects, double firstAzimuth) {
    Position centre = centre(objects.stream().map(Placed::position).toList());
    Double altitude = meanAltitude(objects.stream().map(Placed::position).toList());
    List<Member> members = new ArrayList<>();
    for (Placed p : objects) {
      GeodesicLeg leg = Geodesy.inverse(centre, p.position());
      double angle = Math.toRadians(leg.initialAzimuth() - firstAzimuth);
      double distance = leg.distanceMetres();
      double forward = distance < RoutePlan.SAME_PLACE ? 0 : distance * Math.cos(angle);
      double right = distance < RoutePlan.SAME_PLACE ? 0 : distance * Math.sin(angle);
      Double own = p.position().altitude();
      double up = own != null && altitude != null ? own - altitude : 0;
      members.add(new Member(p.id(), round(forward), round(right), round(up)));
    }
    return new Shape(members, altitude);
  }

  /** Where a member is when the centre is at {@code centre}, travelling in {@code azimuth} degrees. */
  static Position place(Position centre, double azimuth, Member member) {
    Position p = centre;
    if (member.forward() != 0) {
      p = Geodesy.direct(p, member.forward() > 0 ? azimuth : azimuth + 180, Math.abs(member.forward()));
    }
    if (member.right() != 0) {
      p = Geodesy.direct(p, member.right() > 0 ? azimuth + 90 : azimuth - 90, Math.abs(member.right()));
    }
    return Position.of(p.longitude(), p.latitude());
  }

  /** The mean of positions on the sphere, through their unit vectors, so it holds across the antimeridian. */
  static Position centre(List<Position> positions) {
    double x = 0;
    double y = 0;
    double z = 0;
    for (Position p : positions) {
      double lat = Math.toRadians(p.latitude());
      double lon = Math.toRadians(p.longitude());
      x += Math.cos(lat) * Math.cos(lon);
      y += Math.cos(lat) * Math.sin(lon);
      z += Math.sin(lat);
    }
    double longitude = Math.toDegrees(Math.atan2(y, x));
    double latitude = Math.toDegrees(Math.atan2(z, Math.hypot(x, y)));
    return Position.of(longitude, latitude);
  }

  private static @Nullable Double meanAltitude(List<Position> positions) {
    double sum = 0;
    int n = 0;
    for (Position p : positions) {
      Double a = p.altitude();
      if (a != null) {
        sum += a;
        n++;
      }
    }
    return n == 0 ? null : round(sum / n);
  }

  /** Offsets kept to the centimetre, so the route's list stays short. */
  private static double round(double metres) {
    return Math.round(metres * 100) / 100.0;
  }
}
