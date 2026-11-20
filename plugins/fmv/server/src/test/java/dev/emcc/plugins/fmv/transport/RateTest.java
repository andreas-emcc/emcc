package dev.emcc.plugins.fmv.transport;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** The per-minute count of the status lines (set 9: the ITA's T2 saw 0 datagrams/min while receiving). */
class RateTest {

  @Test
  void inTheFirstMinuteItCountsFromZero() {
    Rate rate = new Rate();
    for (long t = 1; t <= 10; t++) {
      rate.sample(t * 5);
    }
    assertThat(rate.perMinute(50)).isEqualTo(50);
    assertThat(rate.perMinute(53)).as("up to the total now").isEqualTo(53);
  }

  @Test
  void afterAMinuteItCountsTheLastMinuteOnly() {
    Rate rate = new Rate();
    for (long t = 1; t <= 100; t++) {
      rate.sample(t * 5);
    }
    assertThat(rate.perMinute(500)).isEqualTo(300);
  }

  @Test
  void aTotalThatStartsAgainCountsOnInsteadOfShowingNothing() {
    Rate rate = new Rate();
    for (long t = 1; t <= 100; t++) {
      rate.sample(t * 5); // the first run: 500
    }
    for (long t = 1; t <= 10; t++) {
      rate.sample(t * 5); // a restarted task counts from 0: 50
    }
    assertThat(rate.perMinute(50)).as("50 s of the first run, 10 s of the second").isEqualTo(300);
    assertThat(rate.perMinute(3)).as("a total below the last sample is a restart too").isEqualTo(303);
  }

  @Test
  void aCountThatStopsGoesToZeroAfterAMinute() {
    Rate rate = new Rate();
    for (long t = 1; t <= 10; t++) {
      rate.sample(t * 5);
    }
    for (int t = 0; t < 60; t++) {
      rate.sample(50);
    }
    assertThat(rate.perMinute(50)).isZero();
  }
}
