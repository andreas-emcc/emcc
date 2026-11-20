package dev.emcc.plugins.nvg.compute;

import dev.emcc.plugins.nvg.codec.Item;
import dev.emcc.plugins.nvg.codec.NvgDocument;
import dev.emcc.plugins.nvg.codec.NvgReader;
import dev.emcc.plugins.nvg.codec.NvgWriter;
import dev.emcc.plugins.nvg.codec.ReadResult;
import dev.emcc.plugins.nvg.links.Soap;
import dev.emcc.plugins.nvg.mapping.ObjectMapper;
import dev.emcc.plugins.nvg.sync.SyncPlan;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Classifications;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.worker.Handler;
import dev.emcc.sdk.worker.WorkerContext;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * The compute worker (rule C7): reads and plans documents, and writes layers as documents. Keeps no
 * state between messages.
 */
public final class ComputeWorker implements Handler<ComputeMsg> {

  @Override
  public void handle(ComputeMsg message, WorkerContext<ComputeMsg> ctx) {
    switch (message) {
      case ComputeMsg.Prepare p -> p.replyTo().reply(prepare(p));
      case ComputeMsg.Export e -> e.replyTo().reply(export(e.layers(), e.defaultLabel(), e.classifications(), e.maxBytes(), e.soap(), Instant.now()));
    }
  }

  static ComputeMsg.Prepared prepare(ComputeMsg.Prepare p) {
    Bytes bytes = p.bytes();
    if (p.soap()) {
      Soap.Unwrapped answer = Soap.unwrapNvg(bytes, p.limits().maxBytes());
      if (answer.fault() != null) {
        return new ComputeMsg.Prepared("SOAP fault", answer.fault(), null);
      }
      if (answer.nvg() == null) {
        return new ComputeMsg.Prepared(answer.counter(), answer.reason(), null);
      }
      bytes = answer.nvg();
    }
    ReadResult read = NvgReader.read(bytes, p.limits());
    if (read.isRefused()) {
      return new ComputeMsg.Prepared(read.counter(), read.reason(), null);
    }
    NvgDocument doc = read.document();
    boolean delete = p.deleteMissing() && (!doc.items().isEmpty() || p.clearOnEmpty());
    return new ComputeMsg.Prepared(null, null, SyncPlan.plan(p.system(), doc, p.stored(), p.blocked(), p.context(), delete, UUID::randomUUID));
  }

  /** The layers as one document, one {@code g} each, the objects in a stable order. */
  public static ComputeMsg.Exported export(List<ComputeMsg.ExportLayer> layers, SecurityLabel defaultLabel, Classifications classifications,
      int maxBytes, @Nullable String soap, Instant now) {
    List<NvgWriter.Group> groups = new ArrayList<>();
    List<SecurityLabel> labels = new ArrayList<>();
    int count = 0;
    for (ComputeMsg.ExportLayer layer : layers) {
      List<Item> items = new ArrayList<>();
      List<MapObject> objects = new ArrayList<>(layer.objects());
      objects.sort(Comparator.comparing((MapObject o) -> o.meta().created().at()).thenComparing(MapObject::id));
      for (MapObject o : objects) {
        items.add(ObjectMapper.toItem(o));
        labels.add(o.content().label());
      }
      count += items.size();
      groups.add(new NvgWriter.Group("urn:uuid:" + layer.id(), layer.name(), items));
    }
    SecurityLabel label = highest(labels, defaultLabel, classifications);
    Bytes bytes = soap == null ? NvgWriter.write(label, now, groups) : Soap.getNvgResponse(soap, label, now, groups);
    if (bytes.size() > maxBytes) {
      return new ComputeMsg.Exported(null, "the document would be larger than " + (maxBytes / (1024 * 1024)) + " MiB", count);
    }
    return new ComputeMsg.Exported(bytes, null, count);
  }

  /** The document's label: the highest classification of its items in the default label's policy, at least the default's. */
  static SecurityLabel highest(List<SecurityLabel> labels, SecurityLabel defaultLabel, Classifications classifications) {
    String policy = defaultLabel.policyIdentifier().name();
    List<String> order = classifications.order(policy);
    SecurityLabel best = defaultLabel;
    int bestAt = order.indexOf(defaultLabel.classification());
    for (SecurityLabel l : labels) {
      if (l.policyIdentifier().name().equalsIgnoreCase(policy)) {
        int at = order.indexOf(l.classification());
        if (at > bestAt) {
          bestAt = at;
          best = SecurityLabel.of(defaultLabel.policyIdentifier().name(), l.classification());
        }
      }
    }
    return best;
  }
}
