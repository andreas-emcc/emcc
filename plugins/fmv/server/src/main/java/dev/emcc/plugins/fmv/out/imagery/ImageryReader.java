package dev.emcc.plugins.fmv.out.imagery;

import dev.emcc.plugins.fmv.out.geo.Sweref99Tm;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.folder.FolderResult;
import dev.emcc.sdk.folder.LocalFolder;
import dev.emcc.sdk.worker.WorkerRef;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.function.Function;
import org.jspecify.annotations.Nullable;

/**
 * The worker's side of the imagery (brief section 10.5 point 16, O4, O6; the owner's B3 and Q4):
 * it lists the declared {@code imagery} folder's sets, reads each {@code imagery.json}, chooses
 * the link's set (its {@code imagerySet}, else the first by folder name that covers the camera),
 * and reads that set's tiles within {@link #RADIUS_METRES} of the camera, nearest first, up to
 * {@link #CAP_PIXELS} luma pixels; again when the camera has moved {@link #MOVE_METRES}. Only
 * through {@code LocalFolder} (ADR-0049). It never blocks; the bytes go on to the compute task.
 *
 * @param <M> the worker's message type
 */
public final class ImageryReader<M extends Message> {

  /** The round the worker reads (O6). */
  public static final double RADIUS_METRES = 10_000;

  /** How far the camera moves before the round is read again (O6). */
  public static final double MOVE_METRES = 5_000;

  /** The most luma pixels a link decodes, about 256 MB (owner, Q4); the tiles beyond are grey and counted. */
  public static final long CAP_PIXELS = 256_000_000L;

  /** The longest {@code imagery.json} read. */
  static final int MAX_JSON_BYTES = JsonText.MAX_CHARS;

  /** Files read at a time. */
  static final int MAX_READS = 2;

  /** What a result gave the worker. */
  public sealed interface Outcome {
    /** The set the link uses from now on: to be posted to the compute task before its tiles. */
    record UseSet(ImagerySet set) implements Outcome {}

    /** One tile's file of the set in use. */
    record Tile(ImagerySet set, ImagerySet.TileSpec spec, Bytes data) implements Outcome {}

    /** A tile the camera has left. */
    record DropTile(ImagerySet set, ImagerySet.TileSpec spec) implements Outcome {}

    /** A set that cannot be used, and why (named in the Monitor; ADR-0058 point 4 for a missing source or licence). */
    record Refused(String folder, String reason) implements Outcome {}

    /** A tile or file the folder could not give, and why. */
    record Failed(String path, String reason) implements Outcome {}
  }

  private final LocalFolder folder;
  private final WorkerRef<M> self;
  private final Function<FolderResult, ? extends M> toMessage;
  private final Duration timeout;
  private final @Nullable String wantedSet;

  private boolean listing;
  private boolean listed;
  private final Set<String> pendingJson = new HashSet<>();
  private final Map<String, ImagerySet> sets = new TreeMap<>();
  private final Map<String, String> refused = new LinkedHashMap<>();
  private @Nullable ImagerySet chosen;
  /** The tiles of the chosen set the reader holds or reads, by file. */
  private final Map<String, ImagerySet.TileSpec> wanted = new LinkedHashMap<>();
  private final Set<String> loaded = new HashSet<>();
  private final Deque<ImagerySet.TileSpec> queue = new ArrayDeque<>();
  private final Map<String, ImagerySet.TileSpec> reading = new HashMap<>();
  private double aimLon = Double.NaN;
  private double aimLat = Double.NaN;
  private int overCap;
  private long planned;
  private boolean listFailed;

  /**
   * @param folder the declared imagery folder
   * @param self the worker that owns this reader
   * @param toMessage wraps a result as the worker's message
   * @param timeout each call's timeout
   * @param wantedSet the link's {@code imagerySet}, or {@code null} for the first that covers the camera
   */
  public ImageryReader(LocalFolder folder, WorkerRef<M> self, Function<FolderResult, ? extends M> toMessage, Duration timeout, @Nullable String wantedSet) {
    this.folder = folder;
    this.self = self;
    this.toMessage = toMessage;
    this.timeout = timeout;
    this.wantedSet = wantedSet;
  }

