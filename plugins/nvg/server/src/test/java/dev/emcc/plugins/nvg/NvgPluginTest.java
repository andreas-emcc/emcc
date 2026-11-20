package dev.emcc.plugins.nvg;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.nvg.links.LinkSettings;
import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.model.SecurityLabel;
import java.util.List;
import java.util.regex.Pattern;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.testkit.FakePluginContext;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/** The plugin's life cycle, with the test kit's fake context. */
class NvgPluginTest {

  private FakePluginContext context;
  private Plugin plugin;

  @BeforeEach
  void startLikeThePluginHost() throws Exception {
    context = FakePluginContext.builder(Manifest.id()).settings(Manifest.settingDefaults()).build();
    plugin = (Plugin) Class.forName(Manifest.entryClass()).getConstructor().newInstance();
    plugin.init(context);
    plugin.start();
  }

  @Test
  void criterion16_followsThePluginRulesAndParsesOnAComputeWorker() {
    // No threads, no sockets, no file I/O (PluginRules); documents are read and written by the "compute" worker,
    // spawned with WorkerSpec.compute(true) in NvgPlugin.init (rule C7).
    dev.emcc.sdk.testkit.PluginRules.checkPlugin(Manifest.id());
    assertThat(context.worker("compute")).isNotNull();
    assertThat(context.worker("files")).isNotNull();
    assertThat(context.worker("links")).isNotNull();
  }

  @Test
  void aLinksNameIsAPlainTextFieldThatRefusesTheReservedNames() {
    // The shell's settings form draws a schema with "not" (or another keyword it cannot show) as a JSON
    // box that starts as null (UDA, 2026-11-12): the name has only plain text keywords, and its pattern
    // refuses the reserved names. JSON Schema patterns are not anchored, so the anchors are in it.
    JsonObject name = Manifest.read().getObject("settings").getObject("properties").getObject("links")
        .getObject("items").getObject("properties").getObject("name");
    assertThat(name.names()).containsExactlyInAnyOrder("title", "description", "type", "pattern", "maxLength", "x-emc2");
    assertThat(name.getObject("x-emc2").names()).containsExactly("hint"); // SDK 1.8.0 part D (T-204): an annotation only
    Pattern pattern = Pattern.compile(name.getString("pattern"));
    for (String good : List.of("anet", "out", "nvg-files", "manual2", "my-manual", "nvg-file-2", "a")) {
      assertThat(pattern.matcher(good).find()).as(good).isTrue();
    }
    for (String bad : List.of("manual", "nvg-file", "", "Anet", "-anet", "anet-", "an et", "a--b")) {
      assertThat(pattern.matcher(bad).find()).as(bad).isFalse();
    }
    // The server refuses them too, whatever the form lets through.
    JsonObject manual = JsonObject.builder().put("name", JsonString.of("manual")).put("url", JsonString.of("http://localhost:1/x")).build();
    var links = LinkSettings.read(JsonObject.builder().put("links", JsonArray.of(manual)).build(), SecurityLabel.of("NATO", "UNCLASSIFIED"));
    assertThat(links.bad()).containsEntry("manual", "the name manual is reserved");
    assertThat(links.consumers()).isEmpty();
  }

  @Test
  void reportsOkAfterStartAndStopsCleanly() {
    context.runUntilIdle();
    assertThat(context.effectiveStatus().state()).isEqualTo(PluginState.OK);
    plugin.stop();
    assertThat(context.handlerErrors()).isEmpty();
  }
}
