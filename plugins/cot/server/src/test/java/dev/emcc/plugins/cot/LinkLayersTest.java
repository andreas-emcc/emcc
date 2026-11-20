package dev.emcc.plugins.cot;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.cot.codec.Samples;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.ChangeRejection;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.Operation;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.store.Change;
import java.time.Duration;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** Acceptance criterion 22 and brief function 13: where a link's objects go, and which layer is reported. */
class LinkLayersTest {

  @AfterEach
  void closeRigs() {
    Rig.closeAll();
  }

  private static String target(String json) {
    return "\"targetLayer\":" + json;
  }

  @Test
  void aLinkWithoutATargetMakesALayerNamedLikeItself() {
    var rig = new Rig("tak-north");
    rig.feed("tak-north", Samples.at("n1", 0, 59.0, 18.0));
    assertThat(rig.layerOf(rig.object("n1")).content().name()).isEqualTo("tak-north");
  }

  @Test
  void aNewLayerGetsTheNameTheAdminGave() {
    var rig = new Rig();
    rig.addLink("tak-north", target("{\"name\":\"Tracks from the north\"}"));
    rig.feed("tak-north", Samples.at("n1", 0, 59.0, 18.0));
    assertThat(rig.layerOf(rig.object("n1")).content().name()).isEqualTo("Tracks from the north");
    assertThat(rig.object("n1").content().dataSource()).as("the data source is still the link").isEqualTo("tak-north");
  }

  @Test
  void criterion22_twoLinksThatNameTheSameNewLayerShareOne() {
    var rig = new Rig();
    rig.addLink("tak-north", target("{\"name\":\"TAK\"}"));
    rig.addLink("tak-south", target("{\"name\":\"TAK\"}"));
    rig.feed("tak-north", Samples.at("n1", 0, 59.0, 18.0));
    rig.feed("tak-south", Samples.at("s1", 0, 55.0, 13.0));
    assertThat(rig.ctx.store().layers()).extracting(l -> l.content().name()).containsExactly("TAK");
    assertThat(rig.object("n1").content().layerId()).isEqualTo(rig.object("s1").content().layerId());
    assertThat(rig.object("n1").content().dataSource()).isEqualTo("tak-north");
    assertThat(rig.object("s1").content().dataSource()).isEqualTo("tak-south");
  }

  @Test
  void twoLinksThatHaveEventsWaitingForTheSameNewLayerBothGoOnWhenItIsMade() {
    var rig = new Rig();
    rig.addLink("tak-north", target("{\"name\":\"TAK\"}"));
    rig.addLink("tak-south", target("{\"name\":\"TAK\"}"));
    rig.ctx.store().dropNextRequest(); // the layer's creation is lost: it is made again after its timeout
    rig.conn("tak-north").send(Samples.at("n1", 0, 59.0, 18.0));
    rig.conn("tak-south").send(Samples.at("s1", 0, 55.0, 13.0));
    rig.settle("tak-north", 1);
    rig.settle("tak-south", 1);
    rig.advance(Duration.ofSeconds(11));
    rig.advance(Duration.ofSeconds(6));
    assertThat(rig.ctx.store().layers()).hasSize(1);
    assertThat(rig.objects()).hasSize(2);
  }

  @Test
  void criterion22_aPickedLayerIsUsedAsItIs() {
    var rig = new Rig();
    Layer picked = rig.ctx.store().seedLayer("Own forces");
    rig.ctx.store().gap();
    rig.ctx.runUntilIdle();
    rig.addLink("tak-north", target("{\"id\":\"" + picked.id() + "\",\"name\":\"Own forces\"}"));
    rig.feed("tak-north", Samples.at("n1", 0, 59.0, 18.0));
    assertThat(rig.object("n1").content().layerId()).isEqualTo(picked.id());
    assertThat(rig.ctx.store().layers()).as("no layer is made").hasSize(1);
    assertThat(rig.requests(Operation.CREATE)).as("only the object").isEqualTo(1L);
  }

