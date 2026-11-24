package dev.emcc.plugins.fmv.out.render;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.fmv.out.Pose;
import dev.emcc.plugins.fmv.out.imagery.Imagery;
import dev.emcc.plugins.fmv.out.terrain.Terrain;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/** The data overlay (CR-0055; the fmv brief's function 27, criteria 38 to 41). */
class OverlayTest {

  private static Imagery imagery;

  @BeforeAll
  static void image() throws Exception {
    imagery = TestImages.imagery();
  }

  private static Pose pose(double lon, double lat, double heading, double azimuth, double depression, int width, int height) {
    return new Pose("0190d7a2-6c2b-7a10-8000-000000000001", Instant.parse("2026-11-26T09:15:30.250Z"),
        new Pose.Platform(lon, lat, 1000, heading, 0, 0, "Hawk 1"), new Pose.Pointing(azimuth, depression, 0), 20, 11.25, width, height, 25,
        "RECCE NORTH");
  }

  private static Overlay.Texts texts(Pose pose) {
    return Overlay.texts(pose, "UNCLASSIFIED", "Hawk 1", Renderer.centre(pose, new Terrain(), GroundFallback.SEA_LEVEL));
  }

  @Test
  void criterion39TheTextsNameEachHemisphereTheTrueBearingAndTheClassification() {
    // latitude ≠ longitude, south and east
    Overlay.Texts sydney = texts(pose(151.2, -33.9, 300, 90, 30, 1280, 720));
    assertThat(sydney.topCentre()).isEqualTo("UNCLASSIFIED");
    assertThat(sydney.topLeft()).containsExactly("2026-11-26 09:15:30.2Z", "Hawk 1", "RECCE NORTH");
    assertThat(sydney.bottomLeft()).containsExactly("33.90000 S 151.20000 E", "HGT 1000 m HAE", "HDG 300.0°");
    // heading 300°, azimuth 90°: a true bearing of 30°
    assertThat(sydney.bottomRight().getFirst()).isEqualTo("AZ 090.0° REL / 030.0° TRUE");
    assertThat(sydney.bottomRight()).contains("DEP 30.0°", "FOV 20.0°×11.3°");
    assertThat(sydney.bottomRight().get(3)).startsWith("CTR 33.").contains(" S 151.").endsWith(" E");
    assertThat(sydney.bottomRight().get(4)).matches("SLANT \\d+ m");
    // north and west
    assertThat(texts(pose(-70.25, 45.5, 0, 0, 30, 640, 360)).bottomLeft().getFirst()).isEqualTo("45.50000 N 70.25000 W");
    // looking up: the centre ray meets no ground
    assertThat(texts(pose(17.3, 62.4, 0, 0, -10, 640, 360)).bottomRight()).contains("no frame centre").noneMatch(l -> l.startsWith("CTR"));
    assertThat(Overlay.trueBearing(359.9, 0.1)).isZero();
    assertThat(Overlay.trueBearing(10, 355)).isEqualTo(5);
  }

  @Test
  void criterion38TheOverlayChangesItsAreasOnlyAndWithoutItTheFrameIsTodays() {
    Pose pose = TestImages.looking(TestImages.CROSS_LON, TestImages.CROSS_LAT, 0, 225, 2900, 700, 30, 1280, 720, 25);
    Renderer r = new Renderer(1280, 720);
    byte[] plain = new byte[r.pictureBytes()];
    r.render(pose, new Terrain(), GroundFallback.SEA_LEVEL, imagery, new Renderer.Options(true, true), plain);
    byte[] drawn = plain.clone();
    Overlay.Texts t = texts(pose);
    Overlay.draw(drawn, 1280, 720, t);
    assertThat(drawn).isNotEqualTo(plain);
    boolean[] inside = new boolean[1280 * 720];
    int s = Overlay.scale(720);
    List<int[]> at = Overlay.layout(t, 1280, 720);
    List<String> lines = Overlay.lines(t);
    for (int i = 0; i < at.size(); i++) {
      int w = (lines.get(i).length() * Glyphs.ADVANCE - 1) * s;
      for (int y = Math.max(0, at.get(i)[1] - 2); y < Math.min(720, at.get(i)[1] + Glyphs.HEIGHT * s + 2); y++) {
        for (int x = Math.max(0, at.get(i)[0] - 2); x < Math.min(1280, at.get(i)[0] + w + 2); x++) {
          inside[y * 1280 + x] = true;
        }
      }
    }
    for (int y = 0; y < 720; y++) {
      for (int x = 0; x < 1280; x++) {
        if (drawn[y * 1280 + x] != plain[y * 1280 + x]) {
          assertThat(inside[y * 1280 + x]).as("luma changed at %d, %d", x, y).isTrue();
        }
      }
    }
    int cb = 1280 * 720;
    for (int i = cb; i < plain.length; i++) {
      if (drawn[i] != plain[i]) {
        int k = (i - cb) % (640 * 360);
        int cx = k % 640;
        int cy = k / 640;
        assertThat(inside[2 * cy * 1280 + 2 * cx] || inside[(2 * cy + 1) * 1280 + 2 * cx + 1]).as("chroma changed at %d, %d", cx, cy).isTrue();
      }
    }
    // the texts sit in the corners and the top centre, clear of the middle
    assertThat(Arrays.copyOfRange(drawn, 360 * 1280, 361 * 1280)).isEqualTo(Arrays.copyOfRange(plain, 360 * 1280, 361 * 1280));
  }

