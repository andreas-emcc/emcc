package dev.emcc.plugins.fmv.out.render;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.plugins.fmv.out.Pose;
import dev.emcc.plugins.fmv.out.imagery.Imagery;
import dev.emcc.plugins.fmv.out.terrain.Terrain;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/** The degraded camera (F4, ADR-0066; owner, M9.2: haze and noise are settings). */
class DegraderTest {

  private static Imagery imagery;

  @BeforeAll
  static void image() throws Exception {
    imagery = TestImages.imagery();
  }

  private static Pose looking(int width, int height) {
    return TestImages.looking(TestImages.CROSS_LON, TestImages.CROSS_LAT, 0, 225, 2900, 700, 30, width, height, 25);
  }

  @Test
  void itDrawsAtHalfTheSizeInWholeGridCells() {
    assertThat(new Degrader(640, 360, 1)).satisfies(d -> {
      assertThat(d.drawnWidth()).isEqualTo(320);
      assertThat(d.drawnHeight()).isEqualTo(176);
    });
    assertThat(new Degrader(1280, 720, 1)).satisfies(d -> {
      assertThat(d.drawnWidth()).isEqualTo(640);
      assertThat(d.drawnHeight()).isEqualTo(360);
    });
    assertThat(new Degrader(1920, 1080, 1)).satisfies(d -> {
      assertThat(d.drawnWidth()).isEqualTo(960);
      assertThat(d.drawnHeight()).isEqualTo(536);
    });
  }

  @Test
  void withoutHazeOrNoiseItIsThePlainPictureSofterAndWithLessContrastAndColour() {
    Pose pose = looking(1280, 720);
    byte[] plain = new byte[1280 * 720 * 3 / 2];
    byte[] degraded = new byte[plain.length];
    new Renderer(1280, 720).render(pose, new Terrain(), GroundFallback.SEA_LEVEL, imagery, new Renderer.Options(true, false), plain);
    int missing = new Degrader(1280, 720, 1).render(pose, new Terrain(), GroundFallback.SEA_LEVEL, imagery, null, true, new Degrader.Settings(0, 0), degraded);
    assertThat(missing).isZero();

    // the same scene: the lines still cross at the centre, so the geometry is the frame's
    assertThat(mean(degraded, 0, 1280 * 720)).isCloseTo(Degrader.MID_LUMA + (mean(plain, 0, 1280 * 720) - Degrader.MID_LUMA) * Degrader.CONTRAST, within(2.0));
    // less contrast: the luma's spread shrinks to about 80 %
    assertThat(spread(degraded, 0, 1280 * 720)).isCloseTo(spread(plain, 0, 1280 * 720) * Degrader.CONTRAST, within(spread(plain, 0, 1280 * 720) * 0.1));
    // less colour: the chroma's spread round neutral shrinks to about 60 %
    int chroma = 1280 * 720;
    assertThat(deviation(degraded, chroma, plain.length, 128)).isLessThan(deviation(plain, chroma, plain.length, 128) * 0.7);
    // softer: neighbouring pixels differ less
    assertThat(roughness(degraded)).isLessThan(roughness(plain) * 0.8);
  }

  @Test
  void theGreyHazeGrowsWithDistanceAndTheSkyGoesTowardsTheGrey() {
    // looking level: the lower half is ground, nearer at the bottom, the upper half sky
    Pose level = new Pose("0190d7a2-6c2b-7a10-8000-000000000001", java.time.Instant.parse("2026-11-17T10:00:00Z"),
        new Pose.Platform(TestImages.CROSS_LON, TestImages.CROSS_LAT, 700, 0, 0, 0, null), new Pose.Pointing(0, 5, 0), 25, 14.25, 640, 360, 25, null);
    byte[] clear = new byte[640 * 360 * 3 / 2];
    byte[] hazy = new byte[clear.length];
    new Degrader(640, 360, 1).render(level, new Terrain(), GroundFallback.SEA_LEVEL, null, null, true, new Degrader.Settings(0, 0), clear);
    new Degrader(640, 360, 1).render(level, new Terrain(), GroundFallback.SEA_LEVEL, null, null, true, new Degrader.Settings(1, 0), hazy);
    int near = 350 * 640 + 320;
    int far = 200 * 640 + 320;
    int nearLift = (hazy[near] & 0xFF) - (clear[near] & 0xFF);
    int farLift = (hazy[far] & 0xFF) - (clear[far] & 0xFF);
    assertThat(nearLift).isPositive();
    assertThat(farLift).isGreaterThan(nearLift);
    // the sky at full strength is the haze's grey, less its contrast
    int sky = 10 * 640 + 320;
    assertThat(hazy[sky] & 0xFF).isCloseTo((int) Math.round(Degrader.MID_LUMA + (Renderer.GREY_Y - Degrader.MID_LUMA) * Degrader.CONTRAST), within(1));
  }

