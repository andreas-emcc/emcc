package dev.emcc.sdk.model;

import dev.emcc.sdk.json.JsonObject;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * Plugin-specific data, keyed by plugin id (= namespace). Only the owning plugin writes its
 * namespace; everyone else forwards all namespaces untouched (ADR-0007). Values are opaque
 * {@link JsonObject}s that keep their numbers exactly.
 *
 * <pre>{@code
 * Extensions mine = object.content().extensions().with("draw-symbols", JsonObject.builder()
 *     .put("placedWith", JsonString.of("symbol-palette")).build());
 * }</pre>
 *
 * @param namespaces plugin id to that plugin's data
 */
public record Extensions(Map<String, JsonObject> namespaces) {

  private static final Pattern PLUGIN_ID = Pattern.compile("[a-z][a-z0-9]*(-[a-z0-9]+)*");
  private static final Extensions EMPTY = new Extensions(Map.of());

  public Extensions {
    var copy = new LinkedHashMap<String, JsonObject>();
    namespaces.forEach((id, value) -> {
      Objects.requireNonNull(id, "namespace");
      Objects.requireNonNull(value, "value");
      if (!PLUGIN_ID.matcher(id).matches() || id.length() > 64) {
        throw new IllegalArgumentException("extension namespace must be a plugin id: " + id);
      }
      copy.put(id, value);
    });
    namespaces = Collections.unmodifiableMap(copy);
  }

  public static Extensions empty() {
    return EMPTY;
  }

  public boolean isEmpty() {
    return namespaces.isEmpty();
  }

  /** One namespace's data, or {@code null}. */
  public @Nullable JsonObject get(String pluginId) {
    return namespaces.get(pluginId);
  }

  /** A copy with {@code pluginId}'s data replaced. */
  public Extensions with(String pluginId, JsonObject value) {
    var copy = new LinkedHashMap<>(namespaces);
    copy.put(pluginId, value);
    return new Extensions(copy);
  }
}
