/**
 * The server part of the {@code cot} plugin: links to TAK systems, each in a connection task (a
 * TCP or TLS client, or a UDP or multicast receiver). {@code TcpLinkTask} and {@code
 * DatagramLinkTask} open the sockets; {@code InputPipe} parses what they receive; {@code Applier}
 * is the one worker that owns all state and talks to the object store. The CoT codec is in {@code
 * codec} and knows nothing of either.
 */
@NullMarked
package dev.emcc.plugins.cot;

import org.jspecify.annotations.NullMarked;
