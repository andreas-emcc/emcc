package dev.emcc.plugins.terrain;

import dev.emcc.sdk.json.JsonArray;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

/**
 * The height map in a circle (the brief's function 10, T-166): the ground inside a circle, divided
 * into {@value #BANDS} equal bands of height between its lowest and its highest point. The nodes are
 * the raster of the circle's bounding box, as a viewshed's are: the grid points of the data at the
 * centre's cell. A node is inside when its distance from the centre, on a sphere, is at most the
 * radius (within 0.5 % of the geodesic, which is enough for what is drawn and never measured).
 *
 * <p>Two passes over the nodes: the first finds the lowest and the highest ground, the second gives
 * each node its band, so that no height is kept, only a byte per node. Each band's nodes are then
 * traced into areas with holes ({@link AreaTracer}) and the bands are fitted to the overlay's caps
 * together ({@link Areas#fitBands}).
 */
final class HeightMap {

  /** How many equal bands the span is divided into (owner, Q53 A). */
  static final int BANDS = 16;

  private static final byte OUTSIDE = -1;

  private HeightMap() {}

  /**
   * A height to a micrometre. A node is a grid point of the data, whose height is a whole metre, but
   * the bilinear sample at a position computed from a longitude and a latitude is off by rounding
   * (109.9999999 for 110), which would put a node on the wrong side of a band's edge.
   */
  private static double snap(double height) {
    return Math.rint(height * 1e6) / 1e6;
  }

  /**
   * Computes a height map over {@code field}.
   *
   * @param params the circle: the centre, the radius as {@code rangeMetres}, and the raster's steps; the heights and the refraction are not used
   * @param budgetNanos the most time the computing may take; after it the outcome is {@code TIMED_OUT}
   */
  static MapComputed run(long requestId, HeightField field, Viewshed.Params params, long budgetNanos) {
    return run(requestId, field, params, budgetNanos, Areas.MAX_ITEMS, Areas.MAX_POSITIONS);
  }

  /** As {@link #run(long, HeightField, Viewshed.Params, long)}, with other caps for the areas (a test makes them small). */
  static MapComputed run(long requestId, HeightField field, Viewshed.Params params, long budgetNanos, int maxItems, int maxPositions) {
    long deadline = System.nanoTime() + Math.min(budgetNanos, Viewshed.MAX_COMPUTE_NANOS);
    int[] box = Viewshed.boundingBox(params);
    int i0 = box[0];
    int j0 = box[2];
    int width = box[1] - box[0] + 1;
    int height = box[3] - box[2] + 1;
    double lonStep = params.lonStepDeg();
    double latStep = params.latStepDeg();

    // the sphere test, with nothing but multiplications per node: a = sin²(dφ/2) + cos φ0 cos φ sin²(dλ/2)
    double phi0 = Math.toRadians(params.lat());
    double cos0 = Math.cos(phi0);
    double limit = Math.pow(Math.sin(params.rangeMetres() / (2 * Viewshed.EARTH_RADIUS)), 2);
    double[] sinLon = new double[width];
    for (int x = 0; x < width; x++) {
      sinLon[x] = Math.pow(Math.sin(Math.toRadians((i0 + x) * lonStep - params.lon()) / 2), 2);
    }

    // pass 1: the lowest and the highest ground, and whether some ground inside has no data
    double lowest = Double.POSITIVE_INFINITY;
    double highest = Double.NEGATIVE_INFINITY;
    int highestX = 0;
    int highestY = 0;
    boolean noData = false;
    long withData = 0;
    for (int y = 0; y < height; y++) {
      if (System.nanoTime() > deadline) {
        return MapComputed.of(requestId, MapComputed.Outcome.TIMED_OUT);
      }
      double lat = (j0 + y) * latStep;
      double sinLat = Math.pow(Math.sin(Math.toRadians(lat - params.lat()) / 2), 2);
      double cosLat = cos0 * Math.cos(Math.toRadians(lat));
      for (int x = 0; x < width; x++) {
        if (sinLat + cosLat * sinLon[x] > limit) {
          continue;
        }
        double h = snap(field.height((i0 + x) * lonStep, lat));
        if (Double.isNaN(h)) {
          noData = true;
          continue;
        }
        withData++;
        if (h < lowest) {
          lowest = h;
        }
        if (h > highest) {
          highest = h;
          highestX = x;
          highestY = y;
        }
      }
    }
    if (withData == 0) {
      return MapComputed.of(requestId, MapComputed.Outcome.NO_DATA);
    }

    // pass 2: each node's band
    int bands = highest > lowest ? BANDS : 1;
    double span = highest - lowest;
    byte[] band = new byte[Math.multiplyExact(width, height)];
    Arrays.fill(band, OUTSIDE);
    int[] counts = new int[bands];
    for (int y = 0; y < height; y++) {
      if (System.nanoTime() > deadline) {
        return MapComputed.of(requestId, MapComputed.Outcome.TIMED_OUT);
      }
      double lat = (j0 + y) * latStep;
      double sinLat = Math.pow(Math.sin(Math.toRadians(lat - params.lat()) / 2), 2);
      double cosLat = cos0 * Math.cos(Math.toRadians(lat));
      for (int x = 0; x < width; x++) {
        if (sinLat + cosLat * sinLon[x] > limit) {
          continue;
        }
        double h = snap(field.height((i0 + x) * lonStep, lat));
        if (Double.isNaN(h)) {
          continue;
        }
        int b =bands == 1 ? 0 : Math.min(bands - 1, (int) Math.floor((h - lowest) / span * bands));
        band[y * width + x] = (byte) b;
        counts[b]++;
      }
    }

    // the areas of each band, then all bands fitted to the overlay's caps together
    List<AreaTracer.Result> traced = new ArrayList<>(bands);
    for (int b = 0; b < bands; b++) {
      if (System.nanoTime() > deadline) {
        return MapComputed.of(requestId, MapComputed.Outcome.TIMED_OUT);
      }
      if (counts[b] == 0) {
        AreaTracer.Result empty = new AreaTracer.Result();
        traced.add(empty);
        continue;
      }
      byte wanted = (byte) b;
      traced.add(AreaTracer.trace(width, height, at -> band[at] == wanted));
    }
    Areas.FittedBands fitted = Areas.fitBands(traced, i0, j0, lonStep, latStep, maxItems, maxPositions);
    JsonArray highestPosition = Areas.position((i0 + highestX) * lonStep, (j0 + highestY) * latStep);
    return new MapComputed(requestId, MapComputed.Outcome.DONE, fitted.areas(), lowest, highest, highestPosition, fitted.simplified(), fitted.leftOut(), noData, fitted.positions());
  }
}
