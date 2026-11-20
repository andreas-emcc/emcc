package dev.emcc.plugins.basemaposm;

import static dev.emcc.plugins.basemaposm.TileTestSupport.OTHER_TEMPLATE;
import static dev.emcc.plugins.basemaposm.TileTestSupport.number;
import static dev.emcc.plugins.basemaposm.TileTestSupport.otherUpstreamUrl;
import static dev.emcc.plugins.basemaposm.TileTestSupport.path;
import static dev.emcc.plugins.basemaposm.TileTestSupport.png;
import static dev.emcc.plugins.basemaposm.TileTestSupport.pngHeaders;
import static dev.emcc.plugins.basemaposm.TileTestSupport.settings;
import static dev.emcc.plugins.basemaposm.TileTestSupport.start;
import static dev.emcc.plugins.basemaposm.TileTestSupport.text;
import static dev.emcc.plugins.basemaposm.TileTestSupport.upstreamUrl;
import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.testkit.FakeHttpExchange;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.testkit.LogEntry;
import java.time.Duration;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * Settings changes from the settings view apply while the server runs (SDK v1, {@code
 * subscribeSettings}; owner, 2026-10-12): a change takes effect at once for everything that starts
 * afterwards, and fetches already running finish with the old values. ECore refuses a value that
 * breaks the manifest's schema before it reaches the plugin, so these tests change valid values;
 * the plugin's own extra checks (e.g. {y} in the URL) are tested as refused changes.
 */
class SettingsChangeTest {

  private static void fetch(FakePluginContext context, int z, int x, int y) {
    context.call(path(z, x, y));
    context.runUntilIdle();
  }

  @Test
  void aNewUpstreamUrlAppliesAtOnceAndTheNextTileGoesToTheNewUpstream() throws Exception {
    FakePluginContext context = start();
    context.upstream().respond(upstreamUrl(5, 17, 9), 200, pngHeaders(), png(1));
    context.upstream().respond(otherUpstreamUrl(5, 17, 10), 200, pngHeaders(), png(2));
    fetch(context, 5, 17, 9);
    assertThat(context.httpCalls().getLast().uri().toString()).isEqualTo(upstreamUrl(5, 17, 9));

    context.changeSettings(settings(Map.of("upstreamUrl", text(OTHER_TEMPLATE))));
    context.runUntilIdle(); // no advance(): the change is applied without waiting for a timer
    FakeHttpExchange next = context.call(path(5, 17, 10));
    context.runUntilIdle();

    assertThat(next.reply().status()).isEqualTo(200);
    assertThat(next.reply().body()).isEqualTo(png(2));
    assertThat(context.httpCalls().getLast().uri().toString()).isEqualTo(otherUpstreamUrl(5, 17, 10));
    assertThat(context.handlerErrors()).isEmpty();
  }

  @Test
  void aNewUpstreamUrlEmptiesTheCacheSoNoTileOfTheOldUpstreamIsServed() throws Exception {
    FakePluginContext context = start();
    context.upstream().respond(upstreamUrl(5, 17, 9), 200, pngHeaders(), png(1));
    context.upstream().respond(otherUpstreamUrl(5, 17, 9), 200, pngHeaders(), png(2));
    fetch(context, 5, 17, 9);
    FakeHttpExchange cached = context.call(path(5, 17, 9));
    context.runUntilIdle();
    assertThat(cached.reply().body()).isEqualTo(png(1));
    assertThat(context.httpCalls()).hasSize(1);

    context.changeSettings(settings(Map.of("upstreamUrl", text(OTHER_TEMPLATE))));
    FakeHttpExchange again = context.call(path(5, 17, 9));
    context.runUntilIdle();

    assertThat(again.reply().body()).as("the same tile, from the new upstream").isEqualTo(png(2));
    assertThat(context.httpCalls()).hasSize(2);
  }

