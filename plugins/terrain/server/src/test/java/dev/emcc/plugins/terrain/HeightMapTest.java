package dev.emcc.plugins.terrain;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.User;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.testkit.FakeHttpExchange;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.testkit.TestJson;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.function.IntBinaryOperator;
import org.assertj.core.data.Offset;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * The height map in a circle (the brief's function 10, T-166): criteria 15 (bands), 16 (a flat
 * circle, partly without data) and 17 (limits), through the endpoint with the test kit's fake context
 * and fake folders, and the sharing of the overlay's caps by the bands. Every position has a latitude
 * different from its longitude.
 */
class HeightMapTest {

  private static final User NOBODY = new User("nobody", "Nobody", Set.of(), false);
  private static final User ALICE = new User("alice", "Alice", Set.of(TerrainPlugin.PERMISSION), false);

  /** A level 0 cell at 59 degrees north has 61 columns and 121 rows; heights rise evenly from 100 m in the south to 260 m in the north. */
  private static final IntBinaryOperator RISING = (c, r) -> 100 + Math.floorDiv(160 * r, 120);

  @TempDir
  Path folder;

  private FakePluginContext ctx;

  // ---------------------------------------------------------------- helpers

  private void start(Path path, Object... overrides) throws Exception {
    JsonObject settings = Manifest.settingDefaults().with("heightDataFolder", JsonString.of(path.toString()));
    for (int i = 0; i < overrides.length; i += 2) {
      settings = settings.with((String) overrides[i], JsonNumber.of(((Number) overrides[i + 1]).longValue()));
    }
    ctx = FakePluginContext.builder(Manifest.id()).settings(settings).folder("heights", path).build();
    Plugin plugin = (Plugin) Class.forName(Manifest.entryClass()).getConstructor().newInstance();
    plugin.init(ctx);
    plugin.start();
    ctx.runUntilIdle();
  }

  private static JsonArray position(double lon, double lat) {
    return JsonArray.of(JsonNumber.of(lon), JsonNumber.of(lat));
  }

  private FakeHttpExchange heightMap(User user, double lon, double lat, double radius) {
    return ctx.post("/heightmap", JsonObject.builder().put("center", position(lon, lat)).put("radius", JsonNumber.of(radius)).build(), user);
  }

  private JsonObject answer(FakeHttpExchange exchange, int status) {
    ctx.runUntilIdle();
    assertThat(exchange.reply().status()).as(exchange.reply().body().toUtf8()).isEqualTo(status);
    return (JsonObject) TestJson.parse(exchange.reply().body().toUtf8());
  }

  private static double number(JsonObject body, String name) {
    return body.getNumber(name).doubleValue();
  }

  private static List<JsonObject> bands(JsonObject answer) {
    List<JsonObject> bands = new ArrayList<>();
    for (JsonValue band : ((JsonArray) answer.get("bands")).values()) {
      bands.add((JsonObject) band);
    }
    return bands;
  }

  /** The vertices of a band's areas, as {@code {lon, lat}}. */
  private static List<double[]> vertices(JsonObject band) {
    List<double[]> all = new ArrayList<>();
    for (JsonValue area : ((JsonArray) band.get("areas")).values()) {
      for (JsonValue ring : ((JsonArray) area).values()) {
        for (JsonValue p : ((JsonArray) ring).values()) {
          all.add(new double[] {((JsonNumber) ((JsonArray) p).get(0)).doubleValue(), ((JsonNumber) ((JsonArray) p).get(1)).doubleValue()});
        }
      }
    }
    return all;
  }

