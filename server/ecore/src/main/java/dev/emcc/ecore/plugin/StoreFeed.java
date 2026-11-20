package dev.emcc.ecore.plugin;

import dev.emcc.ecore.runtime.Answer;
import dev.emcc.ecore.runtime.HandlerContext;
import dev.emcc.ecore.runtime.MessageHandler;
import dev.emcc.ecore.runtime.Overflow;
import dev.emcc.ecore.runtime.Owner;
import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerOptions;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.ecore.store.ObjectStore;
import dev.emcc.ecore.store.PictureSnapshot;
import dev.emcc.ecore.store.StoreMsg;
import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.model.ChangeEvent;
import dev.emcc.sdk.model.EntityType;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.store.Store;
import dev.emcc.sdk.store.StoreUpdate;
import java.time.Duration;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.function.Predicate;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The plugins' store subscriptions (SDK v1 {@code Store.subscribe}): one ECore worker follows
 * {@code objects.changed} for all of them.
 *
 * <ul>
 *   <li>A subscription starts with a snapshot of the matching objects and all layers, asked of the
 *       object store; events that come meanwhile wait, and those the snapshot holds are skipped.
 *   <li>Then every event that touches a matching object, before or after the change, or any layer.
 *       SDK 1.2.0 (ADR-0039): only of the workspaces its query names, all when it names none.
 *       "Before" is exact: the feed keeps the ids the subscriber holds, so an object that stops
 *       matching (moved, deleted) is reported too.
 *   <li>Each subscription has at most one message waiting in the subscriber's mailbox, always
 *       delivered. When it is handled, it takes what has queued up meanwhile: a snapshot, or one
 *       {@code Changes} batch in sequence order.
 *   <li><b>Bound:</b> with more than {@link Store#MAX_PENDING_UPDATES} events queued, new ones are
 *       dropped and a new snapshot is asked for, which replaces the queue. A gap in the sequence
 *       numbers the feed itself sees (its mailbox overflowed) does the same for every subscription.
 * </ul>
 *
 * <p>The feed's state belongs to its worker (rule C2). The queue between the feed and a subscriber
 * is guarded by the subscription's own monitor, a leaf lock (rule C4): only collection operations
 * run under it.
 */
final class StoreFeed {

  /** The owner of the feed's worker. */
  static final String OWNER = "core-store-feed";

  private static final Logger LOG = LoggerFactory.getLogger(StoreFeed.class);
  private static final Duration SNAPSHOT_TIMEOUT = Duration.ofSeconds(30);
  private static final Duration RETRY = Duration.ofSeconds(1);
  /** Events kept while a snapshot is on its way; beyond this the snapshot is asked for again. */
  private static final int MAX_BUFFERED = 10_000;

  private final WorkerRuntime runtime;
  private final WorkerHandle<FeedMsg> worker;

  private sealed interface FeedMsg {
    /** A change, with the workspace it is in. */
    record Event(ChangeEvent event, String workspace) implements FeedMsg {}

    record Open(Subscription<?> subscription) implements FeedMsg {}

    record ClosePlugin(String pluginId) implements FeedMsg {}

    record Snapshot(Subscription<?> subscription, int attempt, Answer<PictureSnapshot> answer) implements FeedMsg {}

    record Retry(Subscription<?> subscription, int attempt) implements FeedMsg {}
  }

  StoreFeed(WorkerRuntime runtime, WorkerHandle<StoreMsg> objectStore) {
    this.runtime = runtime;
    Owner owner = runtime.owner(OWNER);
    this.worker = owner.spawn(WorkerOptions.<FeedMsg>of("feed", () -> new Relay(owner, objectStore))
        .mailbox(100_000, Overflow.DROP_NEWEST));
    owner.subscribe(ObjectStore.CHANGES, worker, c -> new FeedMsg.Event(c.event(), c.workspace()));
  }

  /** {@code Store.subscribe} in every workspace. */
  <M> Cancellable subscribe(String pluginId, Predicate<MapObject> filter, WorkerHandle<M> target,
      Function<StoreUpdate, ? extends M> toMessage) {
    return subscribe(pluginId, filter, null, target, toMessage);
  }

  /**
   * {@code Store.subscribe}: {@code toMessage} is plugin code and runs in the target's worker.
   *
   * @param workspaces the workspaces whose layers and objects it gets; {@code null} for every one
   */
  <M> Cancellable subscribe(String pluginId, Predicate<MapObject> filter, @Nullable Set<String> workspaces, WorkerHandle<M> target,
      Function<StoreUpdate, ? extends M> toMessage) {
    Subscription<M> subscription = new Subscription<>(pluginId, filter, workspaces, target, toMessage);
    if (!runtime.deliverAlways(worker, () -> new FeedMsg.Open(subscription))) {
      throw new IllegalStateException("the store feed has stopped");
    }
    return subscription::cancel;
  }

  /** When a plugin stops: its subscriptions end. */
  void closeAll(String pluginId) {
    runtime.deliverAlways(worker, () -> new FeedMsg.ClosePlugin(pluginId));
  }

  /** The feed's worker: follows the change events and serves every subscription. */
  private final class Relay implements MessageHandler<FeedMsg> {
    private final Owner owner;
    private final WorkerHandle<StoreMsg> objectStore;
    private final List<Subscription<?>> active = new ArrayList<>();
    private long lastSequenceNo = -1;

    Relay(Owner owner, WorkerHandle<StoreMsg> objectStore) {
      this.owner = owner;
      this.objectStore = objectStore;
    }

    @Override
    public void handle(FeedMsg message, HandlerContext<FeedMsg> ctx) {
      switch (message) {
        case FeedMsg.Event e -> event(e, ctx);
        case FeedMsg.Open open -> {
          active.add(open.subscription());
          askSnapshot(open.subscription(), ctx);
        }
        case FeedMsg.ClosePlugin close -> active.removeIf(a -> {
          if (a.pluginId.equals(close.pluginId())) {
            a.cancel();
          }
          return a.cancelled;
        });
        case FeedMsg.Snapshot s -> snapshot(s.subscription(), s.attempt(), s.answer(), ctx);
        case FeedMsg.Retry r -> {
          if (r.subscription().awaiting && r.attempt() == r.subscription().attempt && active.contains(r.subscription())) {
            askSnapshot(r.subscription(), ctx);
          }
        }
      }
    }

    private void event(FeedMsg.Event change, HandlerContext<FeedMsg> ctx) {
      ChangeEvent event = change.event();
      boolean gap = lastSequenceNo >= 0 && event.sequenceNo() != lastSequenceNo + 1;
      lastSequenceNo = event.sequenceNo();
      active.removeIf(s -> s.cancelled);
      if (gap) {
        LOG.warn("The store feed missed change events before {}; new snapshots for its subscriptions", event.sequenceNo());
      }
      for (Subscription<?> s : active) {
        if (gap && !s.awaiting) {
          askSnapshot(s, ctx);
        }
        if (s.awaiting) {
          s.buffered.add(change);
          if (s.buffered.size() > MAX_BUFFERED) {
            askSnapshot(s, ctx); // the one on its way would be followed by too much: ask again
          }
        } else if (route(s, change)) {
          askSnapshot(s, ctx);
        }
      }
    }

    /** Offers the event if it concerns the subscription; returns true if the subscription overflowed. */
    private boolean route(Subscription<?> s, FeedMsg.Event change) {
      ChangeEvent event = change.event();
      if (event.sequenceNo() <= s.snapshotSequenceNo) {
        return false; // the snapshot holds it
      }
      if (s.workspaces != null && !s.workspaces.contains(change.workspace())) {
        return false; // another workspace's: an entity never changes its workspace (R1, R2)
      }
      boolean relevant;
      if (event.entityType() == EntityType.LAYER) {
        relevant = true;
      } else {
        boolean held = s.held.contains(event.entityId());
        boolean matches = event.state() instanceof MapObject o && s.filter.test(o);
        if (matches) {
          s.held.add(event.entityId());
        } else {
          s.held.remove(event.entityId());
        }
        relevant = held || matches;
      }
      return relevant && !s.offer(event);
    }

    private void askSnapshot(Subscription<?> s, HandlerContext<FeedMsg> ctx) {
      s.awaiting = true;
      s.buffered.clear();
      int attempt = ++s.attempt;
      ctx.<StoreMsg, PictureSnapshot>ask(objectStore, replyTo -> new StoreMsg.Find(null, s.filter, Integer.MAX_VALUE - 1, s.workspaces, replyTo),
          SNAPSHOT_TIMEOUT,
          answer -> new FeedMsg.Snapshot(s, attempt, answer));
    }

    private void snapshot(Subscription<?> s, int attempt, Answer<PictureSnapshot> answer, HandlerContext<FeedMsg> ctx) {
      if (attempt != s.attempt || !active.contains(s)) {
        return; // a later snapshot was asked for, or the subscription ended
      }
      if (!(answer instanceof Answer.Ok<PictureSnapshot> ok)) {
        LOG.warn("A store subscription of plugin {} got no snapshot ({}); trying again", s.pluginId, answer);
        owner.once(RETRY, ctx.self(), new FeedMsg.Retry(s, attempt));
        return;
      }
      PictureSnapshot picture = ok.value();
      s.held.clear();
      picture.objects().forEach(o -> s.held.add(o.id()));
      s.snapshotSequenceNo = picture.sequenceNo();
      s.awaiting = false;
      List<FeedMsg.Event> later = new ArrayList<>(s.buffered);
      s.buffered.clear();
      s.replaceWith(picture);
      for (FeedMsg.Event e : later) {
        if (route(s, e)) {
          askSnapshot(s, ctx);
          return;
        }
      }
    }
  }

  /** One subscription. The fields above the queue belong to the feed's worker. */
  private final class Subscription<M> {
    final String pluginId;
    final Predicate<MapObject> filter;
    final @Nullable Set<String> workspaces;
    final WorkerHandle<M> target;
    final Function<StoreUpdate, ? extends M> toMessage;
    volatile boolean cancelled;

    // The feed's worker only.
    final Set<UUID> held = new HashSet<>();
    final List<FeedMsg.Event> buffered = new ArrayList<>();
    boolean awaiting;
    int attempt;
    long snapshotSequenceNo = -1;

    // Guarded by this: the queue to the subscriber.
    private final ArrayDeque<Object> queue = new ArrayDeque<>(); // PictureSnapshot or ChangeEvent
    private int queuedEvents;
    private boolean waiting;

    Subscription(String pluginId, Predicate<MapObject> filter, @Nullable Set<String> workspaces, WorkerHandle<M> target,
        Function<StoreUpdate, ? extends M> toMessage) {
      this.pluginId = pluginId;
      this.filter = filter;
      this.workspaces = workspaces == null ? null : Set.copyOf(workspaces);
      this.target = target;
      this.toMessage = toMessage;
    }

    void cancel() {
      cancelled = true;
    }

    /** Queues an event; false if the queue is full (the event is dropped). */
    boolean offer(ChangeEvent event) {
      boolean signal;
      synchronized (this) {
        if (queuedEvents >= Store.MAX_PENDING_UPDATES) {
          return false;
        }
        queue.addLast(event);
        queuedEvents++;
        signal = !waiting;
        waiting = true;
      }
      if (signal) {
        deliver();
      }
      return true;
    }

    /** A new snapshot replaces everything queued. */
    void replaceWith(PictureSnapshot snapshot) {
      boolean signal;
      synchronized (this) {
        queue.clear();
        queuedEvents = 0;
        queue.addLast(snapshot);
        signal = !waiting;
        waiting = true;
      }
      if (signal) {
        deliver();
      }
    }

    private void deliver() {
      if (cancelled || !runtime.deliverAlways(target, this::take)) {
        cancelled = true; // the subscriber has stopped
      }
    }

    /** In the subscriber's worker: what has queued up, as one update. */
    private M take() {
      StoreUpdate update;
      boolean more;
      synchronized (this) {
        Object head = queue.pollFirst();
        if (head instanceof PictureSnapshot snapshot) {
          update = new StoreUpdate.Snapshot(snapshot.objects(), snapshot.layers(), snapshot.sequenceNo());
        } else {
          List<ChangeEvent> events = new ArrayList<>();
          events.add((ChangeEvent) head);
          while (queue.peekFirst() instanceof ChangeEvent next) {
            events.add(next);
            queue.pollFirst();
          }
          queuedEvents -= events.size();
          update = new StoreUpdate.Changes(events);
        }
        more = !queue.isEmpty();
        waiting = more;
      }
      if (more) {
        deliver();
      }
      return toMessage.apply(update);
    }
  }
}
