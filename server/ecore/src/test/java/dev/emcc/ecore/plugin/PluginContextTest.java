package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.persistence.ConfigStore;
import dev.emcc.ecore.persistence.Configuration;
import dev.emcc.ecore.runtime.ManualTime;
import dev.emcc.ecore.runtime.OwnerLimits;
import dev.emcc.ecore.runtime.Probe;
import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.DataType;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.http.OutboundHttp;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.topic.Topic;
import dev.emcc.sdk.worker.Reply;
import dev.emcc.sdk.worker.ReplyTo;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.net.URL;
import java.net.URLClassLoader;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

/** The SDK's plugin context on ECore's runtime, with manual time. */
class PluginContextTest {

  /** Messages of the test workers. */
  sealed interface Msg extends Message {
    record Text(String text) implements Msg {}

    record Ping(ReplyTo<Text> replyTo, boolean fail) implements Msg {}

    record AskNow(WorkerRef<Msg> target, boolean fail) implements Msg {}

    record Answer(Reply<Text> reply) implements Msg {}

    enum Block implements Msg { BLOCK }

    record Doc(dev.emcc.sdk.document.DocumentResult result) implements Msg {}
  }

  static final String ID = "test-plugin";
  static final SecurityLabel LABEL = SecurityLabel.of("NATO", "RESTRICTED");
  static final dev.emcc.sdk.FieldSet SET = new dev.emcc.sdk.FieldSet("cot", "unit", "CoT unit", List.of("callsign"));
  static final dev.emcc.sdk.RelationKind KIND = new dev.emcc.sdk.RelationKind("gmti.pairing", "GMTI Pairing", dev.emcc.sdk.RelationKind.Line.of("#FFFF00"), false);

  private final ManualTime time = new ManualTime();
  private final PluginStatuses statuses = new PluginStatuses();
  private final WorkerRuntime runtime = WorkerRuntime.start(RuntimeConfig.defaults().time(time).listener(statuses));
  private final ClassLoader loader = new URLClassLoader("plugin-" + ID, new URL[0], getClass().getClassLoader());
  private final PluginEndpoints endpoints = new PluginEndpoints(runtime, new dev.emcc.ecore.json.ModelJson());
  private final PluginSettings pluginSettings =
      new PluginSettings(runtime, new Configuration(new ConfigStore(null, new ModelJson())), new ModelJson());
  private final PluginDocuments documents = new PluginDocuments(ID, runtime.owner(ID), runtime,
      PluginDocuments.startWorker(runtime, new dev.emcc.ecore.persistence.PluginDocumentStore(null, new ModelJson())));
  private final PluginListeners listeners = new PluginListeners(ID, loader, runtime, ListenerConfig.DEFAULT,
      () -> pluginSettings.current(ID), List.of(), java.time.Clock.systemUTC());
  private final PluginConnections connections = new PluginConnections(ID, runtime,
      new TaskEngine(ID, loader, runtime, 4, java.time.Clock.systemUTC(), TaskEngine.Watch.NONE), ListenerConfig.DEFAULT);
  private final PluginChannels channels = new PluginChannels(ID, new ChannelRegistry(runtime), PluginHost.DEFAULT_MAX_CHANNELS);
  private final dev.emcc.sdk.Classifications classifications =
      new dev.emcc.sdk.Classifications(PluginHost.DEFAULT_CLASSIFICATION_ORDERS);
  private final PluginContextImpl context = context(JsonObject.empty().with("greeting", new JsonString("hej")));
  private final Probe<String> seen = new Probe<>();
  private final CountDownLatch release = new CountDownLatch(1);

  private PluginContextImpl context(JsonObject settings) {
    return context(settings, connections, channels, classifications);
  }

  private PluginContextImpl context(JsonObject settings, @Nullable PluginConnections connections,
      @Nullable PluginChannels channels, dev.emcc.sdk.@Nullable Classifications classifications) {
    statuses.register(ID);
    PluginManifest manifest = PluginManifest.of(ID, "Test", "0.1.0", "^1.0.0", "general", List.of(), List.of(),
        List.of(), false, null, "dev.emcc.Test", null, settings);
    OutboundHttp noHttp = new PluginHttp(ID, PluginHttp.newClient(runtime), runtime);
    pluginSettings.register(manifest, null);
    return new PluginContextImpl(manifest, runtime, loader, statuses, endpoints, noHttp, LABEL, PluginHost.DEFAULT_LIMITS,
        pluginSettings, List.of(DataType.general()), null, documents, listeners, connections, channels, classifications, List.of(), List.of(dev.emcc.sdk.Workspace.view()),
        List.of(SET), List.of(KIND), new PluginLocalFolders(ID, List.of(), () -> pluginSettings.current(ID), runtime, runtime.ioExecutor()),
        new PluginStreams(ID, new StreamHub(runtime, StreamLimits.DEFAULT)), new ConversionHub(runtime, ConversionLimits.DEFAULT).member(ID));
  }

