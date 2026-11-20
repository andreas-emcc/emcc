package dev.emcc.plugins.fmv;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.fmv.klv.Metadata;
import dev.emcc.plugins.fmv.transport.Link;
import dev.emcc.plugins.fmv.transport.TransportMsg;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.Relation;
import dev.emcc.sdk.stream.ConversionEvent;
import dev.emcc.sdk.testkit.FakeConversions;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.testkit.FakeStreams;
import dev.emcc.sdk.testkit.TestJson;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * The links in the plugin (brief work packages 3 and 4; criteria 1, 5 to 14): objects written into the
 * target layer, the stream and the conversion, status and the panel's list. The links are switched off
 * (no socket); the tests tell the worker what the task would: {@code Up}, {@code Chosen},
 * {@code Telemetry}.
 */
class LinksTest {

  static final double LAT = 62.39;
  static final double LON = 17.31;

  FakePluginContext ctx;
  FmvPlugin plugin;
  UUID run = UUID.randomUUID();

  @BeforeEach
  void start() {
    ctx = Manifest.context().build();
    plugin = new FmvPlugin(ctx::clock);
    plugin.init(ctx);
    plugin.start();
    ctx.runUntilIdle();
  }

  @AfterEach
  void stop() {
    ctx.connections().stopAll();
    assertThat(ctx.handlerErrors()).isEmpty();
  }

  void useLinks(String... entries) {
    ctx.changeSettings((JsonObject) TestJson.parse("{\"links\":[" + String.join(",", entries) + "]}"));
    ctx.runUntilIdle();
  }

  /** A link switched off: no socket (its state is Stopped). */
  static String offLink(String name, String more) {
    return "{\"name\":\"" + name + "\",\"port\":9,\"enabled\":false" + more + "}";
  }

  /** A link that runs on a free loopback port; the test then plays the task with a run of its own (the real task's news is ignored). */
  String onLink(String name, String more) {
    return "{\"name\":\"" + name + "\",\"port\":" + freePort() + more + "}";
  }

  /** The key a link of this name has: its stream's name, here. */
  static String key(String name) {
    return name.toLowerCase().replaceAll("[^a-z0-9-]", "-");
  }

  void up(String name) {
    plugin.links().send(new TransportMsg.Up(key(name), run, "udp 127.0.0.1:9"));
    ctx.runUntilIdle();
  }

  void chosen(String name, int videoType) {
    plugin.links().send(new TransportMsg.Chosen(key(name), run, 1, 481, videoType, 497));
    ctx.runUntilIdle();
  }

  /** A set with a position (latitude and longitude differ), a frame centre and a width, and a heading. */
  static Metadata set(double heading, Integer classification) {
    var security = classification == null ? null : new Metadata.Security(classification, null, null, null, null);
    return new Metadata(null, "Mission 7", "MQ-9", null, heading, LAT, LON, 450.0, 2.0, 30.0, 10.0, null, 5000.0, LAT + 0.02, LON, null, 14, security);
  }

  void telemetry(String name, Metadata m) {
    plugin.links().send(new TransportMsg.Telemetry(key(name), run, m, ctx.clock()));
    ctx.runUntilIdle();
  }

  List<MapObject> objects(String dataType) {
    return ctx.store().objects().stream().filter(o -> o.content().dataType().equals(dataType)).toList();
  }

  JsonArray streamsList() {
    var call = ctx.call("/streams");
    ctx.runUntilIdle();
    assertThat(call.reply().status()).isEqualTo(200);
    return (JsonArray) TestJson.parse(call.reply().body().toUtf8());
  }

  JsonObject row(int i) {
    return (JsonObject) streamsList().values().get(i);
  }

  FakeStreams streams() {
    return ctx.streams();
  }

  FakeConversions conversions() {
    return ctx.conversions();
  }

  // ---------------------------------------------------------------- criterion 1: links at runtime

  @Test
  void criterion1_aLinkIsAddedChangedAndRemovedAtRuntime() {
    useLinks(offLink("FMV link 1", ""));
    assertThat(ctx.effectiveStatus().detail()).contains("FMV link 1 [udp 127.0.0.1:9]: stopped");
    useLinks(offLink("FMV link 1", ""), offLink("FMV link 2", ",\"fovColour\":\"#00FF00\""));
    assertThat(ctx.effectiveStatus().detail()).contains("FMV link 1").contains("FMV link 2");
    useLinks(offLink("FMV link 2", ",\"fovColour\":\"#FF0000\""));
    assertThat(ctx.effectiveStatus().detail()).doesNotContain("FMV link 1").contains("FMV link 2");
    useLinks();
    assertThat(ctx.effectiveStatus().detail()).isEqualTo("no links");
  }

