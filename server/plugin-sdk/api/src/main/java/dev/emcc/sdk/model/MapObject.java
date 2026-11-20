package dev.emcc.sdk.model;

import java.util.Objects;
import java.util.UUID;

/**
 * A map object as held by the object store and sent to clients. In JSON the content's fields sit
 * next to {@code id}, {@code version} and {@code meta}.
 *
 * <pre>{@code
 * object.content().geometry()
 * }</pre>
 *
 * @param id the object's UUID
 * @param version 1 or more
 * @param content the fields its creator controls
 * @param meta set by the object store
 */
public record MapObject(UUID id, long version, MapObjectContent content, Meta meta) implements Entity {

  public MapObject {
    Objects.requireNonNull(id, "id");
    Objects.requireNonNull(content, "content");
    Objects.requireNonNull(meta, "meta");
    if (version < 1) {
      throw new IllegalArgumentException("version must be >= 1: " + version);
    }
  }
}
