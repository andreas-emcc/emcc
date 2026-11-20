package dev.emcc.plugins.nvg.links;

import dev.emcc.plugins.nvg.codec.Limits;
import dev.emcc.plugins.nvg.compute.ComputeMsg;
import dev.emcc.plugins.nvg.files.Replies;
import dev.emcc.plugins.nvg.mapping.ItemMapper;
import dev.emcc.plugins.nvg.sync.SyncPlan;
import dev.emcc.plugins.nvg.sync.SyncRun;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.ClassificationLimit;
import dev.emcc.sdk.LayerChoice;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.channel.ChannelCapability;
import dev.emcc.sdk.channel.ChannelItem;
import dev.emcc.sdk.channel.ChannelRef;
import dev.emcc.sdk.channel.ChannelSpec;
import dev.emcc.sdk.document.DocumentResult;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.http.HttpCall;
import dev.emcc.sdk.http.HttpReply;
import dev.emcc.sdk.http.HttpResult;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.ChangeEvent;
import dev.emcc.sdk.model.EntityType;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.LayerContent;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Meta;
import dev.emcc.sdk.model.Operation;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.store.Change;
import dev.emcc.sdk.store.ChangeOutcome;
import dev.emcc.sdk.store.ObjectQuery;
import dev.emcc.sdk.store.QueryResult;
import dev.emcc.sdk.store.StoreUpdate;
import dev.emcc.sdk.worker.Handler;
import dev.emcc.sdk.worker.Reply;
import dev.emcc.sdk.worker.WorkerContext;
import dev.emcc.sdk.worker.WorkerRef;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * The NVG web service links (brief, sections 4 to 6; ADR-0055 point 2).
 *
 * <p><b>{@code soap-consumer}</b>: every {@code intervalSeconds} a {@code GetNvg} with the link's
 * filter answers, one call at a time (a call still running skips the turn). The answer is read and
 * planned on the compute worker; each document is the whole picture: items are created or updated by
 * their {@code uri}, and an object of the link whose {@code uri} is gone is deleted, but only after a
 * complete document that was not refused. A failed call, a fault, an HTTP error or a refused document
 * changes nothing; an empty document clears the link's objects only with {@code clearOnEmpty}. The
 * link's new layer is made in View and kept in the plugin document {@value #LAYERS_DOC}, so that two
 * links that name the same new layer share one.
 *
 * <p><b>{@code soap-provider}</b>: a service endpoint ({@code /api/services/nvg/nvg/<link>}, no
 * authentication in M7, owner Q1) answers {@code GetCapabilities} with its source layers (N4) and
 * {@code GetNvg} with their objects and the items senders gave its output channel; an object above the
 * highest classification, or one that came in through this link, is not served (ADR-0037 points 3
 * and 8).
 */
public final class LinksWorker implements Handler<LinksMsg> {

  /** The plugin document of the links' new layers: their name and id. */
  public static final String LAYERS_DOC = "layers";

  /** The output type of a provider link's channel. */
  public static final String OUTPUT_TYPE = "nvg";

  private static final Duration STORE_TIMEOUT = Duration.ofSeconds(30);
  private static final Duration COMPUTE_TIMEOUT = Duration.ofSeconds(60);
  private static final int CAPABILITIES_BYTES = 1024 * 1024;

  private final PluginContext context;
  private final WorkerRef<ComputeMsg> compute;
  private @Nullable WorkerRef<LinksMsg> self;
  private @Nullable WorkerContext<LinksMsg> current;
  private LinkSettings.Links links = new LinkSettings.Links(Map.of(), Map.of(), Map.of());
  private int maxMegabytes = 16;
  private boolean layersLoaded;
  private final Map<String, UUID> newLayers = new LinkedHashMap<>();
  private final Map<UUID, Layer> layers = new HashMap<>();
  private final Map<String, ConsumerState> consumers = new LinkedHashMap<>();
  private final Map<String, ProviderState> providers = new LinkedHashMap<>();
  private final Map<UUID, SourceCopy> sources = new HashMap<>();
  private final Map<UUID, ProviderCall> calls = new HashMap<>();
  private final Map<UUID, EndpointRequest> capabilityCalls = new HashMap<>();
  private String lastStatus = "";

