package dev.emcc.plugins.nvg.compute;

import dev.emcc.plugins.nvg.codec.Limits;
import dev.emcc.plugins.nvg.mapping.ItemMapper;
import dev.emcc.plugins.nvg.sync.SyncPlan;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Classifications;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.worker.ReplyTo;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/** The compute worker's requests (rule C7): CPU-heavy work on large documents. */
public sealed interface ComputeMsg extends Message {

  /**
   * Reads a document and plans its change requests ({@link SyncPlan}).
   *
   * @param bytes the document
   * @param limits its limits
   * @param system the external system of its objects: {@code nvg-file:<name>} or the link's name
   * @param stored the objects of that system the store holds now
   * @param blocked stored objects the writer may not change, by uri, with their counter
   * @param context where new objects go and their fallback label
   * @param deleteMissing a consumer's whole picture: delete what the document no longer has
   * @param clearOnEmpty with {@code deleteMissing}: an empty document deletes too (off: it changes nothing)
   * @param soap the bytes are a provider's SOAP answer: the document is taken out of its {@code GetNvgResponse} first
   */
  record Prepare(Bytes bytes, Limits limits, String system, List<MapObject> stored, Map<String, String> blocked, ItemMapper.Context context,
      boolean deleteMissing, boolean clearOnEmpty, boolean soap, ReplyTo<Prepared> replyTo) implements ComputeMsg {
    public Prepare {
      Objects.requireNonNull(bytes, "bytes");
      stored = List.copyOf(stored);
      blocked = Map.copyOf(blocked);
    }
  }

  /**
   * Writes layers as one NVG document, one {@code g} per layer.
   *
   * @param layers the layers in order, each with its objects
   * @param defaultLabel the server's default label: the document's label when its objects carry none above it
   * @param classifications the orders, to find the document's label: the highest of its objects' in the default label's policy
   * @param maxBytes the largest document; a larger one is not answered
   * @param soap {@code null} for a file; {@code 1.1} or {@code 1.2} for a provider's {@code GetNvgResponse} in that SOAP version
   */
  record Export(List<ExportLayer> layers, SecurityLabel defaultLabel, Classifications classifications, int maxBytes, @Nullable String soap,
      ReplyTo<Exported> replyTo) implements ComputeMsg {
    public Export {
      layers = List.copyOf(layers);
    }
  }

  /**
   * One layer to write.
   *
   * @param id the layer's id ({@code urn:uuid:<id>} is its group's uri)
   * @param name the layer's name, the group's label
   * @param objects its objects
   */
  record ExportLayer(UUID id, String name, List<MapObject> objects) {
    public ExportLayer {
      objects = List.copyOf(objects);
    }
  }

  /**
   * A read and planned document.
   *
   * @param counter the refusal's counter when the document was refused, else {@code null}
   * @param reason the refusal's reason, else {@code null}
   * @param plan the plan, or {@code null} when refused
   */
  record Prepared(@Nullable String counter, @Nullable String reason, SyncPlan.@Nullable Plan plan) implements Message {}

  /**
   * A written document.
   *
   * @param bytes the document, or {@code null} when it is larger than allowed
   * @param problem why there is none, else {@code null}
   * @param items the items written
   */
  record Exported(@Nullable Bytes bytes, @Nullable String problem, int items) implements Message {}
}
