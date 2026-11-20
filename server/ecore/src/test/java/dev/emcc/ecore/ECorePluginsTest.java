package dev.emcc.ecore;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.persistence.FileStore;
import dev.emcc.ecore.plugin.PluginFolders;
import dev.emcc.ecore.plugin.PluginHost;
import dev.emcc.sdk.PluginState;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/** ECore with the plugin host. */
class ECorePluginsTest {

  @TempDir Path data;
  @TempDir Path plugins;

  private ECore core() {
    return new ECore(ECoreConfig.defaults().dataDirectory(data).pluginsDirectory(plugins));
  }

  @Test
  void pluginsStartWithEcoreAndStopBeforeIt() {
    new PluginFolders(plugins).plugin("alpha");
    ECore core = core();

    core.start();
    assertThat(core.plugins().plugins()).singleElement().satisfies(p -> {
      assertThat(p.id()).isEqualTo("alpha");
      assertThat(p.active()).isTrue();
    });

    core.stop();
    assertThat(core.pluginStatuses().of("alpha").state()).isEqualTo(PluginState.OK);
    assertThat(core.state()).isEqualTo(ECore.State.STOPPED);
  }

  @Test
  void withoutAPluginsDirectoryThereAreNoPlugins() {
    try (ECore core = new ECore(ECoreConfig.defaults())) {
      core.start();
      assertThat(core.plugins().plugins()).isEmpty();
    }
  }

  @Test
  void aRequiredPluginThatFailsStopsTheStartCleanly() {
    new PluginFolders(plugins).plugin("must-have", "init-throws", List.of(), true);
    ECore core = core();

    assertThatThrownBy(core::start).isInstanceOf(IllegalStateException.class).hasMessageContaining("must-have");

    assertThat(core.state()).isEqualTo(ECore.State.STOPPED);
    assertThat(core.pluginStatuses().of("must-have").state()).isEqualTo(PluginState.FAILED);
    try (FileStore files = new FileStore(data, new ModelJson())) {
      assertThat(files.load().journal()).as("the Drawing layer was stored before the start failed").hasSize(1);
    }
  }

  @Test
  void everyBrowserIsToldOfAChangedDataTypeBehaviourAndPluginSettings() {
    new PluginFolders(plugins).plugin("alpha");
    try (ECore core = core()) {
      core.start();
      dev.emcc.ecore.runtime.Probe<String> received = new dev.emcc.ecore.runtime.Probe<>();
      core.live().open(dev.emcc.ecore.store.Requester.withAllPermissions("local"), new dev.emcc.ecore.live.LiveSink() {
        @Override
        public void send(String text) {
          received.add(text);
        }

        @Override
        public void ping() {}

        @Override
        public void close(int status, String reason) {}
      });
      assertThat(received.next()).contains("\"welcome\"");
      assertThat(received.next()).contains("\"data-types\"").contains("\"behaviour\":{\"fadeWhenExpired\":false}");
      assertThat(received.next()).contains("\"settings\"");

      core.plugins().changeBehaviour("core.general", dev.emcc.sdk.json.JsonObject.of(java.util.Map.of("fadeWhenExpired",
          dev.emcc.sdk.json.JsonBoolean.of(true))), dev.emcc.sdk.User.noLoginUser());

      assertThat(received.next()).contains("\"data-types\"").contains("\"behaviour\":{\"fadeWhenExpired\":true}");
    }
  }

  @Test
  void theBudgetOfTheLifeCycleStepsIsFiveSeconds() {
    assertThat(PluginHost.BUDGET).hasSeconds(5);
  }
}
