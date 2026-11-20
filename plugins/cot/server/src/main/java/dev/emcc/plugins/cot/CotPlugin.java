package dev.emcc.plugins.cot;

import dev.emcc.plugins.cot.codec.CotMapper;
import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.store.ObjectQuery;
import dev.emcc.sdk.worker.Overflow;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.time.Clock;
import java.time.Duration;
import org.jspecify.annotations.Nullable;

/**
 * The entry class ({@code server.entryClass} in {@code plugin.json}): receives Cursor on Target
 * from TAK systems and shows it on the map (T-040, brief {@code docs/plugins/briefs/cot.md}).
 *
 * <p>It has one worker, {@code applier}, with a mailbox that keeps only the latest event per uid.
 * At start the worker reads the links from the settings and starts a connection task for each (a
 * TCP or TLS client, or a UDP or multicast receiver); it finds its own objects again through a
 * store subscription, so a restart never duplicates them. Without a configured link it does
 * nothing and reports "no link configured".
 */
public final class CotPlugin implements Plugin {

  /** Events are replaced per uid, so the mailbox holds about one per uid; 50 000 leaves room for the answers. */
  private static final int MAILBOX = 50_000;

  private final Clock clock;
  private final LinkOutput.Caps caps;
  private final TcpLinkTask.@Nullable Opener opener;
  private @Nullable PluginContext context;
  private @Nullable WorkerRef<ApplierMsg> applier;
  private @Nullable Cancellable tick;
  private @Nullable Cancellable subscription;
  private @Nullable Cancellable settings;

  /** ECore creates the plugin with this constructor. */
  public CotPlugin() {
    this(Clock.systemUTC());
  }

  CotPlugin(Clock clock) {
    this(clock, LinkOutput.Caps.DEFAULT);
  }

  /** As {@link #CotPlugin(Clock)}, with the bounds of the channel memory a test wants. */
  CotPlugin(Clock clock, LinkOutput.Caps caps) {
    this(clock, caps, null);
  }

  /** As above, and {@code opener} opens the sockets of the TCP links in place of the task's own code (a test's way to a socket that blocks). */
  CotPlugin(Clock clock, LinkOutput.Caps caps, TcpLinkTask.@Nullable Opener opener) {
    this.clock = clock;
    this.caps = caps;
    this.opener = opener;
  }

  @Override
  public void init(PluginContext context) {
    this.context = context;
    this.applier = context.workers().spawn(
        WorkerSpec.of("applier", ApplierMsg.class, () -> new Applier(context, clock, caps, opener)).mailbox(MAILBOX, Overflow.coalesceByKey()));
    context.status().set(PluginState.OK, "starting");
  }

  @Override
  public void start() {
    PluginContext ctx = context;
    WorkerRef<ApplierMsg> worker = applier;
    if (ctx == null || worker == null) {
      return;
    }
    settings = ctx.subscribeSettings(worker, ApplierMsg.SettingsChanged::new);
    tick = ctx.timers().every(Duration.ofSeconds(1), worker, new ApplierMsg.Tick());
    subscription = ctx.store().subscribe(ObjectQuery.byExternalSystem(CotMapper.NAMESPACE), worker, ApplierMsg.Stored::new);
    ctx.documents().get(Applier.LAYERS_KEY, worker, ApplierMsg.LayersLoaded::new);
    worker.send(new ApplierMsg.SettingsChanged(ctx.settings()));
  }

  @Override
  public void stop() {
    // ECore stops the connection tasks and the worker; the timer, the subscription and the settings callback are ours,
    // and the worker cancels its own subscriptions to the source layers when it is told.
    WorkerRef<ApplierMsg> worker = applier;
    if (worker != null) {
      worker.send(new ApplierMsg.Stop());
    }
    cancel(tick);
    cancel(subscription);
    cancel(settings);
  }

  private static void cancel(@Nullable Cancellable what) {
    if (what != null) {
      what.cancel();
    }
  }
}
