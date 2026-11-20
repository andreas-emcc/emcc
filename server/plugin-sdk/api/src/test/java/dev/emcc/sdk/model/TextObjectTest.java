package dev.emcc.sdk.model;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** Data model 1.6.0 part A (CR-0041; ADR-0055 point 4): {@code core.text}. */
class TextObjectTest {

  private static final SecurityLabel LABEL = SecurityLabel.of("NATO", "UNCLASSIFIED");
  private static final UUID LAYER = UUID.fromString("0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e01");
  private static final Geometry POINT = new Geometry.Point(Position.of(15.2, 58.4));

  private static MapObjectContent of(String type, Geometry geometry, Symbol symbol, Text text) {
    return new MapObjectContent(type, MapObjectContent.GENERAL, "nvg-file", null, LAYER, geometry, symbol, null, null, LABEL,
        Extensions.empty(), List.of(), List.of(), text);
  }

  @Test
  void aTextObjectHasItsTextAtAPoint() {
    var content = of(MapObjectContent.TEXT, POINT, null, new Text("Bridge 12\nclosed", 330.0, 16));
    assertThat(content.text()).isEqualTo(new Text("Bridge 12\nclosed", 330.0, 16));
    assertThat(content.withRelations(List.of()).text()).isEqualTo(content.text());
    assertThat(content.withFieldSets(List.of()).text()).isEqualTo(content.text());
    assertThat(Text.of("Alpha")).isEqualTo(new Text("Alpha", null, null));
  }

  @Test
  void aTextObjectNeedsItsTextAndAPointAndNoSymbol() {
    assertThatThrownBy(() -> of(MapObjectContent.TEXT, POINT, null, null)).hasMessageContaining("core.text needs");
    var line = new Geometry.LineString(List.of(Position.of(15.2, 58.4), Position.of(15.3, 58.5)));
    assertThatThrownBy(() -> of(MapObjectContent.TEXT, line, null, Text.of("A"))).hasMessageContaining("core.text needs");
    var symbol = new Symbol(SymbolStandard.APP_6D, "10031000001211000000", null);
    assertThatThrownBy(() -> of(MapObjectContent.TEXT, POINT, symbol, Text.of("A"))).hasMessageContaining("core.text needs");
  }

  @Test
  void onlyATextObjectHasAText() {
    assertThatThrownBy(() -> of(MapObjectContent.SHAPE, POINT, null, Text.of("A"))).hasMessageContaining("only a core.text");
    assertThatThrownBy(() -> of("nvg.label", POINT, null, Text.of("A"))).hasMessageContaining("only a core.text");
  }

  @Test
  void theOlderConstructorsGiveNoText() {
    var shape = new MapObjectContent(MapObjectContent.SHAPE, MapObjectContent.GENERAL, "manual", null, LAYER, POINT, null, null, null, LABEL,
        Extensions.empty(), List.of(), List.of());
    assertThat(shape.text()).isNull();
    var v130 = new MapObjectContent(MapObjectContent.SHAPE, MapObjectContent.GENERAL, "manual", null, LAYER, POINT, null, null, null, LABEL,
        Extensions.empty());
    assertThat(v130.text()).isNull();
  }

  @Test
  void theTextsLimitsAreChecked() {
    assertThatThrownBy(() -> Text.of("")).hasMessageContaining("1 to 1024");
    assertThatThrownBy(() -> Text.of("x".repeat(1025))).hasMessageContaining("1 to 1024");
    assertThat(Text.of("x".repeat(1024)).value()).hasSize(1024);
    assertThatThrownBy(() -> new Text("A", 360.0, null)).hasMessageContaining("rotation");
    assertThatThrownBy(() -> new Text("A", -0.5, null)).hasMessageContaining("rotation");
    assertThatThrownBy(() -> new Text("A", Double.NaN, null)).hasMessageContaining("rotation");
    assertThat(new Text("A", 359.9, 8).size()).isEqualTo(8);
    assertThatThrownBy(() -> new Text("A", null, 7)).hasMessageContaining("size");
    assertThatThrownBy(() -> new Text("A", null, 49)).hasMessageContaining("size");
  }
}
