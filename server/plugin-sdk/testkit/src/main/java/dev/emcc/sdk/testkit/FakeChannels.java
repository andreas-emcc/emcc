package dev.emcc.sdk.testkit;

import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.channel.ChannelId;
import dev.emcc.sdk.channel.ChannelInfo;
import dev.emcc.sdk.channel.ChannelItem;
import dev.emcc.sdk.channel.ChannelList;
import dev.emcc.sdk.channel.ChannelRef;
import dev.emcc.sdk.channel.ChannelSpec;
import dev.emcc.sdk.channel.ChannelState;
import dev.emcc.sdk.channel.Channels;
import dev.emcc.sdk.channel.DeclaredItem;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Consumer;
import java.util.function.Function;
import org.jspecify.annotations.Nullable;

/**
 * SDK 1.2.0: the output channels of {@link FakePluginContext} ({@code ctx.channels()}; ADR-0037).
 * Like ECore, it keeps one inbox per offered channel that keeps only the latest item per key (the
 * item's {@link ChannelItem#coalesceKey()}: its object id, or from SDK 1.5.0 a sensor report's sensor
 * and dwell number when it has a sequence, CR-0040),
 * and hands the items to the offering worker one at a time, at {@code ctx.runUntilIdle()}: an item
 * is taken from the inbox when the worker handles it, so what is sent before then still coalesces.
 *
 * <p><b>Two differences from ECore:</b> it is single-threaded, like the rest of {@code
 * FakePluginContext}, so call it from the test thread or a worker's handler, not from a connection
 * task's thread; and it hands over one item at a time, where ECore lets up to {@link
 * Channels#MAX_IN_FLIGHT} wait in the worker's mailbox, which coalesces no further. So it coalesces
 * more than ECore: a plugin's test must not rely on an item being replaced once handed over.
 *
 * <p>The channels of other plugins are scripted ({@link #addOther}, {@link #removeOther}), so that a
 * sender's test sees them in its {@code watch} list; what is sent to them is recorded ({@link
 * #sent}).
 *
 * <p><b>SDK 1.3.0:</b> after the plugin's {@code stop()}, call {@link #release} as ECore's plugin host
 * does: from then on {@code offer} and {@code watch} throw, as {@link Channels} states (CR-0028).
 *
 * <pre>{@code
 * var ctx = FakePluginContext.builder("simulator").build();
 * ctx.channels().addOther(ChannelInfo.of("cot", ChannelSpec.of("tak-north", "TAK North (out)", "cot")));
 * plugin.init(ctx);
 * plugin.start();
 * ctx.runUntilIdle();                                   // the simulator got the list and sent
 * assertThat(ctx.channels().sent(new ChannelId("cot", "tak-north"))).hasSize(1);
 *
 * // an output plugin: drive it as a sender would
 * ctx.channels().deliver(new ChannelId("cot", "tak-north"), new ChannelItem.Removal(id));
 * ctx.runUntilIdle();
 * }</pre>
 *
 * <p><b>SDK 1.9.0 (CR-0048 point 4): declared kinds.</b> A test declares the kinds it uses with
 * their payload schemas ({@link #declare}): the plugin's own, which its offers may then take, and
 * another plugin's, which its sends must match. {@code send} of a {@link DeclaredItem} checks the
 * kind, the size and the schema as ECore does, the schema in the subset {@link PayloadCheck} names.
 * Declared items are recorded apart ({@link #sentDeclared}) and delivered through the offer's {@code
 * toDeclared}; they coalesce by kind and id.
 *
 * <pre>{@code
 * ctx.channels().declare("fmv.camera-pose", poseSchema);
 * ctx.channels().addOther(ChannelInfo.of("fmv", ChannelSpec.of("uav-north", "UAV North (out)", "stanag-4609")
 *     .declaredKinds(Set.of("fmv.camera-pose")).kinds(Set.of())));
 * // … the plugin sends …
 * assertThat(ctx.channels().sentDeclared(new ChannelId("fmv", "uav-north"))).hasSize(25);
 * }</pre>
 *
 * <p><b>SDK 1.9.0 (CR-0050 point 2): a channel's state.</b> The plugin's {@link ChannelRef#state} replaces
 * its channel's state, and a scripted channel's is set with {@link #setOtherState}; watchers get the
 * new list when it changed, as ECore's do.
 */
