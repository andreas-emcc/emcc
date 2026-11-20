package dev.emcc.plugins.adsb;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.DataType;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.ChangeRequest;
import dev.emcc.sdk.model.EntityType;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.LayerContent;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Operation;
import dev.emcc.sdk.store.Change;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.testkit.TestJson;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * The worker with the object store, as a plugin runs it, without sockets: lines are sent to the
 * worker, which writes the aircraft through change requests into the fake store.
 */
class AdsbPluginTest {

  private static final String LINK = "dump1090-north";
  private static final UUID RUN = UUID.fromString("0190a000-0000-7000-8000-0000000000aa");

  private FakePluginContext ctx;
  private AdsbPlugin plugin;

  @BeforeEach
  void startLikeAPlugin() {
    ctx = FakePluginContext.builder("adsb")
        .declaredFields(Manifest.declaredFields())
        .fieldSets(Manifest.fieldSets())
        .dataTypes(new DataType("adsb.aircraft", "ADS-B aircraft", null, "adsb", new DataType.Defaults(60L, true, 300L))
            .withFieldSets("adsb.aircraft"))
        .build();
    plugin = startPlugin();
    useLinks(link(LINK, ""));
  }

  private AdsbPlugin startPlugin() {
    AdsbPlugin started = new AdsbPlugin(ctx::clock);
    started.init(ctx);
    started.start();
    ctx.runUntilIdle();
    return started;
  }

  // ---------------------------------------------------------------- objects

  @Test
  void criterion3_aCallsignGivenBeforeThePositionNamesTheAircraft() {
    line(Sbs1Test.msg(1, "4CA2D6", "SAS1234 ", "", "", "", "", "", "", "", "", ""));
    line(Sbs1Test.position("55.6181", "12.6561"));
    assertThat(objects()).hasSize(1);
    assertThat(objects().get(0).content().properties().name()).isEqualTo("SAS1234");
  }

  @Test
  void criterion2_aPositionIsPlacedWithLongitudeFirst() {
    line(Sbs1Test.position("55.6181", "12.6561"));
    MapObject object = onlyObject();
    var point = (Geometry.Point) object.content().geometry();
    assertThat(point.coordinates().longitude()).isEqualTo(12.6561);
    assertThat(point.coordinates().latitude()).isEqualTo(55.6181);
  }

  @Test
  void criterion2_anEmptyLatitudeCreatesNothingAndCountsNoPosition() {
    line(Sbs1Test.position("", "12.6561"));
    assertThat(objects()).isEmpty();
    assertThat(aircraftRequests()).isEmpty();
  }

  @Test
  void criterion8_theObjectHasTheAircraftDataTypeAndTheLinkAsDataSource() {
    line(Sbs1Test.position("55.6181", "12.6561"));
    assertThat(onlyObject().content().dataType()).isEqualTo("adsb.aircraft");
    assertThat(onlyObject().content().dataSource()).isEqualTo(LINK);
    assertThat(onlyObject().meta().externalRef().system()).isEqualTo("icao24");
    assertThat(onlyObject().meta().externalRef().id()).isEqualTo("4CA2D6");
  }

  @Test
  void criterion8_theManifestDeclaresTheDataTypeWithItsDefaults() {
    JsonObject manifest = Manifest.read();
    var types = (dev.emcc.sdk.json.JsonArray) manifest.get("dataTypes");
    JsonObject type = (JsonObject) types.values().get(0);
    assertThat(type.getString("id")).isEqualTo("adsb.aircraft");
    JsonObject defaults = type.getObject("defaults");
    assertThat(((dev.emcc.sdk.json.JsonNumber) defaults.get("expiresAfterSeconds")).longValueExact()).isEqualTo(60);
    assertThat(((dev.emcc.sdk.json.JsonNumber) defaults.get("removeAfterExpirySeconds")).longValueExact()).isEqualTo(300);
  }

  @Test
  void criterion18_anAircraftCarriesTheDataTypesSetOnceWithItsValues() {
    line(Sbs1Test.msg(1, "4CA2D6", "SAS1234 ", "", "", "", "", "", "", "", "", ""));
    line(Sbs1Test.position("55.6181", "12.6561"));
    assertThat(onlyObject().content().fieldSets()).containsExactly("adsb.aircraft");
    assertThat(onlyObject().content().extensions().get("adsb")).isNotNull();
  }

