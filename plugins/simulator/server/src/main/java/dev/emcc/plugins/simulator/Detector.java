package dev.emcc.plugins.simulator;

import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.geo.GeodesicLeg;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Position;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.random.RandomGenerator;
import org.jspecify.annotations.Nullable;

/**
 * What one revisit of a sensor detects (brief function 28, A9): its dwell area round the platform,
 * the tracks in it whose radial speed reaches the minimum detectable speed, each with the
 * probability of detection, at a position moved by Gaussian errors along and across the line of
 * sight; the nearest ones up to the cap. Every track type is detected: an output decides what it
 * sends (the owner's answer to A99, 2026-11-08). Pure: the caller owns the random numbers.
 */
final class Detector {

  /** A track the sensor may see, as it is at the revisit's time. */
  record Target(UUID id, MapObjectContent content, Position position, @Nullable Double speed, @Nullable Double direction) {}

  /**
   * A detected track.
   *
   * @param distance metres from the platform to its true position
   * @param measured where the sensor reports it
   */
  record Seen(UUID id, MapObjectContent content, double distance, Position measured) {}

  /**
   * A ground radar's target, chosen at its revisit's start and measured in its dwell (A6).
   *
   * @param distance metres from the platform at the revisit's start
   * @param bearing degrees clockwise from true north at the platform, then
   */
  record Chosen(UUID id, MapObjectContent content, double distance, double bearing) {}

  /**
   * One revisit's result.
   *
   * @param nearEdge CR-0035: the area's distance from the platform at its nearest point
   * @param overCap the detections beyond "most detections per dwell", counted
   */
  record Look(Geometry area, double nearEdge, List<Seen> seen, int overCap) {}

  private Detector() {}

  /** The area's near edge (CR-0035): the min range for the band, 0 with "Detect all in range". */
  static double nearEdge(SensorSettings s) {
    return s.detectAll() ? 0 : s.minRange();
  }

  /** How many degrees the sector spans clockwise from its start: 360 for equal bearings, 0 to 360 among them (the owner's MX A). */
  static double span(SensorSettings s) {
    double span = normal(s.endBearing() - s.startBearing());
    return span == 0 ? 360 : span;
  }

  /** The dwell area: an {@code ArcBand} turned with the platform's heading, or a {@code Circle} of the max range with "Detect all in range". */
  static Geometry area(Position platform, double heading, SensorSettings s) {
    Position centre = Position.of(platform.longitude(), platform.latitude());
    if (s.detectAll()) {
      return new Geometry.Circle(centre, s.maxRange());
    }
    double start = normal(heading + s.startBearing());
    double span = span(s);
    if (span >= 360 && s.minRange() == 0) {
      return new Geometry.Circle(centre, s.maxRange());
    }
    // All round: an ArcBand with equal bearings (the brief's function 28), as map-view-2d and gmti read it.
    double end = normal(start + span);
    return new Geometry.ArcBand(centre, s.minRange(), s.maxRange(), start, end);
  }

  /**
   * A ground radar's targets at a revisit (function 37): the tracks function 28 detects in its search
   * area and, with one, its job area (function 39), not yet measured and without a cap, nearest first.
   */
  static List<Chosen> chosen(Position platform, double heading, List<Target> targets, SensorSettings s, RandomGenerator random) {
    List<Chosen> chosen = new ArrayList<>();
    double start = normal(heading + s.startBearing());
    double span = span(s);
    for (Target t : targets) {
      GeodesicLeg leg = Geodesy.inverse(platform, t.position());
      double d = leg.distanceMetres();
      if (!inside(s.jobArea(), t.position())) {
        continue;
      }
      if (s.detectAll()) {
        if (d <= s.maxRange()) {
          chosen.add(new Chosen(t.id(), t.content(), d, normal(leg.initialAzimuth())));
        }
        continue;
      }
      if (d < s.minRange() || d > s.maxRange() || normal(leg.initialAzimuth() - start) > span) {
        continue;
      }
      // The line of sight at the track: the geodesic's direction there, away from the platform.
      double lineOfSight = leg.finalAzimuth();
      double speed = t.speed() == null || t.direction() == null ? 0 : t.speed() * Math.cos(Math.toRadians(t.direction() - lineOfSight));
      if (Math.abs(speed) < s.minimumDetectableSpeed()) {
        continue;
      }
      if (!(random.nextDouble() < s.detectionProbability())) {
        continue;
      }
      chosen.add(new Chosen(t.id(), t.content(), d, normal(leg.initialAzimuth())));
    }
    chosen.sort(Comparator.comparingDouble(Chosen::distance));
    return chosen;
  }

