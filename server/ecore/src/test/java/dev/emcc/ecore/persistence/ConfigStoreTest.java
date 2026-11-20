package dev.emcc.ecore.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.persistence.ConfigStore.Behaviour;
import dev.emcc.ecore.persistence.ConfigStore.Config;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ConfigStoreTest {

  private static final ModelJson JSON = new ModelJson();
  private static final JsonObject COT_SETTINGS = JsonObject.of(Map.of("servers", JsonArray.of(
      JsonObject.of(Map.of("name", JsonString.of("tak-north"), "host", JsonString.of("10.0.0.5"), "port", JsonNumber.of(8089))))));

  @TempDir Path dir;

  @Test
  void aNewDataDirectoryHasNoConfiguration() {
    assertThat(new ConfigStore(dir, JSON).load()).isEqualTo(Config.EMPTY);
  }

  @Test
  void settingsAndBehavioursSurviveARestart() {
    Config config = Config.EMPTY.withPluginSettings("cot", COT_SETTINGS)
        .withBehaviour("cot.track", new Behaviour(300L, true, 3600L))
        .withBehaviour("core.general", new Behaviour(null, false, null));

    new ConfigStore(dir, JSON).save(config);

    assertThat(new ConfigStore(dir, JSON).load()).isEqualTo(config);
  }

  @Test
  void theDefaultLookSurvivesARestartAndAFileWithoutOneHasNone() throws Exception {
    ConfigStore store = new ConfigStore(dir, JSON);
    store.save(Config.EMPTY.withBehaviour("cot.track", new Behaviour(300L, true, null)));
    assertThat(new ConfigStore(dir, JSON).load().defaultLook()).as("a file from before T-052").isNull();
    store.save(store.load().withDefaultLook("chart-room").withPluginSettings("cot", COT_SETTINGS));
    Config loaded = new ConfigStore(dir, JSON).load();
    assertThat(loaded.defaultLook()).isEqualTo("chart-room");
    assertThat(loaded.withBehaviour("core.general", new Behaviour(null, true, null)).defaultLook()).as("kept by other changes").isEqualTo("chart-room");
    assertThat(java.nio.file.Files.readString(dir.resolve(ConfigStore.FILE))).contains("\"defaultLook\":\"chart-room\"");
  }

  @Test
  void anAdminsComputeThreadsSurviveARestartAndAnOlderFileHasNone() { // SDK 1.9.0, ADR-0064 point 4
    ConfigStore store = new ConfigStore(dir, JSON);
    store.save(Config.EMPTY.withBehaviour("cot.track", new Behaviour(300L, true, null)));
    assertThat(new ConfigStore(dir, JSON).load().computeThreads()).isEmpty();

    store.save(store.load().withComputeThreads("fmv", 2).withComputeThreads("terrain", 0));

    Config loaded = new ConfigStore(dir, JSON).load();
    assertThat(loaded.computeThreads()).containsEntry("fmv", 2).containsEntry("terrain", 0).hasSize(2);
    assertThat(loaded.dataTypes()).containsKey("cot.track");
    assertThat(loaded.withComputeThreads("fmv", 1).computeThreads()).containsEntry("fmv", 1);
  }

  @Test
  void aChangeReplacesTheOldValue() {
    ConfigStore store = new ConfigStore(dir, JSON);
    store.save(Config.EMPTY.withBehaviour("cot.track", new Behaviour(300L, true, null)));

    store.save(store.load().withBehaviour("cot.track", new Behaviour(60L, false, 0L)));

    assertThat(new ConfigStore(dir, JSON).load().dataTypes()).isEqualTo(Map.of("cot.track", new Behaviour(60L, false, 0L)));
  }

  @Test
  void aBehaviourCanBeRemovedAgain() {
    ConfigStore store = new ConfigStore(dir, JSON);
    store.save(Config.EMPTY.withBehaviour("cot.track", new Behaviour(300L, true, null)).withBehaviour("core.general", new Behaviour(null, true, null)));

    store.save(store.load().withoutBehaviour("cot.track").withoutBehaviour("never.configured"));

    assertThat(new ConfigStore(dir, JSON).load().dataTypes()).isEqualTo(Map.of("core.general", new Behaviour(null, true, null)));
  }

  @Test
  void aDamagedFileStopsTheStart() throws IOException {
    Files.writeString(dir.resolve(ConfigStore.FILE), "{\"format\":\"emc2-config/1\",\"dataTypes\":{\"cot.track\":{\"expiresAfterSeconds\":0}}}");

    assertThatThrownBy(() -> new ConfigStore(dir, JSON).load()).isInstanceOf(IllegalStateException.class).hasMessageContaining("damaged");
  }

  @Test
  void anotherFileStopsTheStart() throws IOException {
    Files.writeString(dir.resolve(ConfigStore.FILE), "{\"pluginSettings\":{}}");

    assertThatThrownBy(() -> new ConfigStore(dir, JSON).load()).isInstanceOf(IllegalStateException.class).hasMessageContaining("emc2-config/1");
  }

  @Test
  void withoutADataDirectoryItLivesInMemory() throws IOException {
    ConfigStore store = new ConfigStore(null, JSON);
    Config config = Config.EMPTY.withPluginSettings("cot", COT_SETTINGS);

    store.save(config);

    assertThat(store.load()).isEqualTo(config);
    try (var files = Files.list(dir)) {
      assertThat(files).isEmpty();
    }
  }
}
