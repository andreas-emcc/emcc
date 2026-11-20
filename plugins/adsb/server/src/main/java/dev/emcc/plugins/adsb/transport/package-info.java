/**
 * The transport of the {@code adsb} plugin: a TCP client link that reads SBS-1 lines from a decoder
 * (the template's transport pattern, input only; playbook, work package 2). The link's task
 * ({@link dev.emcc.plugins.adsb.transport.TcpClientLinkTask}) opens the socket and cuts the stream into
 * lines ({@link dev.emcc.plugins.adsb.transport.LineFramer}); {@link dev.emcc.plugins.adsb.transport.Inbound}
 * parses each line in the task and sends the result to the worker as an immutable message. Sockets exist
 * only in the task classes and their nested classes (rule C6, {@code PluginRules}).
 */
@NullMarked
package dev.emcc.plugins.adsb.transport;

import org.jspecify.annotations.NullMarked;
