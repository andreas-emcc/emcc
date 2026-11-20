package dev.emcc.plugins.nvg.codec;

import dev.emcc.sdk.model.SecurityLabel;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * A read NVG document: its version, its own label and its shapes in document order, groups and
 * composites flattened (brief, section 3).
 *
 * @param version the document's {@code version}
 * @param label the document's STANAG 4774 label, or {@code null}
 * @param labelUnreadable a document label was there but could not be read
 * @param items the shapes, in document order
 * @param skipped what was left out, by counter name (e.g. {@code skipped: content-item}) and number
 */
public record NvgDocument(String version, @Nullable SecurityLabel label, boolean labelUnreadable, List<Item> items, Map<String, Long> skipped) {

  public NvgDocument {
    Objects.requireNonNull(version, "version");
    items = List.copyOf(items);
    skipped = Map.copyOf(skipped);
  }
}