  @Test
  void criterion19_aMovedAircraftStaysWhereTheUserPutIt() {
    UUID movedTo = addLayer("Moved by the user");
    line(Sbs1Test.position("55.6181", "12.6561"));
    MapObject object = onlyObject();
    UUID linkLayer = object.content().layerId();
    MapObjectContent c = object.content();
    var moved = new MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), movedTo, c.geometry(),
        c.symbol(), c.style(), c.properties(), c.label(), c.extensions(), c.fieldSets(), c.relations());
    ctx.store().applyAs(Actor.plugin("layer-panel"), Change.updateObject(object, moved));
    ctx.runUntilIdle();

    line(Sbs1Test.position("55.6200", "12.6561")); // the next report of the same aircraft
    assertThat(onlyObject().content().layerId()).as("the moved aircraft stays in the layer the user put it in").isEqualTo(movedTo);
    assertThat(aircraftRequests().get(aircraftRequests().size() - 1).operation()).isEqualTo(Operation.UPDATE);

    line(Sbs1Test.msg(3, "4CA2D7", "", "35000", "", "", "55.5000", "12.5000", "", "", "0", "0"));
    assertThat(objects()).hasSize(2);
    MapObject another = objects().stream().filter(o -> !o.id().equals(object.id())).findFirst().orElseThrow();
    assertThat(another.content().layerId()).as("a new aircraft goes to the link's layer").isEqualTo(linkLayer);
  }

  @Test
  void criterion19_aCopyOfAMovedAircraftIsNotUpdated() {
    line(Sbs1Test.position("55.6181", "12.6561"));
    MapObject original = onlyObject();
    MapObjectContent c = original.content();
    // A copy has no external identity (ADR-0053 point 3): created without externalRef, it is never found by the writer.
    UUID copyId = UUID.randomUUID();
    ctx.store().applyAs(Actor.plugin("layer-panel"), Change.createObject(copyId, c));
    ctx.runUntilIdle();
    line(Sbs1Test.position("55.6300", "12.6561")); // the original moves on
    MapObject copy = objects().stream().filter(o -> o.id().equals(copyId)).findFirst().orElseThrow();
    assertThat(copy.version()).as("the copy is not updated").isEqualTo(1L);
    assertThat(copy.content().geometry()).isEqualTo(c.geometry());
  }

  @Test
  void criterion12_manyLinesWhileAWriteIsInFlightEndAsAtMostTwoChangesOfTheAircraft() {
    // All 50 lines are in the worker's mailbox before its first change is answered: they come while one is in flight.
    for (int i = 0; i < 50; i++) {
      plugin.links().send(new AdsbMsg.Received(LINK, RUN,
          ((Sbs1.Result.Parsed) Sbs1.parse(Sbs1Test.position(String.format("55.%04d", 6000 + i), "12.6561"))).message()));
    }
    ctx.runUntilIdle();
    assertThat(objects()).hasSize(1);
    assertThat(aircraftRequests()).as("one create, then one update with the latest state").hasSizeLessThanOrEqualTo(2);
    var point = (Geometry.Point) onlyObject().content().geometry();
    assertThat(point.coordinates().latitude()).isEqualTo(55.6049);
  }

  @Test
  void criterion13_aForgottenAircraftsLastStateIsForgottenToo() {
    line(Sbs1Test.position("55.6181", "12.6561"));
    int before = aircraftRequests().size();
    ctx.advance(Duration.ofMinutes(6)); // the sweep forgets the quiet aircraft and its state last sent
    line(Sbs1Test.position("55.6181", "12.6561"));
    assertThat(aircraftRequests()).as("the same state after the forgetting is sent again").hasSize(before + 1);
  }

  @Test
  void criterion12_aLineThatChangesNothingSendsNothing() {
    line(Sbs1Test.position("55.6181", "12.6561"));
    int before = aircraftRequests().size();
    line(Sbs1Test.position("55.6181", "12.6561"));
    assertThat(aircraftRequests()).hasSize(before);
  }

  @Test
  void criterion7_afterARestartTheNextPositionUpdatesTheSameObject() {
    line(Sbs1Test.position("55.6181", "12.6561"));
    UUID id = onlyObject().id();
    // A restart: the worker's memory is gone, the store keeps the object. The restarted worker's writer
    // subscribes again, and the subscription's snapshot brings the object back (model rule 16).
    ctx.store().restart();
    ctx.restart(plugin.links());
    useLinks(link(LINK, ""));
    ctx.runUntilIdle();
    line(Sbs1Test.position("55.6200", "12.6561"));
    assertThat(objects()).hasSize(1);
    assertThat(onlyObject().id()).isEqualTo(id);
    assertThat(aircraftRequests().get(aircraftRequests().size() - 1).operation()).isEqualTo(Operation.UPDATE);
  }

  // ---------------------------------------------------------------- layers

  @Test
  void criterion10_aNewLayerIsMadeOnceForLinksThatNameTheSameLayer() {
    useLinks(
        link("dump1090-north", "\"targetLayer\":{\"name\":\"Air\"}"),
        link("dump1090-south", "\"targetLayer\":{\"name\":\"Air\"}"));
    line(Sbs1Test.position("55.6181", "12.6561"), "dump1090-north");
    line(Sbs1Test.msg(3, "4CA2D7", "", "35000", "", "", "55.5000", "12.5000", "", "", "0", "0"), "dump1090-south");
    List<Layer> air = ctx.store().layers().stream().filter(l -> l.content().name().equals("Air")).toList();
    assertThat(air).hasSize(1);
    assertThat(objects()).hasSize(2);
  }

  @Test
  void criterion10_aLinkWithNoTargetWritesIntoALayerNamedLikeTheLink() {
    line(Sbs1Test.position("55.6181", "12.6561"));
    Layer layer = ctx.store().layers().stream().filter(l -> l.content().name().equals(LINK)).findFirst().orElseThrow();
    assertThat(onlyObject().content().layerId()).isEqualTo(layer.id());
  }

  @Test
  void criterion10_aPickedLayerIsUsedByItsId() {
    // The shell's "+" creates the layer at once and saves its id: the writer uses that layer, and makes none.
    UUID picked = addLayer("Picked by id");
    useLinks(link(LINK, "\"targetLayer\":{\"id\":\"" + picked + "\",\"name\":\"Picked by id\"}"));
    line(Sbs1Test.position("55.6181", "12.6561"));
    assertThat(onlyObject().content().layerId()).isEqualTo(picked);
    assertThat(ctx.store().layers().stream().filter(l -> l.content().name().equals("Picked by id")).count()).isEqualTo(1);
  }

  @Test
  void criterion10_aPickedLayerThatIsGoneIsMadeAgainAtTheNextAircraft() {
    UUID gone = UUID.fromString("0190a000-0000-7000-8000-0000000000bb"); // picked, then deleted: no such layer in the store
    useLinks(link(LINK, "\"targetLayer\":{\"id\":\"" + gone + "\",\"name\":\"Picked then gone\"}"));
    line(Sbs1Test.position("55.6181", "12.6561"));
    Layer made = ctx.store().layers().stream().filter(l -> l.content().name().equals("Picked then gone")).findFirst().orElseThrow();
    assertThat(made.id()).isNotEqualTo(gone);
    assertThat(onlyObject().content().layerId()).isEqualTo(made.id());
  }

  @Test
  void criterion10_aLinkCanBeChangedAndRemovedAtRuntime() {
    useLinks(link(LINK, ""));
    assertThat(status()).contains("switched off");
    useLinks();
    assertThat(status()).contains("no links");
    assertThat(ctx.effectiveStatus().state()).isEqualTo(PluginState.OK);
  }

  @Test
  void criterion14_aBadLinkIsReportedAndDegradesTheStatus() {
    useLinks("{\"name\":\"bad\"}");
    assertThat(status()).contains("link bad: needs a host");
    assertThat(ctx.effectiveStatus().state()).isEqualTo(PluginState.DEGRADED);
  }

  // ---------------------------------------------------------------- helpers

  private void useLinks(String... entries) {
    ctx.changeSettings((JsonObject) TestJson.parse("{\"links\":[" + String.join(",", entries) + "]}"));
    ctx.runUntilIdle();
  }

  /** A link with no host: the tests send lines to the worker, and no socket is opened. */
  private static String link(String name, String extra) {
    return "{\"name\":\"" + name + "\",\"host\":\"127.0.0.1\",\"port\":1,\"enabled\":false" + (extra.isEmpty() ? "" : "," + extra) + "}";
  }

  /** A layer that exists in the store and is announced to the subscribers, as a change by another plugin would. */
  private UUID addLayer(String name) {
    UUID id = UUID.randomUUID();
    ctx.store().applyAs(Actor.plugin("layer-panel"),
        Change.createLayer(id, new LayerContent(name, 1.0, true, ctx.defaultLabel(), Extensions.empty())));
    return id;
  }

  private void line(String text) {
    line(text, LINK);
  }

  private void line(String text, String link) {
    var message = ((Sbs1.Result.Parsed) Sbs1.parse(text)).message();
    plugin.links().send(new AdsbMsg.Received(link, RUN, message));
    ctx.runUntilIdle();
  }

  private List<MapObject> objects() {
    return ctx.store().objects();
  }

  private MapObject onlyObject() {
    assertThat(objects()).hasSize(1);
    return objects().get(0);
  }

  private List<ChangeRequest> aircraftRequests() {
    return ctx.store().requests().stream().filter(r -> r.entityType() == EntityType.OBJECT).toList();
  }

  private String status() {
    return ctx.effectiveStatus().detail();
  }

}
