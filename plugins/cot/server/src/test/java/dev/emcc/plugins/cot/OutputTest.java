package dev.emcc.plugins.cot;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.cot.codec.CotEvent;
import dev.emcc.plugins.cot.codec.CotGroup;
import dev.emcc.plugins.cot.codec.Samples;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Modifiers;
import dev.emcc.sdk.model.ObjectProperties;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import dev.emcc.sdk.model.TimeAttributes;
import dev.emcc.sdk.store.Change;
import java.time.Duration;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** Output from source layers (brief functions 14 and 17 to 21; criteria 14, 16 to 19 for a TCP link): the objects of a layer go out as CoT. */
class OutputTest {

  private static final Actor USER = Actor.plugin("draw-symbols");

  @AfterEach
  void closeRigs() {
    Rig.closeAll();
  }

  // ---------------------------------------------------------------- building objects

  private static MapObjectContent symbol(Rig rig, UUID layer, String sidc, String name, double lon, double lat) {
    SymbolStandard standard = sidc.length() == 15 ? SymbolStandard.APP_6B : SymbolStandard.APP_6D;
    return new MapObjectContent("core.symbol", "core.general", "manual", null, layer, new Geometry.Point(Position.of(lon, lat)),
        new Symbol(standard, sidc, null), null, new ObjectProperties(name, null), rig.ctx.defaultLabel(), Extensions.empty());
  }

  /** A layer that already exists when the plugin looks: seeded, and shown to its subscription. */
  private static Layer layer(Rig rig, String name) {
    Layer layer = rig.ctx.store().seedLayer(name);
    rig.ctx.store().gap();
    rig.ctx.runUntilIdle();
    return layer;
  }

  private static MapObject create(Rig rig, MapObjectContent content) {
    var id = UUID.randomUUID();
    rig.ctx.store().applyAs(USER, Change.createObject(id, content));
    rig.ctx.runUntilIdle();
    return rig.ctx.store().object(id);
  }

  private static MapObject update(Rig rig, MapObject object, MapObjectContent content) {
    rig.ctx.store().applyAs(USER, Change.updateObject(object, content));
    rig.ctx.runUntilIdle();
    return rig.ctx.store().object(object.id());
  }

