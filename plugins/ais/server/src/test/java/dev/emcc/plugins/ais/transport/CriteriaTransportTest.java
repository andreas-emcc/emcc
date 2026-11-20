package dev.emcc.plugins.ais.transport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.plugins.ais.ShipMapper;
import dev.emcc.plugins.ais.StandardIdentity;
import dev.emcc.plugins.ais.codec.Ais;
import dev.emcc.plugins.ais.codec.AisClass;
import dev.emcc.plugins.ais.codec.AisMessage;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.testkit.FakeTaskContext;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

/**
 * The acceptance criteria 1 to 5 and 10 of the brief ({@code docs/plugins/briefs/ais.md}, section 8), at
 * the level of a connection task: bytes in, through the framer, the checks and the decoder, to the messages
 * the worker gets and the counters the monitor view shows. Frames are written for the tests.
 */
class CriteriaTransportTest {

  private final WorkerRef<TransportMsg> sink = FakePluginContext.builder("ais").build().workers()
      .spawn(WorkerSpec.of("sink", TransportMsg.class, () -> (message, ctx) -> {}));
  private final FakeTaskContext<Message> task = FakeTaskContext.of("feed");
  private final AtomicLong now = new AtomicLong();
  private final Inbound inbound = new Inbound("feed", UUID.randomUUID(), sink, task, now::get);
  private final LineFramer framer = new LineFramer(LinkWorker.MAX_FRAME_BYTES);

  /** Bytes as a socket gives them. */
  private void bytes(String text) {
    byte[] data = text.getBytes(StandardCharsets.UTF_8);
    framer.feed(data, 0, data.length, inbound);
  }

  private void line(String sentence) {
    bytes(sentence + "\r\n");
  }

  private List<AisMessage> received() {
    return task.sent().stream().map(s -> switch ((TransportMsg) s.message()) {
      case TransportMsg.ReceivedPosition p -> (AisMessage) p.message();
      case TransportMsg.ReceivedStatic st -> st.message();
      default -> throw new AssertionError(s);
    }).toList();
  }

  private AisMessage.Position position() {
    assertThat(received()).hasSize(1);
    return (AisMessage.Position) received().getFirst();
  }

  private static final String VALID = Ais.classA(1, 265_123_456, 0, 100, 18.0723, 59.3311, 2705, 90).sentence();

  @Test
  void criterion1_aValidSentenceGivesOneRecord() {
    line(VALID);
    assertThat(position().mmsi()).isEqualTo(265_123_456);
    assertThat(task.counters().keySet()).noneMatch(k -> k.startsWith("dropped"));
  }

  @Test
  void criterion1_oneChangedCharacterOfThePayloadIsDroppedAsChecksum() {
    line(VALID.replaceFirst(",A,.", ",A,5"));
    assertThat(received()).isEmpty();
    assertThat(task.counter("dropped: checksum")).isEqualTo(1);
  }

  @Test
  void criterion1_withoutTheChecksumItIsDroppedAsNoChecksum() {
    line(VALID.substring(0, VALID.indexOf('*')));
    assertThat(received()).isEmpty();
    assertThat(task.counter("dropped: no checksum")).isEqualTo(1);
  }

  @Test
  void criterion1_aLineOf513BytesIsDroppedAsTooLongAndOneOf512IsRead() {
    bytes("!" + "A".repeat(512) + "\n"); // 513 bytes without the line end
    assertThat(task.counter("dropped: too long")).isEqualTo(1);
    bytes("!" + "A".repeat(511) + "\n"); // 512 bytes: read, and not a sentence
    assertThat(task.counter("dropped: too long")).isEqualTo(1);
    assertThat(task.counter("dropped: no checksum")).isEqualTo(1);
    line(VALID); // the framer goes on with the next line
    assertThat(received()).hasSize(1);
  }

  @Test
  void criterion1_nineFieldsAreDroppedAsMalformed() {
    line(Ais.withChecksum("AIVDM,1,1,,A,15M67FC000G?ufbE`FepT@3n00Sa,0,9"));
    assertThat(received()).isEmpty();
    assertThat(task.counter("dropped: malformed")).isEqualTo(1);
  }

