package dev.emcc.plugins.cot;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** The memory of the uids emc2 made up for what it sent (criterion 16). */
class SentUidsTest {

  private static final Instant T0 = Instant.parse("2026-10-27T12:00:00Z");
  private static final UUID LAYER = UUID.randomUUID();

  @Test
  void aUidIsRecognisedUntilItsStaleTimePlusTheGrace() {
    var uids = new SentUids(10);
    uids.remember("a", LAYER, T0.plusSeconds(30), T0);
    assertThat(uids.sentFrom("a", LAYER, T0)).isTrue();
    assertThat(uids.sentFrom("a", LAYER, T0.plusSeconds(30).plus(SentUids.GRACE).minusMillis(1))).isTrue();
    assertThat(uids.sentFrom("a", LAYER, T0.plusSeconds(30).plus(SentUids.GRACE))).isFalse();
    assertThat(uids.sentFrom("other", LAYER, T0)).isFalse();
  }

  @Test
  void aSendThatIsStaleAtOnceIsRecognisedForTheGrace() {
    var uids = new SentUids(10);
    uids.remember("deleted", LAYER, T0, T0);
    assertThat(uids.sentFrom("deleted", LAYER, T0.plusSeconds(59))).isTrue();
    assertThat(uids.sentFrom("deleted", LAYER, T0.plus(SentUids.GRACE))).isFalse();
  }

  @Test
  void aNewSendRenewsTheUid() {
    var uids = new SentUids(10);
    uids.remember("a", LAYER, T0.plusSeconds(10), T0);
    uids.remember("a", LAYER, T0.plusSeconds(100), T0.plusSeconds(40));
    assertThat(uids.sentFrom("a", LAYER, T0.plusSeconds(150))).isTrue();
    assertThat(uids.size()).isEqualTo(1);
  }

  @Test
  void pastTheCapTheLongestUnrenewedGoesFirst() {
    var uids = new SentUids(3);
    uids.remember("a", LAYER, T0.plusSeconds(300), T0);
    uids.remember("b", LAYER, T0.plusSeconds(300), T0);
    uids.remember("c", LAYER, T0.plusSeconds(300), T0);
    uids.remember("a", LAYER, T0.plusSeconds(300), T0); // renewed: now the newest
    uids.remember("d", LAYER, T0.plusSeconds(300), T0);
    assertThat(uids.size()).isEqualTo(3);
    assertThat(uids.sentFrom("b", LAYER, T0)).as("the longest unrenewed").isFalse();
    assertThat(uids.sentFrom("a", LAYER, T0)).isTrue();
    assertThat(uids.sentFrom("c", LAYER, T0)).isTrue();
    assertThat(uids.sentFrom("d", LAYER, T0)).isTrue();
  }

  @Test
  void whatHasRunOutIsSweptAwaySoThatTheMemoryStaysSmall() {
    var uids = new SentUids(1_000);
    for (int i = 0; i < 500; i++) {
      uids.remember("old" + i, LAYER, T0, T0);
    }
    Instant later = T0.plus(SentUids.GRACE).plus(Duration.ofSeconds(10));
    uids.remember("new", LAYER, later.plusSeconds(30), later);
    assertThat(uids.size()).as("the 500 that ran out are gone").isEqualTo(1);
    assertThat(uids.sentFrom("new", LAYER, later)).isTrue();
  }

  @Test
  void aUidIsRecognisedOnlyForTheLayerItWasSentFrom() {
    var uids = new SentUids(10);
    uids.remember("a", LAYER, T0.plusSeconds(30), T0);
    assertThat(uids.sentFrom("a", LAYER, T0)).isTrue();
    assertThat(uids.sentFrom("a", UUID.randomUUID(), T0)).as("another layer: a round trip, not an echo").isFalse();
    UUID moved = UUID.randomUUID();
    uids.remember("a", moved, T0.plusSeconds(30), T0.plusSeconds(1)); // sent again from the layer it moved to
    assertThat(uids.sentFrom("a", moved, T0.plusSeconds(1))).isTrue();
    assertThat(uids.sentFrom("a", LAYER, T0.plusSeconds(1))).isFalse();
  }
}