  @Test
  void criterion1_aMulticastLinkWithoutAnInterfaceStaysStoppedAndSaysSo() {
    useLinks("{\"name\":\"cam\",\"mode\":\"multicast\",\"group\":\"239.1.2.3\",\"port\":5000}");
    assertThat(ctx.effectiveStatus().state()).isEqualTo(dev.emcc.sdk.PluginState.DEGRADED);
    assertThat(ctx.effectiveStatus().detail()).contains("link cam").contains("network interface");
    assertThat(ctx.connections().names()).as("no task for it").isEmpty();
  }

  @Test
  void criterion1_twoLinksWithTheSameNameAreNamedToo() {
    useLinks(offLink("FMV link 1", ""), offLink("FMV link 1", ""));
    assertThat(ctx.effectiveStatus().detail()).contains("named or identified twice");
  }

  // ---------------------------------------------------------------- criteria 11 and 12: the stream

  @Test
  void criterion11_theStreamOpensWithTheNameTheTypeThePermissionAndTheLabel() {
    useLinks(onLink("Link_ID 7", ""));
    waitStarted();
    up("Link_ID 7");
    assertThat(streams().openStreams()).isEmpty();
    chosen("Link_ID 7", 0x1B);
    FakeStreams.FakeStream s = streams().stream("link-id-7");
    assertThat(s.spec().mediaType()).isEqualTo("video/mp2t");
    assertThat(s.spec().permission()).isEqualTo("plugin.fmv.view");
    assertThat(s.spec().label()).isEqualTo(ctx.defaultLabel());
    assertThat(conversions().conversions()).isEmpty();
  }

  @Test
  void criterion11_aNewVideoTypeClosesTheStreamAndOpensItAgain() {
    useLinks(onLink("FMV link 1", ""));
    waitStarted();
    up("FMV link 1");
    chosen("FMV link 1", 0x1B);
    FakeStreams.FakeStream first = streams().stream("fmv-link-1");
    chosen("FMV link 1", 0x24);
    assertThat(first.isClosed()).isTrue();
    assertThat(streams().openStreams()).hasSize(1);
    assertThat(streams().stream("fmv-link-1")).isNotSameAs(first);
  }

  @Test
  void criterion12_h265IsOpenedAsH264IsAndNeverConverted() {
    useLinks(onLink("FMV link 1", ""));
    waitStarted();
    up("FMV link 1");
    chosen("FMV link 1", 0x24);
    assertThat(streams().openStreams()).hasSize(1);
    assertThat(conversions().conversions()).isEmpty();
    assertThat(row(0).getString("format")).isEqualTo("H.265");
    assertThat(row(0).getString("state")).isEqualTo("live");
  }

  @Test
  void aRunThatEndsClosesItsStream() {
    useLinks(onLink("FMV link 1", ""));
    waitStarted();
    up("FMV link 1");
    chosen("FMV link 1", 0x1B);
    plugin.links().send(new TransportMsg.Down(key("FMV link 1"), run, "the socket was closed"));
    ctx.runUntilIdle();
    assertThat(streams().openStreams()).isEmpty();
    assertThat(row(0).getString("state")).isEqualTo("stopped");
  }

  // ---------------------------------------------------------------- criterion 13: MPEG-2

  @Test
  void criterion13_mpeg2StartsAConversionWithTheStreamAsItsTarget() {
    useLinks(onLink("FMV link 1", ""));
    waitStarted();
    up("FMV link 1");
    chosen("FMV link 1", 0x02);
    FakeStreams.FakeStream s = streams().stream("fmv-link-1");
    assertThat(conversions().conversions()).hasSize(1);
    assertThat(conversions().conversions().getFirst().target()).isEqualTo(s);
    assertThat(row(0).getString("format")).isEqualTo("MPEG-2 → H.264");
  }

