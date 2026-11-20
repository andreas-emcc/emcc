package dev.emcc.ecore.runtime;

import java.time.Duration;

/**
 * A snapshot of one worker's counters, for the monitor view and metrics (overview 4.10).
 *
 * @param worker which worker
 * @param state its state
 * @param queued messages in the mailbox now
 * @param capacity the mailbox size
 * @param accepted messages accepted into the mailbox (including replies and other system deliveries)
 * @param dropped messages refused by a full mailbox
 * @param evicted queued messages evicted to make room, or discarded at stop
 * @param coalesced queued messages replaced by a newer one with the same key
 * @param processed handler calls completed
 * @param failures handler calls that threw
 * @param hung handler calls that exceeded the budget
 * @param restarts restarts after hanging
 * @param maxHandlerTime the longest completed handler call
 * @param totalHandlerTime the sum of all completed handler calls
 */
public record WorkerStats(
    WorkerInfo worker,
    WorkerState state,
    int queued,
    int capacity,
    long accepted,
    long dropped,
    long evicted,
    long coalesced,
    long processed,
    long failures,
    long hung,
    long restarts,
    Duration maxHandlerTime,
    Duration totalHandlerTime) {}
