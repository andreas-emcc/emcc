package dev.emcc.plugins.fmv.out.render;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.plugins.fmv.out.Pose;
import dev.emcc.plugins.fmv.out.geo.Sweref99Tm;
import dev.emcc.plugins.fmv.out.imagery.Imagery;
import dev.emcc.plugins.fmv.out.imagery.ImagerySet;
import dev.emcc.plugins.fmv.out.imagery.TilePicture;
import dev.emcc.plugins.fmv.out.terrain.DtedCell;
import dev.emcc.plugins.fmv.out.terrain.DtedFiles;
import dev.emcc.plugins.fmv.out.terrain.Terrain;
import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.model.Position;
import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.util.List;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;

/** The renderer and the frame centre (brief section 10.5 point 15; criteria 29 and 30). */
class RendererTest {

  private static Imagery imagery;

  @BeforeAll
  static void image() throws Exception {
    imagery = TestImages.imagery();
  }

  private static Pose pose(double heading, double pitch, double roll, double azimuth, double depression) {
    return new Pose("0190d7a2-6c2b-7a10-8000-000000000001", Instant.parse("2026-11-17T10:00:00Z"),
        new Pose.Platform(17.3, 62.4, 1000, heading, pitch, roll, null), new Pose.Pointing(azimuth, depression, 0), 20, 11.33, 1280, 720, 25,
        null);
  }

  @Test
  void theCameraTurnsWithThePlatformAndTheGimbal() {
    Camera c = new Camera(pose(45, 0, 0, 90, 30));
    assertThat(c.bearing()).isCloseTo(135, within(1e-9));
    assertThat(c.depression()).isCloseTo(30, within(1e-9));
    // pitched up 10°, looking ahead level: 10° above the horizontal
    assertThat(new Camera(pose(0, 10, 0, 0, 0)).depression()).isCloseTo(-10, within(1e-9));
    // right wing 90° down, the camera looking right: straight down
    assertThat(new Camera(pose(0, 0, 90, 90, 0)).depression()).isCloseTo(90, within(1e-9));
    // the picture's right is to the right of forward, its up above it
    Camera level = new Camera(pose(0, 0, 0, 0, 30));
    assertThat(level.right[0]).isCloseTo(1, within(1e-9));
    assertThat(level.up[2]).isGreaterThan(0.8);
  }

  @Test
  void criterion29TheRedAndBlueLinesCrossAtTheFramesCentre() {
    Pose pose = TestImages.looking(TestImages.CROSS_LON, TestImages.CROSS_LAT, 0, 225, 2900, 700, 30, 1280, 720, 25);
    Renderer r = new Renderer(1280, 720);
    byte[] out = new byte[r.pictureBytes()];
    int missing = r.render(pose, new Terrain(), GroundFallback.SEA_LEVEL, imagery, new Renderer.Options(true, true), out);
    assertThat(missing).isZero();

    // The test image draws red over blue where they cross, so each line is found away from the
    // crossing, on two columns (rows) placed evenly round the centre: the lines are straight in the
    // picture, so the mean of the two finds is where the line crosses the centre column (row).
    // Chroma sample x covers pixels 2x and 2x + 1, its centre at pixel 2x + 1.
    double redLeft = line(out, true, 300);
    double redRight = line(out, true, 339);
    double blueTop = line(out, false, 160);
    double blueBottom = line(out, false, 199);
    assertThat((redLeft + redRight) / 2).isCloseTo(360, within(2.0));
    assertThat((blueTop + blueBottom) / 2).isCloseTo(640, within(2.0));
    // the top of the frame is sky only if the horizon is in view: at 700 m and 13.6° down with 7.1° half-height, it is not
    assertThat(out[0] & 0xFF).isNotEqualTo(Renderer.SKY_Y);
  }

  /**
   * Where a line lies in a 1280 × 720 picture, in pixels: the red one down a chroma column (its row),
   * the blue one along a chroma row (its column), as the centroid of the chroma's excess over 20.
   */
  private static double line(byte[] out, boolean red, int at) {
    int cw = 640;
    int ch = 360;
    int cbAt = 1280 * 720;
    int crAt = cbAt + cw * ch;
    double sum = 0;
    double weight = 0;
    int n = red ? ch : cw;
    for (int i = 0; i < n; i++) {
      int k = red ? i * cw + at : at * cw + i;
      int cb = out[cbAt + k] & 0xFF;
      int cr = out[crAt + k] & 0xFF;
      double w = Math.max(0, (red ? cr - cb : cb - cr) - 20);
      sum += w * (2 * i + 1);
      weight += w;
    }
    assertThat(weight).as(red ? "the red line" : "the blue line").isPositive();
    return sum / weight;
  }

