package dev.emcc.ecore.runtime;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;

class MailboxTest {

  private static final Duration NO_WAIT = Duration.ZERO;

  private static Envelope<String> msg(String text) {
    return Envelope.of(text, null);
  }

  private static Envelope<String> keyed(String text, String key) {
    return Envelope.of(text, key);
  }

  private static List<String> takeAll(Mailbox<String> mailbox, int count) throws InterruptedException {
    List<String> taken = new ArrayList<>();
    for (int i = 0; i < count; i++) {
      Envelope<String> e = mailbox.take();
      assertThat(e).isNotNull();
      taken.add(e.resolve());
    }
    return taken;
  }

  @Test
  void dropNewestRefusesTheNewMessageWhenFull() throws InterruptedException {
    Mailbox<String> mailbox = new Mailbox<>(2, Overflow.DROP_NEWEST);
    assertThat(mailbox.offer(msg("a"), false, NO_WAIT)).isEqualTo(SendOutcome.ACCEPTED);
    assertThat(mailbox.offer(msg("b"), false, NO_WAIT)).isEqualTo(SendOutcome.ACCEPTED);

    assertThat(mailbox.offer(msg("c"), false, NO_WAIT)).isEqualTo(SendOutcome.DROPPED);

    assertThat(takeAll(mailbox, 2)).containsExactly("a", "b");
    assertThat(mailbox.counters().dropped()).isEqualTo(1);
  }

  @Test
  void dropOldestEvictsTheOldestAndRunsItsDropHook() throws InterruptedException {
    Mailbox<String> mailbox = new Mailbox<>(2, Overflow.DROP_OLDEST);
    List<String> droppedHooks = new ArrayList<>();
    mailbox.offer(msg("a").onDropped(() -> droppedHooks.add("a")), false, NO_WAIT);
    mailbox.offer(msg("b"), false, NO_WAIT);

    assertThat(mailbox.offer(msg("c"), false, NO_WAIT)).isEqualTo(SendOutcome.ACCEPTED);

    assertThat(takeAll(mailbox, 2)).containsExactly("b", "c");
    assertThat(droppedHooks).containsExactly("a");
    assertThat(mailbox.counters().evicted()).isEqualTo(1);
  }

  @Test
  void coalescingReplacesAQueuedMessageInPlace() throws InterruptedException {
    Mailbox<String> mailbox = new Mailbox<>(10, Overflow.COALESCE_BY_KEY);
    List<String> droppedHooks = new ArrayList<>();
    mailbox.offer(keyed("track-1 v1", "track-1").onDropped(() -> droppedHooks.add("v1")), false, NO_WAIT);
    mailbox.offer(keyed("track-2 v1", "track-2"), false, NO_WAIT);

    assertThat(mailbox.offer(keyed("track-1 v2", "track-1"), false, NO_WAIT)).isEqualTo(SendOutcome.ACCEPTED);

    // track-1 keeps its place at the head, with the latest value.
    assertThat(takeAll(mailbox, 2)).containsExactly("track-1 v2", "track-2 v1");
    assertThat(droppedHooks).containsExactly("v1");
    assertThat(mailbox.counters().coalesced()).isEqualTo(1);
  }

  @Test
  void aKeyIsCoalescedAgainOnlyWhileItIsQueued() throws InterruptedException {
    Mailbox<String> mailbox = new Mailbox<>(10, Overflow.COALESCE_BY_KEY);
    mailbox.offer(keyed("v1", "k"), false, NO_WAIT);
    assertThat(takeAll(mailbox, 1)).containsExactly("v1");

    mailbox.offer(keyed("v2", "k"), false, NO_WAIT);
    mailbox.offer(keyed("v3", "k"), false, NO_WAIT);

    assertThat(takeAll(mailbox, 1)).containsExactly("v3");
    assertThat(mailbox.counters().queued()).isZero();
  }

  @Test
  void messagesWithoutAKeyAreNeverCoalesced() throws InterruptedException {
    Mailbox<String> mailbox = new Mailbox<>(10, Overflow.COALESCE_BY_KEY);
    mailbox.offer(msg("a"), false, NO_WAIT);
    mailbox.offer(msg("a"), false, NO_WAIT);

    assertThat(takeAll(mailbox, 2)).containsExactly("a", "a");
    assertThat(mailbox.counters().coalesced()).isZero();
  }

