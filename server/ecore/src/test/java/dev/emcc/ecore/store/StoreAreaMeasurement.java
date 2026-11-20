package dev.emcc.ecore.store;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.ecore.geo.Cap;
import dev.emcc.ecore.geo.CapturedAreas;
import dev.emcc.ecore.geo.GeoArea;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Meta;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * The object store's area read for criterion 22 (owner, 2026-10-17): 200 000 symbols on the ITA's
 * grid over the world, read for zoomed-out views as the store does for {@link StoreMsg.GetArea}. On
 * demand only (the name does not end in Test, so the build does not run it):
 *
 * <pre>mvn -o -f server/pom.xml -pl ecore test -Dtest=StoreAreaMeasurement -Dsurefire.failIfNoSpecifiedTests=false</pre>
 *
 * Prints the median and the 95th percentile of each view; asserts that it finds what testing every
 * object finds, nothing about time.
 */
class StoreAreaMeasurement {

  private static final SecurityLabel LABEL = SecurityLabel.of("NATO", "UNCLASSIFIED");
  private static final Actor BY = Actor.plugin("core-shell");
  private static final Instant AT = Instant.parse("2026-10-17T12:00:00Z");
  private static final UUID LAYER = UUID.randomUUID();

  /** The ITA's `grid` (tests/integration/lib/load.mjs): cell centres of an even grid. */
  private static List<Position> grid(double west, double south, double east, double north, int count) {
    int columns = (int) Math.ceil(Math.sqrt(count * ((east - west) / (north - south))));
    int rows = (int) Math.ceil((double) count / columns);
    List<Position> out = new ArrayList<>(count);
    for (int i = 0; i < count; i++) {
      int column = i % columns;
      int row = i / columns;
      out.add(Position.of(west + (column + 0.5) * (east - west) / columns, south + (row + 0.5) * (north - south) / rows));
    }
    return out;
  }

  private static MapObject symbol(Position at) {
    return new MapObject(UUID.randomUUID(), 1, new MapObjectContent(MapObjectContent.SYMBOL, "core.general", "manual", null, LAYER,
        new Geometry.Point(at), new Symbol(SymbolStandard.APP_6D, "10031000001211000000", null), null, null, LABEL, Extensions.empty()),
        new Meta(new Meta.Audit(AT, BY), new Meta.Audit(AT, BY), null));
  }

  /** A view's ring with `samples` positions per edge, as map-view-2d sends it (west to east along the south edge first). */
  private static GeoArea view(double west, double south, double east, double north, Position inside, int samples, double marginShare) {
    List<Position> ring = new ArrayList<>();
    for (int k = 0; k < samples; k++) {
      ring.add(Position.of(west + (east - west) * k / samples, south));
    }
    for (int k = 0; k < samples; k++) {
      ring.add(Position.of(east, south + (north - south) * k / samples));
    }
    for (int k = 0; k < samples; k++) {
      ring.add(Position.of(east - (east - west) * k / samples, north));
    }
    for (int k = 0; k < samples; k++) {
      ring.add(Position.of(west, north - (north - south) * k / samples));
    }
    ring.add(ring.getFirst());
    return new GeoArea(ring, inside, 0, marginShare);
  }

  private static String ms(long[] nanos) {
    long[] sorted = nanos.clone();
    Arrays.sort(sorted);
    return String.format(Locale.ROOT, "%.1f / %.1f ms", sorted[sorted.length / 2] / 1e6, sorted[(int) (sorted.length * 0.95)] / 1e6);
  }

  @Test
  void criterion22() {
    List<MapObject> objects = grid(-170.5, -60.25, 170.5, 70.25, 200_000).stream().map(StoreAreaMeasurement::symbol).toList();
    PictureState state = PictureState.of(new PictureSnapshot(1, List.of(), objects));
    ObjectStore store = new ObjectStore(state, null, null, null);

    record Case(String name, GeoArea area) {}
    List<Case> cases = List.of(
        new Case("map-view-2d's widest view (216 positions), margin 0.5", CapturedAreas.criterion22View()),
        new Case("whole Web Mercator world, 8 per edge, margin 0.5", view(-180, -85.05, 180, 85.05, Position.of(0, 0), 8, 0.5)),
        new Case("whole Web Mercator world, 8 per edge, no margin", view(-180, -85.05, 180, 85.05, Position.of(0, 0), 8, 0)),
        new Case("whole world, 64 per edge (256 positions), margin 0.5", view(-180, -85.05, 180, 85.05, Position.of(0, 0), 64, 0.5)),
        new Case("zoom 2 around Stockholm, 8 per edge, margin 0.5", view(-90, 10, 126, 80, Position.of(18, 59), 8, 0.5)));
    System.out.printf(Locale.ROOT, "%n== criterion 22's area read: %d objects ==%n", objects.size());
    for (Case c : cases) {
      int rounds = 15;
      long[] times = new long[rounds];
      int found = 0;
      for (int r = 0; r < rounds; r++) {
        long t0 = System.nanoTime();
        AreaSnapshot snapshot = store.area(c.area(), true);
        times[r] = System.nanoTime() - t0;
        found = snapshot.objects().size();
      }
      Cap bound = c.area().bound();
      long brute = objects.stream().filter(o -> c.area().matches(o.content().geometry())).count();
      assertThat(found).as(c.name()).isEqualTo((int) brute);
      System.out.printf(Locale.ROOT, "%-55s %7d objects (each tested: %d)  %s  (bound radius %.2f rad)%n", c.name(), found, brute, ms(times),
          bound.radius());
    }
  }
}