  @Test
  void criterion13_whileWaitingThePanelSaysSoAndTheStreamConvertsOnceRunning() {
    conversions().holdNew(true);
    useLinks(onLink("FMV link 1", ""));
    waitStarted();
    up("FMV link 1");
    chosen("FMV link 1", 0x02);
    assertThat(ctx.effectiveStatus().detail()).contains("Waiting for a conversion slot");
    assertThat(row(0).getString("state")).isEqualTo("waiting");
    assertThat(row(0).getString("message")).isEqualTo("Waiting for a conversion slot");
    assertThat(row(0).getBoolean("playable")).as("waiting is playable once it has a slot").isTrue();
    conversions().holdNew(false);
    conversions().conversions().getFirst().run();
    ctx.runUntilIdle();
    assertThat(ctx.effectiveStatus().detail()).contains("Receiving MPEG-2 → H.264");
    assertThat(row(0).getString("state")).isEqualTo("live");
    assertThat(row(0).getBoolean("playable")).isTrue();
  }

  @Test
  void criterion13_afterAFailureItStartsAgainAfterAMinute() {
    useLinks(onLink("FMV link 1", ""));
    waitStarted();
    up("FMV link 1");
    chosen("FMV link 1", 0x02);
    conversions().conversions().getFirst().fail(ConversionEvent.Failure.STALLED, "no output");
    ctx.runUntilIdle();
    assertThat(row(0).getString("state")).isEqualTo("not-playable");
    assertThat(row(0).getString("message")).startsWith("Conversion failed: stalled");
    assertThat(row(0).getBoolean("playable")).isFalse();
    ctx.advance(Duration.ofSeconds(30));
    assertThat(conversions().conversions()).as("not yet").hasSize(1);
    ctx.advance(Duration.ofSeconds(31));
    ctx.runUntilIdle();
    assertThat(conversions().conversions()).as("again, after a minute").hasSize(2);
  }

  @Test
  void criterion13_noConverterInstalledIsSaid() {
    useLinks(onLink("FMV link 1", ""));
    waitStarted();
    up("FMV link 1");
    chosen("FMV link 1", 0x02);
    conversions().conversions().getFirst().fail(ConversionEvent.Failure.UNAVAILABLE, "");
    ctx.runUntilIdle();
    assertThat(ctx.effectiveStatus().detail()).contains("No converter installed");
    assertThat(row(0).getString("message")).isEqualTo("No converter installed");
    assertThat(row(0).getString("state")).isEqualTo("not-playable");
    assertThat(row(0).getBoolean("playable")).as("playable agrees with the row's state").isFalse();
  }

  // ---------------------------------------------------------------- criterion 14: other formats

  @Test
  void criterion14_aJpeg2000StreamIsListedNotPlayableAndItsCameraIsMapped() {
    useLinks(onLink("FMV link 1", ""));
    waitStarted();
    up("FMV link 1");
    chosen("FMV link 1", 0x21);
    assertThat(streams().streams()).isEmpty();
    telemetry("FMV link 1", set(100.0, null));
    ctx.advance(Duration.ofSeconds(1));
    assertThat(row(0).getString("state")).isEqualTo("not-playable");
    assertThat(row(0).getString("message")).isEqualTo("Not playable: JPEG 2000");
    assertThat(row(0).getBoolean("playable")).isFalse();
    assertThat(ctx.effectiveStatus().detail()).contains("Not playable: JPEG 2000");
    assertThat(objects("fmv.camera")).hasSize(1);
    assertThat(objects("fmv.field-of-view")).hasSize(1);
  }

  // ---------------------------------------------------------------- criteria 5, 6 and 9: the objects

  @Test
  void criterion5_theCameraAndItsFieldOfViewGoIntoTheTargetLayerLinkedByARelation() {
    useLinks(onLink("FMV link 1", ""));
    waitStarted();
    up("FMV link 1");
    chosen("FMV link 1", 0x1B);
    telemetry("FMV link 1", set(100.0, null));
    ctx.advance(Duration.ofMillis(600));
    assertThat(ctx.store().layers()).extracting(l -> l.content().name()).as("named like the link, as the setting's hint says").containsExactly("FMV link 1");
    MapObject camera = objects("fmv.camera").getFirst();
    MapObject arc = objects("fmv.field-of-view").getFirst();
    assertThat(camera.content().dataSource()).isEqualTo("fmv-link-1");
    assertThat(arc.content().dataSource()).isEqualTo("fmv-link-1");
    assertThat(camera.content().layerId()).isEqualTo(ctx.store().layers().getFirst().id());
    assertThat(arc.content().layerId()).isEqualTo(camera.content().layerId());
    assertThat(arc.content().relations()).containsExactly(new Relation("fmv.view", camera.id()));
    assertThat(camera.content().symbol().sidc()).isEqualTo("10030100001103002000");
  }

