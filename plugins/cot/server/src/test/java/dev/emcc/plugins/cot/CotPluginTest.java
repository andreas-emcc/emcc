package dev.emcc.plugins.cot;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.cot.codec.Samples;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.ChangeRejection;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Operation;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.store.Change;
import dev.emcc.sdk.testkit.FakeConnections.FakeTask;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/**
 * The acceptance criteria of the brief that the test kit can show for TCP links: the plugin against
 * fake connection tasks that really connect to a {@link TcpPeer} on loopback, and a fake object
 * store. The criteria for the other transports, the layers and the settings are in {@link
 * LinkTransportsTest}, {@link LinkLayersTest} and {@link SettingsTest}.
 */
class CotPluginTest {

  @AfterEach
  void closeRigs() {
    Rig.closeAll();
  }

  private static Position position(MapObject object) {
    return ((Geometry.Point) object.content().geometry()).coordinates();
  }

  // ---------------------------------------------------------------- criterion 12

  @Test
  void criterion12_withoutAConfiguredLinkItStartsDoesNothingAndSaysSo() {
    var rig = new Rig();
    assertThat(rig.ctx.connections().names()).isEmpty();
    assertThat(rig.ctx.effectiveStatus().state()).isEqualTo(PluginState.OK);
    assertThat(rig.status()).isEqualTo("no link configured");
    assertThat(rig.ctx.store().requests()).isEmpty();
    assertThat(rig.ctx.handlerErrors()).isEmpty();
  }

  // ---------------------------------------------------------------- criterion 1

  @Test
  void criterion1_anAtomAppearsWithTheRightPositionSymbolAndIdentity() {
    var rig = new Rig("tak-north");
    rig.feed("tak-north", Samples.UNIT);

    MapObject object = rig.object("ANDROID-358240051111110");
    MapObjectContent content = object.content();
    assertThat(content.type()).isEqualTo("core.symbol");
    assertThat(content.dataType()).isEqualTo("cot.cot");
    assertThat(content.dataSource()).isEqualTo("tak-north");
    assertThat(object.meta().externalRef().system()).isEqualTo("cot");
    assertThat(object.meta().externalRef().id()).isEqualTo("ANDROID-358240051111110");
    // latitude 59.3507 and longitude 18.1012 differ, and the point is [lon, lat]
    assertThat(position(object)).isEqualTo(Position.of(18.1012, 59.3507, 45.2));
    assertThat(content.symbol().sidc()).isEqualTo("SFGPUCI--------");
    assertThat(content.properties().name()).isEqualTo("VIPER 2");
    assertThat(content.symbol().modifiers().text(dev.emcc.sdk.model.TextModifier.UNIQUE_DESIGNATION)).isEqualTo("VIPER 2");
    assertThat(object.meta().created().by()).isEqualTo(new Actor("cot", null, "tak-north"));
    assertThat(content.label()).isEqualTo(rig.ctx.defaultLabel());
  }

  @Test
  void criterion1_theObjectHasAUuidV7AndItsLayerIsOnTop() {
    var rig = new Rig("tak-north");
    rig.ctx.store().seedLayer("Default");
    rig.ctx.store().seedLayer("Own forces");
    rig.ctx.store().gap(); // the subscription sends the layers that were there before
    rig.ctx.runUntilIdle();
    rig.feed("tak-north", Samples.UNIT);
    MapObject object = rig.object("ANDROID-358240051111110");
    assertThat(object.id().version()).isEqualTo(7);
    assertThat(rig.layerOf(object).content().name()).isEqualTo("tak-north");
    assertThat(rig.layerOf(object).content().drawOrder()).isGreaterThan(2.0);
  }

  @Test
  void criterion1_aMapPointIsShownToo() {
    var rig = new Rig("tak-north");
    rig.feed("tak-north", "<event uid=\"wp-1\" type=\"b-m-p-w\" how=\"h-e\" time=\"2026-10-12T08:00:00Z\" stale=\"2026-10-12T09:00:00Z\">"
        + "<point lat=\"57.7\" lon=\"11.9\"/><detail><contact callsign=\"WP 1\"/></detail></event>");
    assertThat(rig.object("wp-1").content().properties().name()).isEqualTo("WP 1");
    assertThat(position(rig.object("wp-1"))).isEqualTo(Position.of(11.9, 57.7));
  }

  @Test
  void typesThatAreNotShownAreCountedAndDropped() {
    var rig = new Rig("tak-north");
    rig.feed("tak-north", "<event uid=\"c1\" type=\"b-t-f\"><point lat=\"1.5\" lon=\"2.5\"/></event>"
        + "<event uid=\"d1\" type=\"u-d-f\"><point lat=\"1.5\" lon=\"2.5\"/></event>"
        + "<event uid=\"p1\" type=\"t-x-c-t\"><point lat=\"0\" lon=\"0\"/></event>");
    rig.advance(Duration.ofSeconds(1));
    assertThat(rig.objects()).isEmpty();
    assertThat(rig.status()).contains("3 read").contains("not shown 3");
  }