public final class FakeChannels implements Channels {

  private final FakePluginContext ctx;
  private final int maxOffered;
  /** The plugin's own channels, by id. */
  private final Map<ChannelId, Offered<?>> offered = new LinkedHashMap<>();
  /** Other plugins' channels, scripted by the test. */
  private final Map<ChannelId, ChannelInfo> others = new LinkedHashMap<>();
  private final Map<ChannelId, List<ChannelItem>> sent = new LinkedHashMap<>();
  private final Map<ChannelId, List<DeclaredItem>> sentDeclared = new LinkedHashMap<>();
  /** SDK 1.9.0: the declared kinds a test named, with their payload schemas. */
  private final Map<String, JsonObject> declared = new LinkedHashMap<>();
  private final List<Consumer<ChannelList>> watchers = new ArrayList<>();
  private boolean released;

  FakeChannels(FakePluginContext ctx, int maxOffered) {
    this.ctx = ctx;
    this.maxOffered = maxOffered;
  }

  // ---------------------------------------------------------------- Channels

  @Override
  public <M extends Message> ChannelRef offer(ChannelSpec spec, WorkerRef<M> worker, Function<ChannelItem, ? extends M> toMessage) {
    if (!spec.declaredKinds().isEmpty()) {
      throw new IllegalArgumentException("a channel with declared kinds is offered with a toDeclared mapper: " + spec.declaredKinds());
    }
    return offer(spec, worker, toMessage, null);
  }

  @Override
  public <M extends Message> ChannelRef offer(
      ChannelSpec spec, WorkerRef<M> worker, Function<ChannelItem, ? extends M> toMessage, @Nullable Function<DeclaredItem, ? extends M> toDeclared) {
    Objects.requireNonNull(spec, "spec");
    Objects.requireNonNull(worker, "worker");
    Objects.requireNonNull(toMessage, "toMessage");
    checkNotReleased();
    for (String kind : spec.declaredKinds()) {
      if (!kind.startsWith(ctx.pluginId() + ".")) {
        throw new IllegalArgumentException("a channel takes only its own plugin's declared kinds: " + kind);
      }
      if (!declared.containsKey(kind)) {
        throw new IllegalArgumentException("the kind " + kind + " is not declared (declare it in the test, as the manifest's channelKinds does)");
      }
    }
    if (!spec.declaredKinds().isEmpty()) {
      Objects.requireNonNull(toDeclared, "toDeclared");
    }
    ChannelInfo info = ChannelInfo.of(ctx.pluginId(), spec);
    if (offered.containsKey(info.id())) {
      throw new IllegalArgumentException("the plugin offers a channel for link " + spec.link() + " already");
    }
    if (offered.size() >= maxOffered) {
      throw new IllegalStateException("too many channels (" + maxOffered + ")");
    }
    var o = new Offered<>(info, worker, toMessage, toDeclared);
    offered.put(info.id(), o);
    changed();
    return o.ref;
  }

  @Override
  public <M extends Message> Cancellable watch(WorkerRef<M> target, Function<ChannelList, ? extends M> toMessage) {
    Objects.requireNonNull(target, "target");
    Objects.requireNonNull(toMessage, "toMessage");
    checkNotReleased();
    // Like settings: always delivered, and only the latest undelivered list is kept.
    ChannelList[] latest = new ChannelList[1];
    boolean[] cancelled = new boolean[1];
    Consumer<ChannelList> watcher = list -> {
      if (cancelled[0]) {
        return;
      }
      boolean queued = latest[0] != null;
      latest[0] = list;
      if (!queued) {
        ctx.deliverAlways(target, () -> {
          ChannelList current = Objects.requireNonNull(latest[0]);
          latest[0] = null;
          return toMessage.apply(current);
        });
      }
    };
    watchers.add(watcher);
    watcher.accept(list());
    return () -> {
      cancelled[0] = true;
      watchers.remove(watcher);
    };
  }