  @Test
  void criterion22_theStatusShowsEachLinksActualLayer() {
    var rig = new Rig();
    Layer picked = rig.ctx.store().seedLayer("Own forces");
    rig.ctx.store().gap();
    rig.ctx.runUntilIdle();
    rig.addLink("tak-north", target("{\"id\":\"" + picked.id() + "\",\"name\":\"Own forces\"}"));
    rig.addLink("tak-south", "");
    rig.addLink("tak-east", target("{\"name\":\"East\"}"));
    rig.feed("tak-north", Samples.at("n1", 0, 59.0, 18.0));
    rig.feed("tak-south", Samples.at("s1", 0, 55.0, 13.0));
    rig.feed("tak-east", Samples.at("e1", 0, 58.0, 19.0));
    rig.advance(Duration.ofSeconds(1));
    assertThat(rig.status()).contains("layer 'Own forces'").contains("layer 'tak-south'").contains("layer 'East'");
  }

  @Test
  void criterion22_aDeletedTargetLayerIsMadeAgainAtTheNextEvent() {
    var rig = new Rig("tak-north");
    rig.feed("tak-north", Samples.at("u1", 0, 59.0, 18.0));
    var oldLayer = rig.layerOf(rig.object("u1"));
    // only an empty layer can be deleted: the object is deleted first
    rig.ctx.store().applyAs(Actor.plugin("ecore"), Change.deleteObject(rig.object("u1")));
    rig.ctx.store().applyAs(Actor.plugin("layer-panel"), Change.deleteLayer(oldLayer));
    rig.ctx.runUntilIdle();
    assertThat(rig.ctx.store().layers()).isEmpty();

    rig.feed("tak-north", Samples.at("u1", 10, 59.1, 18.1));
    assertThat(rig.objects()).hasSize(1);
    assertThat(rig.layerOf(rig.object("u1")).id()).isNotEqualTo(oldLayer.id());
    assertThat(rig.layerOf(rig.object("u1")).content().name()).isEqualTo("tak-north");
  }

  @Test
  void aPickedLayerThatIsDeletedLaterIsMadeAgainAtTheNextObjectAndKeptFromThenOn() {
    var rig = new Rig();
    Layer picked = rig.ctx.store().seedLayer("Own forces"); // what the shell's "+" makes: a layer at once, picked with its id (T-133)
    rig.ctx.store().gap();
    rig.ctx.runUntilIdle();
    rig.addLink("tak-north", target("{\"id\":\"" + picked.id() + "\",\"name\":\"Own forces\"}"));
    rig.feed("tak-north", Samples.at("n1", 0, 59.0, 18.0));
    assertThat(rig.object("n1").content().layerId()).isEqualTo(picked.id());
    // only an empty layer can be deleted: the object is deleted first
    rig.ctx.store().applyAs(Actor.plugin("ecore"), Change.deleteObject(rig.object("n1")));
    rig.ctx.store().applyAs(Actor.plugin("layer-panel"), Change.deleteLayer(picked));
    rig.ctx.runUntilIdle();

    rig.feed("tak-north", Samples.at("n1", 10, 59.1, 18.1));
    Layer again = rig.layerOf(rig.object("n1"));
    assertThat(again.id()).isNotEqualTo(picked.id());
    assertThat(again.content().name()).isEqualTo("Own forces");
    rig.feed("tak-north", Samples.at("n2", 20, 59.2, 18.2));
    assertThat(rig.object("n2").content().layerId()).isEqualTo(again.id());
    assertThat(rig.ctx.store().layers()).hasSize(1);
  }

  @Test
  void aPickedLayerThatIsGoneIsMadeAgainUnderItsName() {
    var rig = new Rig();
    UUID gone = UUID.fromString("0198a0a0-0000-7000-8000-00000000dead");
    rig.addLink("tak-north", target("{\"id\":\"" + gone + "\",\"name\":\"Gone layer\"}"));
    rig.feed("tak-north", Samples.at("n1", 0, 59.0, 18.0));
    assertThat(rig.layerOf(rig.object("n1")).content().name()).isEqualTo("Gone layer");
    assertThat(rig.layerOf(rig.object("n1")).id()).isNotEqualTo(gone);
  }

  @Test
  void aNewTargetAppliesToTheNextNewObjectsAndLeavesTheOldOnesWhereTheyAre() {
    var rig = new Rig();
    TcpPeer peer = rig.addLink("tak-north", target("{\"name\":\"First\"}"));
    rig.feed("tak-north", Samples.at("n1", 0, 59.0, 18.0));
    rig.ctx.changeSettings(rig.withLinks(Rig.tcp("tak-north", peer.port()).replace("\"direction\"", target("{\"name\":\"Second\"}") + ",\"direction\"")));
    rig.ctx.runUntilIdle();
    assertThat(peer.accepted()).as("no reconnect").isEqualTo(1);
    rig.feed("tak-north", Samples.at("n2", 0, 58.0, 17.0));
    assertThat(rig.layerOf(rig.object("n1")).content().name()).isEqualTo("First");
    assertThat(rig.layerOf(rig.object("n2")).content().name()).isEqualTo("Second");
  }

