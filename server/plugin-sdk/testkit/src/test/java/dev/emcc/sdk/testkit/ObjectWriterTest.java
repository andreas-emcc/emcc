package dev.emcc.sdk.testkit;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.LayerChoice;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.model.ChangeRejection;
import dev.emcc.sdk.model.EntityType;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.ExternalRef;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Operation;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.store.ObjectWriter;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;

/** SDK 1.4.0 (CR-0030 part 1b, T-147): the object writer for in plugins, against the fake store. */
class ObjectWriterTest {

  sealed interface Msg extends Message permits Start, Reply {}

  record Start() implements Msg {}

  record Reply(ObjectWriter.Reply reply) implements Msg {}

  private final Map<String, Long> counts = new HashMap<>();
  private @Nullable ObjectWriter writer;
  private int workers;

  /** A worker that owns a writer for the system {@code ais}, as a plugin's links worker would. */
  private ObjectWriter start(FakePluginContext ctx) {
    WorkerRef<Msg> w = ctx.workers().spawn(WorkerSpec.of("links-" + ++workers, Msg.class, () -> (m, c) -> {
      switch (m) {
        case Start s -> {
          writer = ObjectWriter.create(ctx, c.self(), "ais", Reply::new);
          writer.start();
        }
        case Reply r -> writer().handle(r.reply());
      }
    }));
    w.send(new Start());
    ctx.runUntilIdle();
    return writer();
  }

  private ObjectWriter writer() {
    return java.util.Objects.requireNonNull(writer);
  }

  private ObjectWriter.Target target(String name, @Nullable LayerChoice layer) {
    return new ObjectWriter.Target(name, layer, null, (what, delta) -> counts.merge(name + ": " + what, delta, Long::sum));
  }

  /** A ship at a position; lon differs from lat, so a swapped order would show. */
  private static ObjectWriter.Build at(double lon, double lat, String link) {
    return (stored, layerId) -> new MapObjectContent("core.shape", MapObjectContent.GENERAL, link, null, layerId,
        new Geometry.Point(Position.of(lon, lat)), null, null, null, dev.emcc.sdk.model.SecurityLabel.of("NATO", "UNCLASSIFIED"), Extensions.empty());
  }

  private static List<ChangeRequest> creates(FakePluginContext ctx, EntityType type) {
    return ctx.store().requests().stream().filter(r -> r.operation() == Operation.CREATE && r.entityType() == type).toList();
  }

  @Test
  void theFirstWriteMakesTheLinksLayerAndTheObjectAndTheNextUpdatesIt() {
    var ctx = FakePluginContext.builder("ais").build();
    ObjectWriter w = start(ctx);
    w.targets(List.of(target("vernon", null)));
    w.write("vernon", "002190047", at(1.4800, 49.0900, "vernon"));
    ctx.runUntilIdle();
    assertThat(ctx.store().layers()).extracting(l -> l.content().name()).containsExactly("vernon");
    assertThat(ctx.store().objects()).hasSize(1);
    MapObject ship = ctx.store().objects().getFirst();
    assertThat(ship.meta().externalRef()).isEqualTo(new ExternalRef("ais", "002190047"));
    assertThat(ship.content().geometry()).isEqualTo(new Geometry.Point(Position.of(1.4800, 49.0900)));
    assertThat(ctx.documents().stored()).containsKey(ObjectWriter.LAYERS_KEY);

    w.write("vernon", "002190047", at(1.4810, 49.0905, "vernon"));
    ctx.runUntilIdle();
    assertThat(ctx.store().objects()).hasSize(1);
    assertThat(ctx.store().objects().getFirst().content().geometry()).isEqualTo(new Geometry.Point(Position.of(1.4810, 49.0905)));
    assertThat(counts).containsEntry("vernon: objects created", 1L).containsEntry("vernon: objects updated", 1L);
    assertThat(w.stats("vernon")).isEqualTo(new ObjectWriter.Stats(1, 1, 0, "vernon"));
  }

