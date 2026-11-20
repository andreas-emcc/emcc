package dev.emcc.sdk.worker;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.PluginLog;
import java.time.Duration;
import java.util.function.Function;

/**
 * What a handler gets with each message: its own reference, a logger, and request/reply.
 *
 * <p>After a restart (see {@link WorkerSpec#restartable}) the old context is <b>fenced</b>:
 * anything sent through it later, e.g. by a thread that was stuck, is dropped.
 *
 * <pre>{@code
 * ctx.ask(cache, replyTo -> new CacheMsg.Get(key, replyTo), Duration.ofSeconds(2),
 *         reply -> new TileMsg.CacheAnswer(key, reply));
 * }</pre>
 *
 * @param <M> the worker's message type
 */
public interface WorkerContext<M extends Message> {

  /** This worker's reference, e.g. to pass as a reply target. */
  WorkerRef<M> self();

  /** The plugin's logger; entries are also tagged with the worker's name. */
  PluginLog log();

  /**
   * Asks {@code target} and returns at once (rule C5). The request is built by {@code request}
   * from a fresh reply handle. Exactly one answer arrives later in this worker's mailbox, as the
   * message that {@code toMessage} makes from the {@link Reply}: {@code Ok} with the target's
   * value, {@code Failed} if the target failed it, is stopped, refused or evicted the request, or if
   * the plugin already has the maximum number of outstanding asks (an ECore setting, default 10 000
   * per plugin; then at once, with the reason {@code "too many outstanding asks"}), or {@code
   * TimedOut} after {@code timeout}. Answers are always delivered, whatever the overflow
   * policy. {@code toMessage} is plugin code: pure, non-blocking, run in this worker.
   *
   * <p>After a restart, a new handler instance may receive answers to asks of the old one, and
   * must tolerate them (e.g. ignore unknown correlation keys).
   *
   * @param timeout from 1 ms to 10 minutes
   */
  <Q extends Message, R extends Message> void ask(
      WorkerRef<Q> target, Function<ReplyTo<R>, ? extends Q> request, Duration timeout, Function<Reply<R>, ? extends M> toMessage);
}