  public LinksWorker(PluginContext context, WorkerRef<ComputeMsg> compute) {
    this.context = context;
    this.compute = compute;
  }

  /** A consumer link's state. */
  private static final class ConsumerState {
    LinkSettings.Consumer cfg;
    @Nullable Cancellable timer;
    int timerSeconds;
    long call;
    boolean busy;
    int answerStatus;
    @Nullable Bytes answer;
    QueryResult.@Nullable Found found;
    @Nullable SyncRun run;
    SyncPlan.@Nullable Plan plan;
    @Nullable Instant lastCall;
    @Nullable Instant nextCall;
    String lastResult = "not called yet";
    boolean ok = true;
    @Nullable UUID layer;
    final Map<String, Long> counters = new LinkedHashMap<>();
    List<Soap.CapabilityItem> capabilities = List.of();

    ConsumerState(LinkSettings.Consumer cfg) {
      this.cfg = cfg;
    }
  }

  /** A provider link's state. */
  private static final class ProviderState {
    LinkSettings.Provider cfg;
    @Nullable ChannelRef channel;
    final Map<UUID, MapObjectContent> channelItems = new LinkedHashMap<>();
    long calls;
    long served;
    @Nullable String lastCaller;
    @Nullable Instant lastCallAt;
    final Map<String, Long> counters = new LinkedHashMap<>();

    ProviderState(LinkSettings.Provider cfg) {
      this.cfg = cfg;
    }
  }

  /** The plugin's own copy of one source layer, kept from its subscription. */
  private static final class SourceCopy {
    final Cancellable subscription;
    final Map<UUID, MapObject> objects = new LinkedHashMap<>();

    SourceCopy(Cancellable subscription) {
      this.subscription = subscription;
    }
  }

  /** A provider call waiting for its document. */
  private record ProviderCall(EndpointRequest request, String link, String version) {}

  @Override
  public void handle(LinksMsg message, WorkerContext<LinksMsg> ctx) {
    self = ctx.self();
    current = ctx;
    switch (message) {
      case LinksMsg.Settings m -> settings(m.values());
      case LinksMsg.LayersLoaded m -> layersLoaded(m.result());
      case LinksMsg.LayersSaved m -> {
        if (m.result() instanceof DocumentResult.Failed f) {
          ctx.log().warn("could not keep the links' layers: {}", f.reason());
        }
      }
      case LinksMsg.Poll m -> poll(m.link());
      case LinksMsg.Called m -> called(m);
      case LinksMsg.Queried m -> queried(m);
      case LinksMsg.LayerCreated m -> layerCreated(m);
      case LinksMsg.Prepared m -> prepared(m, ctx);
      case LinksMsg.Synced m -> synced(m.outcome());
      case LinksMsg.Service m -> service(m.request(), ctx);
      case LinksMsg.Served m -> served(m);
      case LinksMsg.Source m -> source(m.layer(), m.update());
      case LinksMsg.Channel m -> channel(m.link(), m.item());
      case LinksMsg.ListLinks m -> m.request().response().respond(HttpReply.json(200, list()));
      case LinksMsg.Capabilities m -> capabilities(m.request());
      case LinksMsg.CapabilitiesCalled m -> capabilitiesCalled(m);
    }
    refreshStatus();
  }

  private WorkerRef<LinksMsg> self() {
    if (self == null) {
      throw new IllegalStateException("no message handled yet");
    }
    return self;
  }

  // --- settings -----------------------------------------------------------------------------