  @Test
  void aFetchThatIsAlreadyRunningFinishesWithTheOldSettingsAndItsTileIsNotCached() throws Exception {
    FakePluginContext context = start();
    context.upstream().respondAfter(Duration.ofSeconds(2), upstreamUrl(5, 1, 1), 200, pngHeaders(), png(1));
    context.upstream().respond(otherUpstreamUrl(5, 1, 1), 200, pngHeaders(), png(2));
    FakeHttpExchange running = context.call(path(5, 1, 1));
    context.runUntilIdle();
    assertThat(context.httpCalls()).singleElement().satisfies(call -> assertThat(call.uri().toString()).isEqualTo(upstreamUrl(5, 1, 1)));

    context.advance(Duration.ofSeconds(1));
    context.changeSettings(settings(Map.of("upstreamUrl", text(OTHER_TEMPLATE))));
    context.runUntilIdle();
    assertThat(running.isAnswered()).isFalse();
    context.advance(Duration.ofSeconds(1));

    assertThat(running.reply().status()).isEqualTo(200);
    assertThat(running.reply().body()).as("the answer of the old upstream, which the browser asked").isEqualTo(png(1));
    FakeHttpExchange later = context.call(path(5, 1, 1));
    context.runUntilIdle();
    assertThat(later.reply().body()).as("not cached: this one comes from the new upstream").isEqualTo(png(2));
  }

  @Test
  void aSmallerCacheKeepsTheMostRecentTilesAndDropsTheRest() throws Exception {
    FakePluginContext context = start(Map.of("cacheTiles", number(3)));
    for (int x = 0; x < 3; x++) {
      context.upstream().respond(upstreamUrl(3, x, 0), 200, pngHeaders(), png(x));
      fetch(context, 3, x, 0);
    }
    assertThat(context.httpCalls()).hasSize(3);

    context.changeSettings(settings(Map.of("cacheTiles", number(1))));
    context.runUntilIdle();
    fetch(context, 3, 2, 0); // the most recently used tile is still there
    assertThat(context.httpCalls()).hasSize(3);
    fetch(context, 3, 0, 0); // the others went
    assertThat(context.httpCalls()).hasSize(4);
  }

  @Test
  void aLowerMaxZoomAppliesAtOnce() throws Exception {
    FakePluginContext context = start();
    context.upstream().respond(upstreamUrl(8, 1, 1), 200, pngHeaders(), png(1));
    FakeHttpExchange before = context.call(path(8, 1, 1));
    context.runUntilIdle();
    assertThat(before.reply().status()).isEqualTo(200);

    context.changeSettings(settings(Map.of("maxZoom", number(7))));
    FakeHttpExchange after = context.call(path(8, 1, 1));
    context.runUntilIdle();

    assertThat(after.reply().status()).as("zoom 8 is above the new maximum, also for a tile that was cached").isEqualTo(400);
    assertThat(context.httpCalls()).hasSize(1);
  }

  @Test
  void aNewTimeoutAppliesToTheNextFetch() throws Exception {
    FakePluginContext context = start();
    context.upstream().never(upstreamUrl(4, 1, 1));
    context.upstream().never(upstreamUrl(4, 2, 2));
    FakeHttpExchange old = context.call(path(4, 1, 1));
    context.runUntilIdle();

    context.changeSettings(settings(Map.of("upstreamTimeoutSeconds", number(2))));
    FakeHttpExchange fresh = context.call(path(4, 2, 2));
    context.runUntilIdle();
    context.advance(Duration.ofSeconds(2));

    assertThat(fresh.reply().status()).as("cut off after the new 2 s").isEqualTo(504);
    assertThat(old.isAnswered()).as("the running fetch keeps its 5 s").isFalse();
    context.advance(Duration.ofSeconds(3));
    assertThat(old.reply().status()).isEqualTo(504);
  }

