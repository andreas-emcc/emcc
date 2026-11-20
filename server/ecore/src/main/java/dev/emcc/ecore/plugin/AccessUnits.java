package dev.emcc.ecore.plugin;

import java.io.IOException;
import java.util.Arrays;

/**
 * Splits an H.264 Annex B byte stream, as an untrusted process writes it, into access units (SDK 1.9.0, CR-0050 point
 * 1.5; M9 C10): an access unit ends where the next access unit delimiter (NAL type 9) starts, so each one is handed on
 * when the next begins (owner, C10: one picture's delay), and the last at the end. Bytes before the first delimiter join
 * the first unit. A unit is a keyframe when it holds an IDR slice (NAL type 5). One reader thread only; not
 * thread-safe.
 */
final class AccessUnits {

  /** Gets each access unit, in order. */
  @FunctionalInterface
  interface Sink {
    void unit(byte[] unit, boolean keyframe);
  }

  /** The largest access unit taken: a larger one is broken output (20 Mbit/s keyframes are far below). */
  static final int MAX_UNIT = 4 * 1024 * 1024;

  private static final int AUD = 9;
  private static final int IDR = 5;

  private final Sink sink;
  private final int maxUnit;
  private byte[] buffer = new byte[64 * 1024];
  private int length;
  /** Where the search for the next start code goes on. */
  private int scanFrom;
  /** Whether a delimiter has been seen: the one that starts the unit in the buffer. */
  private boolean started;
  private boolean keyframe;

  AccessUnits(Sink sink) {
    this(sink, MAX_UNIT);
  }

  AccessUnits(Sink sink, int maxUnit) {
    this.sink = sink;
    this.maxUnit = maxUnit;
  }

  /**
   * Takes {@code n} bytes of output.
   *
   * @throws IOException if an access unit grows past the largest taken
   */
  void accept(byte[] data, int n) throws IOException {
    if (length + n > buffer.length) {
      buffer = Arrays.copyOf(buffer, Math.max(buffer.length * 2, length + n));
    }
    System.arraycopy(data, 0, buffer, length, n);
    length += n;
    scan();
    if (length > maxUnit) {
      throw new IOException("an access unit over " + maxUnit / (1024 * 1024) + " MiB");
    }
  }

  /** At the end of the output: the unit in the buffer, if any. */
  void finish() {
    if (length > 0) {
      emit(length);
    }
  }

  private void scan() {
    int i = scanFrom;
    while (i + 3 < length) {
      if (buffer[i] == 0 && buffer[i + 1] == 0 && buffer[i + 2] == 1) {
        int type = buffer[i + 3] & 0x1f;
        if (type == AUD) {
          int start = i > 0 && buffer[i - 1] == 0 ? i - 1 : i; // a four-byte start code
          if (started && start > 0) {
            emit(start);
            i = i - start; // the buffer moved down by `start`
          }
          started = true;
        } else if (type == IDR) {
          keyframe = true;
        }
        i += 3;
      } else {
        i++;
      }
    }
    scanFrom = Math.max(0, i);
  }

  /** Hands on the first {@code end} bytes and keeps the rest. */
  private void emit(int end) {
    sink.unit(Arrays.copyOf(buffer, end), keyframe);
    keyframe = false;
    System.arraycopy(buffer, end, buffer, 0, length - end);
    length -= end;
    scanFrom = Math.max(0, scanFrom - end);
  }
}
