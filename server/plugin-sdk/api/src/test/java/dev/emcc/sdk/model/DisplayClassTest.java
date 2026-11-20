package dev.emcc.sdk.model;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Data model 1.6.0 part D (CR-0041; T-182, owner Q58 A): a map object's display class. */
class DisplayClassTest {

  private static final SecurityLabel LABEL = SecurityLabel.of("NATO", "UNCLASSIFIED");
  private static final UUID LAYER = UUID.fromString("0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e01");
  private static final Geometry AREA = new Geometry.Circle(Position.of(15.2, 58.4), 20_000);

  private static MapObjectContent shape() {
    return new MapObjectContent(MapObjectContent.SHAPE, "gmti.platform", "north", null, LAYER, AREA, null, null, null, LABEL, Extensions.empty());
  }

  @Test
  void theListIsTheOwnersTwoClasses() {
    assertThat(DisplayClass.ALL).containsExactly("dwell-area", "sensor-coverage");
  }

  @Test
  void anObjectMayCarryAClassAndCopiesKeepIt() {
    var marked = shape().withDisplayClass(DisplayClass.DWELL_AREA);
    assertThat(marked.displayClass()).isEqualTo("dwell-area");
    assertThat(marked.withRelations(List.of()).displayClass()).isEqualTo("dwell-area");
    assertThat(marked.withFieldSets(List.of()).displayClass()).isEqualTo("dwell-area");
    assertThat(marked.withDisplayClass(null).displayClass()).isNull();
  }

  @Test
  void theOlderFormsHaveNone() {
    assertThat(shape().displayClass()).isNull();
    var partA = new MapObjectContent(MapObjectContent.SHAPE, "gmti.platform", "north", null, LAYER, AREA, null, null, null, LABEL,
        Extensions.empty(), List.of(), List.of(), null);
    assertThat(partA.displayClass()).isNull();
  }

  @Test
  void anUnknownClassIsRefused() {
    assertThatThrownBy(() -> shape().withDisplayClass("weather")).hasMessageContaining("display class");
  }
}