  private void settings(JsonObject values) {
    links = LinkSettings.read(values, context.defaultLabel());
    if (values.get("maxDocumentMegabytes") instanceof JsonNumber n) {
      maxMegabytes = Math.max(1, Math.min(16, n.bigDecimalValue().intValue()));
    }
    // Consumers: a changed interval reschedules; everything else applies at the next poll.
    for (String name : new ArrayList<>(consumers.keySet())) {
      if (!links.consumers().containsKey(name)) {
        cancel(consumers.remove(name));
      }
    }
    for (LinkSettings.Consumer cfg : links.consumers().values()) {
      ConsumerState st = consumers.get(cfg.name());
      boolean fresh = st == null;
      if (fresh) {
        st = new ConsumerState(cfg);
        consumers.put(cfg.name(), st);
      }
      st.cfg = cfg;
      if (!cfg.enabled()) {
        cancel(st);
        st.lastResult = "switched off";
        st.ok = true;
        continue;
      }
      if (st.timer == null || st.timerSeconds != cfg.intervalSeconds()) {
        cancel(st);
        st.timerSeconds = cfg.intervalSeconds();
        st.timer = context.timers().every(Duration.ofSeconds(cfg.intervalSeconds()), self(), new LinksMsg.Poll(cfg.name()));
        st.nextCall = Instant.now().plusSeconds(cfg.intervalSeconds());
        if (fresh || st.lastCall == null) {
          if (st.lastResult.equals("switched off")) {
            st.lastResult = "not called yet";
          }
          self().send(new LinksMsg.Poll(cfg.name()));
        }
      }
    }
    // Providers: an output channel per enabled link (ADR-0037), a copy of each source layer.
    for (String name : new ArrayList<>(providers.keySet())) {
      if (!links.providers().containsKey(name)) {
        withdraw(providers.remove(name));
      }
    }
    Set<UUID> wanted = new HashSet<>();
    for (LinkSettings.Provider cfg : links.providers().values()) {
      ProviderState st = providers.computeIfAbsent(cfg.name(), n -> new ProviderState(cfg));
      st.cfg = cfg;
      if (!cfg.enabled()) {
        withdraw(st);
        continue;
      }
      if (st.channel == null) {
        String link = cfg.name();
        st.channel = context.channels().offer(ChannelSpec.of(link, "NVG " + link, OUTPUT_TYPE).can(ChannelCapability.DELETE), self(),
            item -> new LinksMsg.Channel(link, item));
      }
      for (LayerChoice choice : cfg.sourceLayers()) {
        if (choice.id() != null) {
          wanted.add(choice.id());
        }
      }
    }
    for (UUID id : new ArrayList<>(sources.keySet())) {
      if (!wanted.contains(id)) {
        sources.remove(id).subscription.cancel();
      }
    }
    for (UUID id : wanted) {
      if (!sources.containsKey(id)) {
        sources.put(id, new SourceCopy(context.store().subscribe(ObjectQuery.all().inLayer(id), self(), u -> new LinksMsg.Source(id, u))));
      }
    }
  }

  private void cancel(@Nullable ConsumerState st) {
    if (st != null && st.timer != null) {
      st.timer.cancel();
      st.timer = null;
      st.nextCall = null;
    }
  }

  private static void withdraw(@Nullable ProviderState st) {
    if (st != null && st.channel != null) {
      st.channel.withdraw();
      st.channel = null;
      st.channelItems.clear();
    }
  }

  private void layersLoaded(DocumentResult result) {
    if (result instanceof DocumentResult.Found found) {
      found.value().members().forEach((name, value) -> {
        if (value instanceof JsonString s) {
          try {
            newLayers.put(name, UUID.fromString(s.value()));
          } catch (IllegalArgumentException e) {
            // a broken entry is made again
          }
        }
      });
    }
    layersLoaded = true;
    for (ConsumerState st : consumers.values()) {
      if (st.cfg.enabled()) {
        self().send(new LinksMsg.Poll(st.cfg.name()));
      }
    }
  }

  // --- consumer -----------------------------------------------------------------------------

  private void poll(String link) {
    ConsumerState st = consumers.get(link);
    if (st == null || !st.cfg.enabled() || !layersLoaded) {
      return;
    }
    if (st.busy) {
      count(st.counters, "skipped turn");
      return;
    }
    LinkSettings.Consumer cfg = st.cfg;
    st.busy = true;
    long call = ++st.call;
    st.lastCall = Instant.now();
    st.nextCall = st.lastCall.plusSeconds(cfg.intervalSeconds());
    HttpCall request = HttpCall.post(cfg.url(), "text/xml; charset=utf-8", Soap.getNvgRequest(cfg.filter()))
        .header("SOAPAction", Soap.action("GetNvg"))
        .maxResponseBytes(maxMegabytes * Limits.MIB);
    if (cfg.credential() != null) {
      request = request.credential(cfg.credential());
    }
    context.http().send(request, Duration.ofSeconds(cfg.timeoutSeconds()), self(), r -> new LinksMsg.Called(link, call, r));
  }

