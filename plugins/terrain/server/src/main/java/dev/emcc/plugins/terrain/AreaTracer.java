package dev.emcc.plugins.terrain;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.function.IntPredicate;

/**
 * Traces the visible cells of a raster into rings along their cell edges (ADR-0049 point 8).
 *
 * <p>A cell {@code (x, y)} is the square with corners {@code (x, y)} and {@code (x + 1, y + 1)} on the
 * vertex lattice. Every edge between a visible and a hidden cell (the raster's rim counts as hidden)
 * is walked with the visible cell on its left, so exterior rings run counter-clockwise and holes
 * clockwise. Cells that touch only at a corner are separate: at such a vertex the walk turns left,
 * round the cell it came along. Only the corners of a ring are kept. A hole's exterior is found by
 * walking west from the hole's western edge through visible cells to the first edge, whose ring is
 * the hole's exterior or another hole of the same exterior.
 */
final class AreaTracer {

  private static final int EAST = 0;
  private static final int NORTH = 1;
  private static final int WEST = 2;
  private static final int SOUTH = 3;

  /** The step in x of a direction. */
  private static int dx(int direction) {
    return direction == EAST ? 1 : direction == WEST ? -1 : 0;
  }

  /** The step in y of a direction. */
  private static int dy(int direction) {
    return direction == NORTH ? 1 : direction == SOUTH ? -1 : 0;
  }

  /** The traced rings, as vertex lattice corners {@code x0, y0, x1, y1, …} (not closed). */
  static final class Result {
    final List<int[]> rings = new ArrayList<>();
    /** Per ring: whether it is a hole. */
    final List<Boolean> holes = new ArrayList<>();
    /** Per ring: for a hole its exterior's index; for an exterior its own. */
    int[] exterior = new int[0];
  }

  private final int width;
  private final int height;
  private final IntPredicate visible; // x * ... see vis()
  private final long[] horizontalDone;
  private final int[] verticalRing; // ring id + 1 per vertical edge, 0 = not walked

  private AreaTracer(int width, int height, IntPredicate visible) {
    this.width = width;
    this.height = height;
    this.visible = visible;
    this.horizontalDone = new long[(int) (((long) width * (height + 1) + 63) / 64)];
    this.verticalRing = new int[Math.multiplyExact(width + 1, height)];
  }

  /** Traces the visible nodes of {@code raster}. */
  static Result trace(Viewshed.Raster raster) {
    int w = raster.width;
    return trace(w, raster.height, at -> (raster.state[at] & 1) != 0);
  }

  /** Traces a raster of {@code width x height} cells in which {@code visible.test(y * width + x)} says whether a cell is visible. */
  static Result trace(int width, int height, IntPredicate visible) {
    return new AreaTracer(width, height, visible).run();
  }

  private boolean vis(int x, int y) {
    return x >= 0 && x < width && y >= 0 && y < height && visible.test(y * width + x);
  }

  private Result run() {
    Result result = new Result();
    List<int[]> leftmost = new ArrayList<>(); // per ring: the leftmost vertical edge's x and y
    for (int y = 0; y < height; y++) {
      for (int x = 0; x < width; x++) {
        if (!vis(x, y)) {
          continue;
        }
        if (!vis(x, y - 1) && !horizontalWalked(x, y)) {
          walk(x, y, EAST, result, leftmost);
        }
        if (!vis(x + 1, y) && verticalRing[y * (width + 1) + x + 1] == 0) {
          walk(x + 1, y, NORTH, result, leftmost);
        }
        if (!vis(x, y + 1) && !horizontalWalked(x, y + 1)) {
          walk(x + 1, y + 1, WEST, result, leftmost);
        }
        if (!vis(x - 1, y) && verticalRing[y * (width + 1) + x] == 0) {
          walk(x, y + 1, SOUTH, result, leftmost);
        }
      }
    }
    int rings = result.rings.size();
    result.exterior = new int[rings];
    Arrays.fill(result.exterior, -1);
    for (int r = 0; r < rings; r++) {
      if (!result.holes.get(r)) {
        result.exterior[r] = r;
      }
    }
    for (int r = 0; r < rings; r++) {
      resolve(r, result, leftmost);
    }
    return result;
  }