  @Test
  void coalescingEvictsTheOldestWhenFullOfDistinctKeys() throws InterruptedException {
    Mailbox<String> mailbox = new Mailbox<>(2, Overflow.COALESCE_BY_KEY);
    mailbox.offer(keyed("k1", "k1"), false, NO_WAIT);
    mailbox.offer(keyed("k2", "k2"), false, NO_WAIT);

    assertThat(mailbox.offer(keyed("k3", "k3"), false, NO_WAIT)).isEqualTo(SendOutcome.ACCEPTED);
    // k1 was evicted, so a new k1 is queued at the end instead of replacing anything.
    assertThat(mailbox.offer(keyed("k1 again", "k1"), false, NO_WAIT)).isEqualTo(SendOutcome.ACCEPTED);

    assertThat(takeAll(mailbox, 2)).containsExactly("k3", "k1 again");
    assertThat(mailbox.counters().evicted()).isEqualTo(2);
  }

  @Test
  void systemEnvelopesIgnoreCapacityAndAreNeverEvicted() throws InterruptedException {
    Mailbox<String> mailbox = new Mailbox<>(1, Overflow.DROP_OLDEST);
    mailbox.offer(Envelope.system(() -> "answer"), false, NO_WAIT);
    mailbox.offer(msg("a"), false, NO_WAIT);
    mailbox.offer(msg("b"), false, NO_WAIT); // evicts "a", not the answer

    assertThat(takeAll(mailbox, 2)).containsExactly("answer", "b");
  }

  @Test
  void blockSenderNeverWaitsWhenTheSenderMayNotBlock() {
    Mailbox<String> mailbox = new Mailbox<>(1, Overflow.BLOCK_SENDER);
    mailbox.offer(msg("a"), false, NO_WAIT);

    assertThat(mailbox.offer(msg("b"), false, Duration.ofSeconds(10))).isEqualTo(SendOutcome.DROPPED);
  }

  @Test
  void blockSenderWaitsUntilThereIsRoom() throws InterruptedException {
    Mailbox<String> mailbox = new Mailbox<>(1, Overflow.BLOCK_SENDER);
    mailbox.offer(msg("a"), false, NO_WAIT);
    Probe<SendOutcome> outcome = new Probe<>();

    Thread.ofVirtual().start(() -> outcome.add(mailbox.offer(msg("b"), true, Probe.WAIT)));
    assertThat(takeAll(mailbox, 1)).containsExactly("a"); // makes room

    assertThat(outcome.next()).isEqualTo(SendOutcome.ACCEPTED);
    assertThat(takeAll(mailbox, 1)).containsExactly("b");
  }

  @Test
  void blockSenderGivesUpAfterTheSendTimeout() {
    Mailbox<String> mailbox = new Mailbox<>(1, Overflow.BLOCK_SENDER);
    mailbox.offer(msg("a"), false, NO_WAIT);

    assertThat(mailbox.offer(msg("b"), true, Duration.ofMillis(20))).isEqualTo(SendOutcome.DROPPED);
    assertThat(mailbox.counters().dropped()).isEqualTo(1);
  }

  @Test
  void closeDiscardsQueuedMessagesAndRunsTheirDropHooks() throws InterruptedException {
    Mailbox<String> mailbox = new Mailbox<>(10, Overflow.DROP_NEWEST);
    List<String> droppedHooks = new ArrayList<>();
    mailbox.offer(msg("a").onDropped(() -> droppedHooks.add("a")), false, NO_WAIT);
    mailbox.offer(msg("b").onDropped(() -> droppedHooks.add("b")), false, NO_WAIT);

    assertThat(mailbox.close()).isEqualTo(2);

    assertThat(droppedHooks).containsExactly("a", "b");
    assertThat(mailbox.offer(msg("c"), false, NO_WAIT)).isEqualTo(SendOutcome.CLOSED);
    @Nullable Envelope<String> taken = mailbox.take();
    assertThat(taken).isNull();
  }

  @Test
  void takingAnEnvelopeRunsItsTakenHook() throws InterruptedException {
    Mailbox<String> mailbox = new Mailbox<>(10, Overflow.DROP_NEWEST);
    List<String> takenHooks = new ArrayList<>();
    mailbox.offer(msg("a").onTaken(() -> takenHooks.add("a")), false, NO_WAIT);

    takeAll(mailbox, 1);

    assertThat(takenHooks).containsExactly("a");
  }
}
