package dev.emcc.sdk.stream;

import dev.emcc.sdk.Bytes;
import java.time.Instant;
import java.util.Objects;

/**
 * SDK 1.9.0 (CR-0050 point 1.4; owner, UQ1 A): one raw picture for an encoder, in YUV 4:2:0 planar
 * (I420): the Y plane ({@code width × height} bytes), then U, then V (each {@code width/2 ×
 * height/2}), {@link EncoderSpec#pictureBytes()} bytes exactly. One format only, so that the
 * minimal ffmpeg build needs no scaler. The data crosses to ECore as {@link Bytes}, one copy.
 *
 * @param time when the picture was taken; the access unit it gives carries it ({@link
 *     EncodedPicture#time()})
 * @param data the picture; its size is checked by {@link EncoderRef#write}
 */
public record RawPicture(Instant time, Bytes data) {

  public RawPicture {
    Objects.requireNonNull(time, "time");
    Objects.requireNonNull(data, "data");
  }
}
