package dev.emcc.plugins.nvg.files;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.nvg.Rig;
import dev.emcc.plugins.nvg.Samples;
import dev.emcc.plugins.nvg.Xsd;
import dev.emcc.plugins.nvg.codec.Item;
import dev.emcc.plugins.nvg.codec.Limits;
import dev.emcc.plugins.nvg.codec.NvgDocument;
import dev.emcc.plugins.nvg.codec.NvgReader;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.User;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Meta;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.Relation;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.store.Change;
import dev.emcc.sdk.store.ChangeOutcome;
import dev.emcc.sdk.testkit.FakeHttpExchange;
import dev.emcc.sdk.testkit.TestJson;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The NVG panel's server side: import (criterion 12) and export (criterion 13). */
class FilesTest {

  private static final String FIVE = "<point uri=\"p\" x=\"15.2\" y=\"58.4\" symbol=\"app6b:SFGPUCI----D---\" label=\"One\"/>"
      + "<text uri=\"t\" x=\"15.3\" y=\"58.5\"><content>Two</content></text>"
      + "<polyline uri=\"l\" points=\"11.9746,57.7089 12.1,57.8\"/>"
      + "<circle uri=\"c\" cx=\"11.9746\" cy=\"57.7089\" r=\"2500\"/>"
      + "<polygon uri=\"a\" points=\"11.9,57.6 12.1,57.6 12.1,57.8\"/>";

  private Rig rig;
  private Layer layer;

  @BeforeEach
  void start() {
    rig = Rig.start();
    layer = rig.layer("Target", null, false);
  }

  private FakeHttpExchange post(String query, Bytes body, User user) {
    FakeHttpExchange call = rig.context.request("POST", "/import?" + query, Headers.of("Content-Type", "application/xml"), body, user);
    rig.context.runUntilIdle();
    return call;
  }

  private JsonObject json(FakeHttpExchange call) {
    return (JsonObject) TestJson.parse(call.reply().body().toUtf8());
  }

  /** Imports and waits for the job to end; returns its final state. */
  private JsonObject importFile(Layer into, String name, Bytes body, User user) {
    FakeHttpExchange call = post("layer=" + into.id() + "&name=" + name, body, user);
    assertThat(call.reply().status()).as(call.reply().body().toUtf8()).isEqualTo(202);
    String job = json(call).getString("job");
    FakeHttpExchange state = rig.context.call("/import/" + job, user);
    rig.context.runUntilIdle();
    assertThat(state.reply().status()).isEqualTo(200);
    return json(state);
  }

  private List<MapObject> objectsOf(String file) {
    return rig.context.store().objects().stream()
        .filter(o -> o.meta().externalRef() != null && o.meta().externalRef().system().equals("nvg-file:" + file)).toList();
  }

  private static long num(JsonObject o, String key) {
    return o.getNumber(key).longValueExact();
  }

  @Test
  void criterion12_importingFiveItemsCreatesFiveOrdinaryObjects() {
    JsonObject state = importFile(layer, "five.nvg", Samples.doc(FIVE), Rig.EDITOR);
    assertThat(state.getString("state")).isEqualTo("done");
    assertThat(num(state, "created")).isEqualTo(5);
    assertThat(num(state, "updated")).isZero();
    List<MapObject> objects = objectsOf("five.nvg");
    assertThat(objects).hasSize(5);
    assertThat(objects).allSatisfy(o -> {
      assertThat(o.content().dataType()).isEqualTo("core.general");
      assertThat(o.content().dataSource()).isEqualTo("nvg-file");
      assertThat(o.content().layerId()).isEqualTo(layer.id());
    });
    assertThat(objects).extracting(o -> o.content().type())
        .containsExactlyInAnyOrder("core.symbol", "core.text", "core.shape", "core.shape", "core.shape");
  }

  @Test
  void criterion12_textsBecomeCoreTextObjects() {
    JsonObject state = importFile(layer, "text.nvg", Samples.doc("<text uri=\"t\" x=\"15.3\" y=\"58.5\" rotation=\"30\"><content>Two</content></text>"),
        Rig.EDITOR);
    assertThat(num(state, "created")).isEqualTo(1);
    MapObject text = objectsOf("text.nvg").getFirst();
    assertThat(text.content().type()).isEqualTo("core.text");
    assertThat(text.content().dataType()).isEqualTo("core.general");
    assertThat(text.content().text().value()).isEqualTo("Two");
  }

