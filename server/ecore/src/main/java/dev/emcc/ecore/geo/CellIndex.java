package dev.emcc.ecore.geo;

import java.util.Arrays;
import java.util.function.IntConsumer;
import java.util.function.IntFunction;
import java.util.function.LongConsumer;
import java.util.function.LongPredicate;
import org.jspecify.annotations.Nullable;

/**
 * The live picture's spatial index (spike S3, conclusion 2): cube cells at {@link #LEVEL} (about
 * 156 km), per cell the objects whose bound touches it, and one list for objects wider
 * than {@link #BIG_CELLS} cells, which every query tests. Objects are int handles; their bounds
 * come from the owner. A query floods the cells from the one under the area's inside point, keeps
 * those the area reaches, takes every object of a cell the area with its margin holds wholly
 * without testing it ({@link GeoArea#relation}), and tests the objects of the other cells. It
 * returns exactly what testing every object would.
 *
 * <p>Not thread-safe: owned by the object store's worker (overview 4.4: "a spatial index
 * maintained by the writer").
 */
public final class CellIndex {

  public static final int LEVEL = 6;
  /** Objects whose bound is wider than this many cells go to the list every query tests. */
  static final double BIG_CELLS = 4;

  private final CubeCells cells = new CubeCells(LEVEL);
  private final double bigRadius;
  /** Per cell id, the handles whose bound touches it, or null. */
  private final @Nullable IntList[] lists = new IntList[(int) cells.count()];
  /** Per cell id, the flood that last reached it: a flood marks cells without a set. */
  private final int[] reached = new int[(int) cells.count()];
  private int floods;
  /** The cells a flood has still to visit. */
  private final IntList pending = new IntList();
  private final IntList big = new IntList();
  /** Per handle, the query that last reported it: each object is reported once, without a set. */
  private int[] stamp = new int[1024];
  private int query;

  public CellIndex() {
    this.bigRadius = cells.cap(cells.cell(1, 0.3, 0.2)).radius() * BIG_CELLS;
  }

  /** Adds {@code handle} with its bound, or moves it from {@code old} to {@code cap}. */
  public void put(int handle, @Nullable Cap old, Cap cap) {
    if (old != null) {
      remove(handle, old);
    }
    if (cap.radius() > bigRadius) {
      big.add(handle);
    } else if (cap.radius() == 0) {
      listOf(cells.cell(cap)).add(handle);
    } else {
      cover(cap, cell -> listOf(cell).add(handle));
    }
  }

  /** Removes {@code handle}, which was added with the bound {@code old}. */
  public void remove(int handle, Cap old) {
    if (old.radius() > bigRadius) {
      big.remove(handle);
    } else if (old.radius() == 0) {
      removeFrom(cells.cell(old), handle);
    } else {
      cover(old, cell -> removeFrom(cell, handle));
    }
  }

  private IntList listOf(long cell) {
    IntList list = lists[(int) cell];
    if (list == null) {
      list = new IntList();
      lists[(int) cell] = list;
    }
    return list;
  }

  private void removeFrom(long cell, int handle) {
    IntList list = lists[(int) cell];
    if (list != null && list.remove(handle) && list.size() == 0) {
      lists[(int) cell] = null;
    }
  }

  /** Every cell whose cap meets {@code cap}. */
  private void cover(Cap cap, LongConsumer out) {
    flood(cells.cell(cap), c -> {
      if (!cells.cap(c).intersects(cap)) {
        return false;
      }
      out.accept(c);
      return true;
    });
  }

  /**
   * Visits the cells connected to {@code start}, each once: {@code visit} does its work and says
   * whether the flood goes on to the cell's neighbours. Not re-entrant: {@code visit}, and the
   * callbacks of {@link #query}, must not call {@link #put}, {@link #remove} or {@link #query}.
   */
  private void flood(long start, LongPredicate visit) {
    if (++floods == Integer.MAX_VALUE) {
      Arrays.fill(reached, 0);
      floods = 1;
    }
    int f = floods;
    pending.clear(); // a callback that threw left its flood's cells (review F3)
    reached[(int) start] = f;
    pending.add((int) start);
    while (pending.size() > 0) {
      long cell = pending.removeLast();
      if (!visit.test(cell)) {
        continue;
      }
      cells.neighbours(cell, n -> {
        if (reached[(int) n] != f) {
          reached[(int) n] = f;
          pending.add((int) n);
        }
      });
    }
  }

  /**
   * Reports every handle whose bound reaches into {@code area}, once each, in no particular order.
   *
   * @param bounds the bound of each handle in the index
   */
  public void query(GeoArea area, IntFunction<Cap> bounds, IntConsumer out) {
    if (++query == Integer.MAX_VALUE) {
      Arrays.fill(stamp, 0);
      query = 1;
    }
    int q = query;
    // Flood from the area's inside point: the area with its margin is connected and holds it. A
    // cell the area holds wholly gives all its objects without a test each.
    flood(cells.cell(area.insideX(), area.insideY(), area.insideZ()), cell -> {
      int relation = area.relation(cells.cap(cell));
      if (relation == GeoArea.OUTSIDE) {
        return false;
      }
      IntList list = lists[(int) cell];
      if (list == null) {
        return true;
      }
      boolean inner = relation == GeoArea.WHOLLY;
      for (int k = 0, n = list.size(); k < n; k++) {
        int h = list.get(k);
        if (seen(h, q)) {
          continue;
        }
        if (inner || area.matches(bounds.apply(h))) {
          stamp[h] = q;
          out.accept(h);
        }
      }
      return true;
    });
    for (int k = 0, n = big.size(); k < n; k++) {
      int h = big.get(k);
      if (!seen(h, q) && area.matches(bounds.apply(h))) {
        stamp[h] = q;
        out.accept(h);
      }
    }
  }

  private boolean seen(int handle, int q) {
    if (handle >= stamp.length) {
      stamp = Arrays.copyOf(stamp, Math.max(handle + 1, stamp.length * 2));
    }
    return stamp[handle] == q;
  }
}
