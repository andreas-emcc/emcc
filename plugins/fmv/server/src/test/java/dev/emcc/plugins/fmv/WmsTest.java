package dev.emcc.plugins.fmv;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.fmv.out.imagery.ImagerySet;
import dev.emcc.plugins.fmv.out.wms.WmsCache;
import dev.emcc.plugins.fmv.out.wms.WmsGrid;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.channel.ChannelId;
import dev.emcc.sdk.document.Documents;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.http.HttpCall;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.testkit.TestJson;
import java.awt.Color;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.function.Consumer;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * The WMS fetch and {@code fmv}'s tile cache (brief section 10.5 point 17; criterion 33; the owner's
 * answers of 2026-11-17: the 2 km round where the camera looks, WMS 1.3.0, a kept tile of another
 * server used and fetched again). The test kit's HTTP fake is the WMS and its documents the cache.
 */
class WmsTest {

  static final String LINK = OutputTest.LINK;
  static final UUID CAMERA = OutputTest.CAMERA;
  static final SecurityLabel UNCLASSIFIED = OutputTest.UNCLASSIFIED;
  static final String URL = "https://wms.example/ows";

  @TempDir Path terrain;
  @TempDir Path imagery;

  FakePluginContext ctx;

  void start(Consumer<FakePluginContext.Builder> builder, Consumer<FakePluginContext> before) {
    FakePluginContext.Builder b = Manifest.context().compute(8).folder("terrain", terrain).folder("imagery", imagery);
    builder.accept(b);
    ctx = b.build();
    JsonObject kind = (JsonObject) ((JsonArray) Manifest.read().get("channelKinds")).get(0);
    ctx.channels().declare("fmv.camera-pose", kind.getObject("payload"));
    before.accept(ctx);
    FmvPlugin plugin = new FmvPlugin(ctx::clock);
    plugin.init(ctx);
    plugin.start();
    ctx.runUntilIdle();
  }

  void start() {
    start(b -> { }, c -> { });
  }

  @AfterEach
  void stop() {
    if (ctx != null) {
      ctx.compute().stopAll();
      ctx.connections().stopAll();
      assertThat(ctx.handlerErrors()).isEmpty();
    }
  }

  /** The settings: one output link with a destination, and the WMS. */
  void use(String wms) {
    String link = OutputTest.out(LINK, "UAV North", OutputTest.to(OutputTest.freePort()));
    ctx.changeSettings((JsonObject) TestJson.parse("{\"links\":[" + link + "],\"wms\":" + wms + "}"));
    ctx.runUntilIdle();
  }

  static String wms(double metresPerPixel, String more) {
    return "{\"enabled\":true,\"url\":\"" + URL + "\",\"layer\":\"ortho\",\"crs\":\"EPSG:3006\",\"format\":\"image/jpeg\",\"tilePixels\":256,"
        + "\"metresPerPixel\":" + metresPerPixel + more + "}";
  }

  static final String SOURCED = ",\"source\":\"Example\",\"licence\":\"CC0-1.0\"";

  /** Two poses: the first lists the imagery folder (empty), the second plans the WMS tiles once the sets are known. */
  void fly() {
    for (int i = 0; i < 2; i++) {
      ctx.channels().deliver(new ChannelId("fmv", "out-" + LINK), OutputTest.pose(CAMERA, UNCLASSIFIED, ctx.clock()));
      ctx.runUntilIdle();
      ctx.advance(Duration.ofMillis(40));
    }
    ctx.runUntilIdle();
  }

  /** 2.1 s without poses and a tick: the camera has left, its pipeline and view stopped (O2). */
  void land() {
    ctx.advance(Duration.ofMillis(2100));
    ctx.runUntilIdle();
  }

  String status() {
    ctx.advance(Duration.ofMillis(500));
    ctx.runUntilIdle();
    return ctx.pluginStatus().detail();
  }