  private @Nullable ConsumerState current(String link, long call) {
    ConsumerState st = consumers.get(link);
    return st != null && st.busy && st.call == call ? st : null;
  }

  private void called(LinksMsg.Called m) {
    ConsumerState st = current(m.link(), m.call());
    if (st == null) {
      return;
    }
    switch (m.result()) {
      case HttpResult.Response r when r.status() == 200 || r.status() == 500 -> {
        st.answer = r.body();
        st.answerStatus = r.status();
        String link = m.link();
        long call = m.call();
        context.store().query(ObjectQuery.byExternalSystem(link).limit(ObjectQuery.MAX_LIMIT), STORE_TIMEOUT, self(),
            q -> new LinksMsg.Queried(link, call, q));
      }
      case HttpResult.Response r -> finish(st, false, "HTTP " + r.status(), "HTTP " + r.status());
      case HttpResult.Failed f -> finish(st, false, "call failed: " + f.reason(), "call failed");
      case HttpResult.TimedOut t -> finish(st, false, "call failed: no answer within " + st.cfg.timeoutSeconds() + " s", "call failed");
    }
  }

  private void queried(LinksMsg.Queried m) {
    ConsumerState st = current(m.link(), m.call());
    if (st == null) {
      return;
    }
    if (!(m.result() instanceof QueryResult.Found found)) {
      finish(st, false, "the object store did not answer", "store failed");
      return;
    }
    found.layers().forEach(l -> layers.put(l.id(), l));
    Set<UUID> present = new HashSet<>();
    found.layers().forEach(l -> present.add(l.id()));
    LayerChoice choice = st.cfg.target();
    UUID target = null;
    if (choice.id() != null && present.contains(choice.id())) {
      target = choice.id();
    } else if (newLayers.containsKey(choice.name()) && present.contains(newLayers.get(choice.name()))) {
      target = newLayers.get(choice.name());
    }
    if (target != null) {
      prepare(st, found, target);
      return;
    }
    // Make the layer in View, with the link's label; keep it by its name (shared by links that name it).
    st.found = found;
    UUID id = UUID.randomUUID();
    double top = found.layers().stream().mapToDouble(l -> l.content().drawOrder()).max().orElse(0) + 1;
    SecurityLabel label = st.cfg.label() != null ? st.cfg.label() : context.defaultLabel();
    String name = choice.name();
    String link = m.link();
    long call = m.call();
    context.store().submit(Change.createLayer(id, new LayerContent(name, top, true, label, Extensions.empty())), STORE_TIMEOUT, self(),
        o -> new LinksMsg.LayerCreated(link, call, name, id, o));
  }

  private void layerCreated(LinksMsg.LayerCreated m) {
    ConsumerState st = current(m.link(), m.call());
    if (st == null || st.found == null) {
      return;
    }
    QueryResult.Found found = st.found;
    st.found = null;
    if (!(m.outcome() instanceof ChangeOutcome.Applied applied)) {
      finish(st, false, "could not make the layer " + m.name(), "layer not made");
      return;
    }
    if (applied.event().state() instanceof Layer l) {
      layers.put(l.id(), l);
    }
    newLayers.put(m.name(), m.id());
    JsonObject.Builder doc = JsonObject.builder();
    newLayers.forEach((name, id) -> doc.put(name, JsonString.of(id.toString())));
    context.documents().put(LAYERS_DOC, doc.build(), self(), LinksMsg.LayersSaved::new);
    prepare(st, found, m.id());
  }

