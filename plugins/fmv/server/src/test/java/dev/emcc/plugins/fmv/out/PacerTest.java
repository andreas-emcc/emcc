package dev.emcc.plugins.fmv.out;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.sdk.Bytes;
import org.junit.jupiter.api.Test;

/** The sender's pacing (brief section 10.6 point 21; criterion 32's rate). */
class PacerTest {

  private static final Bytes DATAGRAM = Bytes.of(new byte[7 * 188]);

  @Test
  void criterion32KeepsToMaxRateWithinFivePercentOverTenSeconds() {
    Pacer pacer = new Pacer(20e6);
    long now = 0;
    long sent = 0;
    long end = 10_000_000_000L;
    // a sender that offers far more than 20 Mbit/s, in bursts (200 datagrams every 40 ms: 53 Mbit/s)
    long nextBurst = 0;
    while (now < end) {
      if (now >= nextBurst) {
        for (int i = 0; i < 200; i++) {
          pacer.offer(DATAGRAM);
        }
        nextBurst += 40_000_000L;
      }
      Bytes d;
      while ((d = pacer.take(now)) != null) {
        sent += d.size();
      }
      long wait = pacer.waitNanos(now);
      now += wait <= 0 ? 1_000_000 : Math.min(wait, nextBurst - now);
    }
    double rate = sent * 8 / 10.0;
    assertThat(rate).isCloseTo(20e6, within(0.05 * 20e6));
    assertThat(rate).isLessThanOrEqualTo(20e6 * 1.0001);
    // it offered 53 Mbit/s for 10 s and holds at most 2 s at the rate: the rest was dropped and counted
    assertThat(pacer.dropped()).isPositive();
  }

  @Test
  void aBurstLeavesSpreadOutNotAllAtOnce() {
    Pacer pacer = new Pacer(20e6);
    for (int i = 0; i < 80; i++) {
      pacer.offer(DATAGRAM);
    }
    assertThat(pacer.take(0)).isNotNull();
    assertThat(pacer.take(0)).isNull();
    long gap = pacer.waitNanos(0);
    assertThat(gap).isCloseTo(1316 * 8 * 1_000_000_000L / 20_000_000L, within(2L)); // 526 µs at 20 Mbit/s
    assertThat(pacer.take(gap)).isNotNull();
  }

  @Test
  void anIdleSenderGetsNoMoreThanTheCreditAndAnEmptyOneSaysSo() {
    Pacer pacer = new Pacer(4e6);
    assertThat(pacer.waitNanos(0)).isEqualTo(-1);
    pacer.offer(DATAGRAM);
    assertThat(pacer.take(0)).isNotNull();
    // a second later two datagrams come: the first goes at once, as if 2 ms ago; the second a datagram's time after that
    pacer.offer(DATAGRAM);
    pacer.offer(DATAGRAM);
    long t = 1_000_000_000L;
    assertThat(pacer.take(t)).isNotNull();
    assertThat(pacer.take(t)).isNull();
    assertThat(pacer.waitNanos(t)).isCloseTo(1316 * 8 * 1_000_000_000L / 4_000_000L - Pacer.CREDIT_NANOS, within(2L));
  }

  @Test
  void aSenderWokenLateByTheMillisecondPollStillKeepsTheRate() {
    Pacer pacer = new Pacer(20e6);
    long now = 0;
    long sent = 0;
    // 20 Mbit/s offered steadily; the sender wakes only every whole millisecond, as a 1 ms poll does
    for (long ms = 0; ms < 10_000; ms++) {
      now = ms * 1_000_000L;
      for (int i = 0; i < 2; i++) {
        pacer.offer(DATAGRAM); // 2 a millisecond: 21 Mbit/s
      }
      for (Bytes d; (d = pacer.take(now)) != null; ) {
        sent += d.size();
      }
    }
    assertThat(sent * 8 / 10.0).isCloseTo(20e6, within(0.05 * 20e6));
  }

  @Test
  void theBufferHoldsTwoSecondsAtTheRate() {
    Pacer pacer = new Pacer(1e6); // 250 000 bytes: 189 datagrams
    for (int i = 0; i < 200; i++) {
      pacer.offer(DATAGRAM);
    }
    assertThat(pacer.waiting()).isEqualTo(189);
    assertThat(pacer.dropped()).isEqualTo(11);
  }
}
