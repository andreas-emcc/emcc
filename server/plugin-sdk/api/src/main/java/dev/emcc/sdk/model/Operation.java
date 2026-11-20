package dev.emcc.sdk.model;

import java.util.Locale;

/**
 * The kind of change.
 *
 * <pre>{@code
 * Operation.fromJson("update") == Operation.UPDATE
 * }</pre>
 */
public enum Operation {
  CREATE,
  UPDATE,
  DELETE;

  public String json() {
    return name().toLowerCase(Locale.ROOT);
  }

  public static Operation fromJson(String value) {
    return valueOf(value.toUpperCase(Locale.ROOT));
  }
}
