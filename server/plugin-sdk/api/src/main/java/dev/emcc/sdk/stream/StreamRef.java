package dev.emcc.sdk.stream;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.worker.HandleId;
import dev.emcc.sdk.worker.SendResult;

/**
 * SDK 1.8.0 (CR-0044 E1): an open stream. An immutable handle; implementations (by ECore and the
 * test kit) are equal by {@link #id()}, so that it can travel in messages: a worker opens the
 * stream and hands it to its connection task. Every method returns at once and never blocks (rule
 * C5); any of the plugin's threads may call them.
 *
 * <pre>{@code
 * // in the connection task, for each datagram:
 * if (video.write(Bytes.of(datagram), isRandomAccess(datagram)) == SendResult.DROPPED) {
 *   task.count("stream dropped", 1);
 * }
 * }</pre>
 */
public interface StreamRef {

  HandleId id();

  /** The spec's name. */
  String name();

  /**
   * Hands ECore a chunk, e.g. one datagram, for every viewer.
   *
   * @param chunk 1 byte to {@link Streams#MAX_CHUNK}
   * @param startPoint whether a new viewer may start at this chunk (for MPEG-TS, a random access
   *     point of the video)
   * @return {@code ACCEPTED}; {@code DROPPED} past {@link Streams#MAX_RATE}, or while a conversion
   *     writes to this stream; {@code CLOSED} once it is closed
   * @throws IllegalArgumentException for an empty chunk or one above {@link Streams#MAX_CHUNK}
   */
  SendResult write(Bytes chunk, boolean startPoint);

  /**
   * Sets what each new viewer gets first, e.g. the latest PAT and PMT, until it is replaced; an
   * empty one sends nothing first. No effect once closed.
   *
   * @throws IllegalArgumentException above {@link Streams#MAX_HEADER}
   */
  void header(Bytes header);

  /** Replaces the stream's label (e.g. its ST 0102 classification changed). No effect once closed. */
  void label(SecurityLabel label);

  /** The viewers now, read without waiting, for the plugin's status; 0 once closed. */
  int viewers();

  /** Ends every viewer's response; the name may be opened again. Calling it again has no effect. */
  void close();
}
