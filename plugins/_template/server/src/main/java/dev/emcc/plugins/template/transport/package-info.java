/**
 * The transport pattern for in/out plugins (the M4 plan, section 3; owner, BQ): a pattern each plugin
 * copies and owns, not an SDK building block. Taken from {@code cot}'s tested link tasks, on the SDK's
 * connection tasks (ADR-0036), which ECore runs on platform threads (CR-0027).
 *
 * <p><b>The six modes</b> are a link's {@link dev.emcc.plugins.template.transport.Link.Mode} and
 * {@link dev.emcc.plugins.template.transport.Link.Direction}:
 * <ul>
 *   <li>UDP: receive ({@code in}), send ({@code out}), or both on one socket ({@code both});
 *   <li>a TCP client that connects to a peer, as consumer ({@code in}), provider ({@code out}) or both on one connection;
 *   <li>a TCP server that peers connect to, as consumer, provider or both, one connection per client.
 * </ul>
 *
 * <p><b>How it fits together:</b> {@link dev.emcc.plugins.template.transport.LinkWorker} reads the
 * {@code links} setting, starts one connection task per link and stops it when the link goes. A task
 * cuts what it receives into frames ({@link dev.emcc.plugins.template.transport.LineFramer}) and sends
 * each to the worker as an immutable message; the worker posts what to send into the link's task
 * inbox, which keeps the latest frame per key. Sockets exist only in the task classes and their nested
 * classes (rule C6, {@code PluginRules}).
 *
 * <p><b>Copy it</b> into your plugin's server part when your plugin has connections, and replace what
 * is marked {@code YOUR PROTOCOL}: the frames (lines here), their parsing and what the worker does
 * with them. Delete this package when your plugin has none. The playbook,
 * {@code docs/plugins/in-out/playbook.md}, says how, step by step.
 */
@NullMarked
package dev.emcc.plugins.template.transport;

import org.jspecify.annotations.NullMarked;