  @Test
  void criterion9_thirtySetsASecondGiveAtMostTwoWritesASecond() {
    useLinks(onLink("FMV link 1", ""));
    waitStarted();
    up("FMV link 1");
    chosen("FMV link 1", 0x1B);
    for (int i = 0; i < 30; i++) {
      telemetry("FMV link 1", set(i, null)); // every set differs
      ctx.advance(Duration.ofMillis(33));
    }
    ctx.advance(Duration.ofMillis(20));
    MapObject camera = objects("fmv.camera").getFirst();
    assertThat(camera.version()).as("created, then updated at most twice in the second").isBetween(2L, 4L);
    assertThat(camera.content().symbol().modifiers().direction()).as("the newest set's").isGreaterThan(25.0);
  }

  @Test
  void criterion9_aSetThatChangesNothingWritesNothing() {
    useLinks(onLink("FMV link 1", ""));
    waitStarted();
    up("FMV link 1");
    chosen("FMV link 1", 0x1B);
    telemetry("FMV link 1", set(100.0, null));
    ctx.advance(Duration.ofMillis(600));
    long version = objects("fmv.camera").getFirst().version();
    ctx.advance(Duration.ofSeconds(2));
    telemetry("FMV link 1", set(100.0, null)); // the same, received later
    ctx.advance(Duration.ofSeconds(2));
    assertThat(objects("fmv.camera").getFirst().version()).isEqualTo(version);
    telemetry("FMV link 1", set(101.0, null));
    ctx.advance(Duration.ofSeconds(2));
    assertThat(objects("fmv.camera").getFirst().version()).isGreaterThan(version);
  }

  @Test
  void criterion7_aSetWithoutAnArcWritesNoArcAndKeepsTheLastOne() {
    useLinks(onLink("FMV link 1", ""));
    waitStarted();
    up("FMV link 1");
    chosen("FMV link 1", 0x1B);
    telemetry("FMV link 1", set(100.0, null));
    ctx.advance(Duration.ofSeconds(1));
    MapObject arc = objects("fmv.field-of-view").getFirst();
    var noWidth = new Metadata(null, "Mission 7", null, null, 100.0, LAT, LON, 450.0, null, null, 10.0, null, 5000.0, null, null, null, 14, null);
    telemetry("FMV link 1", noWidth);
    ctx.advance(Duration.ofSeconds(1));
    assertThat(objects("fmv.field-of-view")).hasSize(1);
    assertThat(objects("fmv.field-of-view").getFirst().version()).isEqualTo(arc.version());
    assertThat(objects("fmv.camera").getFirst().content().extensions().get("fmv").getString("mission")).isEqualTo("Mission 7");
  }

  // ---------------------------------------------------------------- criterion 8: the label

  @Test
  void criterion8_theClassificationOfTheSetLabelsTheObjectsAndTheStream() {
    useLinks(onLink("FMV link 1", ""));
    waitStarted();
    up("FMV link 1");
    chosen("FMV link 1", 0x1B);
    telemetry("FMV link 1", set(100.0, 4));
    ctx.advance(Duration.ofSeconds(1));
    assertThat(objects("fmv.camera").getFirst().content().label().classification()).isEqualTo("SECRET");
    assertThat(objects("fmv.field-of-view").getFirst().content().label().classification()).isEqualTo("SECRET");
    assertThat(streams().stream("fmv-link-1").label().classification()).as("the stream's label follows").isEqualTo("SECRET");
    assertThat(row(0).getString("label")).isEqualTo("SECRET");
  }

  @Test
  void criterion8_linkLabelGivesEverythingTheLinksLabel() {
    useLinks(onLink("FMV link 1", ",\"classification\":\"link-label\""));
    waitStarted();
    up("FMV link 1");
    chosen("FMV link 1", 0x1B);
    telemetry("FMV link 1", set(100.0, 4));
    ctx.advance(Duration.ofSeconds(1));
    assertThat(objects("fmv.camera").getFirst().content().label()).isEqualTo(ctx.defaultLabel());
    assertThat(streams().stream("fmv-link-1").label()).isEqualTo(ctx.defaultLabel());
  }

