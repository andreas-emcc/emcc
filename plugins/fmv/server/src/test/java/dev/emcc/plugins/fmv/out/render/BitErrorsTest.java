package dev.emcc.plugins.fmv.out.render;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;

/** The bit errors drawn into the picture (F5; ADR-0066 point 2, drawn: owner, M9.2). */
class BitErrorsTest {

  private static final Instant START = Instant.parse("2026-11-26T09:00:00Z");
  private static final int W = 160; // small frames: the test keeps many
  private static final int H = 96;
  private static final double GOP = 25; // 25 frames a second, a keyframe every second

  private static final byte[][] PICTURES = new byte[4][];

  /** A picture that moves from frame to frame: one of four gradients in turn (not to be changed: callers clone it). */
  static byte[] picture(int i) {
    int k = Math.floorMod(i, PICTURES.length);
    if (PICTURES[k] == null) {
      PICTURES[k] = gradient(k);
    }
    return PICTURES[k];
  }

  private static byte[] gradient(int i) {
    byte[] p = new byte[W * H * 3 / 2];
    for (int y = 0; y < H; y++) {
      for (int x = 0; x < W; x++) {
        p[y * W + x] = (byte) (16 + Math.floorMod(x * 3 + y * 2 + i * 5, 220));
      }
    }
    for (int k = W * H; k < p.length; k++) {
      p[k] = (byte) (120 + Math.floorMod(k + i, 16));
    }
    return p;
  }

  /** One picture through the bit errors: its input, its output, what it got, and whether it was a keyframe. */
  record Step(byte[] in, byte @Nullable [] out, BitErrors.Hit hit, boolean keyframe, int damaged) {}

  static List<Step> run(BitErrors errors, int pictures) {
    return run(errors, pictures, true);
  }

  /** As above; without {@code keep} each step's output is not kept, only what it got. */
  static List<Step> run(BitErrors errors, int pictures, boolean keep) {
    List<Step> steps = new ArrayList<>();
    for (int i = 0; i < pictures; i++) {
      byte[] in = picture(i);
      byte[] out = in.clone();
      boolean key = BitErrors.keyframe(i, GOP);
      BitErrors.Hit hit = errors.apply(START.plusMillis(40L * i), out, W, H, key);
      errors.written(true, out);
      steps.add(new Step(in, keep ? out : null, hit, key, errors.damagedBlocks()));
    }
    return steps;
  }

  @Test
  void theKeyframesFallWhereEcoresEncoderForcesThem() {
    for (long i : new long[] {0, 25, 50, 75}) {
      assertThat(BitErrors.keyframe(i, 25)).as("picture %d", i).isTrue();
    }
    for (long i : new long[] {1, 24, 26, 49}) {
      assertThat(BitErrors.keyframe(i, 25)).as("picture %d", i).isFalse();
    }
    // 0.5 s at 25 frames a second: the first picture at or past 12.5, 25, 37.5
    for (long i : new long[] {0, 13, 25, 38}) {
      assertThat(BitErrors.keyframe(i, 12.5)).as("picture %d", i).isTrue();
    }
    for (long i : new long[] {12, 14, 26, 37}) {
      assertThat(BitErrors.keyframe(i, 12.5)).as("picture %d", i).isFalse();
    }
  }

  @Test
  void theSameSeedDrawsTheSameAndAnotherSeedOther() {
    List<Step> a = run(new BitErrors(new BitErrors.Settings(5, 1, 4, 7)), 25 * 40);
    List<Step> b = run(new BitErrors(new BitErrors.Settings(5, 1, 4, 7)), 25 * 40);
    List<Step> c = run(new BitErrors(new BitErrors.Settings(5, 1, 4, 8)), 25 * 40);
    boolean differ = false;
    boolean other = false;
    for (int i = 0; i < a.size(); i++) {
      assertThat(a.get(i).out()).isEqualTo(b.get(i).out());
      differ |= !Arrays.equals(a.get(i).out(), a.get(i).in());
      other |= !Arrays.equals(a.get(i).out(), c.get(i).out());
    }
    assertThat(differ).as("something was drawn").isTrue();
    assertThat(other).as("another seed draws otherwise").isTrue();
  }

  @Test
  void eventsComeEvery15GiveOrTake3SecondsAndNeverBeginOnAKeyframe() {
    List<Step> steps = run(new BitErrors(new BitErrors.Settings(15, 3, 3, 1)), 25 * 600, false);
    List<Integer> events = new ArrayList<>();
    for (int i = 0; i < steps.size(); i++) {
      if (steps.get(i).hit().event()) {
        events.add(i);
        assertThat(steps.get(i).keyframe()).isFalse();
      }
    }
    assertThat(events).hasSizeBetween(600 / 18, 600 / 12);
    boolean early = false;
    boolean late = false;
    for (int k = 1; k < events.size(); k++) {
      Duration gap = Duration.ofMillis(40L * (events.get(k) - events.get(k - 1)));
      assertThat(gap).isBetween(Duration.ofMillis(11_960), Duration.ofMillis(18_080)); // a keyframe may push one picture on
      early |= gap.toMillis() < 14_000;
      late |= gap.toMillis() > 16_000;
    }
    assertThat(early && late).as("the jitter spreads the events").isTrue();
  }

