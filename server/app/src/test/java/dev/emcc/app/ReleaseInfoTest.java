package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.Sdk;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** M9 RC2 (owner ACQ): the release's version.properties and manual, for the shell's help menu. */
class ReleaseInfoTest {

  @TempDir Path folder;

  @Test
  void readsTheVersionFileAsTheReleaseWritesIt() throws IOException {
    Files.writeString(folder.resolve("version.properties"), String.join("\r\n",
        "# The emcc release in this folder, written by tools/release.mjs. Do not edit.", "emcc.version=M9-RC1",
        "emcc.build.date=2026-11-18", "emcc.build.commit=ea32e90f", "emcc.build.dirty=false", "emcc.sdk.version=1.9.0", ""));
    ReleaseInfo release = new ReleaseInfo(folder.toString());
    assertThat(release.version()).containsExactly(Map.entry("name", "M9-RC1"), Map.entry("date", "2026-11-18"),
        Map.entry("commit", "ea32e90f"), Map.entry("dirty", false), Map.entry("sdk", "1.9.0"));
    assertThat(release.hasManual()).isFalse();
  }

  @Test
  void withoutTheFileItIsADevBuildWithTheServersSdk() {
    assertThat(new ReleaseInfo(folder.toString()).version()).containsExactly(Map.entry("name", "dev"), Map.entry("sdk", Sdk.VERSION));
  }

  @Test
  void aPartialFileGivesWhatItHas() throws IOException {
    Files.writeString(folder.resolve("version.properties"), "emcc.build.commit=ea32e90f\nemcc.build.dirty=true\n");
    assertThat(new ReleaseInfo(folder.toString()).version())
        .containsExactly(Map.entry("name", "unknown"), Map.entry("commit", "ea32e90f"), Map.entry("dirty", true));
  }

  @Test
  void hasTheManualWhenItsIndexIsThere() throws IOException {
    Files.writeString(Files.createDirectories(folder.resolve("manual")).resolve("index.html"), "<!doctype html>");
    assertThat(new ReleaseInfo(folder.toString()).hasManual()).isTrue();
  }
}