  /** What the map view's {@code overlayProblem} refuses: a ring that is not closed or has fewer than 4 positions, too many items or positions over all bands. */
  private static void assertOverlayAccepts(JsonObject answer) {
    int items = 0;
    int positions = 0;
    for (JsonObject band : bands(answer)) {
      for (JsonValue area : ((JsonArray) band.get("areas")).values()) {
        items++;
        assertThat(((JsonArray) area).size()).as("an area has an exterior").isPositive();
        for (JsonValue ring : ((JsonArray) area).values()) {
          JsonArray points = (JsonArray) ring;
          assertThat(points.size()).as("a ring has 4 positions at least").isGreaterThanOrEqualTo(4);
          assertThat(points.get(0).toString()).as("a ring is closed").isEqualTo(points.get(points.size() - 1).toString());
          positions += points.size();
        }
      }
    }
    assertThat(items).isLessThanOrEqualTo(20_000 - 100);
    assertThat(positions).isLessThanOrEqualTo(200_000 - 2_000);
    assertThat(answer.getNumber("positions").longValueExact()).isEqualTo(positions);
  }

  // ---------------------------------------------------------------- criterion 15: bands

  @Test
  void criterion15ARisingGridGivesSixteenBandsOfTenMetresFromSouthToNorth() throws Exception {
    DtedFiles.write(folder, 0, 18, 59, RISING);
    start(folder, "maxRange", 100_000L);
    // 70 km round the middle of the cell, which holds the whole cell (its corners are about 62 km away)
    JsonObject answer = answer(heightMap(ALICE, 18.5, 59.5, 70_000), 200);

    List<JsonObject> bands = bands(answer);
    assertThat(bands).hasSize(16);
    for (int b = 0; b < 16; b++) {
      JsonObject band = bands.get(b);
      assertThat(band.getNumber("index").longValueExact()).isEqualTo(b);
      assertThat(number(band, "lowest")).isCloseTo(100 + 10.0 * b, Offset.offset(1e-9));
      assertThat(number(band, "highest")).isCloseTo(110 + 10.0 * b, Offset.offset(1e-9));
      List<double[]> vertices = vertices(band);
      assertThat(vertices).as("band " + b + " has ground").isNotEmpty();
      // rows rise 160 m over 120 rows: band b holds the rows 7.5 b to 7.5 (b + 1), within a row's half
      double south = 59 + 7.5 * b / 120 - 0.5 / 120 - 0.001;
      double north = 59 + 7.5 * (b + 1) / 120 + 0.5 / 120 + 0.001;
      assertThat(vertices).allSatisfy(v -> assertThat(v[1]).isBetween(south, north));
    }
    // bands lie from south to north: each one's lowest vertex is no lower than the one below
    for (int b = 1; b < 16; b++) {
      double below = vertices(bands.get(b - 1)).stream().mapToDouble(v -> v[1]).min().orElseThrow();
      double here = vertices(bands.get(b)).stream().mapToDouble(v -> v[1]).min().orElseThrow();
      assertThat(here).isGreaterThan(below);
    }
    assertOverlayAccepts(answer);

    // the highest ground is on the data's north edge, 260 m, at a position with latitude different from longitude
    JsonObject highest = (JsonObject) answer.get("highest");
    assertThat(number(highest, "height")).isCloseTo(260, Offset.offset(1e-9));
    JsonArray at = (JsonArray) highest.get("position");
    assertThat(((JsonNumber) at.get(1)).doubleValue()).isCloseTo(60.0, Offset.offset(1e-6));
    assertThat(((JsonNumber) at.get(0)).doubleValue()).isBetween(18.0, 19.0);
    assertThat(number(answer, "lowest")).isCloseTo(100, Offset.offset(1e-9));
    assertThat(answer.getNumber("level").longValueExact()).isEqualTo(0);
    assertThat(answer.getBoolean("partlyWithoutData")).as("the circle reaches past the cell").isTrue();
    assertThat(ctx.handlerErrors()).isEmpty();
  }

