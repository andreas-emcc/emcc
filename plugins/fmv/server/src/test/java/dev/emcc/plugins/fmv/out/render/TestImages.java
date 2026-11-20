package dev.emcc.plugins.fmv.out.render;

import dev.emcc.plugins.fmv.out.Pose;
import dev.emcc.plugins.fmv.out.geo.LocalFrame;
import dev.emcc.plugins.fmv.out.imagery.Imagery;
import dev.emcc.plugins.fmv.out.imagery.ImagerySet;
import dev.emcc.plugins.fmv.out.imagery.TilePicture;
import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.model.Position;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.time.Instant;
import java.util.List;
import javax.imageio.ImageIO;

/**
 * Spike S10's synthetic test image, in EPSG:4326: a 50 m checkerboard (grey 90 and 150) with white
 * lines every 500 m, a red east–west line and a blue north–south line crossing at Sundsvall's centre
 * (62.3908° N, 17.3069° E), 8 km square; and poses that look at a point.
 */
final class TestImages {

  static final double CROSS_LON = 17.3069;
  static final double CROSS_LAT = 62.3908;
  static final int PIXELS = 2000;
  static final double HALF_LAT = 4000 / 111_200.0;
  static final double HALF_LON = 4000 / (111_320.0 * Math.cos(Math.toRadians(CROSS_LAT)));

  private TestImages() {}

  /** The test image as a PNG file's bytes. */
  static byte[] png() throws Exception {
    BufferedImage im = new BufferedImage(PIXELS, PIXELS, BufferedImage.TYPE_INT_RGB);
    double mLat = 2 * HALF_LAT * 111_200 / PIXELS; // metres a pixel, about 4
    for (int row = 0; row < PIXELS; row++) {
      double lat = CROSS_LAT + HALF_LAT - (row + 0.5) * 2 * HALF_LAT / PIXELS;
      double north = (lat - CROSS_LAT) * 111_200;
      for (int col = 0; col < PIXELS; col++) {
        double lon = CROSS_LON - HALF_LON + (col + 0.5) * 2 * HALF_LON / PIXELS;
        double east = (lon - CROSS_LON) * 111_320 * Math.cos(Math.toRadians(CROSS_LAT));
        int rgb;
        if (Math.abs(north) < 6) {
          rgb = 0xFF2020;
        } else if (Math.abs(east) < 6) {
          rgb = 0x2020FF;
        } else if (Math.abs(Math.IEEEremainder(north, 500)) < mLat || Math.abs(Math.IEEEremainder(east, 500)) < mLat) {
          rgb = 0xFFFFFF;
        } else {
          boolean odd = (Math.floorDiv((long) Math.floor(north), 50) + Math.floorDiv((long) Math.floor(east), 50)) % 2 != 0;
          rgb = odd ? 0x969696 : 0x5A5A5A;
        }
        im.setRGB(col, row, rgb);
      }
    }
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    ImageIO.write(im, "png", out);
    return out.toByteArray();
  }

  /** The test image as a decoded set. */
  static Imagery imagery() throws Exception {
    ImagerySet.TileSpec spec = new ImagerySet.TileSpec("test.png", CROSS_LON - HALF_LON, CROSS_LAT - HALF_LAT, CROSS_LON + HALF_LON,
        CROSS_LAT + HALF_LAT, PIXELS, PIXELS);
    ImagerySet set = new ImagerySet("test", "S10 test image", "emcc tests", "CC0 1.0", ImagerySet.Crs.EPSG_4326, List.of(spec));
    Imagery imagery = new Imagery(set);
    imagery.add(spec, TilePicture.decode(png(), PIXELS, PIXELS));
    return imagery;
  }

  /**
   * A pose at {@code height} m HAE, {@code distance} m from a ground point at {@code bearingFrom}
   * (from the point to the camera), heading {@code heading}, aimed at the point (height {@code
   * groundHeight}) by the ECEF line, as {@code uav-simulation}'s "track a point" aims.
   */
  static Pose looking(double lon, double lat, double groundHeight, double bearingFrom, double distance, double height, double heading,
      int width, int frameHeight, double hFov) {
    Position cam = Geodesy.direct(Position.of(lon, lat), bearingFrom, distance);
    LocalFrame f = new LocalFrame(cam.longitude(), cam.latitude(), height);
    double[] enu = new double[3];
    f.toEnu(lon, lat, groundHeight, enu);
    double az = Math.toDegrees(Math.atan2(enu[0], enu[1]));
    double dep = Math.toDegrees(Math.atan2(-enu[2], Math.hypot(enu[0], enu[1])));
    double relative = ((az - heading) % 360 + 360) % 360;
    double vFov = Math.toDegrees(2 * Math.atan(Math.tan(Math.toRadians(hFov) / 2) * frameHeight / width));
    return new Pose("0190d7a2-6c2b-7a10-8000-000000000001", Instant.parse("2026-11-17T10:00:00Z"),
        new Pose.Platform(cam.longitude(), cam.latitude(), height, heading, 0, 0, "Hawk 1"), new Pose.Pointing(relative, dep, 0), hFov, vFov,
        width, frameHeight, 25, "Test");
  }
}