  @AfterEach
  void close() {
    release.countDown();
    runtime.close();
  }

  /** A worker that reports what it handles, with the thread's context class loader. */
  private WorkerRef<Msg> recorder(String name) {
    return context.workers().spawn(WorkerSpec.of(name, Msg.class, () -> (message, ctx) -> {
      switch (message) {
        case Msg.Text t -> seen.add(name + " got " + t.text() + " with " + Thread.currentThread().getContextClassLoader().getName());
        case Msg.Ping p -> {
          if (p.fail()) {
            p.replyTo().fail("no pong today");
          } else {
            p.replyTo().reply(new Msg.Text("pong"));
          }
        }
        case Msg.AskNow a -> {
          ctx.ask(a.target(), replyTo -> new Msg.Ping(replyTo, a.fail()), Duration.ofSeconds(2), Msg.Answer::new);
          seen.add(name + " asked");
        }
        case Msg.Answer a -> seen.add(name + " got answer " + a.reply());
        case Msg.Doc d -> seen.add(name + " got " + d.result());
        case Msg.Block b -> {
          seen.add(name + " blocks");
          try {
            release.await(Probe.HOLD.toMillis(), TimeUnit.MILLISECONDS);
          } catch (InterruptedException e) {
            seen.add(name + " interrupted");
          }
        }
      }
    }));
  }

  @Test
  void theFiveMembersOfSdk120AreItsOwnSoNoneFallsBackToTheSdksDefaultThatThrows() throws Exception {
    // W1 (the ACA's whole-SDK review; MCA, 2026-10-27): with these declared here, the PDA may make them abstract.
    // The lookup is the check: getDeclaredMethod throws NoSuchMethodException for one only inherited.
    for (String name : List.of("connections", "channels", "classifications", "declaredFields", "workspaces")) {
      PluginContextImpl.class.getDeclaredMethod(name);
    }

    assertThat(context.connections()).isSameAs(connections);
    assertThat(context.channels()).isSameAs(channels);
    assertThat(context.classifications()).isSameAs(classifications);
    assertThat(context.declaredFields()).isEmpty();
    assertThat(context.workspaces()).extracting(dev.emcc.sdk.Workspace::id).containsExactly("core.view");
  }

  @Test
  void theTwoListsOfSdk140AreItsOwnSoNeitherFallsBackToTheSdksDefaultThatThrows() throws Exception {
    for (String name : List.of("fieldSets", "relationKinds")) {
      PluginContextImpl.class.getDeclaredMethod(name);
    }

    assertThat(context.fieldSets()).containsExactly(SET);
    assertThat(context.relationKinds()).containsExactly(KIND);
  }

  @Test
  void aContextWithoutConnectionsChannelsOrClassificationsIsRefused() {
    JsonObject settings = JsonObject.empty();
    assertThatThrownBy(() -> context(settings, null, channels, classifications))
        .isInstanceOf(NullPointerException.class).hasMessage("connections");
    assertThatThrownBy(() -> context(settings, connections, null, classifications))
        .isInstanceOf(NullPointerException.class).hasMessage("channels");
    assertThatThrownBy(() -> context(settings, connections, channels, null))
        .isInstanceOf(NullPointerException.class).hasMessage("classifications");
  }

  @Test
  void handlersRunWithThePluginsClassLoader() {
    WorkerRef<Msg> worker = recorder("recorder");

    assertThat(worker.send(new Msg.Text("hello"))).isEqualTo(SendResult.ACCEPTED);

    assertThat(seen.next()).isEqualTo("recorder got hello with plugin-" + ID);
  }

  @Test
  void aComputeWorkerRunsOnAPlatformThreadWithThePluginsClassLoader() {
    WorkerRef<Msg> compute = context.workers().spawn(WorkerSpec.of("render", Msg.class, () -> (message, ctx) ->
        seen.add((Thread.currentThread().isVirtual() ? "virtual" : "platform") + " with "
            + Thread.currentThread().getContextClassLoader().getName())).compute(true));

    compute.send(new Msg.Text("go"));

    assertThat(seen.next()).isEqualTo("platform with plugin-" + ID);
  }

