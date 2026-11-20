package dev.emcc.sdk.listener;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.worker.WorkerRef;
import java.util.function.Function;
import java.util.function.Supplier;

/**
 * Starts listeners (rule C6). For every connection ECore makes, it takes a fresh {@link Listener}
 * from {@code factory} and runs it on a dedicated virtual thread. The factory is plugin code too
 * and runs on that thread, before the loop; a factory that throws counts as a loop that threw
 * (reported in {@link ListenerEvent.Disconnected}, then the back-off applies).
 *
 * <p><b>Endpoints are checked when connecting.</b> A settings change does not close a live
 * connection: the plugin gets the new settings ({@code subscribeSettings}) and stops the
 * listeners whose endpoint is gone. ECore refuses a reconnect to an endpoint the settings no
 * longer name ({@code Disconnected} without a retry).
 *
 * <pre>{@code
 * ListenerRef north = context.listeners().start(
 *     ListenerSpec.tcp("tak-north", host, port).reconnect(Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(60))),
 *     () -> new CotReader(applier),
 *     streams, StreamMsg.Event::new);   // Connected and Disconnected as messages to the worker "streams"
 * }</pre>
 *
 * <p>A plugin has at most {@link #MAX_LISTENERS} listeners that are not stopped (an ECore setting).
 *
 * @deprecated from SDK 1.2.0: use a connection task ({@code dev.emcc.sdk.connection}), in which the
 *     plugin opens its own sockets of any kind (ADR-0036). Kept in SDK 1.x for existing code, removed
 *     in the next major version.
 */
@Deprecated(since = "1.2.0")
public interface Listeners {

  /** The default cap on listeners per plugin. */
  int MAX_LISTENERS = 100;

  /** The most undelivered events of one listener before ECore keeps only the latest. */
  int MAX_PENDING_EVENTS = 100;

  /**
   * Starts a listener and returns at once; ECore connects in the background.
   *
   * @throws IllegalArgumentException if the endpoint is not one the plugin's current settings name
   *     at a place its manifest's {@code network.endpoints} declares, or the name is in use
   * @throws IllegalStateException if the plugin already has {@link #MAX_LISTENERS} listeners
   */
  ListenerRef start(ListenerSpec spec, Supplier<? extends Listener> factory);

  /**
   * As {@link #start(ListenerSpec, Supplier)}, and reports each {@link ListenerEvent} to {@code
   * events}, converted by {@code toMessage} (plugin code: pure, non-blocking, run in that worker).
   * Events are always delivered, in order, whatever the mailbox's overflow policy, with one bound:
   * when more than {@link #MAX_PENDING_EVENTS} events of one listener wait undelivered, ECore
   * keeps only the latest {@code Connected} or {@code Disconnected}, so a worker that hangs does
   * not collect events without limit.
   */
  <M extends Message> ListenerRef start(
      ListenerSpec spec, Supplier<? extends Listener> factory, WorkerRef<M> events, Function<ListenerEvent, ? extends M> toMessage);
}
