package dev.emcc.plugins.uavsimulation.pose;

import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.model.Position;
import java.time.Duration;
import java.time.Instant;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * An object's last update as the camera uses it (brief functions 3 and 5): its position, its {@code
 * direction} and {@code speed} modifiers, and the time the update reached the worker on ECore's clock.
 *
 * <p>Between updates it is extrapolated along its direction at its speed, by {@link Geodesy#direct}
 * on WGS84, for at most {@link #MAX_EXTRAPOLATION} (U4); then it holds. Its altitude and heading are
 * held. With no speed, or speed 0, it does not move.
 *
 * @param position longitude, latitude and the altitude (metres HAE) when the object has one
 * @param direction degrees clockwise from true north, or {@code null}
 * @param speed metres a second over ground, or {@code null}
 * @param received when the update reached the worker
 */
public record Fix(Position position, @Nullable Double direction, @Nullable Double speed, Instant received) {

  /** How far past an update the position is extrapolated (U4: about one tick and a late one). */
  public static final Duration MAX_EXTRAPOLATION = Duration.ofMillis(1500);

  public Fix {
    Objects.requireNonNull(position, "position");
    Objects.requireNonNull(received, "received");
  }

  /** The heading: the direction, or 0 without one (brief function 4, as the simulator's radar takes it). */
  public double heading() {
    return direction == null ? 0 : Angles.azimuth(direction);
  }

  /** Whether it moves between updates: a speed above 0. */
  public boolean moving() {
    return speed != null && speed > 0;
  }

  /**
   * Where the object is at {@code time}: extrapolated from this update for the time since it, at most
   * {@link #MAX_EXTRAPOLATION}. A time before the update gives the update's position.
   */
  public Extrapolated at(Instant time) {
    if (!moving()) {
      return new Extrapolated(position, false);
    }
    Duration since = Duration.between(received, time);
    if (since.isNegative() || since.isZero()) {
      return new Extrapolated(position, false);
    }
    boolean held = since.compareTo(MAX_EXTRAPOLATION) > 0;
    double seconds = (held ? MAX_EXTRAPOLATION : since).toNanos() / 1e9;
    return new Extrapolated(Geodesy.direct(position, heading(), speed * seconds), held);
  }

  /**
   * An extrapolated position.
   *
   * @param position the position, with the update's altitude
   * @param held whether the extrapolation stopped at {@link #MAX_EXTRAPOLATION} (the status counts these)
   */
  public record Extrapolated(Position position, boolean held) {}
}
