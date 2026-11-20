package dev.emcc.sdk.testkit;

import dev.emcc.sdk.model.ChangeEvent;
import dev.emcc.sdk.model.ChangeRejection;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.MapObject;

/**
 * What the codec contract test needs from a JSON codec for the model types, e.g. ECore's
 * (Jackson-based) one. The SDK does not own a codec (docs/plugins/sdk-v0.md).
 *
 * <pre>{@code
 * class EcoreCodecContractTest extends ModelCodecContractTest {
 *   protected ModelCodec codec() { return new EcoreModelCodecAdapter(); }
 *   protected Path modelDirectory() { return Path.of("../../model"); }
 * }
 * }</pre>
 */
public interface ModelCodec {

  /** The document kinds, with their Java types. */
  enum Kind {
    MAP_OBJECT(MapObject.class),
    LAYER(Layer.class),
    CHANGE_REQUEST(ChangeRequest.class),
    CHANGE_EVENT(ChangeEvent.class),
    CHANGE_REJECTION(ChangeRejection.class);

    private final Class<?> type;

    Kind(Class<?> type) {
      this.type = type;
    }

    public Class<?> type() {
      return type;
    }
  }

  /**
   * Validates {@code json} against the schema of {@code kind} (owner decision 2026-10-05: with a
   * JSON Schema validator) and maps it to that kind's Java type. Throws for an invalid document.
   */
  Object read(Kind kind, String json) throws Exception;

  /** Serializes a model value to JSON. */
  String write(Object value) throws Exception;
}