  private void prepare(ConsumerState st, QueryResult.Found found, UUID target) {
    Layer layer = layers.get(target);
    st.layer = target;
    if (layer != null && layer.content().isLocked()) {
      st.answer = null;
      finish(st, false, "the layer " + layer.content().name() + " is locked", "layer locked");
      return;
    }
    Map<String, String> blocked = new HashMap<>();
    for (MapObject o : found.objects()) {
      Layer in = layers.get(o.content().layerId());
      if (in != null && in.content().isLocked() && o.meta().externalRef() != null) {
        blocked.put(o.meta().externalRef().id(), "skipped: layer locked");
      }
    }
    LinkSettings.Consumer cfg = st.cfg;
    SecurityLabel fallback = cfg.label() != null ? cfg.label() : context.defaultLabel();
    ItemMapper.Context mapping = new ItemMapper.Context(cfg.name(), target, fallback, context.classifications());
    Bytes answer = st.answer == null ? Bytes.empty() : st.answer;
    st.answer = null;
    String link = cfg.name();
    long call = st.call;
    Limits limits = Limits.DEFAULT.withMegabytes(maxMegabytes);
    List<MapObject> stored = found.objects();
    WorkerContext<LinksMsg> ctx = current;
    if (ctx == null) {
      throw new IllegalStateException("no message handled yet");
    }
    ctx.<ComputeMsg, ComputeMsg.Prepared>ask(compute, replyTo -> new ComputeMsg.Prepare(answer, limits, link, stored, blocked, mapping, true,
        cfg.clearOnEmpty(), true, replyTo), COMPUTE_TIMEOUT, reply -> new LinksMsg.Prepared(link, call, reply));
  }

  private void prepared(LinksMsg.Prepared m, WorkerContext<LinksMsg> ctx) {
    ConsumerState st = current(m.link(), m.call());
    if (st == null) {
      return;
    }
    switch (m.reply()) {
      case Reply.Ok<ComputeMsg.Prepared> ok -> {
        ComputeMsg.Prepared p = ok.value();
        if (p.plan() == null) {
          String counter = p.counter() == null ? "refused" : p.counter();
          finish(st, false, counter + ": " + p.reason(), counter);
          return;
        }
        if (st.answerStatus == 500) {
          finish(st, false, "HTTP 500", "HTTP 500");
          return;
        }
        st.plan = p.plan();
        p.plan().skipped().forEach((k, v) -> st.counters.merge(k, v, Long::sum));
        p.plan().notes().forEach((k, v) -> st.counters.merge(k, v, Long::sum));
        st.run = new SyncRun(UUID.randomUUID(), p.plan().changes());
        pump(st);
      }
      case Reply.Failed<ComputeMsg.Prepared> f -> finish(st, false, "the answer could not be read: " + f.reason(), "refused: not read");
      case Reply.TimedOut<ComputeMsg.Prepared> t -> finish(st, false, "the answer could not be read in time", "refused: not read");
    }
    ctx.log().debug("link {} answer prepared", m.link());
  }

  private void synced(SyncRun.Outcome outcome) {
    for (ConsumerState st : consumers.values()) {
      if (st.run != null && st.run.id().equals(outcome.run())) {
        st.run.handle(outcome);
        pump(st);
        return;
      }
    }
  }

  private void pump(ConsumerState st) {
    SyncRun run = st.run;
    if (run == null) {
      return;
    }
    run.pump(context.store(), self(), LinksMsg.Synced::new);
    if (run.done()) {
      SyncRun.Result r = run.result();
      r.failed().forEach((k, v) -> st.counters.merge(k, v, Long::sum));
      SyncPlan.Plan plan = st.plan;
      int items = plan == null ? 0 : plan.items();
      String text = items + " items, " + r.created() + " created, " + r.updated() + " updated, " + r.deleted() + " deleted";
      st.run = null;
      finish(st, r.failed().isEmpty(), text, null);
    }
  }

  private void finish(ConsumerState st, boolean ok, String text, @Nullable String counter) {
    st.busy = false;
    st.ok = ok;
    st.answer = null;
    st.found = null;
    st.lastResult = (st.lastCall == null ? "" : time(st.lastCall) + " ") + text;
    if (counter != null) {
      count(st.counters, counter);
    }
  }

  // --- capabilities (NV1: the NVG panel's button for admins) ------------------------------------