  @Test
  void aChangeThatTheWorkerCannotUseIsRefusedAndTheOldValuesStay() throws Exception {
    FakePluginContext context = start();
    context.upstream().respond(upstreamUrl(5, 17, 9), 200, pngHeaders(), png(1));

    context.changeSettings(settings(Map.of("upstreamUrl", text("https://tile.openstreetmap.org/{z}/{x}.png"))));
    FakeHttpExchange call = context.call(path(5, 17, 9));
    context.runUntilIdle();

    assertThat(call.reply().status()).as("still served by the old upstream").isEqualTo(200);
    assertThat(context.effectiveStatus().state()).isEqualTo(PluginState.DEGRADED);
    assertThat(context.effectiveStatus().detail()).contains("setting change refused").contains("{y}");
    assertThat(context.logEntries().stream().filter(e -> e.level() == LogEntry.Level.WARN)).hasSize(1);

    context.changeSettings(settings(Map.of("upstreamUrl", text(OTHER_TEMPLATE))));
    context.runUntilIdle();
    assertThat(context.effectiveStatus().state()).as("a good change clears the problem").isEqualTo(PluginState.OK);
  }

  @Test
  void aPluginThatStartedWithBadSettingsWorksAfterAGoodChange() throws Exception {
    FakePluginContext context = start(Map.of("upstreamUrl", text("https://tile.openstreetmap.org/{z}/{x}.png")));
    context.upstream().respond(upstreamUrl(5, 17, 9), 200, pngHeaders(), png(1));
    FakeHttpExchange before = context.call(path(5, 17, 9));
    context.runUntilIdle();
    assertThat(before.reply().status()).isEqualTo(503);
    assertThat(context.effectiveStatus().state()).isEqualTo(PluginState.FAILED);

    context.changeSettings(settings(Map.of()));
    FakeHttpExchange after = context.call(path(5, 17, 9));
    context.runUntilIdle();

    assertThat(after.reply().status()).isEqualTo(200);
    assertThat(context.effectiveStatus().state()).isEqualTo(PluginState.OK);
  }

  @Test
  void aNewUpstreamStartsFreshWhenTheOldOneWasDown() throws Exception {
    FakePluginContext context = start();
    for (int x = 0; x < TileProxy.FAILURES_TO_OPEN; x++) {
      context.upstream().fail(upstreamUrl(8, x, 0), "no route to host");
      fetch(context, 8, x, 0);
    }
    assertThat(context.effectiveStatus().state()).isEqualTo(PluginState.DEGRADED);
    int calls = context.httpCalls().size();
    FakeHttpExchange refused = context.call(path(8, 100, 0));
    context.runUntilIdle();
    assertThat(refused.reply().status()).as("the breaker is open").isEqualTo(502);
    assertThat(context.httpCalls()).hasSize(calls);

    context.changeSettings(settings(Map.of("upstreamUrl", text(OTHER_TEMPLATE))));
    context.upstream().respond(otherUpstreamUrl(8, 101, 0), 200, pngHeaders(), png(3));
    FakeHttpExchange next = context.call(path(8, 101, 0));
    context.runUntilIdle();

    assertThat(next.reply().status()).as("the new upstream is tried at once, not after 30 s").isEqualTo(200);
    assertThat(context.effectiveStatus().state()).isEqualTo(PluginState.OK);
  }

  @Test
  void afterStopASettingsChangeDoesNothing() throws Exception {
    FakePluginContext context = TileTestSupport.newContext(Map.of());
    Plugin plugin = TileTestSupport.newPlugin();
    plugin.init(context);
    plugin.start();
    plugin.stop();

    context.changeSettings(settings(Map.of("maxZoom", number(3))));
    context.upstream().respond(upstreamUrl(5, 1, 1), 200, pngHeaders(), png(1));
    FakeHttpExchange call = context.call(path(5, 1, 1));
    context.runUntilIdle();

    assertThat(call.reply().status()).as("zoom 5 is still served: the stopped plugin took no change").isEqualTo(200);
  }

