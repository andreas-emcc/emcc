package dev.emcc.sdk.model;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class ModelTypesTest {

  private static final UUID LAYER = UUID.fromString("0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e01");
  private static final SecurityLabel LABEL = SecurityLabel.of("NATO", "UNCLASSIFIED");

  @Test
  void positionsAreLongitudeFirst() {
    Position p = Position.of(18.0686, 59.3293);
    assertThat(p.longitude()).isEqualTo(18.0686);
    assertThat(p.latitude()).isEqualTo(59.3293);
    // Tokyo with swapped coordinates: the latitude position holds 139.69, which is out of range.
    assertThatThrownBy(() -> Position.of(35.6895, 139.6917)).hasMessageContaining("lon, lat order");
    assertThatThrownBy(() -> Position.of(180.5, 10)).hasMessageContaining("longitude");
  }

  @Test
  void symbolObjectsNeedASymbolAndAPoint() {
    var point = new Geometry.Point(Position.of(18.0686, 59.3293));
    var symbol = new Symbol(SymbolStandard.APP_6D, "10031000001211000000", null);
    assertThat(new MapObjectContent("core.symbol", MapObjectContent.GENERAL, MapObjectContent.MANUAL, null, LAYER, point, symbol, null, null, LABEL, Extensions.empty()).symbol()).isEqualTo(symbol);
    assertThatThrownBy(() -> new MapObjectContent("core.symbol", MapObjectContent.GENERAL, MapObjectContent.MANUAL, null, LAYER, point, null, null, null, LABEL, Extensions.empty()))
        .isInstanceOf(IllegalArgumentException.class);
    var line = new Geometry.LineString(List.of(Position.of(18.0, 59.3), Position.of(18.1, 59.4)));
    assertThatThrownBy(() -> new MapObjectContent("core.symbol", MapObjectContent.GENERAL, MapObjectContent.MANUAL, null, LAYER, line, symbol, null, null, LABEL, Extensions.empty()))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new MapObjectContent("core.shape", MapObjectContent.GENERAL, MapObjectContent.MANUAL, null, LAYER, point, symbol, null, null, LABEL, Extensions.empty()))
        .isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void emptyOptionalPartsBecomeAbsent() {
    var point = new Geometry.Point(Position.of(18.0686, 59.3293));
    var content = new MapObjectContent("core.shape", MapObjectContent.GENERAL, MapObjectContent.MANUAL, null, LAYER, point, null, new Style(null, null, null, null, null, null), new ObjectProperties(null, null), LABEL, Extensions.empty());
    assertThat(content.style()).isNull();
    assertThat(content.properties()).isNull();
    assertThat(new Symbol(SymbolStandard.APP_6D, "10031000001211000000", Modifiers.builder().build()).modifiers()).isNull();
  }

  @Test
  void styleKeepsTheOneZeroConstructorAndAddsTheOneOneFields() {
    // Data model 1.0.0's six-argument constructor stays (CR-0014): the 1.1.0 fields are then absent.
    var old = new Style("#A33A3A", 2.0, null, Style.Dash.DASH, "#FF8080", 0.2);
    assertThat(old.fillPattern()).isNull();
    assertThat(old.arrowhead()).isNull();
    assertThat(old.pointMarkers()).isNull();
    assertThat(old).isEqualTo(new Style("#A33A3A", 2.0, null, Style.Dash.DASH, "#FF8080", 0.2, null, null, null));

    var route = new Style("#2C784C", 2.0, null, null, null, null, null, Style.Arrowhead.NONE, Style.PointMarkers.CIRCLE);
    assertThat(route.isEmpty()).isFalse();
    assertThat(new Style(null, null, null, null, null, null, Style.FillPattern.HATCH, null, null).isEmpty()).isFalse();
    assertThat(new Style(null, null, null, null, null, null, null, null, null).isEmpty()).isTrue();

    assertThat(Style.FillPattern.fromJson("hatch")).isEqualTo(Style.FillPattern.HATCH);
    assertThat(Style.Arrowhead.fromJson("end").json()).isEqualTo("end");
    assertThat(Style.PointMarkers.fromJson("circle")).isEqualTo(Style.PointMarkers.CIRCLE);
    assertThatThrownBy(() -> Style.FillPattern.fromJson("cross")).hasMessageContaining("fillPattern");
    assertThatThrownBy(() -> Style.Arrowhead.fromJson("start")).hasMessageContaining("arrowhead");
    assertThatThrownBy(() -> Style.PointMarkers.fromJson("square")).hasMessageContaining("pointMarkers");
  }

  @Test
  void app6eSidcsWithTenTrailingZerosAreStoredInTheShortForm() {
    var longForm = new Symbol(SymbolStandard.APP_6E, "130310000012110000000000000000", null);
    var shortForm = new Symbol(SymbolStandard.APP_6E, "13031000001211000000", null);
    assertThat(longForm.sidc()).isEqualTo("13031000001211000000");
    assertThat(longForm).isEqualTo(shortForm);
    assertThat(new Symbol(SymbolStandard.APP_6E, "130310000012110000000000000752", null).sidc()).hasSize(30);
    assertThat(Symbol.canonicalSidc(SymbolStandard.APP_6D, "10031000001211000000")).isEqualTo("10031000001211000000");
  }

  @Test
  void modifiersCheckTheirValues() {
    assertThat(Modifiers.builder().text(TextModifier.UNIQUE_DESIGNATION, "VIPER 2").direction(270).speed(4.2).build().text(TextModifier.UNIQUE_DESIGNATION))
        .isEqualTo("VIPER 2");
    assertThatThrownBy(() -> Modifiers.builder().direction(360).build()).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Modifiers.builder().speed(-3).build()).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Modifiers.builder().text(TextModifier.TYPE, "").build()).isInstanceOf(IllegalArgumentException.class);
    assertThat(TextModifier.fromJson("iffSif")).isEqualTo(TextModifier.IFF_SIF);
  }

  @Test
  void theGraphicsAmplifiersOf140AreCheckedAndTheOldConstructorLeavesThemEmpty() {
    Modifiers fan = Modifiers.builder().distances(List.of(500.0, 3000.0)).azimuths(List.of(315.0, 45.0, 360.0)).text(TextModifier.UNIQUE_DESIGNATION_1, "3 BDE").build();
    assertThat(fan.distances()).containsExactly(500.0, 3000.0);
    assertThat(fan.azimuths()).containsExactly(315.0, 45.0, 360.0);
    assertThat(fan.isEmpty()).isFalse();
    assertThat(Modifiers.builder().distances(List.of(1.0)).build().isEmpty()).as("distances alone are not empty").isFalse();
    assertThat(new Modifiers(java.util.Map.of(), 90.0, 5.0)).isEqualTo(new Modifiers(java.util.Map.of(), 90.0, 5.0, List.of(), List.of()));
    assertThatThrownBy(() -> Modifiers.builder().azimuths(List.of(361.0)).build()).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Modifiers.builder().azimuths(null).build()).isInstanceOf(NullPointerException.class).hasMessage("azimuths");
    assertThatThrownBy(() -> Modifiers.builder().distances(List.of(-1.0)).build()).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Modifiers.builder().distances(List.of(Modifiers.MAX_DISTANCE + 1)).build()).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> Modifiers.builder().distances(java.util.Collections.nCopies(65, 1.0)).build()).isInstanceOf(IllegalArgumentException.class);
    assertThat(TextModifier.fromJson("uniqueDesignation2")).isEqualTo(TextModifier.UNIQUE_DESIGNATION_2);
    assertThat(TextModifier.fromJson("dtg1")).isEqualTo(TextModifier.DTG_1);
    assertThat(TextModifier.fromJson("targetNumber")).isEqualTo(TextModifier.TARGET_NUMBER);
  }

  @Test
  void changeRequestsMatchOperationAndData() {
    var layer = new LayerContent("Own forces", 20.5, true, LABEL, Extensions.empty());
    UUID id = UUID.randomUUID();
    assertThat(ChangeRequest.create(UUID.randomUUID(), id, layer, Actor.plugin("layer-panel")).entityType()).isEqualTo(EntityType.LAYER);
    assertThatThrownBy(() -> new ChangeRequest(UUID.randomUUID(), EntityType.LAYER, Operation.DELETE, id, 1L, layer, null, Actor.plugin("layer-panel")))
        .hasMessageContaining("no data");
    assertThatThrownBy(() -> new ChangeRequest(UUID.randomUUID(), EntityType.OBJECT, Operation.UPDATE, id, 1L, layer, null, Actor.plugin("layer-panel")))
        .hasMessageContaining("entityType");
  }

  @Test
  void changeEventsAreConsistent() {
    UUID id = UUID.randomUUID();
    var meta = new Meta(new Meta.Audit(Instant.EPOCH, Actor.plugin("layer-panel")), new Meta.Audit(Instant.EPOCH, Actor.plugin("layer-panel")), null);
    var state = new Layer(id, 1, new LayerContent("A", 1, true, LABEL, Extensions.empty()), meta);
    var created = new ChangeEvent(1, UUID.randomUUID(), EntityType.LAYER, Operation.CREATE, id, 1, null, null, state, LABEL, Instant.EPOCH, Actor.plugin("layer-panel"));
    assertThat(created.state()).isEqualTo(state);
    assertThatThrownBy(() -> new ChangeEvent(2, UUID.randomUUID(), EntityType.LAYER, Operation.DELETE, id, 3, 1L, null, null, LABEL, Instant.EPOCH, Actor.plugin("layer-panel")))
        .hasMessageContaining("previousVersion + 1");
    assertThatThrownBy(() -> new ChangeEvent(2, UUID.randomUUID(), EntityType.LAYER, Operation.DELETE, id, 2, 1L, null, state, LABEL, Instant.EPOCH, Actor.plugin("layer-panel")))
        .hasMessageContaining("null exactly for a delete");
  }

  @Test
  void objectsHaveADataTypeAndADataSource() {
    var point = new Geometry.Point(Position.of(18.1012, 59.3507));
    var symbol = new Symbol(SymbolStandard.APP_6B, "SFGPUCI--------", null);
    var cot = new MapObjectContent("core.symbol", "cot-in.cot", "tak-north", null, LAYER, point, symbol, null, null, LABEL, Extensions.empty());
    assertThat(cot.dataType()).isEqualTo("cot-in.cot");
    assertThat(cot.dataSource()).isEqualTo("tak-north");
    assertThatThrownBy(() -> new MapObjectContent("core.symbol", "cot", "tak-north", null, LAYER, point, symbol, null, null, LABEL, Extensions.empty()))
        .hasMessageContaining("dataType");
    assertThatThrownBy(() -> new MapObjectContent("core.symbol", "cot-in.cot", "TAK_North", null, LAYER, point, symbol, null, null, LABEL, Extensions.empty()))
        .hasMessageContaining("dataSource");
    assertThatThrownBy(() -> new MapObjectContent("core.symbol", "cot-in.cot", "a".repeat(65), null, LAYER, point, symbol, null, null, LABEL, Extensions.empty()))
        .hasMessageContaining("dataSource");
  }

  @Test
  void emptyTimeAttributesBecomeAbsentAndValidFromAfterExpiresIsLeftToTheStore() {
    var point = new Geometry.Point(Position.of(18.1012, 59.3507));
    var empty = new MapObjectContent("core.shape", MapObjectContent.GENERAL, MapObjectContent.MANUAL, new TimeAttributes(null, null, null), LAYER, point, null, null, null, LABEL, Extensions.empty());
    assertThat(empty.time()).isNull();
    Instant expires = Instant.parse("2026-10-03T08:25:00Z");
    var reversed = new TimeAttributes(null, expires.plusSeconds(300), expires);   // model rule 15, checked by the object store
    assertThat(new MapObjectContent("core.shape", "cot-in.cot", "tak-north", reversed, LAYER, point, null, null, null, LABEL, Extensions.empty()).time()).isEqualTo(reversed);
  }

  @Test
  void onlyTheCreateOfAnObjectCarriesAnExternalRef() {
    var point = new Geometry.Point(Position.of(18.1012, 59.3507));
    var content = new MapObjectContent("core.shape", "cot-in.cot", "tak-north", null, LAYER, point, null, null, null, LABEL, Extensions.empty());
    var ref = new ExternalRef("cot", "ANDROID-358240051111110");
    UUID id = UUID.randomUUID();
    assertThat(ChangeRequest.create(UUID.randomUUID(), id, content, ref, Actor.plugin("cot-in")).externalRef()).isEqualTo(ref);
    assertThatThrownBy(() -> new ChangeRequest(UUID.randomUUID(), EntityType.OBJECT, Operation.UPDATE, id, 1L, content, ref, Actor.plugin("cot-in")))
        .hasMessageContaining("externalRef");
    var layer = new LayerContent("TAK north", 1, true, LABEL, Extensions.empty());
    assertThatThrownBy(() -> new ChangeRequest(UUID.randomUUID(), EntityType.LAYER, Operation.CREATE, id, null, layer, ref, Actor.plugin("cot-in")))
        .hasMessageContaining("externalRef");
    assertThatThrownBy(() -> new ExternalRef("cot", "")).isInstanceOf(IllegalArgumentException.class);
    assertThat(ChangeRejection.Code.valueOf("EXTERNAL_REF_EXISTS")).isNotNull();
  }

  @Test
  void extensionNamespacesArePluginIds() {
    assertThatThrownBy(() -> Extensions.empty().with("Draw_Symbols", dev.emcc.sdk.json.JsonObject.empty())).isInstanceOf(IllegalArgumentException.class);
  }
}
