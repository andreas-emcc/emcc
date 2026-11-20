package dev.emcc.sdk.stream;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.worker.HandleId;
import dev.emcc.sdk.worker.SendResult;

/**
 * SDK 1.8.0 (CR-0044 E2): a started conversion. An immutable handle; implementations (by ECore and
 * the test kit) are equal by {@link #id()}, so that it travels in messages as {@link StreamRef}
 * does: the worker starts it and hands it to its connection task. Every method returns at once and
 * never blocks (rule C5).
 *
 * <pre>{@code
 * if (mpeg2.write(Bytes.of(datagram)) == SendResult.DROPPED) { task.count("conversion dropped", 1); }
 * }</pre>
 */
public interface ConversionRef {

  HandleId id();

  /** The stream its output goes to. While it runs, the plugin's own writes to that stream are {@code DROPPED}. */
  StreamRef target();

  /**
   * Hands ECore a chunk of the input transport stream.
   *
   * @param chunk 1 byte to {@link Streams#MAX_CHUNK}, at most {@link Streams#MAX_RATE}
   * @return {@code ACCEPTED}; {@code DROPPED} while it waits for a slot, past the ECore setting
   *     {@code emc2.conversions.inputQueueBytes} (default 2 MiB) or past {@link Streams#MAX_RATE},
   *     each counted; {@code CLOSED} once it has ended
   * @throws IllegalArgumentException for an empty chunk or one above {@link Streams#MAX_CHUNK}
   */
  SendResult write(Bytes chunk);

  /** Stops it; its slot frees and a {@link ConversionEvent.Stopped} follows. Calling it again has no effect. */
  void stop();
}