  @Test
  void onlyTheDamagedBlocksChangeAndTheNextKeyframeClearsThemAll() {
    List<Step> steps = run(new BitErrors(new BitErrors.Settings(3, 1, 5, 3)), 25 * 60);
    int damagedPictures = 0;
    for (int i = 0; i < steps.size(); i++) {
      Step s = steps.get(i);
      if (s.keyframe()) {
        assertThat(s.out()).as("keyframe %d is clean", i).isEqualTo(s.in());
        assertThat(s.damaged()).isZero();
        continue;
      }
      int changed = changedBlocks(s.in(), s.out());
      assertThat(changed).as("picture %d", i).isLessThanOrEqualTo(s.damaged());
      if (s.damaged() > 0) {
        damagedPictures++;
      }
    }
    assertThat(damagedPictures).isGreaterThan(30);
    // and the damage lasts: from an event to the next keyframe, every picture is damaged
    for (int i = 0; i < steps.size(); i++) {
      if (steps.get(i).hit().blocks() > 0) {
        for (int j = i; j < steps.size() && !steps.get(j).keyframe(); j++) {
          assertThat(steps.get(j).damaged()).as("picture %d after the event at %d", j, i).isPositive();
        }
      }
    }
  }

  @Test
  void someRunsAreFlatGreenAndTheOthersComeFromTheLastPicture() {
    List<Step> steps = run(new BitErrors(new BitErrors.Settings(2, 0.5, 3, 5)), 25 * 120);
    int green = 0;
    int moved = 0;
    int cbAt = W * H;
    int crAt = cbAt + W / 2 * (H / 2);
    for (Step s : steps) {
      if (s.hit().blocks() == 0) {
        continue;
      }
      for (int b = 0; b < (W / 16) * ((H + 15) / 16); b++) {
        int cx = b % (W / 16) * 8 + 2;
        int cy = b / (W / 16) * 8 + 2;
        if (cy >= H / 2) {
          continue;
        }
        int ci = cy * (W / 2) + cx;
        if ((s.out()[cbAt + ci] & 0xFF) == 80 && (s.out()[crAt + ci] & 0xFF) == 72) {
          green++;
        } else if (s.out()[cbAt + ci] != s.in()[cbAt + ci]) {
          moved++;
        }
      }
    }
    assertThat(green).as("flat green blocks").isPositive();
    assertThat(moved).as("blocks from the last picture, displaced").isPositive();
  }

  @Test
  void aNewEncoderStartsClean() {
    BitErrors errors = new BitErrors(new BitErrors.Settings(2, 0, 10, 2));
    run(errors, 25 * 2 + 10); // an event at 2 s, damage in the pictures after it
    assertThat(errors.damagedBlocks()).isPositive();
    errors.encoderStarted();
    assertThat(errors.damagedBlocks()).isZero();
    byte[] in = picture(3);
    byte[] out = in.clone();
    errors.apply(START.plusSeconds(20), out, W, H, true);
    assertThat(out).isEqualTo(in);
  }

  @Test
  void itsSettingsHaveRanges() {
    assertThatThrownBy(() -> new BitErrors.Settings(1, 0, 3, 1)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new BitErrors.Settings(15, 15, 3, 1)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new BitErrors.Settings(15, 3, 0, 1)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new BitErrors.Settings(15, 3, 21, 1)).isInstanceOf(IllegalArgumentException.class);
  }

  /** The 16 × 16 blocks in which the luma or chroma differ. */
  private static int changedBlocks(byte[] a, byte[] b) {
    int across = W / 16;
    int down = (H + 15) / 16;
    boolean[] changed = new boolean[across * down];
    for (int y = 0; y < H; y++) {
      for (int x = 0; x < W; x++) {
        if (a[y * W + x] != b[y * W + x]) {
          changed[y / 16 * across + x / 16] = true;
        }
      }
    }
    int cw = W / 2;
    for (int plane = 0; plane < 2; plane++) {
      int at = W * H + plane * cw * (H / 2);
      for (int y = 0; y < H / 2; y++) {
        for (int x = 0; x < cw; x++) {
          if (a[at + y * cw + x] != b[at + y * cw + x]) {
            changed[y / 8 * across + x / 8] = true;
          }
        }
      }
    }
    int n = 0;
    for (boolean c : changed) {
      if (c) {
        n++;
      }
    }
    return n;
  }
}
