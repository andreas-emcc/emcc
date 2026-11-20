package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import dev.emcc.ecore.runtime.Probe;
import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.folder.FolderResult;
import dev.emcc.sdk.folder.FolderResult.Reason;
import dev.emcc.sdk.folder.LocalFolder;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.io.IOException;
import java.net.URLClassLoader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Executor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * ECore's local folders (SDK 1.4.0, CR-0030 part 6, ADR-0049 point 4), over real test directories,
 * with the test kit's {@code FakeFoldersTest} cases and what only ECore does: its own I/O threads,
 * the setting read at each call, the real path opened (the ACA's R3 on part 6), and texts without
 * the absolute path.
 */
class PluginLocalFoldersTest {

  record Got(String what, FolderResult result) implements Message {}

  private static final String ID = "terrain";
  private static final PluginManifest.Folder HEIGHTS = new PluginManifest.Folder("heights", "/paths/heights", "Height data.");
  private static final PluginManifest.Folder MAPS = new PluginManifest.Folder("maps", "/maps", "Maps.");

  @TempDir Path temp;

  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults());
  private final Probe<Got> results = new Probe<>();
  private final AtomicReference<JsonObject> settings = new AtomicReference<>(JsonObject.empty());
  private final HeldIo io = new HeldIo();
  private Path root;
  private PluginLocalFolders folders;
  private WorkerRef<Got> worker;

  /** The runtime's I/O executor, or, while held, a queue that runs only on {@link #release}. */
  private final class HeldIo implements Executor {
    private final List<Runnable> held = new ArrayList<>();
    private boolean holding;

    @Override
    public synchronized void execute(Runnable task) {
      if (holding) {
        held.add(task);
      } else {
        runtime.ioExecutor().execute(task);
      }
    }

    synchronized void hold() {
      holding = true;
    }

    synchronized void release() {
      holding = false;
      held.forEach(runtime.ioExecutor()::execute);
      held.clear();
    }
  }

  @BeforeEach
  void start() throws IOException {
    root = Files.createDirectory(temp.resolve("heights"));
    Files.write(root.resolve("b.dt2"), "0123456789".getBytes(StandardCharsets.US_ASCII));
    Files.write(root.resolve("a.dt2"), "abc".getBytes(StandardCharsets.US_ASCII));
    Files.createDirectory(root.resolve("e017"));
    Files.write(root.resolve("e017/n59.dt2"), "cell".getBytes(StandardCharsets.US_ASCII));
    Files.write(temp.resolve("secret.txt"), "outside".getBytes(StandardCharsets.US_ASCII));
    setPath(root);
    folders = new PluginLocalFolders(ID, List.of(HEIGHTS, MAPS), settings::get, runtime, io);
    worker = new PluginWorkers(ID, runtime.owner(ID), new URLClassLoader(new java.net.URL[0], getClass().getClassLoader()))
        .spawn(WorkerSpec.of("terrain", Got.class, () -> (message, ctx) -> results.add(message)).mailbox(1, dev.emcc.sdk.worker.Overflow.dropNewest()));
  }

  @AfterEach
  void stop() {
    io.release();
    runtime.close();
  }

  private void setPath(Path path) {
    setPath(path.toString());
  }

  private void setPath(String path) {
    settings.set(JsonObject.builder().put("paths", JsonObject.builder().put("heights", JsonString.of(path)).build()).build());
  }

  private FolderResult list(String dir) {
    folders.folder("heights").list(dir, Duration.ofSeconds(5), worker, r -> new Got(dir, r));
    return results.next().result();
  }

  private FolderResult read(String path, long offset, int length) {
    folders.folder("heights").read(path, offset, length, Duration.ofSeconds(5), worker, r -> new Got(path, r));
    return results.next().result();
  }

  private static String text(FolderResult result) {
    assertThat(result).isInstanceOf(FolderResult.Read.class);
    return ((FolderResult.Read) result).data().toUtf8();
  }

  private Reason failed(FolderResult result) {
    assertThat(result).isInstanceOf(FolderResult.Failed.class);
    FolderResult.Failed f = (FolderResult.Failed) result;
    assertThat(f.message()).as("never the absolute path (ADR-0030)").doesNotContain(temp.toString()).doesNotContain(temp.getFileName().toString());
    return f.reason();
  }

  @Test
  void listsOneDirectorySortedByNameAndReadsByteRanges() {
    FolderResult listing = list("");
    assertThat(listing).isInstanceOfSatisfying(FolderResult.Listing.class, l -> {
      assertThat(l.path()).isEmpty();
      assertThat(l.entries()).extracting(FolderResult.Entry::name).containsExactly("a.dt2", "b.dt2", "e017");
      assertThat(l.entries().get(1).size()).isEqualTo(10);
      assertThat(l.entries().get(2).directory()).isTrue();
      assertThat(l.entries().get(2).size()).isZero();
    });
    assertThat(list("e017")).isInstanceOfSatisfying(FolderResult.Listing.class,
        l -> assertThat(l.entries()).extracting(FolderResult.Entry::name).containsExactly("n59.dt2"));

    assertThat(text(read("b.dt2", 2, 3))).isEqualTo("234");
    assertThat(read("b.dt2", 7, 100)).isInstanceOfSatisfying(FolderResult.Read.class, r -> {
      assertThat(r.data().toUtf8()).as("fewer at the end").isEqualTo("789");
      assertThat(r.offset()).isEqualTo(7);
      assertThat(r.fileSize()).isEqualTo(10);
    });
    assertThat(read("b.dt2", 10, 5)).isInstanceOfSatisfying(FolderResult.Read.class, r -> {
      assertThat(r.data().size()).as("none past it").isZero();
      assertThat(r.fileSize()).isEqualTo(10);
    });
    assertThat(text(read("e017/n59.dt2", 0, LocalFolder.MAX_READ_BYTES))).isEqualTo("cell");
    assertThat(text(read("e017/../a.dt2", 0, 3))).as("a .. that stays inside").isEqualTo("abc");
    assertThat(folders.inFlight()).isZero();
  }

  @Test
  void refusesBadlyWrittenPathsPathsOutsideAndTheWrongKind() {
    String drive = temp.getRoot().toString().replace("\\", "/");
    for (String bad : List.of("/a.dt2", drive + "a.dt2", "C:a.dt2", "e017\\n59.dt2", "e017//n59.dt2", "e017/", "a\0b")) {
      assertThat(failed(read(bad, 0, 1))).as(bad).isEqualTo(Reason.INVALID_PATH);
    }
    assertThat(failed(read("../secret.txt", 0, 10))).isEqualTo(Reason.OUTSIDE);
    assertThat(failed(list(".."))).isEqualTo(Reason.OUTSIDE);
    assertThat(failed(read("e017/../../secret.txt", 0, 10))).isEqualTo(Reason.OUTSIDE);
    assertThat(failed(read("nothing.dt2", 0, 1))).isEqualTo(Reason.NOT_FOUND);
    assertThat(failed(list("a.dt2"))).isEqualTo(Reason.WRONG_KIND);
    assertThat(failed(read("e017", 0, 1))).isEqualTo(Reason.WRONG_KIND);
    assertThat(failed(read("a.dt2", 0, LocalFolder.MAX_READ_BYTES + 1))).isEqualTo(Reason.TOO_LARGE);
    assertThatThrownBy(() -> folders.folder("heights").read("a.dt2", -1, 1, Duration.ofSeconds(1), worker, r -> new Got("", r)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> folders.folder("heights").read("a.dt2", 0, 0, Duration.ofSeconds(1), worker, r -> new Got("", r)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> folders.folder("heights").list("", Duration.ZERO, worker, r -> new Got("", r)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> folders.folder("heights").list("", Duration.ofMinutes(11), worker, r -> new Got("", r)))
        .isInstanceOf(IllegalArgumentException.class);
    assertThat(folders.inFlight()).isZero();
  }

  @Test
  void theFolderIsTheSettingAtEachCall() throws IOException {
    assertThat(folders.ids()).containsExactly("heights", "maps");
    assertThatThrownBy(() -> folders.folder("other")).isInstanceOf(IllegalArgumentException.class).hasMessageContaining("heights, maps");

    folders.folder("maps").list("", Duration.ofSeconds(5), worker, r -> new Got("maps", r));
    assertThat(failed(results.next().result())).as("its setting is absent").isEqualTo(Reason.NOT_SET);
    setPath("");
    assertThat(failed(read("a.dt2", 0, 1))).isEqualTo(Reason.NOT_SET);
    setPath("relative/heights");
    assertThat(failed(read("a.dt2", 0, 1))).as("not an absolute path").isEqualTo(Reason.MISSING);
    setPath(temp.resolve("gone"));
    assertThat(failed(read("a.dt2", 0, 1))).isEqualTo(Reason.MISSING);
    setPath(root.resolve("a.dt2"));
    assertThat(failed(list(""))).as("a file, not a folder").isEqualTo(Reason.MISSING);

    Path other = Files.createDirectory(temp.resolve("other"));
    Files.write(other.resolve("a.dt2"), "xyz".getBytes(StandardCharsets.US_ASCII));
    setPath(other);
    assertThat(text(read("a.dt2", 0, 3))).as("the admin's change, at once").isEqualTo("xyz");
    setPath(root);
    assertThat(text(read("a.dt2", 0, 3))).isEqualTo("abc");
  }

  @Test
  void aSymbolicLinkIsFollowedOnlyWhileItStaysInside() throws IOException {
    // Needs a privilege on Windows (as FakeFoldersTest); runs on Linux, e.g. in the ITA's run (the ACA's R3).
    Path out = root.resolve("out.dt2");
    try {
      Files.createSymbolicLink(out, temp.resolve("secret.txt"));
    } catch (IOException | UnsupportedOperationException e) {
      assumeTrue(false, "no symbolic links here: " + e.getClass().getSimpleName());
    }
    Files.createSymbolicLink(root.resolve("in.dt2"), root.resolve("b.dt2"));
    Files.createSymbolicLink(root.resolve("up"), temp);
    Files.createSymbolicLink(root.resolve("broken.dt2"), root.resolve("none.dt2"));

    assertThat(failed(read("out.dt2", 0, 10))).isEqualTo(Reason.OUTSIDE);
    assertThat(failed(read("up/secret.txt", 0, 10))).isEqualTo(Reason.OUTSIDE);
    assertThat(failed(list("up"))).isEqualTo(Reason.OUTSIDE);
    assertThat(text(read("in.dt2", 0, 4))).as("a link inside").isEqualTo("0123");
    assertThat(failed(read("broken.dt2", 0, 1))).isEqualTo(Reason.NOT_FOUND);
    assertThat(list("")).isInstanceOfSatisfying(FolderResult.Listing.class, l -> assertThat(l.entries()).extracting(FolderResult.Entry::name)
        .as("a broken link is left out").containsExactly("a.dt2", "b.dt2", "e017", "in.dt2", "out.dt2", "up"));

    // The folder's own path may be a link: what counts is its real path.
    Path linkedRoot = temp.resolve("linked");
    Files.createSymbolicLink(linkedRoot, root);
    setPath(linkedRoot);
    assertThat(text(read("e017/n59.dt2", 0, 4))).isEqualTo("cell");
    assertThat(failed(read("out.dt2", 0, 10))).isEqualTo(Reason.OUTSIDE);
  }

  @Test
  void aWindowsJunctionThatLeadsOutsideIsRefused() throws Exception {
    // A junction needs no privilege, so this runs on every Windows machine (the ACA's R3).
    assumeTrue(System.getProperty("os.name").toLowerCase(Locale.ROOT).startsWith("windows"), "Windows only");
    Path outside = Files.createDirectory(temp.resolve("outside"));
    Files.write(outside.resolve("secret.dt2"), "secret".getBytes(StandardCharsets.US_ASCII));
    Process mklink = new ProcessBuilder("cmd", "/c", "mklink", "/J", root.resolve("j").toString(), outside.toString())
        .redirectErrorStream(true).start();
    assertThat(mklink.waitFor(30, TimeUnit.SECONDS)).isTrue();
    assumeTrue(mklink.exitValue() == 0, "mklink /J failed");

    assertThat(failed(read("j/secret.dt2", 0, 6))).isEqualTo(Reason.OUTSIDE);
    assertThat(failed(list("j"))).isEqualTo(Reason.OUTSIDE);
  }

  @Test
  void atMostEightCallsAtATimeAndEachHasItsTimeout() {
    io.hold();
    for (int i = 0; i < LocalFolder.MAX_CONCURRENT_CALLS; i++) {
      folders.folder(i % 2 == 0 ? "heights" : "maps").list("", Duration.ofMillis(200), worker, r -> new Got("held", r));
    }
    assertThat(folders.inFlight()).isEqualTo(LocalFolder.MAX_CONCURRENT_CALLS);
    folders.folder("heights").read("a.dt2", 0, 1, Duration.ofSeconds(5), worker, r -> new Got("ninth", r));
    Got busy = results.next();
    assertThat(busy.what()).isEqualTo("ninth");
    assertThat(failed(busy.result())).as("over all its folders").isEqualTo(Reason.BUSY);

    List<Got> timedOut = results.next(LocalFolder.MAX_CONCURRENT_CALLS);
    assertThat(timedOut).allSatisfy(g -> assertThat(failed(g.result())).isEqualTo(Reason.TIMEOUT));
    assertThat(folders.inFlight()).as("the slots are given back before the timeouts are delivered").isZero();

    io.release(); // the held work runs late; its results are not delivered a second time
    assertThat(text(read("a.dt2", 0, 3))).isEqualTo("abc");
    assertThat(results.drain()).isEmpty();
  }

  @Test
  void theMonitorGetsEachFolderAsLastCheckedWithoutWaiting() throws IOException {
    PluginLocalFolders direct = new PluginLocalFolders(ID, List.of(HEIGHTS, MAPS), settings::get, runtime, Runnable::run);
    assertThat(direct.statuses()).containsExactly(
        new PluginLocalFolders.Status("heights", "Height data.", "/paths/heights", root.toString(), null, "READABLE"),
        new PluginLocalFolders.Status("maps", "Maps.", "/maps", null, null, "NOT_SET"));
    setPath("relative");
    assertThat(direct.statuses().getFirst().state()).isEqualTo("MISSING");

    io.hold();
    setPath(root);
    PluginLocalFolders held = new PluginLocalFolders(ID, List.of(HEIGHTS), settings::get, runtime, io);
    assertThat(held.statuses()).as("the check not done yet")
        .containsExactly(new PluginLocalFolders.Status("heights", "Height data.", "/paths/heights", root.toString(), null, "CHECKING"));
  }

  // ---- SDK 1.6.0 (CR-0041 part H; T-157): folders relative to the emcc folder --------------------------

  /** Folders whose emcc folder is {@code temp}: {@code heights} lies at {@code %emcc%/heights}. */
  private PluginLocalFolders inEmcc() {
    return new PluginLocalFolders(ID, List.of(HEIGHTS), settings::get, runtime, Runnable::run, temp);
  }

  @Test
  void aSettingRelativeToEmccResolvesBelowTheEmccFolderWithEitherSlash() {
    folders = inEmcc();
    for (String typed : List.of("%emcc%/heights", "%emcc%\\heights", "%emcc%/heights/e017/..")) {
      setPath(typed);
      assertThat(text(read("a.dt2", 0, 3))).as(typed).isEqualTo("abc");
    }
    setPath("%emcc%/heights/e017");
    assertThat(text(read("n59.dt2", 0, 4))).isEqualTo("cell");

    setPath("%emcc%/heights");
    assertThat(folders.statuses()).containsExactly(
        new PluginLocalFolders.Status("heights", "Height data.", "/paths/heights", "%emcc%/heights", root.toString(), "READABLE"));
  }

  @Test
  void aSettingThatLeadsOutOfTheEmccFolderOrNamesItElsewhereIsUnusable() {
    folders = inEmcc();
    setPath("%emcc%/..");
    FolderResult outside = read("a.dt2", 0, 3);
    assertThat(failed(outside)).isEqualTo(Reason.MISSING);
    assertThat(((FolderResult.Failed) outside).message()).isEqualTo("the folder \"heights\" is outside the emcc folder");
    assertThat(folders.statuses().getFirst().state()).isEqualTo("MISSING");

    for (String typed : List.of("heights", "x/%emcc%/heights", "%EMCC%/heights", "%emcc%heights")) { // the marker only at the start, as written
      setPath(typed);
      assertThat(failed(read("a.dt2", 0, 3))).as(typed).isEqualTo(Reason.MISSING);
    }
  }

  @Test
  void aLinkInsideTheEmccFolderThatLeadsOutOfItIsUnusable() throws IOException {
    Path emcc = Files.createDirectory(temp.resolve("emcc"));
    try {
      Files.createSymbolicLink(emcc.resolve("heights"), root);
    } catch (IOException | UnsupportedOperationException e) {
      assumeTrue(false, "no symbolic links here: " + e.getClass().getSimpleName());
    }
    folders = new PluginLocalFolders(ID, List.of(HEIGHTS), settings::get, runtime, Runnable::run, emcc);
    setPath("%emcc%/heights");

    FolderResult outside = read("a.dt2", 0, 3);
    assertThat(failed(outside)).isEqualTo(Reason.MISSING);
    assertThat(((FolderResult.Failed) outside).message()).isEqualTo("the folder \"heights\" is outside the emcc folder");
    assertThat(folders.statuses().getFirst().state()).isEqualTo("MISSING");
  }
}
