package dev.emcc.plugins.basemaposm;

import static dev.emcc.plugins.basemaposm.TileTestSupport.path;
import static dev.emcc.plugins.basemaposm.TileTestSupport.png;
import static dev.emcc.plugins.basemaposm.TileTestSupport.pngHeaders;
import static dev.emcc.plugins.basemaposm.TileTestSupport.start;
import static dev.emcc.plugins.basemaposm.TileTestSupport.upstreamUrl;
import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.User;
import dev.emcc.sdk.testkit.FakeHttpExchange;
import dev.emcc.sdk.testkit.FakePluginContext;
import java.util.List;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * Who may fetch a tile (SDK v1: {@code EndpointRequest.user()}, {@code Endpoint.requires}), and what
 * a request cannot make the proxy fetch. The tile endpoint serves public tiles: it has no {@code
 * requires(...)}, so a user without any permission gets a tile (the test kit answers 403 for an
 * endpoint that requires a permission the user lacks).
 */
class TileAccessTest {

  @Test
  void aUserWithoutPermissionsGetsATile() throws Exception {
    FakePluginContext context = start();
    context.upstream().respond(upstreamUrl(5, 17, 9), 200, pngHeaders(), png(1));
    User nobody = User.of("nobody", "A user without permissions", Set.of());

    FakeHttpExchange call = context.call(path(5, 17, 9), nobody);
    context.runUntilIdle();

    assertThat(nobody.permissions()).isEmpty();
    assertThat(call.reply().status()).isEqualTo(200);
    assertThat(call.reply().body()).isEqualTo(png(1));
  }

  @Test
  void aUserWithOnlyUnrelatedPermissionsAndTheNoLoginUserGetTheSameTile() throws Exception {
    FakePluginContext context = start();
    context.upstream().respond(upstreamUrl(2, 1, 3), 200, pngHeaders(), png(2));

    FakeHttpExchange other = context.call(path(2, 1, 3), User.of("u2", "Someone", Set.of("objects.edit")));
    FakeHttpExchange local = context.call(path(2, 1, 3), User.noLoginUser());
    context.runUntilIdle();

    assertThat(other.reply().status()).isEqualTo(200);
    assertThat(local.reply().status()).isEqualTo(200);
    assertThat(other.reply().body()).isEqualTo(local.reply().body());
  }

  @Test
  void theManifestDeclaresNoPermissionForTheTileEndpoint() {
    assertThat(Manifest.read().has("permissions")).as("no permission is declared in M1: tiles are public").isFalse();
  }

  @Test
  void aUserWithoutPermissionsStillGetsTheProxysOwnErrors() throws Exception {
    FakePluginContext context = start();
    User nobody = User.of("nobody", "A user without permissions", Set.of());
    FakeHttpExchange bad = context.call(path(20, 0, 0), nobody);
    context.runUntilIdle();
    assertThat(bad.reply().status()).as("400 from the proxy, not 403").isEqualTo(400);
  }

  // ---- path traversal: only plain tile numbers ever reach the upstream URL

  @Test
  void pathTraversalAndEncodedTricksNeverReachTheUpstream() throws Exception {
    FakePluginContext context = start();
    List<String> whole = List.of(
        "/tiles/../0/0.png", // ".." as a whole segment is no number
        "/tiles/5/../0.png",
        "/tiles/5/0/...png",
        "/tiles/%2e%2e/0/0.png",
        "/tiles/5/%2e%2e/0.png",
        "/tiles/5/0/%2e%2e.png",
        "/tiles/5/0/0%00.png", // a NUL byte
        "/tiles/5/0%0d%0aX-Evil:1/0.png", // header injection
        "/tiles/5/0%20/0.png",
        "/tiles/5/0;x=1/0.png",
        "/tiles/5/0:1/0.png",
        "/tiles/5/0@evil.example/0.png");
    List<FakeHttpExchange> calls = whole.stream().map(context::call).toList();
    // separators hidden in a segment give more or fewer segments than the template: no tile endpoint
    List<String> split = List.of("/tiles/5/0/..%2f..%2fetc%2fpasswd.png", "/tiles/5/0/%2e%2e%2f0.png", "/tiles/5/0/0/../0.png", "/tiles/5/0/0.png/..");
    List<FakeHttpExchange> splitCalls = split.stream().map(context::call).toList();
    context.runUntilIdle();

    for (int i = 0; i < whole.size(); i++) {
      assertThat(calls.get(i).reply().status()).as(whole.get(i)).isEqualTo(400);
    }
    for (int i = 0; i < split.size(); i++) {
      assertThat(splitCalls.get(i).reply().status()).as(split.get(i)).isIn(400, 404);
    }
    assertThat(context.httpCalls()).as("nothing reached the upstream").isEmpty();
  }

  @Test
  void theUpstreamUrlIsAlwaysTheConfiguredTemplateWithThreeNumbers() throws Exception {
    FakePluginContext context = start();
    context.upstream().respond(upstreamUrl(5, 17, 9), 200, pngHeaders(), png(1));
    // a query string and a leading-zero spelling cannot change which URL is fetched
    context.call(path(5, 17, 9) + "?host=evil.example&url=http://evil.example/");
    context.call("/tiles/05/017/009.png");
    context.runUntilIdle();

    assertThat(context.httpCalls()).isNotEmpty().allSatisfy(call -> assertThat(call.uri().toString()).isEqualTo(upstreamUrl(5, 17, 9)));
  }
}
