/**
 * <b>Deprecated from SDK 1.2.0:</b> use connection tasks ({@code dev.emcc.sdk.connection}; ADR-0036).
 * The listener stays in SDK 1.x for existing code and is removed in the next major version.
 *
 * Listeners: blocking network I/O for a plugin (overview 4.2, rule C6; docs/plugins/sdk-v1.md).
 * ECore opens the connection, to an endpoint the plugin's settings name (manifest {@code
 * network}), and runs the plugin's {@link dev.emcc.sdk.listener.Listener} loop on a dedicated
 * virtual thread. The loop reads, and passes what it reads to workers as messages.
 *
 * <pre>{@code
 * ListenerRef north = context.listeners().start(
 *     ListenerSpec.tls("tak-north", "tak.example.local", 8089, "tak-north")
 *         .reconnect(Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(60))),
 *     () -> new CotReader(applier),
 *     streams, StreamMsg.Event::new);
 * }</pre>
 */
@NullMarked
package dev.emcc.sdk.listener;

import org.jspecify.annotations.NullMarked;