  // ---------------------------------------------------------------- criterion 2

  @Test
  void criterion2_repeatedEventsMoveTheSameObject() {
    var rig = new Rig("tak-north");
    rig.feed("tak-north", Samples.at("u1", 0, 59.3507, 18.1012));
    rig.feed("tak-north", Samples.at("u1", 10, 59.4, 18.2));
    rig.feed("tak-north", Samples.at("u1", 20, 59.5, 18.3));
    assertThat(rig.objects()).hasSize(1);
    MapObject object = rig.object("u1");
    assertThat(position(object)).isEqualTo(Position.of(18.3, 59.5));
    assertThat(object.version()).isEqualTo(3);
    assertThat(rig.requests(Operation.CREATE)).isEqualTo(2L); // the layer and the object
    assertThat(rig.requests(Operation.UPDATE)).isEqualTo(2L);
  }

  @Test
  void criterion2_aRestartDoesNotDuplicateTheObjects() {
    var first = new Rig("tak-north");
    first.feed("tak-north", Samples.at("u1", 0, 59.3507, 18.1012));
    first.feed("tak-north", Samples.at("u2", 0, 57.7, 11.9));
    first.plugin.stop();

    // A new server run: the same store content and plugin documents, a fresh plugin.
    var second = new Rig("tak-north");
    first.ctx.store().layers().forEach(second.ctx.store()::seed);
    first.ctx.store().objects().forEach(second.ctx.store()::seed);
    first.ctx.documents().stored().forEach(second.ctx.documents()::seed);
    second.ctx.store().gap(); // the subscription sees the seeded content, as it would at the start of a run
    second.ctx.runUntilIdle();
    second.feed("tak-north", Samples.at("u1", 60, 60.0, 19.0));

    assertThat(second.objects()).hasSize(2);
    assertThat(position(second.object("u1"))).isEqualTo(Position.of(19.0, 60.0));
    assertThat(second.requests(Operation.CREATE)).as("neither the layer nor an object is made again").isZero();
    assertThat(second.object("u2").version()).isEqualTo(first.object("u2").version());
  }

  @Test
  void criterion2_aBurstFromOneDeviceCostsOneChange() {
    var rig = new Rig("tak-north");
    var burst = new StringBuilder();
    for (int i = 0; i < 50; i++) {
      burst.append(Samples.at("u1", i, 59.0 + i / 100.0, 18.0 + i / 100.0));
    }
    rig.feedAtOnce("tak-north", burst.toString(), 50);
    assertThat(rig.objects()).hasSize(1);
    assertThat(position(rig.object("u1"))).isEqualTo(Position.of(18.49, 59.49));
    // the first event creates the object; the rest wait and the newest one updates it (the mailbox keeps only the latest per uid)
    assertThat(rig.requests(Operation.CREATE) + rig.requests(Operation.UPDATE)).isLessThan(10);
  }

  /**
   * A TAK Server sends every event to every client, so two links on it read each event. Their messages wait in the worker's mailbox
   * together, and must not replace each other (owner, 2026-10-29: found by the real TAK Server check, where one link's counters stayed
   * short for good).
   */
  @Test
  void criterion2_twoLinksThatReadTheSameEventBothCountItAndNeitherMessageReplacesTheOther() {
    var rig = new Rig("tak-a", "tak-b");
    String event = Samples.at("u1", 100, 59.0, 18.0);
    rig.sendAndHold("tak-a", event, 1);
    rig.sendAndHold("tak-b", event, 1);
    rig.ctx.runUntilIdle();
    rig.advance(Duration.ofSeconds(1));
    assertThat(rig.objects()).hasSize(1);
    assertThat(rig.part("tak-a")).contains("1 read");
    assertThat(rig.part("tak-b")).contains("1 read");
  }

  @Test
  void criterion2_aNewerEventOfOneLinkIsNotLostToAnOlderOneOfAnotherThatArrivedAfterIt() {
    var rig = new Rig("tak-a", "tak-b");
    rig.sendAndHold("tak-a", Samples.at("u1", 200, 59.0, 18.0), 1); // newer by @time, arrives first
    rig.sendAndHold("tak-b", Samples.at("u1", 100, 58.0, 17.0), 1); // older, arrives after it, for the same uid
    rig.ctx.runUntilIdle();
    assertThat(position(rig.object("u1"))).as("the newer event was applied, not replaced in the mailbox").isEqualTo(Position.of(18.0, 59.0));
    rig.advance(Duration.ofSeconds(1));
    assertThat(rig.status()).contains("dropped 1 (older 1)");
  }

