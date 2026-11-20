package dev.emcc.plugins.cot;

/**
 * What one run of a link's task has read and dropped since its connection began: cumulative, so a
 * message that replaces an earlier one in a coalescing mailbox loses nothing.
 *
 * @param read documents read from the stream
 * @param malformed documents that did not parse, or had a DTD
 * @param tooLarge documents larger than the limit
 * @param ignored events of a type the plugin does not show (chat, tasking, drawings, pings)
 * @param overflow events the worker's mailbox refused
 */
record Counters(long read, long malformed, long tooLarge, long ignored, long overflow) {

  static final Counters ZERO = new Counters(0, 0, 0, 0, 0);

  Counters plus(Counters o) {
    return new Counters(read + o.read, malformed + o.malformed, tooLarge + o.tooLarge, ignored + o.ignored, overflow + o.overflow);
  }

  /** Component-wise maximum: of two snapshots of the same cumulative counters, the later one. */
  Counters max(Counters o) {
    return new Counters(Math.max(read, o.read), Math.max(malformed, o.malformed), Math.max(tooLarge, o.tooLarge),
        Math.max(ignored, o.ignored), Math.max(overflow, o.overflow));
  }

  long dropped() {
    return malformed + tooLarge + ignored + overflow;
  }
}