  @Test
  void criterion40AGlyphIsDrawnAtItsPlaceAndScaleWhiteWithABlackOutlineOverNeutralChroma() {
    int[][] sizes = {{640, 360, 1}, {1280, 720, 2}, {1920, 1080, 3}};
    for (int[] size : sizes) {
      int w = size[0];
      int h = size[1];
      int s = size[2];
      assertThat(Overlay.scale(h)).isEqualTo(s);
      byte[] picture = new byte[w * h * 3 / 2];
      Arrays.fill(picture, 0, w * h, (byte) 120);
      Arrays.fill(picture, w * h, picture.length, (byte) 160); // a colour, so that the neutral chroma shows
      Overlay.Texts t = new Overlay.Texts("T", List.of(), List.of(), List.of());
      Overlay.draw(picture, w, h, t);
      int[] at = Overlay.layout(t, w, h).getFirst();
      int x = at[0];
      int y = at[1];
      assertThat(x).as("centred").isEqualTo((w - (Glyphs.WIDTH * s)) / 2);
      assertThat(y).isEqualTo(Overlay.MARGIN * s);
      // T's top bar: five font pixels, each s × s white
      for (int px = x; px < x + Glyphs.WIDTH * s; px++) {
        for (int py = y; py < y + s; py++) {
          assertThat(picture[py * w + px]).as("%d × %d at %d, %d", w, h, px, py).isEqualTo(Overlay.WHITE);
        }
      }
      // its stem, the middle column, down to the bottom row
      assertThat(picture[(y + (Glyphs.HEIGHT - 1) * s) * w + x + 2 * s]).isEqualTo(Overlay.WHITE);
      // a black outline one pixel round it, and the picture beyond it untouched
      assertThat(picture[(y - 1) * w + x]).isEqualTo(Overlay.BLACK);
      assertThat(picture[y * w + x - 1]).isEqualTo(Overlay.BLACK);
      assertThat(picture[(y + s) * w + x]).as("under the bar, beside the stem").isEqualTo(Overlay.BLACK);
      assertThat(picture[(y - 2) * w + x]).isEqualTo((byte) 120);
      // the chroma neutral under the glyph
      int c = w * h + (y / 2 + 1) * (w / 2) + (x / 2 + 1);
      assertThat(picture[c]).isEqualTo((byte) 128);
      assertThat(picture[c + (w / 2) * (h / 2)]).isEqualTo((byte) 128);
      assertThat(picture[w * h]).as("chroma away from it").isEqualTo((byte) 160);
    }
  }

  @Test
  void theGlyphsCoverPrintableAsciiAndTheDegreeAndTimesSigns() {
    for (char c = 32; c <= 126; c++) {
      for (int r = 0; r < Glyphs.HEIGHT; r++) {
        assertThat(Glyphs.row(c, r)).as("'%s' row %d", c, r).isBetween(0, 31);
      }
    }
    assertThat(glyph(' ')).as("the space is empty").containsOnly(0);
    // a few glyphs as drawn: T's bar and stem, the degree sign, the times sign
    assertThat(glyph('T')).containsExactly(31, 4, 4, 4, 4, 4, 4);
    assertThat(glyph('°')).containsExactly(12, 18, 18, 12, 0, 0, 0);
    assertThat(glyph('×')).containsExactly(0, 17, 10, 4, 10, 17, 0);
    assertThat(glyph('~')).containsExactly(0, 0, 8, 21, 2, 0, 0); // the last of the table
    assertThat(glyph('☃')).as("any other character: a box").containsExactly(31, 17, 17, 17, 17, 17, 31);
    // every printable character is told apart from every other
    for (char a = 32; a <= 126; a++) {
      for (char b = (char) (a + 1); b <= 126; b++) {
        assertThat(glyph(a)).as("%s and %s", a, b).isNotEqualTo(glyph(b));
      }
    }
  }

  private static int[] glyph(char c) {
    int[] rows = new int[Glyphs.HEIGHT];
    for (int r = 0; r < rows.length; r++) {
      rows[r] = Glyphs.row(c, r);
    }
    return rows;
  }

  @Test
  void criterion41TheOverlayCostsAtMostOneMillisecondAFrameAt1280x720() {
    Pose pose = pose(17.3, 62.4, 45, 90, 30, 1280, 720);
    byte[] picture = new byte[1280 * 720 * 3 / 2];
    for (int i = 0; i < 200; i++) { // warm up
      Overlay.draw(picture, 1280, 720, texts(pose));
    }
    long[] took = new long[101];
    for (int i = 0; i < took.length; i++) {
      long t = System.nanoTime();
      Overlay.draw(picture, 1280, 720, texts(pose));
      took[i] = System.nanoTime() - t;
    }
    Arrays.sort(took);
    // the best of 101, so that a machine busy with other work does not fail it (measured: a median of 0.18 ms)
    assertThat(took[0]).as("best ns, median %d ns", took[took.length / 2]).isLessThan(1_000_000L);
  }

  @Test
  void aLongClassificationNameIsDrawnWholeAndTheTopLeftLinesGoBelowIt() {
    String longName = "NATO SECRET RELEASABLE TO THE COALITION OF THE WILLING ONLY ABCD"; // 64 characters, the most a name has
    assertThat(longName).hasSize(64);
    Overlay.Texts t = new Overlay.Texts(longName, List.of("2026-11-26 09:15:30.2Z", "Hawk 1"), List.of(), List.of());
    List<int[]> at = Overlay.layout(t, 640, 360);
    assertThat(at.getFirst()[2]).as("the whole name").isEqualTo(longName.length());
    assertThat(at.get(1)[1]).as("the time's line, below the name's").isEqualTo(at.getFirst()[1] + Overlay.LINE);
    // a short one leaves them beside it
    List<int[]> beside = Overlay.layout(new Overlay.Texts("UNCLASSIFIED", t.topLeft(), List.of(), List.of()), 640, 360);
    assertThat(beside.get(1)[1]).isEqualTo(beside.getFirst()[1]);
  }
}