  @Test
  void documentsAreStoredPerPluginAndEveryCallIsAnswered() {
    WorkerRef<Msg> worker = recorder("recorder");
    var documents = context.documents();
    JsonObject layers = JsonObject.empty().with("tak-north", new JsonString("layer-1"));

    documents.get("layers", worker, Msg.Doc::new);
    assertThat(seen.next()).isEqualTo("recorder got Missing[key=layers]");
    documents.put("layers", layers, worker, Msg.Doc::new);
    assertThat(seen.next()).isEqualTo("recorder got Written[key=layers]");
    documents.get("layers", worker, Msg.Doc::new);
    assertThat(seen.next()).isEqualTo("recorder got Found[key=layers, value=" + layers + "]");
    documents.put("Not A Key", layers, worker, Msg.Doc::new);
    assertThat(seen.next()).startsWith("recorder got Failed[key=Not A Key, reason=not a document key");
    documents.delete("layers", worker, Msg.Doc::new);
    assertThat(seen.next()).isEqualTo("recorder got Written[key=layers]");
    assertThat(context.owner().outstandingAsks()).isZero();
  }

  @Test
  void referencesAreValuesEqualById() {
    WorkerRef<Msg> worker = recorder("recorder");

    assertThat(worker.id().value()).isEqualTo(ID + "/recorder");
    assertThat(worker.name()).isEqualTo("recorder");
    assertThat(worker).isEqualTo(new PluginWorkers.Ref<>(PluginWorkers.handleOf(worker), Msg.class));
  }

  @Test
  @SuppressWarnings({"unchecked", "rawtypes"})
  void aMessageOfTheWrongTypeIsRefused() {
    WorkerRef raw = recorder("recorder");

    assertThatThrownBy(() -> raw.send(new dev.emcc.sdk.PluginStatus(PluginState.OK, "")))
        .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("accepts");
  }

