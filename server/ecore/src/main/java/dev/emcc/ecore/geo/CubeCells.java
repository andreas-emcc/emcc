package dev.emcc.ecore.geo;

import java.util.HashMap;
import java.util.Map;
import java.util.function.LongConsumer;
import org.jspecify.annotations.Nullable;

/**
 * The sphere divided into cells (spike S3): projected onto a cube, each face a grid of {@code
 * 2^level × 2^level} cells, with a tangent warp so that cells are of similar size. Level 6 has
 * cells of about 156 km. Cell ids are longs: {@code (face × size + i) × size + j}.
 *
 * <p>Not thread-safe (it caches the cells' caps): one per worker.
 */
public final class CubeCells {

  /** Cells per face edge at level 0 is 1; the deepest level an id holds comfortably. */
  public static final int MAX_LEVEL = 24;

  /** Up to this level the caps are kept in an array (98 304 cells at 7), deeper in a map. */
  private static final int ARRAY_LEVEL = 7;

  private final int level;
  private final int size;
  private final Map<Long, Cap> caps = new HashMap<>();
  /** Made at the first {@link #cap} (review F2): users that only find cells, such as AreaView, need none. */
  private @Nullable Cap @Nullable [] capArray;

  public CubeCells(int level) {
    if (level < 0 || level > MAX_LEVEL) {
      throw new IllegalArgumentException("a cube cell level is 0 to " + MAX_LEVEL + ", not " + level);
    }
    this.level = level;
    this.size = 1 << level;
  }

  /** The number of cells: ids are 0 to this less 1. */
  public long count() {
    return 6L * size * size;
  }

  public int level() {
    return level;
  }

  /**
   * The level whose cells are about {@code metres} across, at least 0 and at most {@link
   * #MAX_LEVEL}. A face edge is a quarter of a great circle.
   */
  public static int levelFor(double metres) {
    double faceEdge = Math.PI / 2 * Sphere.R;
    if (!(metres > 0)) {
      return MAX_LEVEL;
    }
    int level = (int) Math.round(Math.log(faceEdge / metres) / Math.log(2));
    return Math.max(0, Math.min(MAX_LEVEL, level));
  }

  /** The cell holding the unit vector (x, y, z). */
  public long cell(double x, double y, double z) {
    double ax = Math.abs(x);
    double ay = Math.abs(y);
    double az = Math.abs(z);
    int axis = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
    double major = axis == 0 ? x : axis == 1 ? y : z;
    int face = major >= 0 ? axis : axis + 3;
    double m = Math.abs(major);
    double u = (axis == 0 ? y : axis == 1 ? z : x) / m;
    double v = (axis == 0 ? z : axis == 1 ? x : y) / m;
    return ((long) face * size + index(u)) * size + index(v);
  }

  /** The cell holding the centre of {@code cap}. */
  public long cell(Cap cap) {
    return cell(cap.x(), cap.y(), cap.z());
  }

  private int index(double uv) {
    double s = (Math.atan(uv) * 4 / Math.PI + 1) / 2;
    return Math.min(size - 1, Math.max(0, (int) Math.floor(s * size)));
  }

  /** The unit vector at (s, t) of a face; s and t may go a little beyond [0, 1] onto the next face. */
  private double[] point(int face, double s, double t) {
    int axis = face % 3;
    double[] p = new double[3];
    p[axis] = face < 3 ? 1 : -1;
    p[(axis + 1) % 3] = Math.tan(Math.PI / 4 * (2 * s - 1));
    p[(axis + 2) % 3] = Math.tan(Math.PI / 4 * (2 * t - 1));
    return Sphere.normalize(p);
  }

  /** The cells touching this one: 8, or 7 at a cube corner. */
  public void neighbours(long cell, LongConsumer out) {
    int j = (int) (cell % size);
    int i = (int) (cell / size % size);
    int face = (int) (cell / size / size);
    for (int di = -1; di <= 1; di++) {
      for (int dj = -1; dj <= 1; dj++) {
        if (di == 0 && dj == 0) {
          continue;
        }
        int ni = i + di;
        int nj = j + dj;
        if (ni >= 0 && ni < size && nj >= 0 && nj < size) {
          out.accept(((long) face * size + ni) * size + nj);
        } else {
          double[] p = point(face, (ni + 0.5) / size, (nj + 0.5) / size);
          long n = cell(p[0], p[1], p[2]);
          if (n != cell) {
            out.accept(n);
          }
        }
      }
    }
  }

  /** A cap holding the whole cell. */
  public Cap cap(long cell) {
    if (level <= ARRAY_LEVEL) {
      @Nullable Cap[] array = capArray;
      if (array == null) {
        array = new Cap[6 * size * size];
        capArray = array;
      }
      Cap cap = array[(int) cell];
      if (cap == null) {
        cap = computeCap(cell);
        array[(int) cell] = cap;
      }
      return cap;
    }
    Cap cap = caps.get(cell);
    if (cap == null) {
      cap = computeCap(cell);
      caps.put(cell, cap);
    }
    return cap;
  }

  private Cap computeCap(long cell) {
    int j = (int) (cell % size);
    int i = (int) (cell / size % size);
    int face = (int) (cell / size / size);
    double s0 = (double) i / size;
    double s1 = (double) (i + 1) / size;
    double t0 = (double) j / size;
    double t1 = (double) (j + 1) / size;
    double[] centre = point(face, (s0 + s1) / 2, (t0 + t1) / 2);
    double r = 0;
    for (double[] corner : new double[][] {point(face, s0, t0), point(face, s1, t0), point(face, s0, t1), point(face, s1, t1)}) {
      r = Math.max(r, Sphere.angle(centre, corner));
    }
    return Cap.of(centre, r * 1.0001 + 1e-12);
  }
}