  // ---------------------------------------------------------------- criterion 3

  @Test
  void criterion3_anOlderEventIsIgnored() {
    var rig = new Rig("tak-north");
    rig.feed("tak-north", Samples.at("u1", 100, 59.0, 18.0));
    rig.feed("tak-north", Samples.at("u1", 50, 58.0, 17.0)); // older by @time
    assertThat(position(rig.object("u1"))).isEqualTo(Position.of(18.0, 59.0));
    assertThat(rig.object("u1").version()).isEqualTo(1);
    rig.feed("tak-north", Samples.at("u1", 150, 60.0, 19.0));
    assertThat(position(rig.object("u1"))).isEqualTo(Position.of(19.0, 60.0));
    rig.advance(Duration.ofSeconds(1));
    assertThat(rig.status()).contains("dropped 1 (older 1)");
  }

  @Test
  void criterion3_aNewerEventIsNotReplacedByAnOlderOneWhileTheChangeIsInFlight() {
    var rig = new Rig("tak-north");
    rig.feed("tak-north", Samples.at("u1", 0, 59.0, 18.0));
    rig.ctx.store().dropNextRequest(); // the next change never arrives: it stays in flight until its timeout
    rig.feed("tak-north", Samples.at("u1", 200, 60.0, 19.0));
    rig.feed("tak-north", Samples.at("u1", 100, 58.0, 17.0)); // older than the one in flight
    rig.feed("tak-north", Samples.at("u1", 300, 61.0, 20.0)); // waits
    rig.feed("tak-north", Samples.at("u1", 250, 57.0, 16.0)); // older than the one that waits
    assertThat(position(rig.object("u1"))).isEqualTo(Position.of(18.0, 59.0));
    rig.advance(Duration.ofSeconds(11));
    assertThat(position(rig.object("u1"))).isEqualTo(Position.of(20.0, 61.0));
    assertThat(rig.status()).contains("older 2");
  }

  @Test
  void criterion3_anEventWithoutATimeIsNeverOlder() {
    var rig = new Rig("tak-north");
    rig.feed("tak-north", Samples.at("u1", 100, 59.0, 18.0));
    rig.feed("tak-north", "<event uid=\"u1\" type=\"a-f-G-U-C-I\"><point lat=\"61.0\" lon=\"20.0\"/></event>");
    assertThat(position(rig.object("u1"))).isEqualTo(Position.of(20.0, 61.0));
  }

  // ---------------------------------------------------------------- criterion 4

