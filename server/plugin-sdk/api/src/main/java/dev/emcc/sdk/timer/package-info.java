/**
 * Timers that send messages to workers. Timers never run plugin code themselves.
 *
 * <pre>{@code
 * Cancellable tick = context.timers().every(Duration.ofMinutes(1), statsWorker, new StatsMsg.Report());
 * }</pre>
 */
@NullMarked
package dev.emcc.sdk.timer;

import org.jspecify.annotations.NullMarked;