  @Test
  void criterion30TheFrameCentreLiesOnTheLineOfSight() {
    Pose pose = TestImages.looking(TestImages.CROSS_LON, TestImages.CROSS_LAT, 0, 225, 2900, 700, 30, 1280, 720, 25);
    Renderer.FrameCentre c = Renderer.centre(pose, new Terrain(), GroundFallback.SEA_LEVEL);
    assertThat(c).isNotNull();
    double miss = Geodesy.inverse(Position.of(c.lon(), c.lat()), Position.of(TestImages.CROSS_LON, TestImages.CROSS_LAT)).distanceMetres();
    assertThat(miss).isLessThan(0.5); // exact aim; the criterion allows 10 m
    assertThat(c.height()).isZero();
    double ground = Geodesy.inverse(Position.of(pose.platform().lon(), pose.platform().lat()), Position.of(c.lon(), c.lat())).distanceMetres();
    assertThat(c.slantRange()).isCloseTo(Math.hypot(ground, 700), within(15.0)); // the curvature's metre or so, and a flat-Earth hypotenuse
  }

  @Test
  void overTerrainTheCentreMeetsTheHillAndWithoutTerrainTheGroundIsTheFallbacks() throws Exception {
    Terrain hill = new Terrain();
    hill.put(DtedCell.parse(DtedFiles.cell(17, 62, 121, (i, j) -> 136)));
    Pose pose = TestImages.looking(TestImages.CROSS_LON, TestImages.CROSS_LAT, 136, 225, 2900, 836, 30, 1280, 720, 25);
    Renderer.FrameCentre c = Renderer.centre(pose, hill, GroundFallback.SEA_LEVEL);
    assertThat(c).isNotNull();
    assertThat(c.height()).isCloseTo(136, within(1e-6));
    assertThat(Geodesy.inverse(Position.of(c.lon(), c.lat()), Position.of(TestImages.CROSS_LON, TestImages.CROSS_LAT)).distanceMetres()).isLessThan(0.5);
    // the same pose with no terrain: the ground is flat at the fallback's 0 m, so the centre falls far beyond
    Renderer.FrameCentre flat = Renderer.centre(pose, new Terrain(), GroundFallback.SEA_LEVEL);
    assertThat(flat).isNotNull();
    assertThat(flat.height()).isZero();
    assertThat(flat.slantRange()).isGreaterThan(c.slantRange() + 500);
  }

  @Test
  void withoutImageryTheGroundIsGreyAndCountedAndTheSkyIsSky() {
    Pose pose = TestImages.looking(TestImages.CROSS_LON, TestImages.CROSS_LAT, 0, 225, 2900, 700, 30, 640, 360, 25);
    Renderer r = new Renderer(640, 360);
    byte[] out = new byte[r.pictureBytes()];
    int missing = r.render(pose, new Terrain(), GroundFallback.SEA_LEVEL, null, new Renderer.Options(true, false), out);
    assertThat(missing).isEqualTo(640 * 360);
    assertThat(out[180 * 640 + 320] & 0xFF).isEqualTo(Imagery.GREY_LUMA);
    assertThat(out[640 * 360 + 90 * 320 + 160] & 0xFF).isEqualTo(Imagery.NEUTRAL_CHROMA);

    // looking level: the upper half is sky, the lower half ground
    Pose level = new Pose(pose.camera(), pose.time(), pose.platform(), new Pose.Pointing(pose.pointing().azimuth(), 0, 0), 25, 14.25, 640, 360, 25,
        null);
    missing = r.render(level, new Terrain(), GroundFallback.SEA_LEVEL, null, new Renderer.Options(true, false), out);
    assertThat(out[10 * 640 + 320] & 0xFF).isEqualTo(Renderer.SKY_Y);
    assertThat(out[350 * 640 + 320] & 0xFF).isEqualTo(Imagery.GREY_LUMA);
    assertThat(missing).isBetween(640 * 150, 640 * 180);
  }

  @Test
  void hazeLightensTheDistanceTowardsTheSky() {
    Pose pose = TestImages.looking(TestImages.CROSS_LON, TestImages.CROSS_LAT, 0, 225, 2900, 700, 30, 640, 360, 25);
    Renderer r = new Renderer(640, 360);
    byte[] clear = new byte[r.pictureBytes()];
    byte[] hazy = new byte[r.pictureBytes()];
    r.render(pose, new Terrain(), GroundFallback.SEA_LEVEL, null, new Renderer.Options(true, false), clear);
    r.render(pose, new Terrain(), GroundFallback.SEA_LEVEL, null, new Renderer.Options(true, true), hazy);
    // about 3 km away: 12 % of the way from grey (126) to the sky (177)
    int centre = 180 * 640 + 320;
    assertThat(hazy[centre] & 0xFF).isGreaterThan(clear[centre] & 0xFF).isCloseTo(126 + (int) (0.12 * 51), within(2));
  }

