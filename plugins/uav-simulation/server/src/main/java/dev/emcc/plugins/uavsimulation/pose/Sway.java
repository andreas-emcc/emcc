package dev.emcc.plugins.uavsimulation.pose;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.SplittableRandom;

/**
 * A camera's micro sway (M10 plan point 8, M9.2's V3; owner AEY A): small irregular offsets to the
 * camera's yaw, pitch and roll at every frame. Each axis is the sum of {@link #WAVES} slow sine waves
 * with frequencies drawn from the settings' range, phases drawn at random and amplitudes that add up to
 * the settings' amplitude, so the waves never sway further than it. On top come jolts at random times
 * (on average {@code joltsPerMinute} a minute, a Poisson process): each is a step of the jolt's
 * strength in a random direction over the three axes, which dies away exponentially with the decay as
 * its time constant (to 1/e after it; brief function 14, ADR-0066 point 3).
 *
 * <p>Everything follows from the seed: the same settings and seed give the same offsets at the same
 * time since the start, on any camera (brief criterion 23). One instance belongs to one camera in one
 * worker; {@link #at} takes times that do not go back (a time earlier than the last is taken as the last).
 */
public final class Sway {

  /** The sine waves on each axis. */
  static final int WAVES = 3;

  /** A jolt this many time constants old is below 1/20 000 of its strength and dropped. */
  static final double JOLT_LIFETIMES = 10;

  /** The most jolts that ring at once: more are dropped, the oldest first (only very short gaps and long decays get there). */
  static final int MAX_JOLTS = 64;

  /**
   * The sway's settings (brief section 5, from M9.2).
   *
   * @param amplitude the sine waves' largest offset on each axis, degrees, at least 0
   * @param minFrequency the waves' lowest frequency, Hz, above 0
   * @param maxFrequency the waves' highest frequency, Hz, at least {@code minFrequency}
   * @param joltsPerMinute how many jolts a minute on average, at least 0 (0: none)
   * @param joltStrength a jolt's largest turn, degrees, at least 0
   * @param joltDecay a jolt's time constant, seconds, above 0: after it the jolt is down to 1/e
   * @param seed the seed every random draw follows from
   */
  public record Settings(double amplitude, double minFrequency, double maxFrequency, double joltsPerMinute, double joltStrength, double joltDecay,
      long seed) {
    public Settings {
      check(amplitude >= 0 && Double.isFinite(amplitude), "amplitude", amplitude);
      check(minFrequency > 0 && Double.isFinite(minFrequency), "minFrequency", minFrequency);
      check(maxFrequency >= minFrequency && Double.isFinite(maxFrequency), "maxFrequency", maxFrequency);
      check(joltsPerMinute >= 0 && Double.isFinite(joltsPerMinute), "joltsPerMinute", joltsPerMinute);
      check(joltStrength >= 0 && Double.isFinite(joltStrength), "joltStrength", joltStrength);
      check(joltDecay > 0 && Double.isFinite(joltDecay), "joltDecay", joltDecay);
    }

    private static void check(boolean ok, String name, double value) {
      if (!ok) {
        throw new IllegalArgumentException(name + " is out of range: " + value);
      }
    }
  }

  /**
   * The offsets of one frame, degrees, added to the camera's angles.
   *
   * @param yaw added to the azimuth, clockwise
   * @param pitch added to the depression, positive down
   * @param roll added to the camera's roll
   */
  public record Offsets(double yaw, double pitch, double roll) {
    /** No sway. */
    public static final Offsets NONE = new Offsets(0, 0, 0);
  }

  /** One jolt: when it came, and its step on each axis. */
  private record Jolt(double time, double yaw, double pitch, double roll) {}

  private final Settings settings;
  /** [axis][wave]: yaw, pitch, roll. */
  private final double[][] amplitude = new double[3][WAVES];
  private final double[][] omega = new double[3][WAVES];
  private final double[][] phase = new double[3][WAVES];
  private final SplittableRandom jolting;
  private final ArrayDeque<Jolt> ringing = new ArrayDeque<>();
  private double nextJolt;
  private double last;

  public Sway(Settings settings) {
    this.settings = settings;
    SplittableRandom random = new SplittableRandom(settings.seed() ^ 0x5DEECE66DL);
    double span = settings.maxFrequency() - settings.minFrequency();
    for (int axis = 0; axis < 3; axis++) {
      double[] weight = new double[WAVES];
      double sum = 0;
      for (int w = 0; w < WAVES; w++) {
        weight[w] = 0.5 + 0.5 * random.nextDouble();
        sum += weight[w];
      }
      for (int w = 0; w < WAVES; w++) {
        amplitude[axis][w] = settings.amplitude() * weight[w] / sum;
        omega[axis][w] = 2 * Math.PI * (settings.minFrequency() + span * random.nextDouble());
        phase[axis][w] = 2 * Math.PI * random.nextDouble();
      }
    }
    jolting = random.split();
    nextJolt = settings.joltsPerMinute() > 0 && settings.joltStrength() > 0 ? gap() : Double.POSITIVE_INFINITY;
  }

  public Settings settings() {
    return settings;
  }

  /** The offsets {@code seconds} after the camera started. */
  public Offsets at(double seconds) {
    double t = Math.max(last, seconds);
    last = t;
    while (nextJolt <= t) {
      ringing.addLast(jolt(nextJolt));
      if (ringing.size() > MAX_JOLTS) {
        ringing.removeFirst();
      }
      nextJolt += gap();
    }
    double lifetime = JOLT_LIFETIMES * settings.joltDecay();
    while (!ringing.isEmpty() && t - ringing.peekFirst().time() > lifetime) {
      ringing.removeFirst();
    }
    double yaw = waves(0, t);
    double pitch = waves(1, t);
    double roll = waves(2, t);
    for (Jolt j : ringing) {
      double left = Math.exp(-(t - j.time()) / settings.joltDecay());
      yaw += j.yaw() * left;
      pitch += j.pitch() * left;
      roll += j.roll() * left;
    }
    return new Offsets(yaw, pitch, roll);
  }

  /** The jolts ringing now, for the tests. */
  List<Double> ringing() {
    List<Double> times = new ArrayList<>();
    ringing.forEach(j -> times.add(j.time()));
    return times;
  }

  private double waves(int axis, double t) {
    double sum = 0;
    for (int w = 0; w < WAVES; w++) {
      sum += amplitude[axis][w] * Math.sin(omega[axis][w] * t + phase[axis][w]);
    }
    return sum;
  }

  /** The time to the next jolt: exponential, so the jolts come as a Poisson process. */
  private double gap() {
    double mean = 60 / settings.joltsPerMinute();
    return -mean * Math.log(1 - jolting.nextDouble());
  }

  /** A jolt at {@code time}: a step of the strength, in a direction drawn evenly over the sphere of yaw, pitch and roll. */
  private Jolt jolt(double time) {
    double y = gaussian();
    double p = gaussian();
    double r = gaussian();
    double length = Math.sqrt(y * y + p * p + r * r);
    double scale = length == 0 ? 0 : settings.joltStrength() / length;
    return new Jolt(time, y * scale, p * scale, r * scale);
  }

  /** A standard normal draw (Box–Muller), from the jolts' own generator. */
  private double gaussian() {
    double u = 1 - jolting.nextDouble();
    double v = jolting.nextDouble();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
}
