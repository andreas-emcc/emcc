package dev.emcc.plugins.basemaposm;

import static dev.emcc.plugins.basemaposm.TileTestSupport.path;
import static dev.emcc.plugins.basemaposm.TileTestSupport.png;
import static dev.emcc.plugins.basemaposm.TileTestSupport.pngHeaders;
import static dev.emcc.plugins.basemaposm.TileTestSupport.start;
import static dev.emcc.plugins.basemaposm.TileTestSupport.upstreamUrl;
import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.testkit.FakeHttpExchange;
import dev.emcc.sdk.testkit.FakePluginContext;
import dev.emcc.sdk.testkit.LogEntry;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * The tile proxy against the test kit's fake context and fake upstream: deterministic, virtual time,
 * no internet. The acceptance criteria of the brief are named in the test names.
 */
class TileProxyTest {

  private static long warnings(FakePluginContext context) {
    return context.logEntries().stream().filter(e -> e.level() == LogEntry.Level.WARN).count();
  }

  // ---- served tiles

  @Test
  void servesATileFromTheUpstreamWithTheHeadersATileNeeds() throws Exception {
    FakePluginContext context = start();
    context.upstream().respond(upstreamUrl(5, 17, 9), 200, pngHeaders(), png(1));

    FakeHttpExchange call = context.call(path(5, 17, 9));
    context.runUntilIdle();

    assertThat(call.reply().status()).isEqualTo(200);
    assertThat(call.reply().body()).isEqualTo(png(1));
    assertThat(call.reply().headers().first("Content-Type")).isEqualTo("image/png");
    assertThat(call.reply().headers().first("Cache-Control")).isEqualTo("public, max-age=3600");
    assertThat(call.reply().headers().first("X-Content-Type-Options")).isEqualTo("nosniff");
    // column 17 and row 9 reach the upstream in the same places (x and y are not swapped)
    assertThat(context.httpCalls()).singleElement().satisfies(upstream -> assertThat(upstream.uri().toString()).isEqualTo(upstreamUrl(5, 17, 9)));
  }

  @Test
  void identifiesEmc2ToTheUpstreamWithAUserAgent() throws Exception {
    FakePluginContext context = start();
    context.upstream().respond(upstreamUrl(0, 0, 0), 200, pngHeaders(), png(1));
    context.call(path(0, 0, 0));
    context.runUntilIdle();

    String userAgent = context.httpCalls().getFirst().headers().first("User-Agent");
    assertThat(userAgent).startsWith("emc2-basemap-osm/");
    assertThat(context.httpCalls().getFirst().method()).isEqualTo("GET");
  }

  @Test
  void passesNoUpstreamHeadersOnToTheBrowser() throws Exception {
    FakePluginContext context = start();
    context.upstream().respond(upstreamUrl(2, 1, 3), 200, Headers.of("Content-Type", "image/png").with("Set-Cookie", "a=b").with("Server", "x"), png(1));
    FakeHttpExchange call = context.call(path(2, 1, 3));
    context.runUntilIdle();

    assertThat(call.reply().headers().first("Set-Cookie")).isNull();
    assertThat(call.reply().headers().first("Server")).isNull();
  }

  // ---- criterion 4: the cache

  @Test
  void criterion4_repeatedRequestsForTheSameTileAreServedFromTheCacheWithoutAnUpstreamCall() throws Exception {
    FakePluginContext context = start();
    context.upstream().respond(upstreamUrl(5, 17, 9), 200, pngHeaders(), png(1));

    FakeHttpExchange first = context.call(path(5, 17, 9));
    context.runUntilIdle();
    List<FakeHttpExchange> again = new ArrayList<>();
    for (int i = 0; i < 5; i++) {
      again.add(context.call(path(5, 17, 9)));
    }
    context.runUntilIdle();

    assertThat(context.httpCalls()).hasSize(1);
    assertThat(first.reply().body()).isEqualTo(png(1));
    assertThat(again).allSatisfy(call -> {
      assertThat(call.reply().status()).isEqualTo(200);
      assertThat(call.reply().body()).isEqualTo(png(1));
    });
  }

