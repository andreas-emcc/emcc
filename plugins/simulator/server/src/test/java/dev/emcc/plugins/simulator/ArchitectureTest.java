package dev.emcc.plugins.simulator;

import dev.emcc.sdk.testkit.PluginRules;
import org.junit.jupiter.api.Test;

/** The SDK's plugin rules (no threads, no blocking, SDK only, immutable messages). Every plugin keeps this test. */
class ArchitectureTest {

  @Test
  void followsThePluginRules() {
    // Imports dev.emcc.plugins.<id from plugin.json>: fails if the package was not renamed with the id.
    PluginRules.checkPlugin(Manifest.id());
  }
}