  @Test
  void criterion8_aSetWithoutST0102GetsTheLinksLabel() {
    useLinks(onLink("FMV link 1", ""));
    waitStarted();
    up("FMV link 1");
    chosen("FMV link 1", 0x1B);
    telemetry("FMV link 1", set(100.0, null));
    ctx.advance(Duration.ofSeconds(1));
    assertThat(objects("fmv.camera").getFirst().content().label()).isEqualTo(ctx.defaultLabel());
  }

  // ---------------------------------------------------------------- criterion 10: stale and end

  @Test
  void criterion10_withoutASetForStaleSecondsThePanelSaysStaleAndTheObjectsStay() {
    useLinks(onLink("FMV link 1", ",\"staleSeconds\":5"));
    waitStarted();
    up("FMV link 1");
    chosen("FMV link 1", 0x1B);
    telemetry("FMV link 1", set(100.0, null));
    ctx.advance(Duration.ofSeconds(4));
    assertThat(row(0).getString("state")).isEqualTo("live");
    ctx.advance(Duration.ofSeconds(2));
    assertThat(row(0).getString("state")).isEqualTo("stale");
    assertThat(objects("fmv.camera")).hasSize(1);
    telemetry("FMV link 1", set(101.0, null));
    assertThat(row(0).getString("state")).as("a new set makes it live").isEqualTo("live");
  }

  @Test
  void criterion10_removingTheLinkDeletesBothObjectsButDisablingKeepsThem() {
    useLinks(onLink("FMV link 1", ""));
    waitStarted();
    up("FMV link 1");
    chosen("FMV link 1", 0x1B);
    telemetry("FMV link 1", set(100.0, null));
    ctx.advance(Duration.ofSeconds(1));
    assertThat(ctx.store().objects()).hasSize(2);
    useLinks(offLink("FMV link 1", "")); // switched off: stopped, not removed
    assertThat(ctx.store().objects()).hasSize(2);
    useLinks();
    ctx.advance(Duration.ofSeconds(1));
    assertThat(objects("fmv.camera")).isEmpty();
    assertThat(objects("fmv.field-of-view")).isEmpty();
  }

  @Test
  void criterion10_aLinkThatBecomesUnreadableStopsButKeepsItsObjects() {
    useLinks(onLink("FMV link 1", ""));
    waitStarted();
    up("FMV link 1");
    chosen("FMV link 1", 0x1B);
    telemetry("FMV link 1", set(100.0, null));
    ctx.advance(Duration.ofSeconds(1));
    assertThat(ctx.store().objects()).hasSize(2);
    useLinks("{\"name\":\"FMV link 1\",\"port\":0}"); // a mistyped port
    ctx.advance(Duration.ofSeconds(1));
    assertThat(ctx.store().objects()).as("kept").hasSize(2);
    assertThat(ctx.effectiveStatus().detail()).contains("link FMV link 1");
  }

  // ---------------------------------------------------------------- criterion 10: a rename (CR-0047, part F)

  static final String ID = "0192f3a4-7b5c-7d8e-9f01-23456789abcd";
  static final String ID_2 = "0192f3a4-7b5c-7d8e-9f01-23456789abce";

  /** A link with the id ECore gives it; its task, its stream and its objects are known by that. */
  String idLink(String id, String name, boolean enabled) {
    return "{\"id\":\"" + id + "\",\"name\":\"" + name + "\",\"port\":" + (enabled ? linkPort() : 9) + ",\"enabled\":" + enabled + "}";
  }

  int linkPort;

  /** One free port for the whole test: a rename must not change the connection. */
  int linkPort() {
    if (linkPort == 0) {
      linkPort = freePort();
    }
    return linkPort;
  }

  static String idKey(String id) {
    return Link.from((JsonObject) TestJson.parse("{\"id\":\"" + id + "\",\"name\":\"x\",\"port\":9}")).key();
  }

  void feed(String id, Metadata m) {
    plugin.links().send(new TransportMsg.Up(idKey(id), run, "udp 127.0.0.1:9"));
    plugin.links().send(new TransportMsg.Chosen(idKey(id), run, 1, 481, 0x1B, 497));
    plugin.links().send(new TransportMsg.Telemetry(idKey(id), run, m, ctx.clock()));
    ctx.runUntilIdle();
  }

  /** A set with a position and an arc and no names in it, so the objects are named after the link. */
  static Metadata unnamed() {
    return new Metadata(null, null, null, null, 100.0, LAT, LON, 450.0, 2.0, 30.0, 10.0, null, 5000.0, LAT + 0.02, LON, null, 14, null);
  }

