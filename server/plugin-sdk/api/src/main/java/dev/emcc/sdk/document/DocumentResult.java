package dev.emcc.sdk.document;

import dev.emcc.sdk.json.JsonObject;
import java.util.Objects;

/**
 * The answer to a {@link Documents} call. Exactly one arrives, always delivered.
 *
 * <pre>{@code
 * switch (result) {
 *   case DocumentResult.Found f -> layers = LayerIds.from(f.value());
 *   case DocumentResult.Missing m -> layers = LayerIds.empty();
 *   case DocumentResult.Written w -> {}
 *   case DocumentResult.Failed f -> log.warn("document {}: {}", f.key(), f.reason());
 * }
 * }</pre>
 */
public sealed interface DocumentResult permits DocumentResult.Found, DocumentResult.Missing, DocumentResult.Written, DocumentResult.Failed {

  /** The document's key. */
  String key();

  /** The document exists. */
  record Found(String key, JsonObject value) implements DocumentResult {
    public Found {
      Objects.requireNonNull(key, "key");
      Objects.requireNonNull(value, "value");
    }
  }

  /** There is no document with this key. */
  record Missing(String key) implements DocumentResult {
    public Missing {
      Objects.requireNonNull(key, "key");
    }
  }

  /** A put or delete was applied (in memory; stored shortly after). */
  record Written(String key) implements DocumentResult {
    public Written {
      Objects.requireNonNull(key, "key");
    }
  }

  /** The call failed, e.g. the document is too large, the plugin has too many, or too many outstanding asks. */
  record Failed(String key, String reason) implements DocumentResult {
    public Failed {
      Objects.requireNonNull(key, "key");
      Objects.requireNonNull(reason, "reason");
    }
  }
}
