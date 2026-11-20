package dev.emcc.ecore.live;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.ecore.geo.Cap;
import dev.emcc.ecore.geo.GeoArea;
import dev.emcc.ecore.store.StoreChange;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.ChangeEvent;
import dev.emcc.sdk.model.EntityType;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.LayerContent;
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
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.UUID;
import java.util.stream.Collectors;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;

/** One area subscription's view: what its browser holds after every batch, move and switch. */
class AreaViewTest {

  private static final SecurityLabel LABEL = SecurityLabel.of("NATO", "UNCLASSIFIED");
  private static final Actor BY = Actor.plugin("cot");
  private static final Instant AT = Instant.parse("2026-10-12T12:00:00Z");
  private static final UUID LAYER = UUID.randomUUID();
  private static final UUID OTHER_LAYER = UUID.randomUUID();
  /** About 110 × 110 km around Stockholm. */
  private static final GeoArea STOCKHOLM = square(18.0, 59.3, 0.5);
  /** About 30 m per pixel: cells of about 2 km (level 12). */
  private static final double ZOOMED_IN = 30;
  /** About 300 m per pixel: cells of about 19 km (level 9). */
  private static final double ZOOMED_OUT = 300;

  private static GeoArea square(double lon, double lat, double half) {
    return new GeoArea(List.of(Position.of(lon - half, lat - half), Position.of(lon + half, lat - half), Position.of(lon + half, lat + half),
        Position.of(lon - half, lat + half), Position.of(lon - half, lat - half)), Position.of(lon, lat), 0, 0);
  }

  /** The centre of the cluster cell (at {@link #ZOOMED_OUT}) that holds this position: nearby points share its cell. */
  private static Position cellCentre(double lon, double lat) {
    dev.emcc.ecore.geo.CubeCells cells = new dev.emcc.ecore.geo.CubeCells(new AreaView(STOCKHOLM, ZOOMED_OUT, 1).level());
    double[] v = dev.emcc.ecore.geo.Sphere.vec(lon, lat);
    Cap cap = cells.cap(cells.cell(v[0], v[1], v[2]));
    return Position.of(dev.emcc.ecore.geo.Sphere.lon(cap.x(), cap.y()), dev.emcc.ecore.geo.Sphere.lat(cap.x(), cap.y(), cap.z()));
  }

  private static final Position CROWD = cellCentre(18.0, 59.3);

  // ---- A small object store: makes the changes, with the bounds the real one adds -----------------

  private final Map<UUID, MapObject> objects = new LinkedHashMap<>();
  private long sequenceNo;

  private static MapObjectContent content(UUID layer, double lon, double lat, String identity) {
    return new MapObjectContent(MapObjectContent.SYMBOL, MapObjectContent.GENERAL, MapObjectContent.MANUAL, null, layer,
        new Geometry.Point(Position.of(lon, lat)), new Symbol(SymbolStandard.APP_6D, "100" + identity + "1000001211000000", null), null, null,
        LABEL, Extensions.empty());
  }

  private StoreChange create(UUID id, double lon, double lat) {
    return create(id, LAYER, lon, lat, "3");
  }

  private StoreChange create(UUID id, UUID layer, double lon, double lat, String identity) {
    MapObject o = new MapObject(id, 1, content(layer, lon, lat, identity), new Meta(new Meta.Audit(AT, BY), new Meta.Audit(AT, BY), null));
    objects.put(id, o);
    return new StoreChange(new ChangeEvent(++sequenceNo, UUID.randomUUID(), EntityType.OBJECT, Operation.CREATE, id, 1, null, null, o, LABEL, AT, BY),
        null, null, Cap.of(o.content().geometry()));
  }

  private StoreChange move(UUID id, double lon, double lat) {
    MapObject before = objects.get(id);
    MapObject o = new MapObject(id, before.version() + 1, content(before.content().layerId(), lon, lat, "3"), before.meta());
    objects.put(id, o);
    return new StoreChange(new ChangeEvent(++sequenceNo, UUID.randomUUID(), EntityType.OBJECT, Operation.UPDATE, id, o.version(),
        before.version(), before.version(), o, LABEL, AT, BY), before, Cap.of(before.content().geometry()), Cap.of(o.content().geometry()));
  }

  private StoreChange delete(UUID id) {
    MapObject before = objects.remove(id);
    return new StoreChange(new ChangeEvent(++sequenceNo, UUID.randomUUID(), EntityType.OBJECT, Operation.DELETE, id, before.version() + 1,
        before.version(), null, null, LABEL, AT, BY), before, Cap.of(before.content().geometry()), null);
  }

