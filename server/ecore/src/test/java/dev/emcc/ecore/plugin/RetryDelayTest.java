package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import org.junit.jupiter.api.Test;

/** The wait before a loop runs again: a listener's reconnect, a connection task's restart (ADR-0036). */
class RetryDelayTest {

  private static final Duration MAX = Duration.ofSeconds(60);
  /** 1 s, doubling, at most 60 s: as {@code Backoff.exponential(1 s, 60 s)}. */
  private final RetryDelay retry = new RetryDelay(MAX, n -> Duration.ofSeconds(Math.min(60, 1L << Math.min(n, 6))));

  @Test
  void earlyEndsWaitLongerEachTimeUpToTheLongestDelay() {
    Duration early = Duration.ofSeconds(2);

    assertThat(retry.after(early)).isEqualTo(Duration.ofSeconds(1));
    assertThat(retry.after(early)).isEqualTo(Duration.ofSeconds(2));
    assertThat(retry.after(early)).isEqualTo(Duration.ofSeconds(4));
    for (int i = 0; i < 5; i++) {
      retry.after(early);
    }
    assertThat(retry.after(early)).isEqualTo(Duration.ofSeconds(60));
  }

  @Test
  void aRunThatLastedStartsTheDelaysOver() {
    retry.after(Duration.ZERO);
    retry.after(Duration.ZERO);
    retry.after(Duration.ZERO);

    assertThat(retry.after(MAX)).isEqualTo(Duration.ofSeconds(1));
    assertThat(retry.after(Duration.ZERO)).as("the next early end grows from there").isEqualTo(Duration.ofSeconds(2));
  }

  @Test
  void neverLessThanAHundredMilliseconds() {
    RetryDelay quick = new RetryDelay(Duration.ofSeconds(1), n -> Duration.ofMillis(5));

    assertThat(quick.after(Duration.ZERO)).isEqualTo(RetryDelay.MIN);
  }
}
