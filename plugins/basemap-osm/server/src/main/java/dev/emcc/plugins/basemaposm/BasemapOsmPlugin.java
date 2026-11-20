package dev.emcc.plugins.basemaposm;

import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.http.Endpoint;
import dev.emcc.sdk.worker.Overflow;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import java.time.Duration;
import org.jspecify.annotations.Nullable;

/**
 * The server part of {@code basemap-osm}: a tile proxy, so that the browser talks only to the emc2
 * server (ADR-0014). All work happens in the {@code tiles} worker ({@link TileProxy}), which also
 * applies settings changes from the settings view while the server runs.
 */
public final class BasemapOsmPlugin implements Plugin {

  /**
   * ECore answers {@code 504} after this, never earlier than the proxy's own answer: the longest upstream timeout the
   * settings allow, plus the queue wait, plus a margin. Fixed, because the endpoint is registered once and the
   * upstream timeout can change while the server runs.
   */
  static final Duration ENDPOINT_TIMEOUT = Duration.ofSeconds(TileSettings.MAX_TIMEOUT_SECONDS).plus(TileProxy.QUEUE_WAIT).plusSeconds(2);

  private @Nullable PluginContext context;
  private @Nullable WorkerRef<TileMsg> tiles;
  private @Nullable Cancellable clock;
  private @Nullable Cancellable settingsSubscription;
  private boolean settingsRefused;

  @Override
  public void init(PluginContext context) {
    this.context = context;
    try {
      TileSettings.parse(context.settings());
    } catch (IllegalArgumentException e) {
      settingsRefused = true;
      context.log().error("bad setting: {}", e.getMessage());
      context.status().set(PluginState.FAILED, "bad setting: " + e.getMessage());
      // The worker still starts: it answers 503 until a valid change arrives from the settings view.
    }
    var http = context.http();
    var status = context.status();
    var ctx = context;
    // The factory reads the settings in force when it runs, so a restarted worker does not fall back to the first ones.
    tiles = context.workers().spawn(
        WorkerSpec.of("tiles", TileMsg.class, () -> new TileProxy(ctx.settings(), http, status))
            .mailbox(1_000, Overflow.dropNewest())
            .restartable(true));
    settingsSubscription = context.subscribeSettings(tiles, TileMsg.SettingsChanged::new);
    context.endpoints().register(Endpoint.get("/tiles/{z}/{x}/{y}.png").timeout(ENDPOINT_TIMEOUT), tiles, TileMsg.Get::new);
  }

  @Override
  public void start() {
    if (context == null || tiles == null) {
      return;
    }
    clock = context.timers().every(TileProxy.TICK, tiles, new TileMsg.Tick());
    if (!settingsRefused) {
      context.status().set(PluginState.OK, "ready");
    }
  }

  @Override
  public void stop() {
    if (clock != null) {
      clock.cancel();
    }
    if (settingsSubscription != null) {
      settingsSubscription.cancel();
    }
  }
}
