package dev.emcc.plugins.simulator;

import dev.emcc.plugins.simulator.RouteDefinition.Kind;
import dev.emcc.plugins.simulator.RouteDefinition.TypedTime;
import dev.emcc.sdk.geo.GeodesicPath;
import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.geo.PathPoint;
import dev.emcc.sdk.model.Position;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.jspecify.annotations.Nullable;

/**
 * What the server part computes from a route's line and its definition (brief functions 5 and 6):
 * the legs' lengths, each point's speed and arrival time, and where an object is at any time since
 * it left the first point. The route keeps only what users typed; this is never written back (S1).
 *
 * <p><b>Speeds</b> (ADR-0040 point 5, Q11): a point's speed holds from that point on ("instant", a
 * step at the point), or is reached at that point with a constant acceleration over the leg into it
 * ("ramp"). A ramp on the first point acts as instant. So a leg runs at its start point's speed,
 * unless its end point is a ramp.
 *
 * <p><b>Typed times</b> (Q12, Q13, A11; the owner's Q2 of 2026-10-26): a time typed at a point is
 * the time it is reached. At a ramp point it sets that point's speed (a leg's mean speed is the mean
 * of its two ends). At an instant point it sets the speed of the leg into it, which is the previous
 * point's speed; a previous point whose speed its own time already sets is a problem. A last point
 * that is a step needs no speed of its own, since the route stops there. A computed
 * speed is rounded to a whole unit of the unit the time was typed in.
 *
 * <p><b>Altitudes</b>: a point's altitude applies from that point on (a step at the point), or is
 * reached at the point in proportion to the distance over the leg into it (ramp). An empty altitude
 * means the object keeps its own (open question 7).
 *
 * <p>Immutable, so it may be shared with a compute worker.
 */
final class RoutePlan {

  /** Legs shorter than this are treated as no leg: they take no time. */
  static final double SAME_PLACE = 0.01;

  /** How a point's speed was found. */
  enum SpeedSource {
    TYPED,
    OWN_TIME,
    NEXT_TIME
  }

  /**
   * Where an object is.
   *
   * @param altitude metres above the ellipsoid, or null: the object keeps its own
   * @param azimuth the direction of travel, degrees from true north, 0 to below 360
   * @param speed m/s; 0 once ended
   * @param leg the leg it is on: 0 from the first to the second point
   * @param fraction how far along that leg, 0 to 1
   * @param distance metres along the route from the first point
   * @param ended whether it has reached the last point
   */
  record Motion(Position position, @Nullable Double altitude, double azimuth, double speed, int leg, double fraction, double distance, boolean ended) {}

  private final @Nullable GeodesicPath path;
  private final double[] legs;
  private final double[] cumulative;
  private final double[] speeds;
  private final double[] arrivals;
  private final SpeedSource[] sources;
  private final Kind[] speedKinds;
  private final Kind[] altitudeKinds;
  private final @Nullable Double[] altitudes;
  private final List<Problem> problems;

  private RoutePlan(
      @Nullable GeodesicPath path, double[] legs, double[] cumulative, double[] speeds, double[] arrivals, SpeedSource[] sources,
      Kind[] speedKinds, Kind[] altitudeKinds, @Nullable Double[] altitudes, List<Problem> problems) {
    this.path = path;
    this.legs = legs;
    this.cumulative = cumulative;
    this.speeds = speeds;
    this.arrivals = arrivals;
    this.sources = sources;
    this.speedKinds = speedKinds;
    this.altitudeKinds = altitudeKinds;
    this.altitudes = altitudes;
    this.problems = List.copyOf(problems);
  }

