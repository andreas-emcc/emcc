package dev.emcc.sdk.model;

import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNull;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * SDK 1.2.0: one declared field to set in a change request (ADR-0038 point 2; data model 1.2.0,
 * the change request's {@code fields}). The object store checks it against the field's declaration
 * and applies it after the content: a value sets {@code extensions.<plugin>.<name>}, {@code null}
 * removes it unless the field is required.
 *
 * <pre>{@code
 * new FieldValue("cot", "callsign", JsonString.of("ALPHA-1"))
 * new FieldValue("cot", "remarks", null)          // removes it
 * }</pre>
 *
 * @param plugin the declaring plugin's id
 * @param name the field's name
 * @param value a string, number or boolean as the declaration says; {@code null} (or JSON {@code
 *     null}, which becomes {@code null}) removes the field
 */
public record FieldValue(String plugin, String name, @Nullable JsonValue value) {

  public FieldValue {
    new FieldRef(plugin, name); // the same checks
    if (value instanceof JsonNull) {
      value = null;
    }
    if (value != null && !(value instanceof JsonString || value instanceof JsonNumber || value instanceof JsonBoolean)) {
      throw new IllegalArgumentException("a field's value is a string, a number, a boolean or null: " + plugin + "." + name);
    }
  }

  /** Sets {@code field} to {@code value}, or removes it when {@code value} is {@code null}. */
  public static FieldValue of(FieldRef field, @Nullable JsonValue value) {
    Objects.requireNonNull(field, "field");
    return new FieldValue(field.plugin(), field.name(), value);
  }

  /** The field this sets. */
  public FieldRef field() {
    return new FieldRef(plugin, name);
  }
}
