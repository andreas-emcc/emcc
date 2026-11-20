package dev.emcc.plugins.simulator;

import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.geo.GeodesicLeg;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Position;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * A ground radar's dwells for one revisit (brief functions 37 and 44; CR-0040; the owner's Q1 and A1
 * to A3 of 2026-11-10 in PCA-simulator's session, Q55 B and Q56 A). Pure: the caller gives the chosen
 * targets, where every other track is and the revisit's random draw.
 *
 * <ul>
 *   <li><b>Dwells with targets</b> (A1): walking the targets clockwise from the search area's start,
 *       a dwell takes the next ones while they lie within the search width of its first one and it
 *       holds fewer than "most detections per dwell"; it is the search width wide and the dwell depth
 *       deep (never above the band's, A3), placed over its targets and kept inside the search area
 *       where it fits, and grows when its targets need more. So no setting makes it miss a target.
 *   <li><b>Empty dwells</b> (function 44, from M7; their number from T-196): enough to fill the revisit
 *       to {@link #perRevisit}, each a free place of the search area's {@link Grid}, spread evenly over
 *       the free places from the revisit's offset (M7-S3, M7-S4), so a revisit sweeps like a scanning
 *       radar; with fewer free places than empty dwells, places are taken again, still spread.
 *   <li><b>No dwell at all</b> (no free place and no targets): one empty dwell
 *       of the nominal size at the search area's start, or the first place clockwise with its centre in
 *       the job area (the owner's Q1, kept as the floor, 2026-11-12).
 *   <li><b>Order:</b> clockwise from the search area's start bearing, nearer first.
 *   <li><b>Systematic</b> (function 50, T-197, from M8): {@link #scan} gives a pass's cells and
 *       {@link #around} a found target's own dwell; {@code Sensors} interleaves them. The rest of this
 *       class is Random's.
 *   <li><b>A moving platform</b> (T-193): each dwell is sent round where the platform is at its tick
 *       ({@link Search#at}); in Random with the bearings planned at the revisit's start, and a dwell with
 *       targets is placed again over them from there ({@link #over}). Systematic turns with the platform
 *       instead: each dwell's bearings are taken from the heading at its tick (M9, owner YW).
 * </ul>
 */
final class Dwells {

  /**
   * Where a dwell lies: its bearings clockwise from the search area's start ({@code from} may be
   * below 0 or past the span when it grew), and its ranges in metres.
   */
  record Extent(double from, double width, double near, double far) {
    boolean allRound() {
      return width >= 360 - EPSILON;
    }

    /** Whether the position at {@code bearing} (from the search start) and {@code distance} lies in it. */
    boolean holds(double bearing, double distance) {
      return distance >= near - 0.5 && distance <= far + 0.5 && (allRound() || Detector.normal(bearing - from) <= width + EPSILON);
    }

    boolean overlaps(Extent o) {
      if (Math.min(far, o.far) - Math.max(near, o.near) <= 0.5) {
        return false;
      }
      if (allRound() || o.allRound()) {
        return true;
      }
      double off = Detector.normal(o.from - from);
      return off < width - EPSILON || off > 360 - o.width + EPSILON;
    }

    /** This extent grown to hold the position at {@code bearing} and {@code distance} (the dwell grows, function 37). */
    Extent cover(double bearing, double distance) {
      double n = Math.min(near, distance);
      double f = Math.max(far, distance);
      double fr = from;
      double w = width;
      if (!allRound()) {
        double off = Detector.normal(bearing - from);
        if (off > w + EPSILON) {
          double after = off - w;
          double before = 360 - off;
          if (after <= before) {
            w = off;
          } else {
            fr = from - before;
            w += before;
          }
        }
      }
      return new Extent(fr, Math.min(360, w), Math.max(0, n), f);
    }
  }

  /** A target as the planner sees it: its bearing from the search start, and its distance. */
  record Polar(double bearing, double distance) {}

  /** A planned dwell: its extent and the indexes of its targets in the list given, none for an empty one. */
  record Planned(Extent extent, List<Integer> targets) {
    boolean empty() {
      return targets.isEmpty();
    }
  }

  /**
   * The search area (function 37): from {@code start}, a true bearing, over {@code span} degrees
   * (360 all round), between {@code near} and {@code far} metres from {@code centre}.
   */
  record Search(Position centre, double start, double span, double near, double far) {
    static Search of(Position platform, double heading, SensorSettings s) {
      Position centre = Position.of(platform.longitude(), platform.latitude());
      if (s.detectAll()) {
        return new Search(centre, Detector.normal(heading + s.startBearing()), 360, 0, s.maxRange());
      }
      return new Search(centre, Detector.normal(heading + s.startBearing()), Detector.span(s), s.minRange(), s.maxRange());
    }

    boolean allRound() {
      return span >= 360 - EPSILON;
    }

    /**
     * The same area round {@code platform}, where the platform is when a dwell is sent (T-193): the
     * bearings stay those the revisit was planned with, so a turn does not swing the dwells round.
     */
    Search at(Position platform) {
      return new Search(Position.of(platform.longitude(), platform.latitude()), start, span, near, far);
    }

    /** Whether a position, as a bearing from the start, lies inside the arc: between the start and end bearings, at any range (M9, owner YW2 A). */
    boolean inArc(Polar p) {
      return allRound() || p.bearing() <= span + EPSILON;
    }

    /** A true bearing as a bearing from the start. */
    double relative(double trueBearing) {
      return Detector.normal(trueBearing - start);
    }

    Polar polar(Position p) {
      GeodesicLeg leg = Geodesy.inverse(centre, p);
      return new Polar(relative(leg.initialAzimuth()), leg.distanceMetres());
    }

    /** The extent as the {@code ArcBand} a report carries; all round with equal bearings. */
    Geometry.ArcBand band(Extent e) {
      double from = Detector.normal(start + e.from());
      double to = e.allRound() ? from : Detector.normal(from + e.width());
      return new Geometry.ArcBand(centre, e.near(), e.far(), from, to);
    }

    Position centreOf(Extent e) {
      return Geodesy.direct(centre, Detector.normal(start + e.from() + e.width() / 2), (e.near() + e.far()) / 2);
    }
  }

  /**
   * M7-S3: the search area divided into nominal dwells, the search width wide and the dwell depth
   * deep, in the revisit's order: clockwise by bearing from the start, and at one bearing near to far.
   * The last column and row are moved back to end at the search area's edge (all round, the last
   * column wraps past the start instead), so each place is of the nominal size and inside the area.
   */
  record Grid(Search area, double w, double d, int across, int deep) {
    static Grid of(Search area, double w, double d) {
      int across = (int) Math.max(1, Math.ceil(area.span() / w - EPSILON));
      int deep = (int) Math.max(1, Math.ceil((area.far() - area.near()) / d - EPSILON));
      return new Grid(area, w, d, across, deep);
    }

    int size() {
      return across * deep;
    }

    /** The place of index {@code k}, in the revisit's order. */
    Extent cell(int k) {
      int col = k / deep;
      int row = k % deep;
      double from = area.allRound() ? col * w : Math.min(col * w, area.span() - w);
      double near = Math.min(area.near() + row * d, area.far() - d);
      return new Extent(from, w, near, near + d);
    }

    /** The columns that may meet the bearings {@code from} to {@code to} (from the start); a superset, checked by the caller. */
    List<Integer> columns(double from, double to) {
      List<Integer> cols = new ArrayList<>();
      int a = (int) Math.floor(from / w) - 1;
      int b = (int) Math.floor(to / w) + 1;
      if (area.allRound()) {
        for (int c = a; c <= b && cols.size() < across; c++) {
          cols.add(Math.floorMod(c, across));
        }
        if (!cols.contains(across - 1)) {
          cols.add(across - 1); // it wraps past the start
        }
      } else {
        for (int c = Math.max(0, a); c <= Math.min(across - 1, b); c++) {
          cols.add(c);
        }
        if (!cols.contains(across - 1)) {
          cols.add(across - 1); // moved back to the edge, it may meet bearings before its column
        }
      }
      return cols;
    }

    /** The rows that may meet the ranges {@code near} to {@code far}; a superset, checked by the caller. */
    List<Integer> rows(double near, double far) {
      List<Integer> rows = new ArrayList<>();
      int a = (int) Math.floor((near - area.near()) / d) - 1;
      int b = (int) Math.floor((far - area.near()) / d) + 1;
      for (int r = Math.max(0, a); r <= Math.min(deep - 1, b); r++) {
        rows.add(r);
      }
      if (!rows.contains(deep - 1)) {
        rows.add(deep - 1); // moved back to the edge
      }
      return rows;
    }
  }

  static final double EPSILON = 1e-6;

  private Dwells() {}

  /** The nominal width: the search width, at most the search area's span. */
  static double width(Search area, SensorSettings s) {
    return Math.min(s.searchWidth(), area.span());
  }

  /** The nominal depth: the dwell depth, at most the band's (A3). */
  static double depth(Search area, SensorSettings s) {
    return Math.min(s.dwellDepth(), area.far() - area.near());
  }

  /**
   * How many dwells a revisit holds (T-196, the owner's answer of 2026-11-13 in PCA-simulator's session):
   * the revisit interval over the dwell interval, so the radar sends one dwell per dwell interval
   * (10 a second at 0.1 s); at least one. More only when its dwells with targets need more.
   */
  static int perRevisit(SensorSettings s) {
    return (int) Math.max(1, Math.floor(s.revisitSeconds() / s.dwellInterval() + EPSILON));
  }

  /**
   * The revisit's dwells in the order sent: those with targets, and empty ones up to {@link
   * #perRevisit} (T-196; before, function 44's share and the admin's cap set how many).
   *
   * @param targets the chosen targets, as polar positions from the search area
   * @param others every track the radar could hold, as polar positions: an empty dwell holds none
   * @param offset the revisit's random draw, 0 to below 1: where the spread of empty dwells starts (M7-S4)
   */
  static List<Planned> plan(Search area, List<Polar> targets, List<Polar> others, SensorSettings s, double offset) {
    double w = width(area, s);
    double d = depth(area, s);
    List<Integer> order = new ArrayList<>();
    for (int i = 0; i < targets.size(); i++) {
      order.add(i);
    }
    order.sort(Comparator.<Integer>comparingDouble(i -> targets.get(i).bearing()).thenComparingDouble(i -> targets.get(i).distance()));
    List<Planned> full = new ArrayList<>();
    int i = 0;
    while (i < order.size()) {
      double first = targets.get(order.get(i)).bearing();
      List<Integer> group = new ArrayList<>();
      while (i < order.size() && group.size() < s.maxDetections() && targets.get(order.get(i)).bearing() - first <= w + EPSILON) {
        group.add(order.get(i));
        i++;
      }
      full.add(new Planned(place(area, group.stream().map(targets::get).toList(), w, d), List.copyOf(group)));
    }
    List<Planned> all = new ArrayList<>(full);
    all.addAll(empties(area, full, others, s, w, d, perRevisit(s) - full.size(), offset));
    if (all.isEmpty()) {
      // The owner's Q1 kept as the floor (2026-11-12): a revisit without targets and without empty dwells still sends one.
      all.add(new Planned(firstEmpty(area, s, w, d), List.of()));
    }
    // Clockwise from the start: all round a bearing below 0 is near 360; otherwise a dwell grown before the start comes first.
    all.sort(Comparator.<Planned>comparingDouble(p -> area.allRound() ? Detector.normal(p.extent().from() + EPSILON) - EPSILON : p.extent().from())
        .thenComparingDouble(p -> p.extent().near()));
    return List.copyOf(all);
  }

  /**
   * A planned dwell placed again over its targets {@code now}, as seen from where the platform is when
   * it is sent (T-193): by the rules of {@link #plan}, so it is the search width wide unless its targets
   * really need more. Bearings are taken on the side of the planned dwell's middle, so a group near the
   * start of an all-round area does not split across 0°.
   */
  static Extent over(Search area, Extent planned, List<Polar> now, SensorSettings s) {
    double middle = planned.from() + planned.width() / 2;
    List<Polar> near = new ArrayList<>(now.size());
    for (Polar p : now) {
      double off = Detector.normal(p.bearing() - middle);
      near.add(new Polar(middle + (off > 180 ? off - 360 : off), p.distance()));
    }
    near.sort(Comparator.comparingDouble(Polar::bearing));
    return place(area, near, width(area, s), depth(area, s));
  }

  /**
   * Function 50's scan (T-197, TQ A, TR B): the search area in rows of the dwell depth from the near
   * edge outwards, each row in cells of the search width from the start bearing clockwise, side by side;
   * a row's last cell and the last row are cut to the area. In the order scanned: every cell of the
   * nearest row, then the next row out. With a job area only the cells whose centre is inside it; when
   * that leaves none, the first cell, so a pass always has one.
   */
  static List<Extent> scan(Search area, SensorSettings s) {
    double w = width(area, s);
    double d = depth(area, s);
    int across = (int) Math.max(1, Math.ceil(area.span() / w - EPSILON));
    int deep = (int) Math.max(1, Math.ceil((area.far() - area.near()) / d - EPSILON));
    List<Extent> cells = new ArrayList<>(across * deep);
    Extent first = null;
    for (int row = 0; row < deep; row++) {
      double near = area.near() + row * d;
      double far = Math.min(near + d, area.far());
      for (int col = 0; col < across; col++) {
        double from = col * w;
        Extent cell = new Extent(from, Math.min(w, area.span() - from), near, far);
        if (first == null) {
          first = cell;
        }
        if (s.jobArea() == null || Detector.inside(s.jobArea(), area.centreOf(cell))) {
          cells.add(cell);
        }
      }
    }
    if (cells.isEmpty() && first != null) {
      cells.add(first);
    }
    return cells;
  }

  /** Function 50: a found target's own dwell, the search width and the dwell depth centred on where it was last measured (not below 0 m). */
  static Extent around(Search area, Polar target, SensorSettings s) {
    double w = width(area, s);
    double d = depth(area, s);
    double near = Math.max(0, target.distance() - d / 2);
    return new Extent(target.bearing() - w / 2, w, near, near + d);
  }

  /** A dwell of the nominal size over {@code group}, kept inside the search area where it fits, grown where they need more. */
  private static Extent place(Search area, List<Polar> group, double w, double d) {
    double a = group.getFirst().bearing();
    double b = group.getLast().bearing();
    double width = Math.max(w, b - a);
    double from = (a + b) / 2 - width / 2;
    if (!area.allRound() && width <= area.span()) {
      from = Math.max(0, Math.min(area.span() - width, from));
    }
    double near = group.stream().mapToDouble(Polar::distance).min().orElseThrow();
    double far = group.stream().mapToDouble(Polar::distance).max().orElseThrow();
    double depth = Math.max(d, far - near);
    double start = (near + far) / 2 - depth / 2;
    if (depth <= area.far() - area.near()) {
      start = Math.max(area.near(), Math.min(area.far() - depth, start));
    }
    Extent e = new Extent(from, Math.min(360, width), Math.max(0, start), Math.max(0, start) + depth);
    for (Polar p : group) {
      e = e.cover(p.bearing(), p.distance()); // a rounding at an edge
    }
    return e;
  }

  /** The owner's Q1: one empty dwell at the search area's start, or the first place clockwise with its centre in the job area. */
  private static Extent firstEmpty(Search area, SensorSettings s, double w, double d) {
    Grid grid = Grid.of(area, w, d);
    if (s.jobArea() != null) {
      for (int k = 0; k < grid.size(); k++) {
        if (Detector.inside(s.jobArea(), area.centreOf(grid.cell(k)))) {
          return grid.cell(k);
        }
      }
    }
    return grid.cell(0);
  }

  /**
   * Function 44 (M7-S3, M7-S4): {@code wanted} empty dwells spread over the free places of the grid:
   * with {@code k} free places, every (k / wanted)-th in the revisit's order, the first at the
   * revisit's offset. A place is free when it holds no track, overlaps no dwell with targets and, with
   * a job area, has its centre inside it. With fewer free places than {@code wanted}, the step is below
   * one and places are taken again, each about as often (T-196: the revisit stays full); none when no
   * place is free.
   */
  private static List<Planned> empties(Search area, List<Planned> full, List<Polar> others, SensorSettings s, double w, double d, int wanted,
      double offset) {
    if (wanted <= 0) {
      return List.of();
    }
    Grid grid = Grid.of(area, w, d);
    boolean[] blocked = new boolean[grid.size()];
    for (Polar o : others) {
      for (int c : grid.columns(o.bearing(), o.bearing())) {
        for (int r : grid.rows(o.distance(), o.distance())) {
          int k = c * grid.deep() + r;
          if (!blocked[k] && grid.cell(k).holds(o.bearing(), o.distance())) {
            blocked[k] = true;
          }
        }
      }
    }
    for (Planned p : full) {
      Extent e = p.extent();
      for (int c : grid.columns(e.from(), e.from() + e.width())) {
        for (int r : grid.rows(e.near(), e.far())) {
          int k = c * grid.deep() + r;
          if (!blocked[k] && grid.cell(k).overlaps(e)) {
            blocked[k] = true;
          }
        }
      }
    }
    int[] free = new int[grid.size()];
    int count = 0;
    for (int k = 0; k < grid.size(); k++) {
      if (!blocked[k] && (s.jobArea() == null || Detector.inside(s.jobArea(), area.centreOf(grid.cell(k))))) {
        free[count++] = k;
      }
    }
    int n = count == 0 ? 0 : wanted;
    List<Planned> result = new ArrayList<>(n);
    double step = (double) count / Math.max(1, n);
    double first = Math.max(0, Math.min(offset, 1 - EPSILON)) * step;
    for (int j = 0; j < n; j++) {
      result.add(new Planned(grid.cell(free[Math.min(count - 1, (int) Math.floor(first + j * step))]), List.of()));
    }
    return result;
  }
}
