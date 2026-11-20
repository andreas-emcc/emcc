package dev.emcc.sdk.model;

import org.jspecify.annotations.Nullable;

/**
 * Core descriptive properties of a map object ({@code properties} in JSON). Plugin data belongs
 * in extensions.
 *
 * <pre>{@code
 * new ObjectProperties("1st Company", "Placed by hand in the internal demo.")
 * }</pre>
 *
 * @param name at most 256 characters
 * @param description at most 4096 characters
 */
public record ObjectProperties(@Nullable String name, @Nullable String description) {

  public ObjectProperties {
    if (name != null && name.length() > 256) {
      throw new IllegalArgumentException("name is longer than 256 characters");
    }
    if (description != null && description.length() > 4096) {
      throw new IllegalArgumentException("description is longer than 4096 characters");
    }
  }

  public boolean isEmpty() {
    return name == null && description == null;
  }
}
