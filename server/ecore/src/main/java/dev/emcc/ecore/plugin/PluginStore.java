package dev.emcc.ecore.plugin;

import dev.emcc.ecore.geo.GeoArea;
import dev.emcc.ecore.runtime.Answer;
import dev.emcc.ecore.runtime.Owner;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.ecore.store.PictureSnapshot;
import dev.emcc.ecore.store.Requester;
import dev.emcc.ecore.store.StoreMsg;
import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.store.Area;
import dev.emcc.sdk.store.Change;
import dev.emcc.sdk.store.ChangeOutcome;
import dev.emcc.sdk.store.ObjectQuery;
import dev.emcc.sdk.store.QueryResult;
import dev.emcc.sdk.store.Store;
import dev.emcc.sdk.store.StoreUpdate;
import dev.emcc.sdk.worker.WorkerRef;
import java.time.Duration;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.function.Predicate;
import org.jspecify.annotations.Nullable;

/**
 * One plugin's access to the object store (SDK v1, "Object access"; CR-0010 point 10). {@code
 * submit} and {@code query} are asks on the plugin's behalf: they count under its cap of
 * outstanding asks (CR-0005) and end exactly once, always delivered. {@code subscribe} goes through
 * the {@link StoreFeed}.
 */
final class PluginStore implements Store {

  private final String pluginId;
  private final Owner owner;
  private final WorkerRuntime runtime;
  private final WorkerHandle<StoreMsg> objectStore;
  private final StoreFeed feed;

  PluginStore(String pluginId, Owner owner, WorkerRuntime runtime, WorkerHandle<StoreMsg> objectStore, StoreFeed feed) {
    this.pluginId = pluginId;
    this.owner = owner;
    this.runtime = runtime;
    this.objectStore = objectStore;
    this.feed = feed;
  }

  @Override
  public <M extends Message> void submit(
      Change change, Duration timeout, WorkerRef<M> target, Function<ChangeOutcome, ? extends M> toMessage) {
    Objects.requireNonNull(change, "change");
    Objects.requireNonNull(toMessage, "toMessage");
    // ECore fills in the request id and source.plugin; source.system is the plugin's bySystem. A server
    // part acts as the plugin, not for a user: not checked (overview 4.4). Whether it is saved travels
    // beside the request, not in it (ADR-0041). Any plugin's mark is passed on: who may use it (point 7)
    // is for the briefs and the reviews, not checked here (owner, 2026-10-26).
    runtime.<StoreMsg, dev.emcc.ecore.store.ChangeOutcome, M>askFor(owner, objectStore,
        replyTo -> new StoreMsg.Apply(change.toRequest(UUID.randomUUID(), pluginId), Requester.NO_USER, !change.saved(), replyTo), timeout,
        PluginWorkers.handleOf(target), answer -> toMessage.apply(outcome(answer, timeout)));
  }

  @Override
  public <M extends Message> void query(
      ObjectQuery query, Duration timeout, WorkerRef<M> target, Function<QueryResult, ? extends M> toMessage) {
    Objects.requireNonNull(query, "query");
    Objects.requireNonNull(toMessage, "toMessage");
    runtime.<StoreMsg, PictureSnapshot, M>askFor(owner, objectStore,
        replyTo -> new StoreMsg.Find(query.within() == null ? null : area(query.within()), query::matchesAttributes, query.limit(),
            workspaces(query), replyTo),
        timeout,
        PluginWorkers.handleOf(target), answer -> toMessage.apply(result(answer)));
  }

  @Override
  public <M extends Message> Cancellable subscribe(ObjectQuery query, WorkerRef<M> target, Function<StoreUpdate, ? extends M> toMessage) {
    Objects.requireNonNull(query, "query");
    Objects.requireNonNull(toMessage, "toMessage");
    return feed.subscribe(pluginId, filter(query), workspaces(query), PluginWorkers.handleOf(target), toMessage);
  }

  /** The workspaces a query names (SDK 1.2.0, ADR-0039); {@code null} when it names none: every one (N9). */
  static @Nullable Set<String> workspaces(ObjectQuery query) {
    return query.workspaces().isEmpty() ? null : query.workspaces();
  }

  /** What a query selects: its attributes, and its area if it has one. Runs in the store's worker. */
  static Predicate<MapObject> filter(ObjectQuery query) {
    Area within = query.within();
    if (within == null) {
      return query::matchesAttributes;
    }
    GeoArea area = area(within);
    return o -> query.matchesAttributes(o) && area.matches(o.content().geometry());
  }

  /** The SDK's area as ECore's geometry. */
  static GeoArea area(Area area) {
    return switch (area.margin()) {
      case Area.Margin.None none -> new GeoArea(area.ring(), area.inside(), 0, 0);
      case Area.Margin.Metres metres -> new GeoArea(area.ring(), area.inside(), metres.value(), 0);
      case Area.Margin.Share share -> new GeoArea(area.ring(), area.inside(), 0, share.value());
    };
  }

  private static ChangeOutcome outcome(Answer<dev.emcc.ecore.store.ChangeOutcome> answer, Duration timeout) {
    return switch (answer) {
      case Answer.Ok<dev.emcc.ecore.store.ChangeOutcome> ok -> switch (ok.value()) {
        case dev.emcc.ecore.store.ChangeOutcome.Applied applied -> new ChangeOutcome.Applied(applied.event());
        case dev.emcc.ecore.store.ChangeOutcome.Rejected rejected -> new ChangeOutcome.Rejected(rejected.rejection());
      };
      case Answer.Failed<dev.emcc.ecore.store.ChangeOutcome> failed -> new ChangeOutcome.Unknown(failed.reason());
      case Answer.TimedOut<dev.emcc.ecore.store.ChangeOutcome> timedOut ->
          new ChangeOutcome.Unknown("no answer within " + timeout.toMillis() + " ms");
    };
  }

  private static QueryResult result(Answer<PictureSnapshot> answer) {
    return switch (answer) {
      case Answer.Ok<PictureSnapshot> ok -> new QueryResult.Found(ok.value().objects(), ok.value().layers(), ok.value().sequenceNo());
      case Answer.Failed<PictureSnapshot> failed -> new QueryResult.Failed(failed.reason());
      case Answer.TimedOut<PictureSnapshot> timedOut -> new QueryResult.TimedOut();
    };
  }
}