  @Test
  void theLinksLabelIsTheLabelOfItsLayerAndObjects() {
    var rig = new Rig();
    rig.addLink("tak-north", "\"label\":{\"policy\":\"NATO\",\"classification\":\"NATO RESTRICTED\"}");
    rig.feed("tak-north", Samples.at("n1", 0, 59.0, 18.0));
    MapObject object = rig.object("n1");
    assertThat(object.content().label()).isEqualTo(SecurityLabel.of("NATO", "NATO RESTRICTED"));
    assertThat(rig.layerOf(object).content().label()).isEqualTo(SecurityLabel.of("NATO", "NATO RESTRICTED"));
  }

  @Test
  void theNewLayersTheLinksMadeAreKeptInAPluginDocument() {
    var rig = new Rig("tak-north", "tak-south");
    rig.feed("tak-north", Samples.at("n1", 0, 59.0, 18.0));
    rig.feed("tak-south", Samples.at("s1", 0, 55.0, 13.0));
    JsonObject document = rig.ctx.documents().stored().get("layers");
    assertThat(document).isNotNull();
    JsonObject named = document.getObject("named");
    assertThat(named.names()).containsExactlyInAnyOrder("tak-north", "tak-south");
    assertThat(named.getString("tak-north")).isEqualTo(rig.layerOf(rig.object("n1")).id().toString());
  }

  @Test
  void aLostPluginDocumentAdoptsTheLayerTheLinksObjectsAreIn() {
    var first = new Rig("tak-north");
    first.feed("tak-north", Samples.at("u1", 0, 59.0, 18.0));
    var second = new Rig("tak-north");
    first.ctx.store().layers().forEach(second.ctx.store()::seed);
    first.ctx.store().objects().forEach(second.ctx.store()::seed); // but not the document
    second.ctx.store().gap();
    second.ctx.runUntilIdle();
    second.feed("tak-north", Samples.at("u2", 0, 58.0, 17.0));
    assertThat(second.ctx.store().layers()).as("no second layer").hasSize(1);
    assertThat(second.object("u2").content().layerId()).isEqualTo(first.object("u1").content().layerId());
  }

  @Test
  void theLayersDocumentOfM1AndM2IsReadSoALinkNamedLikeAnOldStreamKeepsItsEmptyLayer() {
    var first = new Rig("tak-north");
    first.feed("tak-north", Samples.at("u1", 0, 59.0, 18.0));
    var layer = first.layerOf(first.object("u1"));
    first.plugin.stop();

    // the document as M1 and M2 wrote it: {"streams": {"<name>": "<layer id>"}}
    var oldDocument = JsonObject.builder().put("streams", JsonObject.builder().put("tak-north", dev.emcc.sdk.json.JsonString.of(layer.id().toString())).build()).build();
    var second = new Rig(false, builder -> {}, context -> {
      context.store().seed(layer); // the layer is empty: ECore removed the expired objects
      context.documents().seed("layers", oldDocument);
    });
    second.ctx.store().gap();
    second.ctx.runUntilIdle();
    second.addLink("tak-north", "");
    second.feed("tak-north", Samples.at("u2", 0, 58.0, 17.0));
    assertThat(second.ctx.store().layers()).as("no second layer").hasSize(1);
    assertThat(second.object("u2").content().layerId()).isEqualTo(layer.id());
  }

  @Test
  void aLayerThatCannotBeMadeIsTriedAgain() {
    var rig = new Rig("tak-north");
    rig.ctx.store().rejectNext(ChangeRejection.Code.INTERNAL_ERROR, "busy");
    rig.feed("tak-north", Samples.at("u1", 0, 59.0, 18.0));
    assertThat(rig.objects()).isEmpty();
    rig.advance(Duration.ofSeconds(10));
    assertThat(rig.objects()).hasSize(1);
    assertThat(rig.object("u1").content().dataSource()).isEqualTo("tak-north");
  }
}
