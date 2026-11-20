package dev.emcc.plugins.basemaposm;

import static dev.emcc.plugins.basemaposm.TileTestSupport.path;
import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.testkit.FakeHttpExchange;
import dev.emcc.sdk.testkit.FakePluginContext;
import java.time.Duration;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;

/** Life cycle and settings of the entry class. */
class BasemapOsmPluginTest {

  @Test
  void stopCancelsTheClockAndLeavesNoErrors() throws Exception {
    FakePluginContext context = TileTestSupport.newContext(Map.of());
    Plugin plugin = TileTestSupport.newPlugin();
    plugin.init(context);
    assertThat(context.activeTimers()).as("no timer before start").isZero();
    plugin.start();
    assertThat(context.activeTimers()).isEqualTo(1);
    assertThat(context.effectiveStatus().state()).isEqualTo(PluginState.OK);
    plugin.stop();
    assertThat(context.activeTimers()).isZero();
    assertThat(context.handlerErrors()).isEmpty();
  }

  static Stream<Map<String, JsonValue>> badSettings() {
    return Stream.of(
        Map.of("upstreamUrl", TileTestSupport.text("https://tile.openstreetmap.org/{z}/{x}.png")),
        Map.of("upstreamUrl", TileTestSupport.text("https://tile.openstreetmap.org/{x}/{y}.png")),
        Map.of("upstreamUrl", TileTestSupport.text("ftp://tile.openstreetmap.org/{z}/{x}/{y}.png")),
        Map.of("upstreamUrl", TileTestSupport.text("/{z}/{x}/{y}.png")),
        Map.of("upstreamUrl", TileTestSupport.text("https://tile openstreetmap.org/{z}/{x}/{y}.png")),
        Map.of("upstreamUrl", TileTestSupport.text("  ")),
        Map.of("maxZoom", TileTestSupport.number(20)),
        Map.of("maxZoom", TileTestSupport.number(-1)),
        Map.of("maxZoom", TileTestSupport.text("19")),
        Map.of("cacheTiles", TileTestSupport.number(0)),
        Map.of("cacheTiles", TileTestSupport.number(10_001)),
        Map.of("upstreamTimeoutSeconds", TileTestSupport.number(0)),
        Map.of("upstreamTimeoutSeconds", TileTestSupport.number(31)));
  }

  @ParameterizedTest
  @MethodSource("badSettings")
  void aBadSettingFailsThePluginWithAnExplanationAndServesNothing(Map<String, JsonValue> bad) throws Exception {
    FakePluginContext context = TileTestSupport.start(bad);
    assertThat(context.effectiveStatus().state()).isEqualTo(PluginState.FAILED);
    assertThat(context.effectiveStatus().detail()).startsWith("bad setting: ");
    FakeHttpExchange call = context.call(path(0, 0, 0));
    context.runUntilIdle();
    assertThat(call.reply().status()).as("no valid settings yet: 503").isEqualTo(503);
    assertThat(context.httpCalls()).isEmpty();
  }

  @Test
  void theDefaultsAreTheOnesTheBriefNames() {
    TileSettings settings = TileSettings.parse(Manifest.settingDefaults());
    assertThat(settings.upstreamTemplate()).isEqualTo("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
    assertThat(settings.maxZoom()).isEqualTo(19);
    assertThat(settings.cacheTiles()).isEqualTo(2_000);
    assertThat(settings.upstreamTimeout().toSeconds()).isEqualTo(5);
  }

  @Test
  void aPluginThatStartsWithSettingsMissingUsesTheManifestsDefaults() throws Exception {
    // e.g. settings stored by an older version, before a setting was added
    FakePluginContext context = FakePluginContext.builder(Manifest.id())
        .settings(JsonObject.builder().put("cacheTiles", TileTestSupport.number(10)).build())
        .build();
    Plugin plugin = TileTestSupport.newPlugin();
    plugin.init(context);
    plugin.start();
    context.upstream().respond(TileTestSupport.upstreamUrl(19, 5, 5), 200, TileTestSupport.pngHeaders(), TileTestSupport.png(1));

    FakeHttpExchange call = context.call(path(19, 5, 5));
    context.runUntilIdle();

    assertThat(context.effectiveStatus().state()).isEqualTo(PluginState.OK);
    assertThat(call.reply().status()).as("maxZoom is missing: 19; upstreamUrl is missing: OSM").isEqualTo(200);
  }

  @Test
  void aPluginThatStartsWithNoSettingsAtAllUsesAllDefaults() throws Exception {
    FakePluginContext context = FakePluginContext.builder(Manifest.id()).settings(JsonObject.builder().build()).build();
    Plugin plugin = TileTestSupport.newPlugin();
    plugin.init(context);
    plugin.start();
    assertThat(context.effectiveStatus().state()).isEqualTo(PluginState.OK);
    assertThat(TileSettings.parse(JsonObject.builder().build())).isEqualTo(TileSettings.parse(Manifest.settingDefaults()));
  }

  @Test
  void theDefaultsInTheCodeAreTheManifestsDefaults() {
    var properties = Manifest.read().getObject("settings").getObject("properties");
    assertThat(((dev.emcc.sdk.json.JsonString) ((JsonObject) properties.get("upstreamUrl")).get("default")).value())
        .isEqualTo(TileSettings.DEFAULT_UPSTREAM_URL);
    assertThat(((JsonObject) properties.get("maxZoom")).get("default")).isEqualTo(TileTestSupport.number(TileSettings.DEFAULT_MAX_ZOOM));
    assertThat(((JsonObject) properties.get("cacheTiles")).get("default")).isEqualTo(TileTestSupport.number(TileSettings.DEFAULT_CACHE_TILES));
    assertThat(((JsonObject) properties.get("upstreamTimeoutSeconds")).get("default"))
        .isEqualTo(TileTestSupport.number(TileSettings.DEFAULT_TIMEOUT_SECONDS));
  }

  @Test
  void theManifestDeclaresTheInternetHostOfTheDefaultUpstream() {
    var hosts = Manifest.read().getObject("internet").get("hosts").toString();
    assertThat(hosts).contains(TileTestSupport.HOST);
    assertThat(TileSettings.parse(Manifest.settingDefaults()).uriFor(new TileKey(1, 0, 0)).getHost()).isEqualTo(TileTestSupport.HOST);
  }

  @Test
  void aLongerUpstreamTimeoutStillEndsBeforeTheEndpointTimeout() throws Exception {
    FakePluginContext context = TileTestSupport.start(Map.of("upstreamTimeoutSeconds", TileTestSupport.number(20)));
    context.upstream().never(TileTestSupport.upstreamUrl(3, 1, 1));
    FakeHttpExchange call = context.call(path(3, 1, 1));
    context.advance(Duration.ofSeconds(20));
    assertThat(call.reply().headers().first("Cache-Control")).as("answered by the proxy, not by ECore").isEqualTo("no-store");
  }
}
