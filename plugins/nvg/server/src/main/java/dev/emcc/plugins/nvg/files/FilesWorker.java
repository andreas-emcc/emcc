package dev.emcc.plugins.nvg.files;

import dev.emcc.plugins.nvg.codec.Limits;
import dev.emcc.plugins.nvg.compute.ComputeMsg;
import dev.emcc.plugins.nvg.mapping.ItemMapper;
import dev.emcc.plugins.nvg.sync.SyncPlan;
import dev.emcc.plugins.nvg.sync.SyncRun;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.Workspace;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.http.Headers;
import dev.emcc.sdk.http.HttpReply;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.model.ExternalRef;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.store.ObjectQuery;
import dev.emcc.sdk.store.QueryResult;
import dev.emcc.sdk.worker.Handler;
import dev.emcc.sdk.worker.Reply;
import dev.emcc.sdk.worker.WorkerContext;
import dev.emcc.sdk.worker.WorkerRef;
import java.time.Duration;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * Imports NVG files into a layer and exports layers as NVG files (brief, section 4; ADR-0055 point
 * 3), for the NVG panel.
 *
 * <p><b>Import</b> ({@code POST /import}): the handler checks the user itself (ADR-0053 point 5):
 * the edit permission of the target layer's workspace, else 403; a locked layer, 409 (ADR-0042). It
 * answers 202 with a job at once (P1, owner NV2; kept 10 minutes after it ends, readable only by its user), then reads and plans the file on the compute worker
 * and writes its objects, {@link SyncRun#WINDOW} change requests at a time. The panel follows the job
 * with {@code GET /import/{job}}. The same file again updates its objects by {@code externalRef}
 * {@code (nvg-file:<name>, uri)}, wherever a user has moved them (owner, Q2 and RM A); it deletes
 * nothing (N3). An object of the file that now lies in a locked layer, or in a workspace the user may
 * not edit, is skipped and counted.
 *
 * <p><b>Export</b> ({@code GET /export?layer=...}): the view permission of each layer's workspace,
 * else 403; every object of the layers, one {@code g} per layer (owner, Q5).
 */
public final class FilesWorker implements Handler<FilesMsg> {

  /** The data source of imported objects (ADR-0055 point 3). */
  public static final String DATA_SOURCE = "nvg-file";

  /** The longest file name; with {@code nvg-file:} it stays within an external system's 256 characters. */
  static final int MAX_NAME = 200;

  /** How long an import is kept for {@code GET /import/{job}} after it ends (brief, section 4). */
  public static final Duration KEPT = Duration.ofMinutes(10);

  /** A cap on the imports kept, so that a flood of imports cannot fill the memory; ended ones go first. */
  static final int MAX_JOBS = 1_000;

  /** At most this many layers in one export. */
  static final int MAX_EXPORT_LAYERS = 64;

  private static final Duration QUERY_TIMEOUT = Duration.ofSeconds(30);
  private static final Duration COMPUTE_TIMEOUT = Duration.ofSeconds(60);

  private final PluginContext context;
  private final WorkerRef<ComputeMsg> compute;
  private final Map<UUID, Job> jobs = new LinkedHashMap<>();
  private final Map<UUID, ExportJob> exports = new HashMap<>();
  private @Nullable WorkerRef<FilesMsg> self;

  public FilesWorker(PluginContext context, WorkerRef<ComputeMsg> compute) {
    this.context = context;
    this.compute = compute;
  }

  /** One import. */
  private static final class Job {
    final UUID id;
    final String user;
    final String name;
    final UUID layer;
    final SecurityLabel fallback;
    @Nullable EndpointRequest request;
    @Nullable Bytes body;
    String state = "checking";
    @Nullable String reason;
    SyncPlan.@Nullable Plan plan;
    @Nullable SyncRun run;

    Job(UUID id, String user, String name, UUID layer, SecurityLabel fallback, EndpointRequest request, Bytes body) {
      this.id = id;
      this.user = user;
      this.name = name;
      this.layer = layer;
      this.fallback = fallback;
      this.request = request;
      this.body = body;
    }

    boolean finished() {
      return state.equals("done") || state.equals("refused") || state.equals("failed");
    }
  }

  /** One export, waiting for its layers' queries. */
  private static final class ExportJob {
    final EndpointRequest request;
    final List<UUID> layers;
    final QueryResult[] results;
    int answered;

    ExportJob(EndpointRequest request, List<UUID> layers) {
      this.request = request;
      this.layers = layers;
      this.results = new QueryResult[layers.size()];
    }
  }

  @Override
  public void handle(FilesMsg message, WorkerContext<FilesMsg> ctx) {
    self = ctx.self();
    switch (message) {
      case FilesMsg.Import m -> startImport(m.request(), ctx);
      case FilesMsg.ImportQueried m -> importQueried(m, ctx);
      case FilesMsg.ImportPrepared m -> importPrepared(m, ctx);
      case FilesMsg.Synced m -> synced(m.outcome(), ctx);
      case FilesMsg.ImportState m -> importState(m.request());
      case FilesMsg.Export m -> startExport(m.request(), ctx);
      case FilesMsg.ExportQueried m -> exportQueried(m, ctx);
      case FilesMsg.Exported m -> exported(m);
      case FilesMsg.Expire m -> {
        Job job = jobs.get(m.job());
        if (job != null && job.finished()) {
          jobs.remove(m.job());
        }
      }
    }
  }

  // --- import -------------------------------------------------------------------------------

  private void startImport(EndpointRequest request, WorkerContext<FilesMsg> ctx) {
    UUID layer = uuid(request.queryParameter("layer"));
    if (layer == null) {
      request.response().respond(Replies.error(400, "Name the target layer (layer=<id>)"));
      return;
    }
    String name = fileName(request.queryParameter("name"));
    if (name == null) {
      request.response().respond(Replies.error(400, "Name the file (name=<file name>, 1 to " + MAX_NAME + " characters)"));
      return;
    }
    SecurityLabel fallback = context.defaultLabel();
    String policy = request.queryParameter("policy");
    String classification = request.queryParameter("classification");
    if (policy != null || classification != null) {
      if (policy == null || classification == null || classification.isEmpty() || classification.length() > 64
          || !context.classifications().order(policy).contains(classification)) {
        request.response().respond(Replies.error(400, "The label for items without one is not a known policy and classification"));
        return;
      }
      fallback = SecurityLabel.of(policy, classification);
    }
    Bytes body = request.rawBody();
    if (body == null) {
      request.response().respond(Replies.error(415, "Send the file as application/xml"));
      return;
    }
    Job job = new Job(UUID.randomUUID(), request.user().id(), name, layer, fallback, request, body);
    remember(job);
    context.store().query(ObjectQuery.byExternalSystem(system(name)).limit(ObjectQuery.MAX_LIMIT), QUERY_TIMEOUT, ctx.self(),
        result -> new FilesMsg.ImportQueried(job.id, result));
  }

  private void importQueried(FilesMsg.ImportQueried m, WorkerContext<FilesMsg> ctx) {
    Job job = jobs.get(m.job());
    if (job == null || job.request == null || job.body == null) {
      return;
    }
    EndpointRequest request = job.request;
    job.request = null;
    if (!(m.result() instanceof QueryResult.Found found)) {
      fail(job, "the object store did not answer");
      request.response().respond(Replies.error(503, "The object store did not answer; try again"));
      return;
    }
    Map<UUID, Layer> layers = new HashMap<>();
    found.layers().forEach(l -> layers.put(l.id(), l));
    Layer target = layers.get(job.layer);
    Workspace workspace = target == null ? null : Replies.workspace(context.workspaces(), target);
    if (target == null || workspace == null) {
      fail(job, "no such layer");
      request.response().respond(Replies.error(404, "No such layer"));
      return;
    }
    if (!Replies.mayEdit(request.user(), workspace)) {
      fail(job, "You may not edit this layer");
      request.response().respond(Replies.error(403, "You may not edit this layer"));
      return;
    }
    if (target.content().isLocked()) {
      fail(job, "The layer is locked");
      request.response().respond(Replies.error(409, "The layer is locked"));
      return;
    }
    // Objects of the file a user moved elsewhere are updated there, unless that layer is locked or
    // in a workspace this user may not edit (the plugin's own writes carry no user).
    Map<String, String> blocked = new HashMap<>();
    List<MapObject> stored = new ArrayList<>();
    for (MapObject o : found.objects()) {
      ExternalRef ref = o.meta().externalRef();
      if (ref == null) {
        continue;
      }
      Layer in = layers.get(o.content().layerId());
      Workspace ws = in == null ? null : Replies.workspace(context.workspaces(), in);
      if (in != null && in.content().isLocked()) {
        blocked.put(ref.id(), "skipped: layer locked");
      } else if (ws == null || !Replies.mayEdit(request.user(), ws)) {
        blocked.put(ref.id(), "skipped: no edit right");
      }
      stored.add(o);
    }
    job.state = "reading";
    request.response().respond(HttpReply.json(202, state(job)));
    ItemMapper.Context mapping = new ItemMapper.Context(DATA_SOURCE, job.layer, job.fallback, context.classifications());
    Bytes body = job.body;
    job.body = null;
    ctx.<ComputeMsg, ComputeMsg.Prepared>ask(compute, replyTo -> new ComputeMsg.Prepare(body, limits(), system(job.name), stored, blocked, mapping, false, false, false, replyTo),
        COMPUTE_TIMEOUT, reply -> new FilesMsg.ImportPrepared(job.id, reply));
  }

  private void importPrepared(FilesMsg.ImportPrepared m, WorkerContext<FilesMsg> ctx) {
    Job job = jobs.get(m.job());
    if (job == null || job.finished()) {
      return;
    }
    switch (m.reply()) {
      case Reply.Ok<ComputeMsg.Prepared> ok -> {
        ComputeMsg.Prepared p = ok.value();
        if (p.plan() == null) {
          job.state = "refused";
          job.reason = p.reason();
          ended(job);
          ctx.log().info("import of {} refused: {}", job.name, p.counter());
          return;
        }
        job.plan = p.plan();
        job.run = new SyncRun(job.id, p.plan().changes());
        job.state = "writing";
        pump(job, ctx);
      }
      case Reply.Failed<ComputeMsg.Prepared> f -> fail(job, "the file could not be read: " + f.reason());
      case Reply.TimedOut<ComputeMsg.Prepared> t -> fail(job, "the file could not be read in time");
    }
  }

  private void synced(SyncRun.Outcome outcome, WorkerContext<FilesMsg> ctx) {
    Job job = jobs.get(outcome.run());
    if (job == null || job.run == null || job.finished()) {
      return;
    }
    job.run.handle(outcome);
    pump(job, ctx);
  }

  private void pump(Job job, WorkerContext<FilesMsg> ctx) {
    SyncRun run = job.run;
    if (run == null) {
      return;
    }
    run.pump(context.store(), ctx.self(), FilesMsg.Synced::new);
    if (run.done()) {
      job.state = "done";
      ended(job);
      SyncRun.Result r = run.result();
      ctx.log().info("imported {}: {} created, {} updated, {} not applied", job.name, r.created(), r.updated(), r.failed().values().stream().mapToLong(Long::longValue).sum());
    }
  }

  private void importState(EndpointRequest request) {
    UUID id = uuid(request.pathParameter("job"));
    Job job = id == null ? null : jobs.get(id);
    if (job == null || !job.user.equals(request.user().id())) {
      request.response().respond(Replies.error(404, "No such import"));
      return;
    }
    request.response().respond(HttpReply.json(200, state(job)));
  }

  /** An import's state: {@code checking}, {@code reading}, {@code writing}, {@code done}, {@code refused} or {@code failed}, with its counts. */
  private static JsonObject state(Job job) {
    JsonObject.Builder b = JsonObject.builder()
        .put("job", JsonString.of(job.id.toString()))
        .put("name", JsonString.of(job.name))
        .put("state", JsonString.of(job.state));
    if (job.reason != null) {
      b.put("reason", JsonString.of(job.reason));
    }
    SyncPlan.Plan plan = job.plan;
    if (plan != null) {
      b.put("items", JsonNumber.of(plan.items()));
      b.put("unchanged", JsonNumber.of(plan.unchanged()));
      b.put("skipped", Replies.counts(plan.skipped()));
      b.put("notes", Replies.counts(plan.notes()));
    }
    SyncRun run = job.run;
    if (run != null) {
      SyncRun.Result r = run.result();
      b.put("created", JsonNumber.of(r.created()));
      b.put("updated", JsonNumber.of(r.updated()));
      b.put("failed", Replies.counts(r.failed()));
      if (r.problem() != null) {
        b.put("problem", JsonString.of(r.problem()));
      }
    }
    return b.build();
  }

  private void fail(Job job, String reason) {
    job.state = "failed";
    job.reason = reason;
    job.body = null;
    ended(job);
  }

  /** An ended import is kept for {@link #KEPT}, then forgotten: an unknown or expired job answers 404. */
  private void ended(Job job) {
    if (self != null) {
      context.timers().once(KEPT, self, new FilesMsg.Expire(job.id));
    }
  }

  private void remember(Job job) {
    jobs.put(job.id, job);
    Iterator<Job> oldest = jobs.values().iterator();
    while (jobs.size() > MAX_JOBS && oldest.hasNext()) {
      if (oldest.next().finished()) {
        oldest.remove();
      }
    }
  }

  // --- export -------------------------------------------------------------------------------

  private void startExport(EndpointRequest request, WorkerContext<FilesMsg> ctx) {
    List<String> values = request.query().getOrDefault("layer", List.of());
    if (values.isEmpty() || values.size() > MAX_EXPORT_LAYERS) {
      request.response().respond(Replies.error(400, "Name 1 to " + MAX_EXPORT_LAYERS + " layers (layer=<id>)"));
      return;
    }
    List<UUID> layers = new ArrayList<>();
    for (String v : values) {
      UUID id = uuid(v);
      if (id == null) {
        request.response().respond(Replies.error(400, "Not a layer id: " + v));
        return;
      }
      if (!layers.contains(id)) {
        layers.add(id);
      }
    }
    UUID export = UUID.randomUUID();
    exports.put(export, new ExportJob(request, layers));
    for (int i = 0; i < layers.size(); i++) {
      int index = i;
      context.store().query(ObjectQuery.all().inLayer(layers.get(i)).limit(ObjectQuery.MAX_LIMIT), QUERY_TIMEOUT, ctx.self(),
          result -> new FilesMsg.ExportQueried(export, index, result));
    }
  }

  private void exportQueried(FilesMsg.ExportQueried m, WorkerContext<FilesMsg> ctx) {
    ExportJob job = exports.get(m.export());
    if (job == null || m.index() < 0 || m.index() >= job.results.length || job.results[m.index()] != null) {
      return;
    }
    job.results[m.index()] = m.result();
    job.answered++;
    if (job.answered < job.results.length) {
      return;
    }
    EndpointRequest request = job.request;
    List<ComputeMsg.ExportLayer> layers = new ArrayList<>();
    for (int i = 0; i < job.layers.size(); i++) {
      if (!(job.results[i] instanceof QueryResult.Found found)) {
        exports.remove(m.export());
        request.response().respond(job.results[i] instanceof QueryResult.Failed f && f.reason().contains("limit")
            ? Replies.error(422, "A layer has more objects than an export takes (" + ObjectQuery.MAX_LIMIT + ")")
            : Replies.error(503, "The object store did not answer; try again"));
        return;
      }
      UUID id = job.layers.get(i);
      Layer layer = found.layers().stream().filter(l -> l.id().equals(id)).findFirst().orElse(null);
      Workspace workspace = layer == null ? null : Replies.workspace(context.workspaces(), layer);
      if (layer == null || workspace == null) {
        exports.remove(m.export());
        request.response().respond(Replies.error(404, "No such layer"));
        return;
      }
      if (!Replies.maySee(request.user(), workspace)) {
        exports.remove(m.export());
        request.response().respond(Replies.error(403, "You may not see this layer"));
        return;
      }
      layers.add(new ComputeMsg.ExportLayer(id, layer.content().name(), found.objects()));
    }
    ctx.<ComputeMsg, ComputeMsg.Exported>ask(compute, replyTo -> new ComputeMsg.Export(layers, context.defaultLabel(), context.classifications(), limits().maxBytes(), null, replyTo),
        COMPUTE_TIMEOUT, reply -> new FilesMsg.Exported(m.export(), reply));
  }

  private void exported(FilesMsg.Exported m) {
    ExportJob job = exports.remove(m.export());
    if (job == null) {
      return;
    }
    switch (m.reply()) {
      case Reply.Ok<ComputeMsg.Exported> ok when ok.value().bytes() != null -> {
        String first = ((QueryResult.Found) job.results[0]).layers().stream().filter(l -> l.id().equals(job.layers.getFirst()))
            .findFirst().map(l -> l.content().name()).orElse("layer");
        String file = safeFileName(first) + ".nvg";
        Headers headers = Headers.of("Content-Type", "application/xml; charset=utf-8")
            .with("Content-Disposition", "attachment; filename=\"" + file.replaceAll("[^\\x20-\\x7E]", "_") + "\"; filename*=UTF-8''"
                + java.net.URLEncoder.encode(file, java.nio.charset.StandardCharsets.UTF_8).replace("+", "%20"));
        job.request.response().respond(HttpReply.of(200, headers, ok.value().bytes()));
      }
      case Reply.Ok<ComputeMsg.Exported> ok -> job.request.response().respond(Replies.error(422, "The export is too large: " + ok.value().problem()));
      case Reply.Failed<ComputeMsg.Exported> f -> job.request.response().respond(Replies.error(500, "The export failed: " + f.reason()));
      case Reply.TimedOut<ComputeMsg.Exported> t -> job.request.response().respond(Replies.error(503, "The export took too long; try again"));
    }
  }

  // --- shared -------------------------------------------------------------------------------

  /** The external system of a file's objects (ADR-0055 point 3). */
  public static String system(String fileName) {
    return DATA_SOURCE + ":" + fileName;
  }

  private Limits limits() {
    int megabytes = 16;
    if (context.settings().get("maxDocumentMegabytes") instanceof JsonNumber n) {
      megabytes = Math.max(1, Math.min(16, n.bigDecimalValue().intValue()));
    }
    return Limits.DEFAULT.withMegabytes(megabytes);
  }

  /** The file's own name: the last part of a path, stripped, 1 to {@link #MAX_NAME} characters without control characters. */
  static @Nullable String fileName(@Nullable String value) {
    if (value == null) {
      return null;
    }
    String name = value.substring(Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\')) + 1).strip();
    if (name.isEmpty() || name.length() > MAX_NAME || name.chars().anyMatch(Character::isISOControl)) {
      return null;
    }
    return name;
  }

  /** A layer's name as a file name: characters that file systems or the header refuse become {@code _}. */
  static String safeFileName(String name) {
    String safe = name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").strip();
    if (safe.length() > 100) {
      safe = safe.substring(0, 100);
    }
    return safe.isEmpty() ? "layer" : safe;
  }

  private static @Nullable UUID uuid(@Nullable String value) {
    if (value == null) {
      return null;
    }
    try {
      return UUID.fromString(value);
    } catch (IllegalArgumentException e) {
      return null;
    }
  }
}