  /** Whether the camera has moved far enough to read again, or nothing is aimed yet. */
  public boolean shouldAim(double lonDeg, double latDeg) {
    return Double.isNaN(aimLon) || distance(aimLon, aimLat, lonDeg, latDeg) >= MOVE_METRES;
  }

  /** The tiles of the round that the cap left out, at the last aim. */
  public int overCap() {
    return overCap;
  }

  /** The luma pixels of the tiles the last aim planned. */
  public long plannedPixels() {
    return planned;
  }

  /** Whether the sets are known (or the folder could not be listed): only then does the WMS know what the set covers (F2). */
  public boolean ready() {
    return listed || listFailed;
  }

  /** The sets refused, by folder, with the reason. */
  public Map<String, String> refused() {
    return Map.copyOf(refused);
  }

  /** The set in use, or {@code null}. */
  public @Nullable ImagerySet chosen() {
    return chosen;
  }

  /** Aims at the camera: lists the sets the first time, then chooses the set and the tiles. */
  public List<Outcome> aim(double lonDeg, double latDeg) {
    aimLon = lonDeg;
    aimLat = latDeg;
    List<Outcome> out = new ArrayList<>();
    if (!listed) {
      if (!listing) {
        listing = true;
        folder.list("", timeout, self, toMessage);
      }
      return out;
    }
    plan(out);
    pump();
    return out;
  }

  /** Starts queued reads while there is room; the worker calls it on its tick too. */
  public void pump() {
    while (reading.size() < MAX_READS && !queue.isEmpty() && chosen != null) {
      ImagerySet.TileSpec spec = queue.poll();
      String path = chosen.path(spec);
      reading.put(path, spec);
      folder.read(path, 0, LocalFolder.MAX_READ_BYTES, timeout, self, toMessage);
    }
  }

  /** Takes one of the folder's results. */
  public List<Outcome> onResult(FolderResult result) {
    List<Outcome> out = new ArrayList<>();
    switch (result) {
      case FolderResult.Listing l -> {
        if (listing && l.path().isEmpty()) {
          listing = false;
          for (FolderResult.Entry e : l.entries()) {
            if (e.directory()) {
              pendingJson.add(e.name());
              folder.read(e.name() + "/imagery.json", 0, MAX_JSON_BYTES, timeout, self, toMessage);
            }
          }
          listedIfDone(out);
        }
      }
      case FolderResult.Read r -> {
        if (r.path().endsWith("/imagery.json") && pendingJson.remove(set(r.path()))) {
          String name = set(r.path());
          try {
            sets.put(name, ImagerySet.parse(name, new String(r.data().toArray(), StandardCharsets.UTF_8)));
          } catch (ImagerySet.SetException e) {
            refused.put(name, e.getMessage());
            out.add(new Outcome.Refused(name, e.getMessage()));
          }
          listedIfDone(out);
        } else {
          ImagerySet.TileSpec spec = reading.remove(r.path());
          if (spec != null && chosen != null && wanted.containsKey(spec.file())) {
            loaded.add(spec.file());
            out.add(new Outcome.Tile(chosen, spec, r.data()));
          }
        }
      }
      case FolderResult.Failed f -> {
        if (listing && f.path().isEmpty()) {
          listing = false;
          listFailed = true;
          out.add(new Outcome.Failed("", f.reason() + ": " + f.message()));
        } else if (pendingJson.remove(set(f.path()))) {
          String name = set(f.path());
          String why = f.reason() == FolderResult.Reason.NOT_FOUND ? "no imagery.json" : f.reason() + ": " + f.message();
          refused.put(name, why);
          out.add(new Outcome.Refused(name, why));
          listedIfDone(out);
        } else if (reading.remove(f.path()) != null) {
          out.add(new Outcome.Failed(f.path(), f.reason() + ": " + f.message()));
        }
      }
    }
    pump();
    return out;
  }

  private void listedIfDone(List<Outcome> out) {
    if (!listing && pendingJson.isEmpty() && !listed) {
      listed = true;
      if (!Double.isNaN(aimLon)) {
        plan(out);
      }
    }
  }

