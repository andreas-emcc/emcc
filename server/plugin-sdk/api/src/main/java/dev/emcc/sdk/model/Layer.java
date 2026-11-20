package dev.emcc.sdk.model;

import java.util.Objects;
import java.util.UUID;

/**
 * A layer as held by the object store. In JSON the content's fields sit next to {@code id},
 * {@code version} and {@code meta}.
 *
 * <pre>{@code
 * layer.content().drawOrder()
 * }</pre>
 *
 * @param id the layer's UUID
 * @param version 1 or more
 * @param content the fields its creator controls
 * @param meta set by the object store
 */
public record Layer(UUID id, long version, LayerContent content, Meta meta) implements Entity {

  public Layer {
    Objects.requireNonNull(id, "id");
    Objects.requireNonNull(content, "content");
    Objects.requireNonNull(meta, "meta");
    if (version < 1) {
      throw new IllegalArgumentException("version must be >= 1: " + version);
    }
  }
}
