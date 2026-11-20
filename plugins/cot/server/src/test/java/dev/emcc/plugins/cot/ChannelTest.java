package dev.emcc.plugins.cot;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.cot.codec.CotEvent;
import dev.emcc.sdk.channel.ChannelCapability;
import dev.emcc.sdk.channel.ChannelId;
import dev.emcc.sdk.channel.ChannelInfo;
import dev.emcc.sdk.channel.ChannelItem;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.FieldRef;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Modifiers;
import dev.emcc.sdk.model.ObjectProperties;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import dev.emcc.sdk.model.TextModifier;
import dev.emcc.sdk.model.TimeAttributes;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** Output channels (brief function 15; criteria 20, 21 for the channel, 25): what other plugins hand to a link goes out as CoT. */
class ChannelTest {

  @AfterEach
  void closeRigs() {
    Rig.closeAll();
  }

  private static ChannelId id(String link) {
    return new ChannelId("cot", link);
  }

  private static MapObjectContent track(Rig rig, String name, double lon, double lat) {
    return new MapObjectContent("core.symbol", "core.general", "sim", null, UUID.randomUUID(), new Geometry.Point(Position.of(lon, lat, 100.0)),
        new Symbol(SymbolStandard.APP_6D, "10031000001211000000", Modifiers.builder().direction(90).speed(12.5).build()), null,
        new ObjectProperties(name, null), rig.ctx.defaultLabel(), Extensions.empty());
  }

  private static MapObjectContent expiring(MapObjectContent c, Instant expires) {
    return new MapObjectContent(c.type(), c.dataType(), c.dataSource(), new TimeAttributes(null, null, expires), c.layerId(), c.geometry(), c.symbol(),
        c.style(), c.properties(), c.label(), c.extensions());
  }

