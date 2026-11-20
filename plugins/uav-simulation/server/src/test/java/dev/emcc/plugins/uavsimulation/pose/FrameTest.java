package dev.emcc.plugins.uavsimulation.pose;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.sdk.timer.Timers;
import java.time.Duration;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** The frame and the field of view (brief functions 4 and 7, section 5). */
class FrameTest {

  @Test
  @DisplayName("Criterion 12: the frame period is 40 ms at 25 frames a second and 33 ms at 30, never below Timers.MIN_PERIOD")
  void period() {
    assertThat(new Frame(1280, 720, 25).period()).isEqualTo(Duration.ofMillis(40));
    assertThat(new Frame(1280, 720, 30).period()).isEqualTo(Duration.ofMillis(33));
    assertThat(new Frame(1280, 720, 1).period()).isEqualTo(Duration.ofSeconds(1));
    for (int rate = Frame.MIN_RATE; rate <= Frame.MAX_RATE; rate++) {
      assertThat(new Frame(640, 360, rate).period()).isGreaterThanOrEqualTo(Timers.MIN_PERIOD);
    }
  }

  @Test
  @DisplayName("Criterion 7: the vertical field of view follows from the frame: 20° at 1280 × 720 is 11.33°")
  void verticalFieldOfView() {
    assertThat(FieldOfView.vertical(20, new Frame(1280, 720, 25))).isCloseTo(11.33, within(0.01));
    assertThat(FieldOfView.vertical(20, new Frame(1920, 1080, 25))).isCloseTo(11.33, within(0.01));
    assertThat(FieldOfView.vertical(120, new Frame(640, 360, 25))).isCloseTo(2 * Math.toDegrees(Math.atan(Math.sqrt(3) * 9 / 16)), within(1e-9));
    assertThatThrownBy(() -> FieldOfView.vertical(0, Frame.DEFAULT)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  @DisplayName("Section 5: three frame sizes and 1 to 30 frames a second")
  void sizesAndRates() {
    new Frame(640, 360, 1);
    new Frame(1920, 1080, 30);
    assertThatThrownBy(() -> new Frame(1280, 1024, 25)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Frame(720, 1280, 25)).as("width first").isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Frame(1280, 720, 0)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Frame(1280, 720, 31)).isInstanceOf(IllegalArgumentException.class);
  }
}
