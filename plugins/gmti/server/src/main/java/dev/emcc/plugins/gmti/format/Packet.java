package dev.emcc.plugins.gmti.format;

import java.util.List;
import java.util.Objects;

/**
 * A decoded packet: its header and its segments in the order received (AEDP 2.1).
 *
 * @param header the packet header
 * @param segments the segments; those not read are {@link Skipped}
 * @param size {@code P2}, the packet's bytes
 * @param valuesOutOfRange values the decoder left out because they are out of their range (a report
 *     whose reduced position lies off the earth), counted by the link; the rest of the packet is used
 */
public record Packet(PacketHeader header, List<Segment> segments, int size, int valuesOutOfRange) {

  public Packet {
    Objects.requireNonNull(header, "header");
    segments = List.copyOf(segments);
  }
}