  static byte[] jpeg(Color colour) {
    try {
      BufferedImage im = new BufferedImage(256, 256, BufferedImage.TYPE_INT_RGB);
      var g = im.createGraphics();
      g.setColor(colour);
      g.fillRect(0, 0, 256, 256);
      g.dispose();
      ByteArrayOutputStream out = new ByteArrayOutputStream();
      ImageIO.write(im, "jpeg", out);
      return out.toByteArray();
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  static final Headers JPEG = Headers.of("Content-Type", "image/jpeg");

  /** The grid's tiles within 6 km of the camera, all that the round where it looks can hold. */
  static List<WmsGrid.Tile> near(WmsGrid grid, double km) {
    double[] xy = new double[2];
    grid.project(17.3, 62.4, xy);
    double m = km * 1000;
    double reach = grid.crs() == ImagerySet.Crs.EPSG_3006 ? m : m / 50_000;
    List<WmsGrid.Tile> tiles = new ArrayList<>();
    for (int r = grid.row(xy[1] - reach); r <= grid.row(xy[1] + reach); r++) {
      for (int c = grid.column(xy[0] - reach); c <= grid.column(xy[0] + reach); c++) {
        tiles.add(grid.tile(c, r));
      }
    }
    return tiles;
  }

  /** The tile under where the test pose looks: 1 000 m up, heading 45° and azimuth 90°, 30° down, so 1 732 m to the south-east. */
  static WmsGrid.Tile looked(WmsGrid grid) {
    double d = 1000 / Math.tan(Math.toRadians(30));
    double b = Math.toRadians(135);
    double lon = 17.3 + Math.toDegrees(d * Math.sin(b) / (6_371_009 * Math.cos(Math.toRadians(62.4))));
    double lat = 62.4 + Math.toDegrees(d * Math.cos(b) / 6_371_009);
    double[] xy = new double[2];
    grid.project(lon, lat, xy);
    return grid.tile(grid.column(xy[0]), grid.row(xy[1]));
  }

  void serve(WmsGrid grid, byte[] image) {
    for (WmsGrid.Tile t : near(grid, 6)) {
      ctx.upstream().respond(grid.getMap(URL, "ortho", "image/jpeg", t).toString(), 200, JPEG, Bytes.of(image));
    }
  }

  static JsonObject tileDocument(WmsGrid grid, WmsGrid.Tile t, String url, int tilePixels, byte[] image) {
    return tileDocument(grid, t, url, "ortho", tilePixels, image);
  }

  static JsonObject tileDocument(WmsGrid grid, WmsGrid.Tile t, String url, String layer, int tilePixels, byte[] image) {
    return JsonObject.builder().put("crs", JsonNumber.of(3006)).put("metresPerPixel", JsonNumber.of(grid.metresPerPixel()))
        .put("tilePixels", JsonNumber.of(tilePixels)).put("column", JsonNumber.of(t.column())).put("row", JsonNumber.of(t.row()))
        .put("url", JsonString.of(url)).put("layer", JsonString.of(layer)).put("format", JsonString.of("image/jpeg"))
        .put("source", JsonString.of("Example")).put("licence", JsonString.of("CC0-1.0")).put("fetched", JsonString.of("2026-11-17T10:00:00Z"))
        .put("image", JsonString.of(Base64.getEncoder().encodeToString(image))).build();
  }

  Set<String> fetchedUris() {
    Set<String> uris = new LinkedHashSet<>();
    for (HttpCall c : ctx.httpCalls()) {
      uris.add(c.uri().toString());
    }
    return uris;
  }

  List<String> indexKeys() {
    JsonObject index = ctx.documents().stored().get(WmsCache.INDEX_KEY);
    List<String> keys = new ArrayList<>();
    for (JsonValue v : ((JsonArray) index.get("tiles")).values()) {
      keys.add(((JsonString) ((JsonArray) v).get(0)).value());
    }
    return keys;
  }

  // ------------------------------------------------------------------- criterion 33

  @Test
  void criterion33TheTilesAreFetchedOnceThenRenderedFromTheCacheWithTheServerGone() {
    start();
    WmsGrid grid = new WmsGrid(ImagerySet.Crs.EPSG_3006, 256, 10); // 2 560 m tiles: a handful in the round
    serve(grid, jpeg(Color.GREEN));
    use(wms(10, SOURCED));
    fly();
    Set<String> fetched = fetchedUris();
    assertThat(fetched).hasSizeBetween(3, 9).hasSameSizeAs(ctx.httpCalls()); // each tile once
    assertThat(fetched).allSatisfy(u -> assertThat(u).startsWith(URL + "?SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&LAYERS=ortho&STYLES=&CRS=EPSG:3006&BBOX="));
    assertThat(fetched).contains(grid.getMap(URL, "ortho", "image/jpeg", looked(grid)).toString());
    assertThat(ctx.httpCalls()).allSatisfy(c -> assertThat(c.credential()).isNull());
    String line = status();
    assertThat(line).contains("WMS imagery: fetching from wms.example, " + fetched.size() + " tiles kept", "source Example", "licence CC0-1.0",
        "wms fetched " + fetched.size());

    // the documents: one per tile under the prefix, by the brief's key and the documents' rule, and the index outside it
    Set<String> tileKeys = new HashSet<>();
    ctx.documents().stored().forEach((key, doc) -> {
      if (key.startsWith(WmsGrid.PREFIX)) {
        tileKeys.add(key);
        assertThat(Documents.checkKey(key)).matches("wms-tile-cache\\.3006-10\\.0-\\d+-\\d+");
        assertThat(doc.getString("source")).isEqualTo("Example");
        assertThat(doc.getString("licence")).isEqualTo("CC0-1.0");
        assertThat(doc.getString("url")).isEqualTo(URL);
        assertThat(Base64.getDecoder().decode(doc.getString("image"))).isEqualTo(jpeg(Color.GREEN));
      } else {
        assertThat(key).isEqualTo(WmsCache.INDEX_KEY).doesNotStartWith(WmsGrid.PREFIX); // no other document of fmv starts with the prefix
      }
    });
    assertThat(tileKeys).hasSize(fetched.size());
    assertThat(indexKeys()).containsExactlyInAnyOrderElementsOf(tileKeys);

    // the server gone: the camera flies again and the tiles come from the cache
    land();
    for (WmsGrid.Tile t : near(grid, 6)) {
      ctx.upstream().fail(grid.getMap(URL, "ortho", "image/jpeg", t).toString(), "connection refused");
    }
    fly();
    assertThat(ctx.httpCalls()).hasSize(fetched.size()); // no new call
    assertThat(status()).contains("wms from cache " + fetched.size()).doesNotContain("wms failed");
  }

  @Test
  void criterion33The901stTileRemovesTheLeastRecentlyUsedOne() {
    WmsGrid grid = new WmsGrid(ImagerySet.Crs.EPSG_3006, 256, 10);
    WmsGrid.Tile used = looked(grid);
    List<String> fillers = new ArrayList<>();
    for (int i = 1; i < WmsCache.MAX_TILES; i++) {
      fillers.add(grid.key(5000 + i, 0)); // far away
    }
    start(b -> { }, c -> {
      List<JsonValue> index = new ArrayList<>();
      index.add(JsonArray.of(JsonString.of(used.key()), JsonNumber.of(1000))); // the oldest, but used again below
      for (String f : fillers) {
        index.add(JsonArray.of(JsonString.of(f), JsonNumber.of(1000)));
      }
      c.documents().seed(WmsCache.INDEX_KEY, JsonObject.builder().put("tiles", new JsonArray(index)).build());
      c.documents().seed(used.key(), tileDocument(grid, used, URL, 256, jpeg(Color.BLUE)));
      c.documents().seed(fillers.get(0), tileDocument(grid, grid.tile(5001, 0), URL, 256, jpeg(Color.RED)));
      c.documents().seed(fillers.get(1), tileDocument(grid, grid.tile(5002, 0), URL, 256, jpeg(Color.RED)));
    });
    serve(grid, jpeg(Color.GREEN));
    use(wms(10, SOURCED));
    fly();
    int fetched = ctx.httpCalls().size();
    assertThat(fetched).isGreaterThanOrEqualTo(2);
    assertThat(fetchedUris()).doesNotContain(grid.getMap(URL, "ortho", "image/jpeg", used).toString()); // kept: from the cache

    // each fetched tile beyond 900 removed the least recently used one: the oldest fillers, not the tile just used
    assertThat(ctx.documents().stored()).doesNotContainKeys(fillers.get(0), fillers.get(1)).containsKey(used.key());
    assertThat(status()).contains(WmsCache.MAX_TILES + " tiles kept", "wms from cache 1", "wms fetched " + fetched);
    List<String> index = indexKeys();
    assertThat(index).hasSize(WmsCache.MAX_TILES).contains(used.key()).doesNotContainAnyElementsOf(fillers.subList(0, fetched));
    assertThat(index).contains(fillers.get(fetched)); // the next oldest stays
    assertThat(index.indexOf(used.key())).isGreaterThan(index.indexOf(fillers.get(fillers.size() - 1))); // used: now among the newest
  }

  @Test
  void criterion33WithoutASourceOrALicenceNothingIsFetchedAndTheMonitorSaysWhy() {
    start();
    WmsGrid grid = new WmsGrid(ImagerySet.Crs.EPSG_3006, 256, 10);
    serve(grid, jpeg(Color.GREEN));
    use(wms(10, ",\"source\":\"Example\""));
    fly();
    assertThat(ctx.httpCalls()).isEmpty();
    assertThat(status()).contains("WMS imagery: not fetching (no source or licence), 0 tiles kept");
    use(wms(10, ",\"licence\":\"CC0-1.0\""));
    fly();
    assertThat(ctx.httpCalls()).isEmpty();
  }

  @Test
  void criterion33AKeptTileOfAnotherLayerIsUsedAndFetchedAgain() {
    WmsGrid grid = new WmsGrid(ImagerySet.Crs.EPSG_3006, 256, 10);
    WmsGrid.Tile old = looked(grid);
    start(b -> { }, c -> c.documents().seed(old.key(), tileDocument(grid, old, URL, "old-layer", 256, jpeg(Color.BLUE))));
    serve(grid, jpeg(Color.GREEN));
    use(wms(10, SOURCED));
    fly();
    assertThat(status()).contains("wms from cache 1"); // used at once
    assertThat(fetchedUris()).contains(grid.getMap(URL, "ortho", "image/jpeg", old).toString()); // and fetched again from the layer set now
    JsonObject replaced = ctx.documents().stored().get(old.key());
    assertThat(replaced.getString("layer")).isEqualTo("ortho");
    assertThat(Base64.getDecoder().decode(replaced.getString("image"))).isEqualTo(jpeg(Color.GREEN));
  }

  // ------------------------------------------------------------------- the owner's answers and O7

  @Test
  void aKeptTileOfAnotherServerIsUsedAndFetchedAgainOwner20261117() {
    WmsGrid grid = new WmsGrid(ImagerySet.Crs.EPSG_3006, 256, 10);
    WmsGrid.Tile old = looked(grid);
    start(b -> { }, c -> c.documents().seed(old.key(), tileDocument(grid, old, "https://old.example/wms", 256, jpeg(Color.BLUE))));
    serve(grid, jpeg(Color.GREEN));
    use(wms(10, SOURCED));
    fly();
    assertThat(fetchedUris()).contains(grid.getMap(URL, "ortho", "image/jpeg", old).toString());
    JsonObject replaced = ctx.documents().stored().get(old.key());
    assertThat(replaced.getString("url")).isEqualTo(URL);
    assertThat(Base64.getDecoder().decode(replaced.getString("image"))).isEqualTo(jpeg(Color.GREEN));
    assertThat(status()).contains("wms from cache 1");
  }

  @Test
  void aKeptTileOfAnotherTileSizeIsNeverUsed() {
    WmsGrid grid = new WmsGrid(ImagerySet.Crs.EPSG_3006, 256, 10);
    WmsGrid.Tile other = looked(grid);
    start(b -> { }, c -> c.documents().seed(other.key(), tileDocument(grid, other, URL, 512, jpeg(Color.BLUE))));
    serve(grid, jpeg(Color.GREEN));
    use(wms(10, SOURCED));
    fly();
    assertThat(fetchedUris()).contains(grid.getMap(URL, "ortho", "image/jpeg", other).toString());
    assertThat(status()).doesNotContain("wms from cache");
    assertThat(ctx.documents().stored().get(other.key()).getNumber("tilePixels").doubleValue()).isEqualTo(256);
  }

  @Test
  void o7AtMostFourAtATime() {
    start();
    WmsGrid grid = new WmsGrid(ImagerySet.Crs.EPSG_3006, 256, 10);
    for (WmsGrid.Tile t : near(grid, 6)) {
      ctx.upstream().respondAfter(Duration.ofMillis(300), grid.getMap(URL, "ortho", "image/jpeg", t).toString(), 200, JPEG, Bytes.of(jpeg(Color.GREEN)));
    }
    use(wms(10, SOURCED));
    fly();
    assertThat(ctx.httpCalls()).hasSize(WmsCache.MAX_IN_FLIGHT);
    ctx.advance(Duration.ofMillis(300));
    ctx.runUntilIdle();
    assertThat(ctx.httpCalls()).hasSizeGreaterThan(WmsCache.MAX_IN_FLIGHT);
  }

  @Test
  void o7AtMostTwentyASecond() {
    start();
    WmsGrid grid = new WmsGrid(ImagerySet.Crs.EPSG_3006, 256, 1); // 256 m tiles: about 240 in the round
    serve(grid, jpeg(Color.GREEN));
    use(wms(1, SOURCED));
    fly();
    assertThat(ctx.httpCalls()).hasSize(WmsCache.MAX_PER_SECOND);
    ctx.advance(Duration.ofMillis(1500));
    ctx.runUntilIdle();
    assertThat(ctx.httpCalls()).hasSize(2 * WmsCache.MAX_PER_SECOND);
    assertThat(status()).contains("waiting");
  }

  @Test
  void theTokenSettingNamesTheCallsCredentialNeverTheToken() {
    start(b -> b.httpCredentials("lantmateriet"), c -> { });
    WmsGrid grid = new WmsGrid(ImagerySet.Crs.EPSG_3006, 256, 10);
    serve(grid, jpeg(Color.GREEN));
    use(wms(10, SOURCED + ",\"token\":\"lantmateriet\""));
    fly();
    assertThat(ctx.httpCalls()).isNotEmpty().allSatisfy(c -> {
      assertThat(c.credential()).isEqualTo("lantmateriet");
      assertThat(c.uri().toString()).doesNotContain("lantmateriet");
    });
    assertThat(status()).contains("wms fetched");
  }

  @Test
  void aWmsExceptionIsNoTileItIsCountedAndNamed() {
    start();
    WmsGrid grid = new WmsGrid(ImagerySet.Crs.EPSG_3006, 256, 10);
    for (WmsGrid.Tile t : near(grid, 6)) {
      ctx.upstream().respond(grid.getMap(URL, "ortho", "image/jpeg", t).toString(), 200, Headers.of("Content-Type", "text/xml"),
          Bytes.utf8("<ServiceExceptionReport><ServiceException>Layer not defined</ServiceException></ServiceExceptionReport>"));
    }
    use(wms(10, SOURCED));
    fly();
    String line = status();
    assertThat(line).contains("wms failed", "last failure: not an image", "0 tiles kept");
    assertThat(ctx.documents().stored().keySet()).noneMatch(k -> k.startsWith(WmsGrid.PREFIX));
  }

  @Test
  void aUrlNoUriTakesFetchesNothingAndBreaksNothing() {
    start();
    use("{\"enabled\":true,\"url\":\"https://wms.example/a|b\",\"layer\":\"ortho\"" + SOURCED + "}");
    fly();
    assertThat(ctx.httpCalls()).isEmpty();
    assertThat(status()).contains("WMS imagery: not fetching (no server)");
    // the handler threw nothing: checked after each test
  }

  @Test
  void offByDefaultNoRequestAndNoLine() {
    start();
    WmsGrid grid = new WmsGrid(ImagerySet.Crs.EPSG_3006, 256, 1);
    serve(grid, jpeg(Color.GREEN));
    String link = OutputTest.out(LINK, "UAV North", OutputTest.to(OutputTest.freePort()));
    ctx.changeSettings((JsonObject) TestJson.parse("{\"links\":[" + link + "]}"));
    ctx.runUntilIdle();
    fly();
    assertThat(ctx.httpCalls()).isEmpty();
    assertThat(status()).doesNotContain("WMS");
  }
}
