package dev.emcc.ecore.runtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;

/** A connection task's inbox (ADR-0036): writers never wait, one reader may. */
class InboxTest {

  private record Item(String key, int n) {}

  private static List<Item> drain(Inbox<Item> inbox) throws InterruptedException {
    List<Item> items = new ArrayList<>();
    for (Item i; (i = inbox.poll(Duration.ZERO)) != null; ) {
      items.add(i);
    }
    return items;
  }

  @Test
  void itemsComeInTheOrderTheyWereOffered() throws InterruptedException {
    Inbox<Item> inbox = new Inbox<>(10, Overflow.DROP_NEWEST);
    inbox.offer(new Item("a", 1), null);
    inbox.offer(new Item("b", 2), null);

    assertThat(inbox.take()).isEqualTo(new Item("a", 1));
    assertThat(inbox.take()).isEqualTo(new Item("b", 2));
    assertThat(inbox.counters()).isEqualTo(new Inbox.Counters(0, 2, 0, 0, 0));
  }

  @Test
  void whenFullTheNewestIsRefusedOrTheOldestDropped() throws InterruptedException {
    Inbox<Item> newest = new Inbox<>(2, Overflow.DROP_NEWEST);
    Inbox<Item> oldest = new Inbox<>(2, Overflow.DROP_OLDEST);
    for (int n = 1; n <= 3; n++) {
      SendOutcome outcome = newest.offer(new Item("k", n), null);
      assertThat(outcome).isEqualTo(n <= 2 ? SendOutcome.ACCEPTED : SendOutcome.DROPPED);
      assertThat(oldest.offer(new Item("k", n), null)).isEqualTo(SendOutcome.ACCEPTED);
    }

    assertThat(drain(newest)).extracting(Item::n).containsExactly(1, 2);
    assertThat(drain(oldest)).extracting(Item::n).containsExactly(2, 3);
    assertThat(newest.counters().dropped()).isEqualTo(1);
    assertThat(oldest.counters().evicted()).isEqualTo(1);
  }

  @Test
  void coalescingKeepsTheLatestOfAKeyInTheOlderOnesPlace() throws InterruptedException {
    Inbox<Item> inbox = new Inbox<>(2, Overflow.COALESCE_BY_KEY);
    inbox.offer(new Item("a", 1), "a");
    inbox.offer(new Item("b", 2), "b");
    inbox.offer(new Item("a", 3), "a"); // replaces a, full or not
    inbox.offer(new Item("c", 4), "c"); // full, no such key: the oldest goes

    assertThat(drain(inbox)).containsExactly(new Item("b", 2), new Item("c", 4));
    assertThat(inbox.counters().coalesced()).isEqualTo(1);
    assertThat(inbox.counters().evicted()).isEqualTo(1);

    inbox.offer(new Item("a", 5), null); // no key: never coalesced
    inbox.offer(new Item("a", 6), null);
    assertThat(drain(inbox)).extracting(Item::n).containsExactly(5, 6);
  }

  @Test
  void pollWaitsAtMostItsTimeout() throws InterruptedException {
    Inbox<Item> inbox = new Inbox<>(1, Overflow.DROP_NEWEST);
    long start = System.nanoTime();

    assertThat(inbox.poll(Duration.ofMillis(50))).isNull();
    assertThat(Duration.ofNanos(System.nanoTime() - start)).isGreaterThanOrEqualTo(Duration.ofMillis(40));
  }

  @Test
  void aWaitingReaderGetsTheNextItemOrNullWhenItCloses() throws Exception {
    Inbox<Item> inbox = new Inbox<>(5, Overflow.DROP_NEWEST);
    CompletableFuture<Item> first = CompletableFuture.supplyAsync(() -> take(inbox));
    Thread.sleep(50);
    inbox.offer(new Item("a", 1), null);
    assertThat(first.get(5, TimeUnit.SECONDS)).isEqualTo(new Item("a", 1));

    CompletableFuture<Item> second = CompletableFuture.supplyAsync(() -> take(inbox));
    Thread.sleep(50);
    inbox.close();
    assertThat(second.get(5, TimeUnit.SECONDS)).isNull();
    assertThat(inbox.offer(new Item("b", 2), null)).isEqualTo(SendOutcome.CLOSED);
  }

  @Test
  void closingDiscardsWhatIsQueued() throws InterruptedException {
    Inbox<Item> inbox = new Inbox<>(5, Overflow.DROP_NEWEST);
    inbox.offer(new Item("a", 1), null);
    inbox.close();

    assertThat(inbox.take()).isNull();
  }

  @Test
  void aWriterNeverWaits() {
    assertThatThrownBy(() -> new Inbox<Item>(5, Overflow.BLOCK_SENDER)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Inbox<Item>(0, Overflow.DROP_NEWEST)).isInstanceOf(IllegalArgumentException.class);
  }

  private static Item take(Inbox<Item> inbox) {
    try {
      return inbox.take();
    } catch (InterruptedException e) {
      throw new IllegalStateException(e);
    }
  }
}