  @Test
  void criterion15TheBandsOfAnEastRisingGridGoFromWestToEastWithTheLongitudeAndLatitudeApart() throws Exception {
    // heights rise with the column, so band edges are meridians: the first band is the western strip
    DtedFiles.write(folder, 0, 18, 59, (c, r) -> 50 + c * 2);
    start(folder, "maxRange", 100_000L);
    JsonObject answer = answer(heightMap(ALICE, 18.5, 59.5, 70_000), 200);
    List<JsonObject> bands = bands(answer);
    assertThat(bands).hasSize(16);
    double firstEast = vertices(bands.get(0)).stream().mapToDouble(v -> v[0]).max().orElseThrow();
    double lastWest = vertices(bands.get(15)).stream().mapToDouble(v -> v[0]).min().orElseThrow();
    assertThat(firstEast).isLessThan(18.1);
    assertThat(lastWest).isGreaterThan(18.9);
    JsonArray at = (JsonArray) ((JsonObject) answer.get("highest")).get("position");
    assertThat(((JsonNumber) at.get(0)).doubleValue()).isCloseTo(19.0, Offset.offset(1e-6));
  }

  // ---------------------------------------------------------------- criterion 16: flat, partly without data

  @Test
  void criterion16AFlatCircleGivesOneBandAndTheHeightOfIt() throws Exception {
    DtedFiles.write(folder, 1, 18, 59, (c, r) -> 12);
    start(folder);
    JsonObject answer = answer(heightMap(ALICE, 18.4, 59.4, 5_000), 200);
    List<JsonObject> bands = bands(answer);
    assertThat(bands).hasSize(1);
    assertThat(number(bands.get(0), "lowest")).isEqualTo(12);
    assertThat(number(bands.get(0), "highest")).isEqualTo(12);
    assertThat(number((JsonObject) answer.get("highest"), "height")).isEqualTo(12);
    assertThat(number(answer, "lowest")).isEqualTo(12);
    assertThat(answer.getBoolean("partlyWithoutData")).isFalse();
    // one disc of ground: one area, about pi r squared
    JsonArray areas = (JsonArray) bands.get(0).get("areas");
    assertThat(areas.size()).isEqualTo(1);
    assertOverlayAccepts(answer);
    double lonSpan = vertices(bands.get(0)).stream().mapToDouble(v -> v[0]).max().orElseThrow() - vertices(bands.get(0)).stream().mapToDouble(v -> v[0]).min().orElseThrow();
    // 10 km across at 59.4 degrees north is about 0.176 degrees of longitude
    assertThat(lonSpan).isBetween(0.16, 0.19);
  }

  @Test
  void criterion16AVoidInsideTheCircleIsLeftOutAndTheAnswerSaysPartlyWithoutData() throws Exception {
    // the eastern half of the cell has no data
    DtedFiles.write(folder, 0, 18, 59, (c, r) -> c > 30 ? DtedFiles.VOID : 100 + r);
    start(folder, "maxRange", 100_000L);
    JsonObject answer = answer(heightMap(ALICE, 18.5, 59.5, 40_000), 200);
    assertThat(answer.getBoolean("partlyWithoutData")).isTrue();
    List<double[]> all = new ArrayList<>();
    for (JsonObject band : bands(answer)) {
      all.addAll(vertices(band));
    }
    assertThat(all).isNotEmpty();
    assertThat(all.stream().mapToDouble(v -> v[0]).max().orElseThrow()).as("no ground east of the data").isLessThanOrEqualTo(18.5 + 0.02);
    assertThat(all.stream().mapToDouble(v -> v[0]).min().orElseThrow()).isLessThan(18.2);
  }

  @Test
  void aCircleWithNoGroundWithDataInsideIsRefusedWith404() throws Exception {
    DtedFiles.write(folder, 1, 18, 59, (c, r) -> DtedFiles.VOID);
    start(folder);
    assertThat(((JsonString) answer(heightMap(ALICE, 18.4, 59.4, 2_000), 404).get("error")).value()).contains("no height data");
  }

