/**
 * The links of {@code gmti} (brief section 4), from the template's transport pattern (taken from
 * {@code cot}'s tested link tasks), on the SDK's connection tasks (ADR-0036), which ECore runs on
 * platform threads (CR-0027).
 *
 * <p><b>The modes</b> are a link's {@link dev.emcc.plugins.gmti.transport.Link.Mode} and
 * {@link dev.emcc.plugins.gmti.transport.Link.Direction}, {@code in} or {@code out} (no {@code both}):
 * <ul>
 *   <li>UDP: one packet per datagram; {@code in} may join a multicast group;
 *   <li>a TCP client that connects to a peer;
 *   <li>a TCP server that peers connect to, one connection per client.
 * </ul>
 *
 * <p><b>How it fits together:</b> {@link dev.emcc.plugins.gmti.transport.LinkWorker} reads the
 * {@code links} setting, starts one connection task per link and stops it when the link goes. A task
 * cuts a TCP stream into packets by their size ({@link dev.emcc.plugins.gmti.transport.PacketFramer}),
 * decodes each ({@link dev.emcc.plugins.gmti.transport.Inbound}) and sends it to the worker as an
 * immutable message; a malformed packet over TCP ends the run, and ECore connects again. The worker
 * posts each dwell to send into the link's task inbox, which keeps the latest dwell per sensor. Sockets
 * exist only in the task classes and their nested classes (rule C6, {@code PluginRules}).
 */
@NullMarked
package dev.emcc.plugins.gmti.transport;

import org.jspecify.annotations.NullMarked;
