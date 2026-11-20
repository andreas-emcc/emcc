package dev.emcc.ecore.live;

import dev.emcc.ecore.geo.Cap;
import dev.emcc.ecore.geo.CubeCells;
import dev.emcc.ecore.geo.GeoArea;
import dev.emcc.ecore.geo.Sphere;
import dev.emcc.ecore.store.StoreChange;
import dev.emcc.sdk.model.ChangeEvent;
import dev.emcc.sdk.model.EntityType;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.Operation;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * What one area subscription's browser holds, and how each change alters it (spike S3,
 * recommendations 3, 4 and 11; {@code server/live-picture-protocol.md}, "How an area subscription
 * follows changes").
 *
 * <p>It knows every object that reaches into the area (the members, with their bounds), so it can
 * judge a change from the object's bound before and after, switch to clusters and back, and send
 * the objects of a cell that falls to 3 or fewer, without asking the object store. While the area
 * holds at most the budget, every member is held by the browser individually. Above it the area is
 * divided into cube cells about {@link #CELL_PX} pixels across: a cell with at most {@link #SINGLES}
 * members still sends them as objects, a denser one becomes a cluster, and a shape wider than half a
 * cell is always an object. Below {@link #BACK_BELOW} of the budget it returns to objects.
 *
 * <p>The browser holds exactly the members shown individually, at their current versions, after
 * each batch. Within a batch the view notes, for every object a change may have shown or hidden,
 * the version the browser holds; at the end it sends {@code entered} and {@code left} for every
 * difference.
 *
 * <p><b>Label filtering</b> (after M1, S3 recommendation 14) belongs in {@link #reaches}: an object
 * the user may not see does not reach into the area.
 *
 * <p>Not thread-safe: owned by one session's worker. Filling a large area takes long (100 to 300
 * ms for 200 000 objects), so the session's fill worker does it ({@link AreaFill}, rule C7) and hands
 * the result over as an immutable {@link Filled}, from which the session makes its own view ({@link
 * #of}) without the cell arithmetic (rule C2: workers share no mutable state).
 */
final class AreaView {

  /** Cluster cells are about this many CSS pixels across. */
  static final double CELL_PX = 64;
  /** A cell with at most this many objects sends them as objects. */
  static final int SINGLES = 3;
  /** With clusters, below this share of the budget the view returns to single objects. */
  static final double BACK_BELOW = 0.9;
  /** Without a resolution, the cells are this share of the area's extent (a 1 280 px view of 64 px cells). */
  static final double CELLS_ACROSS = 20;

  private static final long NO_CELL = -1;
  private static final long NONE = -1; // the browser holds no version

  /** The objects of one batch (or one move) the browser now holds differently. */
  record Update(List<ChangeEvent> events, List<MapObject> entered, List<UUID> left, @Nullable Clusters clusters) {
    boolean hasAreaObjects() {
      return !entered.isEmpty() || !left.isEmpty();
    }
  }

  /** Changed and removed clusters, or the full set ({@code full}). */
  record Clusters(int level, boolean full, List<ClusterOut> upsert, List<String> remove) {}

  /** A cluster as the protocol carries it. */
  record ClusterOut(String cell, double lon, double lat, int count, Map<UUID, Integer> byLayer, List<Integer> byIdentity) {}

  /** An object that reaches into the area, with its bound, its identity and its cube cell ({@code NO_CELL}: none). Immutable. */
  record Member(MapObject object, Cap bound, Identity identity, long cell) {
    Member(MapObject object, Cap bound) {
      this(object, bound, Identity.of(object), NO_CELL);
    }

    Member withCell(long newCell) {
      return newCell == cell ? this : new Member(object, bound, identity, newCell);
    }
  }

  /** A cell's state as the fill left it. Immutable. */
  record CellState(long id, List<UUID> members, Map<UUID, Integer> byLayer, List<Integer> identities, double sx, double sy,
      double sz, @Nullable ClusterOut sent) {}

  /**
   * A filled view as an immutable value (rule C2): what the fill worker hands to the session, which
   * makes its view from it with {@link #of}. It also carries the snapshot's {@code singles}, worked
   * out already; each cell's state includes what the browser will be sent for it.
   */
  record Filled(GeoArea area, double metresPerPixel, int budget, boolean clustered, List<Member> members,
      List<CellState> cells, List<MapObject> singles) {
    Filled {
      members = List.copyOf(members);
      cells = List.copyOf(cells);
      singles = List.copyOf(singles);
    }
  }

  private static final class Cell {
    final long id;
    /**
     * The members as the fill left them, until a change first touches the cell: most cells are
     * never touched, so the session builds no set for them ({@link #of}).
     */
    private @Nullable List<UUID> filled;
    private @Nullable Set<UUID> set;
    private int size;
    final Map<UUID, Integer> byLayer = new HashMap<>();
    final int[] identities = new int[Identity.values().length];
    double sx;
    double sy;
    double sz;
    /** What the browser was last sent for this cell; null when it holds no cluster for it. */
    @Nullable ClusterOut sent;

    Cell(long id) {
      this.id = id;
      this.set = new HashSet<>();
    }

    int size() {
      return size;
    }

    /** The members, to read. */
    Collection<UUID> members() {
      Set<UUID> s = set;
      return s != null ? s : Objects.requireNonNull(filled);
    }

    /** The members, to change: the set is built on first use. */
    private Set<UUID> changing() {
      Set<UUID> s = set;
      if (s == null) {
        s = new HashSet<>(Objects.requireNonNull(filled));
        set = s;
        filled = null;
      }
      return s;
    }

    boolean dense() {
      return size > SINGLES;
    }

    void add(Member m, int sign) {
      UUID layer = m.object().content().layerId();
      byLayer.merge(layer, sign, (a, b) -> a + b == 0 ? null : a + b);
      identities[m.identity().ordinal()] += sign;
      sx += sign * m.bound().x();
      sy += sign * m.bound().y();
      sz += sign * m.bound().z();
      if (sign > 0) {
        changing().add(m.object().id());
        size++;
      } else {
        changing().remove(m.object().id());
        size--;
      }
    }

    ClusterOut out() {
      return new ClusterOut(Long.toHexString(id), Sphere.lon(sx, sy), Sphere.lat(sx, sy, sz), size, Map.copyOf(byLayer),
          java.util.Arrays.stream(identities).boxed().toList());
    }

    CellState state() {
      return new CellState(id, List.copyOf(members()), Map.copyOf(byLayer), java.util.Arrays.stream(identities).boxed().toList(),
          sx, sy, sz, sent);
    }

    static Cell of(CellState state) {
      Cell cell = new Cell(state.id());
      cell.set = null;
      cell.filled = state.members(); // immutable: its set is made when a change first touches the cell
      cell.size = state.members().size();
      cell.byLayer.putAll(state.byLayer());
      for (int i = 0; i < cell.identities.length; i++) {
        cell.identities[i] = state.identities().get(i);
      }
      cell.sx = state.sx();
      cell.sy = state.sy();
      cell.sz = state.sz();
      cell.sent = state.sent();
      return cell;
    }
  }

  private final GeoArea area;
  private final int budget;
  private final double metresPerPixel;
  private final CubeCells cells;
  private final double bigRadius;
  private final Map<UUID, Member> members;
  /**
   * The members shown individually ({@link #single}), kept current with every change, so that
   * what concerns only them (the snapshot's objects, a move's difference) costs as many steps as
   * there are such members, not as there are members: few when the view is clustered.
   */
  private final Set<UUID> shown;
  private boolean clustered;
  private final Map<Long, Cell> cellMap = new HashMap<>();
  /** Cells whose cluster may have changed in this batch, and those removed whose cluster the browser holds. */
  private final Set<Long> dirty = new LinkedHashSet<>();
  private final List<String> removedClusters = new ArrayList<>();
  /** Per object touched in this batch: the version the browser holds now ({@link #NONE}: none). */
  private final Map<UUID, Long> browserHolds = new HashMap<>();

  /**
   * @param metresPerPixel the view's resolution; 0 without one (the cells are then a {@link
   *     #CELLS_ACROSS}th of the area's extent)
   */
  AreaView(GeoArea area, double metresPerPixel, int budget) {
    this(area, metresPerPixel, budget, 16, 16);
  }

  private AreaView(GeoArea area, double metresPerPixel, int budget, int expectedMembers, int expectedShown) {
    this.members = HashMap.newHashMap(expectedMembers);
    this.shown = HashSet.newHashSet(expectedShown);
    this.area = area;
    this.budget = budget;
    this.metresPerPixel = metresPerPixel > 0 ? metresPerPixel : 2 * area.extentMetres() / CELLS_ACROSS / CELL_PX;
    double cellMetres = CELL_PX * this.metresPerPixel;
    this.cells = new CubeCells(CubeCells.levelFor(cellMetres));
    this.bigRadius = cellMetres / 4 / Sphere.R; // wider than half a cell
  }

  GeoArea area() {
    return area;
  }

  int level() {
    return cells.level();
  }

  /** How many objects reach into the area. */
  int memberCount() {
    return members.size();
  }

  boolean clustered() {
    return clustered;
  }

  /** Fills an empty view from the object store's answer: the objects that reach into the area, with their bounds. */
  void fill(List<MapObject> objects, List<Cap> bounds) {
    for (int i = 0; i < objects.size(); i++) {
      members.put(objects.get(i).id(), new Member(objects.get(i), bounds.get(i)));
    }
    if (members.size() > budget) {
      cluster(); // which works out what is shown
    } else {
      shown.addAll(members.keySet());
    }
    browserHolds.clear(); // the browser holds nothing yet: the snapshot comes next
  }

  /**
   * Fills a view and gives it as an immutable value, with its singles and each cell marked with the
   * cluster the browser will be sent for it (the fill worker's part, rule C7).
   */
  static Filled filled(GeoArea area, double metresPerPixel, int budget, List<MapObject> objects, List<Cap> bounds) {
    AreaView view = new AreaView(area, metresPerPixel, budget);
    view.fill(objects, bounds);
    List<MapObject> singles = view.singles();
    view.fullClusters(); // marks what the browser will hold, as after a snapshot or a move
    List<CellState> cells = new ArrayList<>(view.cellMap.size());
    view.cellMap.values().forEach(c -> cells.add(c.state()));
    return new Filled(area, view.metresPerPixel, budget, view.clustered, List.copyOf(view.members.values()), cells, singles);
  }

  /** The session's own view from a filled one: map entries only, no cell arithmetic. */
  static AreaView of(Filled filled) {
    AreaView view = new AreaView(filled.area(), filled.metresPerPixel(), filled.budget(), filled.members().size(),
        filled.singles().size());
    for (Member m : filled.members()) {
      view.members.put(m.object().id(), m);
    }
    for (MapObject single : filled.singles()) {
      view.shown.add(single.id());
    }
    view.clustered = filled.clustered();
    for (CellState state : filled.cells()) {
      view.cellMap.put(state.id(), Cell.of(state));
    }
    return view;
  }

  /** The objects shown individually: the snapshot's objects. */
  List<MapObject> singles() {
    List<MapObject> singles = new ArrayList<>(shown.size());
    for (UUID id : shown) {
      singles.add(Objects.requireNonNull(members.get(id)).object());
    }
    return singles;
  }

  /** For tests: whether {@link #shown} holds exactly the members {@link #single} judges shown. */
  boolean shownIsCurrent() {
    Set<UUID> judged = new HashSet<>();
    members.values().forEach(m -> {
      if (single(m)) {
        judged.add(m.object().id());
      }
    });
    return judged.equals(shown);
  }

  /** The full set of clusters (after a snapshot or a move); what was sent is reset to it. */
  Clusters fullClusters() {
    List<ClusterOut> all = new ArrayList<>();
    for (Cell cell : cellMap.values()) {
      cell.sent = cell.dense() ? cell.out() : null;
      if (cell.sent != null) {
        all.add(cell.sent);
      }
    }
    dirty.clear();
    removedClusters.clear();
    return new Clusters(cells.level(), true, all, List.of());
  }

  /** True if a geometry with this bound belongs to the area (and, later, the user may see it). */
  private boolean reaches(@Nullable Cap bound) {
    return bound != null && area.matches(bound);
  }

  private boolean single(Member m) {
    if (!clustered || m.cell() == NO_CELL) {
      return true;
    }
    return !Objects.requireNonNull(cellMap.get(m.cell())).dense();
  }

  /** Notes, once per batch, the version the browser holds of {@code id} before anything changes it. */
  private void touch(UUID id) {
    if (!browserHolds.containsKey(id)) {
      Member m = members.get(id);
      browserHolds.put(id, m != null && single(m) ? m.object().version() : NONE);
    }
  }

  /** The member placed in its cell (or in none: not clustered, or a shape wider than half a cell). */
  private Member addToCell(Member m) {
    if (!clustered || m.bound().radius() > bigRadius) {
      return m.withCell(NO_CELL);
    }
    Member placed = m.withCell(cells.cell(m.bound()));
    Cell cell = cellMap.computeIfAbsent(placed.cell(), Cell::new);
    if (cell.size() == SINGLES) {
      cell.members().forEach(this::touch); // they are about to be clustered
    }
    cell.add(placed, 1);
    dirty.add(cell.id);
    if (cell.size() == SINGLES + 1) {
      shown.removeAll(cell.members()); // now a cluster
    }
    return placed;
  }

  /** Takes the member out of its cell; the caller replaces or removes the member. */
  private void removeFromCell(Member m) {
    if (m.cell() == NO_CELL) {
      return;
    }
    Cell cell = Objects.requireNonNull(cellMap.get(m.cell()));
    if (cell.size() == SINGLES + 1) {
      cell.members().forEach(this::touch); // they are about to be shown individually
    }
    cell.add(m, -1);
    dirty.add(cell.id);
    if (cell.size() == SINGLES) {
      shown.addAll(cell.members()); // no longer a cluster
    }
    if (cell.size() == 0) {
      cellMap.remove(cell.id);
      if (cell.sent != null) {
        removedClusters.add(cell.sent.cell());
      }
      dirty.remove(cell.id);
    }
  }

  /** Puts every member in its cell; shown are then the shapes in no cell and the members of the cells with at most {@link #SINGLES}. */
  private void cluster() {
    clustered = true;
    shown.clear();
    members.replaceAll((id, m) -> {
      Member placed = addToCell(m);
      if (placed.cell() == NO_CELL) {
        shown.add(id);
      }
      return placed;
    });
    for (Cell cell : cellMap.values()) {
      if (!cell.dense()) {
        shown.addAll(cell.members());
      }
    }
  }

  private void uncluster() {
    for (Cell cell : cellMap.values()) {
      if (cell.sent != null) {
        removedClusters.add(cell.sent.cell());
      }
    }
    cellMap.clear();
    dirty.clear();
    members.replaceAll((id, m) -> m.withCell(NO_CELL));
    clustered = false;
    shown.addAll(members.keySet());
  }

  /**
   * Applies one batch of changes, in sequence order, and says what to send: the change events (all
   * layer events, and those of objects shown individually), then the objects that entered and the
   * ids that left, then the changed clusters.
   */
  Update apply(List<StoreChange> changes) {
    List<ChangeEvent> events = new ArrayList<>();
    for (StoreChange change : changes) {
      ChangeEvent event = change.event();
      if (event.entityType() == EntityType.LAYER) {
        events.add(event);
        continue;
      }
      UUID id = event.entityId();
      touch(id);
      Member old = members.remove(id);
      if (old != null) {
        removeFromCell(old);
        shown.remove(id);
      }
      boolean in = reaches(change.afterBound()) && event.state() instanceof MapObject;
      boolean singleAfter = false;
      if (in) {
        Member now = addToCell(new Member((MapObject) Objects.requireNonNull(event.state()), Objects.requireNonNull(change.afterBound())));
        members.put(id, now);
        singleAfter = single(now);
        if (singleAfter) {
          shown.add(id);
        }
      }
      long holds = browserHolds.get(id);
      if (singleAfter || (event.operation() == Operation.DELETE && holds != NONE)) {
        events.add(event);
        browserHolds.put(id, event.operation() == Operation.DELETE ? NONE : event.version());
      }
    }
    boolean switched = switchIfNeeded();
    return finish(events, switched);
  }

  /** Clusters above the budget, single objects again below {@link #BACK_BELOW} of it. */
  private boolean switchIfNeeded() {
    if (!clustered && members.size() > budget) {
      members.keySet().forEach(this::touch);
      cluster();
      return true;
    }
    if (clustered && members.size() < BACK_BELOW * budget) {
      members.keySet().forEach(this::touch);
      uncluster();
      return true;
    }
    return false;
  }

  private Update finish(List<ChangeEvent> events, boolean switched) {
    List<MapObject> entered = new ArrayList<>();
    List<UUID> left = new ArrayList<>();
    browserHolds.forEach((id, holds) -> {
      Member m = members.get(id);
      boolean isShown = m != null && single(m);
      if (isShown && holds != m.object().version()) {
        entered.add(m.object());
      } else if (!isShown && holds != NONE) {
        left.add(id);
      }
    });
    browserHolds.clear();
    Clusters clusters = switched ? fullClusters() : changedClusters();
    return new Update(events, entered, left, clusters);
  }

  private @Nullable Clusters changedClusters() {
    List<ClusterOut> upsert = new ArrayList<>();
    List<String> remove = new ArrayList<>(removedClusters);
    removedClusters.clear();
    double onePixel = metresPerPixel / Sphere.R;
    for (long id : dirty) {
      Cell cell = Objects.requireNonNull(cellMap.get(id));
      if (!cell.dense()) {
        if (cell.sent != null) {
          remove.add(cell.sent.cell());
          cell.sent = null;
        }
        continue;
      }
      ClusterOut now = cell.out();
      ClusterOut sent = cell.sent;
      if (sent == null || sent.count() != now.count() || !sent.byLayer().equals(now.byLayer())
          || !sent.byIdentity().equals(now.byIdentity())
          || Sphere.angle(Sphere.vec(sent.lon(), sent.lat()), Sphere.vec(now.lon(), now.lat())) >= onePixel) {
        upsert.add(now);
        cell.sent = now;
      }
    }
    dirty.clear();
    // A cell emptied and filled again in one batch: its new cluster replaces the old one.
    Set<String> upserted = new java.util.HashSet<>();
    upsert.forEach(c -> upserted.add(c.cell()));
    remove.removeIf(upserted::contains);
    return upsert.isEmpty() && remove.isEmpty() ? null : new Clusters(cells.level(), false, upsert, remove);
  }

  /**
   * What the browser must be told when its area moves from {@code from} to this view (both
   * brought up to the same change): the objects it now shows that it did not hold at that version,
   * the ids it held that are no longer shown, and the full set of clusters when either view has
   * them.
   */
  Update movedFrom(AreaView from) {
    List<MapObject> entered = new ArrayList<>();
    List<UUID> left = new ArrayList<>();
    for (UUID id : shown) {
      MapObject now = Objects.requireNonNull(members.get(id)).object();
      Member before = from.shown.contains(id) ? from.members.get(id) : null;
      if (before == null || before.object().version() != now.version()) {
        entered.add(now);
      }
    }
    for (UUID id : from.shown) {
      if (!shown.contains(id)) {
        left.add(id);
      }
    }
    Clusters clusters = clustered || from.clustered ? fullClusters() : null;
    return new Update(List.of(), entered, left, clusters);
  }
}
