package dev.emcc.plugins.gmti.format;

/**
 * A segment this plugin does not read: HRR, test and status, processing history, job request and
 * acknowledge, reserved and extension types (brief section 2; AEDP 3.2.1). Its bytes are passed over
 * by {@code S2}.
 *
 * @param type {@code S1}
 * @param size {@code S2}: the segment header's 5 bytes and the body
 */
public record Skipped(int type, long size) implements Segment {}
