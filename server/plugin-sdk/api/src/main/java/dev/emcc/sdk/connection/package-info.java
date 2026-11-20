/**
 * Connection tasks (SDK 1.2.0; ADR-0036, CR-0025 part 2): a plugin's own sockets of any kind, in
 * plugin code that ECore runs on a thread of its own, starts, restarts, caps, stops and monitors.
 * The thread is a platform thread, on every OS (CR-0027): on Windows, JDK-8334574 can leave a
 * virtual thread that is blocked writing a socket unwoken while another virtual thread reads it,
 * which is what a two-way link does with a task and its child.
 *
 * <p>A connection task is the only plugin code that may block (rule C6), in I/O or while it waits
 * for data to send. It opens its sockets with the JDK's classes ({@code Socket}, {@code
 * ServerSocket}, {@code DatagramSocket}, {@code MulticastSocket}, the NIO channels), and nothing
 * else in a plugin does ({@code PluginRules}). It sends what it receives to workers as immutable
 * messages, and workers hand it data to send through its inbox, never blocking.
 *
 * <p><b>Hosts</b>, ports and multicast groups come from the plugin's settings, never from a browser
 * request, a message or an object's data (ADR-0030, ADR-0036 point 3). ECore checks no endpoint;
 * keeping to this is the plugin's duty, which the reviews check. A connection that listens binds
 * to loopback unless an admin chooses otherwise ({@link dev.emcc.sdk.connection.ListenAddress}).
 *
 * <p>Received data is untrusted: limit sizes, parse with safe parsers (no DTDs, no external
 * entities), and pass CPU-heavy work to a compute worker (rule C7). No watchdog budget applies to
 * a task.
 *
 * <p>The deprecated listener ({@code dev.emcc.sdk.listener}) stays in SDK 1.x for existing code.
 */
@NullMarked
package dev.emcc.sdk.connection;

import org.jspecify.annotations.NullMarked;
