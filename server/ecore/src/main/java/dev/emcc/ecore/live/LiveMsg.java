package dev.emcc.ecore.live;

import dev.emcc.ecore.geo.GeoArea;
import dev.emcc.ecore.runtime.Answer;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.store.ChangeOutcome;
import dev.emcc.ecore.store.AreaSnapshot;
import dev.emcc.ecore.store.FoundObjects;
import dev.emcc.ecore.store.LayerPage;
import dev.emcc.ecore.store.StoreChange;
import dev.emcc.sdk.model.ChangeEvent;
import dev.emcc.sdk.model.ChangeRequest;
import java.util.List;
import java.util.function.Supplier;
import org.jspecify.annotations.Nullable;

/** Messages of the gateway's workers. */
final class LiveMsg {

  private LiveMsg() {}

  /** Messages of the hub, which batches change events for all sessions. */
  sealed interface Hub {
    record Changed(StoreChange change) implements Hub {}

    /** A new session; its writer gets the welcome notices once the session is registered. */
    record Register(WorkerHandle<Session> session, WorkerHandle<Writer> writer, String user) implements Hub {}

    record Unregister(WorkerHandle<Session> session) implements Hub {}

    /** A message for every registered browser, made when the hub sends it (so it is current then). */
    record Broadcast(Supplier<String> message) implements Hub {}

    /** A message for every registered browser of one user (their {@code source.user} id), e.g. {@code display}. */
    record ToUser(String user, String message) implements Hub {}

    enum Tick implements Hub { TICK }
  }

  /** Messages of a session worker. */
  sealed interface Session {
    /** A text message from the browser. */
    record Inbound(String text) implements Session {}

    /** Changes in sequence order, from the hub, each with the object before it and its bounds. */
    record Batch(List<StoreChange> changes) implements Session {
      public Batch {
        changes = List.copyOf(changes);
      }
    }

    /** Events were lost on the way to this session: send a fresh snapshot. */
    enum Resync implements Session { RESYNC }

    /** A subscription's minimum interval since its last snapshot has passed: a waiting snapshot may be taken now. */
    record SnapshotDue(String subscription, long token) implements Session {}

    /** A subscription's minimum interval since its last area query has passed: a waiting move may be asked for now. */
    record MoveDue(String subscription, long token) implements Session {}

    /** The writer has sent a part of snapshot {@code generation}: the next part may go (flow control). */
    record PartSent(long generation) implements Session {}

    /** Time to ping the browser (F6). */
    enum KeepAlive implements Session { KEEP_ALIVE }

    /** The object store's answer for a subscription's snapshot; {@code token} tells a later subscription of the same id apart. */
    record Snapshotted(String subscription, long token, Answer<AreaSnapshot> answer) implements Session {}

    /** The object store's answer for a subscription's new area. */
    record Moved(String subscription, long token, long ask, GeoArea area, double resolution, Answer<AreaSnapshot> answer)
        implements Session {}

    /** The fill worker's view for a subscription's snapshot {@code start} (rule C7). */
    record SnapshotFilled(String subscription, long token, AreaSnapshot start, Answer<AreaView.Filled> answer) implements Session {}

    /** The fill worker's view for a subscription's new area, from the object store's {@code answer} (rule C7). */
    record MoveFilled(String subscription, long token, long ask, GeoArea area, double resolution, AreaSnapshot answer,
        Answer<AreaView.Filled> filled) implements Session {}

    record Outcome(ChangeRequest request, Answer<ChangeOutcome> answer) implements Session {}

    /** The object store's answer for a browser's {@code get-objects}. */
    record Found(String queryId, Answer<FoundObjects> answer) implements Session {}

    /** The object store's answer for a browser's {@code query-layer}. */
    record Paged(String queryId, Answer<LayerPage> answer) implements Session {}
  }

  /** Messages of a session's writer, the only one that touches the socket. */
  sealed interface Writer {
    /** A message for the browser; {@code afterSent}, if any, runs once it has been sent. */
    record Text(String text, @Nullable Runnable afterSent) implements Writer {
      Text(String text) {
        this(text, null);
      }
    }

    record Close(int status, String reason) implements Writer {}

    /** A WebSocket ping; the browser answers it by itself (F6). */
    enum Ping implements Writer { PING }
  }
}
