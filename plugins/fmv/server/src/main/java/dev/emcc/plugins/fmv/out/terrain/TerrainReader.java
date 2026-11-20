package dev.emcc.plugins.fmv.out.terrain;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.folder.FolderResult;
import dev.emcc.sdk.folder.LocalFolder;
import dev.emcc.sdk.worker.WorkerRef;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;

/**
 * The worker's side of the terrain (brief section 10.5 point 16, O6): which DTED cells lie within
 * {@link #RADIUS_METRES} of the camera, and reading them through the declared {@code terrain}
 * folder only (ADR-0049). For each cell it lists the longitude column once and reads the
 * highest level there (A4: {@code dt2}, then {@code dt1}, then {@code dt0}). It reads at most {@link
 * #MAX_READS} files at a time, so that the imagery's reads have room within the SDK's limit.
 *
 * <p>It never blocks: each call's result comes back as a message to the worker, which hands it to
 * {@link #onResult}. The bytes go on to the compute task, which parses them.
 *
 * @param <M> the worker's message type
 */
public final class TerrainReader<M extends Message> {

  /** The round the worker reads (O6). */
  public static final double RADIUS_METRES = 10_000;

  /** How far the camera moves before the round is read again (O6). */
  public static final double MOVE_METRES = 5_000;

  /** Files read at a time. */
  static final int MAX_READS = 2;

  private static final double METRES_PER_DEGREE = 111_320;

  /** What a result gave the worker. */
  public sealed interface Outcome {
    /** A cell's file, whole: to be posted to the compute task. */
    record Loaded(CellKey key, String path, Bytes data) implements Outcome {}

    /** The folder holds no file for a cell: the ground there is the fallback's. */
    record Missing(CellKey key) implements Outcome {}

    /** A cell could not be read, with the folder's reason; counted and named in the Monitor. */
    record Failed(CellKey key, String path, FolderResult.Reason reason, String message) implements Outcome {}
  }

  private final LocalFolder folder;
  private final WorkerRef<M> self;
  private final Function<FolderResult, ? extends M> toMessage;
  private final Duration timeout;

  private final Set<CellKey> wanted = new LinkedHashSet<>();
  private final Set<CellKey> done = new HashSet<>();
  private final Set<String> listing = new HashSet<>();
  private final Deque<String[]> queue = new ArrayDeque<>(); // {path, size}
  private final Map<String, CellKey> reading = new HashMap<>();
  private double aimLon = Double.NaN;
  private double aimLat = Double.NaN;

  /**
   * @param folder the declared terrain folder
   * @param self the worker that owns this reader; results come back to it
   * @param toMessage wraps a result as the worker's message
   * @param timeout each call's timeout
   */
  public TerrainReader(LocalFolder folder, WorkerRef<M> self, Function<FolderResult, ? extends M> toMessage, Duration timeout) {
    this.folder = folder;
    this.self = self;
    this.toMessage = toMessage;
    this.timeout = timeout;
  }

  /** Whether the camera has moved far enough from the last aim to read again, or nothing is aimed yet. */
  public boolean shouldAim(double lonDeg, double latDeg) {
    return Double.isNaN(aimLon) || distance(aimLon, aimLat, lonDeg, latDeg) >= MOVE_METRES;
  }

  /**
   * Aims the reader at the camera: the cells within the round are wanted, the others are let go
   * and returned, so that the worker tells the task to drop them. Starts the listings it needs.
   */
  public Set<CellKey> aim(double lonDeg, double latDeg) {
    aimLon = lonDeg;
    aimLat = latDeg;
    Set<CellKey> now = cellsAround(lonDeg, latDeg, RADIUS_METRES);
    Set<CellKey> dropped = new LinkedHashSet<>(wanted);
    dropped.removeAll(now);
    wanted.clear();
    wanted.addAll(now);
    done.retainAll(now);
    queue.removeIf(q -> !now.contains(keyOf(q[0])));
    Set<String> columns = new LinkedHashSet<>();
    for (CellKey k : now) {
      if (!done.contains(k) && !isQueuedOrReading(k)) {
        columns.add(k.directory());
      }
    }
    for (String column : columns) {
      if (listing.add(column)) {
        folder.list(column, timeout, self, toMessage);
      }
    }
    return dropped;
  }

  /** The cells the reader holds or reads for the current aim. */
  public Set<CellKey> wanted() {
    return Set.copyOf(wanted);
  }

  /** Starts queued reads while there is room; the worker calls it on its tick too (after a BUSY). */
  public void pump() {
    while (reading.size() < MAX_READS && !queue.isEmpty()) {
      String[] next = queue.poll();
      CellKey key = keyOf(next[0]);
      reading.put(next[0], key);
      int length = (int) Math.min(Long.parseLong(next[1]), LocalFolder.MAX_READ_BYTES);
      folder.read(next[0], 0, Math.max(1, length), timeout, self, toMessage);
    }
  }