  @Test
  void aRestartedWorkerStartsWithTheSettingsInForceNotTheFirstOnes() throws Exception {
    FakePluginContext context = start();
    context.upstream().respond(otherUpstreamUrl(5, 17, 9), 200, pngHeaders(), png(2));
    context.changeSettings(settings(Map.of("upstreamUrl", text(OTHER_TEMPLATE))));
    context.runUntilIdle();

    context.restart(context.worker("tiles"));
    FakeHttpExchange call = context.call(path(5, 17, 9));
    context.runUntilIdle();

    assertThat(call.reply().body()).as("from the new upstream, not the one of the first start").isEqualTo(png(2));
    assertThat(context.httpCalls().getLast().uri().toString()).isEqualTo(otherUpstreamUrl(5, 17, 9));
  }

  @Test
  void aRestartedWorkerAfterBadSettingsAtStartWorksOnceTheyWereCorrected() throws Exception {
    FakePluginContext context = start(Map.of("upstreamUrl", text("https://tile.openstreetmap.org/{z}/{x}.png")));
    context.changeSettings(settings(Map.of()));
    context.runUntilIdle();

    context.restart(context.worker("tiles"));
    context.upstream().respond(upstreamUrl(5, 17, 9), 200, pngHeaders(), png(1));
    FakeHttpExchange call = context.call(path(5, 17, 9));
    context.runUntilIdle();

    assertThat(call.reply().status()).isEqualTo(200);
    assertThat(context.effectiveStatus().state()).as("the status follows the fresh handler, not the old one").isEqualTo(PluginState.OK);
  }

  @Test
  void aFailureOfAFetchFromBeforeTheChangeDoesNotCountAgainstTheNewUpstream() throws Exception {
    FakePluginContext context = start();
    context.upstream().respondAfter(Duration.ofSeconds(2), upstreamUrl(6, 0, 0), 500, Headers.empty(), Bytes.empty());
    FakeHttpExchange old = context.call(path(6, 0, 0));
    context.runUntilIdle();
    context.advance(Duration.ofSeconds(1));
    context.changeSettings(settings(Map.of("upstreamUrl", text(OTHER_TEMPLATE))));
    context.runUntilIdle();
    for (int x = 1; x < TileProxy.FAILURES_TO_OPEN; x++) { // four failures on the new upstream
      context.upstream().fail(otherUpstreamUrl(6, x, 0), "no route to host");
      fetch(context, 6, x, 0);
    }
    context.advance(Duration.ofSeconds(1)); // the old fetch fails now, with the old settings
    assertThat(old.reply().status()).isEqualTo(502);

    int calls = context.httpCalls().size();
    context.upstream().fail(otherUpstreamUrl(6, 9, 0), "no route to host");
    fetch(context, 6, 9, 0);

    assertThat(context.httpCalls()).as("the breaker is still closed: four failures count, the old one does not").hasSize(calls + 1);
  }

  @Test
  void aTimeoutOfAFetchFromBeforeTheChangeDoesNotCountAgainstTheNewUpstream() throws Exception {
    FakePluginContext context = start();
    context.upstream().never(upstreamUrl(6, 0, 0));
    FakeHttpExchange old = context.call(path(6, 0, 0));
    context.runUntilIdle();
    context.advance(Duration.ofSeconds(1));
    context.changeSettings(settings(Map.of("upstreamUrl", text(OTHER_TEMPLATE))));
    context.runUntilIdle();
    for (int x = 1; x < TileProxy.FAILURES_TO_OPEN; x++) { // four failures on the new upstream
      context.upstream().fail(otherUpstreamUrl(6, x, 0), "no route to host");
      fetch(context, 6, x, 0);
    }
    context.advance(Duration.ofSeconds(4)); // 5 s after the start: the old fetch times out, with the old settings
    assertThat(old.reply().status()).isEqualTo(504);

    int calls = context.httpCalls().size();
    context.upstream().fail(otherUpstreamUrl(6, 9, 0), "no route to host");
    fetch(context, 6, 9, 0);

    assertThat(context.httpCalls()).as("the breaker is still closed").hasSize(calls + 1);
  }

