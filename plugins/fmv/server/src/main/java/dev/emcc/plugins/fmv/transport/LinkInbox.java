package dev.emcc.plugins.fmv.transport;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.stream.ConversionRef;
import dev.emcc.sdk.stream.StreamRef;
import java.util.UUID;

/**
 * What the worker tells a link's task (ADR-0057 point 5: a worker opens a stream and hands it to its
 * connection task; the task writes to it). {@code run} is the task's run the message is for: one
 * for an earlier run is ignored.
 */
public sealed interface LinkInbox extends Message {

  /** The stream to write H.264 and H.265 datagrams to. */
  record Stream(UUID run, StreamRef stream) implements LinkInbox {}

  /** The conversion to write MPEG-2 datagrams to; ECore writes the converted video to the stream itself. */
  record Conversion(UUID run, ConversionRef conversion) implements LinkInbox {}

  /** The stream and any conversion are closed: write to neither (a new video format). */
  record Detach(UUID run) implements LinkInbox {}
}