  private StoreChange layer() {
    UUID id = UUID.randomUUID();
    Layer layer = new Layer(id, 1, new LayerContent("Other", 2, true, LABEL, Extensions.empty()), new Meta(new Meta.Audit(AT, BY),
        new Meta.Audit(AT, BY), null));
    return StoreChange.of(new ChangeEvent(++sequenceNo, UUID.randomUUID(), EntityType.LAYER, Operation.CREATE, id, 1, null, null, layer, LABEL,
        AT, BY));
  }

  /** Made by the fill worker and taken over by the session ({@link AreaView#of}), not filled in place (T-047, rule C7). */
  private boolean viaFillWorker;

  private AreaView view(GeoArea area, double resolution, int budget) {
    List<MapObject> in = new ArrayList<>();
    List<Cap> bounds = new ArrayList<>();
    for (MapObject o : objects.values()) {
      Cap bound = Cap.of(o.content().geometry());
      if (area.matches(bound)) {
        in.add(o);
        bounds.add(bound);
      }
    }
    if (viaFillWorker) {
      return AreaView.of(AreaView.filled(area, resolution, budget, in, bounds));
    }
    AreaView view = new AreaView(area, resolution, budget);
    view.fill(in, bounds);
    return view;
  }

  // ---- A browser that applies what it is sent --------------------------------------------------

  private static final class Browser {
    final Map<UUID, Long> held = new HashMap<>();
    final Map<String, Integer> clusters = new HashMap<>();
    int level = -1;

    Browser(AreaView view) {
      view.singles().forEach(o -> held.put(o.id(), o.version()));
      apply(null, view.fullClusters());
    }

    void apply(AreaView.Update update) {
      for (ChangeEvent e : update.events()) {
        if (e.entityType() == EntityType.OBJECT) {
          if (e.operation() == Operation.DELETE) {
            assertThat(held).as("a delete for an object the browser holds").containsKey(e.entityId());
            held.remove(e.entityId());
          } else {
            held.put(e.entityId(), e.version());
          }
        }
      }
      update.left().forEach(id -> assertThat(held.remove(id)).as("left " + id + " was held").isNotNull());
      update.entered().forEach(o -> held.put(o.id(), o.version()));
      apply(update, update.clusters());
    }

    void apply(AreaView.@Nullable Update update, AreaView.@Nullable Clusters c) {
      if (c == null) {
        return;
      }
      if (c.full()) {
        clusters.clear();
        level = c.level();
      } else {
        assertThat(c.level()).isEqualTo(level);
      }
      c.remove().forEach(cell -> assertThat(clusters.remove(cell)).as("removed cluster " + cell + " was held").isNotNull());
      c.upsert().forEach(cluster -> clusters.put(cluster.cell(), cluster.count()));
    }
  }

  /** The browser holds exactly the view's single objects at their versions, and its clusters. */
  private static void assertInStep(Browser browser, AreaView view) {
    assertThat(view.shownIsCurrent()).as("the shown set follows every change").isTrue();
    assertThat(browser.held).isEqualTo(view.singles().stream().collect(Collectors.toMap(MapObject::id, MapObject::version)));
    Map<String, Integer> clusters = view.fullClusters().upsert().stream()
        .collect(Collectors.toMap(AreaView.ClusterOut::cell, AreaView.ClusterOut::count));
    assertThat(browser.clusters).isEqualTo(clusters);
    int clustered = clusters.values().stream().mapToInt(Integer::intValue).sum();
    assertThat(browser.held.size() + clustered).as("every object is held or counted once").isEqualTo(view.memberCount());
  }

  // ---- Tests ------------------------------------------------------------------------------------

  @Test
  void eventsGoForObjectsInTheAreaAndOneThatLeavesIsSentAsLeftNotDeleted() {
    UUID inside = UUID.randomUUID();
    UUID leaving = UUID.randomUUID();
    UUID outside = UUID.randomUUID();
    UUID deleted = UUID.randomUUID();
    create(inside, 18.0, 59.3);
    create(leaving, 18.1, 59.4);
    create(deleted, 17.9, 59.2);
    create(outside, 59.3, 18.0); // latitude and longitude swapped: far away
    AreaView view = view(STOCKHOLM, ZOOMED_IN, 100);
    Browser browser = new Browser(view);
    assertThat(browser.held).containsOnlyKeys(inside, leaving, deleted);

    StoreChange layer = layer();
    StoreChange moveInside = move(inside, 18.05, 59.31);
    StoreChange moveOut = move(leaving, 11.97, 57.71);
    StoreChange moveOutside = move(outside, 60, 19);
    StoreChange delete = delete(deleted);
    UUID entering = UUID.randomUUID();
    StoreChange create = create(entering, 18.2, 59.5);
    AreaView.Update update = view.apply(List.of(layer, moveInside, moveOut, moveOutside, delete, create));

    assertThat(update.events()).containsExactly(layer.event(), moveInside.event(), delete.event(), create.event());
    assertThat(update.left()).containsExactly(leaving);
    assertThat(update.entered()).isEmpty();
    assertThat(update.clusters()).isNull();
    browser.apply(update);
    assertInStep(browser, view);
  }

