package dev.emcc.sdk.worker;

import java.util.Objects;

/**
 * The opaque identity of a worker, a reply handle or a response handle. Handles are immutable
 * values that are equal by id, so that they can be serialized as ids when a plugin runs in its own
 * process (overview 4.1).
 *
 * <pre>{@code
 * HandleId id = ref.id();
 * }</pre>
 *
 * @param value the id; its form is up to ECore
 */
public record HandleId(String value) {

  public HandleId {
    Objects.requireNonNull(value, "value");
    if (value.isEmpty()) {
      throw new IllegalArgumentException("empty id");
    }
  }
}
