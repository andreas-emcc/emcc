package dev.emcc.plugins.terrain;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.User;
import dev.emcc.sdk.folder.FolderResult;
import dev.emcc.sdk.geo.GeodesicLeg;
import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.testkit.FakeHttpExchange;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.testkit.LogEntry;
import dev.emcc.sdk.testkit.TestJson;
import dev.emcc.sdk.worker.Handler;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.function.IntBinaryOperator;
import org.assertj.core.data.Offset;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * The plugin through its endpoints with the test kit's fake context and fake folders: criteria 1
 * (range), 4 (the folder's rules), 5 (index and levels), 9 (the areas), 10 (limits), 11
 * (permissions), 12 (values) and 13 (partly without data). Every position has a latitude different
 * from its longitude.
 */
class TerrainPluginTest {

  private static final User NOBODY = new User("nobody", "Nobody", Set.of(), false);
  private static final User ALICE = new User("alice", "Alice", Set.of(TerrainPlugin.PERMISSION), false);
  private static final User BOB = new User("bob", "Bob", Set.of(TerrainPlugin.PERMISSION), false);

  /** A message of the test's own sink worker, which receives the answers to calls the test makes itself. */
  private record Sink(FolderResult result) implements Message {}

  @TempDir
  Path folder;

  private FakePluginContext ctx;
  private Plugin plugin;

  @BeforeEach
  void noPlugin() {
    ctx = null;
  }

  // ---------------------------------------------------------------- helpers

  private JsonObject settings(Path path, Object... overrides) {
    JsonObject settings = Manifest.settingDefaults().with("heightDataFolder", JsonString.of(path == null ? "" : path.toString()));
    for (int i = 0; i < overrides.length; i += 2) {
      Object value = overrides[i + 1];
      settings = settings.with((String) overrides[i], value instanceof Double d ? JsonNumber.of(d) : JsonNumber.of(((Number) value).longValue()));
    }
    return settings;
  }

  private void start(Path path, Object... overrides) throws Exception {
    ctx = FakePluginContext.builder(Manifest.id()).settings(settings(path, overrides)).folder("heights", path).build();
    plugin = (Plugin) Class.forName(Manifest.entryClass()).getConstructor().newInstance();
    plugin.init(ctx);
    plugin.start();
    ctx.runUntilIdle();
  }

  private static JsonArray position(double lon, double lat) {
    return JsonArray.of(JsonNumber.of(lon), JsonNumber.of(lat));
  }

  private static JsonObject viewshedBody(double lon, double lat, double observerHeight, double targetHeight, double range) {
    return JsonObject.builder()
        .put("observer", position(lon, lat))
        .put("observerHeight", JsonNumber.of(observerHeight))
        .put("targetHeight", JsonNumber.of(targetHeight))
        .put("maxRange", JsonNumber.of(range))
        .build();
  }

  private FakeHttpExchange viewshed(User user, double lon, double lat, double observerHeight, double targetHeight, double range) {
    return ctx.post("/viewshed", viewshedBody(lon, lat, observerHeight, targetHeight, range), user);
  }

  private JsonObject answer(FakeHttpExchange exchange, int status) {
    ctx.runUntilIdle();
    assertThat(exchange.reply().status()).as(exchange.reply().body().toUtf8()).isEqualTo(status);
    return (JsonObject) TestJson.parse(exchange.reply().body().toUtf8());
  }

  private static String error(JsonObject body) {
    return body.getString("error");
  }

  private static double number(JsonObject body, String name) {
    return body.getNumber(name).doubleValue();
  }

  private static List<double[]> vertices(JsonObject answer) {
    List<double[]> all = new ArrayList<>();
    for (JsonValue area : ((JsonArray) answer.get("areas")).values()) {
      for (JsonValue ring : ((JsonArray) area).values()) {
        for (JsonValue p : ((JsonArray) ring).values()) {
          all.add(new double[] {((JsonNumber) ((JsonArray) p).get(0)).doubleValue(), ((JsonNumber) ((JsonArray) p).get(1)).doubleValue()});
        }
      }
    }
    return all;
  }

  private static final IntBinaryOperator FLAT = (c, r) -> 12;

  /** Smooth hills on a level 1 cell (601 columns, 1201 rows at 59 degrees north). */
  private static final IntBinaryOperator HILLS = (c, r) -> {
    double h = 20;
    h += 90 * Math.exp(-(sq(c - 300) + sq(r - 520)) / (2 * 25.0 * 25.0));
    h += 60 * Math.exp(-(sq(c - 200) + sq(r - 430)) / (2 * 15.0 * 15.0));
    h += 40 * Math.exp(-(sq(c - 330) + sq(r - 400)) / (2 * 10.0 * 10.0));
    return (int) Math.round(h);
  };

  private static double sq(double v) {
    return v * v;
  }

  private static double total(JsonObject answer) {
    return ((JsonArray) answer.get("areas")).size();
  }

  // ---------------------------------------------------------------- criterion 1: range

  @Test
  void criterion1RangeFromStockholmToUppsalaIsTheGeodesyOfTheSdk() throws Exception {
    start(null);
    double[] from = {18.0686, 59.3293};
    double[] to = {17.6389, 59.8586};
    FakeHttpExchange call = ctx.post("/range", JsonObject.builder().put("from", position(from[0], from[1])).put("to", position(to[0], to[1])).build());
    JsonObject answer = answer(call, 200);
    GeodesicLeg leg = Geodesy.inverse(Position.of(from[0], from[1]), Position.of(to[0], to[1]));
    assertThat(number(answer, "distance")).isCloseTo(leg.distanceMetres(), Offset.offset(0.001));
    assertThat(number(answer, "initialBearing")).isCloseTo(leg.initialAzimuth(), Offset.offset(1e-6));
    assertThat(number(answer, "finalBearing")).isCloseTo(leg.finalAzimuth(), Offset.offset(1e-6));
    double expectedBack = (leg.finalAzimuth() + 180) % 360;
    assertThat(number(answer, "backBearing")).isCloseTo(expectedBack, Offset.offset(1e-6));
    // the midpoint, for the label, is half way along the geodesic: lon 17.85, lat 59.59 or so, with latitude and longitude apart
    JsonArray midpoint = (JsonArray) answer.get("midpoint");
    Position middle = Position.of(((JsonNumber) midpoint.get(0)).doubleValue(), ((JsonNumber) midpoint.get(1)).doubleValue());
    assertThat(middle.longitude()).isBetween(17.7, 18.0);
    assertThat(middle.latitude()).isBetween(59.4, 59.8);
    assertThat(Geodesy.inverse(Position.of(from[0], from[1]), middle).distanceMetres()).isCloseTo(leg.distanceMetres() / 2, Offset.offset(0.05));
    assertThat(Geodesy.inverse(middle, Position.of(to[0], to[1])).distanceMetres()).isCloseTo(leg.distanceMetres() / 2, Offset.offset(0.05));
    // Uppsala lies north-north-west: the distance is about 64 km, the initial bearing between 330 and 345 degrees
    assertThat(number(answer, "distance")).isBetween(62_000.0, 66_000.0);
    assertThat(number(answer, "initialBearing")).isBetween(330.0, 345.0);
  }

  @Test
  void criterion1TheBackBearingIsTheFinalPlus180NormalisedBothWays() throws Exception {
    start(null);
    // a leg that ends heading west (about 270): back about 90; one that ends heading east (about 85): back about 265
    JsonObject west = answer(ctx.post("/range", JsonObject.builder().put("from", position(30.5, 61.2)).put("to", position(20.1, 61.1)).build()), 200);
    assertThat(number(west, "finalBearing")).isBetween(240.0, 280.0);
    assertThat(number(west, "backBearing")).isCloseTo((number(west, "finalBearing") + 180) % 360, Offset.offset(1e-9));
    JsonObject east = answer(ctx.post("/range", JsonObject.builder().put("from", position(20.1, 61.1)).put("to", position(30.5, 61.2)).build()), 200);
    assertThat(number(east, "finalBearing")).isBetween(70.0, 110.0);
    assertThat(number(east, "backBearing")).isBetween(250.0, 290.0);
    assertThat(number(east, "backBearing")).isLessThan(360);
  }

  @Test
  void criterion1APairAcrossTheAntimeridianGivesTheShortWay() throws Exception {
    start(null);
    JsonObject answer = answer(ctx.post("/range", JsonObject.builder().put("from", position(179.6, -17.3)).put("to", position(-179.7, -17.9)).build()), 200);
    GeodesicLeg leg = Geodesy.inverse(Position.of(179.6, -17.3), Position.of(-179.7, -17.9));
    assertThat(number(answer, "distance")).isCloseTo(leg.distanceMetres(), Offset.offset(0.001));
    assertThat(number(answer, "distance")).as("the short way: about 0.7 degrees of longitude and 0.6 of latitude, not 359").isBetween(95_000.0, 105_000.0);
    assertThat(number(answer, "initialBearing")).as("heading south-east: about 74 km east and 66 km south").isBetween(120.0, 140.0);
  }

  @Test
  void criterion1RangeNeedsNoHeightDataSoItWorksWhileTheFolderIsNotSet() throws Exception {
    start(null);
    assertThat(ctx.effectiveStatus().detail()).isEqualTo("Height folder not set");
    answer(ctx.post("/range", JsonObject.builder().put("from", position(18.0686, 59.3293)).put("to", position(17.6389, 59.8586)).build()), 200);
  }

  // ---------------------------------------------------------------- criterion 4: the folder's rules, and 9 of the brief: the status

  @Test
  void criterion4CellsAreFoundThroughListAndReadThroughReadOnly() throws Exception {
    DtedFiles.write(folder, 0, 17, 59, FLAT);
    DtedFiles.write(folder, 0, 18, 59, FLAT);
    DtedFiles.write(folder, 1, 18, 59, FLAT);
    DtedFiles.write(folder, 0, -75, -34, FLAT);
    start(folder);

    assertThat(ctx.folders().calls()).isNotEmpty();
    assertThat(ctx.folders().calls()).allSatisfy(call -> {
      assertThat(call.operation()).isIn("list", "read");
      assertThat(call.folder()).isEqualTo("heights");
      assertThat(call.path()).as("a path relative to the folder").doesNotStartWith("/").doesNotContain("\\").doesNotContain("..").doesNotContain(":");
    });
    List<String> lists = ctx.folders().calls().stream().filter(c -> c.operation().equals("list")).map(c -> c.path()).toList();
    assertThat(lists).contains("", "e017", "e018", "w075");
    List<String> reads = ctx.folders().calls().stream().filter(c -> c.operation().equals("read")).map(c -> c.path()).toList();
    assertThat(reads).containsExactlyInAnyOrder("e017/n59.dt0", "e018/n59.dt0", "e018/n59.dt1", "w075/s34.dt0");

    JsonObject status = answer(ctx.call("/status", ALICE), 200);
    assertThat(status.getString("state")).isEqualTo("ready");
    assertThat(status.getNumber("cells").longValueExact()).isEqualTo(4);
    JsonObject levels = status.getObject("levels");
    assertThat(levels.getNumber("0").longValueExact()).isEqualTo(3);
    assertThat(levels.getNumber("1").longValueExact()).isEqualTo(1);
    assertThat(levels.getNumber("2").longValueExact()).isZero();
    JsonObject area = status.getObject("area");
    assertThat(area.getNumber("west").doubleValue()).isEqualTo(-75);
    assertThat(area.getNumber("east").doubleValue()).isEqualTo(19);
    assertThat(area.getNumber("south").doubleValue()).isEqualTo(-34);
    assertThat(area.getNumber("north").doubleValue()).isEqualTo(60);
    assertThat(ctx.effectiveStatus().state()).isEqualTo(PluginState.OK);
    assertThat(ctx.effectiveStatus().detail()).isEqualTo("Height data: 4 cells (level 2: 0, level 1: 1, level 0: 3)");
  }

  @Test
  void criterion4TheIndexReadsOnlyHeadersAndACellIsReadWholeWhenAViewshedNeedsIt() throws Exception {
    DtedFiles.write(folder, 1, 18, 59, FLAT);
    start(folder);
    long size = Files.size(folder.resolve("e018/n59.dt1"));
    assertThat(ctx.folders().calls().stream().filter(c -> c.operation().equals("read")).count()).isEqualTo(1);
    FakeHttpExchange call = viewshed(ALICE, 18.4, 59.4, 2, 2, 3_000);
    JsonObject answer = answer(call, 200);
    assertThat(answer.getNumber("cells").longValueExact()).isEqualTo(1);
    assertThat(ctx.folders().calls().stream().filter(c -> c.operation().equals("read")).count()).as("the header, then the cell").isEqualTo(2);
    assertThat(size).isGreaterThan(DtedCell.HEADER_BYTES);
    // a second viewshed over the same cell reads nothing: it is in the cache
    answer(viewshed(ALICE, 18.41, 59.41, 2, 2, 3_000), 200);
    assertThat(ctx.folders().calls().stream().filter(c -> c.operation().equals("read")).count()).isEqualTo(2);
    assertThat(answer(ctx.call("/status", ALICE), 200).getNumber("cacheCells").longValueExact()).isEqualTo(1);
  }

  @Test
  void criterion4AnEmptySettingMissingFolderOrChangedFolderIsSaidInTheStatusAndTheAnswers() throws Exception {
    start(null);
    assertThat(ctx.effectiveStatus().detail()).isEqualTo("Height folder not set");
    assertThat(answer(ctx.call("/status", ALICE), 200).getString("state")).isEqualTo("notSet");
    assertThat(error(answer(viewshed(ALICE, 18.4, 59.4, 2, 2, 3_000), 503))).contains("not set");

    // a folder that does not exist
    Path missing = folder.resolve("no-such-folder");
    ctx.folders().setPath("heights", missing);
    ctx.changeSettings(settings(missing));
    ctx.runUntilIdle();
    assertThat(ctx.effectiveStatus().state()).isEqualTo(PluginState.DEGRADED);
    assertThat(ctx.effectiveStatus().detail()).startsWith("Height folder not readable: ");
    assertThat(answer(ctx.call("/status", ALICE), 200).getString("state")).isEqualTo("notReadable");
    assertThat(error(answer(viewshed(ALICE, 18.4, 59.4, 2, 2, 3_000), 503))).contains("not readable");

    // a folder with cells: the change rebuilds the index
    Path data = Files.createDirectories(folder.resolve("data"));
    DtedFiles.write(data, 0, 18, 59, FLAT);
    DtedFiles.write(data, 1, 18, 59, FLAT);
    ctx.folders().setPath("heights", data);
    ctx.changeSettings(settings(data));
    ctx.runUntilIdle();
    assertThat(ctx.effectiveStatus().detail()).isEqualTo("Height data: 2 cells (level 2: 0, level 1: 1, level 0: 1)");
    answer(viewshed(ALICE, 18.4, 59.4, 2, 2, 3_000), 200);

    // another folder: the old cells are gone, not mixed in
    Path other = Files.createDirectories(folder.resolve("other"));
    DtedFiles.write(other, 0, -75, -34, FLAT);
    ctx.folders().setPath("heights", other);
    ctx.changeSettings(settings(other));
    ctx.runUntilIdle();
    assertThat(ctx.effectiveStatus().detail()).isEqualTo("Height data: 1 cells (level 2: 0, level 1: 0, level 0: 1)");
    assertThat(error(answer(viewshed(ALICE, 18.4, 59.4, 2, 2, 3_000), 404))).contains("no height data at the observer");
    assertThat(answer(ctx.call("/status", ALICE), 200).getNumber("cacheCells").longValueExact()).as("the cache went with the old folder").isZero();

    // emptied again
    ctx.folders().setPath("heights", null);
    ctx.changeSettings(settings(null));
    ctx.runUntilIdle();
    assertThat(ctx.effectiveStatus().detail()).isEqualTo("Height folder not set");
    assertThat(ctx.handlerErrors()).isEmpty();
  }

  @Test
  void criterion4ASettingThatChangesNothingAboutTheFolderDoesNotRebuildTheIndex() throws Exception {
    DtedFiles.write(folder, 0, 18, 59, FLAT);
    start(folder);
    int calls = ctx.folders().calls().size();
    ctx.changeSettings(settings(folder, "refractionCoefficient", 0.2));
    ctx.runUntilIdle();
    assertThat(ctx.folders().calls()).hasSize(calls);
  }

  @Test
  void criterion4FilesThatDoNotMatchTheirNamesAreSkippedWithALogLine() throws Exception {
    DtedFiles.write(folder, 0, 18, 59, FLAT);
    // e019/n59.dt0 holds the cell of e018/n59.dt0; e020/n59.dt0 has a square cell at 59 degrees north; e021/n59.dt1 is cut short
    DtedFiles.write(folder, 0, 19, 59, DtedFiles.cell(0, 18, 59, FLAT));
    DtedFiles.write(folder, 0, 20, 59, DtedFiles.cell(0, 20, 59, 1, FLAT));
    byte[] whole = DtedFiles.cell(1, 21, 59, FLAT);
    DtedFiles.write(folder, 1, 21, 59, java.util.Arrays.copyOf(whole, whole.length - 100));
    Files.writeString(Files.createDirectories(folder.resolve("e018")).resolve("notes.txt"), "not a cell");
    Files.createDirectories(folder.resolve("other-folder"));
    start(folder);

    assertThat(ctx.effectiveStatus().detail()).isEqualTo("Height data: 1 cells (level 2: 0, level 1: 0, level 0: 1); 3 files skipped, see the log");
    List<String> warnings = ctx.logEntries().stream().filter(e -> e.level() == LogEntry.Level.WARN).map(LogEntry::message).toList();
    assertThat(warnings).anyMatch(m -> m.contains("e019/n59.dt0") && m.contains("origin"));
    assertThat(warnings).anyMatch(m -> m.contains("e020/n59.dt0") && m.contains("2 times"));
    assertThat(warnings).anyMatch(m -> m.contains("e021/n59.dt1") && m.contains("bytes"));
    assertThat(answer(ctx.call("/status", ALICE), 200).getNumber("skipped").longValueExact()).isEqualTo(3);
  }

  @Test
  void criterion4ACellWithABadChecksumIsSkippedWhenItIsReadAndLeftOutOfTheIndexAfterwards() throws Exception {
    byte[] bad = DtedFiles.cell(1, 18, 59, FLAT);
    bad[DtedCell.HEADER_BYTES + 7 * (12 + 2 * 1201) + 100] ^= 0x04;
    DtedFiles.write(folder, 1, 18, 59, bad);
    DtedFiles.write(folder, 0, 18, 59, FLAT);
    start(folder);
    assertThat(ctx.effectiveStatus().detail()).startsWith("Height data: 2 cells");
    // level 1 is the finest here, and its read fails the checksum: the viewshed says so
    JsonObject answer = answer(viewshed(ALICE, 18.4, 59.4, 2, 2, 3_000), 503);
    assertThat(error(answer)).contains("none of the height cells could be read");
    assertThat(ctx.logEntries().stream().map(LogEntry::message)).anyMatch(m -> m.contains("e018/n59.dt1") && m.contains("checksum"));
    assertThat(ctx.effectiveStatus().detail()).isEqualTo("Height data: 1 cells (level 2: 0, level 1: 0, level 0: 1); 1 files skipped, see the log");
    // the next viewshed uses level 0
    assertThat(answer(viewshed(ALICE, 18.4, 59.4, 2, 2, 3_000), 200).getNumber("level").longValueExact()).isZero();
  }

  @Test
  void criterion4NamesInAnyCaseAreFound() throws Exception {
    byte[] bytes = DtedFiles.cell(0, 18, 59, FLAT);
    Files.write(Files.createDirectories(folder.resolve("E018")).resolve("N59.DT0"), bytes);
    start(folder);
    assertThat(ctx.effectiveStatus().detail()).isEqualTo("Height data: 1 cells (level 2: 0, level 1: 0, level 0: 1)");
    assertThat(ctx.folders().calls().stream().filter(c -> c.operation().equals("read")).map(c -> c.path())).containsExactly("E018/N59.DT0");
  }

  @Test
  void criterion4NoRequestNamesAPathOrAFile() throws Exception {
    DtedFiles.write(folder, 1, 18, 59, FLAT);
    start(folder);
    int before = ctx.folders().calls().size();
    JsonObject body = viewshedBody(18.4, 59.4, 2, 2, 3_000)
        .with("path", JsonString.of("../../secret.dt1"))
        .with("folder", JsonString.of("C:/Windows"))
        .with("file", JsonString.of("/etc/passwd"));
    answer(ctx.post("/viewshed", body, ALICE), 200);
    List<String> paths = ctx.folders().calls().stream().skip(before).map(c -> c.path()).toList();
    assertThat(paths).containsExactly("e018/n59.dt1");
  }

  @Test
  void criterion4AtMostEightCallsAreInProgressAndTheRestWaitInTheQueue() throws Exception {
    for (int lon = 0; lon < 20; lon++) {
      DtedFiles.write(folder, 0, lon, 59, FLAT);
    }
    ctx = FakePluginContext.builder(Manifest.id()).settings(settings(folder)).folder("heights", folder).build();
    plugin = (Plugin) Class.forName(Manifest.entryClass()).getConstructor().newInstance();
    plugin.init(ctx);
    ctx.folders().hold();
    plugin.start();
    ctx.runUntilIdle();
    assertThat(ctx.folders().inFlight()).isEqualTo(1); // the listing of the folder
    ctx.folders().release();
    ctx.runUntilIdle();
    assertThat(ctx.effectiveStatus().detail()).startsWith("Height data: 20 cells");

    // a second index with every call held: never more than 8 in progress, and the others wait
    Path again = Files.createDirectories(folder.resolve("again"));
    for (int lon = 0; lon < 20; lon++) {
      DtedFiles.write(again, 0, lon, 59, FLAT);
    }
    ctx.folders().setPath("heights", again);
    ctx.folders().hold();
    ctx.changeSettings(settings(again));
    ctx.runUntilIdle();
    ctx.folders().release(); // the listing of the folder is done now
    ctx.folders().hold();
    ctx.runUntilIdle();
    int maxInFlight = 0;
    for (int round = 0; round < 40 && ctx.folders().inFlight() > 0; round++) {
      maxInFlight = Math.max(maxInFlight, ctx.folders().inFlight());
      assertThat(ctx.folders().inFlight()).isLessThanOrEqualTo(8);
      ctx.folders().release();
      ctx.folders().hold();
      ctx.runUntilIdle();
    }
    ctx.folders().release();
    ctx.runUntilIdle();
    assertThat(maxInFlight).isBetween(2, 8);
    assertThat(ctx.effectiveStatus().detail()).startsWith("Height data: 20 cells");
    assertThat(ctx.folders().calls().stream().filter(c -> c.operation().equals("read")).count()).isGreaterThanOrEqualTo(40);
    assertThat(ctx.handlerErrors()).isEmpty();
  }

  @Test
  void criterion4ACallAnsweredBusyWaitsAndIsNotRetriedInALoop() throws Exception {
    DtedFiles.write(folder, 0, 18, 59, FLAT);
    ctx = FakePluginContext.builder(Manifest.id()).settings(settings(folder)).folder("heights", folder).build();
    plugin = (Plugin) Class.forName(Manifest.entryClass()).getConstructor().newInstance();
    plugin.init(ctx);
    // the test occupies all eight places of the plugin's folder calls
    WorkerRef<Sink> sink = ctx.workers().spawn(WorkerSpec.of("sink", Sink.class, () -> (Handler<Sink>) (message, context) -> {}));
    ctx.folders().hold();
    for (int i = 0; i < 8; i++) {
      ctx.folders().folder("heights").list("", Duration.ofSeconds(60), sink, Sink::new);
    }
    assertThat(ctx.folders().inFlight()).isEqualTo(8);
    int callsBefore = ctx.folders().calls().size();
    plugin.start();
    ctx.runUntilIdle();
    ctx.advance(Duration.ofSeconds(2));
    int attempts = ctx.folders().calls().size() - callsBefore;
    assertThat(attempts).as("a few spaced attempts at most, not a loop").isBetween(1, 6);
    assertThat(ctx.effectiveStatus().detail()).isEqualTo("Height data: indexing");
    // when places free up, the index is made
    ctx.folders().release();
    ctx.advance(Duration.ofSeconds(10));
    ctx.runUntilIdle();
    assertThat(ctx.effectiveStatus().detail()).isEqualTo("Height data: 1 cells (level 2: 0, level 1: 0, level 0: 1)");
    assertThat(ctx.handlerErrors()).isEmpty();
  }

  // ---------------------------------------------------------------- criterion 5: index and levels

  @Test
  void criterion5WithLevels0To2PresentAViewshedUsesLevel2() throws Exception {
    DtedFiles.write(folder, 0, 18, 59, FLAT);
    DtedFiles.write(folder, 1, 18, 59, FLAT);
    DtedFiles.write(folder, 2, 18, 59, FLAT);
    start(folder);
    assertThat(ctx.effectiveStatus().detail()).isEqualTo("Height data: 3 cells (level 2: 1, level 1: 1, level 0: 1)");
    JsonObject answer = answer(viewshed(ALICE, 18.4, 59.4, 2, 2, 3_000), 200);
    assertThat(answer.getNumber("level").longValueExact()).isEqualTo(2);
    assertThat(answer.getNumber("cells").longValueExact()).isEqualTo(1);
    assertThat(((JsonArray) answer.get("notes")).size()).isZero();
    assertThat(ctx.folders().calls().stream().filter(c -> c.operation().equals("read") && c.path().endsWith(".dt2")).count()).as("its header, then the cell").isEqualTo(2);
  }

  @Test
  void criterion5WithMaxCellsTooSmallForLevel2ButEnoughForLevel1TheAnswerSaysLevel1() throws Exception {
    DtedFiles.write(folder, 0, 18, 59, FLAT);
    DtedFiles.write(folder, 1, 18, 59, FLAT);
    DtedFiles.write(folder, 2, 18, 59, FLAT);
    start(folder, "maxCells", 100_000L);
    JsonObject answer = answer(viewshed(ALICE, 18.4, 59.4, 2, 2, 10_000), 200);
    assertThat(answer.getNumber("level").longValueExact()).isEqualTo(1);
    List<String> notes = ((JsonArray) answer.get("notes")).values().stream().map(v -> ((JsonString) v).value()).toList();
    assertThat(notes).hasSize(1);
    assertThat(notes.getFirst()).contains("Level 1 is used").contains("level 2 needs").contains("the cap is 100000");
    assertThat(answer.getNumber("heightCells").longValueExact()).isLessThanOrEqualTo(100_000);
    assertThat(ctx.folders().calls().stream().filter(c -> c.operation().equals("read") && c.path().endsWith(".dt2")).count()).as("level 2 was not read, only its header").isEqualTo(1);
  }

  @Test
  void criterion5WithMaxCellsTooSmallForEveryLevelTheRequestIsRefusedWithTheCellsAndTheCap() throws Exception {
    DtedFiles.write(folder, 0, 18, 59, FLAT);
    DtedFiles.write(folder, 1, 18, 59, FLAT);
    start(folder, "maxCells", 100_000L, "maxRange", 200_000L);
    JsonObject answer = answer(viewshed(ALICE, 18.4, 59.4, 2, 2, 200_000), 413);
    String reason = error(answer);
    assertThat(reason).contains("height cells").contains("level 0").contains("the cap is 100000").contains("coarsest");
    java.util.regex.Matcher needs = java.util.regex.Pattern.compile("needs (\\d+) height cells").matcher(reason);
    assertThat(needs.find()).isTrue();
    assertThat(Long.parseLong(needs.group(1))).isGreaterThan(100_000);
    assertThat(ctx.folders().calls().stream().filter(c -> c.operation().equals("read") && c.path().endsWith("n59.dt0")).count()).as("nothing was read for it").isEqualTo(1);
  }

  @Test
  void criterion5ARangeThatCrossesTwoCellsJoinsThem() throws Exception {
    DtedFiles.write(folder, 1, 17, 59, FLAT);
    DtedFiles.write(folder, 1, 18, 59, FLAT);
    start(folder);
    // 18.0 E is the seam; the observer is 400 m west of it
    JsonObject answer = answer(viewshed(ALICE, 17.994, 59.4, 2, 30, 10_000), 200);
    assertThat(answer.getNumber("cells").longValueExact()).isEqualTo(2);
    assertThat(answer.getBoolean("partlyWithoutData")).isFalse();
    List<double[]> vertices = vertices(answer);
    assertThat(vertices.stream().mapToDouble(v -> v[0]).min().orElseThrow()).isLessThan(17.994 - 0.1);
    assertThat(vertices.stream().mapToDouble(v -> v[0]).max().orElseThrow()).isGreaterThan(18.0 + 0.1);
    assertThat(((JsonArray) answer.get("areas")).size()).as("one area, joined over the seam").isEqualTo(1);
  }

  // ---------------------------------------------------------------- criterion 9: the areas; criterion 13: partly without data

  @Test
  void criterion9TheResultsRingsAreClosedInLongitudeLatitudeWithHolesInsideTheirExterior() throws Exception {
    DtedFiles.write(folder, 1, 18, 59, HILLS);
    start(folder);
    JsonObject answer = answer(viewshed(ALICE, 18.4, 59.4, 2, 2, 12_000), 200);
    assertThat(answer.getNumber("simplified").longValueExact()).isZero();
    JsonArray areas = (JsonArray) answer.get("areas");
    assertThat(areas.size()).isPositive();
    int holes = 0;
    for (JsonValue area : areas.values()) {
      List<JsonValue> rings = ((JsonArray) area).values();
      double[] exterior = box((JsonArray) rings.getFirst());
      for (int r = 0; r < rings.size(); r++) {
        List<JsonValue> positions = ((JsonArray) rings.get(r)).values();
        assertThat(positions.size()).isGreaterThanOrEqualTo(4);
        assertThat(positions.getFirst()).as("closed").isEqualTo(positions.getLast());
        for (JsonValue p : positions) {
          double lon = ((JsonNumber) ((JsonArray) p).get(0)).doubleValue();
          double lat = ((JsonNumber) ((JsonArray) p).get(1)).doubleValue();
          assertThat(lon).as("longitude first: the observer is at 18.4 E, 59.4 N").isBetween(18.0, 18.9);
          assertThat(lat).isBetween(59.2, 59.6);
        }
        if (r > 0) {
          holes++;
          double[] hole = box((JsonArray) rings.get(r));
          assertThat(hole[0]).isGreaterThanOrEqualTo(exterior[0]);
          assertThat(hole[1]).isLessThanOrEqualTo(exterior[1]);
          assertThat(hole[2]).isGreaterThanOrEqualTo(exterior[2]);
          assertThat(hole[3]).isLessThanOrEqualTo(exterior[3]);
        }
      }
    }
    assertThat(holes).as("the hills hide patches inside the visible ground").isPositive();
    assertThat(answer.getNumber("positions").longValueExact()).isLessThanOrEqualTo(Areas.MAX_POSITIONS);
    assertThat(areas.size()).isLessThanOrEqualTo(Areas.MAX_ITEMS);
    assertThat(answer.getNumber("millis").longValueExact()).isGreaterThanOrEqualTo(0);
  }

  private static double[] box(JsonArray ring) {
    double[] b = {1e9, -1e9, 1e9, -1e9};
    for (JsonValue p : ring.values()) {
      double lon = ((JsonNumber) ((JsonArray) p).get(0)).doubleValue();
      double lat = ((JsonNumber) ((JsonArray) p).get(1)).doubleValue();
      b[0] = Math.min(b[0], lon);
      b[1] = Math.max(b[1], lon);
      b[2] = Math.min(b[2], lat);
      b[3] = Math.max(b[3], lat);
    }
    return b;
  }

  @Test
  void criterion13AViewshedAtTheEdgeOfTheDataSaysPartlyWithoutDataAndShowsNoGroundBeyondIt() throws Exception {
    DtedFiles.write(folder, 1, 18, 59, FLAT);
    start(folder);
    // 18.0 E is the data's west edge, nothing lies west of it; the observer is 300 m inside
    JsonObject answer = answer(viewshed(ALICE, 18.005, 59.4, 2, 30, 6_000), 200);
    assertThat(answer.getBoolean("partlyWithoutData")).isTrue();
    List<double[]> vertices = vertices(answer);
    assertThat(vertices).isNotEmpty();
    assertThat(vertices.stream().mapToDouble(v -> v[0]).min().orElseThrow()).as("no visible ground west of the data").isGreaterThanOrEqualTo(18.0 - 0.001);
    assertThat(vertices.stream().mapToDouble(v -> v[0]).max().orElseThrow()).isGreaterThan(18.05);

    // inside the data, nothing is missing
    JsonObject inside = answer(viewshed(ALICE, 18.5, 59.4, 2, 2, 3_000), 200);
    assertThat(inside.getBoolean("partlyWithoutData")).isFalse();
  }

  @Test
  void criterion13AVoidInsideTheRangeIsPartlyWithoutDataToo() throws Exception {
    // a void of 20 x 20 samples 3 to 5 km east of the observer
    DtedFiles.write(folder, 1, 18, 59, (c, r) -> c >= 270 && c < 290 && r >= 470 && r < 490 ? DtedFiles.VOID : 12);
    start(folder);
    JsonObject answer = answer(viewshed(ALICE, 18.4, 59.4, 2, 30, 6_000), 200);
    assertThat(answer.getBoolean("partlyWithoutData")).isTrue();
    // the void is a hole in the visible ground, where no cell is shown as visible
    JsonArray areas = (JsonArray) answer.get("areas");
    int holes = 0;
    for (JsonValue area : areas.values()) {
      holes += ((JsonArray) area).size() - 1;
    }
    assertThat(holes).isPositive();
  }

  @Test
  void aViewshedAcrossTheAntimeridianCamesOutWrappedAndInOnePiece() throws Exception {
    DtedFiles.write(folder, 0, 179, -18, FLAT);
    DtedFiles.write(folder, 0, -180, -18, FLAT);
    start(folder);
    JsonObject answer = answer(viewshed(ALICE, 179.9, -17.4, 2, 30, 20_000), 200);
    assertThat(answer.getNumber("cells").longValueExact()).isEqualTo(2);
    List<double[]> vertices = vertices(answer);
    assertThat(vertices).allSatisfy(v -> assertThat(v[0]).isBetween(-180.0, 180.0));
    assertThat(vertices.stream().mapToDouble(v -> v[0]).max().orElseThrow()).isGreaterThan(179.9);
    assertThat(vertices.stream().mapToDouble(v -> v[0]).min().orElseThrow()).as("ground east of 180 degrees is at -180 and on").isLessThan(-179.9);
  }

  // ---------------------------------------------------------------- criterion 10: limits

  @Test
  void criterion10ASecondViewshedOfTheSameUserWhileOneRunsIsRefusedButAnotherUserMayRun() throws Exception {
    DtedFiles.write(folder, 1, 18, 59, FLAT);
    start(folder);
    ctx.folders().hold(); // the first viewshed waits for its cell
    FakeHttpExchange first = viewshed(ALICE, 18.4, 59.4, 2, 2, 3_000);
    ctx.runUntilIdle();
    assertThat(first.isAnswered()).isFalse();
    FakeHttpExchange second = viewshed(ALICE, 18.5, 59.5, 2, 2, 3_000);
    FakeHttpExchange other = viewshed(BOB, 18.45, 59.45, 2, 2, 3_000);
    ctx.runUntilIdle();
    assertThat(second.reply().status()).isEqualTo(409);
    assertThat(error((JsonObject) TestJson.parse(second.reply().body().toUtf8()))).isEqualTo("a viewshed is already running for you");
    assertThat(other.isAnswered()).as("another user's viewshed runs on").isFalse();
    ctx.folders().release();
    ctx.runUntilIdle();
    assertThat(first.reply().status()).isEqualTo(200);
    assertThat(other.reply().status()).isEqualTo(200);
    // and once it has finished the same user may ask again
    answer(viewshed(ALICE, 18.5, 59.5, 2, 2, 3_000), 200);
    assertThat(ctx.handlerErrors()).isEmpty();
  }

  @Test
  void criterion10AViewshedOverTheTimeoutIsRefusedWith503() throws Exception {
    DtedFiles.write(folder, 1, 18, 59, FLAT);
    start(folder, "timeoutSeconds", 30L);
    ctx.folders().hold();
    FakeHttpExchange call = viewshed(ALICE, 18.4, 59.4, 2, 2, 3_000);
    ctx.runUntilIdle();
    ctx.advance(Duration.ofSeconds(29));
    assertThat(call.isAnswered()).isFalse();
    ctx.advance(Duration.ofSeconds(2));
    assertThat(call.reply().status()).isEqualTo(503);
    assertThat(error((JsonObject) TestJson.parse(call.reply().body().toUtf8()))).contains("longer than 30 seconds");
    // the user may ask again after it
    ctx.folders().release();
    ctx.runUntilIdle();
    answer(viewshed(ALICE, 18.4, 59.4, 2, 2, 3_000), 200);
  }

  @Test
  void criterion10TheLongestSettingAnswersWithinTheEndpointsOwnLimit() throws Exception {
    DtedFiles.write(folder, 1, 18, 59, FLAT);
    start(folder, "timeoutSeconds", 55L);
    ctx.folders().hold();
    FakeHttpExchange call = viewshed(ALICE, 18.4, 59.4, 2, 2, 3_000);
    ctx.runUntilIdle();
    ctx.advance(Duration.ofSeconds(56));
    assertThat(call.reply().status()).isEqualTo(503);
    assertThat(error((JsonObject) TestJson.parse(call.reply().body().toUtf8()))).contains("55 seconds");
  }

  @Test
  void criterion10TheCacheHoldsNoMoreThanItsLimit() throws Exception {
    DtedFiles.write(folder, 1, 18, 59, FLAT);
    DtedFiles.write(folder, 1, 17, 59, FLAT);
    DtedFiles.write(folder, 1, 16, 59, FLAT);
    start(folder);
    for (double lon : new double[] {18.4, 17.4, 16.4}) {
      answer(viewshed(ALICE, lon, 59.4, 2, 2, 3_000), 200);
    }
    JsonObject status = answer(ctx.call("/status", ALICE), 200);
    assertThat(status.getNumber("cacheBytes").longValueExact()).isLessThanOrEqualTo(32L * 1024 * 1024);
    assertThat(status.getNumber("cacheCells").longValueExact()).isEqualTo(3);
  }

  // ---------------------------------------------------------------- criterion 11: permissions

  @Test
  void criterion11WithoutThePermissionEveryEndpointAnswers403() throws Exception {
    DtedFiles.write(folder, 1, 18, 59, FLAT);
    start(folder);
    FakeHttpExchange range = ctx.post("/range", JsonObject.builder().put("from", position(18.0686, 59.3293)).put("to", position(17.6389, 59.8586)).build(), NOBODY);
    FakeHttpExchange viewshed = viewshed(NOBODY, 18.4, 59.4, 2, 2, 3_000);
    FakeHttpExchange status = ctx.call("/status", NOBODY);
    ctx.runUntilIdle();
    assertThat(range.reply().status()).isEqualTo(403);
    assertThat(viewshed.reply().status()).isEqualTo(403);
    assertThat(status.reply().status()).isEqualTo(403);
    assertThat(ctx.folders().calls().stream().filter(c -> c.operation().equals("read")).count()).as("nothing was read for the refused user").isEqualTo(1);
    // the manifest declares the permission
    assertThat(Manifest.read().get("permissions").toString()).contains(TerrainPlugin.PERMISSION);
  }

  // ---------------------------------------------------------------- criterion 12: values

  @Test
  void criterion12ValuesOutOfRangeAreRefusedWithTheirReason() throws Exception {
    DtedFiles.write(folder, 1, 18, 59, FLAT);
    start(folder);
    assertThat(error(answer(viewshed(ALICE, 18.4, 59.4, 2, 2, 50_001), 400))).contains("maxRange").contains("50000");
    assertThat(error(answer(viewshed(ALICE, 18.4, 59.4, 2, 2, 99), 400))).contains("maxRange").contains("100");
    assertThat(error(answer(viewshed(ALICE, 18.4, 59.4, -1, 2, 5_000), 400))).contains("observerHeight").contains("-1");
    assertThat(error(answer(viewshed(ALICE, 18.4, 59.4, 2, -0.5, 5_000), 400))).contains("targetHeight");
    assertThat(error(answer(viewshed(ALICE, 18.4, 59.4, 1_001, 2, 5_000), 400))).contains("observerHeight").contains("1000");
    assertThat(error(answer(viewshed(ALICE, 200, 59.4, 2, 2, 5_000), 400))).contains("longitude");
    assertThat(error(answer(viewshed(ALICE, 18.4, 95, 2, 2, 5_000), 400))).contains("latitude");
    assertThat(error(answer(viewshed(ALICE, 18.4, 89.9, 2, 2, 5_000), 400))).contains("pole");
    JsonObject missing = JsonObject.builder().put("observer", position(18.4, 59.4)).put("observerHeight", JsonNumber.of(2)).build();
    assertThat(error(answer(ctx.post("/viewshed", missing, ALICE), 400))).contains("targetHeight");
    JsonObject oneNumber = viewshedBody(18.4, 59.4, 2, 2, 5_000).with("observer", JsonArray.of(JsonNumber.of(18.4)));
    assertThat(error(answer(ctx.post("/viewshed", oneNumber, ALICE), 400))).contains("observer").contains("[longitude, latitude]");
    JsonObject text = viewshedBody(18.4, 59.4, 2, 2, 5_000).with("targetHeight", JsonString.of("2"));
    assertThat(error(answer(ctx.post("/viewshed", text, ALICE), 400))).contains("targetHeight").contains("number");
    assertThat(error(answer(ctx.post("/viewshed", JsonArray.of(JsonBoolean.TRUE), ALICE), 400))).contains("JSON object");
    // the range the admin set is the limit
    ctx.changeSettings(settings(folder, "maxRange", 20_000L));
    ctx.runUntilIdle();
    assertThat(error(answer(viewshed(ALICE, 18.4, 59.4, 2, 2, 20_001), 400))).contains("20000");
    answer(viewshed(ALICE, 18.4, 59.4, 2, 2, 20_000), 200);
    // range and bearing: the same position checks
    assertThat(error(answer(ctx.post("/range", JsonObject.builder().put("from", position(18.0686, 59.3293)).put("to", position(17.6, 95)).build(), ALICE), 400))).contains("\"to\"").contains("latitude");
    assertThat(error(answer(ctx.post("/range", JsonObject.builder().put("from", position(181, 59.3293)).put("to", position(17.6, 59)).build(), ALICE), 400))).contains("\"from\"").contains("longitude");
    assertThat(error(answer(ctx.post("/range", JsonObject.builder().put("from", position(18, 59)).build(), ALICE), 400))).contains("\"to\"");
  }

  @Test
  void aViewshedWithoutDataAtTheObserverIs404AndTheObserversHeightsCountFromTheGround() throws Exception {
    DtedFiles.write(folder, 1, 18, 59, (c, r) -> 100 + (c > 300 ? 50 : 0));
    start(folder);
    assertThat(error(answer(viewshed(ALICE, 25.4, 59.4, 2, 2, 5_000), 404))).contains("no height data at the observer");
    // the viewshed's answer is the same wherever the data's vertical reference lies: shift every height by 700 m
    JsonObject a = answer(viewshed(ALICE, 18.3, 59.4, 2, 2, 5_000), 200);
    Path other = Files.createDirectories(folder.resolve("shifted"));
    DtedFiles.write(other, 1, 18, 59, (c, r) -> 800 + (c > 300 ? 50 : 0));
    ctx.folders().setPath("heights", other);
    ctx.changeSettings(settings(other));
    ctx.runUntilIdle();
    JsonObject b = answer(viewshed(ALICE, 18.3, 59.4, 2, 2, 5_000), 200);
    assertThat(b.get("areas")).isEqualTo(a.get("areas"));
  }

  @Test
  void theMonitorStatusIsSetFromTheFirstMomentAndWorkersDoNotFail() throws Exception {
    start(null);
    assertThat(ctx.effectiveStatus().state()).isEqualTo(PluginState.OK);
    plugin.stop();
    assertThat(ctx.handlerErrors()).isEmpty();
  }
}
