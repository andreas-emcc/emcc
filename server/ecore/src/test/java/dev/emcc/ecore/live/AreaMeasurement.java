package dev.emcc.ecore.live;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.ecore.geo.Cap;
import dev.emcc.ecore.geo.GeoArea;
import dev.emcc.ecore.store.PictureSnapshot;
import dev.emcc.ecore.store.PictureState;
import dev.emcc.ecore.store.StoreChange;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.ChangeEvent;
import dev.emcc.sdk.model.EntityType;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Meta;
import dev.emcc.sdk.model.Operation;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Random;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * T-039: the production code against spike S3's thresholds (spikes/s3/README.md), on demand only
 * (the name does not end in Test, so the build does not run it):
 *
 * <pre>mvn -o -f server/pom.xml -pl ecore test -Dtest=AreaMeasurement -Dsurefire.failIfNoSpecifiedTests=false</pre>
 *
 * A BALTIC-like picture (12 hot spots plus a thin background over Scandinavia and the Baltic, 10
 * layers, points), views of 1 280 × 800 px in Web Mercator around Stockholm. Prints medians and the
 * 95th percentile; asserts only S3's structural bound of drawn items.
 */
class AreaMeasurement {

  private static final SecurityLabel LABEL = SecurityLabel.of("NATO", "UNCLASSIFIED");
  private static final Actor BY = Actor.plugin("cot");
  private static final Instant AT = Instant.parse("2026-10-12T12:00:00Z");
  private static final double[][] HOT_SPOTS = {
    {18.07, 59.33}, {10.75, 59.91}, {12.57, 55.68}, {24.94, 60.17}, {11.97, 57.71}, {21.01, 52.23},
    {24.11, 56.95}, {25.28, 54.69}, {13.40, 52.52}, {20.46, 54.71}, {15.60, 56.16}, {22.27, 60.45}};
  private static final UUID[] LAYERS = new UUID[10];

  static {
    for (int i = 0; i < LAYERS.length; i++) {
      LAYERS[i] = UUID.randomUUID();
    }
  }

  private final Random random = new Random(20261012);

  private Position position() {
    if (random.nextDouble() < 0.1) { // the thin background
      return Position.of(5 + random.nextDouble() * 30, 50 + random.nextDouble() * 20);
    }
    double[] spot = HOT_SPOTS[random.nextInt(HOT_SPOTS.length)];
    return Position.of(spot[0] + random.nextGaussian() * 0.6, Math.max(-89, Math.min(89, spot[1] + random.nextGaussian() * 0.3)));
  }

  private MapObject object(UUID id, long version, Position at) {
    String identity = String.valueOf("2346".charAt(random.nextInt(4)));
    return new MapObject(id, version, new MapObjectContent(MapObjectContent.SYMBOL, "cot.track", "tak", null,
        LAYERS[random.nextInt(LAYERS.length)], new Geometry.Point(at),
        new Symbol(SymbolStandard.APP_6D, "100" + identity + "1000001211000000", null), null, null, LABEL, Extensions.empty()),
        new Meta(new Meta.Audit(AT, BY), new Meta.Audit(AT, BY), null));
  }

  /** The view at a Web Mercator zoom level around (lon, lat): its ring (8 points per edge) and resolution. */
  private static GeoArea view(double lon, double lat, double zoom, double marginShare) {
    double metresPerPixel = 156_543.03392 * Math.cos(Math.toRadians(lat)) / Math.pow(2, zoom);
    double halfWidthDeg = 640 * 156_543.03392 / Math.pow(2, zoom) / 111_319.49;
    double halfHeightMercator = 400 * 156_543.03392 / Math.pow(2, zoom);
    double yCentre = Math.log(Math.tan(Math.PI / 4 + Math.toRadians(lat) / 2)) * 6_378_137;
    double south = Math.toDegrees(2 * Math.atan(Math.exp((yCentre - halfHeightMercator) / 6_378_137)) - Math.PI / 2);
    double north = Math.toDegrees(2 * Math.atan(Math.exp((yCentre + halfHeightMercator) / 6_378_137)) - Math.PI / 2);
    double west = Math.max(-180, lon - halfWidthDeg);
    double east = Math.min(180, lon + halfWidthDeg);
    List<Position> ring = new ArrayList<>();
    for (int k = 0; k < 8; k++) {
      ring.add(Position.of(west + (east - west) * k / 8, south));
    }
    for (int k = 0; k < 8; k++) {
      ring.add(Position.of(east, south + (north - south) * k / 8));
    }
    for (int k = 0; k < 8; k++) {
      ring.add(Position.of(east - (east - west) * k / 8, north));
    }
    for (int k = 0; k < 8; k++) {
      ring.add(Position.of(west, north - (north - south) * k / 8));
    }
    ring.add(ring.getFirst());
    assertThat(metresPerPixel).isPositive();
    return new GeoArea(ring, Position.of(lon, lat), 0, marginShare);
  }

