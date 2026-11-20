package dev.emcc.plugins.cot;

import dev.emcc.sdk.testkit.PluginRules;
import org.junit.jupiter.api.Test;

/** The SDK's plugin rules (no threads, no blocking, SDK only, immutable messages). Every plugin keeps this test. */
class ArchitectureTest {

  /** Acceptance criterion 26: no threads or locks of its own; sockets only in connection task classes and no listener; the rule set passes. */
  @Test
  void criterion26_followsThePluginRules() {
    // Imports dev.emcc.plugins.<id from plugin.json>: fails if the package was not renamed with the id.
    PluginRules.checkPlugin(Manifest.id());
  }
}