  private void capabilities(EndpointRequest request) {
    String name = request.pathParameter("name");
    ConsumerState st = consumers.get(name);
    if (st == null) {
      request.response().respond(Replies.error(404, "No consumer link " + name));
      return;
    }
    LinkSettings.Consumer cfg = st.cfg;
    HttpCall call = HttpCall.post(cfg.url(), "text/xml; charset=utf-8", Soap.getCapabilitiesRequest())
        .header("SOAPAction", Soap.action("GetCapabilities"))
        .maxResponseBytes(CAPABILITIES_BYTES);
    if (cfg.credential() != null) {
      call = call.credential(cfg.credential());
    }
    UUID id = UUID.randomUUID();
    capabilityCalls.put(id, request);
    context.http().send(call, Duration.ofSeconds(cfg.timeoutSeconds()), self(), r -> new LinksMsg.CapabilitiesCalled(name, id, r));
  }

  private void capabilitiesCalled(LinksMsg.CapabilitiesCalled m) {
    EndpointRequest request = capabilityCalls.remove(m.call());
    if (request == null) {
      return;
    }
    switch (m.result()) {
      case HttpResult.Response r when r.status() == 200 || r.status() == 500 -> {
        Soap.Capabilities caps = Soap.readCapabilities(r.body());
        if (caps.items() == null) {
          request.response().respond(Replies.error(502, "The provider's answer: " + caps.problem()));
          return;
        }
        ConsumerState st = consumers.get(m.link());
        if (st != null) {
          st.capabilities = List.copyOf(caps.items());
        }
        request.response().respond(HttpReply.json(200, JsonObject.of(Map.of("items", capabilityJson(caps.items())))));
      }
      case HttpResult.Response r -> request.response().respond(Replies.error(502, "The provider answered HTTP " + r.status()));
      case HttpResult.Failed f -> request.response().respond(Replies.error(502, "The call failed: " + f.reason()));
      case HttpResult.TimedOut t -> request.response().respond(Replies.error(504, "The provider did not answer in time"));
    }
  }

  private static JsonArray capabilityJson(List<Soap.CapabilityItem> items) {
    return JsonArray.of(items.stream().map(i -> (JsonValue) JsonObject.of(Map.of(
        "kind", JsonString.of(i.kind()), "id", JsonString.of(i.id()), "name", JsonString.of(i.name()), "type", JsonString.of(i.type()))))
        .toArray(JsonValue[]::new));
  }

  // --- provider -----------------------------------------------------------------------------

  private void service(EndpointRequest request, WorkerContext<LinksMsg> ctx) {
    String link = request.pathParameter("link");
    ProviderState st = providers.get(link);
    if (st == null || !st.cfg.enabled()) {
      request.response().respond(HttpReply.status(404));
      return;
    }
    st.calls++;
    st.lastCaller = request.caller().address();
    st.lastCallAt = Instant.now();
    Bytes body = request.rawBody() == null ? Bytes.empty() : request.rawBody();
    Soap.Request req = Soap.readRequest(body, request.headers().first("Content-Type"));
    if (req.problem() != null) {
      faultAnswer(request, st, req.version(), true, req.problem());
      return;
    }
    List<LayerChoice> served = st.cfg.sourceLayers().stream().filter(c -> c.id() != null).toList();
    if (req.operation().equals("GetCapabilities")) {
      List<Map.Entry<String, String>> offered = served.stream()
          .map(c -> Map.entry(c.id().toString(), layers.containsKey(c.id()) ? layers.get(c.id()).content().name() : c.name())).toList();
      request.response().respond(HttpReply.of(200, Headers.of("Content-Type", Soap.mediaType(req.version())),
          Soap.capabilitiesResponse(req.version(), offered)));
      return;
    }
    List<String> chosen = req.selected().get("layers");
    ClassificationLimit limit = st.cfg.highest();
    boolean known = context.classifications().knows(limit);
    List<ComputeMsg.ExportLayer> out = new ArrayList<>();
    for (LayerChoice choice : served) {
      if (chosen != null && !chosen.contains(choice.id().toString())) {
        continue;
      }
      SourceCopy copy = sources.get(choice.id());
      List<MapObject> objects = new ArrayList<>();
      if (copy != null) {
        for (MapObject o : copy.objects.values()) {
          if (pass(st, o.content(), limit, known)) {
            objects.add(o);
          }
        }
      }
      String name = layers.containsKey(choice.id()) ? layers.get(choice.id()).content().name() : choice.name();
      out.add(new ComputeMsg.ExportLayer(choice.id(), name, objects));
    }
    if (chosen == null && !st.channelItems.isEmpty()) {
      List<MapObject> items = new ArrayList<>();
      Meta.Audit audit = new Meta.Audit(Instant.now(), Actor.plugin(context.pluginId()));
      st.channelItems.forEach((id, content) -> {
        if (pass(st, content, limit, known)) {
          items.add(new MapObject(id, 1, content, new Meta(audit, audit, null)));
        }
      });
      out.add(new ComputeMsg.ExportLayer(UUID.nameUUIDFromBytes(("nvg-channel:" + link).getBytes(StandardCharsets.UTF_8)), link, items));
    }
    UUID call = UUID.randomUUID();
    calls.put(call, new ProviderCall(request, link, req.version()));
    ctx.<ComputeMsg, ComputeMsg.Exported>ask(compute, replyTo -> new ComputeMsg.Export(out, context.defaultLabel(), context.classifications(),
        maxMegabytes * Limits.MIB, req.version(), replyTo), COMPUTE_TIMEOUT, reply -> new LinksMsg.Served(call, reply));
  }