  @Test
  void writesWhileOneIsInFlightCoalesceAndTheLatestWins() {
    var ctx = FakePluginContext.builder("ais").build();
    ObjectWriter w = start(ctx);
    w.targets(List.of(target("vernon", null)));
    for (int i = 1; i <= 50; i++) {
      w.write("vernon", "002190047", at(1.48 + i / 1000.0, 49.09, "vernon"));
    }
    ctx.runUntilIdle();
    assertThat(creates(ctx, EntityType.LAYER)).hasSize(1);
    assertThat(ctx.store().requests().stream().filter(r -> r.entityType() == EntityType.OBJECT)).as("one create, with the 50th position").hasSize(1);
    assertThat(ctx.store().objects().getFirst().content().geometry()).isEqualTo(new Geometry.Point(Position.of(1.48 + 50 / 1000.0, 49.09)));
    for (int i = 1; i <= 50; i++) {
      w.write("vernon", "002190047", at(1.6 + i / 1000.0, 49.09, "vernon"));
    }
    ctx.runUntilIdle();
    assertThat(ctx.store().requests().stream().filter(r -> r.entityType() == EntityType.OBJECT)).as("one update in flight, then the latest").hasSize(3);
    assertThat(ctx.store().objects().getFirst().content().geometry()).isEqualTo(new Geometry.Point(Position.of(1.6 + 50 / 1000.0, 49.09)));
  }

  @Test
  void aPickedLayerIsUsedAndOneThatIsGoneIsMadeByItsNameAndSharedByTwoLinks() {
    var ctx = FakePluginContext.builder("ais").build();
    Layer picked = ctx.store().seedLayer("Ships");
    ObjectWriter w = start(ctx);
    var gone = new LayerChoice(UUID.fromString("7d3f1a52-2b4e-4c1f-9e0a-5b6c7d8e9f10"), "Seine");
    w.targets(List.of(target("vernon", new LayerChoice(picked.id(), "Ships")), target("rouen", gone), target("paris", gone)));
    w.write("vernon", "002190047", at(1.48, 49.09, "vernon"));
    w.write("rouen", "227006760", at(1.09, 49.44, "rouen"));
    w.write("paris", "226013750", at(2.35, 48.86, "paris"));
    ctx.runUntilIdle();
    assertThat(creates(ctx, EntityType.LAYER)).as("one new layer for the two links that name it").hasSize(1);
    Layer seine = ctx.store().layers().stream().filter(l -> l.content().name().equals("Seine")).findFirst().orElseThrow();
    Map<String, UUID> layerOf = new HashMap<>();
    ctx.store().objects().forEach(o -> layerOf.put(o.content().dataSource(), o.content().layerId()));
    assertThat(layerOf).containsEntry("vernon", picked.id()).containsEntry("rouen", seine.id()).containsEntry("paris", seine.id());
  }

  @Test
  void aRestartedWriterFindsItsObjectsByExternalIdentityAndItsLayersInTheDocument() {
    var ctx = FakePluginContext.builder("ais").build();
    ObjectWriter first = start(ctx);
    first.targets(List.of(target("vernon", null)));
    first.write("vernon", "002190047", at(1.48, 49.09, "vernon"));
    ctx.runUntilIdle();
    first.stop();

    ObjectWriter again = start(ctx);
    again.targets(List.of(target("vernon", null)));
    again.write("vernon", "002190047", at(1.49, 49.10, "vernon"));
    again.write("vernon", "227006760", at(1.50, 49.11, "vernon"));
    ctx.runUntilIdle();
    assertThat(creates(ctx, EntityType.LAYER)).as("the layer from the document, not a second one").hasSize(1);
    assertThat(ctx.store().objects()).hasSize(2);
    assertThat(again.object("002190047").content().geometry()).isEqualTo(new Geometry.Point(Position.of(1.49, 49.10)));
  }