  @Test
  void aCircleWithNoCellAtItsCentreIsRefusedWith404() throws Exception {
    DtedFiles.write(folder, 1, 18, 59, (c, r) -> 12);
    start(folder);
    assertThat(((JsonString) answer(heightMap(ALICE, 30.5, 60.1, 2_000), 404).get("error")).value()).contains("circle's centre");
  }

  // ---------------------------------------------------------------- criterion 17: limits

  @Test
  void criterion17ARadiusOutsideTheLimitsIsRefusedWithItsReason() throws Exception {
    DtedFiles.write(folder, 1, 18, 59, (c, r) -> 12);
    start(folder);
    assertThat(((JsonString) answer(heightMap(ALICE, 18.4, 59.4, 50_001), 400).get("error")).value()).contains("radius").contains("50000");
    assertThat(((JsonString) answer(heightMap(ALICE, 18.4, 59.4, 99), 400).get("error")).value()).contains("radius").contains("100");
    answer(ctx.post("/heightmap", JsonObject.builder().put("center", position(181, 59.4)).put("radius", JsonNumber.of(1_000)).build(), ALICE), 400);
    answer(ctx.post("/heightmap", JsonObject.builder().put("radius", JsonNumber.of(1_000)).build(), ALICE), 400);
    answer(ctx.post("/heightmap", JsonObject.builder().put("center", position(18.4, 59.4)).build(), ALICE), 400);
    // the admin's maximum applies
    ctx = null;
    start(folder, "maxRange", 20_000L);
    answer(heightMap(ALICE, 18.4, 59.4, 20_000), 200);
    assertThat(((JsonString) answer(heightMap(ALICE, 18.4, 59.4, 20_001), 400).get("error")).value()).contains("20000");
  }

  @Test
  void criterion17AHeightMapWhileTheSameUsersViewshedRunsIsRefusedAndTheOtherWayRound() throws Exception {
    DtedFiles.write(folder, 1, 18, 59, (c, r) -> 12);
    DtedFiles.write(folder, 1, 17, 59, (c, r) -> 12);
    start(folder);
    ctx.folders().hold(); // the viewshed waits for its cell
    FakeHttpExchange viewshed = ctx.post("/viewshed",
        JsonObject.builder().put("observer", position(18.4, 59.4)).put("observerHeight", JsonNumber.of(2)).put("targetHeight", JsonNumber.of(2)).put("maxRange", JsonNumber.of(3_000)).build(), ALICE);
    ctx.runUntilIdle();
    assertThat(viewshed.isAnswered()).isFalse();
    JsonObject refused = answer(heightMap(ALICE, 18.5, 59.5, 3_000), 409);
    assertThat(((JsonString) refused.get("error")).value()).isEqualTo("a viewshed is already running for you");
    ctx.folders().release();
    ctx.runUntilIdle();
    assertThat(viewshed.reply().status()).isEqualTo(200);

    // and a viewshed while the user's height map runs
    ctx.folders().hold();
    FakeHttpExchange map = heightMap(ALICE, 17.4, 59.4, 3_000); // in a cell that is not in the cache yet
    ctx.runUntilIdle();
    assertThat(map.isAnswered()).isFalse();
    FakeHttpExchange second = ctx.post("/viewshed",
        JsonObject.builder().put("observer", position(18.5, 59.5)).put("observerHeight", JsonNumber.of(2)).put("targetHeight", JsonNumber.of(2)).put("maxRange", JsonNumber.of(3_000)).build(), ALICE);
    ctx.runUntilIdle();
    assertThat(second.reply().status()).isEqualTo(409);
    assertThat(((JsonString) ((JsonObject) TestJson.parse(second.reply().body().toUtf8())).get("error")).value()).isEqualTo("a height map is already running for you");
    ctx.folders().release();
    ctx.runUntilIdle();
    assertThat(map.reply().status()).isEqualTo(200);
    // when it has finished the user may ask again
    answer(heightMap(ALICE, 18.5, 59.5, 3_000), 200);
    assertThat(ctx.handlerErrors()).isEmpty();
  }