  @Test
  void aRestartedWorkerStartsFreshAndTheStatusFollowsIt() throws Exception {
    FakePluginContext context = start();
    for (int x = 0; x < TileProxy.FAILURES_TO_OPEN; x++) {
      context.upstream().fail(upstreamUrl(8, x, 0), "no route to host");
      fetch(context, 8, x, 0);
    }
    assertThat(context.effectiveStatus().state()).isEqualTo(PluginState.DEGRADED);

    context.restart(context.worker("tiles")); // the fresh handler knows nothing of the failures
    context.upstream().respond(upstreamUrl(8, 50, 0), 200, pngHeaders(), png(1));
    FakeHttpExchange call = context.call(path(8, 50, 0));
    context.runUntilIdle();

    assertThat(call.reply().status()).as("the new handler tries the upstream again").isEqualTo(200);
    assertThat(context.effectiveStatus().state()).isEqualTo(PluginState.OK);
  }

  @Test
  void aSuccessOfAFetchFromBeforeTheChangeDoesNotCloseTheBreakerOfTheNewUpstream() throws Exception {
    FakePluginContext context = start();
    context.upstream().respondAfter(Duration.ofSeconds(4), upstreamUrl(6, 0, 0), 200, pngHeaders(), png(1));
    FakeHttpExchange old = context.call(path(6, 0, 0));
    context.runUntilIdle();
    context.advance(Duration.ofMillis(500));
    context.changeSettings(settings(Map.of("upstreamUrl", text(OTHER_TEMPLATE))));
    for (int x = 1; x <= TileProxy.FAILURES_TO_OPEN; x++) {
      context.upstream().fail(otherUpstreamUrl(6, x, 0), "no route to host");
      fetch(context, 6, x, 0);
    }
    assertThat(context.effectiveStatus().state()).isEqualTo(PluginState.DEGRADED);

    context.advance(Duration.ofSeconds(4)); // the old fetch succeeds, with the old settings
    assertThat(old.reply().status()).isEqualTo(200);
    assertThat(context.effectiveStatus().state()).as("says nothing about the new upstream").isEqualTo(PluginState.DEGRADED);
    int calls = context.httpCalls().size();
    FakeHttpExchange refused = context.call(path(6, 50, 0));
    context.runUntilIdle();
    assertThat(refused.reply().status()).isEqualTo(502);
    assertThat(context.httpCalls()).hasSize(calls);
  }

  @Test
  void aTileThatWaitedForAFetchSlotWhenTheUrlChangedIsFetchedFromTheNewUpstream() throws Exception {
    FakePluginContext context = start();
    int tiles = TileProxy.MAX_CONCURRENT_FETCHES + 2;
    for (int x = 0; x < tiles; x++) {
      context.upstream().respondAfter(Duration.ofSeconds(2), upstreamUrl(5, x, 4), 200, pngHeaders(), png(x));
      context.upstream().respond(otherUpstreamUrl(5, x, 4), 200, pngHeaders(), png(100 + x));
      context.call(path(5, x, 4));
    }
    context.runUntilIdle();
    assertThat(context.httpCalls()).hasSize(TileProxy.MAX_CONCURRENT_FETCHES); // two tiles wait

    context.changeSettings(settings(Map.of("upstreamUrl", text(OTHER_TEMPLATE))));
    context.advance(Duration.ofSeconds(2));

    assertThat(context.httpCalls()).hasSize(tiles);
    assertThat(context.httpCalls().subList(TileProxy.MAX_CONCURRENT_FETCHES, tiles))
        .allSatisfy(call -> assertThat(call.uri().getHost()).isEqualTo(TileTestSupport.OTHER_HOST));
  }