  /** The exterior of ring {@code r}: itself, or by the walk west from a hole's western edge, followed through the holes it meets. */
  private void resolve(int r, Result result, List<int[]> leftmost) {
    List<Integer> chain = new ArrayList<>();
    int at = r;
    while (result.exterior[at] < 0) {
      chain.add(at);
      int[] edge = leftmost.get(at);
      int x = edge[0] - 1; // the visible cell west of the hole's western edge (heading north)
      int y = edge[1];
      while (vis(x, y)) {
        x--;
      }
      // the edge between hidden cell x and visible cell x + 1 heads south and belongs to a ring of the same exterior
      at = verticalRing[y * (width + 1) + x + 1] - 1;
    }
    int exterior = result.exterior[at];
    for (int ring : chain) {
      result.exterior[ring] = exterior;
    }
  }

  private boolean horizontalWalked(int x, int y) {
    int at = y * width + x;
    return (horizontalDone[at >> 6] & (1L << (at & 63))) != 0;
  }

  private void markHorizontal(int x, int y) {
    int at = y * width + x;
    horizontalDone[at >> 6] |= 1L << (at & 63);
  }

  /** Walks the ring that starts with the edge from vertex {@code (sx, sy)} in direction {@code sh}. */
  private void walk(int sx, int sy, int sh, Result result, List<int[]> leftmost) {
    int id = result.rings.size();
    int[] corners = new int[16];
    int count = 0;
    long twiceArea = 0;
    int minX = Integer.MAX_VALUE;
    int minY = 0;
    int x = sx;
    int y = sy;
    int h = sh;
    int previousX = 0;
    int previousY = 0;
    boolean first = true;
    int firstX = 0;
    int firstY = 0;
    do {
      switch (h) {
        case EAST -> markHorizontal(x, y);
        case WEST -> markHorizontal(x - 1, y);
        case NORTH -> {
          verticalRing[y * (width + 1) + x] = id + 1;
          if (x < minX) {
            minX = x;
            minY = y;
          }
        }
        default -> {
          verticalRing[(y - 1) * (width + 1) + x] = id + 1;
          if (x < minX) {
            minX = x;
            minY = y - 1;
          }
        }
      }
      x += dx(h);
      y += dy(h);
      int next = next(x, y, h);
      if (next != h) {
        if (count + 2 > corners.length) {
          corners = Arrays.copyOf(corners, corners.length * 2);
        }
        corners[count++] = x;
        corners[count++] = y;
        if (first) {
          firstX = x;
          firstY = y;
          first = false;
        } else {
          twiceArea += (long) previousX * y - (long) x * previousY;
        }
        previousX = x;
        previousY = y;
      }
      h = next;
    } while (!(x == sx && y == sy && h == sh));
    twiceArea += (long) previousX * firstY - (long) firstX * previousY;
    result.rings.add(Arrays.copyOf(corners, count));
    result.holes.add(twiceArea < 0);
    leftmost.add(new int[] {minX, minY});
  }

  /** The direction to take at vertex {@code (x, y)}, arrived at going {@code h}. */
  private int next(int x, int y, int h) {
    boolean left;
    boolean right;
    switch (h) {
      case EAST -> {
        left = vis(x, y);
        right = vis(x, y - 1);
      }
      case NORTH -> {
        left = vis(x - 1, y);
        right = vis(x, y);
      }
      case WEST -> {
        left = vis(x - 1, y - 1);
        right = vis(x - 1, y);
      }
      default -> {
        left = vis(x, y - 1);
        right = vis(x - 1, y - 1);
      }
    }
    if (left && !right) {
      return h;
    }
    if (left) {
      return (h + 3) & 3; // both ahead cells are visible: turn right
    }
    return (h + 1) & 3; // turn left, also where the visible cells only touch at the corner
  }
}