  /** A set with a position and no arc. */
  static Metadata noArc() {
    return new Metadata(null, null, null, null, 100.0, LAT, LON, 450.0, null, null, null, null, null, null, null, null, 14, null);
  }

  @Test
  void criterion10_aRenamedLinkKeepsItsObjectsItsStreamAndItsTask() {
    useLinks(idLink(ID, "FMV link 1", true));
    waitStarted();
    feed(ID, unnamed());
    ctx.advance(Duration.ofSeconds(1));
    MapObject camera = objects("fmv.camera").getFirst();
    MapObject arc = objects("fmv.field-of-view").getFirst();
    assertThat(camera.content().properties().name()).isEqualTo("FMV link 1");
    assertThat(streams().stream(ID).isClosed()).isFalse();
    int restarts = ctx.connectionTask(idKey(ID)).restarts();

    useLinks(idLink(ID, "Alpha", true));
    ctx.advance(Duration.ofSeconds(1));

    assertThat(ctx.store().objects()).as("the same two objects, no new ones").hasSize(2);
    MapObject camera2 = objects("fmv.camera").getFirst();
    MapObject arc2 = objects("fmv.field-of-view").getFirst();
    assertThat(camera2.id()).isEqualTo(camera.id());
    assertThat(arc2.id()).isEqualTo(arc.id());
    assertThat(camera2.content().properties().name()).isEqualTo("Alpha");
    assertThat(arc2.content().properties().name()).isEqualTo("Alpha field of view");
    assertThat(camera2.content().dataSource()).as("fixed at creation (model rule 14)").isEqualTo("fmv-link-1");
    assertThat(arc2.content().dataSource()).isEqualTo("fmv-link-1");
    assertThat(arc2.content().relations()).containsExactly(new Relation("fmv.view", camera.id()));
    assertThat(ctx.store().layers()).as("no new layer for the new name").hasSize(1);
    assertThat(streams().stream(ID).isClosed()).isFalse();
    assertThat(streams().openStreams()).hasSize(1);
    assertThat(ctx.connectionTask(idKey(ID)).restarts()).as("the task is not restarted").isEqualTo(restarts);
    assertThat(row(0).getString("name")).isEqualTo("Alpha");
    assertThat(row(0).getString("stream")).isEqualTo(ID);

    plugin.links().send(new TransportMsg.Telemetry(idKey(ID), run, unnamed(), ctx.clock()));
    ctx.advance(Duration.ofSeconds(1));
    assertThat(ctx.store().objects()).as("a later set updates them").hasSize(2);
  }

  @Test
  void criterion10_aRenameOfAStoppedLinkRenamesItsObjectsToo() {
    useLinks(idLink(ID, "FMV link 1", true));
    waitStarted();
    feed(ID, unnamed());
    ctx.advance(Duration.ofSeconds(1));
    useLinks(idLink(ID, "Beta", false)); // switched off and renamed at once: no set will come
    ctx.advance(Duration.ofSeconds(1));
    assertThat(ctx.store().objects()).hasSize(2);
    assertThat(objects("fmv.camera").getFirst().content().properties().name()).isEqualTo("Beta");
    assertThat(objects("fmv.field-of-view").getFirst().content().properties().name()).isEqualTo("Beta field of view");
  }

  @Test
  void criterion10_anObjectMadeAfterARenameTakesTheDataSourceOfItsLinksOthers() {
    useLinks(idLink(ID, "FMV link 1", true));
    waitStarted();
    feed(ID, noArc());
    ctx.advance(Duration.ofSeconds(1));
    assertThat(objects("fmv.field-of-view")).isEmpty();
    useLinks(idLink(ID, "Gamma", true));
    plugin.links().send(new TransportMsg.Telemetry(idKey(ID), run, unnamed(), ctx.clock()));
    ctx.advance(Duration.ofSeconds(1));
    assertThat(objects("fmv.camera")).hasSize(1);
    assertThat(objects("fmv.field-of-view")).hasSize(1);
    assertThat(objects("fmv.field-of-view").getFirst().content().dataSource()).isEqualTo(objects("fmv.camera").getFirst().content().dataSource())
        .isEqualTo("fmv-link-1");
  }

