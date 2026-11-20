package dev.emcc.plugins.uavsimulation.pose;

import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Modifiers;
import dev.emcc.sdk.model.ObjectProperties;
import dev.emcc.sdk.model.SecurityLabel;
import java.time.Instant;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * What the camera reads from a platform or a target object (brief function 3): its last update, its
 * name ({@code properties.name}) and its security label. Whether the object is in the Simulation
 * workspace is the caller's to check (its layer's workspace).
 *
 * @param fix the position, direction and speed, with the time the update reached the worker
 * @param name the name, stripped, or {@code null} without one
 * @param label the object's security label, as stored
 */
public record Platform(Fix fix, @Nullable String name, SecurityLabel label) {

  public Platform {
    Objects.requireNonNull(fix, "fix");
    Objects.requireNonNull(label, "label");
  }

  /**
   * The platform an object's content gives, read at {@code received}: a {@code core.symbol} with a
   * {@code Point} geometry, or {@code null} for any other object.
   */
  public static @Nullable Platform of(MapObjectContent c, Instant received) {
    if (!MapObjectContent.SYMBOL.equals(c.type()) || !(c.geometry() instanceof Geometry.Point point)) {
      return null;
    }
    Modifiers m = c.symbol() == null ? null : c.symbol().modifiers();
    Double direction = m == null ? null : m.direction();
    Double speed = m == null ? null : m.speed();
    return new Platform(new Fix(point.coordinates(), direction, speed, received), name(c.properties()), c.label());
  }

  private static @Nullable String name(@Nullable ObjectProperties properties) {
    if (properties == null || properties.name() == null) {
      return null;
    }
    String name = properties.name().strip();
    return name.isEmpty() ? null : name;
  }
}