  @Test
  void aboveTheBudgetDenseCellsBecomeClustersWithCountsAndSparseOnesStayObjects() {
    List<UUID> crowd = new ArrayList<>();
    for (int i = 0; i < 6; i++) { // one dense cell near the centre: 6 objects within 1 km
      UUID id = UUID.randomUUID();
      crowd.add(id);
      create(id, i < 4 ? LAYER : OTHER_LAYER, CROWD.longitude() + i * 0.001, CROWD.latitude(), i < 2 ? "6" : "3");
    }
    UUID lonely = UUID.randomUUID();
    create(lonely, 18.4, 59.7); // its own cell
    AreaView view = view(STOCKHOLM, ZOOMED_OUT, 5);

    assertThat(view.clustered()).isTrue();
    assertThat(view.singles()).extracting(MapObject::id).containsExactly(lonely);
    AreaView.Clusters full = view.fullClusters();
    assertThat(full.full()).isTrue();
    assertThat(full.upsert()).singleElement().satisfies(c -> {
      assertThat(c.count()).isEqualTo(6);
      assertThat(c.byLayer()).isEqualTo(Map.of(LAYER, 4, OTHER_LAYER, 2));
      assertThat(c.byIdentity()).containsExactly(4, 2, 0, 0); // friend, hostile, neutral, unknown
      assertThat(c.lon()).isBetween(CROWD.longitude(), CROWD.longitude() + 0.006);
      assertThat(c.lat()).isCloseTo(CROWD.latitude(), org.assertj.core.data.Offset.offset(1e-6));
    });
  }

  @Test
  void aCellThatFallsToThreeSendsItsObjectsAndOneThatGrowsToFourTakesThemBack() {
    List<UUID> crowd = new ArrayList<>();
    for (int i = 0; i < 4; i++) {
      UUID id = UUID.randomUUID();
      crowd.add(id);
      create(id, CROWD.longitude() + i * 0.001, CROWD.latitude());
    }
    create(UUID.randomUUID(), 17.6, 58.9); // three cells of one each
    create(UUID.randomUUID(), 18.4, 58.9);
    create(UUID.randomUUID(), 17.6, 59.7);
    AreaView view = view(STOCKHOLM, ZOOMED_OUT, 5);
    Browser browser = new Browser(view);
    assertThat(browser.clusters).hasSize(1);

    AreaView.Update falls = view.apply(List.of(delete(crowd.getFirst())));
    assertThat(falls.events()).isEmpty(); // the deleted one was in the cluster: not held
    assertThat(falls.entered()).extracting(MapObject::id).containsExactlyInAnyOrderElementsOf(crowd.subList(1, 4));
    assertThat(falls.clusters().remove()).hasSize(1);
    browser.apply(falls);
    assertInStep(browser, view);

    UUID fourth = UUID.randomUUID();
    AreaView.Update grows = view.apply(List.of(create(fourth, CROWD.longitude() + 0.0005, CROWD.latitude())));
    assertThat(grows.events()).as("the new object is in a cluster").isEmpty();
    assertThat(grows.left()).containsExactlyInAnyOrderElementsOf(crowd.subList(1, 4));
    assertThat(grows.clusters().upsert()).singleElement().satisfies(c -> assertThat(c.count()).isEqualTo(4));
    browser.apply(grows);
    assertInStep(browser, view);
  }

  @Test
  void passingTheBudgetSwitchesToClustersAndBelowNinetyPercentBack() {
    List<UUID> ids = new ArrayList<>();
    for (int i = 0; i < 10; i++) {
      UUID id = UUID.randomUUID();
      ids.add(id);
      create(id, CROWD.longitude() + i * 0.0005, CROWD.latitude());
    }
    AreaView view = view(STOCKHOLM, ZOOMED_OUT, 10);
    Browser browser = new Browser(view);
    assertThat(view.clustered()).isFalse();

    AreaView.Update over = view.apply(List.of(create(UUID.randomUUID(), CROWD.longitude(), CROWD.latitude() + 0.0005)));
    assertThat(view.clustered()).isTrue();
    assertThat(over.clusters().full()).isTrue();
    browser.apply(over);
    assertInStep(browser, view);
    assertThat(browser.held).isEmpty();

    AreaView.Update stillOver = view.apply(List.of(delete(ids.get(0)), delete(ids.get(1)))); // 9: not below 90 %
    assertThat(view.clustered()).isTrue();
    browser.apply(stillOver);

    AreaView.Update back = view.apply(List.of(delete(ids.get(2)))); // 8
    assertThat(view.clustered()).isFalse();
    assertThat(back.clusters().full()).isTrue();
    assertThat(back.clusters().upsert()).isEmpty();
    browser.apply(back);
    assertInStep(browser, view);
    assertThat(browser.held).hasSize(8);
  }

