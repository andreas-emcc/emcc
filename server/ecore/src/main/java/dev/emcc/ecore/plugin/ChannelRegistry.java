package dev.emcc.ecore.plugin;

import dev.emcc.ecore.runtime.WorkerHandle;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.channel.ChannelId;
import dev.emcc.sdk.channel.ChannelInfo;
import dev.emcc.sdk.channel.ChannelItem;
import dev.emcc.sdk.channel.ChannelList;
import dev.emcc.sdk.channel.ChannelRef;
import dev.emcc.sdk.channel.ChannelSpec;
import dev.emcc.sdk.channel.Channels;
import dev.emcc.sdk.channel.DeclaredItem;
import dev.emcc.sdk.worker.SendResult;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Function;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Every plugin's output channels (SDK 1.2.0, ADR-0037): one registry per server, which each
 * plugin's {@code channels()} ({@link PluginChannels}) uses.
 *
 * <p><b>A channel's inbox</b> keeps the latest item per object id, each object in the place where
 * it first arrived: a later item replaces a pending one in place. Over {@link Channels#MAX_PENDING}
 * objects, the oldest pending item goes and is counted. At most {@link Channels#MAX_IN_FLIGHT}
 * items are handed to the offering worker and not yet handled; each is made into the plugin's
 * message by its mapper in that worker, when the worker handles it, and then the next goes. A
 * handed-over item waits in the worker's mailbox, which coalesces no further, and still arrives
 * after a {@code withdraw} (only pending items are dropped). If the worker stops first, the item is
 * counted as dropped. One thread at a time hands a channel's items over (its drainer), so they
 * reach the worker in the order they were taken from the inbox, whoever sent them.
 *
 * <p><b>Declared kinds</b> (SDK 1.9.0, CR-0048 point 4): a channel may take kinds its own plugin
 * declares. Their items share the inbox, the newest per kind and item id (never replacing an object's
 * item), and reach the worker through the offer's {@code toDeclared}. {@link #send(ChannelId,
 * DeclaredItem)} checks the payload's size and schema outside the lock, then puts it in as {@code
 * send} does.
 *
 * <p><b>Watchers</b> get the current list, then a new one at each change; when several are
 * undelivered, the worker gets the latest (as with settings).
 *
 * <p><b>Locking (rule C4, ADR-0021; the ACA's P3-2):</b> the registry is shared between plugins and
 * {@code send} is called from any thread, so its one lock is a leaf lock: held only to change the
 * maps and counters. No plugin code (the mappers), no sending to a worker and no logging happens
 * while it is held; nothing else is locked under it.
 */
final class ChannelRegistry {

  private static final Logger LOG = LoggerFactory.getLogger(ChannelRegistry.class);

  /** How often a channel's drops are logged at most. */
  private static final long DROP_LOG_INTERVAL_NANOS = TimeUnit.MINUTES.toNanos(1);

  private final WorkerRuntime runtime;
  private final int maxPending;
  private final int maxInFlight;
  /** Runs before each hand-over, outside the lock (tests: widens the window between taking an item and handing it over). */
  private final Runnable beforeHandOver;
  private final Object lock = new Object();
  /** The channels offered now. Guarded by {@link #lock}. */
  private final Map<ChannelId, Channel<?>> channels = new HashMap<>();
  /** Guarded by {@link #lock}. */
  private final List<Watch<?>> watches = new ArrayList<>();
  /** The list watchers get; replaced under {@link #lock}, read without it. */
  private volatile ChannelList list = ChannelList.empty();
  /** Runs between a declared item's check and its put, outside the lock (tests: a withdrawal in between). */
  volatile Runnable afterDeclaredCheck = () -> {};

  ChannelRegistry(WorkerRuntime runtime) {
    this(runtime, Channels.MAX_PENDING, Channels.MAX_IN_FLIGHT);
  }

  /** With other limits (tests). */
  ChannelRegistry(WorkerRuntime runtime, int maxPending, int maxInFlight) {
    this(runtime, maxPending, maxInFlight, () -> {});
  }

  /** With other limits and a hook before each hand-over (tests). */
  ChannelRegistry(WorkerRuntime runtime, int maxPending, int maxInFlight, Runnable beforeHandOver) {
    if (maxPending < 1 || maxInFlight < 1) {
      throw new IllegalArgumentException("the limits must be at least 1");
    }
    this.runtime = Objects.requireNonNull(runtime, "runtime");
    this.maxPending = maxPending;
    this.maxInFlight = maxInFlight;
    this.beforeHandOver = Objects.requireNonNull(beforeHandOver, "beforeHandOver");
  }

  /**
   * One run of a plugin: what it offers and watches, until {@link #release}. After that it can
   * neither offer nor watch, also from a handler that still runs while the plugin stops.
   */
  final class Member {
    final String plugin;
    /** Guarded by {@link #lock}. */
    private boolean released;

    Member(String plugin) {
      this.plugin = Objects.requireNonNull(plugin, "plugin");
    }
  }

  /** A new run of {@code plugin}. */
  Member member(String plugin) {
    return new Member(plugin);
  }

  private void requireNotReleasedLocked(Member member) {
    if (member.released) {
      throw new IllegalStateException("plugin " + member.plugin + " has stopped");
    }
  }

  /**
   * Offers {@code spec}'s channel for {@code member}'s plugin; watchers get the new list.
   *
   * @throws IllegalArgumentException if the plugin offers a channel for that link already
   * @throws IllegalStateException if the plugin already offers {@code maxOffered} channels, or has stopped
   */
  <M> ChannelRef offer(Member member, int maxOffered, ChannelSpec spec, WorkerHandle<M> worker,
      Function<ChannelItem, ? extends M> toMessage) {
    return offer(member, maxOffered, spec, worker, toMessage, null, Map.of());
  }

  /**
   * SDK 1.9.0 (CR-0048 point 4): as {@link #offer(Member, int, ChannelSpec, WorkerHandle, Function)},
   * for a channel that may take declared kinds: {@code declared} holds its plugin's declared kinds'
   * payload schemas by kind id.
   *
   * @throws IllegalArgumentException also if the spec names a declared kind that is not its plugin's
   *     or that its manifest does not declare, or names any without a {@code toDeclared}
   */
  <M> ChannelRef offer(Member member, int maxOffered, ChannelSpec spec, WorkerHandle<M> worker,
      Function<ChannelItem, ? extends M> toMessage, @Nullable Function<DeclaredItem, ? extends M> toDeclared,
      Map<String, PayloadSchema> declared) {
    Objects.requireNonNull(spec, "spec");
    Objects.requireNonNull(worker, "worker");
    Objects.requireNonNull(toMessage, "toMessage");
    String plugin = member.plugin;
    Map<String, PayloadSchema> schemas = new HashMap<>();
    for (String kind : spec.declaredKinds()) {
      if (toDeclared == null) {
        throw new IllegalArgumentException("a channel with declared kinds is offered with a toDeclared mapper: " + spec.declaredKinds());
      }
      if (!kind.startsWith(plugin + ".")) {
        throw new IllegalArgumentException("a channel takes only its own plugin's declared kinds: " + kind);
      }
      PayloadSchema schema = declared.get(kind);
      if (schema == null) {
        throw new IllegalArgumentException("the kind " + kind + " is not declared in the manifest's channelKinds");
      }
      schemas.put(kind, schema);
    }
    Channel<M> channel = new Channel<>(ChannelInfo.of(plugin, spec), worker, toMessage, toDeclared, Map.copyOf(schemas));
    List<Watch<?>> toTell;
    synchronized (lock) {
      requireNotReleasedLocked(member);
      if (channels.containsKey(channel.info.id())) {
        throw new IllegalArgumentException("plugin " + plugin + " offers a channel for link " + spec.link() + " already");
      }
      long offered = channels.values().stream().filter(c -> c.plugin().equals(plugin)).count();
      if (offered >= maxOffered) {
        throw new IllegalStateException("plugin " + plugin + " offers " + offered + " channels, the most it may (emc2.channels.max-per-plugin)");
      }
      channels.put(channel.info.id(), channel);
      toTell = changedLocked();
    }
    toTell.forEach(Watch::changed);
    return channel;
  }

  /**
   * Delivers the current list to {@code target}, then each change, for {@code member}'s plugin.
   *
   * @throws IllegalStateException if the plugin has stopped
   */
  <M> Cancellable watch(Member member, WorkerHandle<M> target, Function<ChannelList, ? extends M> toMessage) {
    Watch<M> watch = new Watch<>(member.plugin, Objects.requireNonNull(target, "target"), Objects.requireNonNull(toMessage, "toMessage"));
    synchronized (lock) {
      requireNotReleasedLocked(member);
      watches.add(watch);
    }
    watch.changed();
    return watch;
  }

  /**
   * Puts {@code item} into the channel's inbox; {@code CLOSED} if no channel has {@code id} now.
   * Never blocks.
   *
   * @throws IllegalArgumentException SDK 1.4.0: if the channel does not take the item's kind
   *     (ADR-0048 point 4), as the test kit's {@code FakeChannels} does
   */
  SendResult send(ChannelId id, ChannelItem item) {
    Objects.requireNonNull(id, "channel");
    Objects.requireNonNull(item, "item");
    Channel<?> channel;
    List<Object> handOver;
    long dropsToLog;
    synchronized (lock) {
      channel = channels.get(id);
      if (channel == null) {
        return SendResult.CLOSED;
      }
      if (!channel.info.takes(item.kind())) {
        throw new IllegalArgumentException("the channel " + id + " does not take " + item.kind() + " (it takes " + channel.info.kinds() + ")");
      }
      channel.putLocked(item.coalesceKey(), item); // CR-0040: a ground radar's dwells do not replace each other
      handOver = channel.startDrainLocked();
      dropsToLog = channel.dropsToLogLocked();
    }
    return handedOver(channel, handOver, dropsToLog);
  }

  /**
   * SDK 1.9.0 (CR-0048 point 4): puts a declared item into the channel's inbox, the newest per kind
   * and id; {@code CLOSED} if no channel has {@code id} now. Never blocks: the size and the schema
   * are checked outside the lock.
   *
   * @throws IllegalArgumentException if the channel does not take the item's kind, or the payload is
   *     over {@link DeclaredItem#MAX_PAYLOAD_BYTES} or does not match the kind's schema
   */
  SendResult send(ChannelId id, DeclaredItem item) {
    Objects.requireNonNull(id, "channel");
    Objects.requireNonNull(item, "item");
    Channel<?> offered;
    synchronized (lock) {
      offered = channels.get(id);
    }
    if (offered == null) {
      return SendResult.CLOSED;
    }
    PayloadSchema schema = offered.schemas.get(item.kind());
    if (schema == null) {
      throw new IllegalArgumentException("the channel " + id + " does not take " + item.kind() + " (it takes " + offered.info.declaredKinds() + ")");
    }
    String problem = schema.problem(item.kind(), item.payload());
    if (problem != null) {
      throw new IllegalArgumentException(problem);
    }
    afterDeclaredCheck.run();
    List<Object> handOver;
    long dropsToLog;
    synchronized (lock) {
      if (channels.get(id) != offered) {
        return SendResult.CLOSED; // withdrawn while the payload was checked
      }
      offered.putLocked(new DeclaredKey(item.kind(), item.id()), item);
      handOver = offered.startDrainLocked();
      dropsToLog = offered.dropsToLogLocked();
    }
    return handedOver(offered, handOver, dropsToLog);
  }

  /** A declared item's place in the inbox: apart from objects' ids, the newest per kind and id. */
  private record DeclaredKey(String kind, UUID id) {}

  /** Outside the lock: hands over what the send claimed, and logs the drops due. */
  private SendResult handedOver(Channel<?> channel, List<Object> handOver, long dropsToLog) {
    ChannelId id = channel.info.id();
    channel.drain(handOver);
    if (dropsToLog > 0) {
      LOG.warn("Output channel {}: {} pending objects dropped, its inbox was full ({} objects); plugin {} does not keep up",
          id, dropsToLog, maxPending, id.plugin());
    }
    return SendResult.ACCEPTED;
  }

  /** When {@code member}'s plugin stops: its channels are withdrawn, its watches cancelled, and it can offer or watch no more. */
  void release(Member member) {
    String plugin = member.plugin;
    List<Watch<?>> toTell;
    synchronized (lock) {
      member.released = true;
      watches.removeIf(w -> w.plugin.equals(plugin) && w.cancelLocked());
      boolean any = false;
      for (Iterator<Channel<?>> it = channels.values().iterator(); it.hasNext(); ) {
        Channel<?> c = it.next();
        if (c.plugin().equals(plugin)) {
          it.remove();
          c.withdrawLocked();
          any = true;
        }
      }
      toTell = any ? changedLocked() : List.of();
    }
    toTell.forEach(Watch::changed);
  }

  /** The list watchers get now. */
  ChannelList list() {
    return list;
  }

  /** Whether the calling thread holds the registry's lock (tests: no plugin code runs under it). */
  boolean lockHeldByCurrentThread() {
    return Thread.holdsLock(lock);
  }

  /** {@code plugin}'s channels as the monitor view shows them, by link. */
  List<Stats> stats(String plugin) {
    List<Stats> out = new ArrayList<>();
    synchronized (lock) {
      channels.values().stream().filter(c -> c.plugin().equals(plugin)).forEach(c -> out.add(c.statsLocked()));
    }
    out.sort(Comparator.comparing(s -> s.info().id().link()));
    return out;
  }

  /**
   * One channel as the monitor view shows it.
   *
   * @param sent items accepted for it
   * @param replaced items that replaced a pending item of the same object
   * @param delivered items its worker has handled
   * @param dropped items that went because its inbox was full, or whose worker stopped before it handled them
   * @param pending objects waiting in its inbox
   * @param inFlight items handed to its worker and not handled yet
   */
  record Stats(ChannelInfo info, long sent, long replaced, long delivered, long dropped, int pending, int inFlight) {}

  /** The new list after a change; the watches to tell, outside the lock. */
  private List<Watch<?>> changedLocked() {
    list = new ChannelList(channels.values().stream().map(c -> c.info).toList());
    return List.copyOf(watches);
  }

  private void withdraw(Channel<?> channel) {
    List<Watch<?>> toTell;
    synchronized (lock) {
      if (!channels.remove(channel.info.id(), channel)) {
        return; // withdrawn already
      }
      channel.withdrawLocked();
      toTell = changedLocked();
    }
    toTell.forEach(Watch::changed);
  }

  /** One offered channel; also the plugin's {@link ChannelRef} (equal by identity). */
  private final class Channel<M> implements ChannelRef {
    /** Replaced under {@link #lock} only by {@link #state} (its id never changes); read without it. */
    volatile ChannelInfo info;
    final WorkerHandle<M> worker;
    final Function<ChannelItem, ? extends M> toMessage;
    /** SDK 1.9.0: the declared items' mapper, null when the channel takes none. */
    final @Nullable Function<DeclaredItem, ? extends M> toDeclared;
    /** SDK 1.9.0: the payload schemas of the declared kinds it takes, by kind id. */
    final Map<String, PayloadSchema> schemas;
    /**
     * The inbox: the latest item per {@link ChannelItem#coalesceKey()} (the object id; a sensor report's
     * sensor, and its dwell number when it has a sequence: SDK 1.5.0, CR-0040), or per declared kind
     * and id ({@link DeclaredKey}), oldest first; a {@link ChannelItem} or a {@link DeclaredItem}.
     * Guarded by {@link #lock}, as are the fields below.
     */
    private final LinkedHashMap<Object, Object> pending = new LinkedHashMap<>();
    private int inFlight;
    /** A thread hands items over now; others only put theirs into the inbox (keeps the order). */
    private boolean draining;
    private boolean withdrawn;
    private long sent;
    private long replaced;
    private long delivered;
    private long dropped;
    private long dropsNotLogged;
    private long lastDropLog = System.nanoTime() - DROP_LOG_INTERVAL_NANOS;

    Channel(ChannelInfo info, WorkerHandle<M> worker, Function<ChannelItem, ? extends M> toMessage,
        @Nullable Function<DeclaredItem, ? extends M> toDeclared, Map<String, PayloadSchema> schemas) {
      this.info = info;
      this.worker = worker;
      this.toMessage = toMessage;
      this.toDeclared = toDeclared;
      this.schemas = schemas;
    }

    String plugin() {
      return info.id().plugin();
    }

    void putLocked(Object key, Object item) {
      sent++;
      if (pending.containsKey(key)) {
        replaced++;
      } else if (pending.size() >= maxPending) {
        pending.remove(pending.keySet().iterator().next()); // the oldest pending object goes
        dropped++;
        dropsNotLogged++;
      }
      pending.put(key, item); // a replacement keeps its object's place
    }

    /** The items to hand over now, taken from the inbox: as many as fit in flight. */
    List<Object> claimLocked() {
      if (withdrawn || inFlight >= maxInFlight || pending.isEmpty()) {
        return List.of();
      }
      List<Object> out = new ArrayList<>();
      for (Iterator<Object> it = pending.values().iterator(); it.hasNext() && inFlight < maxInFlight; ) {
        out.add(it.next());
        it.remove();
        inFlight++;
      }
      return out;
    }

    /** The drops to log now: at most once a minute per channel. */
    long dropsToLogLocked() {
      long now = System.nanoTime();
      if (dropsNotLogged == 0 || now - lastDropLog < DROP_LOG_INTERVAL_NANOS) {
        return 0;
      }
      long n = dropsNotLogged;
      dropsNotLogged = 0;
      lastDropLog = now;
      return n;
    }

    void withdrawLocked() {
      withdrawn = true;
      pending.clear();
    }

    Stats statsLocked() {
      return new Stats(info, sent, replaced, delivered, dropped, pending.size(), inFlight);
    }

    /**
     * Becomes the drainer if no thread is, and takes the first items to hand over; empty (and not
     * the drainer) if another thread drains or there is nothing to hand over.
     */
    List<Object> startDrainLocked() {
      if (draining) {
        return List.of(); // the drainer takes this item in its next round
      }
      List<Object> first = claimLocked();
      draining = !first.isEmpty();
      return first;
    }

    /**
     * As the drainer: hands {@code items} over, outside the lock, and the next ones, until none fit
     * or are left. A sender that drains may so hand over other senders' items too, as long as the
     * worker takes them as fast; it never waits (rule C5), and the inbox bounds the work.
     */
    void drain(List<Object> items) {
      List<Object> next = items;
      while (!next.isEmpty()) {
        int handed = 0;
        try {
          for (Object item : next) {
            beforeHandOver.run();
            if (!runtime.deliverAlways(worker, () -> handled(item), this::lost)) {
              lost();
            }
            handed++;
          }
        } catch (RuntimeException | Error e) {
          int notHanded = next.size() - handed;
          synchronized (lock) {
            draining = false; // the channel must not stall: the next put or handled item drains again
            inFlight -= notHanded;
            dropped += notHanded;
          }
          throw e;
        }
        synchronized (lock) {
          next = claimLocked();
          if (next.isEmpty()) {
            draining = false; // under the lock: a later put starts a new drain
          }
        }
      }
    }

    /** In the worker, when it takes the item: the next item goes, then the plugin's mapper makes the message. */
    private M handled(Object item) {
      List<Object> next;
      synchronized (lock) {
        inFlight--;
        delivered++;
        next = startDrainLocked();
      }
      drain(next);
      if (item instanceof DeclaredItem declared) {
        return Objects.requireNonNull(toDeclared, "toDeclared").apply(declared); // offer checked it is there
      }
      return toMessage.apply((ChannelItem) item);
    }

    /** The worker stopped before it handled an item. */
    private void lost() {
      synchronized (lock) {
        inFlight--;
        dropped++;
      }
    }

    @Override
    public ChannelId id() {
      return info.id();
    }

    @Override
    public void withdraw() {
      ChannelRegistry.this.withdraw(this);
    }

    /** SDK 1.9.0 (CR-0050 point 2): its state for its senders; watchers get the new list when it changes. */
    @Override
    public void state(dev.emcc.sdk.channel.ChannelState state, String detail) {
      Objects.requireNonNull(state, "state");
      Objects.requireNonNull(detail, "detail");
      ChannelInfo changed = info.withState(state, detail); // checks the detail, outside the lock
      List<Watch<?>> toTell;
      synchronized (lock) {
        if (withdrawn || (info.state() == state && info.stateDetail().equals(detail))) {
          return;
        }
        info = changed;
        toTell = changedLocked();
      }
      toTell.forEach(Watch::changed);
    }

    @Override
    public String toString() {
      return "ChannelRef[" + info.id() + "]";
    }
  }

  /** One {@code watch}: at most one message waits, and it carries the list current when it is handled. */
  private final class Watch<M> implements Cancellable {
    final String plugin;
    private final WorkerHandle<M> target;
    private final Function<ChannelList, ? extends M> toMessage;
    private final AtomicBoolean waiting = new AtomicBoolean();
    private volatile boolean cancelled;

    Watch(String plugin, WorkerHandle<M> target, Function<ChannelList, ? extends M> toMessage) {
      this.plugin = plugin;
      this.target = target;
      this.toMessage = toMessage;
    }

    /** Outside the lock. */
    void changed() {
      if (cancelled || !waiting.compareAndSet(false, true)) {
        return;
      }
      boolean queued = runtime.deliverAlways(target, () -> {
        waiting.set(false); // a change from now on queues another message
        return toMessage.apply(list);
      });
      if (!queued) {
        waiting.set(false); // the worker has stopped
      }
    }

    /** Marks it cancelled; true, for {@code removeIf}. */
    boolean cancelLocked() {
      cancelled = true;
      return true;
    }

    @Override
    public void cancel() {
      cancelled = true;
      synchronized (lock) {
        watches.remove(this);
      }
    }
  }
}