  /** A user's move into another layer, as `draw-symbols` would send it. */
  private static void moveAsUser(FakePluginContext ctx, MapObject stored, Layer to) {
    var c = stored.content();
    var moved = new MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), to.id(), c.geometry(), c.symbol(), c.style(),
        c.properties(), c.label(), c.extensions(), c.fieldSets(), c.relations());
    assertThat(ctx.store().applyAs(dev.emcc.sdk.model.Actor.plugin("draw-symbols"), dev.emcc.sdk.store.Change.updateObject(stored, moved)))
        .isInstanceOf(dev.emcc.sdk.store.ChangeOutcome.Applied.class);
  }

  @Test
  void cr0039AMovedObjectIsUpdatedInTheLayerAUserMovedItInto() {
    var ctx = FakePluginContext.builder("ais").build();
    ObjectWriter w = start(ctx);
    w.targets(List.of(target("vernon", null)));
    w.write("vernon", "002190047", at(1.48, 49.09, "vernon"));
    ctx.runUntilIdle();
    Layer mine = ctx.store().seedLayer("My tracks");
    moveAsUser(ctx, w.object("002190047"), mine);
    ctx.runUntilIdle();

    w.write("vernon", "002190047", at(1.49, 49.10, "vernon"));
    w.write("vernon", "227006760", at(1.50, 49.11, "vernon"));
    ctx.runUntilIdle();
    assertThat(w.object("002190047").content().layerId()).as("updated where the user put it").isEqualTo(mine.id());
    assertThat(w.object("002190047").content().geometry()).isEqualTo(new Geometry.Point(Position.of(1.49, 49.10)));
    assertThat(ctx.store().layers().stream().filter(l -> l.id().equals(w.object("227006760").content().layerId())).findFirst().orElseThrow()
        .content().name()).as("a new object in the link's layer").isEqualTo("vernon");
  }

  @Test
  void cr0039AfterALostDocumentNewObjectsGoToTheLinksLayerNotOneAUserMovedATrackInto() {
    var ctx = FakePluginContext.builder("ais").build();
    ObjectWriter first = start(ctx);
    first.targets(List.of(target("vernon", null)));
    first.write("vernon", "002190047", at(1.48, 49.09, "vernon"));
    ctx.runUntilIdle();
    UUID links = first.object("002190047").content().layerId();
    Layer mine = ctx.store().seedLayer("My tracks");
    moveAsUser(ctx, first.object("002190047"), mine);
    ctx.runUntilIdle();
    first.stop();
    ctx.documents().seed(ObjectWriter.LAYERS_KEY, dev.emcc.sdk.json.JsonObject.empty()); // the document is lost

    ObjectWriter again = start(ctx);
    again.targets(List.of(target("vernon", null)));
    again.write("vernon", "227006760", at(1.50, 49.11, "vernon"));
    ctx.runUntilIdle();
    assertThat(again.object("227006760").content().layerId()).as("the layer of the link's name, adopted").isEqualTo(links);
    assertThat(creates(ctx, EntityType.LAYER)).as("adopted, not made again").hasSize(1);
    assertThat(again.object("002190047").content().layerId()).isEqualTo(mine.id());
  }

  @Test
  void cr0039AfterALostDocumentWithoutALayerOfTheLinksNameANewOneIsMadeEvenWhenATrackIsInAUsersLayer() {
    var ctx = FakePluginContext.builder("ais").build();
    Layer mine = ctx.store().seedLayer("My tracks");
    ObjectWriter first = start(ctx);
    first.targets(List.of(target("vernon", null)));
    first.write("vernon", "002190047", at(1.48, 49.09, "vernon"));
    ctx.runUntilIdle();
    Layer links = ctx.store().layers().stream().filter(l -> l.content().name().equals("vernon")).findFirst().orElseThrow();
    moveAsUser(ctx, first.object("002190047"), mine);
    ctx.runUntilIdle();
    assertThat(ctx.store().applyAs(dev.emcc.sdk.model.Actor.plugin("layer-panel"), dev.emcc.sdk.store.Change.deleteLayer(links)))
        .isInstanceOf(dev.emcc.sdk.store.ChangeOutcome.Applied.class);
    first.stop();
    ctx.documents().seed(ObjectWriter.LAYERS_KEY, dev.emcc.sdk.json.JsonObject.empty());

    ObjectWriter again = start(ctx);
    again.targets(List.of(target("vernon", null)));
    again.write("vernon", "227006760", at(1.50, 49.11, "vernon"));
    ctx.runUntilIdle();
    UUID placed = again.object("227006760").content().layerId();
    assertThat(placed).as("never the user's layer").isNotEqualTo(mine.id());
    assertThat(ctx.store().layers().stream().filter(l -> l.id().equals(placed)).findFirst().orElseThrow().content().name()).isEqualTo("vernon");
    assertThat(creates(ctx, EntityType.LAYER)).as("made again by its name").hasSize(2);
  }

  @Test
  void aLostAnswerIsLookedUpSoTheObjectIsNotMadeTwice() {
    var ctx = FakePluginContext.builder("ais").build();
    ObjectWriter w = start(ctx);
    w.targets(List.of(target("vernon", null)));
    w.write("vernon", "002190047", at(1.48, 49.09, "vernon"));
    ctx.runUntilIdle(); // the layer and the object
    ctx.store().loseNextAnswer();
    w.write("vernon", "002190047", at(1.49, 49.10, "vernon"));
    ctx.runUntilIdle();
    ctx.advance(Duration.ofSeconds(11));
    ctx.runUntilIdle();
    assertThat(ctx.store().objects()).hasSize(1);
    assertThat(ctx.store().objects().getFirst().content().geometry()).isEqualTo(new Geometry.Point(Position.of(1.49, 49.10)));
  }

  @Test
  void aRejectionIsCountedAndAWriteWithNothingNewSendsNothing() {
    var ctx = FakePluginContext.builder("ais").build();
    ObjectWriter w = start(ctx);
    w.targets(List.of(target("vernon", null)));
    w.write("vernon", "002190047", at(1.48, 49.09, "vernon"));
    ctx.runUntilIdle();
    int before = ctx.store().requests().size();
    w.write("vernon", "002190047", at(1.48, 49.09, "vernon"));
    w.write("vernon", "002190047", (stored, layerId) -> null);
    ctx.runUntilIdle();
    assertThat(ctx.store().requests()).as("the same content, and nothing").hasSize(before);
    ctx.store().rejectNext(ChangeRejection.Code.VALIDATION_FAILED, "no");
    w.write("vernon", "002190047", at(1.49, 49.09, "vernon"));
    ctx.runUntilIdle();
    assertThat(counts).containsEntry("vernon: rejected: VALIDATION_FAILED", 1L);
    assertThat(w.stats("vernon").rejected()).isEqualTo(1);
  }

  @Test
  void writesForATargetThatIsNotSetAreDropped() {
    var ctx = FakePluginContext.builder("ais").build();
    ObjectWriter w = start(ctx);
    w.targets(List.of(target("vernon", null)));
    w.targets(List.of());
    w.write("vernon", "002190047", at(1.48, 49.09, "vernon"));
    ctx.runUntilIdle();
    assertThat(ctx.store().requests()).isEmpty();
    assertThat(new ArrayList<>(ctx.store().objects())).isEmpty();
  }

  @Test
  void withAFieldSetEveryWrittenObjectCarriesThePluginsSetFromTheStart() {
    var ctx = FakePluginContext.builder("ais")
        .declaredFields(new dev.emcc.sdk.DeclaredField("ais", "mmsi", dev.emcc.sdk.DeclaredField.Type.TEXT, "MMSI", null, null, null, null, 9, false, List.of(), false, List.of()))
        .fieldSets(new dev.emcc.sdk.FieldSet("ais", "ship", "AIS ship", List.of("mmsi")))
        .build();
    ObjectWriter w = start(ctx);
    w.fieldSet("ais.ship");
    w.targets(List.of(target("vernon", null)));
    w.write("vernon", "002190047", at(1.4800, 49.0900, "vernon"));
    ctx.runUntilIdle();
    assertThat(ctx.store().objects().getFirst().content().fieldSets()).containsExactly("ais.ship");
    w.write("vernon", "002190047", at(1.4810, 49.0905, "vernon"));
    ctx.runUntilIdle();
    assertThat(ctx.store().objects().getFirst().content().fieldSets()).as("kept once on update").containsExactly("ais.ship");
    assertThat(w.stats("vernon").rejected()).isZero();
    org.assertj.core.api.Assertions.assertThatThrownBy(() -> w.fieldSet("cot.unit")).as("only the plugin's own set").isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void objectIdAnswersFromTheFirstWriteWhileTheCreateIsInFlightAndThenGivesTheStoredId() {
    var ctx = FakePluginContext.builder("gmti").build();
    ObjectWriter w = start(ctx);
    w.targets(List.of(target("link", null)));
    assertThat(w.objectId("link/PLATFORM01")).as("never written").isNull();
    w.write("link", "link/PLATFORM01", at(11.00, 22.00, "link"));
    java.util.UUID reserved = w.objectId("link/PLATFORM01");
    assertThat(reserved).as("known before the layer and the create are done").isNotNull();
    ctx.runUntilIdle();
    assertThat(ctx.store().objects()).singleElement().extracting(MapObject::id).isEqualTo(reserved);
    assertThat(w.objectId("link/PLATFORM01")).isEqualTo(reserved);
    w.write("link", "link/PLATFORM01", at(11.01, 22.01, "link"));
    ctx.runUntilIdle();
    assertThat(w.objectId("link/PLATFORM01")).as("an update keeps the id").isEqualTo(reserved);
  }

  @Test
  void aWriteThatBuildsNothingReleasesItsReservation() {
    var ctx = FakePluginContext.builder("gmti").build();
    ObjectWriter w = start(ctx);
    w.targets(List.of(target("vista", null)));
    w.write("vista", "vista/none", (stored, layerId) -> null);
    ctx.runUntilIdle();
    assertThat(w.objectId("vista/none")).isNull();
  }
}