  @Test
  void criterion12_theManifestDeclaresNoDataType() {
    assertThat(Rig.manifest().has("dataTypes")).isFalse();
  }

  @Test
  void criterion12_importingAgainUpdatesTheChangedOneAndCreatesNothingAlsoAfterAMove() {
    importFile(layer, "five.nvg", Samples.doc(FIVE), Rig.EDITOR);
    // A user moves the circle to another layer.
    Layer other = rig.layer("Other", null, false);
    MapObject circle = objectsOf("five.nvg").stream().filter(o -> o.meta().externalRef().id().equals("c")).findFirst().orElseThrow();
    MapObjectContent c = circle.content();
    MapObjectContent moved = new MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), other.id(), c.geometry(), c.symbol(),
        c.style(), c.properties(), c.label(), c.extensions());
    assertThat(rig.context.store().applyAs(Actor.plugin("draw-shapes"), Rig.EDITOR, Change.updateObject(circle, moved)))
        .isInstanceOf(ChangeOutcome.Applied.class);

    JsonObject state = importFile(layer, "five.nvg", Samples.doc(FIVE.replace("r=\"2500\"", "r=\"3000\"")), Rig.EDITOR);
    assertThat(num(state, "created")).isZero();
    assertThat(num(state, "updated")).isEqualTo(1);
    assertThat(num(state, "unchanged")).isEqualTo(4);
    MapObject after = rig.context.store().object(circle.id());
    assertThat(after.content().layerId()).isEqualTo(other.id());
    assertThat(((Geometry.Circle) after.content().geometry()).radius()).isEqualTo(3000);
    assertThat(objectsOf("five.nvg")).hasSize(5);
  }

  @Test
  void criterion12_withoutTheEditRightTheEndpointAnswers403() {
    FakeHttpExchange call = post("layer=" + layer.id() + "&name=five.nvg", Samples.doc(FIVE), Rig.VIEWER);
    assertThat(call.reply().status()).isEqualTo(403);
    assertThat(json(call).getString("error")).isEqualTo("You may not edit this layer");
    // In another workspace its own edit permission counts, not objects.edit.
    Layer simulation = rig.layer("Sim", Rig.SIMULATION.id(), false);
    assertThat(post("layer=" + simulation.id() + "&name=five.nvg", Samples.doc(FIVE), Rig.EDITOR).reply().status()).isEqualTo(403);
    assertThat(importFile(simulation, "five.nvg", Samples.doc(FIVE), Rig.ADMIN).getString("state")).isEqualTo("done");
    assertThat(objectsOf("five.nvg")).isNotEmpty();
  }

  @Test
  void criterion12_intoALockedLayer409() {
    Layer locked = rig.layer("Locked", null, true);
    FakeHttpExchange call = post("layer=" + locked.id() + "&name=five.nvg", Samples.doc(FIVE), Rig.EDITOR);
    assertThat(call.reply().status()).isEqualTo(409);
    assertThat(json(call).getString("error")).isEqualTo("The layer is locked");
    assertThat(rig.context.store().objects()).isEmpty();
  }

  @Test
  void criterion12_theCountsAreShownWithSkipsByReason() {
    JsonObject state = importFile(layer, "mixed.nvg", Samples.doc(FIVE + "<content-item uri=\"x\"/><point uri=\"bad\" x=\"500\" y=\"1\"/>"), Rig.EDITOR);
    assertThat(num(state, "items")).isEqualTo(6);
    assertThat(num(state, "created")).isEqualTo(5);
    assertThat(state.getObject("skipped").getNumber("skipped: content-item").longValueExact()).isEqualTo(1);
    assertThat(state.getObject("skipped").getNumber("skipped: bad geometry").longValueExact()).isEqualTo(1);
  }

  @Test
  void criterion2_aRefusedFileWritesNothingAndSaysWhy() {
    JsonObject state = importFile(layer, "old.nvg", Samples.doc("1.5", FIVE), Rig.EDITOR);
    assertThat(state.getString("state")).isEqualTo("refused");
    assertThat(state.getString("reason")).isEqualTo("NVG 1.5 is not supported; 2.0.x only");
    assertThat(rig.context.store().objects()).isEmpty();
    JsonObject dtd = importFile(layer, "dtd.nvg", Bytes.utf8("<?xml version=\"1.0\"?><!DOCTYPE nvg [<!ENTITY x SYSTEM \"file:///c:/windows/win.ini\">]>"
        + "<nvg xmlns=\"https://tide.act.nato.int/schemas/2012/10/nvg\" version=\"2.0.2\"><text uri=\"t\" x=\"1\" y=\"2\"><content>&x;</content></text></nvg>"),
        Rig.EDITOR);
    assertThat(dtd.getString("state")).isEqualTo("refused");
    assertThat(rig.context.store().objects()).isEmpty();
    assertThat(rig.context.httpCalls()).as("no outside request").isEmpty();
  }

  @Test
  void criterion9_aCompositeOfThreePartsGivesThreeObjectsRelatedToTheFirst() {
    importFile(layer, "comp.nvg", Samples.doc("<composite uri=\"c\"><polyline uri=\"c1\" points=\"14.0,56.0 14.1,56.1\"/>"
        + "<polyline uri=\"c2\" points=\"14.1,56.1 14.2,56.0\"/><point uri=\"c3\" x=\"14.1\" y=\"56.05\"/></composite>"), Rig.EDITOR);
    List<MapObject> parts = objectsOf("comp.nvg");
    assertThat(parts).hasSize(3);
    MapObject first = parts.stream().filter(o -> o.meta().externalRef().id().equals("c1")).findFirst().orElseThrow();
    assertThat(first.content().relations()).isEmpty();
    assertThat(parts.stream().filter(o -> o != first)).allSatisfy(o ->
        assertThat(o.content().relations()).containsExactly(new Relation("nvg.part", first.id())));
  }

  @Test
  void badRequestsAreRefused() {
    assertThat(post("name=x.nvg", Samples.doc(FIVE), Rig.EDITOR).reply().status()).isEqualTo(400);
    assertThat(post("layer=" + layer.id(), Samples.doc(FIVE), Rig.EDITOR).reply().status()).isEqualTo(400);
    assertThat(post("layer=" + UUID.randomUUID() + "&name=x.nvg", Samples.doc(FIVE), Rig.EDITOR).reply().status()).isEqualTo(404);
    assertThat(post("layer=" + layer.id() + "&name=x.nvg&policy=NATO&classification=NONSENSE", Samples.doc(FIVE), Rig.EDITOR).reply().status())
        .isEqualTo(400);
    // Another user does not see someone's import.
    FakeHttpExchange call = post("layer=" + layer.id() + "&name=x.nvg", Samples.doc(FIVE), Rig.EDITOR);
    FakeHttpExchange other = rig.context.call("/import/" + json(call).getString("job"), Rig.ADMIN);
    rig.context.runUntilIdle();
    assertThat(other.reply().status()).isEqualTo(404);
  }

  @Test
  void criterion12_aJobIsKeptTenMinutesAfterItEndsThen404() {
    String job = importFile(layer, "five.nvg", Samples.doc(FIVE), Rig.EDITOR).getString("job");
    rig.context.advance(java.time.Duration.ofMinutes(9));
    rig.context.runUntilIdle();
    FakeHttpExchange kept = rig.context.call("/import/" + job, Rig.EDITOR);
    rig.context.runUntilIdle();
    assertThat(kept.reply().status()).isEqualTo(200);
    rig.context.advance(java.time.Duration.ofMinutes(1));
    rig.context.runUntilIdle();
    FakeHttpExchange gone = rig.context.call("/import/" + job, Rig.EDITOR);
    rig.context.runUntilIdle();
    assertThat(gone.reply().status()).isEqualTo(404);
  }

  @Test
  void theDialogsLabelIsUsedForItemsWithoutOne() {
    importFile(layer, "label.nvg", Samples.doc("<point uri=\"p\" x=\"15.2\" y=\"58.4\"/>"), Rig.EDITOR);
    FakeHttpExchange call = post("layer=" + layer.id() + "&name=label2.nvg&policy=NATO&classification=RESTRICTED",
        Samples.doc("<point uri=\"p\" x=\"15.2\" y=\"58.4\"/>"), Rig.EDITOR);
    assertThat(call.reply().status()).isEqualTo(202);
    assertThat(objectsOf("label.nvg").getFirst().content().label()).isEqualTo(rig.context.defaultLabel());
    assertThat(objectsOf("label2.nvg").getFirst().content().label()).isEqualTo(SecurityLabel.of("NATO", "RESTRICTED"));
  }

  // --- export -------------------------------------------------------------------------------

  private MapObject seed(Layer into, String type, Geometry geometry) {
    var audit = new Meta.Audit(rig.context.clock(), Actor.plugin("draw-shapes"));
    MapObject o = new MapObject(UUID.randomUUID(), 1, new MapObjectContent(type, "core.general", "manual", null, into.id(), geometry, null,
        null, null, SecurityLabel.of("NATO", "UNCLASSIFIED"), Extensions.empty()), new Meta(audit, audit, null));
    rig.context.store().seed(o);
    return o;
  }

  @Test
  void criterion13_twoLayersExportAsOneDocumentWithTwoGroups() {
    Layer second = rig.layer("Routes", null, false);
    MapObject point = seed(layer, "core.shape", new Geometry.Point(Position.of(15.2, 58.4)));
    MapObject route = seed(second, "simulator.route", new Geometry.LineString(List.of(Position.of(15.2, 58.4), Position.of(15.4, 58.6))));
    FakeHttpExchange call = rig.context.call("/export?layer=" + layer.id() + "&layer=" + second.id(), Rig.VIEWER);
    rig.context.runUntilIdle();
    assertThat(call.reply().status()).isEqualTo(200);
    assertThat(call.reply().headers().first("Content-Type")).startsWith("application/xml");
    assertThat(call.reply().headers().first("Content-Disposition")).contains("filename=\"Target.nvg\"");
    Xsd.validate(call.reply().body());
    NvgDocument doc = NvgReader.read(call.reply().body(), Limits.DEFAULT).document();
    assertThat(doc.items()).hasSize(2);
    Item p = doc.items().get(0);
    assertThat(p.groupPath()).containsExactly("Target");
    assertThat(p.uri()).isEqualTo("urn:uuid:" + point.id());
    assertThat(p.attribute("symbol")).isEqualTo("unknown:unknown");
    Item r = doc.items().get(1);
    assertThat(r.groupPath()).containsExactly("Routes");
    assertThat(r.kind().element()).isEqualTo("polyline");
    assertThat(r.uri()).isEqualTo("urn:uuid:" + route.id());
  }

  @Test
  void criterion13_withoutTheViewRight403() {
    Layer simulation = rig.layer("Sim", Rig.SIMULATION.id(), false);
    FakeHttpExchange call = rig.context.call("/export?layer=" + simulation.id(), Rig.VIEWER);
    rig.context.runUntilIdle();
    assertThat(call.reply().status()).isEqualTo(403);
    FakeHttpExchange allowed = rig.context.call("/export?layer=" + simulation.id(), Rig.ADMIN);
    rig.context.runUntilIdle();
    assertThat(allowed.reply().status()).isEqualTo(200);
  }

  @Test
  void anExportImportedAgainGivesTheSameObjects() {
    importFile(layer, "five.nvg", Samples.doc(FIVE), Rig.EDITOR);
    FakeHttpExchange export = rig.context.call("/export?layer=" + layer.id(), Rig.VIEWER);
    rig.context.runUntilIdle();
    Layer copy = rig.layer("Copy", null, false);
    JsonObject state = importFile(copy, "Target.nvg", export.reply().body(), Rig.EDITOR);
    assertThat(num(state, "created")).isEqualTo(5);
    List<MapObject> before = objectsOf("five.nvg");
    List<MapObject> after = objectsOf("Target.nvg");
    for (MapObject b : before) {
      MapObject a = after.stream().filter(o -> o.meta().externalRef().id().equals(b.meta().externalRef().id())).findFirst().orElseThrow();
      assertThat(a.content().type()).isEqualTo(b.content().type());
      assertThat(a.content().geometry()).isEqualTo(b.content().geometry());
      assertThat(a.content().symbol()).isEqualTo(b.content().symbol());
      assertThat(a.content().text()).isEqualTo(b.content().text());
      assertThat(a.content().properties()).isEqualTo(b.content().properties());
      assertThat(a.content().label().classification()).isEqualTo(b.content().label().classification());
    }
  }
}