  @Test
  void criterion2_aTalkerOfAnotherKindIsReadAsAivdm() {
    Ais.Msg m = Ais.classA(1, 265_123_456, 0, 100, 18.0723, 59.3311, 2705, 90);
    line(m.sentence("AIVDO"));
    line(m.sentence("BSVDM"));
    assertThat(received()).hasSize(2);
    assertThat(received().get(0)).isEqualTo(received().get(1));
  }

  @Test
  void criterion2_aLeadingTagBlockIsSkipped() {
    line("\\s:station,c:1700000000*5E\\" + VALID);
    assertThat(position().mmsi()).isEqualTo(265_123_456);
  }

  @Test
  void criterion3_aShipAt18East59NorthKeepsItsLongitudeFirst() {
    line(VALID);
    AisMessage.Position p = position();
    assertThat(p.lon()).isCloseTo(18.0723, within(1e-6));
    assertThat(p.lat()).isCloseTo(59.3311, within(1e-6));
    // ... and the object has [lon, lat]
    var placement = new ShipMapper.Placement("feed", UUID.randomUUID(), SecurityLabel.of("NATO", "UNCLASSIFIED"), StandardIdentity.UNKNOWN);
    MapObjectContent c = ShipMapper.position(placement, p, p.statics(), Instant.EPOCH, null);
    var at = ((Geometry.Point) c.geometry()).coordinates();
    assertThat(at.longitude()).isCloseTo(18.0723, within(1e-6));
    assertThat(at.latitude()).isCloseTo(59.3311, within(1e-6));
  }

  @Test
  void criterion3_aPositionNotAvailableCreatesNothingAndCountsNoPosition() {
    for (int type : new int[] {1, 2, 3}) {
      line(Ais.classARaw(type, 265_123_456, 181 * 600_000L, 20 * 600_000L, 0, 0, 0).sentence()); // longitude 181
    }
    line(Ais.classARaw(265_123_456, 10 * 600_000L, 91 * 600_000L, 0, 0, 0).sentence()); // latitude 91
    assertThat(received()).isEmpty();
    assertThat(task.counter("no position")).isEqualTo(4);
  }

  @Test
  void criterion3_classBPositionsOfTypes18And19AreRead() {
    line(Ais.classB(230_111_222, 55, 24.9384, 60.1699, 1800, 511).sentence());
    line(Ais.extendedB(230_111_223, 0, 24.9384, 60.1699, 0, 0, "YACHT", 37, 6, 4, 2, 1).sentence());
    assertThat(received()).hasSize(2);
    assertThat(((AisMessage.Position) received().get(1)).statics().cls()).isEqualTo(AisClass.B);
  }

  @Test
  void criterion4_courseAndSpeedAreConverted() {
    line(Ais.classA(1, 1, 0, 100, 18.0, 59.0, 2705, 90).sentence());
    AisMessage.Position p = position();
    assertThat(p.course()).isEqualTo(270.5);
    assertThat(p.speedMetresPerSecond()).isCloseTo(5.144, within(0.001));
  }

  @Test
  void criterion4_notAvailableCourseSpeedAndHeadingAreAbsent() {
    line(Ais.classA(1, 1, 0, 1023, 18.0, 59.0, 3600, 511).sentence());
    AisMessage.Position p = position();
    assertThat(p.course()).isNull();
    assertThat(p.speedKnots()).isNull();
    assertThat(p.heading()).isNull();
  }

  @Test
  void criterion4_aCourseOutOfRangeIsLeftOutAndThePositionAndSpeedOfTheSameMessageAreKept() {
    line(Ais.classA(1, 1, 0, 100, 18.0723, 59.3311, 3700, 90).sentence());
    AisMessage.Position p = position();
    assertThat(p.course()).isNull();
    assertThat(p.speedMetresPerSecond()).isCloseTo(5.144, within(0.001));
    assertThat(p.lon()).isCloseTo(18.0723, within(1e-6));
    assertThat(task.counter("value out of range")).isEqualTo(1);
    assertThat(task.counter("dropped: malformed") + task.counter("dropped: checksum") + task.counter("no position")).isZero();
  }

