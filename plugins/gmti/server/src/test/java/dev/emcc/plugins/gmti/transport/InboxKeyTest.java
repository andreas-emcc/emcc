package dev.emcc.plugins.gmti.transport;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.channel.ChannelItem;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Position;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * Criterion 26 (CR-0040): the link's own inbox keeps the latest packets per sensor and dwell number,
 * so a revisit's dwells never replace each other on a slow link; without a sequence, per sensor, as
 * in M5. (LinksTest's criterion 26 shows the channel's side over UDP, where the task is too quick
 * for the link's inbox to replace anything.)
 */
class InboxKeyTest {

  static final UUID SENSOR = UUID.fromString("0123abcd-0000-0000-0000-000000000026");

  static ChannelItem.SensorReport report(ChannelItem.SensorReport.Sequence sequence) {
    var r = new ChannelItem.SensorReport(SENSOR, Position.of(18.3, 57.4), Instant.parse("2026-11-10T10:00:00Z"),
        new Geometry.Circle(Position.of(18.3, 57.4), 50_000), List.of());
    return r.withSequence(sequence);
  }

  static Object coalesceKey(ChannelItem.SensorReport report) {
    return new LinkInbox.Send(LinkWorker.inboxKey(report), 1, List.of()).coalesceKey();
  }

  @Test
  void criterion26_aRevisitsDwellsHaveKeysOfTheirOwn_theSameDwellOfTheNextRevisitReplacesIt() {
    Object d0 = coalesceKey(report(new ChannelItem.SensorReport.Sequence(7, 0, false)));
    Object d1 = coalesceKey(report(new ChannelItem.SensorReport.Sequence(7, 1, false)));
    Object d2 = coalesceKey(report(new ChannelItem.SensorReport.Sequence(7, 2, true)));
    assertThat(List.of(d0, d1, d2)).doesNotHaveDuplicates();
    assertThat(coalesceKey(report(new ChannelItem.SensorReport.Sequence(8, 1, false)))).as("a slow link loses the older revisit's dwell 1").isEqualTo(d1);
  }

  @Test
  void criterion26_withoutASequenceOneKeyPerSensor_asInM5() {
    assertThat(coalesceKey(report(null))).isEqualTo(SENSOR.toString()).isEqualTo(coalesceKey(report(null)));
  }
}
