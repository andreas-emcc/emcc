package dev.emcc.plugins.cot.codec;

import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Style;
import java.util.Objects;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * Where an object goes and what the codec must not decide: the fields of an object's core content
 * that CoT does not provide. For a new object they come from the stream; for an update they are
 * the object's own, so that an event never moves an object to another layer or stream, and never
 * changes its label or style (model rule 14, brief function 5).
 *
 * @param dataSource the link's name (fixed at creation)
 * @param layerId the layer
 * @param label the security label
 * @param style the style, or {@code null}
 */
public record Placement(String dataSource, UUID layerId, SecurityLabel label, @Nullable Style style) {

  public Placement {
    Objects.requireNonNull(dataSource, "dataSource");
    Objects.requireNonNull(layerId, "layerId");
    Objects.requireNonNull(label, "label");
  }
}
