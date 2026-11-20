package dev.emcc.sdk.stream;

import dev.emcc.sdk.worker.HandleId;
import dev.emcc.sdk.worker.SendResult;

/**
 * SDK 1.9.0 (CR-0050 point 1.3): a started encoder. An immutable handle; implementations (by ECore
 * and the test kit) are equal by {@link #id()}, so that it travels in messages: the worker starts it
 * and posts it to the compute task that renders the pictures. Every method returns at once and
 * never blocks (rule C5). Callable from a worker and from a compute task (ADR-0064 point 3), which
 * may use no SDK service but may use this handle.
 *
 * <pre>{@code
 * if (encoder.write(new RawPicture(now, Bytes.of(i420))) == SendResult.DROPPED) { ctx.count("frames dropped", 1); }
 * }</pre>
 */
public interface EncoderRef {

  /** At most this many pictures wait for the encoder's process; a later one is dropped, not queued (ADR-0059 point 7). */
  int MAX_WAITING = 2;

  HandleId id();

  /** The encoder's name, as in its spec. */
  String name();

  /**
   * Hands ECore one picture to encode.
   *
   * @return {@code ACCEPTED}; {@code DROPPED} while it waits for a slot ({@link
   *     ConversionEvent.Waiting}) or when {@link #MAX_WAITING} pictures wait for the process already,
   *     each counted; {@code CLOSED} once it has ended
   * @throws IllegalArgumentException if the picture is not {@link EncoderSpec#pictureBytes()} bytes
   */
  SendResult write(RawPicture picture);

  /** Stops it; its slot frees and a {@link ConversionEvent.Stopped} follows. Calling it again has no effect. */
  void stop();
}