  /** Computes the plan of a route through {@code points} (longitude, latitude) with the values of {@code definition}. */
  static RoutePlan of(List<Position> points, RouteDefinition definition) {
    int n = points.size();
    GeodesicPath path = Geodesy.path(points);
    double[] legs = path.legLengths().stream().mapToDouble(Double::doubleValue).toArray();
    double[] cumulative = new double[n];
    for (int i = 1; i < n; i++) {
      cumulative[i] = cumulative[i - 1] + legs[i - 1];
    }
    double[] speeds = new double[n];
    double[] arrivals = new double[n];
    Arrays.fill(speeds, Double.NaN);
    Arrays.fill(arrivals, Double.NaN);
    SpeedSource[] sources = new SpeedSource[n];
    Arrays.fill(sources, SpeedSource.TYPED);
    Kind[] speedKinds = new Kind[n];
    Kind[] altitudeKinds = new Kind[n];
    Double[] altitudes = new Double[n];
    Arrays.fill(speedKinds, Kind.INSTANT);
    Arrays.fill(altitudeKinds, Kind.INSTANT);
    if (definition.points().size() != n) {
      // RouteDefinition.parse reported it; nothing can be computed.
      return new RoutePlan(path, legs, cumulative, speeds, arrivals, sources, speedKinds, altitudeKinds, altitudes, List.of());
    }
    for (int i = 0; i < n; i++) {
      RouteDefinition.Point p = definition.points().get(i);
      speedKinds[i] = i == 0 ? Kind.INSTANT : p.speedKind();
      altitudeKinds[i] = i == 0 ? Kind.INSTANT : p.altitudeKind();
      altitudes[i] = p.altitude();
    }
    var computation = new Computation(definition.points(), legs, speedKinds, speeds, arrivals, sources);
    computation.run();
    List<Problem> problems = computation.problems;
    for (int i = 1; i < n; i++) {
      if (altitudeKinds[i] == Kind.RAMP && (altitudes[i - 1] == null || altitudes[i] == null)) {
        problems.add(Problem.at(i, "an altitude ramp needs altitudes at both ends of the leg"));
      }
    }
    problems.sort(java.util.Comparator.comparingInt(Problem::point));
    return new RoutePlan(path, legs, cumulative, speeds, arrivals, sources, speedKinds, altitudeKinds, altitudes, problems);
  }

  /** The values of one route, resolved point by point; collects what is wrong. */
  private static final class Computation {
    private final List<RouteDefinition.Point> points;
    private final double[] legs;
    private final Kind[] kinds;
    private final double[] speeds;
    private final double[] arrivals;
    private final SpeedSource[] sources;
    private final boolean[] byNextTime;
    private final boolean[] byOwnTime;
    private final List<Problem> problems = new ArrayList<>();

    Computation(List<RouteDefinition.Point> points, double[] legs, Kind[] kinds, double[] speeds, double[] arrivals, SpeedSource[] sources) {
      this.points = points;
      this.legs = legs;
      this.kinds = kinds;
      this.speeds = speeds;
      this.arrivals = arrivals;
      this.sources = sources;
      this.byNextTime = new boolean[points.size()];
      this.byOwnTime = new boolean[points.size()];
    }

    void run() {
      int n = points.size();
      if (points.getFirst().time() != null) {
        problems.add(Problem.at(0, "the first point is the route's start and has no time"));
      }
      for (int i = 1; i < n; i++) {
        if (points.get(i).time() != null) {
          if (kinds[i] == Kind.INSTANT) {
            byNextTime[i - 1] = true;
          } else {
            byOwnTime[i] = true;
          }
        }
      }
      for (int i = 0; i < n; i++) {
        if (byNextTime[i] && byOwnTime[i]) {
          problems.add(Problem.at(i + 1, "this time would set the previous point's speed, which that point's own time already sets"));
        } else if (!byNextTime[i] && !byOwnTime[i] && points.get(i).speed() == null && !(i == n - 1 && kinds[i] == Kind.INSTANT)) {
          // The last point's own speed is never run when it is a step: the route stops there.
          problems.add(Problem.at(i, "the point has no speed"));
        }
      }
      if (!problems.isEmpty()) {
        return;
      }
      arrivals[0] = 0;
      for (int i = 0; i < n; i++) {
        if (i > 0 && kinds[i] == Kind.INSTANT) {
          arrivals[i] = arrivals[i - 1] + legTime(i, speeds[i - 1], speeds[i - 1]);
        }
        if (byNextTime[i]) {
          speeds[i] = fromNextTime(i);
          sources[i] = SpeedSource.NEXT_TIME;
        } else if (byOwnTime[i]) {
          speeds[i] = fromOwnTime(i);
          sources[i] = SpeedSource.OWN_TIME;
        } else {
          Double typed = points.get(i).speed();
          speeds[i] = typed == null ? Double.NaN : typed;
        }
        if (kinds[i] == Kind.INSTANT && speeds[i] == 0 && i > 0 && i < n - 1) {
          problems.add(Problem.at(i, "a step to a speed of 0 is allowed only at the last point; use a ramp to slow to a standstill"));
          speeds[i] = Double.NaN;
        }
        if (i > 0 && kinds[i] == Kind.RAMP) {
          arrivals[i] = arrivals[i - 1] + legTime(i, speeds[i - 1], speeds[i]);
        }
      }
    }

