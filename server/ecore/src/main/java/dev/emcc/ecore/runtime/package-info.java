/**
 * ECore's worker runtime and message bus (overview 4.2 and 4.3, ADR-0004).
 *
 * <p>Workers handle messages one at a time from a bounded mailbox, on their own virtual thread. A
 * watchdog detects handler calls that exceed their budget. Workers talk through direct sends,
 * non-blocking request/reply ({@link dev.emcc.ecore.runtime.HandlerContext#ask ask}) and typed
 * topics; timers send messages. This is the only package in ECore that creates threads.
 *
 * <p>The plugin host (T-015) maps the Plugin SDK's worker API onto these types. Everything is
 * non-null unless marked {@code @Nullable}.
 */
@NullMarked
package dev.emcc.ecore.runtime;

import org.jspecify.annotations.NullMarked;