  private static MapObjectContent with(MapObjectContent c, Position at) {
    return new MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), c.layerId(), new Geometry.Point(at), c.symbol(), c.style(), c.properties(),
        c.label(), c.extensions());
  }

  private static MapObjectContent with(MapObjectContent c, SecurityLabel label) {
    return new MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), c.layerId(), c.geometry(), c.symbol(), c.style(), c.properties(), label,
        c.extensions());
  }

  private static MapObjectContent with(MapObjectContent c, UUID layer) {
    return new MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), layer, c.geometry(), c.symbol(), c.style(), c.properties(), c.label(),
        c.extensions());
  }

  private static MapObjectContent expiring(MapObjectContent c, Instant expires) {
    return new MapObjectContent(c.type(), c.dataType(), c.dataSource(), new TimeAttributes(null, null, expires), c.layerId(), c.geometry(), c.symbol(),
        c.style(), c.properties(), c.label(), c.extensions());
  }

  private static MapObjectContent withExtension(MapObjectContent c, String name, JsonObject value) {
    return new MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), c.layerId(), c.geometry(), c.symbol(), c.style(), c.properties(),
        c.label(), c.extensions().with(name, value));
  }

  private static String iso(Instant at) {
    return java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(java.time.ZoneOffset.UTC).format(at);
  }

  /** An atom that is observed {@code seconds} from the rig's now and stale five minutes later: events from TAK that are not already expired. */
  private static String atNow(Rig rig, String uid, int seconds, double lat, double lon) {
    Instant at = rig.clock.instant().plusSeconds(seconds);
    return Samples.atom(uid, "a-f-G-U-C-I", lat, lon, iso(at), iso(at.plusSeconds(300)));
  }

  private static CotEvent only(List<CotEvent> events) {
    assertThat(events).hasSize(1);
    return events.getFirst();
  }

  /**
   * The race behind an intermittent "objects sent twice" (criterion 31's switch from both to in and back): the "connected" message of a
   * task that was stopped meanwhile (the settings changed) reached the worker after the link's new task had started, and was taken for
   * the new task's connection: the worker then sent every object of the link's layers again. The message now names the task it comes
   * from, and one of another task is ignored. A marker object, sent after, shows what went out in between.
   */
  @Test
  void aConnectedMessageOfAStoppedTaskDoesNotMakeTheLinkSendEverythingAgain() {
    var rig = new Rig();
    Layer layer = layer(rig, "Own forces");
    create(rig, symbol(rig, layer.id(), "SFGPUCI--------", "ALPHA", 11.9746, 57.7089));
    rig.addOutLink("tak", "out", List.of(layer), "\"refreshSeconds\":0");
    assertThat(only(rig.awaitSent("tak", 1)).callsign()).isEqualTo("ALPHA");

    @SuppressWarnings("unchecked")
    var applier = (dev.emcc.sdk.worker.WorkerRef<ApplierMsg>) rig.ctx.worker("applier");
    applier.send(new ApplierMsg.Connected("tak", UUID.randomUUID(), UUID.randomUUID(), Instant.now()));
    rig.ctx.runUntilIdle();
    create(rig, symbol(rig, layer.id(), "SFGPUCR--------", "MARKER", 12.5, 58.25));
    List<CotEvent> sent = rig.awaitSent("tak", 2);
    rig.advance(Duration.ofSeconds(2));
    assertThat(rig.awaitSent("tak", 2).stream().map(CotEvent::callsign)).as("ALPHA is not sent again: only the marker came after it")
        .containsExactly("ALPHA", "MARKER");
    assertThat(sent).hasSize(2);
  }

  // ---------------------------------------------------------------- criterion 14: out, and both, on one connection

  @Test
  void criterion14_whenTheLinkStartsItSendsTheCurrentObjectsOfItsLayers() {
    var rig = new Rig();
    Layer layer = layer(rig, "Own forces");
    create(rig, symbol(rig, layer.id(), "10031000001211000000", "ALPHA", 11.9746, 57.7089)); // APP-6D, friend, infantry
    create(rig, symbol(rig, layer.id(), "SHAPMFQ--------", "BRAVO", 18.1012, 59.3507)); // APP-6B, hostile, fixed wing
    rig.addOutLink("tak-out", "out", List.of(layer), "");

    List<CotEvent> events = rig.awaitSent("tak-out", 2);
    CotEvent alpha = events.stream().filter(e -> "ALPHA".equals(e.callsign())).findFirst().orElseThrow();
    CotEvent bravo = events.stream().filter(e -> "BRAVO".equals(e.callsign())).findFirst().orElseThrow();
    assertThat(alpha.type()).isEqualTo("a-f-G-U-C-I");
    assertThat(bravo.type()).isEqualTo("a-h-A-M-F-Q");
    // [lon, lat]: the latitude differs from the longitude
    assertThat(alpha.lon()).isEqualTo(11.9746);
    assertThat(alpha.lat()).isEqualTo(57.7089);
    assertThat(bravo.lon()).isEqualTo(18.1012);
    assertThat(bravo.lat()).isEqualTo(59.3507);
    assertThat(alpha.how()).isEqualTo("h-e");
    assertThat(alpha.uid()).as("the object id: it did not come from CoT").matches("[0-9a-f-]{36}");
  }

  /** Criterion 30 (T-107): a symbol of a source layer has the same callsign rule as a channel item. */
  @Test
  void criterion30_theCallsignOfAnObjectInASourceLayerIsItsNameElseItsUniqueDesignation() {
    var rig = new Rig();
    Layer layer = layer(rig, "Own forces");
    rig.addOutLink("tak-out", "out", List.of(layer), "");
    create(rig, symbol(rig, layer.id(), "SFGPUCI--------", "BRAVO", 11.9746, 57.7089));
    MapObjectContent plain = symbol(rig, layer.id(), "SFGPUCI--------", null, 12.5, 58.25);
    create(rig, new MapObjectContent(plain.type(), plain.dataType(), plain.dataSource(), plain.time(), plain.layerId(), plain.geometry(),
        new Symbol(plain.symbol().standard(), plain.symbol().sidc(), Modifiers.builder().text(dev.emcc.sdk.model.TextModifier.UNIQUE_DESIGNATION, "C3").build()),
        plain.style(), plain.properties(), plain.label(), plain.extensions()));
    create(rig, symbol(rig, layer.id(), "SFGPUCI--------", null, 13.5, 59.25));
    List<CotEvent> events = rig.awaitSent("tak-out", 3);
    assertThat(events).extracting(CotEvent::callsign).containsExactlyInAnyOrder("BRAVO", "C3", null);
  }

  @Test
  void criterion14_aCreateAndAnUpdateAreEventsAndAnUnchangedObjectIsNotSentAgain() {
    var rig = new Rig();
    Layer layer = layer(rig, "Own forces");
    rig.addOutLink("tak-out", "out", List.of(layer), "");
    rig.ctx.runUntilIdle();
    assertThat(rig.sent("tak-out")).isEmpty();

    MapObject object = create(rig, symbol(rig, layer.id(), "SFGPUCI--------", "ALPHA", 11.9746, 57.7089));
    assertThat(only(rig.awaitSent("tak-out", 1)).callsign()).isEqualTo("ALPHA");

    MapObject moved = update(rig, object, with(object.content(), Position.of(12.5, 58.25)));
    List<CotEvent> events = rig.awaitSent("tak-out", 2);
    assertThat(events.get(1).lon()).isEqualTo(12.5);
    assertThat(events.get(1).lat()).isEqualTo(58.25);
    assertThat(events.get(1).uid()).isEqualTo(events.get(0).uid());

    // a change that does not change the event (another plugin's extension) goes out nowhere
    update(rig, moved, withExtension(moved.content(), "other-plugin", JsonObject.builder().put("note", JsonString.of("x")).build()));
    rig.advance(Duration.ofSeconds(1));
    assertThat(rig.sent("tak-out")).as("only real changes go out").hasSize(2);
  }

  @Test
  void criterion14_aBothLinkSendsAndReceivesOnOneConnection() {
    var rig = new Rig();
    Layer layer = layer(rig, "Own forces");
    create(rig, symbol(rig, layer.id(), "SFGPUCI--------", "ALPHA", 11.9746, 57.7089));
    TcpPeer peer = rig.addOutLink("tak-both", "both", List.of(layer), "");
    rig.awaitSent("tak-both", 1);
    assertThat(peer.accepted()).as("one connection for both directions").isEqualTo(1);

    rig.feed("tak-both", Samples.at("from-tak", 0, 55.5, 13.25));
    assertThat(rig.object("from-tak").content().dataSource()).isEqualTo("tak-both");
    assertThat(rig.sent("tak-both")).as("what came in is not sent back").hasSize(1);
  }

  @Test
  void anOutLinkThrowsAwayWhatThePeerSendsAndMakesNoObjects() {
    var rig = new Rig();
    Layer layer = layer(rig, "Own forces");
    TcpPeer peer = rig.addOutLink("tak-out", "out", List.of(layer), "");
    peer.liveConn().send(Samples.at("relayed", 0, 55.0, 13.0));
    rig.advance(Duration.ofSeconds(1));
    TcpPeer.waitUntil(() -> rig.ctx.connectionTask("tak-out/reader").counter("bytes ignored") > 0, "the reader to take in what the peer sent");
    assertThat(rig.objects()).as("an out link receives no objects").isEmpty();
    assertThat(peer.accepted()).isEqualTo(1);
  }

  @Test
  void aPeerThatClosesTheConnectionRestartsTheLinkAndEverythingGoesOutAgain() {
    var rig = new Rig();
    Layer layer = layer(rig, "Own forces");
    create(rig, symbol(rig, layer.id(), "SFGPUCI--------", "ALPHA", 11.9746, 57.7089));
    TcpPeer peer = rig.addOutLink("tak-out", "out", List.of(layer), "");
    rig.awaitSent("tak-out", 1);

    peer.liveConn().close();
    TcpPeer.waitUntil(() -> {
      rig.ctx.runUntilIdle();
      return rig.status().contains("not connected");
    }, "the loss to be seen");
    rig.advance(Duration.ofSeconds(1));
    peer.awaitConnection(2);
    TcpPeer.waitUntil(() -> {
      rig.ctx.runUntilIdle();
      return rig.part("tak-out").startsWith("tak-out: connected since");
    }, "the link to be up again");
    TcpPeer.waitUntil(() -> {
      rig.ctx.runUntilIdle();
      return Rig.events(peer.conn().received()).size() == 1;
    }, "the object to be sent again on the new connection");
    assertThat(only(Rig.events(peer.conn().received())).callsign()).isEqualTo("ALPHA");
  }

  // ---------------------------------------------------------------- criterion 18: what leaves is stale at once

  @Test
  void criterion18_aDeletedObjectIsSentAsAnEventThatIsStaleAtOnce() {
    var rig = new Rig();
    Layer layer = layer(rig, "Own forces");
    MapObject object = create(rig, symbol(rig, layer.id(), "SFGPUCI--------", "ALPHA", 11.9746, 57.7089));
    rig.addOutLink("tak-out", "out", List.of(layer), "");
    CotEvent first = only(rig.awaitSent("tak-out", 1));
    assertThat(first.stale()).isAfter(first.time());

    rig.ctx.store().applyAs(USER, Change.deleteObject(object));
    rig.ctx.runUntilIdle();
    CotEvent gone = rig.awaitSent("tak-out", 2).get(1);
    assertThat(gone.uid()).isEqualTo(first.uid());
    assertThat(gone.stale()).as("stale at once").isEqualTo(gone.time());
    assertThat(gone.lat()).isEqualTo(57.7089);
    assertThat(gone.lon()).isEqualTo(11.9746);
  }

  @Test
  void criterion18_anObjectMovedToAnotherLayerIsSentAsStaleAtOnce() {
    var rig = new Rig();
    Layer layer = layer(rig, "Own forces");
    Layer elsewhere = layer(rig, "Elsewhere");
    MapObject object = create(rig, symbol(rig, layer.id(), "SFGPUCI--------", "ALPHA", 11.9746, 57.7089));
    rig.addOutLink("tak-out", "out", List.of(layer), "");
    rig.awaitSent("tak-out", 1);

    update(rig, object, with(object.content(), elsewhere.id()));
    CotEvent gone = rig.awaitSent("tak-out", 2).get(1);
    assertThat(gone.stale()).isEqualTo(gone.time());
  }

  @Test
  void criterion18_anObjectRaisedAboveTheLimitIsSentAsStaleAtOnceAndGivesAwayNothingOfItsNewState() {
    var rig = new Rig();
    Layer layer = layer(rig, "Own forces");
    MapObject object = create(rig, symbol(rig, layer.id(), "SFGPUCI--------", "ALPHA", 11.9746, 57.7089));
    rig.addOutLink("tak-out", "out", List.of(layer), "");
    rig.awaitSent("tak-out", 1);

    MapObjectContent secret = with(with(object.content(), Position.of(30.5, 40.25)), SecurityLabel.of("NATO", "SECRET"));
    update(rig, object, secret);
    List<CotEvent> events = rig.awaitSent("tak-out", 2);
    CotEvent gone = events.get(1);
    assertThat(gone.stale()).isEqualTo(gone.time());
    assertThat(gone.lon()).as("the position it had when it was sent, not the new one").isEqualTo(11.9746);
    assertThat(gone.callsign()).isNull();
    rig.advance(Duration.ofSeconds(1));
    assertThat(rig.status()).contains("skipped 1 (above the highest classification 1)");
  }

  @Test
  void criterion18_aChannelFreeLayerChangeInTheSettingsStopsWhatWasSentFromTheLayerThatWentAway() {
    var rig = new Rig();
    Layer one = layer(rig, "One");
    Layer two = layer(rig, "Two");
    create(rig, symbol(rig, one.id(), "SFGPUCI--------", "IN-ONE", 11.9746, 57.7089));
    create(rig, symbol(rig, two.id(), "SFGPUCR--------", "IN-TWO", 12.5, 58.25));
    TcpPeer peer = rig.addOutLink("tak-out", "out", List.of(one, two), "");
    rig.awaitSent("tak-out", 2);

    // the admin takes layer two away
    String link = Rig.tcp("tak-out", peer.port(), "out").replace("}", ",\"sourceLayers\":[{\"id\":\"" + one.id() + "\",\"name\":\"One\"}]}");
    rig.ctx.changeSettings(rig.withLinks(link));
    rig.ctx.runUntilIdle();
    CotEvent gone = rig.awaitSent("tak-out", 3).get(2);
    assertThat(gone.stale()).isEqualTo(gone.time());
    assertThat(gone.lon()).isEqualTo(12.5);
  }

  // ---------------------------------------------------------------- criterion 17: skips

  @Test
  void criterion17_aShapeANoCotTypeAndAnExpiredObjectAreSkippedAndCountedByReason() {
    var rig = new Rig();
    Layer layer = layer(rig, "Own forces");
    var polygon = new MapObjectContent("core.shape", "core.general", "manual", null, layer.id(),
        new Geometry.Polygon(List.of(List.of(Position.of(1.0, 50.0), Position.of(2.0, 50.0), Position.of(2.0, 51.0), Position.of(1.0, 50.0)))), null, null, null,
        rig.ctx.defaultLabel(), Extensions.empty());
    create(rig, polygon);
    create(rig, symbol(rig, layer.id(), "10032500001401000000", "A control measure", 11.0, 57.0)); // symbol set 25: no CoT type
    create(rig, expiring(symbol(rig, layer.id(), "SFGPUCI--------", "OLD", 11.5, 57.5), rig.clock.instant().minusSeconds(5)));
    create(rig, symbol(rig, layer.id(), "SFGPUCI--------", "GOOD", 12.0, 58.0));
    rig.addOutLink("tak-out", "out", List.of(layer), "");
    assertThat(only(rig.awaitSent("tak-out", 1)).callsign()).isEqualTo("GOOD");
    rig.advance(Duration.ofSeconds(1));
    String line = rig.part("tak-out");
    assertThat(line).contains("1 sent").contains("skipped 3").contains("not a symbol 1").contains("no CoT type 1").contains("expired 1");
    assertThat(rig.ctx.connectionTask("tak-out").counter("skipped: not a symbol") + rig.ctx.connectionTask("tak-out").counter("skipped: no CoT type"))
        .as("the monitor view has the counts too").isEqualTo(2L);
    assertThat(rig.warnings()).as("at most one warning a minute per link").hasSize(1);
  }

  @Test
  void criterion17_anObjectAboveTheHighestClassificationIsSkippedAndTheLimitIsASetting() {
    var rig = new Rig();
    Layer layer = layer(rig, "Own forces");
    MapObjectContent plain = symbol(rig, layer.id(), "SFGPUCI--------", "OPEN", 11.0, 57.0);
    create(rig, plain);
    create(rig, with(symbol(rig, layer.id(), "SFGPUCR--------", "RESTRICTED", 12.0, 58.0), SecurityLabel.of("NATO", "RESTRICTED")));
    create(rig, with(symbol(rig, layer.id(), "SFGPUCA--------", "SECRET", 13.0, 59.0), SecurityLabel.of("NATO", "SECRET")));
    create(rig, with(symbol(rig, layer.id(), "SFGPUCD--------", "OTHER POLICY", 14.0, 60.0), SecurityLabel.of("EU", "UNCLASSIFIED")));
    TcpPeer peer = rig.addOutLink("tak-out", "out", List.of(layer), "");
    List<CotEvent> events = rig.awaitSent("tak-out", 1);
    assertThat(events).extracting(CotEvent::callsign).containsExactly("OPEN");
    rig.advance(Duration.ofSeconds(1));
    assertThat(rig.part("tak-out")).contains("skipped 3 (above the highest classification 3)");

    // the admin raises the limit to RESTRICTED: the restricted object goes out now, the secret one and the other policy's do not
    String raised = Rig.tcp("tak-out", peer.port(), "out").replace("}", ",\"sourceLayers\":[{\"id\":\"" + layer.id() + "\",\"name\":\"Own forces\"}],"
        + "\"highestClassification\":{\"policy\":\"NATO\",\"classification\":\"RESTRICTED\"}}");
    rig.ctx.changeSettings(rig.withLinks(raised));
    rig.ctx.runUntilIdle();
    assertThat(rig.awaitSent("tak-out", 2)).extracting(CotEvent::callsign).containsExactly("OPEN", "RESTRICTED");
  }

  @Test
  void criterion17_aLimitThatTheServerDoesNotKnowLetsNothingThroughAndTheStatusSaysSo() {
    var rig = new Rig();
    Layer layer = layer(rig, "Own forces");
    create(rig, symbol(rig, layer.id(), "SFGPUCI--------", "OPEN", 11.0, 57.0));
    rig.addOutLink("tak-out", "out", List.of(layer), "\"highestClassification\":{\"policy\":\"NATO\",\"classification\":\"NOT A LEVEL\"}");
    rig.advance(Duration.ofSeconds(2));
    assertThat(rig.sent("tak-out")).isEmpty();
    assertThat(rig.part("tak-out")).contains("skipped 1 (unknown limit 1)");
  }

  // ---------------------------------------------------------------- criterion 16: no echo

  @Test
  void criterion16_anObjectIsNeverSentBackToTheLinkItCameFrom() {
    var rig = new Rig();
    Layer layer = layer(rig, "TAK");
    // both the link and its source layer: what comes in on it lands in the layer it also sends from
    TcpPeer peer = rig.addOutLink("tak-both", "both", List.of(layer), "\"targetLayer\":{\"id\":\"" + layer.id() + "\",\"name\":\"TAK\"}");
    rig.feed("tak-both", Samples.at("from-tak", 0, 55.5, 13.25));
    assertThat(rig.object("from-tak").content().layerId()).isEqualTo(layer.id());
    rig.advance(Duration.ofSeconds(2));
    assertThat(rig.sent("tak-both")).as("what the link received goes out on no connection of its own").isEmpty();

    // an object a user draws in the same layer does go out
    create(rig, symbol(rig, layer.id(), "SFGPUCI--------", "DRAWN", 11.0, 57.0));
    assertThat(only(rig.awaitSent("tak-both", 1)).callsign()).isEqualTo("DRAWN");
    assertThat(peer.accepted()).isEqualTo(1);
  }

  @Test
  void criterion16_anEchoThatDiffersOnlyInTimeAndFlowTagsIsNotSentAgain() {
    var rig = new Rig();
    Layer layer = layer(rig, "TAK");
    // an input link B writes into the layer that the output link A sends from, both to the same TAK network
    rig.addLink("tak-in", "\"targetLayer\":{\"id\":\"" + layer.id() + "\",\"name\":\"TAK\"}");
    rig.addOutLink("tak-out", "out", List.of(layer), "");
    rig.feed("tak-in", atNow(rig, "track-1", 0, 55.5, 13.25));
    CotEvent first = only(rig.awaitSent("tak-out", 1));
    assertThat(first.uid()).as("the uid it came with").isEqualTo("track-1");

    // TAK relays it back to the input link: the same event, a later time, with its flow tags
    String echoed = atNow(rig, "track-1", 5, 55.5, 13.25).replace("<detail/>", "<detail><_flow-tags_ TAK-Server-1234=\"2026-10-12T08:00:06Z\"/></detail>");
    rig.feed("tak-in", echoed);
    rig.advance(Duration.ofSeconds(2));
    assertThat(rig.sent("tak-out")).as("the loop ends here").hasSize(1);

    // a real change is sent once
    rig.feed("tak-in", atNow(rig, "track-1", 10, 55.75, 13.5));
    assertThat(rig.awaitSent("tak-out", 2).get(1).lat()).isEqualTo(55.75);
    rig.advance(Duration.ofSeconds(2));
    assertThat(rig.sent("tak-out")).hasSize(2);
  }

  private static Position position(MapObject object) {
    return ((Geometry.Point) object.content().geometry()).coordinates();
  }

  /** The echo of an event that was sent: the same uid, a later time, as TAK relays it. */
  private static String echoOf(Rig rig, CotEvent sent, int seconds, double lat, double lon) {
    return atNow(rig, sent.uid(), seconds, lat, lon).replace("<detail/>", "<detail><_flow-tags_ TAK-Server-1234=\"2026-10-12T08:00:06Z\"/></detail>");
  }

  @Test
  void criterion16_theEchoOfASymbolMadeInEmc2IsNotStoredAsAnotherObjectNorSentAgain() {
    var rig = new Rig();
    Layer layer = layer(rig, "TAK");
    // the output sends from the layer an input link writes into, both to a double that echoes what it is sent
    rig.addLink("tak-in", "\"targetLayer\":{\"id\":\"" + layer.id() + "\",\"name\":\"TAK\"}");
    rig.addOutLink("tak-out", "out", List.of(layer), "");
    MapObject made = create(rig, symbol(rig, layer.id(), "SFGPUCI--------", "DRAWN", 11.0, 57.0));
    CotEvent sent = only(rig.awaitSent("tak-out", 1));
    assertThat(sent.uid()).as("the uid emc2 made up: the object's id").isEqualTo(made.id().toString());

    rig.feed("tak-in", echoOf(rig, sent, 1, 57.0, 11.0));
    rig.advance(Duration.ofSeconds(2));
    assertThat(rig.objects()).as("the echo is not an object of its own").extracting(MapObject::id).containsExactly(made.id());
    assertThat(rig.sent("tak-out")).as("a create goes out once").hasSize(1);
    assertThat(rig.part("tak-in")).contains("1 echoes ignored").doesNotContain("dropped");
    assertThat(rig.part("tak-in")).contains("0 created");

    // the refresh of the output is echoed again and again: still nothing new
    rig.advance(Duration.ofSeconds(31));
    rig.awaitSent("tak-out", 2);
    rig.feed("tak-in", echoOf(rig, rig.sent("tak-out").get(1), 33, 57.0, 11.0));
    rig.advance(Duration.ofSeconds(2));
    assertThat(rig.objects()).hasSize(1);
    assertThat(rig.part("tak-in")).contains("2 echoes ignored");
  }

  @Test
  void criterion16_aRealChangeOfTheSymbolGoesOutOnceAndItsEchoIsIgnored() {
    var rig = new Rig();
    Layer layer = layer(rig, "TAK");
    rig.addLink("tak-in", "\"targetLayer\":{\"id\":\"" + layer.id() + "\",\"name\":\"TAK\"}");
    rig.addOutLink("tak-out", "out", List.of(layer), "");
    MapObject made = create(rig, symbol(rig, layer.id(), "SFGPUCI--------", "DRAWN", 11.0, 57.0));
    rig.feed("tak-in", echoOf(rig, only(rig.awaitSent("tak-out", 1)), 1, 57.0, 11.0));

    update(rig, made, with(made.content(), Position.of(11.5, 57.5)));
    CotEvent moved = rig.awaitSent("tak-out", 2).get(1);
    assertThat(moved.lat()).isEqualTo(57.5);
    assertThat(moved.lon()).isEqualTo(11.5);
    rig.feed("tak-in", echoOf(rig, moved, 3, 57.5, 11.5));
    rig.advance(Duration.ofSeconds(2));
    assertThat(rig.sent("tak-out")).as("a move goes out once").hasSize(2);
    assertThat(rig.objects()).hasSize(1);
    assertThat(position(rig.objects().getFirst())).isEqualTo(Position.of(11.5, 57.5));
  }

  @Test
  void criterion16_theEchoOfADeleteIsIgnoredToo() {
    var rig = new Rig();
    Layer layer = layer(rig, "TAK");
    rig.addLink("tak-in", "\"targetLayer\":{\"id\":\"" + layer.id() + "\",\"name\":\"TAK\"}");
    rig.addOutLink("tak-out", "out", List.of(layer), "");
    MapObject made = create(rig, symbol(rig, layer.id(), "SFGPUCI--------", "DRAWN", 11.0, 57.0));
    rig.awaitSent("tak-out", 1);

    rig.ctx.store().applyAs(USER, Change.deleteObject(made));
    rig.ctx.runUntilIdle();
    CotEvent gone = rig.awaitSent("tak-out", 2).get(1);
    assertThat(gone.stale()).as("stale at once").isEqualTo(gone.time());
    // the echo of the delete, a few seconds later: the object is gone, and the echo must not bring a ghost back
    rig.advance(Duration.ofSeconds(3));
    String echoedDelete = Samples.atom(gone.uid(), "a-f-G-U-C-I", 57.0, 11.0, iso(rig.clock.instant()), iso(rig.clock.instant()));
    rig.feed("tak-in", echoedDelete);
    rig.advance(Duration.ofSeconds(2));
    assertThat(rig.objects()).isEmpty();
    assertThat(rig.sent("tak-out")).hasSize(2);
    assertThat(rig.part("tak-in")).contains("1 echoes ignored");
  }

  @Test
  void criterion15_aSymbolThatComesBackIntoAnotherLayerIsAnObjectThereAndNotAnEcho() {
    // The same uid and the same TAK network, but the input's layer is not the one the symbol was sent from: a round trip (the ITA's
    // criterion 15), stored. Only the same layer would get a second object next to the symbol.
    var rig = new Rig();
    Layer layer = layer(rig, "Outbound");
    rig.addLink("tak-in", "\"targetLayer\":{\"name\":\"Returned\"}");
    rig.addOutLink("tak-out", "out", List.of(layer), "");
    MapObject made = create(rig, symbol(rig, layer.id(), "SFGPUCI--------", "ROUND TRIP", 10.5, 51.75));
    CotEvent sent = only(rig.awaitSent("tak-out", 1));

    rig.feed("tak-in", echoOf(rig, sent, 1, 51.75, 10.5));
    rig.advance(Duration.ofSeconds(2));
    MapObject back = rig.object(made.id().toString());
    assertThat(back.id()).isNotEqualTo(made.id());
    assertThat(back.content().layerId()).as("a layer of its own").isNotEqualTo(layer.id());
    assertThat(back.content().dataSource()).isEqualTo("tak-in");
    assertThat(rig.part("tak-in")).contains("1 created").doesNotContain("echoes ignored");
    assertThat(rig.sent("tak-out")).as("sent once: the returned object is not in a source layer").hasSize(1);
  }

  @Test
  void criterion16_aUidFromTakThatWasRelayedIsNotRememberedAsOurOwn() {
    var rig = new Rig();
    Layer layer = layer(rig, "TAK");
    rig.addLink("tak-in", "\"targetLayer\":{\"id\":\"" + layer.id() + "\",\"name\":\"TAK\"}");
    rig.addOutLink("tak-out", "out", List.of(layer), "");
    rig.feed("tak-in", atNow(rig, "track-1", 0, 55.5, 13.25));
    rig.awaitSent("tak-out", 1);
    MapObject stored = rig.object("track-1");
    rig.ctx.store().applyAs(USER, Change.deleteObject(stored));
    rig.ctx.runUntilIdle();
    rig.awaitSent("tak-out", 2); // sent stale at once

    // the track comes back from TAK a moment later: it is a new object, not an echo of anything emc2 made up
    rig.feed("tak-in", atNow(rig, "track-1", 4, 55.6, 13.3));
    assertThat(rig.object("track-1").content().layerId()).isEqualTo(layer.id());
    assertThat(rig.part("tak-in")).doesNotContain("echoes ignored");
  }

  @Test
  void criterion16_aUidIsNoLongerOurOwnWhenItsStaleTimeAndTheGraceHavePassed() {
    var rig = new Rig();
    Layer layer = layer(rig, "TAK");
    rig.addLink("tak-in", "\"targetLayer\":{\"id\":\"" + layer.id() + "\",\"name\":\"TAK\"}");
    rig.addOutLink("tak-out", "out", List.of(layer), "\"staleSeconds\":30,\"refreshSeconds\":0");
    MapObject made = create(rig, symbol(rig, layer.id(), "SFGPUCI--------", "DRAWN", 11.0, 57.0));
    CotEvent sent = only(rig.awaitSent("tak-out", 1));
    rig.advance(Duration.ofSeconds(30 + 60 + 5));
    // an event with that uid long after: the memory has run out, so it is stored like any other event from TAK
    rig.feed("tak-in", atNow(rig, sent.uid(), 0, 57.0, 11.0));
    assertThat(rig.objects()).hasSize(2);
    assertThat(rig.objects()).extracting(MapObject::id).contains(made.id());
  }

  // ---------------------------------------------------------------- criterion 19: stale times and refresh

  @Test
  void criterion19_theStaleTimeIsTheExpiryThenTheObjectsStaleSecondsThenTheLinks() {
    var rig = new Rig();
    Layer layer = layer(rig, "Own forces");
    Instant now = rig.clock.instant();
    create(rig, expiring(symbol(rig, layer.id(), "SFGPUCI--------", "EXPIRY", 11.0, 57.0), now.plusSeconds(300)));
    create(rig, withExtension(symbol(rig, layer.id(), "SFGPUCR--------", "OWN", 12.0, 58.0), "cot", JsonObject.builder().put("staleSeconds", JsonNumber.of(45)).build()));
    create(rig, symbol(rig, layer.id(), "SFGPUCA--------", "LINK", 13.0, 59.0));
    create(rig, withExtension(expiring(symbol(rig, layer.id(), "SFGPUCD--------", "BOTH", 14.0, 60.0), now.plusSeconds(20)), "cot",
        JsonObject.builder().put("staleSeconds", JsonNumber.of(45)).build()));
    rig.addOutLink("tak-out", "out", List.of(layer), "\"staleSeconds\":90");
    List<CotEvent> events = rig.awaitSent("tak-out", 4);
    java.util.function.Function<String, CotEvent> by = name -> events.stream().filter(e -> name.equals(e.callsign())).findFirst().orElseThrow();
    assertThat(by.apply("EXPIRY").stale()).as("the expiry, as it is in the future").isEqualTo(now.plusSeconds(300));
    assertThat(by.apply("OWN").stale()).as("the object's own stale time").isEqualTo(by.apply("OWN").time().plusSeconds(45));
    assertThat(by.apply("LINK").stale()).as("the link's stale time").isEqualTo(by.apply("LINK").time().plusSeconds(90));
    assertThat(by.apply("BOTH").stale()).as("an expiry in the future wins over the object's stale time").isEqualTo(now.plusSeconds(20));
  }

  @Test
  void criterion19_anUnchangedObjectIsSentAgainAfterTheRefreshTimeAndAChangeResetsIt() {
    var rig = new Rig();
    Layer layer = layer(rig, "Own forces");
    MapObject object = create(rig, symbol(rig, layer.id(), "SFGPUCI--------", "ALPHA", 11.0, 57.0));
    rig.addOutLink("tak-out", "out", List.of(layer), "\"refreshSeconds\":20,\"staleSeconds\":60");
    CotEvent first = only(rig.awaitSent("tak-out", 1));

    rig.advance(Duration.ofSeconds(19));
    assertThat(rig.sent("tak-out")).as("not before the refresh time").hasSize(1);
    rig.advance(Duration.ofSeconds(1));
    List<CotEvent> two = rig.awaitSent("tak-out", 2);
    assertThat(two.get(1).uid()).isEqualTo(first.uid());
    assertThat(two.get(1).time()).as("a new time: it is a refresh").isAfter(first.time());
    assertThat(two.get(1).lon()).isEqualTo(first.lon());

    // a change goes out at once and starts the time again
    rig.advance(Duration.ofSeconds(10));
    update(rig, object, with(object.content(), Position.of(12.0, 58.0)));
    rig.awaitSent("tak-out", 3);
    rig.advance(Duration.ofSeconds(19));
    assertThat(rig.sent("tak-out")).as("a change reset the refresh time").hasSize(3);
    rig.advance(Duration.ofSeconds(1));
    rig.awaitSent("tak-out", 4);
  }

  @Test
  void criterion19_withRefreshSecondsZeroOnlyChangesGoOutAndTheStatusWarns() {
    var rig = new Rig();
    Layer layer = layer(rig, "Own forces");
    create(rig, symbol(rig, layer.id(), "SFGPUCI--------", "ALPHA", 11.0, 57.0));
    rig.addOutLink("tak-out", "out", List.of(layer), "\"refreshSeconds\":0");
    rig.awaitSent("tak-out", 1);
    rig.advance(Duration.ofSeconds(600));
    assertThat(rig.sent("tak-out")).hasSize(1);
    assertThat(rig.part("tak-out")).contains("WARNING: refresh 0: static objects go stale in TAK");
  }

  @Test
  void criterion19_theStatusWarnsWhenTheRefreshIsLongerThanTheStaleTimeItUses() {
    var rig = new Rig();
    Layer layer = layer(rig, "Own forces");
    rig.addOutLink("tak-out", "out", List.of(layer), "\"refreshSeconds\":120,\"staleSeconds\":60");
    rig.advance(Duration.ofSeconds(1));
    assertThat(rig.part("tak-out")).contains("WARNING: refresh longer than stale");
    var ok = new Rig();
    Layer other = layer(ok, "Own forces");
    ok.addOutLink("tak-out", "out", List.of(other), "");
    ok.advance(Duration.ofSeconds(1));
    assertThat(ok.part("tak-out")).doesNotContain("WARNING");
  }

  @Test
  void criterion19_anObjectWhoseExpiryHasPassedIsNotRefreshed() {
    var rig = new Rig();
    Layer layer = layer(rig, "Own forces");
    create(rig, expiring(symbol(rig, layer.id(), "SFGPUCI--------", "SHORT", 11.0, 57.0), rig.clock.instant().plusSeconds(25)));
    rig.addOutLink("tak-out", "out", List.of(layer), "\"refreshSeconds\":10");
    CotEvent first = only(rig.awaitSent("tak-out", 1));
    assertThat(first.stale()).isEqualTo(rig.clock.instant().plusSeconds(25));
    rig.advance(Duration.ofSeconds(10));
    rig.awaitSent("tak-out", 2);
    rig.advance(Duration.ofSeconds(10));
    rig.awaitSent("tak-out", 3);
    rig.advance(Duration.ofSeconds(10)); // now 30 s: expired at 25 s
    rig.advance(Duration.ofSeconds(30));
    assertThat(rig.sent("tak-out")).as("no refresh after the expiry").hasSize(3);
  }

  // ---------------------------------------------------------------- criterion 21: the declared fields

  @Test
  void criterion21_teamRoleAndStaleSecondsOfAnObjectAreSentAndHonoured() {
    var rig = new Rig();
    Layer layer = layer(rig, "Own forces");
    JsonObject fields = JsonObject.builder().put("team", JsonString.of("Dark Blue")).put("role", JsonString.of("Medic")).put("staleSeconds", JsonNumber.of(33)).build();
    var content = withExtension(symbol(rig, layer.id(), "SFGPUCI--------", "ALPHA", 11.0, 57.0), "cot", fields);
    create(rig, new MapObjectContent(content.type(), content.dataType(), content.dataSource(), content.time(), content.layerId(), content.geometry(),
        new Symbol(SymbolStandard.APP_6B, "SFGPUCI--------", Modifiers.builder().direction(45).speed(3.5).build()), content.style(), content.properties(),
        content.label(), content.extensions()));
    rig.addOutLink("tak-out", "out", List.of(layer), "");
    CotEvent event = only(rig.awaitSent("tak-out", 1));
    assertThat(event.group()).isEqualTo(new CotGroup("Dark Blue", "Medic"));
    assertThat(event.course()).isEqualTo(45.0);
    assertThat(event.speed()).isEqualTo(3.5);
    assertThat(event.stale()).isEqualTo(event.time().plusSeconds(33));
  }

  @Test
  void anObjectThatCameFromCotKeepsItsTypeDetailAndUidWhenItGoesOutAgain() {
    var rig = new Rig();
    // received on an input link and sent by an output link of another network
    Layer layer = layer(rig, "TAK");
    rig.addLink("tak-in", "\"targetLayer\":{\"id\":\"" + layer.id() + "\",\"name\":\"TAK\"}");
    Instant now = rig.clock.instant();
    rig.feed("tak-in", Samples.UNIT.replace("2026-10-03T08:20:00.000Z", iso(now)).replace("2026-10-03T08:25:00.000Z", iso(now.plusSeconds(300))));
    rig.addOutLink("tak-out", "out", List.of(layer), "");
    CotEvent event = only(rig.awaitSent("tak-out", 1));
    assertThat(event.uid()).isEqualTo("ANDROID-358240051111110");
    assertThat(event.type()).isEqualTo("a-f-G-U-C-I");
    assertThat(event.how()).isEqualTo("m-g");
    assertThat(event.detail()).contains("<priv:plugin xmlns:priv=\"urn:example:private\"").contains("<__group name=\"Cyan\" role=\"Team Member\"/>");
    assertThat(event.hae()).isEqualTo(45.2);
  }

  // ---------------------------------------------------------------- the settings

  @Test
  void aLinkThatIsRemovedOrSwitchedOffStopsSendingAndItsSubscriptionsGo() {
    var rig = new Rig();
    Layer layer = layer(rig, "Own forces");
    TcpPeer peer = rig.addOutLink("tak-out", "out", List.of(layer), "");
    rig.ctx.changeSettings(rig.withLinks());
    rig.ctx.runUntilIdle();
    create(rig, symbol(rig, layer.id(), "SFGPUCI--------", "LATE", 11.0, 57.0));
    rig.advance(Duration.ofSeconds(2));
    assertThat(Rig.events(peer.conn().received())).as("nothing is sent after the link went").isEmpty();
    assertThat(rig.ctx.handlerErrors()).isEmpty();
  }

  @Test
  void anOutLinkWithoutAHostAndOneWithANewSourceLayerAreProblemsAndNotStarted() {
    var rig = new Rig();
    String noHost = "{\"name\":\"b\",\"direction\":\"out\",\"transport\":\"udp\",\"port\":9}";
    String newLayer = "{\"name\":\"c\",\"direction\":\"out\",\"host\":\"127.0.0.1\",\"port\":1,\"sourceLayers\":[{\"name\":\"a new one\"}]}";
    rig.ctx.changeSettings(rig.withLinks(noHost, newLayer));
    rig.ctx.runUntilIdle();
    assertThat(rig.ctx.connections().names()).isEmpty();
    assertThat(rig.part("b")).contains("the host is missing");
    assertThat(rig.part("c")).contains("a source layer must be an existing layer");
  }

  @Test
  void criterion31_anInLinkThatKeepsSourceLayersIsValidAndSendsNothing() {
    var rig = new Rig();
    Layer layer = layer(rig, "Own forces");
    create(rig, symbol(rig, layer.id(), "SFGPUCI--------", "ALPHA", 11.9746, 57.7089));
    rig.addOutLink("tak-in", "in", List.of(layer), "");
    rig.advance(Duration.ofSeconds(3));
    assertThat(rig.part("tak-in")).startsWith("tak-in: connected since").doesNotContain("problem");
    assertThat(rig.sent("tak-in")).as("an in link sends nothing").isEmpty();
    create(rig, symbol(rig, layer.id(), "SFGPUCR--------", "BRAVO", 12.5, 58.25));
    rig.advance(Duration.ofSeconds(3));
    assertThat(rig.sent("tak-in")).isEmpty();
  }

  @Test
  void criterion31_aLinkSwitchedFromBothToInStopsSendingKeepsItsLayersAndSendsAgainWhenSwitchedBack() {
    var rig = new Rig();
    Layer layer = layer(rig, "Own forces");
    create(rig, symbol(rig, layer.id(), "SFGPUCI--------", "ALPHA", 11.9746, 57.7089));
    TcpPeer peer = rig.addOutLink("tak", "both", List.of(layer), "\"refreshSeconds\":0");
    assertThat(only(rig.awaitSent("tak", 1)).callsign()).isEqualTo("ALPHA");

    String layers = "\"sourceLayers\":[{\"id\":\"" + layer.id() + "\",\"name\":\"Own forces\"}],\"refreshSeconds\":0}";
    String asIn = Rig.tcp("tak", peer.port(), "in").replace("}", "," + layers);
    rig.ctx.changeSettings(rig.withLinks(asIn));
    rig.ctx.runUntilIdle();
    peer.awaitConnection(2);
    create(rig, symbol(rig, layer.id(), "SFGPUCR--------", "BRAVO", 12.5, 58.25));
    rig.advance(Duration.ofSeconds(3));
    assertThat(rig.part("tak")).as("the layers are kept and not a problem").doesNotContain("problem");
    assertThat(rig.sent("tak")).as("on the new connection, as an in link, it sends nothing").isEmpty();

    String asBoth = Rig.tcp("tak", peer.port(), "both").replace("}", "," + layers);
    rig.ctx.changeSettings(rig.withLinks(asBoth));
    rig.ctx.runUntilIdle();
    peer.awaitConnection(3);
    assertThat(rig.awaitSent("tak", 2).stream().map(CotEvent::callsign)).as("both objects of the kept layer go out again, on the new connection").containsExactlyInAnyOrder("ALPHA", "BRAVO");
  }

  @Test
  void theOutputSubscribesToViewsLayersOnlyAndOncePerLayer() {
    var rig = new Rig();
    Layer layer = layer(rig, "Own forces");
    rig.addOutLink("tak-a", "out", List.of(layer), "");
    rig.addOutLink("tak-b", "out", List.of(layer), "");
    create(rig, symbol(rig, layer.id(), "SFGPUCI--------", "ALPHA", 11.0, 57.0));
    assertThat(only(rig.awaitSent("tak-a", 1)).callsign()).isEqualTo("ALPHA");
    assertThat(only(rig.awaitSent("tak-b", 1)).callsign()).isEqualTo("ALPHA");
  }

  // ---------------------------------------------------------------- the review's remarks on part 2

  @Test
  void criterion14_aNewSnapshotAfterAGapSendsWhatIsMissingFromItAsStale() {
    var rig = new Rig();
    Layer layer = layer(rig, "Own forces");
    create(rig, symbol(rig, layer.id(), "SFGPUCI--------", "ALPHA", 11.9746, 57.7089));
    create(rig, symbol(rig, layer.id(), "SFGPUCR--------", "BRAVO", 12.5, 58.25));
    rig.addOutLink("tak-out", "out", List.of(layer), "");
    List<CotEvent> sent = rig.awaitSent("tak-out", 2);
    CotEvent bravo = sent.stream().filter(e -> "BRAVO".equals(e.callsign())).findFirst().orElseThrow();

    // after a gap the store sends a snapshot in which BRAVO is not: its delete was lost in the gap
    MapObject alpha = rig.ctx.store().objects().stream().filter(o -> "ALPHA".equals(o.content().properties().name())).findFirst().orElseThrow();
    @SuppressWarnings("unchecked")
    var applier = (dev.emcc.sdk.worker.WorkerRef<ApplierMsg>) rig.ctx.worker("applier");
    applier.send(new ApplierMsg.SourceUpdate(layer.id(), 1, new dev.emcc.sdk.store.StoreUpdate.Snapshot(List.of(alpha), List.of(layer), 99)));
    rig.ctx.runUntilIdle();
    List<CotEvent> after = rig.awaitSent("tak-out", 3);
    CotEvent gone = after.get(2);
    assertThat(gone.uid()).isEqualTo(bravo.uid());
    assertThat(gone.stale()).as("stale at once").isEqualTo(gone.time());
    rig.advance(Duration.ofSeconds(2));
    assertThat(rig.sent("tak-out")).as("ALPHA is unchanged and is not sent again").hasSize(3);
  }

  @Test
  void anObjectMovedBetweenTwoSourceLayersOfOneLinkIsStillSentNotStale_whenTheLayerItLeftIsHandledFirst() {
    movedBetweenTwoSourceLayers(true);
  }

  @Test
  void anObjectMovedBetweenTwoSourceLayersOfOneLinkIsStillSentNotStale_whenTheLayerItEnteredIsHandledFirst() {
    movedBetweenTwoSourceLayers(false);
  }

  /**
   * The two subscriptions of one link have no order the plugin could count on, and the engine holds them in a hash set of layer ids:
   * the test picks the ids, so that each order is run, and expects the exact events of each. The events come over one TCP stream, so
   * the peer's list is the plugin's order; waiting for a count the plugin has decided on (it has when the rig is idle) needs no pause.
   */
  private void movedBetweenTwoSourceLayers(boolean leftFirst) {
    var rig = new Rig();
    Layer one;
    Layer two;
    do {
      one = layer(rig, "One");
      two = layer(rig, "Two");
    } while (new HashSet<>(List.of(one.id(), two.id())).iterator().next().equals(one.id()) != leftFirst);
    MapObject object = create(rig, symbol(rig, one.id(), "SFGPUCI--------", "MOVER", 11.9746, 57.7089));
    rig.addOutLink("tak-out", "out", List.of(one, two), "\"refreshSeconds\":0");
    rig.awaitSent("tak-out", 1);

    update(rig, object, with(object.content(), two.id()));
    // a marker object, sent after everything the move made the plugin send: the peer's list up to the marker is what the move caused
    create(rig, symbol(rig, two.id(), "SFGPUCI--------", "MARKER", 12.5, 58.25));
    List<CotEvent> sent = rig.awaitSentUpTo("tak-out", "MARKER");
    assertThat(sent.getLast().callsign()).isEqualTo("MARKER");
    CotEvent live = sent.getFirst();
    assertThat(live.callsign()).isEqualTo("MOVER");
    assertThat(live.stale()).isAfter(live.time());
    List<CotEvent> caused = sent.subList(1, sent.size() - 1);
    if (leftFirst) {
      // The layer it left is handled first: a stale event, then a live one from the layer it entered. The two are for one object and
      // the task's inbox keeps only the latest per object (brief function 21), so when the task has not yet written the stale one
      // when the live one is posted (a busy machine) the peer gets the live one alone: both lists are right, and the rule is the
      // same: the last word in TAK is a live object, not a stale one.
      assertThat(caused).as("the live event, and before it the stale one unless the inbox replaced it").hasSizeBetween(1, 2);
      assertThat(caused).allSatisfy(e -> assertThat(e.uid()).isEqualTo(live.uid()));
      assertThat(caused.getLast().stale()).as("the last word in TAK is a live object, not a stale one").isAfter(caused.getLast().time());
      if (caused.size() == 2) {
        assertThat(caused.getFirst().stale()).as("stale at once, as it left the layer it was sent from").isEqualTo(caused.getFirst().time());
      }
    } else {
      assertThat(caused).as("the other way round there is nothing to send: the object is the other layer's now").isEmpty();
    }

    // and when it later leaves for a layer that is not a source layer, it does go stale
    MapObject inTwo = rig.ctx.store().object(object.id());
    Layer elsewhere = layer(rig, "Elsewhere");
    update(rig, inTwo, with(inTwo.content(), elsewhere.id()));
    CotEvent gone = rig.awaitSent("tak-out", sent.size() + 1).getLast();
    assertThat(gone.uid()).isEqualTo(live.uid());
    assertThat(gone.stale()).as("the stale event after the object left both source layers").isEqualTo(gone.time());
  }

  @Test
  void aLinkThatRestartsAfterTheReaderEndedStaysUpAndDoesNotRestartAgain() {
    var rig = new Rig();
    Layer layer = layer(rig, "Own forces");
    TcpPeer peer = rig.addOutLink("tak-out", "out", List.of(layer), "");
    peer.liveConn().close();
    TcpPeer.waitUntil(() -> {
      rig.ctx.runUntilIdle();
      return rig.status().contains("not connected");
    }, "the loss to be seen");
    rig.advance(Duration.ofSeconds(1));
    peer.awaitConnection(2);
    // "connected" is the task's own message, from its thread: wait for it, not for time to pass
    TcpPeer.waitUntil(() -> {
      rig.ctx.runUntilIdle();
      return rig.part("tak-out").startsWith("tak-out: connected since");
    }, "the second run to be connected (status: " + rig.status() + ")");

    // The inbox outlives runs, and the end of the first run may be in it. The first run had returned before ECore made the second, so
    // nothing more can come from it, and the writer of the second run takes the inbox in order: an event made now reaches the peer
    // only after the writer has dealt with whatever the first run left, and it goes out on the second connection if that run is alive.
    create(rig, symbol(rig, layer.id(), "SFGPUCI--------", "ALPHA", 11.9746, 57.7089));
    assertThat(only(rig.awaitSent("tak-out", 1)).callsign()).isEqualTo("ALPHA");
    rig.advance(Duration.ofSeconds(8));
    assertThat(peer.accepted()).as("a late end of the first run must not end the second").isEqualTo(2);
    assertThat(rig.part("tak-out")).startsWith("tak-out: connected since");
  }

  @Test
  void moreObjectsThanTheInboxHoldsAllGoOutPacedAndNoneIsLost() {
    var rig = new Rig();
    Layer layer = layer(rig, "Big");
    int count = 21_000;
    for (int i = 0; i < count; i++) {
      var content = symbol(rig, layer.id(), "SFGPUCI--------", "N" + i, 5.0 + (i % 1000) / 100.0, 50.0 + (i / 1000) / 10.0);
      rig.ctx.store().applyAs(USER, Change.createObject(UUID.randomUUID(), content));
    }
    rig.ctx.runUntilIdle();
    TcpPeer peer = rig.addOutLink("tak-big", "out", List.of(layer), "\"refreshSeconds\":0");
    rig.awaitEvents(peer, count, 180);
    TcpPeer.waitUntil(() -> {
      rig.advance(Duration.ofSeconds(1));
      return rig.sentCount("tak-big") >= count; // more than count only if a stalled connection was made again, and everything went out again
    }, "the status to count " + count + " sent (status: " + rig.status() + ")", 180);
  }

  @Test
  void aLinkThatWasDownWhenAnObjectWasDeletedDoesNotSendAStaleEventForItAfterwards() {
    var rig = new Rig();
    Layer layer = layer(rig, "Own forces");
    MapObject object = create(rig, symbol(rig, layer.id(), "SFGPUCI--------", "GONE", 11.9746, 57.7089));
    create(rig, symbol(rig, layer.id(), "SFGPUCR--------", "STAYS", 12.5, 58.25));
    TcpPeer peer = rig.addOutLink("tak-out", "out", List.of(layer), "\"refreshSeconds\":0");
    rig.awaitSent("tak-out", 2);
    peer.liveConn().close();
    TcpPeer.waitUntil(() -> {
      rig.ctx.runUntilIdle();
      return rig.status().contains("not connected");
    }, "the loss to be seen");
    rig.ctx.store().applyAs(USER, Change.deleteObject(object));
    rig.ctx.runUntilIdle();
    rig.advance(Duration.ofSeconds(1));
    peer.awaitConnection(2);
    TcpPeer.waitUntil(() -> {
      rig.ctx.runUntilIdle();
      return Rig.events(peer.conn().received()).size() >= 1;
    }, "the objects again on the new connection");
    rig.advance(Duration.ofSeconds(2));
    assertThat(Rig.events(peer.conn().received())).extracting(CotEvent::callsign).as("everything that is still there, and nothing for what was deleted").containsExactly("STAYS");
  }
}
