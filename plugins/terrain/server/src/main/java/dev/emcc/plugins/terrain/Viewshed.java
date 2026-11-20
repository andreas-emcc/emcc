package dev.emcc.plugins.terrain;

import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.model.Position;
import org.jspecify.annotations.Nullable;

/**
 * The line of sight (ADR-0049 points 3 and 5): which grid points an observer sees, on a raster of
 * longitude and latitude steps, by a radial sweep.
 *
 * <p>A target at distance d is visible when the straight line from the observer's eye (the ground
 * height at the observer plus the observer height) to the target's top (the ground height there
 * plus the target height) passes above every ground height between them. A height at distance d is
 * lowered by {@code d² / (2 R) · (1 - k)}, R = 6 371 000 m, k the refraction coefficient. Between the
 * samples of the height data the heights are bilinear.
 *
 * <p><b>The algorithm:</b> rays leave the observer at azimuths spaced so that two neighbouring rays
 * are at most half a cell apart at the maximum range. Along each ray the ground is sampled every half
 * cell; the largest elevation slope seen so far is the horizon, and a sample whose target-top slope
 * reaches it is visible. Every raster node takes the verdict of the sample nearest to it, over all
 * rays. That costs about {@code range² / cell²} samples, where testing each node's line separately
 * costs that times the number of samples on a line. The tests compare it with exactly that brute
 * force check (criterion 8).
 *
 * <p>The raster's nodes are the grid points of the data at the observer's latitude zone: node
 * {@code (i, j)} is at longitude {@code i · lonStep} and latitude {@code j · latStep}, so the
 * visible nodes trace to areas along cell edges, half a cell each side of a node.
 */
final class Viewshed {

  /** The earth's radius of the curvature term, metres (ADR-0049 point 5; the brief's function 4). */
  static final double EARTH_RADIUS = 6_371_000;

  /** The most time one sweep may run, whatever the request's timeout: the compute worker's budget is 60 s. */
  static final long MAX_COMPUTE_NANOS = 55_000_000_000L;

  /** How far apart the geodesic anchors of a ray are: between them the ray is linear in longitude and latitude. */
  private static final double ANCHOR_METRES = 2_000;

  private static final int UNSET = 127 << 1;
  private static final int MAX_DISTANCE_CODE = 126;

  private Viewshed() {}

  /**
   * What a sweep needs.
   *
   * @param lon the observer's longitude, -180 to 180
   * @param lat the observer's latitude
   * @param observerHeight metres above the ground
   * @param targetHeight metres above the ground
   * @param rangeMetres the maximum range
   * @param refraction the refraction coefficient k, 0 to 1
   * @param lonStepDeg the longitude step of the raster, degrees
   * @param latStepDeg the latitude step of the raster, degrees
   */
  record Params(double lon, double lat, double observerHeight, double targetHeight, double rangeMetres, double refraction, double lonStepDeg, double latStepDeg) {}

  /**
   * The raster of a sweep. Node {@code (i, j)} with {@code i0 <= i < i0 + width} is at longitude
   * {@code i · lonStep} (not wrapped: a raster across the antimeridian goes past 180) and latitude
   * {@code j · latStep}.
   */
  static final class Raster {
    final int i0;
    final int j0;
    final int width;
    final int height;
    /** Per node: bit 0 is the verdict, bits 1 to 7 how near the deciding sample was ({@code UNSET}: none reached it). */
    final byte[] state;
    boolean noData;

    Raster(int i0, int j0, int width, int height) {
      this.i0 = i0;
      this.j0 = j0;
      this.width = width;
      this.height = height;
      this.state = new byte[Math.multiplyExact(width, height)];
      java.util.Arrays.fill(state, (byte) UNSET);
    }

    /** Whether node {@code (x, y)} (from the raster's south-west corner) is visible. */
    boolean visible(int x, int y) {
      return (state[y * width + x] & 1) != 0;
    }

    private void update(int x, int y, int code, boolean visible) {
      int at = y * width + x;
      int held = (state[at] & 0xFF) >> 1;
      if (code < held) {
        state[at] = (byte) ((code << 1) | (visible ? 1 : 0));
      }
    }
  }

  /** The nodes that a range circle at the observer needs: its bounding box, a little padded. */
  static Raster allocate(Params p) {
    int[] box = boundingBox(p);
    return new Raster(box[0], box[2], box[1] - box[0] + 1, box[3] - box[2] + 1);
  }

  /** The number of raster nodes the range needs (the cap's measure), without allocating them. */
  static long nodesNeeded(Params p) {
    int[] box = boundingBox(p);
    return (long) (box[1] - box[0] + 1) * (box[3] - box[2] + 1);
  }

  /** The bounding box of the raster in degrees, {@code {west, east, south, north}}; the longitudes are not wrapped. */
  static double[] degreeBox(Params p) {
    int[] box = boundingBox(p);
    return new double[] {(box[0] - 0.5) * p.lonStepDeg(), (box[1] + 0.5) * p.lonStepDeg(), (box[2] - 0.5) * p.latStepDeg(), (box[3] + 0.5) * p.latStepDeg()};
  }

