package dev.emcc.sdk.stream;

import dev.emcc.sdk.Bytes;
import java.time.Instant;
import java.util.Objects;

/**
 * SDK 1.9.0 (CR-0050 point 1.5): one H.264 access unit from an encoder, in Annex B form (with start
 * codes), as ECore splits ffmpeg's output by its access unit delimiters. It goes into the compute
 * task's inbox given to {@link Conversions#encode}, through the plugin's {@code toItem}.
 *
 * <p>It is not {@link dev.emcc.sdk.worker.Coalescing}: an inbox item that carries it should give each
 * picture a key of its own (e.g. its {@link #sequence()}), so that the inbox never replaces one; a
 * lost access unit is a glitch until the next keyframe.
 *
 * @param sequence counts from 0 per encoder, one a picture
 * @param time the {@link RawPicture#time()} of the picture it came from (no B-frames, so ECore pairs
 *     them in order)
 * @param keyframe whether it is an IDR picture, a start point
 * @param accessUnit the access unit, not empty
 */
public record EncodedPicture(long sequence, Instant time, boolean keyframe, Bytes accessUnit) {

  public EncodedPicture {
    if (sequence < 0) {
      throw new IllegalArgumentException("an encoded picture's sequence is 0 or more: " + sequence);
    }
    Objects.requireNonNull(time, "time");
    Objects.requireNonNull(accessUnit, "accessUnit");
    if (accessUnit.size() == 0) {
      throw new IllegalArgumentException("an access unit is not empty");
    }
  }
}