  @Test
  void theNoiseIsNewEveryFrameTheSameForTheSameSeedAndWithinItsSwing() {
    Pose pose = looking(640, 360);
    Degrader.Settings noisy = new Degrader.Settings(0, 1);
    byte[] quiet = new byte[640 * 360 * 3 / 2];
    new Degrader(640, 360, 7).render(pose, new Terrain(), GroundFallback.SEA_LEVEL, imagery, null, true, new Degrader.Settings(0, 0), quiet);
    Degrader d = new Degrader(640, 360, 7);
    byte[] first = new byte[quiet.length];
    byte[] second = new byte[quiet.length];
    d.render(pose, new Terrain(), GroundFallback.SEA_LEVEL, imagery, null, true, noisy, first);
    d.render(pose, new Terrain(), GroundFallback.SEA_LEVEL, imagery, null, true, noisy, second);
    assertThat(second).isNotEqualTo(first);
    byte[] again = new byte[quiet.length];
    new Degrader(640, 360, 7).render(pose, new Terrain(), GroundFallback.SEA_LEVEL, imagery, null, true, noisy, again);
    assertThat(again).isEqualTo(first);
    int most = 0;
    double sum = 0;
    for (int i = 0; i < 640 * 360; i++) {
      int dv = (first[i] & 0xFF) - (quiet[i] & 0xFF);
      most = Math.max(most, Math.abs(dv));
      sum += dv;
    }
    assertThat(most).isBetween(Degrader.NOISE_MAX / 2, Degrader.NOISE_MAX);
    assertThat(sum / (640 * 360)).isCloseTo(0, within(0.5)); // no brighter, no darker
  }

  @Test
  void itCostsLessThanThePlainRendererAt1280x720() {
    Pose pose = looking(1280, 720);
    Renderer plain = new Renderer(1280, 720);
    Degrader degraded = new Degrader(1280, 720, 1);
    byte[] out = new byte[plain.pictureBytes()];
    Renderer.Options options = new Renderer.Options(true, true);
    Degrader.Settings settings = new Degrader.Settings(0.5, 0.3);
    for (int i = 0; i < 10; i++) { // warm up
      plain.render(pose, new Terrain(), GroundFallback.SEA_LEVEL, imagery, options, out);
      degraded.render(pose, new Terrain(), GroundFallback.SEA_LEVEL, imagery, null, true, settings, out);
    }
    long[] p = new long[15];
    long[] d = new long[15];
    for (int i = 0; i < p.length; i++) {
      long t = System.nanoTime();
      plain.render(pose, new Terrain(), GroundFallback.SEA_LEVEL, imagery, options, out);
      p[i] = System.nanoTime() - t;
      t = System.nanoTime();
      degraded.render(pose, new Terrain(), GroundFallback.SEA_LEVEL, imagery, null, true, settings, out);
      d[i] = System.nanoTime() - t;
    }
    java.util.Arrays.sort(p);
    java.util.Arrays.sort(d);
    assertThat(d[d.length / 2]).as("median ns: degraded %d, plain %d", d[d.length / 2], p[p.length / 2]).isLessThan(p[p.length / 2]);
  }

  @Test
  void itRefusesSettingsOutOfRangeAndAPictureOfAnotherSize() {
    assertThatThrownBy(() -> new Degrader.Settings(1.5, 0)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Degrader.Settings(0, -0.1)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new Degrader(640, 360, 1).render(looking(640, 360), new Terrain(), GroundFallback.SEA_LEVEL, null, null, true,
        new Degrader.Settings(0, 0), new byte[10])).isInstanceOf(IllegalArgumentException.class);
  }

  private static double mean(byte[] b, int from, int to) {
    double s = 0;
    for (int i = from; i < to; i++) {
      s += b[i] & 0xFF;
    }
    return s / (to - from);
  }

  private static double spread(byte[] b, int from, int to) {
    return deviation(b, from, to, mean(b, from, to));
  }

  private static double deviation(byte[] b, int from, int to, double centre) {
    double s = 0;
    for (int i = from; i < to; i++) {
      double d = (b[i] & 0xFF) - centre;
      s += d * d;
    }
    return Math.sqrt(s / (to - from));
  }

  /** The mean difference between horizontal neighbours in the luma. */
  private static double roughness(byte[] b) {
    double s = 0;
    for (int y = 0; y < 720; y++) {
      for (int x = 1; x < 1280; x++) {
        s += Math.abs((b[y * 1280 + x] & 0xFF) - (b[y * 1280 + x - 1] & 0xFF));
      }
    }
    return s / (720 * 1279);
  }
}
