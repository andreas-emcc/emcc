package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerOptions;
import dev.emcc.ecore.runtime.WorkerRuntime;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** Events of a listener or a connection task for a plugin worker: in order, and only the latest when it hangs. */
class EventQueueTest {

  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults());

  @AfterEach
  void close() {
    runtime.close();
  }

  @Test
  void eventsArriveInOrderEachThroughTheMapperInTheWorker() throws InterruptedException {
    LinkedBlockingQueue<String> got = new LinkedBlockingQueue<>();
    WorkerHandle<String> worker = runtime.owner("cot").spawn(WorkerOptions.<String>of("applier", () -> (m, ctx) -> got.add(m)));
    EventQueue<Integer, String> queue = new EventQueue<>(runtime, worker, n -> "event " + n, 100);

    for (int n = 1; n <= 50; n++) {
      queue.add(n);
    }

    List<String> received = new ArrayList<>();
    for (int n = 1; n <= 50; n++) {
      received.add(got.poll(10, TimeUnit.SECONDS));
    }
    assertThat(received).first().isEqualTo("event 1");
    assertThat(received).last().isEqualTo("event 50");
    assertThat(received).doesNotHaveDuplicates().doesNotContainNull();
    assertThat(received).isSortedAccordingTo((a, b) -> Integer.compare(number(a), number(b)));
  }

  @Test
  void aWorkerThatDoesNotTakeThemGetsOnlyTheLatestAboveTheLimit() throws InterruptedException {
    CountDownLatch release = new CountDownLatch(1);
    LinkedBlockingQueue<Integer> got = new LinkedBlockingQueue<>();
    WorkerHandle<Integer> worker = runtime.owner("cot").spawn(WorkerOptions.<Integer>of("applier", () -> (m, ctx) -> {
      try {
        release.await(10, TimeUnit.SECONDS); // busy with the first event
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
      got.add(m);
    }));
    EventQueue<Integer, Integer> queue = new EventQueue<>(runtime, worker, n -> n, 3);

    for (int n = 1; n <= 10; n++) {
      queue.add(n); // the worker is busy or not yet there: only the latest survive the limit
    }
    release.countDown();

    List<Integer> received = new ArrayList<>();
    for (Integer n; (n = got.poll(1, TimeUnit.SECONDS)) != null; ) {
      received.add(n);
    }
    // At most the limit plus the one on its way, in order, and always the latest.
    assertThat(received).endsWith(10).hasSizeLessThanOrEqualTo(4).isSorted();
  }

  private static int number(String event) {
    return Integer.parseInt(event.substring("event ".length()));
  }
}
