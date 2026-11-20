package dev.emcc.sdk.connection;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.worker.WorkerRef;
import java.util.function.Function;
import java.util.function.Supplier;

/**
 * SDK 1.2.0: starts connection tasks (ADR-0036; rule C6). For every run, ECore takes a fresh
 * {@link ConnectionTask} from {@code factory} and runs it on a thread of its own, a platform thread
 * (CR-0027). The factory is plugin code too and runs on that thread; a factory that throws counts
 * as a run that threw.
 *
 * <pre>{@code
 * ConnectionRef<Outgoing> out = context.connections().start(
 *     ConnectionSpec.of("tak-out", Outgoing.class)
 *         .inbox(1_000, Overflow.coalesceByKey())
 *         .restart(Restart.onFailure(Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(60)))),
 *     () -> new TakClient(host, port, "tak-north"),   // host and port from the settings, never from data
 *     links, LinkMsg.Connection::new);                  // ConnectionEvents as messages to the worker "links"
 * }</pre>
 *
 * <p><b>Settings changes:</b> a running task keeps running. The plugin gets the new settings
 * ({@code subscribeSettings}), stops the tasks whose link is gone, and starts new ones.
 *
 * <p>A plugin has at most {@link #MAX_TASKS} tasks that are not stopped, children included (an
 * ECore setting).
 */
public interface Connections {

  /** The default cap on a plugin's tasks, children included. */
  int MAX_TASKS = 100;

  /** The most undelivered events of one task before ECore keeps only the latest. */
  int MAX_PENDING_EVENTS = 100;

  /**
   * Starts a task and returns at once; ECore runs it in the background.
   *
   * @throws IllegalArgumentException if a task of that name runs
   * @throws IllegalStateException if the plugin already has {@link #MAX_TASKS} tasks
   */
  <I extends Message> ConnectionRef<I> start(ConnectionSpec<I> spec, Supplier<? extends ConnectionTask<I>> factory);

  /**
   * As {@link #start(ConnectionSpec, Supplier)}, and reports each {@link ConnectionEvent} to {@code
   * events}, converted by {@code toMessage} (plugin code: pure, non-blocking, run in that worker).
   * Events are always delivered, in order, whatever the mailbox's overflow policy, with one bound:
   * when more than {@link #MAX_PENDING_EVENTS} events of one task wait undelivered, ECore keeps only
   * the latest, so a worker that hangs does not collect events without limit.
   */
  <I extends Message, M extends Message> ConnectionRef<I> start(
      ConnectionSpec<I> spec, Supplier<? extends ConnectionTask<I>> factory, WorkerRef<M> events, Function<ConnectionEvent, ? extends M> toMessage);
}