  @Test
  void criterion4_aCacheHitIsAnsweredAtOnceEvenWhenTheClockDoesNotMove() throws Exception {
    FakePluginContext context = start();
    context.upstream().respond(upstreamUrl(1, 0, 1), 200, pngHeaders(), png(7));
    context.call(path(1, 0, 1));
    context.runUntilIdle();

    FakeHttpExchange hit = context.call(path(1, 0, 1));
    context.runUntilIdle(); // no advance(): a hit never waits for a timer or the upstream
    assertThat(hit.isAnswered()).isTrue();
  }

  @Test
  void theCacheHoldsAtMostTheConfiguredNumberOfTilesAndDropsTheLeastRecentlyUsed() throws Exception {
    FakePluginContext context = start(Map.of("cacheTiles", TileTestSupport.number(2)));
    for (int x = 0; x < 3; x++) {
      context.upstream().respond(upstreamUrl(2, x, 0), 200, pngHeaders(), png(x));
    }
    context.call(path(2, 0, 0)); // cache: 0
    context.runUntilIdle();
    context.call(path(2, 1, 0)); // cache: 0, 1
    context.runUntilIdle();
    context.call(path(2, 0, 0)); // 0 is used again: now 1 is the least recently used
    context.runUntilIdle();
    assertThat(context.httpCalls()).hasSize(2);

    context.call(path(2, 2, 0)); // cache: 0, 2 (1 dropped)
    context.runUntilIdle();
    assertThat(context.httpCalls()).hasSize(3);

    context.call(path(2, 0, 0)); // still cached
    context.call(path(2, 2, 0)); // still cached
    context.runUntilIdle();
    assertThat(context.httpCalls()).hasSize(3);

    context.call(path(2, 1, 0)); // was dropped: fetched again
    context.runUntilIdle();
    assertThat(context.httpCalls()).hasSize(4);
  }

  @Test
  void requestsForATileThatIsBeingFetchedShareTheOneUpstreamCall() throws Exception {
    FakePluginContext context = start();
    context.upstream().respondAfter(Duration.ofSeconds(1), upstreamUrl(3, 4, 2), 200, pngHeaders(), png(4));

    List<FakeHttpExchange> calls = new ArrayList<>();
    for (int i = 0; i < 3; i++) {
      calls.add(context.call(path(3, 4, 2)));
    }
    context.runUntilIdle();
    assertThat(calls).noneMatch(FakeHttpExchange::isAnswered);
    context.advance(Duration.ofSeconds(1));

    assertThat(context.httpCalls()).hasSize(1);
    assertThat(calls).allSatisfy(call -> assertThat(call.reply().status()).isEqualTo(200));
  }

  // ---- criterion 5 and 9: a slow upstream blocks nobody

  @Test
  void criterion5_anUpstreamThatDoesNotAnswerIsCutOffAfterTheTimeoutAndBlocksNoOtherTile() throws Exception {
    FakePluginContext context = start();
    context.upstream().never(upstreamUrl(4, 1, 1));
    context.upstream().respond(upstreamUrl(4, 2, 2), 200, pngHeaders(), png(2));

    FakeHttpExchange stuck = context.call(path(4, 1, 1));
    FakeHttpExchange other = context.call(path(4, 2, 2));
    context.runUntilIdle();

    assertThat(other.reply().status()).isEqualTo(200); // answered at once, while the first still waits
    assertThat(stuck.isAnswered()).isFalse();

    context.advance(Duration.ofSeconds(4));
    assertThat(stuck.isAnswered()).isFalse();
    context.advance(Duration.ofSeconds(1)); // the 5 s upstream timeout
    assertThat(stuck.reply().status()).isEqualTo(504);
    // the proxy's own answer at 5 s, not ECore's 504 after the endpoint timeout: it carries our headers
    assertThat(stuck.reply().headers().first("Cache-Control")).isEqualTo("no-store");
    assertThat(context.handlerErrors()).isEmpty();
  }