  private static MapObjectContent with(MapObjectContent c, SecurityLabel label) {
    return new MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), c.layerId(), c.geometry(), c.symbol(), c.style(), c.properties(), label,
        c.extensions());
  }

  private static void send(Rig rig, String link, ChannelItem item) {
    rig.ctx.channels().deliver(id(link), item);
    rig.ctx.runUntilIdle();
  }

  private static ChannelInfo info(Rig rig, String link) {
    return rig.ctx.channels().offered().stream().filter(c -> c.id().equals(id(link))).findFirst().orElseThrow();
  }

  // ---------------------------------------------------------------- criterion 20: what is offered

  @Test
  void criterion20_everyEnabledOutOrBothLinkIsAChannelWithTypeCotDeleteAndTheThreeFields() {
    var rig = new Rig();
    rig.addLink("tak-in", "");
    rig.addOutLink("tak-out", "out", List.of(), "");
    rig.addOutLink("tak-both", "both", List.of(), "");
    assertThat(rig.ctx.channels().offered()).extracting(c -> c.id().toString()).containsExactlyInAnyOrder("cot/tak-out", "cot/tak-both");
    ChannelInfo channel = info(rig, "tak-out");
    assertThat(channel.name()).isEqualTo("tak-out");
    assertThat(channel.outputType()).isEqualTo("cot");
    assertThat(channel.capabilities()).containsExactly(ChannelCapability.DELETE);
    assertThat(channel.fields()).containsExactlyInAnyOrder(new FieldRef("cot", "team"), new FieldRef("cot", "role"), new FieldRef("cot", "staleSeconds"));
  }

  @Test
  void criterion20_aDisabledLinkWithdrawsItsChannelAndEnablingOffersItAgain() {
    var rig = new Rig();
    TcpPeer peer = rig.addOutLink("tak-out", "out", List.of(), "");
    assertThat(rig.ctx.channels().offered()).hasSize(1);
    String off = Rig.tcp("tak-out", peer.port(), "out").replace("\"direction\"", "\"enabled\":false,\"direction\"");
    rig.ctx.changeSettings(rig.withLinks(off));
    rig.ctx.runUntilIdle();
    assertThat(rig.ctx.channels().offered()).isEmpty();
    rig.ctx.changeSettings(rig.withLinks(Rig.tcp("tak-out", peer.port(), "out")));
    rig.ctx.runUntilIdle();
    assertThat(rig.ctx.channels().offered()).extracting(c -> c.id().toString()).containsExactly("cot/tak-out");
  }

  @Test
  void criterion20_renamingTheLinkWithdrawsTheOldIdAndOffersTheNewOne() {
    var rig = new Rig();
    TcpPeer peer = rig.addOutLink("tak-old", "out", List.of(), "");
    rig.ctx.changeSettings(rig.withLinks(Rig.tcp("tak-new", peer.port(), "out")));
    rig.ctx.runUntilIdle();
    assertThat(rig.ctx.channels().offered()).extracting(c -> c.id().toString()).containsExactly("cot/tak-new");
    assertThat(rig.ctx.channels().send(id("tak-old"), new ChannelItem.Removal(UUID.randomUUID()))).as("a sender that saved the old id gets CLOSED: it shows it as missing")
        .isEqualTo(dev.emcc.sdk.worker.SendResult.CLOSED);
  }

  @Test
  void criterion20_aRemovedLinkOrOneWithAProblemOrOneThatOnlyReceivesIsNoChannel() {
    var rig = new Rig();
    TcpPeer peer = rig.addOutLink("tak-out", "out", List.of(), "");
    rig.ctx.changeSettings(rig.withLinks());
    rig.ctx.runUntilIdle();
    assertThat(rig.ctx.channels().offered()).isEmpty();
    rig.ctx.changeSettings(rig.withLinks("{\"name\":\"no-host\",\"direction\":\"out\",\"transport\":\"udp\",\"port\":9}", Rig.tcp("only-in", peer.port(), "in")));
    rig.ctx.runUntilIdle();
    assertThat(rig.ctx.channels().offered()).isEmpty();
  }

  @Test
  void theChannelStaysWhenTheLinkReconnectsOrItsHostChanges() {
    var rig = new Rig();
    TcpPeer peer = rig.addOutLink("tak-out", "out", List.of(), "");
    TcpPeer other = rig.addPeer("other");
    rig.ctx.changeSettings(rig.withLinks(Rig.tcp("tak-out", other.port(), "out")));
    rig.ctx.runUntilIdle();
    other.conn();
    assertThat(rig.ctx.channels().offered()).extracting(c -> c.id().toString()).containsExactly("cot/tak-out");
    peer.close();
  }

  // ---------------------------------------------------------------- what goes out

  @Test
  void criterion15_aChannelItemThatComesBackThroughAnotherLinkIsStoredAndNotTakenForAnEcho() {
    // Echo loops come from source layers, not from a sender (brief function 19; owner, 2026-10-28): a sender such as the simulator hands
    // tracks to link A and expects them back through link B into a layer, so the uid emc2 made up for an item is not remembered as sent
    var rig = new Rig();
    rig.addLink("tak-in", "");
    rig.addOutLink("tak-out", "out", List.of(), "");
    UUID item = UUID.randomUUID();
    send(rig, "tak-out", new ChannelItem.Update(item, expiring(track(rig, "ALPHA", 11.0, 57.0), rig.clock.instant().plusSeconds(60))));
    CotEvent sent = rig.awaitSent("tak-out", 1).getFirst();
    assertThat(sent.uid()).isEqualTo(item.toString());

    // the TAK Server relays it to the input link of the same network
    Instant at = rig.clock.instant();
    var iso = java.time.format.DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(java.time.ZoneOffset.UTC);
    rig.feed("tak-in", dev.emcc.plugins.cot.codec.Samples.atom(sent.uid(), sent.type(), 57.0, 11.0, iso.format(at.plusSeconds(1)), iso.format(at.plusSeconds(60))));
    rig.advance(Duration.ofSeconds(2));
    assertThat(rig.object(sent.uid()).content().dataSource()).as("it is an object of the input link").isEqualTo("tak-in");
    assertThat(rig.part("tak-in")).contains("1 created").doesNotContain("echoes ignored");
    assertThat(rig.sent("tak-out")).as("the stored object is the input link's own: not sent back to the TAK network it came from").hasSize(1);
  }

  @Test
  void criterion14_anUpdateGoesOutAsAnEventWithTheItemsOwnValues() {
    var rig = new Rig();
    rig.addOutLink("tak-out", "out", List.of(), "");
    UUID id = UUID.randomUUID();
    send(rig, "tak-out", new ChannelItem.Update(id, track(rig, "SIM-1", 11.9746, 57.7089)));
    CotEvent event = rig.awaitSent("tak-out", 1).getFirst();
    assertThat(event.uid()).as("the object id: the item did not come from CoT").isEqualTo(id.toString());
    assertThat(event.type()).isEqualTo("a-f-G-U-C-I");
    // [lon, lat]: latitude differs from longitude
    assertThat(event.lon()).isEqualTo(11.9746);
    assertThat(event.lat()).isEqualTo(57.7089);
    assertThat(event.hae()).isEqualTo(100.0);
    assertThat(event.callsign()).isEqualTo("SIM-1");
    assertThat(event.course()).isEqualTo(90.0);
    assertThat(event.speed()).isEqualTo(12.5);
  }

  /** SDK 1.4.0 (CR-0030): a sensor report is a third item kind; cot's channels take ground truth only, so one that got past ECore sends nothing and breaks nothing. */
  @Test
  void aSensorReportSendsNothingAndTheItemsAfterItStillGoOut() {
    var rig = new Rig();
    rig.addOutLink("tak-out", "out", List.of(), "");
    UUID first = UUID.randomUUID();
    UUID last = UUID.randomUUID();
    send(rig, "tak-out", new ChannelItem.Update(first, track(rig, "BEFORE", 11.9746, 57.7089)));
    ChannelItem report = new ChannelItem.SensorReport(UUID.randomUUID(), Position.of(12.5, 58.25), rig.clock.instant(), new Geometry.Circle(Position.of(12.5, 58.25), 5000.0),
        List.of(new ChannelItem.Detection(UUID.randomUUID(), track(rig, "SEEN", 12.75, 58.5))));
    // ECore refuses a sensor report for these channels (the kit does too); the message goes to the applier as the plugin's own switch would see it
    @SuppressWarnings("unchecked")
    var applier = (dev.emcc.sdk.worker.WorkerRef<ApplierMsg>) rig.ctx.worker("applier");
    applier.send(new ApplierMsg.FromChannel("tak-out", report));
    rig.ctx.runUntilIdle();
    send(rig, "tak-out", new ChannelItem.Update(last, track(rig, "AFTER", 13.5, 59.25)));
    List<CotEvent> sent = rig.awaitSent("tak-out", 2);
    assertThat(sent).as("the two updates only: the report and its detection sent nothing").hasSize(2);
    assertThat(sent).extracting(CotEvent::callsign).containsExactly("BEFORE", "AFTER");
  }

  /** Criterion 30 (owner's M4 notes, 2026-10-30; T-107): WinTAK shows the callsign, and shows the uid of a marker that has none. */
  @Test
  void criterion30_theCallsignOfAnItemIsItsNameElseItsUniqueDesignationAndAnItemWithNeitherHasNone() {
    var rig = new Rig();
    rig.addOutLink("tak-out", "out", List.of(), "");
    UUID named = UUID.randomUUID();
    UUID designated = UUID.randomUUID();
    UUID both = UUID.randomUUID();
    UUID neither = UUID.randomUUID();
    send(rig, "tak-out", new ChannelItem.Update(named, track(rig, "ALPHA 1", 11.9746, 57.7089)));
    send(rig, "tak-out", new ChannelItem.Update(designated, designation(track(rig, null, 12.5, 58.25), "C3")));
    send(rig, "tak-out", new ChannelItem.Update(both, designation(track(rig, "BRAVO", 13.5, 59.25), "X9")));
    send(rig, "tak-out", new ChannelItem.Update(neither, track(rig, null, 14.5, 60.25)));
    List<CotEvent> events = rig.awaitSent("tak-out", 4);
    java.util.function.Function<UUID, CotEvent> by = id -> events.stream().filter(e -> id.toString().equals(e.uid())).findFirst().orElseThrow();
    assertThat(by.apply(named).callsign()).isEqualTo("ALPHA 1");
    assertThat(by.apply(designated).callsign()).as("no name: the unique designation").isEqualTo("C3");
    assertThat(by.apply(both).callsign()).as("the name wins").isEqualTo("BRAVO");
    assertThat(by.apply(neither).callsign()).isNull();
    assertThat(by.apply(neither).detail()).as("no contact element at all").doesNotContain("contact");
  }

  private static MapObjectContent designation(MapObjectContent c, String text) {
    Symbol symbol = c.symbol();
    return new MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), c.layerId(), c.geometry(),
        new Symbol(symbol.standard(), symbol.sidc(), Modifiers.builder().text(TextModifier.UNIQUE_DESIGNATION, text).direction(90).speed(12.5).build()), c.style(),
        c.properties(), c.label(), c.extensions());
  }

  @Test
  void criterion20_everyItemGoesOutAsItComesAlsoWhenItsContentIsUnchangedAndIsNotRefreshedByTheLink() {
    var rig = new Rig();
    rig.addOutLink("tak-out", "out", List.of(), "\"refreshSeconds\":5");
    UUID id = UUID.randomUUID();
    MapObjectContent content = track(rig, "SIM-1", 11.9746, 57.7089);
    for (int i = 0; i < 4; i++) {
      send(rig, "tak-out", new ChannelItem.Update(id, content));
      rig.awaitSent("tak-out", i + 1);
      rig.advance(Duration.ofSeconds(1));
    }
    assertThat(rig.sent("tak-out")).as("a sender's standing track: one event for each item, as it comes").hasSize(4);
    rig.advance(Duration.ofSeconds(60));
    assertThat(rig.sent("tak-out")).as("the link does not refresh channel items: the next item is the refresh").hasSize(4);
  }

  @Test
  void criterion20_manyItemsForOneObjectWhileTheLinkIsDownSendOnlyTheLatestWhenItIsUp() {
    var rig = new Rig();
    TcpPeer peer = rig.addOutLink("tak-out", "out", List.of(), "");
    peer.liveConn().close();
    TcpPeer.waitUntil(() -> {
      rig.ctx.runUntilIdle();
      return rig.status().contains("not connected");
    }, "the loss to be seen");
    UUID id = UUID.randomUUID();
    for (int i = 0; i < 10; i++) {
      send(rig, "tak-out", new ChannelItem.Update(id, track(rig, "SIM-1", 11.0 + i, 57.0)));
    }
    rig.advance(Duration.ofSeconds(1)); // the first delay of the back-off is over: the link connects again
    peer.awaitConnection(2);
    TcpPeer.waitUntil(() -> {
      rig.ctx.runUntilIdle();
      return !Rig.events(peer.conn().received()).isEmpty();
    }, "the latest item on the new connection");
    rig.advance(Duration.ofSeconds(2));
    List<CotEvent> events = Rig.events(peer.conn().received());
    assertThat(events).hasSize(1);
    assertThat(events.getFirst().lon()).as("the latest of the ten").isEqualTo(20.0);
  }

  @Test
  void criterion20_aRemovalIsSentAsAnEventThatIsStaleAtOnceAndOneForAnItemNeverSentIsNot() {
    var rig = new Rig();
    rig.addOutLink("tak-out", "out", List.of(), "");
    UUID id = UUID.randomUUID();
    send(rig, "tak-out", new ChannelItem.Update(id, track(rig, "SIM-1", 11.9746, 57.7089)));
    rig.awaitSent("tak-out", 1);
    send(rig, "tak-out", new ChannelItem.Removal(id));
    CotEvent gone = rig.awaitSent("tak-out", 2).get(1);
    assertThat(gone.uid()).isEqualTo(id.toString());
    assertThat(gone.stale()).isEqualTo(gone.time());
    assertThat(gone.lon()).isEqualTo(11.9746);
    assertThat(gone.lat()).isEqualTo(57.7089);

    send(rig, "tak-out", new ChannelItem.Removal(id));
    send(rig, "tak-out", new ChannelItem.Removal(UUID.randomUUID()));
    rig.advance(Duration.ofSeconds(2));
    assertThat(rig.sent("tak-out")).as("nothing was sent for them, so nothing is removed").hasSize(2);
  }

  @Test
  void aRemovalWhileTheLinkIsDownReplacesTheWaitingUpdateAndTheStaleEventGoesOutWhenItIsUp() {
    var rig = new Rig();
    TcpPeer peer = rig.addOutLink("tak-out", "out", List.of(), "");
    UUID id = UUID.randomUUID();
    send(rig, "tak-out", new ChannelItem.Update(id, track(rig, "SIM-1", 11.0, 57.0)));
    rig.awaitSent("tak-out", 1);
    peer.liveConn().close();
    TcpPeer.waitUntil(() -> {
      rig.ctx.runUntilIdle();
      return rig.status().contains("not connected");
    }, "the loss to be seen");
    send(rig, "tak-out", new ChannelItem.Update(id, track(rig, "SIM-1", 12.5, 58.5)));
    send(rig, "tak-out", new ChannelItem.Removal(id));
    rig.advance(Duration.ofSeconds(1));
    peer.awaitConnection(2);
    TcpPeer.waitUntil(() -> {
      rig.ctx.runUntilIdle();
      return !Rig.events(peer.conn().received()).isEmpty();
    }, "the stale event on the new connection");
    rig.advance(Duration.ofSeconds(2));
    List<CotEvent> events = Rig.events(peer.conn().received());
    assertThat(events).as("the waiting update was replaced by the removal").hasSize(1);
    assertThat(events.getFirst().stale()).isEqualTo(events.getFirst().time());
    assertThat(events.getFirst().lon()).as("the position of the update that waited").isEqualTo(12.5);
    assertThat(events.getFirst().lat()).isEqualTo(58.5);
  }

  @Test
  void aTrackSentBeforeAndThenRaisedAboveTheLimitGoesStaleAtOnce() {
    var rig = new Rig();
    rig.addOutLink("tak-out", "out", List.of(), "");
    UUID id = UUID.randomUUID();
    send(rig, "tak-out", new ChannelItem.Update(id, track(rig, "SIM-1", 11.9746, 57.7089)));
    rig.awaitSent("tak-out", 1);
    send(rig, "tak-out", new ChannelItem.Update(id, with(track(rig, "SIM-1", 12.0, 58.0), SecurityLabel.of("NATO", "SECRET"))));
    CotEvent gone = rig.awaitSent("tak-out", 2).get(1);
    assertThat(gone.uid()).isEqualTo(id.toString());
    assertThat(gone.stale()).isEqualTo(gone.time());
    assertThat(gone.lon()).as("what was sent before; nothing of the raised item").isEqualTo(11.9746);
    assertThat(gone.lat()).isEqualTo(57.7089);
    send(rig, "tak-out", new ChannelItem.Removal(id));
    rig.advance(Duration.ofSeconds(2));
    assertThat(rig.sent("tak-out")).as("it was retracted already").hasSize(2);
  }

  @Test
  void aLinkThatNoLongerSendsOrHasAProblemWithdrawsItsChannelAndForgetsItsItems() {
    var rig = new Rig();
    TcpPeer peer = rig.addOutLink("tak-out", "out", List.of(), "");
    UUID id = UUID.randomUUID();
    send(rig, "tak-out", new ChannelItem.Update(id, track(rig, "SIM-1", 11.0, 57.0)));
    rig.awaitSent("tak-out", 1);

    rig.ctx.changeSettings(rig.withLinks(Rig.tcp("tak-out", peer.port(), "in")));
    rig.ctx.runUntilIdle();
    assertThat(rig.ctx.channels().offered()).as("a link that only receives sends nothing").isEmpty();

    rig.ctx.changeSettings(rig.withLinks(Rig.tcp("tak-out", peer.port(), "out")));
    rig.ctx.runUntilIdle();
    assertThat(rig.ctx.channels().offered()).extracting(c -> c.id().toString()).containsExactly("cot/tak-out");
    send(rig, "tak-out", new ChannelItem.Removal(id));
    rig.advance(Duration.ofSeconds(2));
    assertThat(rig.sent("tak-out")).as("the identity went with the output: nothing is known to remove").noneMatch(e -> e.stale().equals(e.time()));

    rig.ctx.changeSettings(rig.withLinks("{\"name\":\"tak-out\",\"direction\":\"out\",\"transport\":\"tcp\",\"port\":" + peer.port() + "}"));
    rig.ctx.runUntilIdle();
    assertThat(rig.ctx.channels().offered()).as("a link with a problem (no host) is no channel").isEmpty();
  }

  @Test
  void theIdentityOfAnItemIsForgottenAtItsStaleTimeAndARefreshRenewsIt() {
    var rig = new Rig();
    rig.addOutLink("tak-out", "out", List.of(), "\"staleSeconds\":20");
    UUID kept = UUID.randomUUID();
    UUID silent = UUID.randomUUID();
    send(rig, "tak-out", new ChannelItem.Update(kept, track(rig, "KEPT", 11.9746, 57.7089)));
    send(rig, "tak-out", new ChannelItem.Update(silent, track(rig, "SILENT", 12.5, 58.5)));
    rig.awaitSent("tak-out", 2);
    rig.advance(Duration.ofSeconds(1));
    assertThat(rig.part("tak-out")).contains("2 channel items tracked");

    rig.advance(Duration.ofSeconds(15));
    send(rig, "tak-out", new ChannelItem.Update(kept, track(rig, "KEPT", 11.9746, 57.7089))); // the refresh: stale 20 s from now
    rig.awaitSent("tak-out", 3); // written, so that the removal below does not replace it in the task's inbox
    rig.advance(Duration.ofSeconds(10)); // 26 s: the silent one went stale at 20 s, the refreshed one goes at 35 s
    assertThat(rig.part("tak-out")).as("the count falls for a sender that stopped without a removal").contains("1 channel items tracked");

    send(rig, "tak-out", new ChannelItem.Removal(kept));
    CotEvent gone = rig.awaitSent("tak-out", 4).get(3);
    assertThat(gone.uid()).as("a removal after a refresh still goes out").isEqualTo(kept.toString());
    assertThat(gone.stale()).isEqualTo(gone.time());
    assertThat(gone.lon()).isEqualTo(11.9746);
    assertThat(gone.lat()).isEqualTo(57.7089);
    rig.advance(Duration.ofSeconds(1));
    assertThat(rig.part("tak-out")).doesNotContain("channel items tracked");
  }

  @Test
  void aRemovalAfterTheStaleTimeSendsNothing() {
    var rig = new Rig();
    rig.addOutLink("tak-out", "out", List.of(), "\"staleSeconds\":20");
    UUID id = UUID.randomUUID();
    send(rig, "tak-out", new ChannelItem.Update(id, track(rig, "SIM-1", 11.0, 57.0)));
    rig.awaitSent("tak-out", 1);
    rig.advance(Duration.ofSeconds(21));
    send(rig, "tak-out", new ChannelItem.Removal(id));
    rig.advance(Duration.ofSeconds(2));
    assertThat(rig.sent("tak-out")).as("TAK dropped the track at its stale time: nothing to remove").hasSize(1);
  }

  // ---------------------------------------------------------------- criterion 28: a link that is down (open question 10)

  /** Takes the link down and keeps it down: the peer closes its connection and refuses the next ones. */
  private static void down(Rig rig, TcpPeer peer) {
    peer.stopListening();
    peer.liveConn().close();
    TcpPeer.waitUntil(() -> {
      rig.ctx.runUntilIdle();
      return rig.status().contains("not connected");
    }, "the loss to be seen");
  }

  /** The peer is back: advances time until the link has connected again, and returns that connection. */
  private static TcpPeer.Conn up(Rig rig, TcpPeer peer) {
    int before = peer.accepted();
    peer.resumeListening();
    TcpPeer.waitUntil(() -> {
      rig.advance(Duration.ofSeconds(1));
      return peer.accepted() > before;
    }, "the link to connect again");
    return peer.liveConn();
  }

  private static List<CotEvent> eventsOn(Rig rig, TcpPeer.Conn conn, int count) {
    TcpPeer.waitUntil(() -> {
      rig.ctx.runUntilIdle();
      return Rig.events(conn.received()).size() >= count;
    }, count + " events on the new connection (got " + Rig.events(conn.received()).size() + "; status: " + rig.status() + ")");
    rig.advance(Duration.ofSeconds(2)); // and whatever else is in flight
    return Rig.events(conn.received());
  }

  @Test
  void criterion28_anItemThatWaitedThroughALongOutageCarriesTheTimeItWasHandedInAndOneWithoutExpiryArrivesStale() {
    var rig = new Rig();
    TcpPeer peer = rig.addOutLink("tak-out", "out", List.of(), "\"staleSeconds\":20,\"refreshSeconds\":0");
    Instant handed = rig.clock.instant();
    down(rig, peer);
    send(rig, "tak-out", new ChannelItem.Update(UUID.randomUUID(), track(rig, "NOEXPIRY", 11.9746, 57.7089)));
    send(rig, "tak-out", new ChannelItem.Update(UUID.randomUUID(), expiring(track(rig, "LASTING", 12.5, 58.5), handed.plusSeconds(300))));
    rig.advance(Duration.ofSeconds(40)); // longer than the link's staleSeconds
    List<CotEvent> events = eventsOn(rig, up(rig, peer), 2);

    assertThat(events).extracting(CotEvent::callsign).containsExactlyInAnyOrder("NOEXPIRY", "LASTING");
    CotEvent plain = events.stream().filter(e -> "NOEXPIRY".equals(e.callsign())).findFirst().orElseThrow();
    assertThat(plain.time()).as("the time it was handed to the channel").isEqualTo(handed);
    assertThat(plain.start()).isEqualTo(handed);
    assertThat(plain.stale()).isEqualTo(handed.plusSeconds(20));
    assertThat(plain.stale()).as("it arrives stale").isBefore(rig.clock.instant());
    assertThat(plain.lon()).isEqualTo(11.9746);
    assertThat(plain.lat()).isEqualTo(57.7089);
    CotEvent lasting = events.stream().filter(e -> "LASTING".equals(e.callsign())).findFirst().orElseThrow();
    assertThat(lasting.time()).isEqualTo(handed);
    assertThat(lasting.stale()).as("an item with an expiry gets it as its stale time, so it does not arrive stale").isEqualTo(handed.plusSeconds(300));
    assertThat(lasting.stale()).isAfter(rig.clock.instant());
  }

  @Test
  void criterion28_anItemWhoseExpiryPassesWhileItWaitsIsSkippedAsExpiredWhenItWouldGoOut() {
    var rig = new Rig();
    TcpPeer peer = rig.addOutLink("tak-out", "out", List.of(), "\"refreshSeconds\":0");
    Instant handed = rig.clock.instant();
    down(rig, peer);
    send(rig, "tak-out", new ChannelItem.Update(UUID.randomUUID(), expiring(track(rig, "SHORT", 11.0, 57.0), handed.plusSeconds(10))));
    send(rig, "tak-out", new ChannelItem.Update(UUID.randomUUID(), expiring(track(rig, "LONG", 12.0, 58.0), handed.plusSeconds(300))));
    rig.advance(Duration.ofSeconds(30));
    List<CotEvent> events = eventsOn(rig, up(rig, peer), 1);

    assertThat(events).as("the one that expired is not sent").extracting(CotEvent::callsign).containsExactly("LONG");
    rig.advance(Duration.ofSeconds(1));
    assertThat(rig.part("tak-out")).contains("skipped 1 (expired 1)");
    assertThat(rig.ctx.connectionTask("tak-out").counter("skipped: expired")).as("the monitor view has it too").isEqualTo(1L);
  }

  @Test
  void criterion28_theItemPastTheLimitOfWaitingObjectsIsNotPostedAndCountedAsDropped() {
    var rig = Rig.withCaps(new LinkOutput.Caps(200_000, 3));
    TcpPeer peer = rig.addOutLink("tak-out", "out", List.of(), "\"refreshSeconds\":0");
    down(rig, peer);
    UUID first = UUID.randomUUID();
    send(rig, "tak-out", new ChannelItem.Update(first, track(rig, "ONE", 11.0, 57.0)));
    send(rig, "tak-out", new ChannelItem.Update(UUID.randomUUID(), track(rig, "TWO", 12.0, 58.0)));
    send(rig, "tak-out", new ChannelItem.Update(UUID.randomUUID(), track(rig, "THREE", 13.0, 59.0)));
    send(rig, "tak-out", new ChannelItem.Update(UUID.randomUUID(), track(rig, "FOUR", 14.0, 60.0)));
    send(rig, "tak-out", new ChannelItem.Update(first, track(rig, "ONE-AGAIN", 11.5, 57.5))); // an object that waits already: it replaces
    rig.advance(Duration.ofSeconds(1));
    assertThat(rig.part("tak-out")).as("only the fourth object was dropped").contains("skipped 1 (dropped 1)");

    List<CotEvent> events = eventsOn(rig, up(rig, peer), 3);
    assertThat(events).extracting(CotEvent::callsign).containsExactlyInAnyOrder("ONE-AGAIN", "TWO", "THREE");
  }

  @Test
  void criterion28_aWaitingRemovalOfAnUpdateThatWasNeverSentSendsNothingAndClearsTheWaitingUpdate() {
    var rig = new Rig();
    TcpPeer peer = rig.addOutLink("tak-out", "out", List.of(), "\"refreshSeconds\":0");
    UUID reached = UUID.randomUUID();
    UUID never = UUID.randomUUID();
    send(rig, "tak-out", new ChannelItem.Update(reached, track(rig, "REACHED", 11.9746, 57.7089)));
    rig.awaitSent("tak-out", 1);
    down(rig, peer);
    send(rig, "tak-out", new ChannelItem.Update(never, track(rig, "NEVER", 12.5, 58.5)));
    send(rig, "tak-out", new ChannelItem.Update(reached, track(rig, "REACHED", 11.9746, 57.7089)));
    send(rig, "tak-out", new ChannelItem.Removal(never));
    send(rig, "tak-out", new ChannelItem.Removal(reached));
    TcpPeer.Conn conn = up(rig, peer);
    UUID marker = UUID.randomUUID();
    send(rig, "tak-out", new ChannelItem.Update(marker, track(rig, "MARKER", 13.0, 59.0)));
    List<CotEvent> events = eventsOn(rig, conn, 2);

    assertThat(events).extracting(CotEvent::uid).as("nothing for the item TAK never had, and its waiting update is gone")
        .containsExactlyInAnyOrder(reached.toString(), marker.toString());
    CotEvent gone = events.stream().filter(e -> e.uid().equals(reached.toString())).findFirst().orElseThrow();
    assertThat(gone.stale()).as("the item TAK did have goes stale at once").isEqualTo(gone.time());
    assertThat(rig.part("tak-out")).doesNotContain("skipped");
  }

  @Test
  void criterion27_anItemSentPastTheCapIsCountedAsRemovalNotKeptAndItsRemovalSendsNothing() {
    var rig = Rig.withCaps(new LinkOutput.Caps(3, 20_000));
    rig.addOutLink("tak-out", "out", List.of(), "\"refreshSeconds\":0");
    var ids = new UUID[5];
    for (int i = 0; i < ids.length; i++) {
      ids[i] = UUID.randomUUID();
      send(rig, "tak-out", new ChannelItem.Update(ids[i], track(rig, "T" + i, 11.0 + i, 57.0)));
    }
    rig.awaitSent("tak-out", 5);
    rig.advance(Duration.ofSeconds(1));
    assertThat(rig.part("tak-out")).as("all five were sent; the last two could not be kept").contains("5 sent").contains("skipped 2 (removal not kept 2)");

    send(rig, "tak-out", new ChannelItem.Removal(ids[4]));
    rig.advance(Duration.ofSeconds(2));
    assertThat(rig.sent("tak-out")).as("the removal of one that was not kept sends nothing").hasSize(5);
    send(rig, "tak-out", new ChannelItem.Removal(ids[0]));
    CotEvent last = rig.awaitSent("tak-out", 6).get(5);
    assertThat(last.uid()).as("one that was kept does").isEqualTo(ids[0].toString());
    assertThat(last.stale()).isEqualTo(last.time());
  }

  @Test
  void criterion17_anItemThatIsAShapeHasNoCotTypeIsAboveTheLimitOrExpiredIsSkippedAndCounted() {
    var rig = new Rig();
    rig.addOutLink("tak-out", "out", List.of(), "");
    var polygon = new MapObjectContent("core.shape", "core.general", "sim", null, UUID.randomUUID(),
        new Geometry.Polygon(List.of(List.of(Position.of(1.0, 50.0), Position.of(2.0, 50.0), Position.of(2.0, 51.0), Position.of(1.0, 50.0)))), null, null, null,
        rig.ctx.defaultLabel(), Extensions.empty());
    send(rig, "tak-out", new ChannelItem.Update(UUID.randomUUID(), polygon));
    MapObjectContent graphic = new MapObjectContent("core.symbol", "core.general", "sim", null, UUID.randomUUID(), new Geometry.Point(Position.of(11.0, 57.0)),
        new Symbol(SymbolStandard.APP_6D, "10032500001401000000", null), null, null, rig.ctx.defaultLabel(), Extensions.empty());
    send(rig, "tak-out", new ChannelItem.Update(UUID.randomUUID(), graphic));
    send(rig, "tak-out", new ChannelItem.Update(UUID.randomUUID(), with(track(rig, "SECRET", 12.0, 58.0), SecurityLabel.of("NATO", "SECRET"))));
    send(rig, "tak-out", new ChannelItem.Update(UUID.randomUUID(), expiring(track(rig, "OLD", 13.0, 59.0), rig.clock.instant().minusSeconds(5))));
    send(rig, "tak-out", new ChannelItem.Update(UUID.randomUUID(), track(rig, "GOOD", 14.0, 60.0)));
    assertThat(rig.awaitSent("tak-out", 1)).extracting(CotEvent::callsign).containsExactly("GOOD");
    rig.advance(Duration.ofSeconds(1));
    assertThat(rig.part("tak-out")).contains("skipped 4").contains("not a symbol 1").contains("no CoT type 1").contains("above the highest classification 1").contains("expired 1");
    assertThat(rig.warnings()).as("at most one warning a minute per link").hasSize(1);
  }

  @Test
  void criterion17_everyItemIsSkippedWhileTheLimitIsUnknown() {
    var rig = new Rig();
    rig.addOutLink("tak-out", "out", List.of(), "\"highestClassification\":{\"policy\":\"NATO\",\"classification\":\"NOT A LEVEL\"}");
    send(rig, "tak-out", new ChannelItem.Update(UUID.randomUUID(), track(rig, "SIM-1", 11.0, 57.0)));
    rig.advance(Duration.ofSeconds(1));
    assertThat(rig.sent("tak-out")).isEmpty();
    assertThat(rig.part("tak-out")).contains("skipped 1 (unknown limit 1)");
  }

  @Test
  void criterion19_theStaleTimeOfAnItemIsItsExpiryThenItsStaleSecondsThenTheLinks() {
    var rig = new Rig();
    rig.addOutLink("tak-out", "out", List.of(), "\"staleSeconds\":90");
    Instant now = rig.clock.instant();
    MapObjectContent plain = track(rig, "LINK", 11.0, 57.0);
    send(rig, "tak-out", new ChannelItem.Update(UUID.randomUUID(), expiring(track(rig, "EXPIRY", 12.0, 58.0), now.plusSeconds(15)))); // the simulator's outputStaleSeconds
    send(rig, "tak-out", new ChannelItem.Update(UUID.randomUUID(), new MapObjectContent(plain.type(), plain.dataType(), plain.dataSource(), null, plain.layerId(),
        plain.geometry(), plain.symbol(), null, new ObjectProperties("OWN", null), plain.label(),
        Extensions.empty().with("cot", JsonObject.builder().put("staleSeconds", JsonNumber.of(40)).build()))));
    send(rig, "tak-out", new ChannelItem.Update(UUID.randomUUID(), plain));
    List<CotEvent> events = rig.awaitSent("tak-out", 3);
    java.util.function.Function<String, CotEvent> by = name -> events.stream().filter(e -> name.equals(e.callsign())).findFirst().orElseThrow();
    assertThat(by.apply("EXPIRY").stale()).isEqualTo(now.plusSeconds(15));
    assertThat(by.apply("OWN").stale()).isEqualTo(by.apply("OWN").time().plusSeconds(40));
    assertThat(by.apply("LINK").stale()).isEqualTo(by.apply("LINK").time().plusSeconds(90));
  }

  @Test
  void anItemWhoseDataSourceIsTheLinkIsNotSentBackToIt() {
    var rig = new Rig();
    rig.addOutLink("tak-out", "out", List.of(), "");
    MapObjectContent own = track(rig, "ECHO", 11.0, 57.0);
    send(rig, "tak-out", new ChannelItem.Update(UUID.randomUUID(), new MapObjectContent(own.type(), own.dataType(), "tak-out", null, own.layerId(), own.geometry(),
        own.symbol(), null, own.properties(), own.label(), own.extensions())));
    send(rig, "tak-out", new ChannelItem.Update(UUID.randomUUID(), track(rig, "FINE", 12.0, 58.0)));
    assertThat(rig.awaitSent("tak-out", 1)).extracting(CotEvent::callsign).containsExactly("FINE");
    rig.advance(Duration.ofSeconds(1));
    assertThat(rig.sent("tak-out")).hasSize(1);
  }

  @Test
  void itemsForAChannelThatWasWithdrawnAreDroppedAndCauseNoError() {
    var rig = new Rig();
    rig.addOutLink("tak-out", "out", List.of(), "");
    rig.ctx.changeSettings(rig.withLinks());
    rig.ctx.runUntilIdle();
    assertThat(rig.ctx.channels().send(id("tak-out"), new ChannelItem.Update(UUID.randomUUID(), track(rig, "LATE", 11.0, 57.0)))).isEqualTo(dev.emcc.sdk.worker.SendResult.CLOSED);
    assertThat(rig.ctx.handlerErrors()).isEmpty();
  }

  // ---------------------------------------------------------------- criterion 25: load

  @Test
  void criterion25_aThousandTracksAtOneHertzThroughTheChannelAreSentWithoutAGrowingBacklog() {
    var rig = new Rig();
    TcpPeer peer = rig.addOutLink("tak-out", "out", List.of(), "");
    int tracks = 1_000;
    int seconds = 10;
    UUID[] ids = new UUID[tracks];
    for (int i = 0; i < tracks; i++) {
      ids[i] = UUID.randomUUID();
    }
    var worker = rig.ctx.worker("applier");
    for (int second = 1; second <= seconds; second++) {
      for (int i = 0; i < tracks; i++) {
        rig.ctx.channels().deliver(id("tak-out"), new ChannelItem.Update(ids[i], track(rig, "T" + i, 10.0 + i / 1000.0, 55.0 + second / 100.0)));
      }
      rig.ctx.runUntilIdle();
      int expected = second * tracks;
      TcpPeer.waitUntil(() -> {
        rig.ctx.runUntilIdle();
        return count(peer.conn().received()) >= expected;
      }, "all " + expected + " events at the peer (status: " + rig.status() + ")");
      rig.advance(Duration.ofSeconds(1));
      assertThat(rig.ctx.queued(worker)).as("no backlog in the worker after second " + second).isZero();
      assertThat(rig.ctx.channels().pending(id("tak-out"))).as("none waiting in the channel").isEmpty();
    }
    assertThat(count(peer.conn().received())).isEqualTo(tracks * seconds);
    assertThat(rig.part("tak-out")).contains(tracks * seconds + " sent");
    assertThat(rig.ctx.handlerErrors()).isEmpty();
  }

  private static int count(String text) {
    int n = 0;
    for (int at = text.indexOf("</event>"); at >= 0; at = text.indexOf("</event>", at + 8)) {
      n++;
    }
    return n;
  }
}