  @Override
  public SendResult send(ChannelId channel, ChannelItem item) {
    Objects.requireNonNull(channel, "channel");
    Objects.requireNonNull(item, "item");
    Offered<?> o = offered.get(channel);
    ChannelInfo info = o != null ? o.info : others.get(channel);
    if (info == null) {
      return SendResult.CLOSED;
    }
    if (!info.takes(item.kind())) {
      throw new IllegalArgumentException("the channel " + channel + " does not take " + item.kind() + " (it takes " + info.kinds() + ")");
    }
    sent.computeIfAbsent(channel, k -> new ArrayList<>()).add(item);
    if (o != null) {
      o.put(item.coalesceKey(), item);
    }
    return SendResult.ACCEPTED;
  }

  @Override
  public SendResult send(ChannelId channel, DeclaredItem item) {
    Objects.requireNonNull(channel, "channel");
    Objects.requireNonNull(item, "item");
    Offered<?> o = offered.get(channel);
    ChannelInfo info = o != null ? o.info : others.get(channel);
    if (info == null) {
      return SendResult.CLOSED;
    }
    if (!info.takesDeclared(item.kind())) {
      throw new IllegalArgumentException("the channel " + channel + " does not take " + item.kind() + " (it takes " + info.declaredKinds() + ")");
    }
    int size = PayloadCheck.size(item.payload());
    if (size > DeclaredItem.MAX_PAYLOAD_BYTES) {
      throw new IllegalArgumentException("a payload of " + item.kind() + " is at most " + DeclaredItem.MAX_PAYLOAD_BYTES + " bytes: " + size);
    }
    JsonObject schema = declared.get(item.kind());
    if (schema == null) {
      throw new IllegalArgumentException("the kind " + item.kind() + " is not declared (declare it in the test with its schema)");
    }
    String problem = PayloadCheck.problem(schema, item.payload());
    if (problem != null) {
      throw new IllegalArgumentException("a payload of " + item.kind() + " does not match its schema: " + problem);
    }
    sentDeclared.computeIfAbsent(channel, k -> new ArrayList<>()).add(item);
    if (o != null) {
      o.put(new DeclaredKey(item.kind(), item.id()), item);
    }
    return SendResult.ACCEPTED;
  }

  // ---------------------------------------------------------------- test controls

  /**
   * SDK 1.9.0 (CR-0048 point 4): declares the channel kind {@code kind} ({@code <plugin-id>.<name>})
   * with its {@code payload} schema, as a manifest's {@code channelKinds} does: the plugin's own, so
   * that its offers take it, or another plugin's, so that sends to it are checked.
   *
   * @throws IllegalArgumentException if {@code kind} is no kind's id, if the schema is not an object
   *     schema, or if it has a {@code $ref} outside itself (model rule 23)
   */
  public void declare(String kind, JsonObject payloadSchema) {
    DeclaredItem.checkKind(kind);
    Objects.requireNonNull(payloadSchema, "payloadSchema");
    if (!(payloadSchema.get("type") instanceof dev.emcc.sdk.json.JsonString t) || !t.value().equals("object")) {
      throw new IllegalArgumentException("a kind's payload schema is an object schema (\"type\": \"object\"): " + kind);
    }
    String remote = PayloadCheck.remoteRef(payloadSchema);
    if (remote != null) {
      throw new IllegalArgumentException("a kind's payload schema is self-contained (model rule 23): $ref " + remote);
    }
    declared.put(kind, payloadSchema);
  }

  /**
   * SDK 1.9.0: sends {@code item} to one of the plugin's own channels, as another plugin would, to
   * drive the offering plugin.
   *
   * @throws IllegalArgumentException if the plugin offers no such channel now
   */
  public void deliver(ChannelId channel, DeclaredItem item) {
    if (!offered.containsKey(channel)) {
      throw new IllegalArgumentException("the plugin offers no channel " + channel);
    }
    send(channel, item);
  }