  @Test
  void criterion17AHeightMapOverMaxCellsAtEveryLevelIsRefusedWithTheCellsNeeded() throws Exception {
    DtedFiles.write(folder, 0, 18, 59, (c, r) -> 12);
    DtedFiles.write(folder, 1, 18, 59, (c, r) -> 12);
    start(folder, "maxCells", 100_000L, "maxRange", 200_000L);
    // 200 km: level 1 needs about a million, and so does level 0 beyond the cap (the coarsest has the most room)
    JsonObject refused = answer(heightMap(ALICE, 18.5, 59.5, 200_000), 413);
    String reason = ((JsonString) refused.get("error")).value();
    assertThat(reason).contains("the height map needs").contains("height cells within the circle at level 0").contains("the coarsest level with data here").contains("the cap is 100000").contains("smaller circle");
  }

  @Test
  void aHeightMapFallsBackToACoarserLevelUnderMaxCellsAndSaysSo() throws Exception {
    DtedFiles.write(folder, 0, 18, 59, (c, r) -> 12);
    DtedFiles.write(folder, 1, 18, 59, (c, r) -> 12);
    DtedFiles.write(folder, 2, 18, 59, (c, r) -> 12);
    start(folder);
    assertThat(answer(heightMap(ALICE, 18.5, 59.5, 10_000), 200).getNumber("level").longValueExact()).isEqualTo(2);
    ctx = null;
    start(folder, "maxCells", 100_000L);
    JsonObject coarser = answer(heightMap(ALICE, 18.5, 59.5, 10_000), 200);
    assertThat(coarser.getNumber("level").longValueExact()).isEqualTo(1);
    assertThat(coarser.get("notes").toString()).contains("Level 1 is used: level 2 needs").contains("within the circle");
  }

  @Test
  void aHeightMapNeedsThePermissionAndTheFolder() throws Exception {
    DtedFiles.write(folder, 1, 18, 59, (c, r) -> 12);
    start(folder);
    FakeHttpExchange refused = heightMap(NOBODY, 18.4, 59.4, 2_000);
    ctx.runUntilIdle();
    assertThat(refused.reply().status()).isEqualTo(403);
    ctx = null;
    start(folder.resolve("elsewhere"));
    assertThat(((JsonString) answer(heightMap(ALICE, 18.4, 59.4, 2_000), 503).get("error")).value()).contains("height folder");
  }

  // ---------------------------------------------------------------- the caps, over all the bands

  @Test
  void theBandsShareTheOverlaysCapsAndTheAnswerSaysItSimplified() throws Exception {
    // a chequer-board of hills: many small areas in many bands
    HeightField field = (lon, lat) -> 100 + 3 * (Math.floorMod((int) Math.floor((lon - 18) * 400) + (int) Math.floor((lat - 59) * 400), 17));
    Viewshed.Params params = new Viewshed.Params(18.5, 59.5, 0, 0, 8_000, 0.13, 3 / 3600.0 * 2, 3 / 3600.0);
    MapComputed generous = HeightMap.run(1, field, params, 30_000_000_000L);
    MapComputed tight = HeightMap.run(1, field, params, 30_000_000_000L, 40, 5_000);
    assertThat(generous.outcome()).isEqualTo(MapComputed.Outcome.DONE);
    assertThat(tight.outcome()).isEqualTo(MapComputed.Outcome.DONE);
    assertThat(generous.bands()).hasSize(16);
    int generousItems = generous.bands().stream().mapToInt(JsonArray::size).sum();
    int tightItems = tight.bands().stream().mapToInt(JsonArray::size).sum();
    assertThat(generousItems).isGreaterThan(40);
    assertThat(tightItems).as("all bands together are within the item cap").isLessThanOrEqualTo(40);
    assertThat(tight.positions()).isLessThanOrEqualTo(5_000);
    assertThat(tight.simplified() + tight.leftOut()).isPositive();
  }
}
