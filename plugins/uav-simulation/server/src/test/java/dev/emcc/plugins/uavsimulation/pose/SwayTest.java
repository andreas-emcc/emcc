package dev.emcc.plugins.uavsimulation.pose;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import java.util.HashSet;
import java.util.Set;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/** The micro sway (M10 plan point 8, M9.2's V3): its waves, its jolts and its seed. */
class SwayTest {

  private static final double FRAME = 0.04;
  private static final Sway.Settings WAVES_ONLY = new Sway.Settings(0.3, 0.5, 3, 0, 1, 0.4, 7);
  private static final Sway.Settings JOLTS_ONLY = new Sway.Settings(0, 0.5, 3, 6, 1, 0.4, 7);

  @Test
  @DisplayName("Criterion 23: the same settings and seed give the same offsets at the same times since the start; another seed does not")
  void seeded() {
    Sway a = new Sway(new Sway.Settings(0.3, 0.5, 3, 6, 1, 0.4, 7));
    Sway b = new Sway(new Sway.Settings(0.3, 0.5, 3, 6, 1, 0.4, 7));
    Sway otherSeed = new Sway(new Sway.Settings(0.3, 0.5, 3, 6, 1, 0.4, 8));
    boolean seedDiffers = false;
    for (int i = 0; i < 25 * 60; i++) {
      double t = i * FRAME;
      Sway.Offsets o = a.at(t);
      assertThat(b.at(t)).isEqualTo(o);
      seedDiffers |= !otherSeed.at(t).equals(o);
    }
    assertThat(seedDiffers).isTrue();
  }

  @Test
  @DisplayName("Criterion 24: without jolts the waves sway on all three axes, never further than the amplitude, and move a little between frames")
  void waves() {
    Sway sway = new Sway(WAVES_ONLY);
    double[] most = new double[3];
    double biggestStep = 0;
    Sway.Offsets before = sway.at(0);
    for (int i = 1; i < 25 * 120; i++) {
      Sway.Offsets o = sway.at(i * FRAME);
      double[] axes = {o.yaw(), o.pitch(), o.roll()};
      for (int a = 0; a < 3; a++) {
        assertThat(Math.abs(axes[a])).isLessThanOrEqualTo(0.3 + 1e-12);
        most[a] = Math.max(most[a], Math.abs(axes[a]));
      }
      biggestStep = Math.max(biggestStep, Math.abs(o.yaw() - before.yaw()));
      before = o;
    }
    for (double m : most) {
      assertThat(m).as("each axis sways a good part of the amplitude").isGreaterThan(0.1);
    }
    // 3 Hz at most: a frame moves the waves by at most 2π · 3 Hz · 0.3° · 0.04 s ≈ 0.23°
    assertThat(biggestStep).isLessThan(0.23).isGreaterThan(0);
  }

  @Test
  @DisplayName("One frequency gives waves with that period")
  void period() {
    Sway sway = new Sway(new Sway.Settings(0.5, 2, 2, 0, 0, 1, 3));
    for (int i = 0; i < 100; i++) {
      double t = i * 0.037;
      Sway.Offsets now = sway.at(t);
      Sway.Offsets later = new Sway(new Sway.Settings(0.5, 2, 2, 0, 0, 1, 3)).at(t + 0.5);
      assertThat(later.yaw()).isCloseTo(now.yaw(), within(1e-9));
      assertThat(later.pitch()).isCloseTo(now.pitch(), within(1e-9));
      assertThat(later.roll()).isCloseTo(now.roll(), within(1e-9));
    }
  }

  @Test
  @DisplayName("Criterion 24: over 10 minutes the jolts come about as often as set (±50 %), each a step of the strength")
  void jolts() {
    Sway sway = new Sway(JOLTS_ONLY);
    Set<Double> seen = new HashSet<>();
    double most = 0;
    for (int i = 0; i < 25 * 600; i++) {
      Sway.Offsets o = sway.at(i * FRAME);
      seen.addAll(sway.ringing());
      most = Math.max(most, Math.max(Math.abs(o.yaw()), Math.max(Math.abs(o.pitch()), Math.abs(o.roll()))));
    }
    assertThat(seen.size()).as("6 a minute for 10 minutes").isBetween(30, 90);
    assertThat(most).isGreaterThan(0.5).isLessThanOrEqualTo(3.0); // jolts may overlap
  }

  @Test
  @DisplayName("Criterion 24: a jolt is a step of its strength, down to 1/e after the decay and 1/e³ after three, and dropped after ten")
  void decay() {
    Sway.Settings rare = new Sway.Settings(0, 0.5, 3, 1, 1, 0.4, 11);
    Sway find = new Sway(rare);
    double first = Double.NaN;
    for (int i = 0; i < 25 * 300 && Double.isNaN(first); i++) {
      find.at(i * FRAME);
      if (!find.ringing().isEmpty()) {
        first = find.ringing().get(0);
      }
    }
    assertThat(first).isNotNaN();
    Sway sway = new Sway(rare);
    assertThat(length(sway.at(first))).isCloseTo(1, within(1e-9));
    assertThat(sway.ringing()).containsExactly(first);
    assertThat(length(sway.at(first + 0.4))).isCloseTo(Math.exp(-1), within(1e-9));
    assertThat(length(sway.at(first + 3 * 0.4))).isCloseTo(Math.exp(-3), within(1e-9));
    sway.at(first + 10 * 0.4 + 0.001);
    assertThat(sway.ringing()).doesNotContain(first);
  }

  private static double length(Sway.Offsets o) {
    return Math.sqrt(o.yaw() * o.yaw() + o.pitch() * o.pitch() + o.roll() * o.roll());
  }

  @Test
  @DisplayName("Criterion 23: amplitude and jolt strength 0, or no jolts: no sway")
  void none() {
    Sway sway = new Sway(new Sway.Settings(0, 0.5, 3, 0, 1, 0.4, 1));
    for (int i = 0; i < 1000; i++) {
      assertThat(sway.at(i * FRAME)).isEqualTo(new Sway.Offsets(0, 0, 0));
    }
    Sway noStrength = new Sway(new Sway.Settings(0, 0.5, 3, 60, 0, 0.4, 1));
    for (int i = 0; i < 1000; i++) {
      assertThat(noStrength.at(i * FRAME)).isEqualTo(new Sway.Offsets(0, 0, 0));
    }
  }

  @Test
  @DisplayName("A time before the last is taken as the last")
  void timeGoesOn() {
    Sway sway = new Sway(WAVES_ONLY);
    Sway.Offsets at10 = sway.at(10);
    assertThat(sway.at(9)).isEqualTo(at10);
  }

  @Test
  @DisplayName("Criterion 24: settings outside their range are refused")
  void refused() {
    assertThatThrownBy(() -> new Sway.Settings(-0.1, 0.5, 3, 0, 1, 0.4, 1)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Sway.Settings(0.3, 0, 3, 0, 1, 0.4, 1)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Sway.Settings(0.3, 3, 2, 0, 1, 0.4, 1)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Sway.Settings(0.3, 0.5, 3, -1, 1, 0.4, 1)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Sway.Settings(0.3, 0.5, 3, 0, 1, 0, 1)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Sway.Settings(Double.NaN, 0.5, 3, 0, 1, 0.4, 1)).isInstanceOf(IllegalArgumentException.class);
  }
}