    /** The time of the leg into point {@code to} from speed {@code v0} to {@code v1}, with a constant acceleration. */
    private double legTime(int to, double v0, double v1) {
      double length = legs[to - 1];
      if (length < SAME_PLACE) {
        return 0;
      }
      double mean = (v0 + v1) / 2;
      if (mean <= 0) {
        problems.add(Problem.at(to, "the leg into this point has a mean speed of 0, so the point is never reached"));
        return Double.NaN;
      }
      return length / mean;
    }

    /** Point {@code i}'s speed from the time typed at the next point, an instant one (Q2). */
    private double fromNextTime(int i) {
      int next = i + 1;
      TypedTime time = requireNonNull(points.get(next).time());
      double length = legs[i];
      if (length < SAME_PLACE) {
        problems.add(Problem.at(next, "the point is where the previous one is, so it takes no time to reach"));
        return Double.NaN;
      }
      double speed;
      if (time.from() == RouteDefinition.From.PREVIOUS) {
        speed = length / time.seconds();
      } else if (i == 0 || kinds[i] == Kind.INSTANT) {
        double duration = time.seconds() - arrivals[i];
        if (!(duration > 0)) {
          problems.add(Problem.at(next, "the time must be later than " + seconds(arrivals[i]) + ", when the previous point is reached"));
          return Double.NaN;
        }
        speed = length / duration;
      } else {
        // The previous point is a ramp: its speed ends the leg before it and runs this one.
        double duration = time.seconds() - arrivals[i - 1];
        if (!(duration > 0)) {
          problems.add(Problem.at(next, "the time must be later than " + seconds(arrivals[i - 1]) + ", when the point before the previous one is reached"));
          return Double.NaN;
        }
        speed = solveRampThenSteady(duration, speeds[i - 1], legs[i - 1], length);
      }
      return rounded(speed, time, next);
    }

    /** Point {@code i}'s speed from its own typed time, a ramp point (A11). */
    private double fromOwnTime(int i) {
      TypedTime time = requireNonNull(points.get(i).time());
      double length = legs[i - 1];
      double previous = speeds[i - 1];
      double duration = time.from() == RouteDefinition.From.START ? time.seconds() - arrivals[i - 1] : time.seconds();
      if (!(duration > 0)) {
        problems.add(Problem.at(i, "the time must be later than " + seconds(arrivals[i - 1]) + ", when the previous point is reached"));
        return Double.NaN;
      }
      if (length < SAME_PLACE) {
        problems.add(Problem.at(i, "the point is where the previous one is, so it takes no time to reach"));
        return Double.NaN;
      }
      double speed = 2 * length / duration - previous;
      if (speed < 0) {
        problems.add(Problem.at(i, "a ramp from the previous point's " + metresPerSecond(previous) + " reaches this point within "
            + seconds(2 * length / previous) + " at most, so this time cannot be reached"));
        return Double.NaN;
      }
      return rounded(speed, time, i);
    }

    private double rounded(double speed, TypedTime time, int point) {
      double value = time.unit().round(speed);
      if (value > RouteDefinition.MAX_SPEED) {
        problems.add(Problem.at(point, "the time gives a speed above " + (long) RouteDefinition.MAX_SPEED + " m/s"));
        return Double.NaN;
      }
      if (value <= 0 && speed > 0 && kinds[point] == Kind.INSTANT) {
        problems.add(Problem.at(point, "the time is so long that the speed rounds to 0"));
        return Double.NaN;
      }
      return value;
    }
  }

  /**
   * The speed {@code x} at which a ramp from {@code a} over {@code l1}, then a steady leg of {@code
   * l2}, take {@code duration} together: {@code 2 l1 / (a + x) + l2 / x = duration}, the positive root
   * of {@code duration x² + (duration a − 2 l1 − l2) x − l2 a = 0}.
   */
  static double solveRampThenSteady(double duration, double a, double l1, double l2) {
    double b = duration * a - 2 * l1 - l2;
    double c = -l2 * a;
    return (-b + Math.sqrt(b * b - 4 * duration * c)) / (2 * duration);
  }

  private static <T> T requireNonNull(@Nullable T value) {
    if (value == null) {
      throw new IllegalStateException("checked before");
    }
    return value;
  }

  private static String seconds(double value) {
    return String.format(java.util.Locale.ROOT, "%.1f s", value);
  }

  private static String metresPerSecond(double value) {
    return String.format(java.util.Locale.ROOT, "%.2f m/s", value);
  }

  // ---------------------------------------------------------------- queries

  /** Everything that keeps the route from running, in point order; empty when it can run. */
  List<Problem> problems() {
    return problems;
  }

  int pointCount() {
    return cumulative.length;
  }

