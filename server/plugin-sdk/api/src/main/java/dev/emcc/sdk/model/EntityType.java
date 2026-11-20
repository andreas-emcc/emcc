package dev.emcc.sdk.model;

import java.util.Locale;

/**
 * What a change concerns. Layers change through the same change requests as objects.
 *
 * <pre>{@code
 * EntityType.fromJson("layer") == EntityType.LAYER
 * }</pre>
 */
public enum EntityType {
  OBJECT,
  LAYER;

  public String json() {
    return name().toLowerCase(Locale.ROOT);
  }

  public static EntityType fromJson(String value) {
    return valueOf(value.toUpperCase(Locale.ROOT));
  }
}