  @Test
  void criterion9_noHandlerCallWaitsForTheUpstream() throws Exception {
    FakePluginContext context = start();
    context.upstream().respond(upstreamUrl(5, 1, 1), 200, pngHeaders(), png(1));
    context.upstream().respond(upstreamUrl(5, 2, 2), 200, pngHeaders(), png(2));
    context.upstream().respondAfter(Duration.ofSeconds(10), upstreamUrl(5, 3, 3), 200, pngHeaders(), png(3));
    context.call(path(5, 1, 1)); // this one gets cached
    context.runUntilIdle();

    FakeHttpExchange slow = context.call(path(5, 3, 3));
    context.runUntilIdle(); // the handler returned at once, so the worker is free for the next message
    FakeHttpExchange cached = context.call(path(5, 1, 1));
    FakeHttpExchange fresh = context.call(path(5, 2, 2));
    context.runUntilIdle();

    // meanwhile other tiles are answered, from the cache and from the upstream
    assertThat(slow.isAnswered()).isFalse();
    assertThat(cached.reply().body()).isEqualTo(png(1));
    assertThat(fresh.reply().body()).isEqualTo(png(2));
    assertThat(context.handlerErrors()).isEmpty();

    // the slow upstream is cut off at the 5 s timeout, long before it would have answered at 10 s
    context.advance(Duration.ofSeconds(5));
    assertThat(slow.reply().status()).isEqualTo(504);
    context.advance(Duration.ofSeconds(10));
    assertThat(context.handlerErrors()).isEmpty();
  }

  // ---- queueing: at most MAX_CONCURRENT_FETCHES upstream calls, the rest wait instead of failing

  @Test
  void aMapLoadOfManyTilesQueuesTheFetchesInsteadOfAnswering502() throws Exception {
    FakePluginContext context = start();
    List<FakeHttpExchange> calls = new ArrayList<>();
    for (int x = 0; x < 20; x++) {
      context.upstream().respondAfter(Duration.ofSeconds(1), upstreamUrl(5, x, 4), 200, pngHeaders(), png(x));
      calls.add(context.call(path(5, x, 4)));
    }
    context.runUntilIdle();
    assertThat(context.httpCalls()).as("never more calls at once than the proxy allows").hasSize(TileProxy.MAX_CONCURRENT_FETCHES);

    context.advance(Duration.ofSeconds(1));
    assertThat(context.httpCalls()).hasSize(2 * TileProxy.MAX_CONCURRENT_FETCHES);
    context.advance(Duration.ofSeconds(1));
    context.advance(Duration.ofSeconds(1));

    assertThat(context.httpCalls()).hasSize(20);
    for (int x = 0; x < 20; x++) {
      assertThat(calls.get(x).reply().status()).as("tile %d", x).isEqualTo(200);
      assertThat(calls.get(x).reply().body()).isEqualTo(png(x));
    }
    assertThat(context.handlerErrors()).isEmpty();
  }

  @Test
  void aRequestThatWaitsTooLongForAFetchSlotGets503WithRetryAfter() throws Exception {
    FakePluginContext context = start();
    List<FakeHttpExchange> calls = new ArrayList<>();
    for (int x = 0; x < 12; x++) {
      context.upstream().respondAfter(Duration.ofSeconds(4), upstreamUrl(5, x, 4), 200, pngHeaders(), png(x));
      calls.add(context.call(path(5, x, 4)));
    }
    context.advance(Duration.ofSeconds(2));
    assertThat(calls.subList(TileProxy.MAX_CONCURRENT_FETCHES, 12)).noneMatch(FakeHttpExchange::isAnswered);
    context.advance(Duration.ofSeconds(1)); // 3 s: the queue wait is over

    for (FakeHttpExchange waiting : calls.subList(TileProxy.MAX_CONCURRENT_FETCHES, 12)) {
      assertThat(waiting.reply().status()).isEqualTo(503);
      assertThat(waiting.reply().headers().first("Retry-After")).isEqualTo("1");
    }
    context.advance(Duration.ofSeconds(1)); // 4 s: the fetches that were running finish normally
    for (FakeHttpExchange running : calls.subList(0, TileProxy.MAX_CONCURRENT_FETCHES)) {
      assertThat(running.reply().status()).isEqualTo(200);
    }
    assertThat(context.httpCalls()).hasSize(TileProxy.MAX_CONCURRENT_FETCHES);
  }

  @Test
  void whenTooManyTilesWaitTheExtraRequestsGet503AtOnce() throws Exception {
    FakePluginContext context = start();
    List<FakeHttpExchange> calls = new ArrayList<>();
    for (int x = 0; x < TileProxy.MAX_PENDING_TILES + 5; x++) {
      calls.add(context.call(path(9, x, 0)));
    }
    context.runUntilIdle();
    long refused = calls.stream().filter(c -> c.isAnswered() && c.reply().status() == 503).count();
    assertThat(refused).isEqualTo(5);
  }