  @Test
  void criterion4_unmappedCotIsKeptAndSurvivesAUsersMove() {
    var rig = new Rig("tak-north");
    rig.feed("tak-north", Samples.UNIT);
    MapObject object = rig.object("ANDROID-358240051111110");
    JsonObject ext = object.content().extensions().get("cot");
    assertThat(ext.getString("how")).isEqualTo("m-g");
    assertThat(ext.getNumber("ce").text()).isEqualTo("9999999.0");
    assertThat(ext.getNumber("le").text()).isEqualTo("9999999.0");
    assertThat(ext.getString("detail")).contains("<priv:plugin xmlns:priv=\"urn:example:private\"");

    // A user moves the object in emc2: draw-symbols (or any other plugin) writes core fields. The cot extension is not theirs, and stays.
    MapObjectContent c = object.content();
    var moved = new MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), c.layerId(), new Geometry.Point(Position.of(11.9746, 57.7089)),
        c.symbol(), c.style(), c.properties(), c.label(), c.extensions().with("cot", JsonObject.empty()));
    rig.ctx.store().applyAs(new Actor("draw-symbols", "user-1", null), Change.updateObject(object, moved));
    rig.ctx.runUntilIdle();
    MapObject afterMove = rig.object("ANDROID-358240051111110");
    assertThat(position(afterMove)).isEqualTo(Position.of(11.9746, 57.7089));
    assertThat(afterMove.content().extensions().get("cot")).isEqualTo(ext);

    // The next event from TAK overwrites the core fields (last write wins) and the extension is still the same.
    rig.feed("tak-north", Samples.UNIT.replace("2026-10-03T08:20:00.000Z\" start", "2026-10-03T08:21:00.000Z\" start"));
    MapObject afterEvent = rig.object("ANDROID-358240051111110");
    assertThat(position(afterEvent)).isEqualTo(Position.of(18.1012, 59.3507, 45.2));
    assertThat(afterEvent.content().extensions().get("cot")).isEqualTo(ext);
    assertThat(afterEvent.content().extensions().namespaces().keySet()).containsExactly("cot");
  }

  @Test
  void criterion4_otherPluginsExtensionsAreForwardedUntouched() {
    var rig = new Rig("tak-north");
    rig.feed("tak-north", Samples.at("u1", 0, 59.0, 18.0));
    MapObject object = rig.object("u1");
    MapObjectContent c = object.content();
    var mine = JsonObject.builder().put("note", JsonString.of("keep me")).build();
    rig.ctx.store().applyAs(Actor.plugin("other-plugin"), Change.updateObject(object, new MapObjectContent(c.type(), c.dataType(), c.dataSource(),
        c.time(), c.layerId(), c.geometry(), c.symbol(), c.style(), c.properties(), c.label(), c.extensions().with("other-plugin", mine))));
    rig.ctx.runUntilIdle();
    rig.feed("tak-north", Samples.at("u1", 10, 59.1, 18.1));
    assertThat(rig.object("u1").content().extensions().get("other-plugin")).isEqualTo(mine);
    assertThat(rig.ctx.store().requests().getLast().data()).isInstanceOf(MapObjectContent.class);
    assertThat(((MapObjectContent) rig.ctx.store().requests().getLast().data()).extensions().namespaces().keySet())
        .as("the plugin writes only its own namespace").containsExactly("cot");
  }

  @Test
  void anObjectKeepsItsLayerLabelAndStyleWhenAnEventUpdatesIt() {
    var rig = new Rig("tak-north");
    rig.feed("tak-north", Samples.at("u1", 0, 59.0, 18.0));
    MapObject object = rig.object("u1");
    var otherLayer = rig.ctx.store().seedLayer("Elsewhere");
    MapObjectContent c = object.content();
    var label = dev.emcc.sdk.model.SecurityLabel.of("NATO", "NATO SECRET");
    var style = new dev.emcc.sdk.model.Style("#336699", 3.0, null, null, null, null);
    rig.ctx.store().applyAs(Actor.plugin("layer-panel"), Change.updateObject(object, new MapObjectContent(c.type(), c.dataType(), c.dataSource(),
        c.time(), otherLayer.id(), c.geometry(), c.symbol(), style, c.properties(), label, c.extensions())));
    rig.ctx.runUntilIdle();
    rig.feed("tak-north", Samples.at("u1", 10, 59.1, 18.1));
    MapObject after = rig.object("u1");
    assertThat(after.content().layerId()).isEqualTo(otherLayer.id());
    assertThat(after.content().label()).isEqualTo(label);
    assertThat(after.content().style()).isEqualTo(style);
    assertThat(position(after)).isEqualTo(Position.of(18.1, 59.1));
  }

  // ---------------------------------------------------------------- criterion 5

  @Test
  void criterion5_timeStartAndStaleEndUpInTheTimeAttributes() {
    var rig = new Rig("tak-north");
    rig.feed("tak-north", Samples.UNIT);
    var time = rig.object("ANDROID-358240051111110").content().time();
    assertThat(time.observed()).isEqualTo(Instant.parse("2026-10-03T08:20:00.000Z"));
    assertThat(time.validFrom()).isEqualTo(Instant.parse("2026-10-03T08:20:00.000Z"));
    assertThat(time.expires()).isEqualTo(Instant.parse("2026-10-03T08:25:00.000Z"));
  }

  @Test
  void criterion5_theDataTypeDeclaresFadingAndRemovalTenMinutesAfterTheExpiry() {
    JsonObject cot = (JsonObject) ((dev.emcc.sdk.json.JsonArray) Manifest.read().get("dataTypes")).get(0);
    assertThat(cot.getString("id")).isEqualTo("cot.cot");
    assertThat(cot.getString("name")).isEqualTo("CoT");
    JsonObject defaults = cot.getObject("defaults");
    assertThat(defaults.getBoolean("fadeWhenExpired")).isTrue();
    assertThat(defaults.getNumber("removeAfterExpirySeconds").longValueExact()).isEqualTo(600);
  }

  @Test
  void criterion5_thePluginNeverDeletesExpiredObjects() {
    var rig = new Rig("tak-north");
    rig.feed("tak-north", Samples.at("u1", 0, 59.0, 18.0)); // stale after five minutes; ECore removes it, the plugin does not
    rig.advance(Duration.ofHours(5));
    assertThat(rig.requests(Operation.DELETE)).isZero();
    assertThat(rig.objects()).hasSize(1);
  }

  // ---------------------------------------------------------------- criterion 6

  @Test
  void criterion6_badInputIsDroppedCountedAndTheLinkContinues() {
    var rig = new Rig("tak-north");
    String xxe = "<?xml version=\"1.0\"?><!DOCTYPE event [<!ENTITY secret SYSTEM \"file:///c:/windows/win.ini\">]>"
        + "<event uid=\"xxe\" type=\"a-f-G\"><point lat=\"1.5\" lon=\"2.5\"/><detail><remarks>&secret;</remarks></detail></event>";
    String big = "<event uid=\"big\" type=\"a-f-G\"><point lat=\"1.5\" lon=\"2.5\"/><detail>" + "x".repeat(1_000_000) + "</detail></event>";
    String malformed = "<event uid=\"bad\" type=\"a-f-G\"><point lat=\"1.5\" lon=\"2.5\"></event>";
    rig.feed("tak-north", malformed + xxe + big + Samples.at("good", 0, 59.0, 18.0), 4);
    rig.advance(Duration.ofSeconds(1));

    assertThat(rig.objects()).extracting(o -> o.meta().externalRef().id()).containsExactly("good");
    assertThat(rig.conn("tak-north").closedByPlugin()).as("the link continues").isFalse();
    assertThat(rig.status()).contains("connected since").contains("4 read").contains("malformed 2").contains("too large 1");
    assertThat(rig.warnings()).as("at most one warning per minute").hasSize(1);

    rig.feed("tak-north", malformed + big, 2);
    assertThat(rig.warnings()).as("still within the minute").hasSize(1);
    assertThat(rig.object("good")).isNotNull();
  }

  @Test
  void criterion6_oneFloodGivesOneWarningHoweverManyEventsItHolds() {
    // That a warning comes again after a minute is tested with a clock of its own (WarnLimiterTest).
    var rig = new Rig("tak-north");
    var flood = new StringBuilder();
    for (int i = 0; i < 500; i++) {
      flood.append("<event uid=\"bad").append(i).append("\"><oops></event>");
    }
    rig.feed("tak-north", flood.toString(), 500);
    assertThat(rig.warnings()).hasSize(1);
    rig.advance(Duration.ofSeconds(1));
    assertThat(rig.status()).contains("malformed 500");
  }

  @Test
  void criterion6_theWarningLimitIsPerLinkAndNotPerConnection() {
    var rig = new Rig("tak-north");
    String malformed = "<event uid=\"bad\" type=\"a-f-G\"><point lat=\"1.5\" lon=\"2.5\"></event>";
    TcpPeer peer = rig.peer("tak-north");
    for (int connection = 1; connection <= 3; connection++) {
      rig.feed("tak-north", malformed);
      peer.liveConn().close();
      TcpPeer.waitUntil(() -> {
        rig.ctx.runUntilIdle();
        return rig.status().contains("not connected");
      }, "the loss to be seen");
      rig.advance(Duration.ofSeconds(1L << (connection - 1))); // 1 s, 2 s, 4 s: the back-off
      peer.awaitConnection(connection + 1);
      rig.awaitUp("tak-north");
    }
    assertThat(rig.warnings()).as("three connections, one warning a minute for the link").hasSize(1);
    rig.advance(Duration.ofSeconds(61));
    rig.feed("tak-north", malformed);
    assertThat(rig.warnings()).as("a minute later one more, saying how many were dropped meanwhile").hasSize(2);
    assertThat(rig.warnings().getLast().message()).contains("more dropped since the last warning");
  }

  @Test
  void criterion6_textFromThePeerCannotForgeALogLine() {
    var rig = new Rig("tak-north");
    // a time that is not a time, with a line break and a fake log line inside the attribute (&#10; survives parsing)
    rig.feed("tak-north", "<event uid=\"a\" type=\"a-f-G\" time=\"x&#10;2026-10-12 ERROR forged\"><point lat=\"1.5\" lon=\"2.5\"/></event>");
    assertThat(rig.warnings()).hasSize(1);
    assertThat(rig.warnings().getFirst().message()).doesNotContain("\n").doesNotContain("\r");
  }

  @Test
  void criterion6_aSecretNeverEntersTheObjectsOrTheLog() {
    var rig = new Rig("tak-north");
    rig.feed("tak-north", "<?xml version=\"1.0\"?><!DOCTYPE event [<!ENTITY secret SYSTEM \"file:///c:/windows/win.ini\">]>"
        + "<event uid=\"xxe\" type=\"a-f-G\"><point lat=\"1.5\" lon=\"2.5\"/><detail><remarks>&secret;</remarks></detail></event>");
    assertThat(rig.objects()).isEmpty();
    assertThat(rig.ctx.logEntries()).noneMatch(e -> e.message().contains("win.ini"));
  }

  // ---------------------------------------------------------------- criterion 7

  @Test
  void criterion7_aLostLinkIsReconnectedAndTheOthersAreNotAffected() {
    var rig = new Rig("tak-north", "tak-south");
    rig.feed("tak-north", Samples.at("n1", 0, 59.0, 18.0));
    rig.feed("tak-south", Samples.at("s1", 0, 55.0, 13.0));
    assertThat(rig.status()).contains("tak-north: connected since").contains("tak-south: connected since").doesNotContain("not connected");
    assertThat(rig.ctx.effectiveStatus().state()).isEqualTo(PluginState.OK);

    rig.conn("tak-north").close(); // the TAK Server goes away
    TcpPeer.waitUntil(() -> {
      rig.ctx.runUntilIdle();
      return rig.status().contains("not connected");
    }, "the link to be seen as lost");
    assertThat(rig.status()).contains("not connected (the peer closed the connection)").contains("next try");
    assertThat(rig.ctx.effectiveStatus().state()).isEqualTo(PluginState.DEGRADED);

    // another link and the objects go on
    rig.feed("tak-south", Samples.at("s1", 10, 55.1, 13.1));
    assertThat(position(rig.object("s1"))).isEqualTo(Position.of(13.1, 55.1));

    rig.advance(Duration.ofMillis(999));
    assertThat(rig.peer("tak-north").accepted()).as("not before the first delay of 1 s").isEqualTo(1);
    rig.advance(Duration.ofMillis(1));
    rig.peer("tak-north").awaitConnection(2);
    rig.awaitUp("tak-north");
    assertThat(rig.ctx.effectiveStatus().state()).isEqualTo(PluginState.OK);

    rig.feed("tak-north", Samples.at("n1", 60, 59.5, 18.5));
    assertThat(position(rig.object("n1"))).isEqualTo(Position.of(18.5, 59.5));
  }

  @Test
  void criterion7_theDelayBetweenAttemptsStartsAtOneSecondAndDoubles() {
    var rig = new Rig("tak-north");
    var task = rig.ctx.connectionTask("tak-north");
    long[] delays = {1, 2, 4, 8};
    for (int failure = 1; failure <= delays.length; failure++) {
      long delay = delays[failure - 1];
      // Nothing below depends on real time: the run is up, it is ended as a broken connection ends it, the test waits until the restart and
      // its timer are in place, and only then does the clock move. What is asked of the task's state is true as soon as the clock has moved.
      task.fail("the test broke the connection");
      task.awaitIdle();
      rig.ctx.runUntilIdle();
      assertThat(task.restarts()).as("the run's end is counted").isEqualTo(failure);
      assertThat(task.state()).isEqualTo(FakeTask.State.RESTARTING);
      assertThat(rig.status()).contains("not connected").contains("next try");

      rig.advance(Duration.ofMillis(delay * 1000 - 1));
      assertThat(task.state()).as("no attempt before the delay of " + delay + " s is over").isEqualTo(FakeTask.State.RESTARTING);
      rig.advance(Duration.ofMillis(1));
      assertThat(task.state()).as("the attempt starts when the delay of " + delay + " s is over").isEqualTo(FakeTask.State.RUNNING);
      // the new run connects (a real socket to the peer's listening port); it is up when the plugin says so
      TcpPeer.waitUntil(() -> {
        rig.ctx.runUntilIdle();
        return rig.part("tak-north").startsWith("tak-north: connected since");
      }, "the link to connect again after " + delay + " s", 60);
    }
    assertThat(task.restarts()).isEqualTo(delays.length);
  }

  @Test
  void criterion7_aLinkThatReceivesNothingIsClosedAndConnectedAgain() {
    var rig = new Rig("tak-north");
    rig.ctx.changeSettings(rig.ctx.settings().with("idleTimeoutSeconds", dev.emcc.sdk.json.JsonNumber.of(1)));
    rig.ctx.runUntilIdle();
    rig.awaitUp("tak-north"); // the change restarts the link
    int before = rig.peer("tak-north").accepted();
    // the idle time is real time, as the socket's read timeout is
    TcpPeer.waitUntil(() -> {
      rig.ctx.runUntilIdle();
      return rig.status().contains("idle for 1 s");
    }, "the idle link to be closed");
    rig.advance(Duration.ofSeconds(1));
    rig.peer("tak-north").awaitConnection(before + 1);
  }

  // ---------------------------------------------------------------- criterion 8

  @Test
  void criterion8_twoLinksGiveDifferentDataSourcesAndLayers() {
    var rig = new Rig("tak-north", "tak-south");
    rig.feed("tak-north", Samples.at("n1", 0, 59.0, 18.0));
    rig.feed("tak-south", Samples.at("s1", 0, 55.0, 13.0));
    assertThat(rig.object("n1").content().dataSource()).isEqualTo("tak-north");
    assertThat(rig.object("s1").content().dataSource()).isEqualTo("tak-south");
    assertThat(rig.layerOf(rig.object("n1")).content().name()).isEqualTo("tak-north");
    assertThat(rig.layerOf(rig.object("s1")).content().name()).isEqualTo("tak-south");
    assertThat(rig.layerOf(rig.object("n1")).id()).isNotEqualTo(rig.layerOf(rig.object("s1")).id());
  }

  @Test
  void criterion8_theSameUidOnBothLinksIsOneObjectThatKeepsItsFirstLinkAndLayer() {
    var rig = new Rig("tak-north", "tak-south");
    rig.feed("tak-north", Samples.at("shared", 0, 59.0, 18.0));
    var layer = rig.layerOf(rig.object("shared")).id();
    rig.feed("tak-south", Samples.at("shared", 10, 55.0, 13.0));
    assertThat(rig.objects()).hasSize(1);
    MapObject object = rig.object("shared");
    assertThat(position(object)).isEqualTo(Position.of(13.0, 55.0));
    assertThat(object.content().dataSource()).isEqualTo("tak-north");
    assertThat(object.content().layerId()).isEqualTo(layer);
    assertThat(object.meta().created().by().system()).isEqualTo("tak-north");
    assertThat(object.meta().modified().by().system()).as("each change names the link it came from").isEqualTo("tak-south");
    assertThat(rig.ctx.store().layers()).extracting(l -> l.content().name()).containsExactly("tak-north");
  }

  // ---------------------------------------------------------------- function 9

  @Test
  void function9_theFirstThingWrittenOnAConnectionIsOnePresenceEvent() throws Exception {
    var rig = new Rig(true, "tak-north");
    rig.ctx.changeSettings(rig.ctx.settings().with("presenceCallsign", JsonString.of("emc2-demo")));
    rig.ctx.runUntilIdle();
    rig.awaitUp("tak-north");
    TcpPeer peer = rig.peer("tak-north");
    String written = peer.conn().received();
    TcpPeer.waitUntil(() -> peer.conn().received().contains("</event>") || peer.conn().received().contains("/>"), "the presence event");
    written = peer.conn().received();
    var event = new dev.emcc.plugins.cot.codec.CotXml().parse(written);
    assertThat(event.type()).isEqualTo("t-x-c-t");
    assertThat(event.callsign()).isEqualTo("emc2-demo");

    rig.feed("tak-north", Samples.at("u1", 0, 59.0, 18.0));
    assertThat(peer.conn().received()).as("it sends nothing else").isEqualTo(written);

    // and once more on the next connection
    int connections = peer.accepted();
    peer.liveConn().close();
    TcpPeer.waitUntil(() -> {
      rig.ctx.runUntilIdle();
      return rig.status().contains("not connected");
    }, "the loss to be seen");
    rig.advance(Duration.ofSeconds(1));
    peer.awaitConnection(connections + 1);
    TcpPeer.waitUntil(() -> peer.conn().received().contains("emc2-demo"), "the presence event on the new connection");
  }

  @Test
  void function9_presenceCanBeSwitchedOff() throws Exception {
    var rig = new Rig("tak-north");
    Thread.sleep(100);
    assertThat(rig.conn("tak-north").received()).isEmpty();
  }

  // ---------------------------------------------------------------- the object store

  @Test
  void anObjectDeletedByAUserIsCreatedAgainByTheNextEvent() {
    var rig = new Rig("tak-north");
    rig.feed("tak-north", Samples.at("u1", 0, 59.0, 18.0));
    MapObject first = rig.object("u1");
    rig.ctx.store().applyAs(Actor.plugin("draw-symbols"), Change.deleteObject(first));
    rig.ctx.runUntilIdle();
    assertThat(rig.objects()).isEmpty();

    rig.feed("tak-north", Samples.at("u1", 10, 59.1, 18.1));
    assertThat(rig.objects()).hasSize(1);
    assertThat(rig.object("u1").id()).isNotEqualTo(first.id());
    assertThat(rig.object("u1").version()).isEqualTo(1);
  }

  @Test
  void anObjectRemovedByECoreAfterItsExpiryIsCreatedAgainByANewEvent() {
    var rig = new Rig("tak-north");
    rig.feed("tak-north", Samples.at("u1", 0, 59.0, 18.0));
    // ECore's removal is an ordinary delete change request by someone else
    rig.ctx.store().applyAs(Actor.plugin("ecore"), Change.deleteObject(rig.object("u1")));
    rig.ctx.runUntilIdle();
    rig.feed("tak-north", Samples.at("u1", 2000, 59.2, 18.2));
    assertThat(position(rig.object("u1"))).isEqualTo(Position.of(18.2, 59.2));
  }

  @Test
  void aRejectedChangeIsCountedAndTheNextEventGoesThrough() {
    var rig = new Rig("tak-north");
    rig.feed("tak-north", Samples.at("u1", 0, 59.0, 18.0));
    rig.ctx.store().rejectNext(ChangeRejection.Code.VALIDATION_FAILED, "no good");
    rig.feed("tak-north", Samples.at("u1", 10, 59.1, 18.1));
    assertThat(position(rig.object("u1"))).isEqualTo(Position.of(18.0, 59.0));
    rig.advance(Duration.ofSeconds(1));
    assertThat(rig.status()).contains("rejected 1");
    assertThat(rig.warnings()).hasSize(1);

    rig.feed("tak-north", Samples.at("u1", 20, 59.2, 18.2));
    assertThat(position(rig.object("u1"))).isEqualTo(Position.of(18.2, 59.2));
  }

  @Test
  void aCreateWhoseAnswerIsLostDoesNotMakeASecondObject() {
    var rig = new Rig("tak-north");
    rig.feed("tak-north", Samples.at("u0", 0, 50.0, 10.0)); // makes the layer
    rig.ctx.store().loseNextAnswer();
    rig.feed("tak-north", Samples.at("u1", 0, 59.0, 18.0));
    rig.advance(Duration.ofSeconds(11)); // the timeout: the outcome is unknown, the plugin looks the object up and sends the event again
    assertThat(rig.objects().stream().filter(o -> o.meta().externalRef().id().equals("u1"))).hasSize(1);
    assertThat(position(rig.object("u1"))).isEqualTo(Position.of(18.0, 59.0));
  }

  @Test
  void aCreateThatNeverArrivedIsSentAgain() {
    var rig = new Rig("tak-north");
    rig.feed("tak-north", Samples.at("u0", 0, 50.0, 10.0));
    rig.ctx.store().dropNextRequest();
    rig.feed("tak-north", Samples.at("u1", 0, 59.0, 18.0));
    assertThat(rig.objects()).hasSize(1);
    rig.advance(Duration.ofSeconds(11));
    assertThat(rig.object("u1")).isNotNull();
    assertThat(rig.objects()).hasSize(2);
  }

  @Test
  void anUpdateWhoseAnswerIsLostIsAppliedOnceAndTheLatestStateWins() {
    var rig = new Rig("tak-north");
    rig.feed("tak-north", Samples.at("u1", 0, 59.0, 18.0));
    rig.ctx.store().loseNextAnswer();
    rig.feed("tak-north", Samples.at("u1", 10, 59.1, 18.1));
    rig.advance(Duration.ofSeconds(11));
    assertThat(rig.objects()).hasSize(1);
    assertThat(position(rig.object("u1"))).isEqualTo(Position.of(18.1, 59.1));
  }

  @Test
  void aFlappingStoreSnapshotDoesNotDuplicateOrLoseObjects() {
    var rig = new Rig("tak-north");
    rig.feed("tak-north", Samples.at("u1", 0, 59.0, 18.0));
    rig.ctx.store().gap();
    rig.ctx.runUntilIdle();
    rig.feed("tak-north", Samples.at("u1", 10, 59.1, 18.1));
    rig.ctx.store().gap();
    rig.feed("tak-north", Samples.at("u1", 20, 59.2, 18.2));
    assertThat(rig.objects()).hasSize(1);
    assertThat(rig.object("u1").version()).isEqualTo(3);
  }

  @Test
  void thePluginNeverDeletesAnything() {
    var rig = new Rig("tak-north", "tak-south");
    rig.feed("tak-north", Samples.at("u1", 0, 59.0, 18.0) + Samples.at("u2", 0, 58.0, 17.0));
    rig.feed("tak-south", Samples.at("u1", 5, 55.0, 13.0));
    rig.ctx.changeSettings(rig.withLinks());
    rig.advance(Duration.ofMinutes(30));
    assertThat(rig.requests(Operation.DELETE)).isZero();
  }

  @Test
  void stoppingThePluginCancelsItsTimerAndSubscription() {
    var rig = new Rig("tak-north");
    rig.plugin.stop();
    assertThat(rig.ctx.activeTimers()).isZero();
    assertThat(rig.ctx.handlerErrors()).isEmpty();
  }

  @Test
  void theRawDetailOfAReceivedEventIsStoredUnchanged() throws Exception {
    var rig = new Rig("tak-north");
    rig.feed("tak-north", Samples.UNIT);
    String stored = rig.object("ANDROID-358240051111110").content().extensions().get("cot").getString("detail");
    String sent = Samples.UNIT.substring(Samples.UNIT.indexOf("<detail>") + 8, Samples.UNIT.lastIndexOf("</detail>"));
    assertThat(stored).isEqualTo(sent);
  }
}