  /** Chooses the set for the aim and the tiles within the round, nearest first, up to the cap. */
  private void plan(List<Outcome> out) {
    ImagerySet set = choose();
    if (set != chosen) {
      for (String file : loaded) {
        out.add(new Outcome.DropTile(java.util.Objects.requireNonNull(chosen), java.util.Objects.requireNonNull(wanted.get(file))));
      }
      wanted.clear();
      loaded.clear();
      queue.clear();
      reading.clear();
      chosen = set;
      if (set != null) {
        out.add(new Outcome.UseSet(set));
      }
    }
    overCap = 0;
    planned = 0;
    if (set == null) {
      return;
    }
    double[] xy = new double[2];
    project(set, aimLon, aimLat, xy);
    double rx = set.crs() == ImagerySet.Crs.EPSG_3006 ? RADIUS_METRES : RADIUS_METRES / (111_320 * Math.max(0.01, Math.cos(Math.toRadians(aimLat))));
    double ry = set.crs() == ImagerySet.Crs.EPSG_3006 ? RADIUS_METRES : RADIUS_METRES / 110_574;
    record Near(ImagerySet.TileSpec spec, double d) {}
    List<Near> near = new ArrayList<>();
    for (ImagerySet.TileSpec t : set.tiles()) {
      double dx = Math.max(0, Math.max(t.minX() - xy[0], xy[0] - t.maxX())) / rx;
      double dy = Math.max(0, Math.max(t.minY() - xy[1], xy[1] - t.maxY())) / ry;
      double d = Math.hypot(dx, dy);
      if (d <= 1) {
        near.add(new Near(t, d));
      }
    }
    near.sort(Comparator.comparingDouble(Near::d));
    Map<String, ImagerySet.TileSpec> now = new LinkedHashMap<>();
    long pixels = 0;
    for (Near n : near) {
      long p = (long) n.spec().width() * n.spec().height();
      if (pixels + p > CAP_PIXELS) {
        overCap++;
        continue;
      }
      pixels += p;
      now.put(n.spec().file(), n.spec());
    }
    planned = pixels;
    for (var it = wanted.entrySet().iterator(); it.hasNext(); ) {
      var e = it.next();
      if (!now.containsKey(e.getKey())) {
        if (loaded.remove(e.getKey())) {
          out.add(new Outcome.DropTile(set, e.getValue()));
        }
        queue.remove(e.getValue());
        it.remove();
      }
    }
    for (ImagerySet.TileSpec t : now.values()) {
      if (wanted.putIfAbsent(t.file(), t) == null) {
        queue.add(t);
      }
    }
  }

  /** The link's set, or the first by folder name with a tile that covers the camera; {@code null}: none. */
  private @Nullable ImagerySet choose() {
    if (wantedSet != null) {
      return sets.get(wantedSet);
    }
    double[] xy = new double[2];
    for (ImagerySet s : sets.values()) {
      project(s, aimLon, aimLat, xy);
      for (ImagerySet.TileSpec t : s.tiles()) {
        if (xy[0] >= t.minX() && xy[0] <= t.maxX() && xy[1] >= t.minY() && xy[1] <= t.maxY()) {
          return s;
        }
      }
    }
    return null;
  }

  private static void project(ImagerySet set, double lon, double lat, double[] xy) {
    if (set.crs() == ImagerySet.Crs.EPSG_3006) {
      Sweref99Tm.forward(lon, lat, xy);
    } else {
      xy[0] = lon;
      xy[1] = lat;
    }
  }

  /** The set's folder of a path {@code <set>/...}. */
  private static String set(String path) {
    int slash = path.indexOf('/');
    return slash < 0 ? path : path.substring(0, slash);
  }

  private static double distance(double lon1, double lat1, double lon2, double lat2) {
    double x = Math.toRadians(lon2 - lon1) * Math.cos(Math.toRadians((lat1 + lat2) / 2));
    double y = Math.toRadians(lat2 - lat1);
    return Math.hypot(x, y) * 6_371_009;
  }
}