  @Test
  void aFullMailboxIsAnswered503ByEcore() throws Exception {
    FakePluginContext context = start();
    List<FakeHttpExchange> calls = new ArrayList<>();
    for (int i = 0; i < 1_001; i++) { // the mailbox holds 1 000; nothing is delivered until the test runs the context
      calls.add(context.call(path(0, 0, 0)));
    }
    assertThat(calls.getLast().reply().status()).isEqualTo(503);
  }

  // ---- criterion 6: invalid coordinates

  @Test
  void criterion6_invalidTileCoordinatesGiveAnErrorWithoutAnUpstreamCall() throws Exception {
    FakePluginContext context = start();
    List<String> invalid = List.of(
        "/tiles/20/0/0.png", // z beyond 19
        "/tiles/99/0/0.png",
        "/tiles/0/1/0.png", // z 0 has only tile 0/0
        "/tiles/0/0/1.png",
        "/tiles/1/2/0.png", // x = 2^z
        "/tiles/1/0/2.png", // y = 2^z
        "/tiles/19/524288/0.png",
        "/tiles/19/0/524288.png",
        "/tiles/5/-1/0.png", // negative
        "/tiles/5/0/-1.png",
        "/tiles/a/0/0.png", // not numbers
        "/tiles/5/x/0.png",
        "/tiles/5/0/y.png",
        "/tiles/5/1.5/0.png",
        "/tiles/5/0/0x1.png",
        "/tiles/5/+1/0.png",
        "/tiles/5/%D9%A1/0.png", // an Arabic-Indic digit is not an ASCII digit
        "/tiles/5/99999999999999999999/0.png"); // longer than any tile number
    List<FakeHttpExchange> calls = invalid.stream().map(context::call).toList();
    context.runUntilIdle();

    for (int i = 0; i < invalid.size(); i++) {
      assertThat(calls.get(i).reply().status()).as(invalid.get(i)).isEqualTo(400);
    }
    assertThat(context.httpCalls()).as("nothing reached the upstream").isEmpty();
  }

  @Test
  void criterion6_theCornerTilesOfEveryZoomAreValid() throws Exception {
    FakePluginContext context = start();
    for (int z = 0; z <= 19; z++) {
      int last = (1 << z) - 1;
      context.upstream().respond(upstreamUrl(z, last, 0), 200, pngHeaders(), png(z));
      context.upstream().respond(upstreamUrl(z, 0, last), 200, pngHeaders(), png(z));
      FakeHttpExchange a = context.call(path(z, last, 0));
      FakeHttpExchange b = context.call(path(z, 0, last));
      context.advance(Duration.ofSeconds(1));
      assertThat(a.reply().status()).as("z=%d x=last y=0", z).isEqualTo(200);
      assertThat(b.reply().status()).as("z=%d x=0 y=last", z).isEqualTo(200);
    }
  }

  @Test
  void criterion6_aLowerMaxZoomSettingIsEnforced() throws Exception {
    FakePluginContext context = start(Map.of("maxZoom", TileTestSupport.number(5)));
    FakeHttpExchange tooDeep = context.call(path(6, 0, 0));
    context.runUntilIdle();
    assertThat(tooDeep.reply().status()).isEqualTo(400);
    assertThat(context.httpCalls()).isEmpty();
  }

  @Test
  void otherPathsAndOtherFileTypesAreNotFound() throws Exception {
    FakePluginContext context = start();
    assertThat(context.call("/tiles").reply().status()).isEqualTo(404);
    assertThat(context.call("/other/1/0/0.png").reply().status()).isEqualTo(404);
    assertThat(context.call("/tiles/5/0/0.jpg").reply().status()).isEqualTo(404);
    assertThat(context.call("/tiles/5/0/0").reply().status()).isEqualTo(404);
    assertThat(context.httpCalls()).isEmpty();
  }

  // ---- upstream answers that are not a tile

  @Test
  void anUpstreamNotFoundIsPassedOnAndNotCached() throws Exception {
    FakePluginContext context = start();
    context.upstream().respond(upstreamUrl(6, 1, 1), 404, Headers.empty(), Bytes.empty());
    FakeHttpExchange first = context.call(path(6, 1, 1));
    context.runUntilIdle();
    assertThat(first.reply().status()).isEqualTo(404);
    assertThat(first.reply().headers().first("Cache-Control")).isEqualTo("no-store");

    context.call(path(6, 1, 1));
    context.runUntilIdle();
    assertThat(context.httpCalls()).hasSize(2);
    assertThat(context.effectiveStatus().state()).isEqualTo(PluginState.OK);
  }

