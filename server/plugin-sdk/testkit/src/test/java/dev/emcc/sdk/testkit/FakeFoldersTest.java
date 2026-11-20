package dev.emcc.sdk.testkit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.folder.FolderResult;
import dev.emcc.sdk.folder.FolderResult.Reason;
import dev.emcc.sdk.folder.LocalFolder;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Assumptions;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** SDK 1.4.0 part 6: the test kit's local folders keep ECore's rules (CR-0030 part 6, model rule 19). */
class FakeFoldersTest {

  record Got(FolderResult result) implements Message {}

  private static final Duration T = Duration.ofSeconds(5);

  @TempDir Path temp;

  private final List<FolderResult> got = new ArrayList<>();

  private FakePluginContext ctx(Path heights) {
    return FakePluginContext.builder("terrain").folder("heights", heights).build();
  }

  private WorkerRef<Got> worker(FakePluginContext ctx) {
    return ctx.workers().spawn(WorkerSpec.of("w", Got.class, () -> (m, c) -> got.add(m.result())));
  }

  private Path heights() throws IOException {
    Path root = Files.createDirectories(temp.resolve("heights"));
    Files.createDirectories(root.resolve("dted/e015"));
    Files.write(root.resolve("dted/e015/n59.dt2"), new byte[] {1, 2, 3, 4, 5, 6, 7, 8, 9, 10});
    Files.writeString(root.resolve("readme.txt"), "heights");
    Files.writeString(temp.resolve("secret.txt"), "outside");
    return root;
  }

  @Test
  void readsByteRangesAndListsOneLevelSortedByName() throws IOException {
    var ctx = ctx(heights());
    var w = worker(ctx);
    LocalFolder f = ctx.folders().folder("heights");
    f.read("dted/e015/n59.dt2", 2, 3, T, w, Got::new);
    f.read("dted/e015/n59.dt2", 8, 100, T, w, Got::new);
    f.read("dted/e015/n59.dt2", 10, 4, T, w, Got::new);
    f.list("", T, w, Got::new);
    f.list("dted/e015", T, w, Got::new);
    ctx.runUntilIdle();

    var first = (FolderResult.Read) got.get(0);
    assertThat(first.data().toArray()).containsExactly(3, 4, 5);
    assertThat(first.fileSize()).isEqualTo(10);
    assertThat(((FolderResult.Read) got.get(1)).data().toArray()).as("fewer at the end").containsExactly(9, 10);
    assertThat(((FolderResult.Read) got.get(2)).data().isEmpty()).as("none past the end").isTrue();
    var root = (FolderResult.Listing) got.get(3);
    assertThat(root.entries()).extracting(FolderResult.Entry::name).containsExactly("dted", "readme.txt");
    assertThat(root.entries().get(0).directory()).isTrue();
    assertThat(root.entries().get(1).size()).isEqualTo(7);
    assertThat(((FolderResult.Listing) got.get(4)).entries()).extracting(FolderResult.Entry::name).containsExactly("n59.dt2");
    assertThat(ctx.folders().calls()).hasSize(5);
  }

  @Test
  void refusesPathsOutsideTheFolderAndBadlyWrittenOnes() throws IOException {
    var ctx = ctx(heights());
    var w = worker(ctx);
    LocalFolder f = ctx.folders().folder("heights");
    for (String p : List.of("../secret.txt", "dted/../../secret.txt", "/etc/passwd", "C:/Windows/win.ini", "dted\\e015\\n59.dt2", "dted//e015", "nothing.dt2")) {
      f.read(p, 0, 10, T, w, Got::new);
    }
    f.read("dted/../readme.txt", 0, 10, T, w, Got::new);
    ctx.runUntilIdle();

    assertThat(got.subList(0, 7)).extracting(r -> ((FolderResult.Failed) r).reason())
        .containsExactly(Reason.OUTSIDE, Reason.OUTSIDE, Reason.INVALID_PATH, Reason.INVALID_PATH, Reason.INVALID_PATH, Reason.INVALID_PATH, Reason.NOT_FOUND);
    assertThat(got.get(7)).as(".. that stays inside is fine").isInstanceOf(FolderResult.Read.class);
    assertThat(((FolderResult.Failed) got.get(0)).message()).as("never the absolute path").doesNotContain(temp.toString());
  }

  @Test
  void refusesALinkThatLeadsOutside() throws IOException {
    Path root = heights();
    try {
      Files.createSymbolicLink(root.resolve("link.txt"), temp.resolve("secret.txt"));
    } catch (IOException | UnsupportedOperationException e) {
      Assumptions.abort("symbolic links need a privilege here: " + e);
    }
    var ctx = ctx(root);
    var w = worker(ctx);
    ctx.folders().folder("heights").read("link.txt", 0, 10, T, w, Got::new);
    ctx.runUntilIdle();
    assertThat(((FolderResult.Failed) got.get(0)).reason()).isEqualTo(Reason.OUTSIDE);
  }

