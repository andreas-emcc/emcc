package dev.emcc.plugins.fmv.out.imagery;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.folder.FolderResult;
import dev.emcc.sdk.testkit.FakeFolders;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The worker's imagery reads (brief section 10.5 point 16, O6; the owner's B3 and Q4): only through the declared folder. */
class ImageryReaderTest {

  record Got(FolderResult result) implements Message {}

  @TempDir Path dir;

  private final List<FolderResult> results = new ArrayList<>();
  private FakePluginContext ctx;
  private ImageryReader<Got> reader;

  private void start(@Nullable String wanted) {
    ctx = FakePluginContext.builder("fmv").folder("imagery", dir).build();
    WorkerRef<Got> self = ctx.workers().spawn(WorkerSpec.of("imagery", Got.class, () -> (m, c) -> results.add(m.result())));
    reader = new ImageryReader<>(ctx.folders().folder("imagery"), self, Got::new, Duration.ofSeconds(5), wanted);
  }

  private List<ImageryReader.Outcome> settle(List<ImageryReader.Outcome> first) {
    List<ImageryReader.Outcome> out = new ArrayList<>(first);
    for (int i = 0; i < 50; i++) {
      ctx.runUntilIdle();
      if (results.isEmpty()) {
        break;
      }
      List<FolderResult> now = List.copyOf(results);
      results.clear();
      now.forEach(r -> out.addAll(reader.onResult(r)));
    }
    return out;
  }

  /**
   * A set in EPSG:4326 of {@code n} × 1 tiles 0.02° wide from longitude {@code lon0}, latitude 62.39 to
   * 62.40, each stated {@code pixels} square; the tile files hold a few bytes (the reader does not decode).
   */
  private void set(String folder, double lon0, int n, int pixels, boolean licence) throws Exception {
    StringBuilder tiles = new StringBuilder();
    Files.createDirectories(dir.resolve(folder));
    for (int i = 0; i < n; i++) {
      String file = "t" + i + ".png";
      Files.write(dir.resolve(folder).resolve(file), new byte[] {1, 2, 3});
      tiles.append(i == 0 ? "" : ",").append(String.format(Locale.ROOT, "{\"file\":\"%s\",\"min\":[%.4f,62.39],\"max\":[%.4f,62.40],\"width\":%d,\"height\":%d}",
          file, lon0 + 0.02 * i, lon0 + 0.02 * (i + 1), pixels, pixels));
    }
    String json = "{\"name\":\"" + folder + "\",\"source\":\"tests\"," + (licence ? "\"licence\":\"CC0 1.0\"," : "") + "\"crs\":\"EPSG:4326\",\"tiles\":[" + tiles + "]}";
    Files.writeString(dir.resolve(folder).resolve("imagery.json"), json, StandardCharsets.UTF_8);
  }

  private static List<String> files(List<ImageryReader.Outcome> out, Class<?> kind) {
    return out.stream().filter(kind::isInstance).map(o -> o instanceof ImageryReader.Outcome.Tile t ? t.spec().file()
        : ((ImageryReader.Outcome.DropTile) o).spec().file()).toList();
  }

  @Test
  void ownersB3TheFirstSetByNameThatCoversTheCameraAndASetWithoutALicenceIsRefused() throws Exception {
    set("a-nolicence", 17.29, 2, 1000, false);
    set("b-sundsvall", 17.29, 2, 1000, true);
    set("c-sundsvall", 17.29, 2, 1000, true);
    set("d-elsewhere", 12.0, 1, 1000, true);
    start(null);
    List<ImageryReader.Outcome> out = settle(reader.aim(17.30, 62.395));
    assertThat(out).filteredOn(o -> o instanceof ImageryReader.Outcome.Refused).singleElement()
        .satisfies(o -> assertThat(((ImageryReader.Outcome.Refused) o).reason()).contains("licence"));
    assertThat(out).filteredOn(o -> o instanceof ImageryReader.Outcome.UseSet).singleElement()
        .satisfies(o -> assertThat(((ImageryReader.Outcome.UseSet) o).set().folder()).isEqualTo("b-sundsvall"));
    assertThat(files(out, ImageryReader.Outcome.Tile.class)).containsExactly("t0.png", "t1.png"); // the camera's tile first
    assertThat(ctx.folders().calls()).extracting(FakeFolders.Call::folder).containsOnly("imagery");
  }

  @Test
  void theLinksSetIsUsedByItsFolderName() throws Exception {
    set("b-sundsvall", 17.29, 1, 1000, true);
    set("c-sundsvall", 17.29, 1, 1000, true);
    start("c-sundsvall");
    List<ImageryReader.Outcome> out = settle(reader.aim(17.30, 62.395));
    assertThat(out).filteredOn(o -> o instanceof ImageryReader.Outcome.UseSet).singleElement()
        .satisfies(o -> assertThat(((ImageryReader.Outcome.UseSet) o).set().folder()).isEqualTo("c-sundsvall"));
  }

  @Test
  void ownersQ4AtMost256MillionPixelsNearestFirstTheRestCounted() throws Exception {
    set("b-sundsvall", 17.29, 6, 8192, true); // 67 million pixels a tile: three fit, the other three do not
    start(null);
    List<ImageryReader.Outcome> out = settle(reader.aim(17.295, 62.395));
    assertThat(files(out, ImageryReader.Outcome.Tile.class)).containsExactly("t0.png", "t1.png", "t2.png");
    assertThat(reader.overCap()).isEqualTo(3);
  }

  @Test
  void movingFiveKilometresDropsTheTilesLeftBehindAndReadsTheNewOnes() throws Exception {
    set("b-sundsvall", 17.0, 40, 500, true); // 17.0 to 17.8° E: about 41 km
    start(null);
    List<ImageryReader.Outcome> first = settle(reader.aim(17.05, 62.395));
    List<String> before = files(first, ImageryReader.Outcome.Tile.class);
    assertThat(before).contains("t0.png", "t2.png").doesNotContain("t30.png");
    assertThat(reader.shouldAim(17.1, 62.395)).isFalse(); // about 2.6 km
    assertThat(reader.shouldAim(17.5, 62.395)).isTrue();
    List<ImageryReader.Outcome> second = settle(reader.aim(17.5, 62.395));
    assertThat(files(second, ImageryReader.Outcome.DropTile.class)).contains("t0.png");
    assertThat(files(second, ImageryReader.Outcome.Tile.class)).contains("t25.png").doesNotContainAnyElementsOf(before.stream().filter(f -> !f.equals("t20.png")).toList().subList(0, 2));
  }

  @Test
  void noSetCoversTheCameraAndAnEmptyFolderGivesNothing() throws Exception {
    set("d-elsewhere", 12.0, 1, 1000, true);
    start(null);
    assertThat(settle(reader.aim(17.30, 62.395))).isEmpty();
    assertThat(reader.chosen()).isNull();
  }
}
