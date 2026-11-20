package dev.emcc.plugins.cot;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;
import org.junit.jupiter.api.Test;

/** When one write counts as stalled: the same write seen again and again for the limit, and nothing else. */
class WriteWatchTest {

  private static final UUID RUN = UUID.randomUUID();
  private static final long LIMIT = 30;

  private static WriteWatch output() {
    return new WriteWatch();
  }

  @Test
  void theSameWriteSeenForTheLimitIsAStallAndOnlyOnce() {
    WriteWatch out = output();
    out.observe(RUN, 5, true, 10);
    assertThat(out.stalled(39, LIMIT)).as("one tick short").isFalse();
    assertThat(out.stalled(40, LIMIT)).isTrue();
    assertThat(out.stalled(41, LIMIT)).as("the stall was answered; the next run starts clean").isFalse();
  }

  @Test
  void seeingTheSameWriteAgainDoesNotMoveItsStart() {
    WriteWatch out = output();
    out.observe(RUN, 5, true, 10);
    out.observe(RUN, 5, true, 35); // the worker was told again, in a later tick: still the one write
    assertThat(out.stalled(40, LIMIT)).isTrue();
  }

  @Test
  void aWriteThatIsFollowedByAnotherIsProgressAndStartsTheCountAgain() {
    WriteWatch out = output();
    out.observe(RUN, 5, true, 10);
    out.observe(RUN, 6, true, 35); // the write after the next event: the peer takes data
    assertThat(out.stalled(64, LIMIT)).isFalse();
    assertThat(out.stalled(65, LIMIT)).isTrue();
  }

  @Test
  void aWriteThatHasFinishedIsNoStall() {
    WriteWatch out = output();
    out.observe(RUN, 5, true, 10);
    out.observe(RUN, 6, false, 20);
    assertThat(out.stalled(1_000, LIMIT)).as("nothing to write, or the writer waits for the next event").isFalse();
  }

  @Test
  void theSameCountInAnotherRunIsAnotherWrite() {
    WriteWatch out = output();
    out.observe(RUN, 5, true, 10);
    out.observe(UUID.randomUUID(), 5, true, 35);
    assertThat(out.stalled(64, LIMIT)).isFalse();
    assertThat(out.stalled(65, LIMIT)).isTrue();
  }

  @Test
  void aConnectionThatIsGoneHasNoWrite() {
    WriteWatch out = output();
    out.observe(RUN, 5, true, 10);
    out.clear();
    assertThat(out.stalled(1_000, LIMIT)).isFalse();
  }

  @Test
  void aCountThatIsNotAWriteInProgressIsNeverAStall() {
    WriteWatch out = output();
    out.observe(RUN, 5, false, 10); // an event skipped as expired, or the count after a write
    assertThat(out.stalled(1_000, LIMIT)).isFalse();
  }
}