  @Test
  void workerNamesAreUniqueWithinThePlugin() {
    recorder("recorder");

    assertThatThrownBy(() -> recorder("recorder")).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void anAskOverThePluginsCapIsAnsweredFailedAtOnceAndTheStatusStays() {
    context.owner().limits(new OwnerLimits(1, 1_000));
    WorkerRef<Msg> asker = recorder("asker");
    WorkerRef<Msg> server = recorder("server");
    server.send(Msg.Block.BLOCK); // the first request stays unanswered
    assertThat(seen.next()).isEqualTo("server blocks");

    asker.send(new Msg.AskNow(server, false));
    asker.send(new Msg.AskNow(server, false));

    assertThat(seen.next(3)).containsExactly("asker asked", "asker asked", "asker got answer Failed[reason=too many outstanding asks]");
    assertThat(context.owner().refusedAsks()).isEqualTo(1);
    assertThat(statuses.of(ID).state()).isEqualTo(PluginState.OK);
  }

  @Test
  void aTimerOverThePluginsCapThrowsAndTheStatusStays() {
    context.owner().limits(new OwnerLimits(10, 1));
    WorkerRef<Msg> worker = recorder("recorder");
    context.timers().once(Duration.ofSeconds(1), worker, new Msg.Text("first"));

    assertThatThrownBy(() -> context.timers().every(Duration.ofSeconds(1), worker, new Msg.Text("second")))
        .isInstanceOf(IllegalStateException.class).hasMessage("too many active timers: " + ID + " has 1, its cap");
    time.advanceSettled(Duration.ofSeconds(1), runtime);
    assertThat(seen.next()).startsWith("recorder got first");
    Cancellable third = context.timers().once(Duration.ofSeconds(1), worker, new Msg.Text("third"));
    third.cancel();
    assertThat(context.owner().refusedTimers()).isEqualTo(1);
    assertThat(statuses.of(ID).state()).isEqualTo(PluginState.OK);
  }

  @Test
  void anAskIsAnsweredWithOkOrFailedOrTimesOut() {
    WorkerRef<Msg> asker = recorder("asker");
    WorkerRef<Msg> server = recorder("server");

    asker.send(new Msg.AskNow(server, false));
    assertThat(seen.next(2)).containsExactly("asker asked", "asker got answer Ok[value=Text[text=pong]]");

    asker.send(new Msg.AskNow(server, true));
    assertThat(seen.next(2)).containsExactly("asker asked", "asker got answer Failed[reason=no pong today]");

    server.send(Msg.Block.BLOCK);
    assertThat(seen.next()).isEqualTo("server blocks");
    asker.send(new Msg.AskNow(server, false));
    assertThat(seen.next()).isEqualTo("asker asked");
    time.advance(Duration.ofSeconds(2)); // raw: the server blocks on purpose (2 s is within its 5 s budget)
    assertThat(seen.next()).isEqualTo("asker got answer TimedOut[]");
  }

  @Test
  void aPluginPublishesOnlyToItsOwnTopics() {
    Topic<Msg.Text> own = Topic.of(ID + ".news", Msg.Text.class);
    WorkerRef<Msg> subscriber = recorder("subscriber");
    context.topics().subscribe(own, subscriber, t -> new Msg.Text("news: " + t.text()));

    context.topics().publish(own, new Msg.Text("it works"));

    assertThat(seen.next()).startsWith("subscriber got news: it works");
    assertThatThrownBy(() -> context.topics().publish(Topic.of("other-plugin.news", Msg.Text.class), new Msg.Text("x")))
        .isInstanceOf(IllegalArgumentException.class).hasMessageContaining("own topics");
  }

  /** Another plugin's message class on the topic's name (G19). */
  record Elsewhere(String text) implements Message {}

  @Test
  void aSubscriptionWithAnotherClassCannotBreakThePublishingPlugin() {
    Topic<Msg.Text> own = Topic.of(ID + ".news", Msg.Text.class);
    WorkerRef<Msg> subscriber = recorder("subscriber");
    context.topics().subscribe(Topic.of(ID + ".news", Elsewhere.class), subscriber, e -> new Msg.Text("wrong " + e.text()));
    context.topics().subscribe(own, subscriber, t -> new Msg.Text("news: " + t.text()));

    context.topics().publish(own, new Msg.Text("still works"));

    assertThat(seen.next()).startsWith("subscriber got news: still works");
  }

  @Test
  void timersDeliverOnceOrRepeatedlyUntilCancelled() {
    WorkerRef<Msg> worker = recorder("recorder");
    Cancellable once = context.timers().once(Duration.ofSeconds(1), worker, new Msg.Text("once"));
    Cancellable cancelled = context.timers().once(Duration.ofSeconds(1), worker, new Msg.Text("never"));
    Cancellable every = context.timers().every(Duration.ofSeconds(5), worker, new Msg.Text("tick"));
    cancelled.cancel();

    time.advanceSettled(Duration.ofSeconds(1), runtime);
    assertThat(seen.next()).startsWith("recorder got once");
    time.advanceSettled(Duration.ofSeconds(4), runtime);
    assertThat(seen.next()).startsWith("recorder got tick");
    every.cancel();
    once.cancel(); // already fired: no effect
    time.advanceSettled(Duration.ofSeconds(10), runtime);
    worker.send(new Msg.Text("last"));
    assertThat(seen.next()).startsWith("recorder got last");
  }

  @Test
  void theEffectiveStatusIsTheWorseOfThePluginsAndEcores() {
    context.status().set(PluginState.DEGRADED, "upstream down");
    assertThat(statuses.of(ID).state()).isEqualTo(PluginState.DEGRADED);

    statuses.setByEcore(ID, PluginState.FAILED, "broken");
    context.status().set(PluginState.OK, "all good again");

    assertThat(statuses.of(ID)).satisfies(s -> {
      assertThat(s.state()).isEqualTo(PluginState.FAILED);
      assertThat(s.detail()).isEqualTo("broken");
    });
  }

  @Test
  void aHungWorkerThatIsNotRestartedMakesThePluginDegraded() {
    WorkerRef<Msg> worker = context.workers().spawn(WorkerSpec.of("slow", Msg.class, () -> (message, ctx) -> {
      seen.add("slow blocks");
      try {
        release.await(Probe.HOLD.toMillis(), TimeUnit.MILLISECONDS);
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
      }
    }).budget(Duration.ofSeconds(1)));
    worker.send(Msg.Block.BLOCK);
    assertThat(seen.next()).isEqualTo("slow blocks");

    time.advance(Duration.ofMillis(1_200));

    assertThat(statuses.of(ID).state()).isEqualTo(PluginState.DEGRADED);
    assertThat(statuses.of(ID).detail()).contains("worker slow hung");
  }

  @Test
  void aRestartGetsAFreshHandlerFromTheFactoryWithThePluginsClassLoader() {
    context.workers().spawn(WorkerSpec.<Msg>of("restartable", Msg.class, () -> {
      seen.add("factory with " + Thread.currentThread().getContextClassLoader().getName());
      return (message, ctx) -> {
        seen.add("blocks");
        try {
          release.await(Probe.HOLD.toMillis(), TimeUnit.MILLISECONDS);
        } catch (InterruptedException e) {
          seen.add("fenced");
        }
      };
    }).budget(Duration.ofSeconds(1)).restartable(true)).send(Msg.Block.BLOCK);
    assertThat(seen.next(2)).containsExactly("factory with plugin-" + ID, "blocks");

    time.advance(Duration.ofMillis(1_200));

    assertThat(seen.next(2)).containsExactlyInAnyOrder("fenced", "factory with plugin-" + ID);
    assertThat(statuses.of(ID).state()).isEqualTo(PluginState.OK); // restarted, so not degraded
  }

  @Test
  void settingsAndTheDefaultLabelComeFromTheManifestAndConfiguration() {
    assertThat(context.pluginId()).isEqualTo(ID);
    assertThat(context.settings().getString("greeting")).isEqualTo("hej");
    assertThat(context.defaultLabel()).isEqualTo(LABEL);
    context.log().info("a log line from {}", ID);
  }
}