  private static double metresPerPixel(double lat, double zoom) {
    return 156_543.03392 * Math.cos(Math.toRadians(lat)) / Math.pow(2, zoom);
  }

  private static String ms(long[] nanos) {
    long[] sorted = nanos.clone();
    Arrays.sort(sorted);
    return String.format(Locale.ROOT, "%.2f / %.2f ms", sorted[sorted.length / 2] / 1e6, sorted[(int) (sorted.length * 0.95)] / 1e6);
  }

  private static long usedHeap() {
    for (int i = 0; i < 3; i++) {
      System.gc();
    }
    Runtime r = Runtime.getRuntime();
    return r.totalMemory() - r.freeMemory();
  }

  @Test
  void againstTheThresholdsOfSpikeS3() {
    int count = 200_000;
    List<MapObject> objects = new ArrayList<>(count);
    for (int i = 0; i < count; i++) {
      objects.add(object(UUID.randomUUID(), 1, position()));
    }
    long built = System.nanoTime();
    PictureState state = PictureState.of(new PictureSnapshot(1, List.of(), objects));
    System.out.printf(Locale.ROOT, "%n== T-039 against S3: %d objects, BALTIC-like ==%nbuilt the picture and its index in %.0f ms%n",
        count, (System.nanoTime() - built) / 1e6);

    System.out.println("| Zoom | Objects in area | Query, median / p95 | Fill + clusters, median / p95 | Drawn items (singles + clusters) | Level |");
    System.out.println("|---|---|---|---|---|---|");
    for (double zoom : new double[] {4, 6, 8, 10, 12}) {
      GeoArea area = view(18.07, 59.33, zoom, 0.5);
      int rounds = zoom <= 6 ? 15 : 40;
      long[] query = new long[rounds];
      long[] fill = new long[rounds];
      int inArea = 0;
      int drawn = 0;
      int level = 0;
      for (int r = 0; r < rounds; r++) {
        List<MapObject> found = new ArrayList<>();
        List<Cap> bounds = new ArrayList<>();
        long t0 = System.nanoTime();
        state.forEach(area, (o, b) -> {
          found.add(o);
          bounds.add(b);
        });
        long t1 = System.nanoTime();
        AreaView v = new AreaView(area, metresPerPixel(59.33, zoom), 10_000);
        v.fill(found, bounds);
        int items = v.singles().size() + v.fullClusters().upsert().size();
        long t2 = System.nanoTime();
        query[r] = t1 - t0;
        fill[r] = t2 - t1;
        inArea = found.size();
        drawn = items;
        level = v.clustered() ? v.level() : -1;
      }
      System.out.printf(Locale.ROOT, "| %.0f | %d | %s | %s | %d | %s |%n", zoom, inArea, ms(query), ms(fill), drawn,
          level < 0 ? "objects" : String.valueOf(level));
      assertThat(drawn).as("S3: at most about 4 100 drawn items at 200 000 objects").isLessThanOrEqualTo(4_500);
    }

    // T-047, rule C7: the fill worker's part (AreaView.filled) against the session's (AreaView.of, and movedFrom for a move).
    System.out.println("| Zoom | Objects in area | Fill worker: filled, median / p95 | Session: of, median / p95 | Session: of + movedFrom, median / p95 |");
    System.out.println("|---|---|---|---|---|");
    for (double zoom : new double[] {4, 6, 8}) {
      GeoArea area = view(18.07, 59.33, zoom, 0.5);
      GeoArea shifted = view(18.27, 59.38, zoom, 0.5);
      List<MapObject> found = new ArrayList<>();
      List<Cap> bounds = new ArrayList<>();
      state.forEach(area, (o, b) -> {
        found.add(o);
        bounds.add(b);
      });
      List<MapObject> found2 = new ArrayList<>();
      List<Cap> bounds2 = new ArrayList<>();
      state.forEach(shifted, (o, b) -> {
        found2.add(o);
        bounds2.add(b);
      });
      AreaView old = AreaView.of(AreaView.filled(area, metresPerPixel(59.33, zoom), 10_000, found, bounds));
      int rounds = 15;
      long[] filled = new long[rounds];
      long[] of = new long[rounds];
      long[] moved = new long[rounds];
      for (int r = 0; r < rounds; r++) {
        long t0 = System.nanoTime();
        AreaView.Filled f = AreaView.filled(shifted, metresPerPixel(59.33, zoom), 10_000, found2, bounds2);
        long t1 = System.nanoTime();
        AreaView view = AreaView.of(f);
        long t2 = System.nanoTime();
        view.movedFrom(old);
        long t3 = System.nanoTime();
        filled[r] = t1 - t0;
        of[r] = t2 - t1;
        moved[r] = t3 - t1;
      }
      System.out.printf(Locale.ROOT, "| %.0f | %d | %s | %s | %s |%n", zoom, found2.size(), ms(filled), ms(of), ms(moved));
    }

    // The worst area a browser may send: the whole world as a ring of the most positions (conformance review F1).
    for (int positions : new int[] {64, 256, 1_024, 8_192}) {
      List<Position> ring = new ArrayList<>();
      for (int k = 0; k < positions - 1; k++) {
        ring.add(Position.of(-180 + 360.0 * k / (positions - 1), -89.9 + 0.05 * Math.sin(k)));
      }
      ring.add(ring.getFirst());
      GeoArea world = new GeoArea(ring, Position.of(18, 59), 0, 0);
      long[] query = new long[5];
      int[] found = new int[1];
      for (int r = 0; r < query.length; r++) {
        found[0] = 0;
        long t0 = System.nanoTime();
        state.forEach(world, (o, b) -> found[0]++);
        query[r] = System.nanoTime() - t0;
      }
      System.out.printf(Locale.ROOT, "a whole-world ring of %d positions: %d objects, query %s%n", positions, found[0], ms(query));
    }

    // Memory of one zoomed-out subscription (owner, 2026-10-12: accept about 20 MB for M1, measure it).
    GeoArea wide = view(18.07, 59.33, 4, 0.5);
    List<MapObject> found = new ArrayList<>();
    List<Cap> bounds = new ArrayList<>();
    state.forEach(wide, (o, b) -> {
      found.add(o);
      bounds.add(b);
    });
    long before = usedHeap();
    AreaView held = new AreaView(wide, metresPerPixel(59.33, 4), 10_000);
    held.fill(found, bounds);
    long after = usedHeap();
    System.out.printf(Locale.ROOT, "one zoomed-out subscription (zoom 4, %d objects): about %.1f MB (rough, by the heap)%n",
        held.memberCount(), (after - before) / 1e6);

    // Live updates in clusters: batches of 200 and 1 000 track moves (S3 table "Live updates").
    for (int size : new int[] {200, 1_000}) {
      long[] apply = new long[50];
      int upserts = 0;
      long sequenceNo = 1;
      for (int b = 0; b < apply.length; b++) {
        List<StoreChange> batch = new ArrayList<>(size);
        for (int k = 0; k < size; k++) {
          int i = random.nextInt(found.size());
          MapObject old = found.get(i);
          Position p = ((Geometry.Point) old.content().geometry()).coordinates();
          MapObject moved = new MapObject(old.id(), old.version() + 1, new MapObjectContent(old.content().type(), old.content().dataType(),
              old.content().dataSource(), null, old.content().layerId(),
              new Geometry.Point(Position.of(p.longitude() + random.nextGaussian() * 0.001, p.latitude() + random.nextGaussian() * 0.0005)),
              old.content().symbol(), null, null, LABEL, Extensions.empty()), old.meta());
          found.set(i, moved);
          batch.add(new StoreChange(new ChangeEvent(++sequenceNo, UUID.randomUUID(), EntityType.OBJECT, Operation.UPDATE, old.id(),
              moved.version(), old.version(), old.version(), moved, LABEL, AT, BY), old, Cap.of(old.content().geometry()),
              Cap.of(moved.content().geometry())));
        }
        long t0 = System.nanoTime();
        AreaView.Update update = held.apply(batch);
        apply[b] = System.nanoTime() - t0;
        upserts += update.clusters() == null ? 0 : update.clusters().upsert().size();
      }
      System.out.printf(Locale.ROOT, "zoom 4, batches of %d moves: %s per batch, %.1f changed clusters per batch%n", size, ms(apply),
          upserts / 50.0);
    }
  }
}
