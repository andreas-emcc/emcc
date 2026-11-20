package dev.emcc.plugins.terrain;

import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonValue;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import org.jspecify.annotations.Nullable;

/**
 * The visible areas of a result, as rings in longitude, latitude (ADR-0049 point 8): traced along
 * the cell edges, simplified to the data's cell size, and fitted to the overlay's caps, which are the
 * web SDK's {@code OVERLAY_MAX_ITEMS} (20 000) and {@code OVERLAY_MAX_POSITIONS} (200 000) less what
 * the panel adds to the same overlay: the circle of the range, the observer's point and the range
 * and bearing readout (the ACA's R4).
 */
final class Areas {

  /** The web SDK's {@code OVERLAY_MAX_ITEMS} less the panel's own items: the areas must stay under it. */
  static final int MAX_ITEMS = 20_000 - 100;

  /** The web SDK's {@code OVERLAY_MAX_POSITIONS} less the panel's own items: the circle (at most 721 positions) and the readout. */
  static final int MAX_POSITIONS = 200_000 - 2_000;

  /** The tolerance after which the smallest areas are left out instead: 512 cells is far past any useful outline. */
  private static final double GIVE_UP_TOLERANCE = 512;

  private Areas() {}

  /**
   * The areas of a result.
   *
   * @param areas one array per area, each an array of rings (the exterior first, then its holes), each ring an array of {@code [lon, lat]} closed
   * @param simplified how many times the tolerance was doubled to fit the caps; 0 when the first tolerance (one cell) fitted
   * @param leftOut how many of the smallest areas had to be left out, when even the largest tolerance did not fit; usually 0
   */
  record Fitted(JsonArray areas, int simplified, int leftOut, int positions) {}

  /**
   * Simplifies the traced rings with a tolerance of one cell, and with twice, four times and so on
   * that while the result does not fit the caps.
   *
   * @param i0 the raster's first longitude index
   * @param j0 the raster's first latitude index
   * @param lonStep the longitude step in degrees
   * @param latStep the latitude step in degrees
   */
  static Fitted fit(AreaTracer.Result traced, int i0, int j0, double lonStep, double latStep, int maxItems, int maxPositions) {
    Core core = fitCore(traced, maxItems, maxPositions);
    List<int @Nullable []> rings = core.rings();
    int positions = 0;
    List<JsonValue> areas = new ArrayList<>(core.pieces().size());
    for (Piece piece : core.pieces()) {
      positions += piece.positions(rings);
      areas.add(toArea(piece, rings, i0, j0, lonStep, latStep));
    }
    return new Fitted(new JsonArray(areas), core.doublings(), core.leftOut(), positions);
  }

  /**
   * The areas of a height map's bands (function 10), fitted to one set of caps together: the overlay
   * holds all the bands, so the tolerance doubles, and the smallest areas are left out, over all of them.
   *
   * @param bands one traced result per band, in the band order; an empty result for a band without ground
   * @param areas per band the areas as {@link #fit} gives them, in the band order
   */
  record FittedBands(List<JsonArray> areas, int simplified, int leftOut, int positions) {}

  /** As {@link #fit}, for the bands of a height map: the caps are shared by all of them. */
  static FittedBands fitBands(List<AreaTracer.Result> bands, int i0, int j0, double lonStep, double latStep, int maxItems, int maxPositions) {
    AreaTracer.Result combined = new AreaTracer.Result();
    List<Integer> bandOfRing = new ArrayList<>();
    int total = 0;
    for (AreaTracer.Result band : bands) {
      total += band.rings.size();
    }
    combined.exterior = new int[total];
    for (int b = 0; b < bands.size(); b++) {
      AreaTracer.Result band = bands.get(b);
      int offset = combined.rings.size();
      for (int r = 0; r < band.rings.size(); r++) {
        combined.rings.add(band.rings.get(r));
        combined.holes.add(band.holes.get(r));
        combined.exterior[offset + r] = offset + band.exterior[r];
        bandOfRing.add(b);
      }
    }
    Core core = fitCore(combined, maxItems, maxPositions);
    List<List<JsonValue>> perBand = new ArrayList<>();
    for (int b = 0; b < bands.size(); b++) {
      perBand.add(new ArrayList<>());
    }
    int positions = 0;
    for (Piece piece : core.pieces()) {
      positions += piece.positions(core.rings());
      perBand.get(bandOfRing.get(piece.exterior)).add(toArea(piece, core.rings(), i0, j0, lonStep, latStep));
    }
    List<JsonArray> areas = new ArrayList<>(bands.size());
    for (List<JsonValue> band : perBand) {
      areas.add(new JsonArray(band));
    }
    return new FittedBands(areas, core.doublings(), core.leftOut(), positions);
  }