  @Test
  void aMoveSendsTheObjectsThatEnteredAndTheIdsThatLeftNotASnapshot() {
    UUID west = UUID.randomUUID();
    UUID middle = UUID.randomUUID();
    UUID east = UUID.randomUUID();
    create(west, 17.6, 59.3);
    create(middle, 18.2, 59.3);
    create(east, 18.8, 59.3);
    AreaView before = view(square(17.8, 59.3, 0.5), ZOOMED_IN, 100);
    Browser browser = new Browser(before);
    assertThat(browser.held).containsOnlyKeys(west, middle);
    StoreChange moved = move(middle, 18.25, 59.3);
    browser.apply(before.apply(List.of(moved)));

    AreaView after = view(square(18.6, 59.3, 0.5), ZOOMED_IN, 100);
    AreaView.Update update = after.movedFrom(before);

    assertThat(update.entered()).extracting(MapObject::id).containsExactly(east);
    assertThat(update.left()).containsExactly(west);
    assertThat(update.clusters()).isNull();
    browser.apply(update);
    assertInStep(browser, after);
  }

  @Test
  void aMoveBetweenViewsBroughtToTheSameChangeSendsANewerVersionAsEntered() {
    UUID id = UUID.randomUUID();
    create(id, 18.0, 59.3);
    AreaView before = view(STOCKHOLM, ZOOMED_IN, 100);
    Browser browser = new Browser(before);
    move(id, 18.01, 59.3); // the new view's answer already holds it; the old view never saw the change

    AreaView after = view(square(18.1, 59.3, 0.5), ZOOMED_IN, 100);
    AreaView.Update update = after.movedFrom(before);

    assertThat(update.entered()).extracting(MapObject::version).containsExactly(2L);
    assertThat(update.left()).isEmpty();
    browser.apply(update);
    assertThat(browser.held).isEqualTo(Map.of(id, 2L));
  }

  @Test
  void aBrowserFollowingRandomBatchesAndMovesAlwaysHoldsWhatTheViewShows() {
    followRandomBatchesAndMoves(new Random(20261012));
  }

  @Test
  void soItDoesWithViewsTheFillWorkerMade() {
    viaFillWorker = true;
    followRandomBatchesAndMoves(new Random(20261012));
    followRandomBatchesAndMoves(new Random(47));
  }

  private void followRandomBatchesAndMoves(Random random) {
    objects.clear();
    List<UUID> ids = new ArrayList<>();
    for (int i = 0; i < 150; i++) {
      UUID id = UUID.randomUUID();
      ids.add(id);
      create(id, 18.0 + random.nextGaussian() * 0.4, 59.3 + random.nextGaussian() * 0.2);
    }
    AreaView view = view(STOCKHOLM, ZOOMED_OUT, 40);
    Browser browser = new Browser(view);
    for (int round = 0; round < 300; round++) {
      if (round % 25 == 24) { // the view moves (and zooms)
        AreaView next = view(square(18.0 + random.nextGaussian() * 0.3, 59.3 + random.nextGaussian() * 0.1, 0.3 + random.nextDouble() * 0.4),
            random.nextBoolean() ? ZOOMED_OUT : ZOOMED_IN * 3, 20 + random.nextInt(60));
        browser.apply(next.movedFrom(view));
        view = next;
        assertInStep(browser, view);
        continue;
      }
      List<StoreChange> batch = new ArrayList<>();
      for (int k = random.nextInt(12); k >= 0; k--) {
        double r = random.nextDouble();
        if (r < 0.15 || ids.isEmpty()) {
          UUID id = UUID.randomUUID();
          ids.add(id);
          batch.add(create(id, 18.0 + random.nextGaussian() * 0.4, 59.3 + random.nextGaussian() * 0.2));
        } else if (r < 0.25) {
          batch.add(delete(ids.remove(random.nextInt(ids.size()))));
        } else {
          UUID id = ids.get(random.nextInt(ids.size()));
          MapObject o = objects.get(id);
          Position p = ((Geometry.Point) o.content().geometry()).coordinates();
          batch.add(move(id, p.longitude() + random.nextGaussian() * 0.05, Math.max(-89, Math.min(89, p.latitude() + random.nextGaussian() * 0.03))));
        }
      }
      browser.apply(view.apply(batch));
      assertInStep(browser, view);
    }
  }
}
