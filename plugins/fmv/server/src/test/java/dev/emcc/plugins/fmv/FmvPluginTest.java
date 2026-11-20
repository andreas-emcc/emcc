package dev.emcc.plugins.fmv;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.testkit.FakePluginContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The plugin's behaviour, with the test kit's fake context: deterministic, nothing runs by itself. */
class FmvPluginTest {

  private FakePluginContext context;
  private Plugin plugin;

  @BeforeEach
  void startLikeThePluginHost() throws Exception {
    // As the host does it: the entry class from plugin.json, the setting defaults, init, then start.
    context = FakePluginContext.builder(Manifest.id()).settings(Manifest.settingDefaults()).build();
    plugin = (Plugin) Class.forName(Manifest.entryClass()).getConstructor().newInstance();
    plugin.init(context);
    plugin.start();
  }

  @Test
  void reportsOkAfterStartAndStopsCleanly() {
    assertThat(context.effectiveStatus().state()).isEqualTo(PluginState.OK);
    plugin.stop();
    assertThat(context.handlerErrors()).isEmpty();
  }
}