  /** The simplified rings, the areas that survive, and what it took to fit the caps. */
  private record Core(List<int @Nullable []> rings, List<Piece> pieces, int doublings, int leftOut) {}

  private static Core fitCore(AreaTracer.Result traced, int maxItems, int maxPositions) {
    List<int @Nullable []> rings = new ArrayList<>();
    double tolerance = 1;
    for (int[] ring : traced.rings) {
      rings.add(simplify(ring, tolerance));
    }
    int doublings = 0;
    List<Piece> pieces = pieces(traced, rings);
    while (!fits(pieces, rings, maxItems, maxPositions) && tolerance < GIVE_UP_TOLERANCE) {
      tolerance *= 2;
      doublings++;
      for (int r = 0; r < rings.size(); r++) {
        int[] ring = rings.get(r);
        rings.set(r, ring == null ? null : simplify(ring, tolerance));
      }
      pieces = pieces(traced, rings);
    }
    int leftOut = 0;
    if (!fits(pieces, rings, maxItems, maxPositions)) {
      pieces.sort(Comparator.comparingDouble((Piece p) -> p.area).reversed());
      int items = 0;
      int positions = 0;
      List<Piece> kept = new ArrayList<>();
      for (Piece piece : pieces) {
        int cost = piece.positions(rings);
        if (items + 1 > maxItems || positions + cost > maxPositions) {
          leftOut++;
          continue;
        }
        items++;
        positions += cost;
        kept.add(piece);
      }
      pieces = kept;
    }
    return new Core(rings, pieces, doublings, leftOut);
  }

  /** One area as JSON: its exterior ring, then its holes. */
  private static JsonArray toArea(Piece piece, List<int @Nullable []> rings, int i0, int j0, double lonStep, double latStep) {
    List<JsonValue> ringValues = new ArrayList<>();
    ringValues.add(toJson(rings.get(piece.exterior), i0, j0, lonStep, latStep));
    for (int hole : piece.holes) {
      ringValues.add(toJson(rings.get(hole), i0, j0, lonStep, latStep));
    }
    return new JsonArray(ringValues);
  }

  /** One exterior ring with its holes. */
  private static final class Piece {
    final int exterior;
    final List<Integer> holes = new ArrayList<>();
    double area;

    Piece(int exterior) {
      this.exterior = exterior;
    }

    int positions(List<int @Nullable []> rings) {
      int total = rings.get(exterior).length / 2 + 1;
      for (int hole : holes) {
        total += rings.get(hole).length / 2 + 1;
      }
      return total;
    }
  }

  /** The areas whose exterior survived simplification, each with its surviving holes. */
  private static List<Piece> pieces(AreaTracer.Result traced, List<int @Nullable []> rings) {
    Piece[] byExterior = new Piece[rings.size()];
    List<Piece> pieces = new ArrayList<>();
    for (int r = 0; r < rings.size(); r++) {
      int[] ring = rings.get(r);
      if (ring != null && !traced.holes.get(r)) {
        Piece piece = new Piece(r);
        piece.area = Math.abs(twiceArea(ring)) / 2.0;
        byExterior[r] = piece;
        pieces.add(piece);
      }
    }
    for (int r = 0; r < rings.size(); r++) {
      if (rings.get(r) != null && traced.holes.get(r)) {
        Piece piece = byExterior[traced.exterior[r]];
        if (piece != null) {
          piece.holes.add(r);
        }
      }
    }
    return pieces;
  }

  private static boolean fits(List<Piece> pieces, List<int @Nullable []> rings, int maxItems, int maxPositions) {
    if (pieces.size() > maxItems) {
      return false;
    }
    long positions = 0;
    for (Piece piece : pieces) {
      positions += piece.positions(rings);
    }
    return positions <= maxPositions;
  }

