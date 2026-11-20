package dev.emcc.plugins.terrain;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.User;
import dev.emcc.sdk.folder.LocalFolder;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.testkit.FakeHttpExchange;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.testkit.TestJson;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * Criterion 20 of the brief (function 12, T-157; SDK 1.6.0 part H): {@code heightDataFolder} defaults to
 * {@code %emcc%/settings/terrain}. ECore resolves a value that starts with {@code %emcc%/} and refuses one
 * that leaves the emcc folder; the plugin resolves nothing, so here the testkit's fake folder stands for
 * the folder ECore resolved the setting to (the real ECore's resolution is checked live, not here).
 */
class FolderDefaultTest {

  private static final User ALICE = new User("alice", "Alice", Set.of(TerrainPlugin.PERMISSION), false);

  @TempDir
  Path folder;

  private FakePluginContext start(JsonObject settings, Path resolved) throws Exception {
    FakePluginContext ctx = FakePluginContext.builder(Manifest.id()).settings(settings).folder("heights", resolved).build();
    Plugin plugin = (Plugin) Class.forName(Manifest.entryClass()).getConstructor().newInstance();
    plugin.init(ctx);
    plugin.start();
    ctx.runUntilIdle();
    return ctx;
  }

  private static JsonObject status(FakePluginContext ctx) {
    FakeHttpExchange exchange = ctx.call("/status", ALICE);
    ctx.runUntilIdle();
    assertThat(exchange.reply().status()).isEqualTo(200);
    return (JsonObject) TestJson.parse(exchange.reply().body().toUtf8());
  }

  @Test
  void aFreshInstallsFolderSettingIsUnderTheEmccFolder() {
    assertThat(Manifest.settingDefaults().getString("heightDataFolder")).isEqualTo("%emcc%/settings/terrain");
    assertThat(Limits.read(Manifest.settingDefaults()).folder()).isEqualTo("%emcc%/settings/terrain").startsWith(LocalFolder.EMCC_PREFIX);
  }

  @Test
  void theManifestNeedsTheSdkThatResolvesTheMarkerAndGivesTheIcon() {
    assertThat(Manifest.read().getString("sdkVersion")).isEqualTo("^1.8.0");
  }

  @Test
  void theDemoCellsInTheResolvedDefaultFolderAreFoundWithoutAnySetting() throws Exception {
    DtedFiles.write(folder, 1, 17, 62, (i, j) -> 100 + i + j);
    DtedFiles.write(folder, 1, 16, 62, (i, j) -> 200);
    FakePluginContext ctx = start(Manifest.settingDefaults(), folder);

    JsonObject status = status(ctx);
    assertThat(status.getString("state")).isEqualTo("ready");
    assertThat(status.getNumber("cells").longValueExact()).isEqualTo(2);
    assertThat(ctx.effectiveStatus().state()).isEqualTo(PluginState.OK);
    assertThat(ctx.effectiveStatus().detail()).isEqualTo("Height data: 2 cells (level 2: 0, level 1: 2, level 0: 0)");
  }

  @Test
  void anEmptyButReadableDefaultFolderIsOkWithZeroCellsAsTheReleaseWithoutDemoData() throws Exception {
    // owner, SC A (2026-11-12): the release ships an empty settings/terrain/, which must not make the plugin DEGRADED
    FakePluginContext ctx = start(Manifest.settingDefaults(), Files.createDirectories(folder.resolve("settings").resolve("terrain")));
    assertThat(ctx.effectiveStatus().state()).isEqualTo(PluginState.OK);
    assertThat(ctx.effectiveStatus().detail()).isEqualTo("Height data: 0 cells (level 2: 0, level 1: 0, level 0: 0)");
  }

  @Test
  void aFolderEcoreRefusesIsNotReadableAndTheStatusGivesEcoresReason() throws Exception {
    // ECore answers MISSING with "outside the emcc folder" for %emcc%/../elsewhere; the fake has no such
    // setting, so a folder that is not there stands in: its words (the fake's own) must reach the status.
    Path missing = folder.resolve("elsewhere");
    JsonObject outside = Manifest.settingDefaults().with("heightDataFolder", JsonString.of("%emcc%/../elsewhere"));
    FakePluginContext ctx = start(outside, missing);

    assertThat(ctx.effectiveStatus().state()).isEqualTo(PluginState.DEGRADED);
    assertThat(ctx.effectiveStatus().detail()).startsWith("Height folder not readable: ").contains("does not exist or cannot be read");
    JsonObject status = status(ctx);
    assertThat(status.getString("state")).isEqualTo("notReadable");
    assertThat(status.getString("reason")).contains("does not exist or cannot be read");
  }

  @Test
  void anAbsolutePathWorksAsBefore() throws Exception {
    DtedFiles.write(folder, 0, 18, 59, (i, j) -> 10);
    JsonObject absolute = Manifest.settingDefaults().with("heightDataFolder", JsonString.of(folder.toAbsolutePath().toString()));
    FakePluginContext ctx = start(absolute, folder);
    assertThat(ctx.effectiveStatus().detail()).isEqualTo("Height data: 1 cells (level 2: 0, level 1: 0, level 0: 1)");
  }
}
