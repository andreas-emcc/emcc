package dev.emcc.sdk.model;

import java.util.UUID;

/**
 * An entity as held by the object store: id, version, content and metadata.
 *
 * <pre>{@code
 * if (state instanceof MapObject o && o.content().symbol() != null) { ... }
 * }</pre>
 */
public sealed interface Entity permits MapObject, Layer {

  UUID id();

  /** 1 when created, increased by one with every change. */
  long version();

  EntityContent content();

  Meta meta();
}