  /**
   * Whether an object goes out on this link: not one that came in through it (ADR-0037 point 3), not
   * above its highest classification (point 8, counted).
   */
  private boolean pass(ProviderState st, MapObjectContent content, ClassificationLimit limit, boolean known) {
    if (content.dataSource().equals(st.cfg.name())) {
      return false;
    }
    if (!known || !context.classifications().within(content.label(), limit)) {
      count(st.counters, "above highest classification");
      return false;
    }
    return true;
  }

  private void served(LinksMsg.Served m) {
    ProviderCall call = calls.remove(m.call());
    if (call == null) {
      return;
    }
    ProviderState st = providers.get(call.link());
    switch (m.reply()) {
      case Reply.Ok<ComputeMsg.Exported> ok when ok.value().bytes() != null -> {
        if (st != null) {
          st.served += ok.value().items();
        }
        call.request().response().respond(HttpReply.of(200, Headers.of("Content-Type", Soap.mediaType(call.version())), ok.value().bytes()));
      }
      case Reply.Ok<ComputeMsg.Exported> ok -> faultAnswer(call.request(), st, call.version(), false, "document too large");
      case Reply.Failed<ComputeMsg.Exported> f -> faultAnswer(call.request(), st, call.version(), false, "the document could not be written");
      case Reply.TimedOut<ComputeMsg.Exported> t -> faultAnswer(call.request(), st, call.version(), false, "the document could not be written in time");
    }
  }

  private void faultAnswer(EndpointRequest request, @Nullable ProviderState st, String version, boolean client, String text) {
    if (st != null) {
      count(st.counters, "fault answered");
    }
    request.response().respond(HttpReply.of(500, Headers.of("Content-Type", Soap.mediaType(version)), Soap.fault(version, client, text)));
  }

  private void source(UUID layer, StoreUpdate update) {
    SourceCopy copy = sources.get(layer);
    if (copy == null) {
      return;
    }
    switch (update) {
      case StoreUpdate.Snapshot s -> {
        copy.objects.clear();
        s.layers().forEach(l -> layers.put(l.id(), l));
        for (MapObject o : s.objects()) {
          if (o.content().layerId().equals(layer)) {
            copy.objects.put(o.id(), o);
          }
        }
      }
      case StoreUpdate.Changes c -> {
        for (ChangeEvent e : c.events()) {
          if (e.entityType() == EntityType.LAYER) {
            if (e.operation() == Operation.DELETE) {
              layers.remove(e.entityId());
            } else if (e.state() instanceof Layer l) {
              layers.put(l.id(), l);
            }
          } else if (e.operation() == Operation.DELETE) {
            copy.objects.remove(e.entityId());
          } else if (e.state() instanceof MapObject o) {
            if (o.content().layerId().equals(layer)) {
              copy.objects.put(o.id(), o);
            } else {
              copy.objects.remove(o.id());
            }
          }
        }
      }
    }
  }

