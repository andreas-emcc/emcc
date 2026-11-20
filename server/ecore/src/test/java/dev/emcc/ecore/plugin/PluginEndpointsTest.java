package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.runtime.ManualTime;
import dev.emcc.ecore.runtime.Probe;
import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.http.Endpoint;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.http.HttpReply;
import dev.emcc.sdk.worker.Overflow;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.net.URLClassLoader;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** Plugin endpoints: delivery into the worker, ECore's own answers, exactly one answer. */
class PluginEndpointsTest {

  sealed interface Msg extends Message {
    record Get(EndpointRequest request) implements Msg {}

    enum Block implements Msg { BLOCK }
  }

  private static final String ID = "tiles";

  private final ManualTime time = new ManualTime();
  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults().time(time));
  private final PluginEndpoints endpoints = new PluginEndpoints(runtime, new dev.emcc.ecore.json.ModelJson());
  private final PluginWorkers workers =
      new PluginWorkers(ID, runtime.owner(ID), new URLClassLoader(new java.net.URL[0], getClass().getClassLoader()));
  private final Probe<String> seen = new Probe<>();
  private final Probe<HttpReply> answers = new Probe<>();
  private final CountDownLatch release = new CountDownLatch(1);

  @AfterEach
  void close() {
    release.countDown();
    runtime.close();
  }

  /** Answers every request with its path parameters, twice if asked to; "silent" never answers. */
  private WorkerRef<Msg> tileWorker(int capacity, Overflow<Msg> overflow) {
    return workers.spawn(WorkerSpec.of("tile-worker", Msg.class, () -> (message, ctx) -> {
      switch (message) {
        case Msg.Get get -> {
          EndpointRequest r = get.request();
          seen.add("got " + r.path() + (r.user().noLogin() ? "" : " for " + r.user().id()));
          if (r.pathParameter("z").equals("silent")) {
            return;
          }
          HttpReply reply = HttpReply.of(200, Headers.of("Content-Type", "text/plain"), Bytes.utf8(
              "z=" + r.pathParameter("z") + " x=" + r.pathParameter("x") + " y=" + r.pathParameter("y")));
          r.response().respond(reply);
          if ("twice".equals(r.queryParameter("answer"))) {
            r.response().respond(HttpReply.status(500));
          }
        }
        case Msg.Block b -> {
          seen.add("blocks");
          try {
            release.await(Probe.HOLD.toMillis(), TimeUnit.MILLISECONDS);
          } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
          }
        }
      }
    }).mailbox(capacity, overflow));
  }

  private WorkerRef<Msg> registered(int capacity, Overflow<Msg> overflow) {
    WorkerRef<Msg> worker = tileWorker(capacity, overflow);
    endpoints.of(ID).register(Endpoint.get("/tiles/{z}/{x}/{y}.png").timeout(Duration.ofSeconds(1)), worker, Msg.Get::new);
    return worker;
  }

  private void get(String pluginId, String path, Map<String, List<String>> query) {
    endpoints.dispatch(
        new PluginEndpoints.Request(pluginId, "GET", path, query, Headers.empty(), dev.emcc.sdk.User.noLoginUser()), answers::add);
  }

  private void get(String path) {
    get(ID, path, Map.of());
  }

  @Test
  void aRequestArrivesAsAMessageAndTheWorkersAnswerIsSent() {
    registered(10, Overflow.dropNewest());

    get("/tiles/5/17/9.png");

    assertThat(seen.next()).isEqualTo("got /tiles/5/17/9.png");
    HttpReply reply = answers.next();
    assertThat(reply.status()).isEqualTo(200);
    assertThat(reply.body().toUtf8()).isEqualTo("z=5 x=17 y=9");
    assertThat(reply.headers().first("content-type")).isEqualTo("text/plain");
  }

  @Test
  void anEndpointThatRequiresAPermissionIsRefusedWith403WithoutReachingThePlugin() {
    WorkerRef<Msg> worker = tileWorker(10, Overflow.dropNewest());
    endpoints.of(ID).register(Endpoint.get("/edit/{z}/{x}/{y}").requires("plugin.basemap-osm.edit"), worker, Msg.Get::new);
    dev.emcc.sdk.User viewer = dev.emcc.sdk.User.of("u-1", "Viewer", java.util.Set.of("objects.edit"));
    dev.emcc.sdk.User editor = dev.emcc.sdk.User.of("u-2", "Editor", java.util.Set.of("plugin.basemap-osm.edit"));

    endpoints.dispatch(new PluginEndpoints.Request(ID, "GET", "/edit/1/2/3", Map.of(), Headers.empty(), viewer), answers::add);
    HttpReply refused = answers.next();
    assertThat(refused.status()).isEqualTo(403);
    assertThat(refused.body().toUtf8()).isEqualTo("this needs the permission plugin.basemap-osm.edit");
    assertThat(seen.drain()).as("never delivered").isEmpty();

    endpoints.dispatch(new PluginEndpoints.Request(ID, "GET", "/edit/1/2/3", Map.of(), Headers.empty(), editor), answers::add);
    assertThat(seen.next()).as("the user who asked").isEqualTo("got /edit/1/2/3 for u-2");
    assertThat(answers.next().status()).isEqualTo(200);
    get("/edit/1/2/3");
    assertThat(seen.next()).as("the local user has every permission").isEqualTo("got /edit/1/2/3");
  }

  @Test
  void unknownPluginsAndPathsGet404AndOtherMethods405() {
    registered(10, Overflow.dropNewest());

    get("other", "/tiles/1/2/3.png", Map.of());
    get("/tiles/1/2.png");
    endpoints.dispatch(new PluginEndpoints.Request(ID, "POST", "/tiles/1/2/3.png", Map.of(), Headers.empty(), dev.emcc.sdk.User.noLoginUser()), answers::add);

    assertThat(answers.next(3)).extracting(HttpReply::status).containsExactly(404, 404, 405);
  }

  @Test
  void anEndpointIsRegisteredOnlyOnce() {
    WorkerRef<Msg> worker = registered(10, Overflow.dropNewest());

    assertThatThrownBy(() -> endpoints.of(ID).register(Endpoint.get("/tiles/{z}/{x}/{y}.png"), worker, Msg.Get::new))
        .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("already has an endpoint");
  }

  @Test
  void withoutAnAnswerWithinTheTimeoutEcoreSends504AndIgnoresALateAnswer() {
    registered(10, Overflow.dropNewest());

    get("/tiles/silent/1/2.png");
    assertThat(seen.next()).isEqualTo("got /tiles/silent/1/2.png");
    time.advanceSettled(Duration.ofSeconds(1), runtime);

    assertThat(answers.next().status()).isEqualTo(504);
  }

  @Test
  void aSecondAnswerIsIgnored() {
    registered(10, Overflow.dropNewest());

    get(ID, "/tiles/1/2/3.png", Map.of("answer", List.of("twice")));

    assertThat(answers.next().status()).isEqualTo(200);
    get("/tiles/4/5/6.png"); // the worker has finished the first request when it handles this one
    assertThat(answers.next().status()).isEqualTo(200);
    assertThat(answers.drain()).isEmpty();
  }

  @Test
  void aRequestTheMailboxRefusesGets503AtOnce() {
    WorkerRef<Msg> worker = registered(1, Overflow.dropNewest());
    worker.send(Msg.Block.BLOCK);
    assertThat(seen.next()).isEqualTo("blocks");
    get("/tiles/1/1/1.png"); // queued

    get("/tiles/2/2/2.png"); // refused

    assertThat(answers.next().status()).isEqualTo(503);
    release.countDown();
    assertThat(answers.next().status()).isEqualTo(200);
  }

  @Test
  void aRequestEvictedLaterGets503() {
    WorkerRef<Msg> worker = registered(1, Overflow.dropOldest());
    worker.send(Msg.Block.BLOCK);
    assertThat(seen.next()).isEqualTo("blocks");
    get("/tiles/1/1/1.png");

    get("/tiles/2/2/2.png"); // evicts the first

    assertThat(answers.next().status()).isEqualTo(503);
    release.countDown();
    assertThat(seen.next()).isEqualTo("got /tiles/2/2/2.png");
    assertThat(answers.next().status()).isEqualTo(200);
  }

  @Test
  void aFailingMapperGets500() {
    WorkerRef<Msg> worker = tileWorker(10, Overflow.dropNewest());
    endpoints.of(ID).register(Endpoint.get("/broken"), worker, request -> {
      throw new IllegalStateException("mapper failed on purpose");
    });

    get("/broken");

    assertThat(answers.next().status()).isEqualTo(500);
  }

  @Test
  void aRemovedPluginsEndpointsAreGone() {
    registered(10, Overflow.dropNewest());

    endpoints.remove(ID);
    get("/tiles/1/2/3.png");

    assertThat(answers.next().status()).isEqualTo(404);
  }
}
