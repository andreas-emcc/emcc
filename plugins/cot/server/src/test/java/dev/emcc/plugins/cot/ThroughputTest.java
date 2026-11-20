package dev.emcc.plugins.cot;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.cot.codec.CotXml;
import dev.emcc.plugins.cot.codec.Samples;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.Operation;
import dev.emcc.sdk.model.Position;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Acceptance criterion 10: 1 000 events per second over 10 000 uids are applied without a growing
 * backlog, within the caps on outstanding asks and timers (CR-0005). The time is virtual (the test
 * kit's clock); the work is real, so the test also measures what the plugin does per second of real
 * time and prints it (the README quotes it).
 */
class ThroughputTest {

  @org.junit.jupiter.api.AfterEach
  void closeRigs() {
    Rig.closeAll();
  }

  private static final int UIDS = 10_000;
  private static final int PER_SECOND = 1_000;
  private static final int SECONDS = 13;

  private static String burst(int second) {
    var text = new StringBuilder(PER_SECOND * 330);
    for (int i = 0; i < PER_SECOND; i++) {
      int uid = (second * PER_SECOND + i) % UIDS;
      text.append(Samples.at("unit-" + uid, second, 50.0 + uid / 1000.0, 10.0 + second / 100.0));
    }
    return text.toString();
  }

  @Test
  void criterion10_thousandEventsPerSecondOverTenThousandUidsWithoutAGrowingBacklog() {
    var rig = new Rig("tak-north");
    var worker = rig.ctx.worker("applier");

    // Ten seconds create all the objects; the following three update 3 000 of them, 1 000 a second.
    long started = System.nanoTime();
    int maxQueued = 0;
    int maxAsks = 0;
    for (int second = 0; second < SECONDS; second++) {
      long t0 = System.nanoTime();
      rig.feed("tak-north", burst(second), PER_SECOND);
      rig.ctx.advance(Duration.ofSeconds(1));
      rig.ctx.runUntilIdle();
      maxQueued = Math.max(maxQueued, rig.ctx.queued(worker));
      maxAsks = Math.max(maxAsks, rig.ctx.outstandingAsks());
      assertThat(rig.ctx.queued(worker)).as("backlog after second " + second).isZero();
      if (second == 0 || second == SECONDS - 1) {
        System.out.printf("  second %d took %.0f ms%n", second, (System.nanoTime() - t0) / 1e6);
      }
    }
    double seconds = (System.nanoTime() - started) / 1e9;
    double rate = SECONDS * PER_SECOND / seconds;
    // The test kit checks every message it delivers for immutability, by reflection, and that dominates here: the rate says
    // little about ECore. What counts is that no backlog builds up in virtual time.
    System.out.printf("cot throughput (test kit, parse + apply, fake store): %d events in %.2f s = %.0f events/s of real time; max queued %d%n",
        SECONDS * PER_SECOND, seconds, rate, maxQueued);

    assertThat(rig.objects()).hasSize(UIDS);
    assertThat(rig.requests(Operation.CREATE)).isEqualTo(UIDS + 1L); // the objects and the one layer
    assertThat(rig.requests(Operation.UPDATE)).isEqualTo((long) (SECONDS - UIDS / PER_SECOND) * PER_SECOND);
    assertThat(rig.requests(Operation.DELETE)).isZero();
    assertThat(maxAsks).as("outstanding asks stay far below ECore's cap of 10 000").isLessThanOrEqualTo(1_100);
    assertThat(rig.ctx.activeTimers()).as("one periodic timer").isEqualTo(1);

    // every uid has the position of its newest event
    Map<String, MapObject> byUid = new HashMap<>();
    rig.objects().forEach(o -> byUid.put(o.meta().externalRef().id(), o));
    for (int uid = 0; uid < UIDS; uid += 997) {
      int lastSecond = lastSecondOf(uid);
      Position at = ((Geometry.Point) byUid.get("unit-" + uid).content().geometry()).coordinates();
      assertThat(at).isEqualTo(Position.of(10.0 + lastSecond / 100.0, 50.0 + uid / 1000.0));
    }
    assertThat(rig.status()).contains("13000 read").contains("10000 created").contains("3000 updated");
    assertThat(rig.ctx.handlerErrors()).isEmpty();
  }

  /** The second of the newest event for {@code uid}: the uid is hit in second uid/1000, and again ten seconds later. */
  private static int lastSecondOf(int uid) {
    int first = uid / PER_SECOND;
    return first + UIDS / PER_SECOND < SECONDS ? first + UIDS / PER_SECOND : first;
  }

  @Test
  void aWholeBurstOfNewUidsAtOnceStaysWithinTheLimitOnChangesInFlight() {
    var rig = new Rig("tak-north");
    var text = new StringBuilder();
    for (int uid = 0; uid < 5_000; uid++) {
      text.append(Samples.at("burst-" + uid, 0, 40.0 + uid / 1000.0, 5.0));
    }
    rig.feed("tak-north", text.toString(), 5_000);
    assertThat(rig.objects()).hasSize(5_000);
    assertThat(rig.ctx.outstandingAsks()).isZero();
  }

  @Test
  void parsingAloneIsFastEnough() throws Exception {
    var xml = new CotXml();
    String event = Samples.UNIT;
    for (int i = 0; i < 2_000; i++) { // warm-up
      xml.parse(event);
    }
    long started = System.nanoTime();
    int n = 20_000;
    for (int i = 0; i < n; i++) {
      xml.parse(event);
    }
    double rate = n / ((System.nanoTime() - started) / 1e9);
    System.out.printf("cot parse alone: %.0f events/s%n", rate);
    assertThat(rate).isGreaterThan(5_000);
  }
}