  @Test
  void criterion10_aLinkWithANewIdIsANewLinkAndTheOldOneIsRemoved() {
    useLinks(idLink(ID, "FMV link 1", true));
    waitStarted();
    feed(ID, unnamed());
    ctx.advance(Duration.ofSeconds(1));
    assertThat(ctx.store().objects()).hasSize(2);
    useLinks(idLink(ID_2, "FMV link 1", true));
    ctx.advance(Duration.ofSeconds(1));
    assertThat(ctx.store().objects()).as("the old link's objects are gone").isEmpty();
  }

  @Test
  void aSwitchedOffLinkKeepsItsRowAsStoppedAndItsObjects() {
    useLinks(idLink(ID, "FMV link 1", true));
    waitStarted();
    feed(ID, unnamed());
    ctx.advance(Duration.ofSeconds(1));
    assertThat(row(0).getString("state")).isEqualTo("live");
    assertThat(row(0).getString("stream")).isEqualTo(ID);
    useLinks(idLink(ID, "FMV link 1", false));
    ctx.advance(Duration.ofSeconds(1));
    assertThat(streamsList().values()).as("the row stays").hasSize(1);
    JsonObject stopped = row(0);
    assertThat(stopped.getString("state")).isEqualTo("stopped");
    assertThat(stopped.getString("message")).isEqualTo("The link is switched off");
    assertThat(stopped.getString("format")).isEqualTo("H.264");
    assertThat(stopped.getString("name")).isEqualTo("FMV link 1");
    assertThat(stopped.get("stream")).as("nothing to play").isNull();
    assertThat(ctx.store().objects()).as("the objects stay").hasSize(2);
    assertThat(streams().openStreams()).isEmpty();
  }

  @Test
  void aLinkThatIsRemovedLeavesNoRow() {
    useLinks(idLink(ID, "FMV link 1", true));
    waitStarted();
    feed(ID, unnamed());
    ctx.advance(Duration.ofSeconds(1));
    useLinks();
    assertThat(streamsList().values()).isEmpty();
  }

  @Test
  void twoLinksWhoseNamesMakeTheSameDataSourceAreNamedTwice() {
    useLinks(idLink(ID, "A b", false), idLink(ID_2, "a-b", false));
    assertThat(ctx.effectiveStatus().state()).isEqualTo(dev.emcc.sdk.PluginState.DEGRADED);
    assertThat(ctx.effectiveStatus().detail()).contains("named or identified twice");
  }

  @Test
  void twoLinksWithTheSameIdAreIdentifiedTwice() {
    useLinks(idLink(ID, "One", false), idLink(ID, "Two", false));
    assertThat(ctx.effectiveStatus().detail()).contains("named or identified twice");
  }

  // ---------------------------------------------------------------- the panel's list

  @Test
  void theListHasOneRowPerLinkThatHasReceivedAStreamWithItsFormatSizeAndBitRate() {
    useLinks(onLink("FMV link 1", ""), offLink("FMV link 2", ""));
    assertThat(streamsList().values()).as("nothing received yet").isEmpty();
    waitStarted();
    up("FMV link 1");
    chosen("FMV link 1", 0x1B);
    plugin.links().send(new TransportMsg.Size(key("FMV link 1"), run, 1280, 720));
    for (int i = 0; i <= 5; i++) { // 625 000 bytes a second is 5 Mbit/s
      plugin.links().send(new TransportMsg.Traffic(key("FMV link 1"), run, i * 400L, i * 625_000L, false));
      ctx.runUntilIdle();
      ctx.advance(Duration.ofSeconds(1));
    }
    JsonObject r = row(0);
    assertThat(streamsList().values()).hasSize(1);
    assertThat(r.getString("name")).isEqualTo("FMV link 1");
    assertThat(r.getString("title")).as("the camera's name once a set gave one").isEqualTo("FMV link 1");
    assertThat(r.getString("stream")).isEqualTo("fmv-link-1");
    assertThat(r.getString("format")).isEqualTo("H.264");
    assertThat(r.get("width").toString()).isEqualTo("1280");
    assertThat(r.get("height").toString()).isEqualTo("720");
    assertThat(((dev.emcc.sdk.json.JsonNumber) r.get("bitRate")).longValueExact()).isBetween(4_900_000L, 5_100_000L);
  }

  @Test
  void theListNamesTheStreamByItsCamera() {
    useLinks(onLink("FMV link 1", ""));
    waitStarted();
    up("FMV link 1");
    chosen("FMV link 1", 0x1B);
    telemetry("FMV link 1", set(100.0, null));
    ctx.advance(Duration.ofSeconds(1));
    assertThat(row(0).getString("title")).isEqualTo("MQ-9");
    assertThat(row(0).getString("name")).isEqualTo("FMV link 1");
  }