  private static JsonArray toJson(int[] ring, int i0, int j0, double lonStep, double latStep) {
    List<JsonValue> positions = new ArrayList<>(ring.length / 2 + 1);
    for (int k = 0; k <= ring.length / 2; k++) {
      int v = k == ring.length / 2 ? 0 : k;
      double lon = (i0 + ring[2 * v] - 0.5) * lonStep;
      double lat = (j0 + ring[2 * v + 1] - 0.5) * latStep;
      positions.add(position(lon, lat));
    }
    return new JsonArray(positions);
  }

  /** A position as {@code [lon, lat]}, the longitude wrapped into -180 to 180, rounded to 1e-7 degrees (about a centimetre). */
  static JsonArray position(double lon, double lat) {
    double wrapped = lon;
    while (wrapped > 180) {
      wrapped -= 360;
    }
    while (wrapped < -180) {
      wrapped += 360;
    }
    double clamped = Math.max(-90, Math.min(90, lat));
    return new JsonArray(List.of(JsonNumber.of(Math.rint(wrapped * 1e7) / 1e7), JsonNumber.of(Math.rint(clamped * 1e7) / 1e7)));
  }

  /** Twice the signed area of a ring of corners {@code x0, y0, x1, y1, …}: positive counter-clockwise. */
  static long twiceArea(int[] ring) {
    int n = ring.length / 2;
    long sum = 0;
    for (int k = 0; k < n; k++) {
      int next = (k + 1) % n;
      sum += (long) ring[2 * k] * ring[2 * next + 1] - (long) ring[2 * next] * ring[2 * k + 1];
    }
    return sum;
  }

  /**
   * Douglas-Peucker on a closed ring of corners, with the vertices kept a subset of the original.
   * The ring is split at its first vertex and at the vertex farthest from it.
   *
   * @return the corners kept, or {@code null} when fewer than 3 are left
   */
  static int @Nullable [] simplify(int[] ring, double tolerance) {
    int n = ring.length / 2;
    if (n < 3) {
      return null;
    }
    int far = 0;
    double best = -1;
    for (int k = 1; k < n; k++) {
      double dx = ring[2 * k] - ring[0];
      double dy = ring[2 * k + 1] - ring[1];
      double d = dx * dx + dy * dy;
      if (d > best) {
        best = d;
        far = k;
      }
    }
    boolean[] keep = new boolean[n];
    keep[0] = true;
    keep[far] = true;
    chain(ring, n, 0, far, tolerance, keep);
    chain(ring, n, far, n, tolerance, keep);
    int count = 0;
    for (boolean k : keep) {
      if (k) {
        count++;
      }
    }
    if (count < 3) {
      return null;
    }
    int[] out = new int[count * 2];
    int at = 0;
    for (int k = 0; k < n; k++) {
      if (keep[k]) {
        out[at++] = ring[2 * k];
        out[at++] = ring[2 * k + 1];
      }
    }
    return out;
  }

  /** Douglas-Peucker between vertex {@code from} and vertex {@code to} (index {@code n} is vertex 0), iteratively. */
  private static void chain(int[] ring, int n, int from, int to, double tolerance, boolean[] keep) {
    int[] stack = new int[64];
    int top = 0;
    stack[top++] = from;
    stack[top++] = to;
    while (top > 0) {
      int hi = stack[--top];
      int lo = stack[--top];
      if (hi - lo < 2) {
        continue;
      }
      double ax = ring[2 * lo];
      double ay = ring[2 * lo + 1];
      int hv = hi % n;
      double bx = ring[2 * hv];
      double by = ring[2 * hv + 1];
      double worst = -1;
      int at = -1;
      for (int k = lo + 1; k < hi; k++) {
        double d = distanceToSegment(ring[2 * k], ring[2 * k + 1], ax, ay, bx, by);
        if (d > worst) {
          worst = d;
          at = k;
        }
      }
      if (worst > tolerance) {
        keep[at] = true;
        if (top + 4 > stack.length) {
          stack = java.util.Arrays.copyOf(stack, stack.length * 2);
        }
        stack[top++] = lo;
        stack[top++] = at;
        stack[top++] = at;
        stack[top++] = hi;
      }
    }
  }

  private static double distanceToSegment(double px, double py, double ax, double ay, double bx, double by) {
    double dx = bx - ax;
    double dy = by - ay;
    double length2 = dx * dx + dy * dy;
    double t = length2 == 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2));
    double qx = ax + t * dx - px;
    double qy = ay + t * dy - py;
    return Math.sqrt(qx * qx + qy * qy);
  }
}