  @Test
  void aListingLeavesOutABrokenLinkAsEcoreDoes() throws IOException {
    Path root = heights();
    try {
      Files.createSymbolicLink(root.resolve("broken.dt2"), root.resolve("gone.dt2"));
    } catch (IOException | UnsupportedOperationException e) {
      Assumptions.abort("symbolic links need a privilege here: " + e);
    }
    var ctx = ctx(root);
    var w = worker(ctx);
    ctx.folders().folder("heights").list("", T, w, Got::new);
    ctx.runUntilIdle();
    assertThat(((FolderResult.Listing) got.get(0)).entries()).extracting(FolderResult.Entry::name)
        .as("the owner's LG: left out, not the whole listing failed with IO").containsExactly("dted", "readme.txt");
  }

  @Test
  void answersNotSetMissingWrongKindAndTooLarge() throws IOException {
    var ctx = FakePluginContext.builder("terrain").folder("heights", heights()).folder("unset", null).folder("gone", temp.resolve("none")).build();
    var w = worker(ctx);
    ctx.folders().folder("unset").list("", T, w, Got::new);
    ctx.folders().folder("gone").list("", T, w, Got::new);
    ctx.folders().folder("heights").list("readme.txt", T, w, Got::new);
    ctx.folders().folder("heights").read("dted", 0, 1, T, w, Got::new);
    ctx.folders().folder("heights").read("readme.txt", 0, LocalFolder.MAX_READ_BYTES + 1, T, w, Got::new);
    ctx.runUntilIdle();
    assertThat(got).extracting(r -> ((FolderResult.Failed) r).reason())
        .containsExactly(Reason.NOT_SET, Reason.MISSING, Reason.WRONG_KIND, Reason.WRONG_KIND, Reason.TOO_LARGE);
    assertThatThrownBy(() -> ctx.folders().folder("other")).hasMessageContaining("no folder \"other\"");
    assertThat(ctx.folders().ids()).containsExactly("heights", "unset", "gone");
  }

  @Test
  void aChangedSettingAppliesToLaterCalls() throws IOException {
    var ctx = ctx(heights());
    var w = worker(ctx);
    ctx.folders().setPath("heights", null);
    ctx.folders().folder("heights").read("readme.txt", 0, 10, T, w, Got::new);
    ctx.folders().setPath("heights", temp.resolve("heights"));
    ctx.folders().folder("heights").read("readme.txt", 0, 10, T, w, Got::new);
    ctx.runUntilIdle();
    assertThat(((FolderResult.Failed) got.get(0)).reason()).isEqualTo(Reason.NOT_SET);
    assertThat(((FolderResult.Read) got.get(1)).data().toUtf8()).isEqualTo("heights");
  }

  @Test
  void atMostEightCallsAtATimeAndEachHasItsTimeout() throws IOException {
    var ctx = ctx(heights());
    var w = worker(ctx);
    ctx.folders().hold();
    for (int i = 0; i <= LocalFolder.MAX_CONCURRENT_CALLS; i++) {
      ctx.folders().folder("heights").read("readme.txt", 0, 10, i < 4 ? Duration.ofSeconds(1) : T, w, Got::new);
    }
    ctx.runUntilIdle();
    assertThat(got).extracting(r -> ((FolderResult.Failed) r).reason()).as("the ninth").containsExactly(Reason.BUSY);
    ctx.advance(Duration.ofSeconds(2));
    assertThat(got.subList(1, 5)).extracting(r -> ((FolderResult.Failed) r).reason()).containsOnly(Reason.TIMEOUT);
    ctx.folders().release();
    ctx.runUntilIdle();
    assertThat(got).hasSize(9);
    assertThat(got.subList(5, 9)).allMatch(r -> r instanceof FolderResult.Read);
    assertThat(ctx.folders().inFlight()).isZero();
    assertThatThrownBy(() -> ctx.folders().folder("heights").read("readme.txt", 0, 0, T, w, Got::new)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> ctx.folders().folder("heights").list("", Duration.ZERO, w, Got::new)).hasMessageContaining("timeout");
  }

  @Test
  void theBuilderChecksIdsAndTheCount() {
    var b = FakePluginContext.builder("terrain").folder("heights", null);
    assertThatThrownBy(() -> b.folder("heights", null)).hasMessageContaining("twice");
    assertThatThrownBy(() -> b.folder("Heights", null)).hasMessageContaining("not a folder id");
    for (int i = 1; i < 8; i++) {
      b.folder("f" + i, null);
    }
    assertThatThrownBy(() -> b.folder("f8", null)).hasMessageContaining("at most 8");
  }

  @Test
  void listsASubdirectory() throws IOException {
    var ctx = ctx(heights());
    var w = worker(ctx);
    ctx.folders().folder("heights").list("dted", T, w, Got::new);
    ctx.runUntilIdle();
    assertThat(((FolderResult.Listing) got.getFirst()).entries()).extracting(FolderResult.Entry::name).containsExactly("e015");
  }
}
