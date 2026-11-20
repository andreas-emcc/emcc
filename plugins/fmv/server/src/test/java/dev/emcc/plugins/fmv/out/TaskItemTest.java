package dev.emcc.plugins.fmv.out;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.stream.EncodedPicture;
import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The compute task's inbox keys (brief section 10.3 point 9). */
class TaskItemTest {

  static EncodedPicture picture(long sequence) {
    return new EncodedPicture(sequence, Instant.parse("2026-11-17T10:00:00Z").plusMillis(40 * sequence), sequence == 0, Bytes.of(new byte[] {0, 0, 1, 9}));
  }

  @Test
  void section10point3EncodedPicturesNeverReplaceEachOtherNotEvenAcrossEncoders() {
    // each encoder counts from 0 (CR-0050 point 1.5), so the key holds the encoder's generation too
    List<Object> keys = List.of(TaskItem.Encoded.of(1, picture(0)).coalesceKey(), TaskItem.Encoded.of(1, picture(1)).coalesceKey(),
        TaskItem.Encoded.of(2, picture(0)).coalesceKey(), TaskItem.Encoded.of(2, picture(1)).coalesceKey());
    assertThat(new HashSet<>(keys)).hasSize(4);
  }

  @Test
  void anEncodedPictureKeepsItsTimeAndKeyframe() {
    TaskItem.Encoded e = TaskItem.Encoded.of(3, picture(0));
    assertThat(e.generation()).isEqualTo(3);
    assertThat(e.sequence()).isZero();
    assertThat(e.keyframe()).isTrue();
    assertThat(e.time()).isEqualTo(Instant.parse("2026-11-17T10:00:00Z"));
  }
}
