package dev.emcc.sdk.store;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.ExternalRef;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.LayerContent;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Meta;
import dev.emcc.sdk.model.Operation;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;

class StoreTypesTest {

  private static final UUID LAYER = UUID.fromString("0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e02");
  private static final SecurityLabel LABEL = SecurityLabel.of("NATO", "UNCLASSIFIED");
  private static final ExternalRef REF = new ExternalRef("cot", "ANDROID-358240051111110");
  private static final MapObjectContent CONTENT = new MapObjectContent(
      "core.shape", "cot-in.cot", "tak-north", null, LAYER, new Geometry.Point(Position.of(18.1012, 59.3507)), null, null, null, LABEL, Extensions.empty());

  private static MapObject stored(MapObjectContent content, @Nullable ExternalRef ref) {
    var audit = new Meta.Audit(Instant.EPOCH, new Actor("cot-in", null, "tak-north"));
    return new MapObject(UUID.randomUUID(), 4, content, new Meta(audit, audit, ref));
  }

  @Test
  void aChangeBecomesTheFullRequestWithThePluginAndTheSystem() {
    UUID id = UUID.randomUUID();
    UUID requestId = UUID.randomUUID();
    var request = Change.createObject(id, CONTENT).withExternalRef(REF).bySystem("tak-north").toRequest(requestId, "cot-in");
    assertThat(request.requestId()).isEqualTo(requestId);
    assertThat(request.operation()).isEqualTo(Operation.CREATE);
    assertThat(request.externalRef()).isEqualTo(REF);
    assertThat(request.source()).isEqualTo(new Actor("cot-in", null, "tak-north"));

    MapObject current = stored(CONTENT, REF);
    var update = Change.updateObject(current, CONTENT);
    assertThat(update.baseVersion()).isEqualTo(4L);
    assertThat(update.entityId()).isEqualTo(current.id());
    assertThat(Change.deleteObject(current).data()).isNull();
  }

  @Test
  void aChangeIsCheckedLikeAChangeRequest() {
    MapObject current = stored(CONTENT, REF);
    assertThatThrownBy(() -> Change.updateObject(current, CONTENT).withExternalRef(REF)).hasMessageContaining("externalRef");
    var layer = new LayerContent("TAK north", 1, true, LABEL, Extensions.empty());
    assertThatThrownBy(() -> Change.createLayer(UUID.randomUUID(), layer).withExternalRef(REF)).hasMessageContaining("externalRef");
    assertThatThrownBy(() -> Change.createObject(UUID.randomUUID(), CONTENT).bySystem("")).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void queriesMatchTheirAttributes() {
    MapObject cot = stored(CONTENT, REF);
    MapObject drawn = stored(
        new MapObjectContent("core.shape", MapObjectContent.GENERAL, MapObjectContent.MANUAL, null, LAYER, CONTENT.geometry(), null, null, null, LABEL, Extensions.empty()),
        null);
    assertThat(ObjectQuery.all().matchesAttributes(drawn)).isTrue();
    assertThat(ObjectQuery.byExternalRef(REF).matchesAttributes(cot)).isTrue();
    assertThat(ObjectQuery.byExternalRef(new ExternalRef("cot", "other")).matchesAttributes(cot)).isFalse();
    assertThat(ObjectQuery.byExternalSystem("cot").matchesAttributes(drawn)).isFalse();
    assertThat(ObjectQuery.byDataSource("tak-north").ofDataType("cot-in.cot").inLayer(LAYER).matchesAttributes(cot)).isTrue();
    assertThat(ObjectQuery.byDataSource("tak-north").matchesAttributes(drawn)).isFalse();
    assertThat(ObjectQuery.all().ofDataType("cot-in.cot").matchesAttributes(drawn)).isFalse();
    assertThat(ObjectQuery.all().inLayer(UUID.randomUUID()).matchesAttributes(cot)).isFalse();
  }

  @Test
  void queriesRejectBadValues() {
    assertThatThrownBy(() -> ObjectQuery.all().limit(0)).hasMessageContaining("limit");
    assertThatThrownBy(() -> ObjectQuery.all().limit(ObjectQuery.MAX_LIMIT + 1)).hasMessageContaining("limit");
    assertThatThrownBy(() -> ObjectQuery.byExternalSystem("nvg").withExternalRef(REF)).hasMessageContaining("system");
  }

  @Test
  void anAreaIsAClosedRingWithAPointInsideAndAMargin() {
    var ring = List.of(Position.of(10, 50), Position.of(20, 50), Position.of(20, 60), Position.of(10, 50));
    Area area = Area.of(ring, Position.of(17, 53));
    assertThat(area.margin()).isEqualTo(new Area.Margin.None());
    assertThat(area.withMargin(new Area.Margin.Share(0.5)).margin()).isEqualTo(new Area.Margin.Share(0.5));
    assertThat(ObjectQuery.all().within(area).within()).isEqualTo(area);
    assertThatThrownBy(() -> Area.of(ring.subList(0, 3), Position.of(17, 53))).hasMessageContaining("at least 4");
    assertThatThrownBy(() -> Area.of(List.of(Position.of(10, 50), Position.of(20, 50), Position.of(20, 60), Position.of(11, 50)), Position.of(17, 53)))
        .hasMessageContaining("closed");
    assertThatThrownBy(() -> new Area.Margin.Metres(-1)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Area.Margin.Share(Double.NaN)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void resultsAreImmutableAndBatchesAreNotEmpty() {
    var objects = new ArrayList<MapObject>(List.of(stored(CONTENT, REF)));
    var found = new QueryResult.Found(objects, List.of(), 7);
    objects.clear();
    assertThat(found.objects()).hasSize(1);
    assertThatThrownBy(() -> found.objects().clear()).isInstanceOf(UnsupportedOperationException.class);
    assertThatThrownBy(() -> new StoreUpdate.Changes(List.of())).hasMessageContaining("at least one");
  }
}
