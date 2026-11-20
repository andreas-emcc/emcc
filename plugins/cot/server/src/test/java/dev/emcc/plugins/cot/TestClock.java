package dev.emcc.plugins.cot;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;

/** A clock the test moves by hand, together with the test kit's virtual time. */
final class TestClock extends Clock {

  private volatile Instant now;

  TestClock(Instant start) {
    this.now = start;
  }

  void advance(Duration duration) {
    now = now.plus(duration);
  }

  @Override
  public ZoneId getZone() {
    return ZoneOffset.UTC;
  }

  @Override
  public Clock withZone(ZoneId zone) {
    return this;
  }

  @Override
  public Instant instant() {
    return now;
  }
}