  double legMetres(int into) {
    return into == 0 ? 0 : legs[into - 1];
  }

  double distanceMetres(int point) {
    return cumulative[point];
  }

  double lengthMetres() {
    return cumulative[cumulative.length - 1];
  }

  /** Point {@code i}'s speed in m/s, or NaN when it cannot be computed. */
  double speed(int point) {
    return speeds[point];
  }

  SpeedSource speedSource(int point) {
    return sources[point];
  }

  /** When point {@code i} is reached, in seconds from the start, or NaN. */
  double arrivalSeconds(int point) {
    return arrivals[point];
  }

  /** The time from the first point to the last, or NaN. */
  double durationSeconds() {
    return arrivals[arrivals.length - 1];
  }

  /** Where an object is {@code seconds} after it left the first point. Only for a plan without problems. */
  Motion at(double seconds) {
    GeodesicPath p = path;
    if (p == null || !problems.isEmpty() || Double.isNaN(durationSeconds())) {
      throw new IllegalStateException("the route cannot run");
    }
    int last = cumulative.length - 1;
    if (seconds >= arrivals[last]) {
      PathPoint end = p.at(lengthMetres());
      return new Motion(end.position(), altitudes[last], end.azimuth(), 0, last - 1, 1, lengthMetres(), true);
    }
    double t = Math.max(0, seconds);
    int leg = legAt(t);
    double duration = arrivals[leg + 1] - arrivals[leg];
    double v0 = speeds[leg];
    double v1 = speedKinds[leg + 1] == Kind.RAMP ? speeds[leg + 1] : v0;
    double along = 0;
    double speed = v0;
    if (duration > 0) {
      double tau = t - arrivals[leg];
      double acceleration = (v1 - v0) / duration;
      along = Math.min(legs[leg], v0 * tau + acceleration * tau * tau / 2);
      speed = Math.max(0, v0 + acceleration * tau);
    }
    double fraction = legs[leg] < SAME_PLACE ? 1 : along / legs[leg];
    double distance = cumulative[leg] + along;
    PathPoint here = p.at(distance);
    return new Motion(here.position(), altitudeOn(leg, fraction), here.azimuth(), speed, leg, fraction, distance, false);
  }

  /**
   * When an object is at {@code fraction} of leg {@code leg}, in seconds from the start: the inverse
   * of {@link #at}, for objects that move with an edited route (brief function 9). A leg past the
   * last is the last (A9). Only for a plan without problems.
   */
  double secondsAt(int leg, double fraction) {
    int last = cumulative.length - 2;
    int l = Math.clamp(leg, 0, last);
    double f = Math.clamp(fraction, 0.0, 1.0);
    double duration = arrivals[l + 1] - arrivals[l];
    if (!(duration > 0) || legs[l] < SAME_PLACE) {
      return f >= 1 ? arrivals[l + 1] : arrivals[l];
    }
    double along = legs[l] * f;
    double v0 = speeds[l];
    double v1 = speedKinds[l + 1] == Kind.RAMP ? speeds[l + 1] : v0;
    double acceleration = (v1 - v0) / duration;
    // along = v0 τ + a τ² / 2, solved in the form that also holds for a = 0 and for v0 = 0.
    double root = Math.sqrt(Math.max(0, v0 * v0 + 2 * acceleration * along));
    double tau = along == 0 ? 0 : 2 * along / (v0 + root);
    return arrivals[l] + Math.min(duration, tau);
  }

  /** When an object has come {@code metres} along the route, in seconds from the start; the duration past the end. */
  double secondsAtDistance(double metres) {
    if (metres >= lengthMetres()) {
      return durationSeconds();
    }
    if (metres <= 0) {
      return 0;
    }
    int low = 0;
    int high = cumulative.length - 2;
    while (low < high) {
      int mid = (low + high + 1) >>> 1;
      if (cumulative[mid] <= metres) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    return secondsAt(low, legs[low] < SAME_PLACE ? 1 : (metres - cumulative[low]) / legs[low]);
  }

  /** The leg being run at {@code t}: the last point reached before it, at most the last leg. */
  private int legAt(double t) {
    int low = 0;
    int high = cumulative.length - 2;
    while (low < high) {
      int mid = (low + high + 1) >>> 1;
      if (arrivals[mid] <= t) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    return low;
  }

  private @Nullable Double altitudeOn(int leg, double fraction) {
    Double from = altitudes[leg];
    Double to = altitudes[leg + 1];
    if (altitudeKinds[leg + 1] == Kind.RAMP && from != null && to != null) {
      return from + (to - from) * fraction;
    }
    return from;
  }
}