  private void channel(String link, ChannelItem item) {
    ProviderState st = providers.get(link);
    if (st == null || st.channel == null) {
      return;
    }
    switch (item) {
      case ChannelItem.Update u -> st.channelItems.put(u.id(), u.content());
      case ChannelItem.Removal r -> st.channelItems.remove(r.id());
      default -> count(st.counters, "skipped: not ground truth");
    }
  }

  // --- status -------------------------------------------------------------------------------

  /** The links and their state, for the NVG panel's admin section (NV1). */
  private JsonObject list() {
    List<JsonValue> out = new ArrayList<>();
    for (ConsumerState st : consumers.values()) {
      JsonObject.Builder b = JsonObject.builder()
          .put("name", JsonString.of(st.cfg.name()))
          .put("kind", JsonString.of("soap-consumer"))
          .put("enabled", JsonBoolean.of(st.cfg.enabled()))
          .put("ok", JsonBoolean.of(st.ok))
          .put("detail", JsonString.of(st.lastResult))
          .put("counters", Replies.counts(st.counters))
          .put("capabilities", capabilityJson(st.capabilities));
      if (st.layer != null && layers.containsKey(st.layer)) {
        b.put("layer", JsonString.of(layers.get(st.layer).content().name()));
      }
      out.add(b.build());
    }
    for (ProviderState st : providers.values()) {
      out.add(JsonObject.builder()
          .put("name", JsonString.of(st.cfg.name()))
          .put("kind", JsonString.of("soap-provider"))
          .put("enabled", JsonBoolean.of(st.cfg.enabled()))
          .put("ok", JsonBoolean.TRUE)
          .put("detail", JsonString.of(providerDetail(st)))
          .put("counters", Replies.counts(st.counters))
          .put("path", JsonString.of("/api/services/" + context.pluginId() + "/nvg/" + st.cfg.name()))
          .build());
    }
    links.bad().forEach((name, reason) -> out.add(JsonObject.builder()
        .put("name", JsonString.of(name))
        .put("kind", JsonString.of("bad"))
        .put("enabled", JsonBoolean.FALSE)
        .put("ok", JsonBoolean.FALSE)
        .put("detail", JsonString.of("bad settings: " + reason))
        .build()));
    return JsonObject.of(Map.of("links", JsonArray.of(out.toArray(JsonValue[]::new))));
  }

  private String providerDetail(ProviderState st) {
    if (!st.cfg.enabled()) {
      return "switched off";
    }
    if (!context.classifications().knows(st.cfg.highest())) {
      return "serves nothing: the highest classification " + st.cfg.highest().classification() + " is not in its policy's order";
    }
    if (st.calls == 0) {
      return "waiting for calls";
    }
    return st.calls + " calls answered, last from " + st.lastCaller + " at " + time(st.lastCallAt) + ", " + st.served + " items served";
  }

  private void refreshStatus() {
    if (consumers.isEmpty() && providers.isEmpty() && links.bad().isEmpty()) {
      setStatus(PluginState.OK, "no links");
      return;
    }
    boolean degraded = !links.bad().isEmpty();
    List<String> parts = new ArrayList<>();
    for (ConsumerState st : consumers.values()) {
      String next = st.cfg.enabled() && st.nextCall != null ? "; next " + time(st.nextCall) : "";
      parts.add(st.cfg.name() + ": " + st.lastResult + next);
      degraded |= st.cfg.enabled() && !st.ok;
    }
    for (ProviderState st : providers.values()) {
      parts.add(st.cfg.name() + ": " + providerDetail(st));
    }
    links.bad().forEach((name, reason) -> parts.add(name + ": bad settings: " + reason));
    String detail = String.join(" | ", parts);
    if (detail.length() > 512) {
      detail = detail.substring(0, 511) + "…";
    }
    setStatus(degraded ? PluginState.DEGRADED : PluginState.OK, detail);
  }

  private void setStatus(PluginState state, String detail) {
    String key = state + detail;
    if (!key.equals(lastStatus)) {
      lastStatus = key;
      context.status().set(state, detail);
    }
  }

  private static String time(@Nullable Instant at) {
    return at == null ? "-" : at.truncatedTo(ChronoUnit.SECONDS).toString();
  }

  private static void count(Map<String, Long> counters, String key) {
    counters.merge(key, 1L, Long::sum);
  }
}