  /** Takes one of the folder's results; returns what it gave (none for a listing). */
  public List<Outcome> onResult(FolderResult result) {
    List<Outcome> out = new ArrayList<>();
    switch (result) {
      case FolderResult.Listing l -> {
        listing.remove(l.path());
        listed(l, out);
      }
      case FolderResult.Read r -> {
        CellKey key = reading.remove(r.path());
        if (key != null && wanted.contains(key)) {
          if (r.data().size() != r.fileSize()) {
            out.add(new Outcome.Failed(key, r.path(), FolderResult.Reason.TOO_LARGE, "read " + r.data().size() + " of " + r.fileSize() + " bytes"));
          } else {
            out.add(new Outcome.Loaded(key, r.path(), r.data()));
          }
          done.add(key);
        }
      }
      case FolderResult.Failed f -> failed(f, out);
    }
    pump();
    return out;
  }

  private void listed(FolderResult.Listing l, List<Outcome> out) {
    Map<String, FolderResult.Entry> byName = new HashMap<>();
    for (FolderResult.Entry e : l.entries()) {
      if (!e.directory()) {
        byName.put(e.name().toLowerCase(Locale.ROOT), e);
      }
    }
    for (CellKey key : wanted) {
      if (!key.directory().equals(l.path()) || done.contains(key) || isQueuedOrReading(key)) {
        continue;
      }
      FolderResult.Entry best = null;
      for (int level = 2; level >= 0 && best == null; level--) {
        best = byName.get(key.stem() + ".dt" + level);
      }
      if (best == null) {
        done.add(key);
        out.add(new Outcome.Missing(key));
      } else {
        queue.add(new String[] {l.path() + "/" + best.name(), Long.toString(best.size())});
      }
    }
  }

  private void failed(FolderResult.Failed f, List<Outcome> out) {
    if (listing.remove(f.path())) {
      for (CellKey key : wanted) {
        if (key.directory().equals(f.path()) && !done.contains(key) && !isQueuedOrReading(key)) {
          done.add(key);
          out.add(f.reason() == FolderResult.Reason.NOT_FOUND ? new Outcome.Missing(key) : new Outcome.Failed(key, f.path(), f.reason(), f.message()));
        }
      }
      return;
    }
    CellKey key = reading.remove(f.path());
    if (key == null || !wanted.contains(key)) {
      return;
    }
    if (f.reason() == FolderResult.Reason.BUSY) {
      queue.addFirst(new String[] {f.path(), Integer.toString(LocalFolder.MAX_READ_BYTES)});
      return;
    }
    done.add(key);
    out.add(new Outcome.Failed(key, f.path(), f.reason(), f.message()));
  }

  private boolean isQueuedOrReading(CellKey key) {
    if (reading.containsValue(key)) {
      return true;
    }
    for (String[] q : queue) {
      if (keyOf(q[0]).equals(key)) {
        return true;
      }
    }
    return false;
  }

  /** The cell of a file path {@code e017/n62.dt2}, as this reader wrote it. */
  private static CellKey keyOf(String path) {
    int slash = path.indexOf('/');
    String dir = path.substring(0, slash);
    String file = path.substring(slash + 1);
    int lon = Integer.parseInt(dir.substring(1)) * (Character.toLowerCase(dir.charAt(0)) == 'w' ? -1 : 1);
    int lat = Integer.parseInt(file.substring(1, 3)) * (Character.toLowerCase(file.charAt(0)) == 's' ? -1 : 1);
    return new CellKey(lon, lat);
  }

  /** The cells that a box round the point, {@code radius} metres each way, touches. */
  static Set<CellKey> cellsAround(double lonDeg, double latDeg, double radius) {
    double dLat = radius / METRES_PER_DEGREE;
    double dLon = radius / (METRES_PER_DEGREE * Math.max(0.01, Math.cos(Math.toRadians(latDeg))));
    int lat0 = (int) Math.floor(Math.max(-90, latDeg - dLat));
    int lat1 = (int) Math.floor(Math.min(89.999_999, latDeg + dLat));
    int lon0 = (int) Math.floor(lonDeg - dLon);
    int lon1 = (int) Math.floor(lonDeg + dLon);
    Set<CellKey> out = new LinkedHashSet<>();
    for (int lon = lon0; lon <= lon1; lon++) {
      int wrapped = Math.floorMod(lon + 180, 360) - 180;
      for (int lat = lat0; lat <= lat1; lat++) {
        out.add(new CellKey(wrapped, lat));
      }
    }
    return out;
  }

  private static double distance(double lon1, double lat1, double lon2, double lat2) {
    double x = Math.toRadians(lon2 - lon1) * Math.cos(Math.toRadians((lat1 + lat2) / 2));
    double y = Math.toRadians(lat2 - lat1);
    return Math.hypot(x, y) * 6_371_009;
  }
}