  @Test
  void theListNeedsOnlyALoginAndNoStreamNameBeforeTheStreamIsOpen() {
    useLinks(onLink("FMV link 1", ""));
    waitStarted();
    up("FMV link 1");
    chosen("FMV link 1", 0x21);
    assertThat(row(0).get("stream")).as("an unplayable stream has no name to watch").isNull();
  }

  @Test
  void aSettingChangeDoesNotReconnect() {
    useLinks("{\"name\":\"FMV link 1\",\"port\":" + freePort() + "}");
    waitStarted();
    int restarts = ctx.connectionTask("fmv-link-1").restarts();
    useLinks("{\"name\":\"FMV link 1\",\"port\":" + currentPort + ",\"fovColour\":\"#00FF00\",\"cameraIdentity\":\"hostile\"}");
    assertThat(ctx.connectionTask("fmv-link-1").restarts()).isEqualTo(restarts);
  }

  // ---------------------------------------------------------------- the status's rates (set 9, the ITA's T2)

  /** The status's per-minute count before {@code what} ("sets/min", "datagrams/min") of the first link. */
  long rate(String what) {
    var m = java.util.regex.Pattern.compile("(\\d+) " + java.util.regex.Pattern.quote(what)).matcher(ctx.effectiveStatus().detail());
    assertThat(m.find()).as(ctx.effectiveStatus().detail()).isTrue();
    return Long.parseLong(m.group(1));
  }

  /** {@code seconds} of the task's traffic, 400 datagrams a second, in {@code run} from {@code total}; returns the new total. */
  long traffic(UUID run, long total, int seconds) {
    for (int i = 0; i < seconds; i++) {
      total += 400;
      plugin.links().send(new TransportMsg.Traffic(key("FMV link 1"), run, total, total * 1316, false));
      ctx.runUntilIdle();
      ctx.advance(Duration.ofSeconds(1));
    }
    return total;
  }

  @Test
  void aRestartedTaskCountsItsDatagramsOnInsteadOfShowingNoneForAMinute() {
    useLinks(onLink("FMV link 1", ""));
    waitStarted();
    up("FMV link 1");
    chosen("FMV link 1", 0x1B);
    traffic(run, 0, 70);
    assertThat(rate("datagrams/min")).as("a minute of 400 a second").isBetween(23_600L, 24_400L);
    run = UUID.randomUUID(); // ECore restarted the task: its new run counts from 0
    up("FMV link 1");
    traffic(run, 0, 5);
    assertThat(rate("datagrams/min")).as("the old run's last 55 s and the new run's 5 s").isBetween(23_600L, 24_400L);
  }

  @Test
  void aLinkOnAnotherPortKeepsItsSetRateInsteadOfCountingEverySetAsThisMinutes() {
    useLinks(onLink("FMV link 1", ""));
    waitStarted();
    up("FMV link 1");
    for (int i = 0; i < 10; i++) {
      telemetry("FMV link 1", set(100.0 + i, null));
    }
    for (int i = 0; i < 90; i++) {
      ctx.advance(Duration.ofSeconds(1));
    }
    assertThat(rate("sets/min")).as("the sets are 90 s old").isZero();
    useLinks(onLink("FMV link 1", "")); // another port: a new task, and the link's row goes on
    ctx.advance(Duration.ofSeconds(1));
    assertThat(rate("sets/min")).as("still none in the last minute").isZero();
  }

  int currentPort;

  int freePort() {
    try (var probe = new java.net.DatagramSocket(0, java.net.InetAddress.getLoopbackAddress())) {
      currentPort = probe.getLocalPort();
      return currentPort;
    }
    catch (java.net.SocketException e) {
      throw new IllegalStateException(e);
    }
  }

  void waitStarted() {
    long deadline = System.nanoTime() + Duration.ofSeconds(15).toNanos();
    while (!ctx.effectiveStatus().detail().contains("Listening")) {
      ctx.runUntilIdle();
      if (System.nanoTime() > deadline) {
        throw new AssertionError("waited 15 s; status: " + ctx.effectiveStatus().detail());
      }
      Thread.yield();
    }
  }

  @SuppressWarnings("unused")
  private static Instant unused() {
    return Instant.EPOCH;
  }
}
