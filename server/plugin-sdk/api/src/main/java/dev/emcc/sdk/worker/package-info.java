/**
 * Workers: a mailbox and a handler, run by ECore one message at a time (overview 4.2, ADR-0004).
 *
 * <p>Plugins never create threads. They spawn workers, which own their state and talk only
 * through immutable {@link dev.emcc.sdk.Message messages}. A worker never waits for another one:
 * {@link dev.emcc.sdk.worker.WorkerContext#ask ask} delivers the answer, or a timeout, later as an
 * ordinary message.
 *
 * <p>Everything a plugin passes to the SDK that ECore calls later (handler factories, and the
 * mappers of {@code ask}, subscriptions, outbound HTTP and endpoints) is plugin code. Mappers must
 * be pure and non-blocking; ECore runs them inside the target worker, under its watchdog budget,
 * never on an ECore thread.
 *
 * <pre>{@code
 * WorkerRef<TileMsg> tiles = context.workers().spawn(
 *     WorkerSpec.of("tiles", TileMsg.class, TileWorker::new)
 *         .mailbox(1_000, Overflow.dropOldest())
 *         .budget(Duration.ofSeconds(5))
 *         .restartable(true));
 * }</pre>
 */
@NullMarked
package dev.emcc.sdk.worker;

import org.jspecify.annotations.NullMarked;
