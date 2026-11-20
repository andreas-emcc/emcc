/**
 * The plugin's links (ADR-0036, ADR-0037), from the in/out transport pattern of the plugin template,
 * input only: a UDP receiver and a TCP client that reads, each on a connection task. Sockets exist only in
 * the task classes and their nested classes (rule C6, {@code PluginRules}).
 *
 * <p>{@link dev.emcc.plugins.ais.transport.LinkWorker} reads the {@code links} setting, starts one
 * connection task per link and stops it when the link goes. A task cuts what it receives into lines
 * ({@link dev.emcc.plugins.ais.transport.LineFramer}), checks and decodes them
 * ({@link dev.emcc.plugins.ais.transport.Inbound}) and sends each AIS message to the worker as an
 * immutable message.
 */
@NullMarked
package dev.emcc.plugins.ais.transport;

import org.jspecify.annotations.NullMarked;