  @Test
  void anUpstreamErrorStatusOrABodyThatIsNoPngGives502AndIsNotCached() throws Exception {
    FakePluginContext context = start();
    context.upstream().respond(upstreamUrl(6, 1, 1), 500, Headers.empty(), Bytes.empty());
    context.upstream().respond(upstreamUrl(6, 2, 1), 429, Headers.empty(), Bytes.empty());
    context.upstream().respond(upstreamUrl(6, 3, 1), 200, Headers.of("Content-Type", "text/html"), Bytes.utf8("<html>captive portal</html>"));
    List<FakeHttpExchange> calls = List.of(context.call(path(6, 1, 1)), context.call(path(6, 2, 1)), context.call(path(6, 3, 1)));
    context.runUntilIdle();

    assertThat(calls).allSatisfy(call -> assertThat(call.reply().status()).isEqualTo(502));
    context.upstream().respond(upstreamUrl(6, 1, 1), 200, pngHeaders(), png(1));
    FakeHttpExchange retry = context.call(path(6, 1, 1));
    context.runUntilIdle();
    assertThat(retry.reply().status()).as("the error was not remembered as a tile").isEqualTo(200);
  }

  @Test
  void anUpstreamHostThatCannotBeReachedIsAnswered502WithOneWarning() throws Exception {
    // the fake upstream has no answer for this host: the call fails like a host that does not answer
    FakePluginContext context = start(Map.of("upstreamUrl", TileTestSupport.text("https://tiles.example.org/{z}/{x}/{y}.png")));
    FakeHttpExchange call = context.call(path(1, 0, 0));
    context.runUntilIdle();
    assertThat(call.reply().status()).isEqualTo(502);
    assertThat(warnings(context)).isEqualTo(1);
  }

  // ---- criterion 7: no internet, no error flood

  @Test
  void criterion7_anUnreachableUpstreamGivesQuickErrorsAndAtMostOneWarningPerMinute() throws Exception {
    FakePluginContext context = start();
    List<FakeHttpExchange> calls = new ArrayList<>();
    for (int x = 0; x < 30; x++) {
      context.upstream().fail(upstreamUrl(7, x, 3), "connection refused");
      calls.add(context.call(path(7, x, 3)));
    }
    context.runUntilIdle(); // no advance(): the errors come at once, not after a timeout

    assertThat(calls).allSatisfy(call -> assertThat(call.reply().status()).isEqualTo(502));
    assertThat(warnings(context)).isEqualTo(1);
    assertThat(context.effectiveStatus().state()).isEqualTo(PluginState.DEGRADED);

    // a minute later a new failure may be logged again, but only one
    context.advance(Duration.ofSeconds(61));
    context.upstream().fail(upstreamUrl(7, 99, 3), "connection refused");
    context.call(path(7, 99, 3));
    context.call(path(7, 98, 3));
    context.advance(Duration.ofSeconds(1));
    assertThat(warnings(context)).isEqualTo(2);
  }

  @Test
  void criterion7_afterSeveralFailuresInARowTheProxyAnswersWithoutCallingTheUpstreamUntilItIsTriedAgain() throws Exception {
    FakePluginContext context = start();
    openTheBreaker(context);
    int callsWhenOpen = context.httpCalls().size();

    FakeHttpExchange refused = context.call(path(8, 200, 0));
    context.runUntilIdle();
    assertThat(refused.reply().status()).isEqualTo(502);
    assertThat(context.httpCalls()).as("the breaker is open: no call").hasSize(callsWhenOpen);

    // after 30 s one request is let through; it finds the upstream working again
    context.advance(Duration.ofSeconds(30));
    context.upstream().respond(upstreamUrl(8, 201, 0), 200, pngHeaders(), png(1));
    FakeHttpExchange trial = context.call(path(8, 201, 0));
    FakeHttpExchange meanwhile = context.call(path(8, 202, 0)); // while the trial is out, others still fail fast
    context.runUntilIdle();
    assertThat(trial.reply().status()).isEqualTo(200);
    assertThat(meanwhile.reply().status()).isEqualTo(502);
    assertThat(context.effectiveStatus().state()).isEqualTo(PluginState.OK);

    context.upstream().respond(upstreamUrl(8, 203, 0), 200, pngHeaders(), png(2));
    FakeHttpExchange after = context.call(path(8, 203, 0));
    context.runUntilIdle();
    assertThat(after.reply().status()).isEqualTo(200);
  }