  @Test
  void aNewHostNeedNotBeInTheManifestsInternetHosts() throws Exception {
    // The manifest declares only tile.openstreetmap.org; since M2 ECore does not check the hosts (owner, 2026-10-18).
    assertThat(Manifest.read().getObject("internet").get("hosts").toString()).doesNotContain(TileTestSupport.OTHER_HOST);
    FakePluginContext context = start();
    context.changeSettings(settings(Map.of("upstreamUrl", text(OTHER_TEMPLATE))));
    context.upstream().respond(otherUpstreamUrl(5, 1, 1), 200, pngHeaders(), png(1));

    FakeHttpExchange call = context.call(path(5, 1, 1));
    context.runUntilIdle();

    assertThat(call.reply().status()).isEqualTo(200);
    assertThat(call.reply().body()).isEqualTo(png(1));
    assertThat(context.httpCalls().getLast().uri().getHost()).isEqualTo(TileTestSupport.OTHER_HOST);
    assertThat(context.effectiveStatus().state()).isEqualTo(PluginState.OK);
  }

  @Test
  void aChangeWithPropertiesMissingTakesTheManifestsDefaultsForThem() throws Exception {
    // ECore replaces the settings as a whole and fills in no defaults: a script's PUT may carry only some properties.
    FakePluginContext context = start(Map.of("maxZoom", number(7)));
    context.upstream().respond(otherUpstreamUrl(8, 1, 1), 200, pngHeaders(), png(1));
    FakeHttpExchange refused = context.call(path(8, 1, 1));
    context.runUntilIdle();
    assertThat(refused.reply().status()).as("zoom 8 is above the maximum of 7").isEqualTo(400);

    context.changeSettings(JsonObject.builder().put("upstreamUrl", text(OTHER_TEMPLATE)).build());
    FakeHttpExchange call = context.call(path(8, 1, 1));
    context.runUntilIdle();

    assertThat(context.effectiveStatus().state()).isEqualTo(PluginState.OK);
    assertThat(context.logEntries().stream().filter(e -> e.level() == LogEntry.Level.WARN)).isEmpty();
    assertThat(call.reply().status()).as("maxZoom is missing: the default 19 applies").isEqualTo(200);
    assertThat(context.httpCalls().getLast().uri().getHost()).isEqualTo(TileTestSupport.OTHER_HOST);
  }

  @Test
  void anEmptyChangeGivesAllDefaultsAndClearsAnEarlierRefusal() throws Exception {
    FakePluginContext context = start();
    context.changeSettings(settings(Map.of("upstreamUrl", text("https://tile.openstreetmap.org/{z}/{x}.png"))));
    context.runUntilIdle();
    assertThat(context.effectiveStatus().state()).isEqualTo(PluginState.DEGRADED);

    context.changeSettings(JsonObject.builder().build());
    context.upstream().respond(upstreamUrl(5, 17, 9), 200, pngHeaders(), png(1));
    FakeHttpExchange call = context.call(path(5, 17, 9));
    context.runUntilIdle();

    assertThat(context.effectiveStatus().state()).isEqualTo(PluginState.OK);
    assertThat(call.reply().status()).isEqualTo(200);
    assertThat(context.httpCalls().getLast().uri().toString()).isEqualTo(upstreamUrl(5, 17, 9));
  }

  @Test
  void aPresentButWrongValueIsStillRefusedWhileMissingOnesGetDefaults() throws Exception {
    FakePluginContext context = start();
    context.changeSettings(JsonObject.builder().put("maxZoom", text("19")).build());
    context.runUntilIdle();
    assertThat(context.effectiveStatus().state()).isEqualTo(PluginState.DEGRADED);
    assertThat(context.effectiveStatus().detail()).contains("setting change refused").contains("maxZoom must be a number");
  }
}