  /**
   * One look over the whole search area, measured, the nearest up to the cap: function 28's M5 look.
   * From M6 the engine sends dwells instead ({@link Dwells}); this stays for the tests of function
   * 28's detection rules (criteria 36 to 39), which {@link #chosen} and {@link #measure} share.
   */
  static Look look(Position platform, double heading, List<Target> targets, SensorSettings s, RandomGenerator random) {
    java.util.Map<UUID, Position> at = new java.util.HashMap<>();
    targets.forEach(t -> at.put(t.id(), t.position()));
    List<Seen> seen = new ArrayList<>();
    for (Chosen c : chosen(platform, heading, targets, s, random)) {
      seen.add(new Seen(c.id(), c.content(), c.distance(), measure(platform, at.get(c.id()), s, random)));
    }
    int over = Math.max(0, seen.size() - s.maxDetections());
    List<Seen> kept = over == 0 ? seen : seen.subList(0, s.maxDetections());
    return new Look(area(platform, heading, s), nearEdge(s), List.copyOf(kept), over);
  }

  /** Where a ground radar reports a track at {@code truth}: no error with "Detect all in range" (function 28). */
  static Position measure(Position platform, Position truth, SensorSettings s, RandomGenerator random) {
    if (s.detectAll()) {
      return truth;
    }
    return measured(truth, Geodesy.inverse(platform, truth).finalAzimuth(), s, random);
  }

  /**
   * The generic sensor's look (function 38): every track within the range and, with one, the job
   * area, of any type, at any speed, with the probability; measured with the position error east and
   * north; the nearest up to the cap; a {@code Circle} of the range.
   */
  static Look generic(Position platform, List<Target> targets, SensorSettings s, RandomGenerator random) {
    List<Seen> seen = new ArrayList<>();
    for (Target t : targets) {
      double d = Geodesy.inverse(platform, t.position()).distanceMetres();
      if (d > s.range() || !inside(s.jobArea(), t.position()) || !(random.nextDouble() < s.detectionProbability())) {
        continue;
      }
      Position p = t.position();
      if (s.positionError() > 0) {
        p = Geodesy.direct(p, 90, random.nextGaussian() * s.positionError());
        p = Geodesy.direct(p, 0, random.nextGaussian() * s.positionError());
      }
      seen.add(new Seen(t.id(), t.content(), d, p));
    }
    seen.sort(Comparator.comparingDouble(Seen::distance));
    int over = Math.max(0, seen.size() - s.maxDetections());
    List<Seen> kept = over == 0 ? seen : seen.subList(0, s.maxDetections());
    Position centre = Position.of(platform.longitude(), platform.latitude());
    return new Look(new Geometry.Circle(centre, s.range()), 0, List.copyOf(kept), over);
  }

  /** Whether {@code p} lies inside the job area (function 39), or there is none: the ring in longitude and latitude, by ray casting. */
  static boolean inside(Geometry.@Nullable Polygon area, Position p) {
    if (area == null) {
      return true;
    }
    List<Position> ring = area.rings().getFirst();
    boolean in = false;
    double x = p.longitude();
    double y = p.latitude();
    for (int i = 0, j = ring.size() - 1; i < ring.size(); j = i++) {
      double xi = ring.get(i).longitude();
      double yi = ring.get(i).latitude();
      double xj = ring.get(j).longitude();
      double yj = ring.get(j).latitude();
      if ((yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
        in = !in;
      }
    }
    return in;
  }

  /** The true position moved by the range error along the line of sight and the cross-range error across it; an error of 0 is none. */
  private static Position measured(Position truth, double lineOfSight, SensorSettings s, RandomGenerator random) {
    Position p = truth;
    if (s.rangeError() > 0) {
      p = Geodesy.direct(p, lineOfSight, random.nextGaussian() * s.rangeError());
    }
    if (s.crossRangeError() > 0) {
      p = Geodesy.direct(p, normal(lineOfSight + 90), random.nextGaussian() * s.crossRangeError());
    }
    return p; // Geodesy.direct keeps the altitude
  }

  /** Degrees in [0, 360). */
  static double normal(double degrees) {
    double d = degrees % 360;
    if (d < 0) {
      d += 360;
    }
    return d >= 360 ? 0 : d;
  }
}
