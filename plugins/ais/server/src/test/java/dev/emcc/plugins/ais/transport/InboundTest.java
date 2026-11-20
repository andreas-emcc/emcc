package dev.emcc.plugins.ais.transport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.plugins.ais.codec.Ais;
import dev.emcc.plugins.ais.codec.AisMessage;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.testkit.FakeTaskContext;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicLong;
import org.junit.jupiter.api.Test;

/** What a task does with the lines it gets, without a socket: what reaches the worker, and every counter. */
class InboundTest {

  private final WorkerRef<TransportMsg> sink = FakePluginContext.builder("ais").build().workers()
      .spawn(WorkerSpec.of("sink", TransportMsg.class, () -> (message, ctx) -> {}));
  private final FakeTaskContext<Message> task = FakeTaskContext.of("feed");
  private final AtomicLong now = new AtomicLong();
  private final Inbound inbound = new Inbound("feed", UUID.randomUUID(), sink, task, now::get);

  private static AisMessage message(Message sent) {
    return switch ((TransportMsg) sent) {
      case TransportMsg.ReceivedPosition p -> p.message();
      case TransportMsg.ReceivedStatic s -> s.message();
      default -> throw new AssertionError(sent);
    };
  }

  private List<AisMessage> received() {
    return task.sent().stream().map(s -> message(s.message())).toList();
  }

  @Test
  void aValidSentenceGivesOneMessage() {
    inbound.frame(Ais.classA(1, 265_123_456, 0, 100, 18.0723, 59.3311, 2705, 90).sentence());
    assertThat(received()).hasSize(1);
    var p = (AisMessage.Position) received().getFirst();
    assertThat(p.lon()).isCloseTo(18.0723, within(1e-6)); // longitude 18.07, latitude 59.33: never swapped
    assertThat(p.lat()).isCloseTo(59.3311, within(1e-6));
    assertThat(task.counter("frames in")).isEqualTo(1);
    assertThat(task.counter("messages")).isEqualTo(1);
  }

  @Test
  void criterion14_everyDropReasonHasItsOwnCounter() {
    String good = Ais.classA(1, 265_123_456, 0, 100, 18.0723, 59.3311, 2705, 90).sentence();
    inbound.frame(good.replaceFirst(",A,.", ",A,5")); // a changed payload character
    inbound.frame(good.substring(0, good.indexOf('*'))); // no checksum
    inbound.frame(Ais.withChecksum("AIVDM,1,1,,A,15M67FC000G?ufbE`FepT@3n00Sa,0,9")); // nine fields
    inbound.tooLong(513);
    inbound.frame(Ais.withChecksum("AIVDM,1,1,,A,1,0")); // a payload of 6 bits holds no position
    inbound.frame(Ais.classARaw(265_123_456, 181 * 600_000L, 20 * 600_000L, 0, 0, 0).sentence()); // longitude not available
    inbound.frame(Ais.other(4, 2_650_000, 168).sentence());
    inbound.frame(Ais.other(8, 2_650_000, 168).sentence());
    inbound.frame(Ais.other(8, 2_650_001, 168).sentence());
    inbound.frame(Ais.classA(1, 0, 0, 0, 1, 1, 0, 0).sentence()); // MMSI 0
    assertThat(received()).isEmpty();
    assertThat(task.counters())
        .containsEntry("dropped: checksum", 1L)
        .containsEntry("dropped: no checksum", 1L)
        .containsEntry("dropped: malformed", 2L) // nine fields, and an MMSI of 0
        .containsEntry("dropped: too long", 1L)
        .containsEntry("dropped: too short", 1L)
        .containsEntry("no position", 1L)
        .containsEntry("ignored: type 4", 1L)
        .containsEntry("ignored: type 8", 2L)
        .containsEntry("frames in", 10L);
    assertThat(task.counter("messages")).isZero();
  }

  @Test
  void aValueOutOfRangeIsCountedAndTheMessageStillGoesOn() {
    inbound.frame(Ais.classA(1, 265_123_456, 0, 100, 18.0723, 59.3311, 3700, 400).sentence());
    assertThat(received()).hasSize(1);
    assertThat(task.counter("value out of range")).isEqualTo(2);
    assertThat(task.counter("messages")).isEqualTo(1);
    assertThat(task.counters().keySet()).noneMatch(k -> k.startsWith("dropped"));
  }

  @Test
  void fragmentsAreJoinedPerConnectionAndALostOneIsCounted() {
    var voyage = Ais.voyage(366_000_001, 9_074_729, "WDC1234", "TESTSHIP", 70, 100, 20, 10, 12, 85, "STOCKHOLM");
    List<String> parts = voyage.fragments(2, "3");
    inbound.frame(parts.get(0));
    assertThat(received()).isEmpty();
    inbound.frame(parts.get(1));
    assertThat(received()).hasSize(1);
    assertThat(((AisMessage.StaticReport) received().getFirst()).statics().name()).isEqualTo("TESTSHIP");

    inbound.frame(parts.get(1)); // the second alone
    assertThat(task.counter("dropped: fragment lost")).isEqualTo(1);
    inbound.frame(parts.get(0));
    now.set(5_000);
    inbound.frame(Ais.partA(1, "X").sentence()); // 5 s on, any sentence finds the first fragment too old
    assertThat(task.counter("dropped: fragment lost")).isEqualTo(2);
  }

  @Test
  void aNewInboundHasNoFragmentsOfTheOldConnection() {
    var voyage = Ais.voyage(366_000_001, 0, "", "", 0, 0, 0, 0, 0, 0, "");
    List<String> parts = voyage.fragments(2, "3");
    inbound.frame(parts.get(0));
    var reconnected = new Inbound("feed", UUID.randomUUID(), sink, task, now::get);
    reconnected.frame(parts.get(1));
    assertThat(received()).isEmpty();
    assertThat(task.counter("dropped: fragment lost")).isEqualTo(1);
  }
}