  /** SDK 1.9.0: every declared item sent to {@code channel}, in order, also those a later item replaced. */
  public List<DeclaredItem> sentDeclared(ChannelId channel) {
    return List.copyOf(sentDeclared.getOrDefault(channel, List.of()));
  }

  /**
   * SDK 1.3.0: what ECore's plugin host does to the channels when the plugin stops (CR-0028; the
   * owner, 2026-10-30, Q4): the plugin's watches are cancelled, then its channels withdrawn, so
   * that sends to them return {@code CLOSED} and their pending items are dropped. From then on
   * {@code offer} and {@code watch} throw {@link IllegalStateException}. Call it after the plugin's
   * {@code stop()}; a second call does nothing. Other plugins' scripted channels stay.
   */
  public void release() {
    if (released) {
      return;
    }
    released = true;
    watchers.clear();
    List.copyOf(offered.values()).forEach(Offered::withdraw);
  }

  /** Adds another plugin's channel, as when its link appears; watchers get the new list. */
  public void addOther(ChannelInfo channel) {
    if (channel.id().plugin().equals(ctx.pluginId())) {
      throw new IllegalArgumentException("the plugin's own channels come from offer(): " + channel.id());
    }
    others.put(channel.id(), channel);
    changed();
  }

  /**
   * SDK 1.9.0 (CR-0050 point 2): sets the state of another plugin's scripted channel, as its plugin
   * would; watchers get the new list if it changed. A scripted channel may also be added with a
   * state ({@link ChannelInfo#withState}).
   *
   * @throws IllegalArgumentException if no such scripted channel is there, or for a bad detail
   */
  public void setOtherState(ChannelId id, ChannelState state, String detail) {
    ChannelInfo current = others.get(id);
    if (current == null) {
      throw new IllegalArgumentException("no scripted channel " + id);
    }
    ChannelInfo next = current.withState(state, detail);
    if (!next.equals(current)) {
      others.put(id, next);
      changed();
    }
  }

  /** Removes another plugin's channel, as when its link goes; watchers get the new list. */
  public void removeOther(ChannelId id) {
    if (others.remove(id) != null) {
      changed();
    }
  }

  /**
   * Sends {@code item} to one of the plugin's own channels, as another plugin would, to drive the
   * offering plugin.
   *
   * @throws IllegalArgumentException if the plugin offers no such channel now
   */
  public void deliver(ChannelId channel, ChannelItem item) {
    if (!offered.containsKey(channel)) {
      throw new IllegalArgumentException("the plugin offers no channel " + channel);
    }
    send(channel, item);
  }

  /** Every channel offered now, the plugin's own and the scripted ones, as a watcher sees them. */
  public ChannelList list() {
    var all = new ArrayList<ChannelInfo>(others.values());
    offered.values().forEach(o -> all.add(o.info));
    return new ChannelList(all); // sorted by plugin, then link
  }

  /** The plugin's own channels offered now. */
  public List<ChannelInfo> offered() {
    return offered.values().stream().map(o -> o.info).toList();
  }

  /** Every item sent to {@code channel}, in order, also those a later item replaced. */
  public List<ChannelItem> sent(ChannelId channel) {
    return List.copyOf(sent.getOrDefault(channel, List.of()));
  }

  /** The items of one of the plugin's own channels that its worker has not handled yet, one per key. */
  public List<ChannelItem> pending(ChannelId channel) {
    Offered<?> o = offered.get(channel);
    return o == null ? List.of() : o.pending.values().stream().filter(ChannelItem.class::isInstance).map(ChannelItem.class::cast).toList();
  }

  /** SDK 1.9.0: the declared items of one of the plugin's own channels that its worker has not handled yet, one per kind and id. */
  public List<DeclaredItem> pendingDeclared(ChannelId channel) {
    Offered<?> o = offered.get(channel);
    return o == null ? List.of() : o.pending.values().stream().filter(DeclaredItem.class::isInstance).map(DeclaredItem.class::cast).toList();
  }