  @Test
  void aFailedTrialKeepsTheBreakerOpen() throws Exception {
    FakePluginContext context = start();
    openTheBreaker(context);
    context.advance(Duration.ofSeconds(30));
    context.upstream().fail(upstreamUrl(8, 50, 0), "no route to host");
    context.call(path(8, 50, 0)); // the trial fails
    context.runUntilIdle();
    int calls = context.httpCalls().size();

    FakeHttpExchange refused = context.call(path(8, 51, 0));
    context.runUntilIdle();
    assertThat(refused.reply().status()).isEqualTo(502);
    assertThat(context.httpCalls()).hasSize(calls);
  }

  @Test
  void tilesWaitingForAFetchSlotAreAnsweredAtOnceWhenTheBreakerOpens() throws Exception {
    FakePluginContext context = start();
    List<FakeHttpExchange> calls = new ArrayList<>();
    for (int x = 0; x < 20; x++) {
      // every fetch fails after 1 s; 8 run at a time and 12 tiles wait for a slot
      context.upstream().respondAfter(Duration.ofSeconds(1), upstreamUrl(7, x, 5), 500, Headers.empty(), Bytes.empty());
      calls.add(context.call(path(7, x, 5)));
    }
    context.advance(Duration.ofSeconds(1)); // well before the 3 s queue wait ends

    // the fifth failure opened the breaker: the fetches started meanwhile are the only ones, the rest was answered at once
    assertThat(context.httpCalls()).hasSize(TileProxy.MAX_CONCURRENT_FETCHES + TileProxy.FAILURES_TO_OPEN - 1);
    assertThat(calls.subList(TileProxy.MAX_CONCURRENT_FETCHES + TileProxy.FAILURES_TO_OPEN - 1, 20)).allSatisfy(call -> {
      assertThat(call.reply().status()).isEqualTo(502);
    });
    context.advance(Duration.ofSeconds(1));
    assertThat(calls).allSatisfy(call -> assertThat(call.reply().status()).isEqualTo(502));
  }

  @Test
  void aSlowUpstreamDoesNotFloodTheLogEither() throws Exception {
    FakePluginContext context = start();
    for (int x = 0; x < 20; x++) {
      context.upstream().never(upstreamUrl(7, x, 6));
      context.call(path(7, x, 6));
    }
    context.advance(Duration.ofSeconds(30));
    assertThat(warnings(context)).isLessThanOrEqualTo(1);
  }

  /** Five failures in a row. */
  private static void openTheBreaker(FakePluginContext context) {
    for (int x = 0; x < TileProxy.FAILURES_TO_OPEN; x++) {
      context.upstream().fail(upstreamUrl(8, x, 0), "no route to host");
      context.call(path(8, x, 0));
      context.runUntilIdle();
    }
  }

  // ---- worker restart

  @Test
  void aRestartedWorkerToleratesTheAnswersOfItsPredecessor() throws Exception {
    FakePluginContext context = start();
    context.upstream().respondAfter(Duration.ofSeconds(2), upstreamUrl(4, 5, 5), 200, pngHeaders(), png(5));
    FakeHttpExchange orphan = context.call(path(4, 5, 5));
    context.runUntilIdle();

    context.restart(context.worker("tiles"));
    context.advance(Duration.ofSeconds(3)); // the old fetch's answer reaches the new handler

    assertThat(context.handlerErrors()).isEmpty();
    assertThat(orphan.isAnswered()).as("only ECore's 504 ends it, at the endpoint timeout").isFalse();
    context.upstream().respond(upstreamUrl(4, 6, 6), 200, pngHeaders(), png(6));
    FakeHttpExchange fresh = context.call(path(4, 6, 6));
    context.runUntilIdle();
    assertThat(fresh.reply().status()).isEqualTo(200);
    context.advance(BasemapOsmPlugin.ENDPOINT_TIMEOUT);
    assertThat(orphan.reply().status()).isEqualTo(504);
  }
}
