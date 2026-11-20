package dev.emcc.plugins.fmv.out.terrain;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.folder.FolderResult;
import dev.emcc.sdk.testkit.FakeFolders;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** The worker's terrain reads (brief section 10.5 point 16, O6, A4): only through the declared folder. */
class TerrainReaderTest {

  record Got(FolderResult result) implements Message {}

  @TempDir Path dir;

  private final List<FolderResult> results = new ArrayList<>();

  private FakePluginContext ctx;
  private TerrainReader<Got> reader;

  private void start() {
    ctx = FakePluginContext.builder("fmv").folder("terrain", dir).build();
    WorkerRef<Got> self = ctx.workers().spawn(WorkerSpec.of("terrain", Got.class, () -> (m, c) -> results.add(m.result())));
    reader = new TerrainReader<>(ctx.folders().folder("terrain"), self, Got::new, Duration.ofSeconds(5));
  }

  /** Runs the fake until idle and feeds every result to the reader, until nothing is left. */
  private List<TerrainReader.Outcome> settle() {
    List<TerrainReader.Outcome> out = new ArrayList<>();
    for (int i = 0; i < 20; i++) {
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

  private void write(String path, byte[] data) throws Exception {
    Path p = dir.resolve(path);
    Files.createDirectories(p.getParent());
    Files.write(p, data);
  }

  @Test
  void readsTheHighestLevelOfEachCellInTheRoundAndOnlyThroughTheFolder() throws Exception {
    write("e017/n62.dt0", DtedFiles.cell(17, 62, 121, (i, j) -> 1));
    write("e017/n62.dt2", DtedFiles.cell(17, 62, 121, (i, j) -> 2));
    write("e018/n62.dt1", DtedFiles.cell(18, 62, 121, (i, j) -> 3));
    start();
    // near the cells' corner at 18° E, 63° N: four cells; e018/n63 and e017/n63 have no file
    Set<CellKey> dropped = reader.aim(17.95, 62.96);
    assertThat(dropped).isEmpty();
    assertThat(reader.wanted()).containsExactlyInAnyOrder(new CellKey(17, 62), new CellKey(18, 62), new CellKey(17, 63), new CellKey(18, 63));
    List<TerrainReader.Outcome> out = settle();

    List<String> loaded = out.stream().filter(o -> o instanceof TerrainReader.Outcome.Loaded).map(o -> ((TerrainReader.Outcome.Loaded) o).path()).toList();
    assertThat(loaded).containsExactlyInAnyOrder("e017/n62.dt2", "e018/n62.dt1");
    assertThat(out).filteredOn(o -> o instanceof TerrainReader.Outcome.Missing).hasSize(2);
    for (TerrainReader.Outcome o : out) {
      if (o instanceof TerrainReader.Outcome.Loaded l) {
        DtedCell cell = DtedCell.parse(l.data().toArray());
        assertThat(cell.key()).isEqualTo(l.key());
        assertThat(cell.height(l.key().lon() + 0.5, l.key().lat() + 0.5)).isEqualTo(l.key().lon() == 17 ? 2 : 3);
      }
    }
    // every call went to the declared folder: two listings and two reads
    assertThat(ctx.folders().calls()).extracting(FakeFolders.Call::folder).containsOnly("terrain");
    assertThat(ctx.folders().calls()).filteredOn(c -> c.operation().equals("read")).hasSize(2);
  }

  @Test
  void movingFiveKilometresAimsAgainAndLetsCellsGo() throws Exception {
    write("e017/n62.dt0", DtedFiles.cell(17, 62, 121, (i, j) -> 1));
    write("e016/n62.dt0", DtedFiles.cell(16, 62, 121, (i, j) -> 1));
    start();
    reader.aim(17.3, 62.4);
    settle();
    assertThat(reader.shouldAim(17.3 + 0.08, 62.4)).isFalse(); // about 4.1 km
    assertThat(reader.shouldAim(17.3 + 0.1, 62.4)).isTrue(); // about 5.2 km
    // far west: the 17° column goes, the 16° one comes, and nothing is read twice
    Set<CellKey> dropped = reader.aim(16.3, 62.4);
    assertThat(dropped).containsExactly(new CellKey(17, 62));
    List<TerrainReader.Outcome> out = settle();
    assertThat(out).singleElement().isInstanceOf(TerrainReader.Outcome.Loaded.class);
    reader.aim(16.31, 62.4);
    assertThat(settle()).isEmpty();
  }

  @Test
  void aMissingFolderOrColumnGivesTheFallbackAndAnUnsetFolderIsAFailure() throws Exception {
    start();
    reader.aim(17.3, 62.4);
    assertThat(settle()).singleElement().isInstanceOf(TerrainReader.Outcome.Missing.class);

    ctx.folders().setPath("terrain", null);
    reader.aim(-70.6, -33.4); // Santiago: latitude ≠ longitude
    List<TerrainReader.Outcome> out = settle();
    assertThat(out).isNotEmpty().allSatisfy(o -> {
      assertThat(o).isInstanceOf(TerrainReader.Outcome.Failed.class);
      assertThat(((TerrainReader.Outcome.Failed) o).reason()).isEqualTo(FolderResult.Reason.NOT_SET);
    });
  }

  @Test
  void aBrokenFileIsReadAndRefusedByTheParserNotTheReader() throws Exception {
    write("e017/n62.dt1", new byte[] {1, 2, 3});
    start();
    reader.aim(17.3, 62.4);
    List<TerrainReader.Outcome> out = settle();
    assertThat(out).singleElement().isInstanceOf(TerrainReader.Outcome.Loaded.class);
    TerrainReader.Outcome.Loaded l = (TerrainReader.Outcome.Loaded) out.getFirst();
    org.assertj.core.api.Assertions.assertThatThrownBy(() -> DtedCell.parse(l.data().toArray())).isInstanceOf(DtedCell.DtedException.class);
  }
}