  private void checkNotReleased() {
    if (released) {
      throw new IllegalStateException("the plugin " + ctx.pluginId() + " has stopped");
    }
  }

  private void changed() {
    ChannelList list = list();
    List.copyOf(watchers).forEach(w -> w.accept(list));
  }

  // ---------------------------------------------------------------- state

  private final class Offered<M extends Message> {
    /** Its info; SDK 1.9.0: replaced when the plugin sets its state. */
    ChannelInfo info;
    final WorkerRef<M> worker;
    final Function<ChannelItem, ? extends M> toMessage;
    final @Nullable Function<DeclaredItem, ? extends M> toDeclared;
    /** The inbox: the latest item per key ({@link ChannelItem#coalesceKey()}; a declared item's kind and id), oldest first. */
    final LinkedHashMap<Object, Object> pending = new LinkedHashMap<>();
    final ChannelRef ref;
    boolean scheduled;
    boolean withdrawn;

    Offered(ChannelInfo info, WorkerRef<M> worker, Function<ChannelItem, ? extends M> toMessage, @Nullable Function<DeclaredItem, ? extends M> toDeclared) {
      this.info = info;
      this.worker = worker;
      this.toMessage = toMessage;
      this.toDeclared = toDeclared;
      this.ref = new FakeChannelRef(this);
    }

    void put(Object key, Object item) {
      pending.put(key, item); // a later item of the same key replaces it in place
      if (pending.size() > MAX_PENDING) {
        pending.remove(pending.keySet().iterator().next());
      }
      schedule();
    }

    private void schedule() {
      if (scheduled || pending.isEmpty()) {
        return;
      }
      scheduled = true;
      // The item is taken when the worker handles the delivery, so later sends still coalesce. A
      // stopped worker drops the delivery and the channel stays scheduled: sends are still
      // ACCEPTED and kept, as nothing in the fake restarts a stopped worker.
      ctx.deliverUnlessGone(worker, this::next);
    }

    private @Nullable M next() {
      scheduled = false;
      if (withdrawn || pending.isEmpty()) {
        return null;
      }
      Object first = pending.keySet().iterator().next();
      Object item = Objects.requireNonNull(pending.remove(first));
      schedule();
      return item instanceof DeclaredItem d ? Objects.requireNonNull(toDeclared).apply(d) : toMessage.apply((ChannelItem) item);
    }

    /** SDK 1.9.0 (CR-0050 point 2): the plugin sets the channel's state; watchers get a new list if it changed. */
    void state(ChannelState state, String detail) {
      Objects.requireNonNull(state, "state");
      Objects.requireNonNull(detail, "detail");
      ChannelInfo next = info.withState(state, detail); // checks the detail
      if (withdrawn || next.equals(info)) {
        return;
      }
      info = next;
      changed();
    }

    void withdraw() {
      if (withdrawn) {
        return;
      }
      withdrawn = true;
      pending.clear();
      offered.remove(info.id(), this);
      changed();
    }
  }

  /** SDK 1.9.0: a declared item's key in a channel's inbox, apart from map objects' ids. */
  private record DeclaredKey(String kind, java.util.UUID id) {}

  private static final class FakeChannelRef implements ChannelRef {
    private final FakeChannels.Offered<?> channel;

    FakeChannelRef(FakeChannels.Offered<?> channel) {
      this.channel = channel;
    }

    @Override
    public ChannelId id() {
      return channel.info.id();
    }

    @Override
    public void withdraw() {
      channel.withdraw();
    }

    @Override
    public void state(ChannelState state, String detail) {
      channel.state(state, detail);
    }

    @Override
    public boolean equals(@Nullable Object other) {
      return other instanceof FakeChannelRef r && r.channel == channel;
    }

    @Override
    public int hashCode() {
      return System.identityHashCode(channel);
    }

    @Override
    public String toString() {
      return "ChannelRef[" + id() + "]";
    }
  }
}