  /** A tile of one colour, decoded as the compute task decodes it. */
  private static TilePicture solid(Color colour) throws Exception {
    BufferedImage im = new BufferedImage(64, 64, BufferedImage.TYPE_INT_RGB);
    var g = im.createGraphics();
    g.setColor(colour);
    g.fillRect(0, 0, 64, 64);
    g.dispose();
    ByteArrayOutputStream png = new ByteArrayOutputStream();
    ImageIO.write(im, "png", png);
    return TilePicture.decode(png.toByteArray(), 64, 64);
  }

  @Test
  void f2WhereTheSetHasNoTileTheWmsTilesAreSampledInTheirOwnCrs() throws Exception {
    double lon = TestImages.CROSS_LON;
    double lat = TestImages.CROSS_LAT;
    // the set, in degrees: red, west of a meridian 0.8 m east of the camera, which falls inside the 8 × 8 cell right of the centre
    double edge = lon + 0.8 / (111_320 * Math.cos(Math.toRadians(lat)));
    ImagerySet.TileSpec west = new ImagerySet.TileSpec("west.png", lon - 0.05, lat - 0.05, edge, lat + 0.05, 64, 64);
    Imagery folder = new Imagery(new ImagerySet("west", "West", "emcc tests", "CC0-1.0", ImagerySet.Crs.EPSG_4326, List.of(west)));
    folder.add(west, solid(new Color(220, 30, 30)));
    // the WMS, in SWEREF 99 TM: blue, 5 km round
    double[] xy = new double[2];
    Sweref99Tm.forward(lon, lat, xy);
    ImagerySet.TileSpec all = new ImagerySet.TileSpec("wms-tile-cache.3006-80.0-0-0", xy[0] - 5000, xy[1] - 5000, xy[0] + 5000, xy[1] + 5000, 64, 64);
    Imagery wms = new Imagery(new ImagerySet("wms", "WMS", "", "", ImagerySet.Crs.EPSG_3006, List.of()));
    wms.add(all, solid(new Color(30, 30, 220)));

    // 700 m over the camera's point, looking north 80° down: the picture's left is west, its right east
    Pose pose = new Pose("0190d7a2-6c2b-7a10-8000-000000000001", Instant.parse("2026-11-17T10:00:00Z"),
        new Pose.Platform(lon, lat, 700, 0, 0, 0, null), new Pose.Pointing(0, 80, 0), 20, 11.33, 1280, 720, 25, null);
    Renderer r = new Renderer(1280, 720);
    byte[] out = new byte[r.pictureBytes()];
    Renderer.Options plain = new Renderer.Options(true, false);
    int red = Renderer.luma(220, 30, 30);
    int blue = Renderer.luma(30, 30, 220);
    int crAt = 1280 * 720 + 640 * 360;
    int cbAt = 1280 * 720;

    assertThat(r.render(pose, new Terrain(), GroundFallback.SEA_LEVEL, folder, wms, plain, out)).isZero();
    assertThat(out[360 * 1280 + 100] & 0xFF).isCloseTo(red, within(3));
    assertThat(out[360 * 1280 + 1180] & 0xFF).isCloseTo(blue, within(3));
    assertThat(out[crAt + 180 * 640 + 50] & 0xFF).isGreaterThan(200); // red's Cr
    assertThat(out[cbAt + 180 * 640 + 590] & 0xFF).isGreaterThan(200); // blue's Cb
    // the cell on the set's edge (pixels 640 to 647, the edge at about 644): the set wins where it has a tile, the WMS fills the rest
    assertThat(out[360 * 1280 + 641] & 0xFF).isCloseTo(red, within(3));
    assertThat(out[360 * 1280 + 646] & 0xFF).isCloseTo(blue, within(3));

    // without the WMS the east is grey and counted
    assertThat(r.render(pose, new Terrain(), GroundFallback.SEA_LEVEL, folder, null, plain, out)).isGreaterThan(1280 * 720 / 4);
    assertThat(out[360 * 1280 + 1180] & 0xFF).isEqualTo(Imagery.GREY_LUMA);

    // the WMS alone covers it all
    assertThat(r.render(pose, new Terrain(), GroundFallback.SEA_LEVEL, null, wms, plain, out)).isZero();
    assertThat(out[360 * 1280 + 100] & 0xFF).isCloseTo(blue, within(3));
  }
}