  /** The raster's node indices {@code {iMin, iMax, jMin, jMax}}; the height map uses the same raster. */
  static int[] boundingBox(Params p) {
    double dLat = p.rangeMetres() / 110_574.0;
    double maxLat = Math.min(89.999, Math.abs(p.lat()) + dLat);
    double dLon = Math.toDegrees(Math.asin(Math.min(1.0, Math.sin(p.rangeMetres() / 6_356_752.0) / Math.cos(Math.toRadians(maxLat)))));
    int iMin = (int) Math.floor((p.lon() - dLon) / p.lonStepDeg()) - 2;
    int iMax = (int) Math.ceil((p.lon() + dLon) / p.lonStepDeg()) + 2;
    int jMin = (int) Math.floor((p.lat() - dLat) / p.latStepDeg()) - 2;
    int jMax = (int) Math.ceil((p.lat() + dLat) / p.latStepDeg()) + 2;
    return new int[] {iMin, iMax, jMin, jMax};
  }

  /**
   * Sweeps the range round the observer.
   *
   * @param deadlineNanos {@code System.nanoTime()} after which the sweep gives up
   * @return the raster, or {@code null} when the deadline passed first
   * @throws IllegalArgumentException when the observer's ground has no height
   */
  static @Nullable Raster sweep(HeightField field, Params p, long deadlineNanos) {
    double ground = field.height(p.lon(), p.lat());
    if (Double.isNaN(ground)) {
      throw new IllegalArgumentException("no height data at the observer");
    }
    double eye = ground + p.observerHeight();
    Raster raster = allocate(p);

    double latM = Geodesy.inverse(Position.of(p.lon(), p.lat()), Position.of(p.lon(), p.lat() + p.latStepDeg())).distanceMetres();
    double lonM = Geodesy.inverse(Position.of(p.lon(), p.lat()), Position.of(wrap(p.lon() + p.lonStepDeg()), p.lat())).distanceMetres();
    double step = 0.5 * Math.min(latM, lonM);
    int steps = (int) Math.floor(p.rangeMetres() / step);
    int rays = Math.max(16, (int) Math.ceil(2 * Math.PI * p.rangeMetres() / (0.5 * step)));
    int perAnchor = Math.max(1, (int) Math.round(ANCHOR_METRES / step));
    double curvature = (1 - p.refraction()) / (2 * EARTH_RADIUS);
    Position observer = Position.of(p.lon(), p.lat());

    // the observer's own node
    int ox = (int) Math.rint(p.lon() / p.lonStepDeg()) - raster.i0;
    int oy = (int) Math.rint(p.lat() / p.latStepDeg()) - raster.j0;
    if (ox >= 0 && ox < raster.width && oy >= 0 && oy < raster.height) {
      raster.update(ox, oy, 0, true);
    }

    int anchors = steps / perAnchor + 2;
    double[] anchorLon = new double[anchors];
    double[] anchorLat = new double[anchors];
    for (int k = 0; k < rays; k++) {
      if ((k & 63) == 0 && System.nanoTime() > deadlineNanos) {
        return null;
      }
      double azimuth = 360.0 * k / rays;
      double previousLon = p.lon();
      for (int a = 0; a < anchors; a++) {
        double metres = (double) a * perAnchor * step;
        Position at = a == 0 ? observer : Geodesy.direct(observer, azimuth, metres);
        double lon = at.longitude();
        while (lon - previousLon > 180) {
          lon -= 360;
        }
        while (lon - previousLon < -180) {
          lon += 360;
        }
        anchorLon[a] = lon;
        anchorLat[a] = at.latitude();
        previousLon = lon;
      }
      double horizon = Double.NEGATIVE_INFINITY;
      for (int s = 1; s <= steps; s++) {
        int a = s / perAnchor;
        double t = (s - a * perAnchor) / (double) perAnchor;
        double lon = anchorLon[a] + (anchorLon[a + 1] - anchorLon[a]) * t;
        double lat = anchorLat[a] + (anchorLat[a + 1] - anchorLat[a]) * t;
        double fi = lon / p.lonStepDeg();
        double fj = lat / p.latStepDeg();
        int ni = (int) Math.rint(fi);
        int nj = (int) Math.rint(fj);
        int x = ni - raster.i0;
        int y = nj - raster.j0;
        if (x < 0 || x >= raster.width || y < 0 || y >= raster.height) {
          continue;
        }
        double dx = fi - ni;
        double dy = fj - nj;
        int code = Math.min(MAX_DISTANCE_CODE, (int) ((dx * dx + dy * dy) * 254));
        double height = field.height(lon, lat);
        if (Double.isNaN(height)) {
          raster.noData = true;
          raster.update(x, y, code, false);
          continue;
        }
        double distance = s * step;
        double lowered = height - distance * distance * curvature;
        boolean visible = (lowered + p.targetHeight() - eye) / distance >= horizon;
        raster.update(x, y, code, visible);
        double slope = (lowered - eye) / distance;
        if (slope > horizon) {
          horizon = slope;
        }
      }
    }
    return raster;
  }

  private static double wrap(double lon) {
    return lon > 180 ? lon - 360 : lon < -180 ? lon + 360 : lon;
  }
}
