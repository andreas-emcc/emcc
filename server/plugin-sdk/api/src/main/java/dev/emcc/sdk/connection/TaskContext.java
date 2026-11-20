package dev.emcc.sdk.connection;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.PluginLog;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import java.net.SocketAddress;
import java.time.Duration;
import java.time.Instant;
import java.util.function.Supplier;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import org.jspecify.annotations.Nullable;

/**
 * SDK 1.2.0: what a connection task may do besides its own I/O (ADR-0036). It is not a {@code
 * WorkerContext}: a task cannot ask, submit changes or set timers. It sends to a worker that can.
 *
 * <p>When the task is stopped, it ends, or the plugin stops, the context is <b>fenced</b>: what it
 * sends afterwards is dropped ({@link SendResult#CLOSED}).
 *
 * <pre>{@code
 * for (Outgoing m; (m = task.take()) != null; ) {
 *   stream.write(m.bytes());
 *   task.count("sent", 1);
 * }
 * }</pre>
 *
 * @param <I> the type of the task's inbox items
 */
public interface TaskContext<I extends Message> {

  /**
   * The next item workers posted ({@link ConnectionRef#post}), waiting for one as long as it
   * takes. Returns {@code null} when the task is being stopped: the task should then return. Waiting
   * here holds no lock (rule C4).
   */
  @Nullable I take();

  /** As {@link #take}, waiting at most {@code timeout} (1 ms to 1 hour); {@code null} also when none came by then. */
  @Nullable I poll(Duration timeout);

  /**
   * Registers {@code resource} (a socket, a channel, a selector) for ECore to close when the task
   * stops, so that a blocked read or accept ends. Returns it. Register each socket at once.
   */
  <C extends AutoCloseable> C closeOnStop(C resource);

  /** Puts {@code message} into the worker's mailbox and returns at once; the worker's overflow policy applies. Never blocks. */
  <M extends Message> SendResult send(WorkerRef<M> target, M message);

  /**
   * Starts a child task, stopped with this one, e.g. one per client of a TCP server, or a reader
   * and a writer for one socket. Its name is this task's name, a slash and {@code spec}'s name, which
   * must be unique among this task's children: the plugin names them, e.g. {@code client-1}, {@code
   * client-2} from a counter in the task. A socket may pass to the task's own children, never
   * to a worker. Children count toward the cap ({@link Connections#MAX_TASKS}).
   *
   * @throws IllegalArgumentException if a child of that name runs
   * @throws IllegalStateException at the cap, or when this task is stopping; a TCP server's accept
   *     loop catches it, closes the new client and counts it
   */
  <J extends Message> ConnectionRef<J> startChild(ConnectionSpec<J> spec, Supplier<? extends ConnectionTask<J>> factory);

  /** Adds {@code delta} to the plugin's own counter {@code name} for this task (messages and bytes in and out, errors), shown in the monitor view. */
  void count(String name, long delta);

  /** Sets a detail of this task for the monitor view, e.g. its protocol; {@code value} replaces the previous one. */
  void detail(String key, String value);

  /** The address this task listens on, for the monitor view and the SRA's check against the settings (ADR-0036 point 6). */
  void listening(SocketAddress address);

  /** The peer this task is connected to, for the monitor view. */
  void peer(SocketAddress address);

  /** When {@link #count} was last called for this task, or {@code null} if never. */
  @Nullable Instant lastActivity();

  /**
   * A socket factory for TLS with the key and trust stores that local server configuration names
   * {@code credentials} (ADR-0036 point 5). The plugin never gets the key material; certificates
   * and passwords never appear in settings, the repository, a log or the browser. For TCP clients;
   * links that listen have no TLS (ADR-0062 point 5). {@code credentials} is the name an admin picks
   * in the link's {@code tls-credential} setting, or the link's name when that is empty.
   *
   * @throws IllegalArgumentException if no credentials of that name are configured
   * @throws IllegalStateException SDK 1.9.0 (ADR-0062 point 4): if the credential's own certificate
   *     has expired, the message naming the credential and the date, or if ECore cannot read it; a
   *     task fails its start with it, as with a missing credential
   */
  SSLSocketFactory tls(String credentials);

  /** As {@link #tls}, the {@code SSLContext} itself, e.g. for an {@code SSLEngine} with NIO. */
  SSLContext sslContext(String credentials);

  /** True once the task is being stopped; it should then return. */
  boolean stopping();

  /** The plugin's logger; entries are also tagged with the task's name. */
  PluginLog log();

  /** This task. */
  ConnectionRef<I> self();
}