  @Test
  void criterion4_aHeadingOutOfRangeIsLeftOut() {
    line(Ais.classA(1, 1, 0, 100, 18.0, 59.0, 100, 400).sentence());
    assertThat(position().heading()).isNull();
    assertThat(task.counter("value out of range")).isEqualTo(1);
  }

  @Test
  void criterion5_twoFragmentsInOrderGiveTheWholeVoyageReport() {
    var voyage = Ais.voyage(366_000_001, 9_074_729, "WDC1234", "TESTSHIP", 71, 100, 20, 10, 12, 85, "STOCKHOLM");
    voyage.fragments(2, "3").forEach(this::line);
    var st = ((AisMessage.StaticReport) received().getFirst()).statics();
    assertThat(st.name()).isEqualTo("TESTSHIP");
    assertThat(st.callSign()).isEqualTo("WDC1234");
    assertThat(st.imo()).isEqualTo(9_074_729);
    assertThat(st.shipType()).isEqualTo(71);
    assertThat(st.length()).isEqualTo(120);
    assertThat(st.beam()).isEqualTo(22);
    assertThat(st.draught()).isEqualTo(8.5);
    assertThat(st.destination()).isEqualTo("STOCKHOLM");
  }

  @Test
  void criterion5_theSecondFragmentAloneIsLost() {
    line(Ais.voyage(366_000_001, 1, "C", "N", 70, 1, 1, 1, 1, 1, "D").fragments(2, "3").get(1));
    assertThat(received()).isEmpty();
    assertThat(task.counter("dropped: fragment lost")).isEqualTo(1);
  }

  @Test
  void criterion5_theFirstFragmentWithoutTheSecondFor5SecondsIsLost() {
    var parts = Ais.voyage(366_000_001, 1, "C", "N", 70, 1, 1, 1, 1, 1, "D").fragments(2, "3");
    line(parts.get(0));
    now.set(4_999);
    line(VALID); // any sentence: not yet
    assertThat(task.counter("dropped: fragment lost")).isZero();
    now.set(5_000);
    line(VALID);
    assertThat(task.counter("dropped: fragment lost")).isEqualTo(1);
    line(parts.get(1)); // the second one comes too late
    assertThat(task.counter("dropped: fragment lost")).isEqualTo(2);
    assertThat(received()).hasSize(2); // only the two position reports
  }

  @Test
  void criterion5_fragmentsOfTwoMessagesWithDifferentSequenceIdsInterleavedAreBothJoined() {
    var a = Ais.voyage(366_000_001, 1, "CA", "SHIP A", 70, 1, 1, 1, 1, 1, "AAA").fragments(2, "1");
    var b = Ais.voyage(366_000_002, 2, "CB", "SHIP B", 80, 1, 1, 1, 1, 1, "BBB").fragments(2, "2");
    line(a.get(0));
    line(b.get(0));
    line(a.get(1));
    line(b.get(1));
    assertThat(received()).extracting(m -> ((AisMessage.StaticReport) m).statics().name()).containsExactly("SHIP A", "SHIP B");
    assertThat(task.counter("dropped: fragment lost")).isZero();
  }

  @Test
  void criterion10_basesBinaryMessagesAndAidsToNavigationCreateNothingAndAreCountedByType() {
    line(Ais.other(4, 2_650_000, 168).sentence());
    line(Ais.other(8, 2_650_001, 168).sentence());
    line(Ais.other(21, 993_000_001, 272).sentence());
    assertThat(received()).isEmpty();
    assertThat(task.counter("ignored: type 4")).isEqualTo(1);
    assertThat(task.counter("ignored: type 8")).isEqualTo(1);
    assertThat(task.counter("ignored: type 21")).isEqualTo(1);
    assertThat(task.counters().keySet()).noneMatch(k -> k.startsWith("dropped"));
  }
}
