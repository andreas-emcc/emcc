package dev.emcc.sdk;

import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonNull;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * SDK 1.2.0: a layer an admin picked in a settings form (ADR-0037 point 2; CR-0025 part 3): a
 * settings property annotated {@code "x-emc2": {"kind": "layer"}}, on an object {@code {"id":
 * <uuid>, "name": <string>}} where only {@code name} is required. The shell's form offers the
 * layers (in M3 View's) and "New layer" with a name, which it saves without an id. With {@code
 * "allowNew": false} it offers existing layers only, e.g. for an output's source layers; an array
 * of such objects picks several.
 *
 * <p>The schema to copy (the design pattern): {@code "layer": {"type": "object", "x-emc2":
 * {"kind": "layer"}, "properties": {"id": {"type": "string", "format": "uuid"}, "name": {"type":
 * "string", "minLength": 1, "maxLength": 256}}, "required": ["name"]}}.
 *
 * <p><b>SDK 1.4.0 (CR-0030 part 1a; ADR-0037 point 2 as noted, T-133):</b> the form has a "+"
 * button beside the drop-down instead of the "New layer" entry. It asks for a name, creates the
 * layer at once in View with the admin's {@code layers.edit}, and saves it picked, <b>with its
 * id</b>. {@code "allowNew": false} hides the button. So a picked layer has an id; {@link #isNew()}
 * stays for a value without one, which the form no longer saves.
 *
 * <p><b>The link's actual layer is still the plugin's to keep</b>: a picked layer that is gone is
 * made again by its name at the next data, and two links that name the same gone layer share the
 * new one. The SDK's {@link dev.emcc.sdk.store.ObjectWriter} does this for an in plugin (SDK
 * 1.4.0). This class only parses: it never asks the store.
 *
 * @param id the picked layer's id; {@code null} only in a value saved before SDK 1.4.0 ("New layer")
 * @param name the layer's name as the form showed it, or the new layer's name: 1 to 256 characters
 */
public record LayerChoice(@Nullable UUID id, String name) {

  public LayerChoice {
    Objects.requireNonNull(name, "name");
    if (name.isBlank() || name.length() > 256) {
      throw new IllegalArgumentException("a layer's name must be 1..256 characters");
    }
  }

  /** Whether the value names a layer without an id: "New layer" before SDK 1.4.0. */
  public boolean isNew() {
    return id == null;
  }

  /**
   * Reads one picked layer; {@code null} when the setting is absent or {@code null}.
   *
   * @throws IllegalArgumentException if it is not {@code {"id"?: <uuid>, "name": <string>}}
   */
  public static @Nullable LayerChoice from(@Nullable JsonValue setting) {
    if (setting == null || setting instanceof JsonNull) {
      return null;
    }
    if (!(setting instanceof JsonObject o) || !(o.get("name") instanceof JsonString name)) {
      throw new IllegalArgumentException("a picked layer is {\"id\"?: <uuid>, \"name\": <string>}");
    }
    JsonValue id = o.get("id");
    if (id == null || id instanceof JsonNull) {
      return new LayerChoice(null, name.value());
    }
    if (!(id instanceof JsonString s)) {
      throw new IllegalArgumentException("a picked layer's id must be a UUID string");
    }
    UUID uuid = UUID.fromString(s.value());
    if (!uuid.toString().equalsIgnoreCase(s.value())) {
      throw new IllegalArgumentException("a picked layer's id must be a UUID in its usual form: " + s.value());
    }
    return new LayerChoice(uuid, name.value());
  }

  /**
   * Reads an array of picked layers, e.g. an output's source layers; empty when the setting is
   * absent or {@code null}.
   *
   * @throws IllegalArgumentException if it is not an array of picked layers
   */
  public static List<LayerChoice> list(@Nullable JsonValue setting) {
    if (setting == null || setting instanceof JsonNull) {
      return List.of();
    }
    if (!(setting instanceof JsonArray a)) {
      throw new IllegalArgumentException("picked layers are an array");
    }
    var all = new ArrayList<LayerChoice>(a.size());
    for (JsonValue v : a.values()) {
      if (v == null || v instanceof JsonNull) {
        throw new IllegalArgumentException("a picked layer must not be null");
      }
      all.add(Objects.requireNonNull(from(v)));
    }
    return List.copyOf(all);
  }
}
