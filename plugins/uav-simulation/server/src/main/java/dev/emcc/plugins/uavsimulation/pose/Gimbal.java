package dev.emcc.plugins.uavsimulation.pose;

import dev.emcc.sdk.model.Position;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/** The four pointing modes as angles at a frame time (brief function 6). Pure functions. */
public final class Gimbal {

  private Gimbal() {}

  /**
   * The camera's aim at {@code time}.
   *
   * @param pointing the pointing mode
   * @param camera the camera's position at {@code time}, its altitude the camera's height (metres HAE)
   * @param heading the platform's heading, degrees from true north
   * @param time the frame time
   * @param sinceStart the time since the camera started (the sweep's phase)
   * @param target Track an object: the target's last update, or {@code null} when it is gone
   * @param last the previous frame's aim, kept when the target is gone (U7), or {@code null}
   * @return the aim, and whether the target is gone (Track an object only)
   */
  public static Pointed point(Pointing pointing, Position camera, double heading, Instant time, Duration sinceStart, @Nullable Fix target, @Nullable Aim last) {
    Objects.requireNonNull(camera.altitude(), "the camera's position needs its height");
    return switch (pointing) {
      case Pointing.FixedAngles f -> new Pointed(new Aim(f.azimuth(), f.depression()), false);
      case Pointing.Sweep s -> new Pointed(new Aim(sweep(s, sinceStart), s.depression()), false);
      case Pointing.TrackPoint p -> new Pointed(towards(camera, heading, p.longitude(), p.latitude(), p.height()), false);
      case Pointing.TrackObject o -> {
        if (target == null) {
          yield new Pointed(last == null ? Aim.DEFAULT : last, true);
        }
        Position at = target.at(time).position();
        double height = at.altitude() != null ? at.altitude() : o.height();
        yield new Pointed(towards(camera, heading, at.longitude(), at.latitude(), height), false);
      }
    };
  }

  /**
   * The sweep's azimuth after {@code sinceStart}: from the start towards the end at the rate, then back
   * (a triangle wave), its phase counted from the camera's start. Clockwise from the start, so a sector
   * from 315 to 45 crosses north.
   */
  static double sweep(Pointing.Sweep s, Duration sinceStart) {
    double width = s.width();
    double travelled = s.rate() * Math.max(0, sinceStart.toNanos() / 1e9);
    double phase = travelled % (2 * width);
    double offset = phase <= width ? phase : 2 * width - phase;
    return Angles.azimuth(s.start() + offset);
  }

  private static Aim towards(Position camera, double heading, double lon, double lat, double height) {
    LookAngles look = LookAngles.between(camera.longitude(), camera.latitude(), camera.altitude(), lon, lat, height);
    // Straight down (or up) has no azimuth of its own: 0 relative to the platform (brief function 6).
    boolean vertical = Math.abs(look.depression()) == 90;
    return new Aim(vertical ? 0 : Angles.relative(look.azimuth(), heading), look.depression());
  }

  /**
   * An aim, and whether Track an object's target is gone (the panel's "Target gone", U7).
   *
   * @param aim the aim
   * @param targetGone true when Track an object has no target and kept the last aim
   */
  public record Pointed(Aim aim, boolean targetGone) {}
}
