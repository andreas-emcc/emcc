package dev.emcc.sdk.topic;

import dev.emcc.sdk.Message;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * A named, typed topic. A plugin's own topics start with its plugin id
 * ({@code basemap-osm.tile-fetched}). The SDK defines no topics of its own, and ECore's internal
 * topics are not for plugins: to follow objects, subscribe to the store.
 *
 * <pre>{@code
 * Topic<TileFetched> fetched = Topic.of("basemap-osm.tile-fetched", TileFetched.class);
 * }</pre>
 *
 * @param name dot-separated lowercase words with hyphens, at least two parts
 * @param payloadType the type of every message on the topic
 * @param <T> the payload type
 */
public record Topic<T extends Message>(String name, Class<T> payloadType) {

  private static final Pattern NAME = Pattern.compile("[a-z][a-z0-9]*(-[a-z0-9]+)*(\\.[a-z][a-z0-9]*(-[a-z0-9]+)*)+");

  public Topic {
    Objects.requireNonNull(name, "name");
    Objects.requireNonNull(payloadType, "payloadType");
    if (!NAME.matcher(name).matches() || name.length() > 128) {
      throw new IllegalArgumentException("topic name must be like 'plugin-id.topic-name': " + name);
    }
  }

  public static <T extends Message> Topic<T> of(String name, Class<T> payloadType) {
    return new Topic<>(name, payloadType);
  }
}
