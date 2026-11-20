package dev.emcc.plugins.basemapwms;

import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.Permissions;
import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.http.Endpoint;
import dev.emcc.sdk.worker.Overflow;
import dev.emcc.sdk.worker.WorkerRef;
import dev.emcc.sdk.worker.WorkerSpec;
import org.jspecify.annotations.Nullable;

/**
 * The server part of {@code basemap-wms}: reads the capabilities of the WMS servers the settings name, tells the browsers
 * which backgrounds are offered, and passes checked map requests on (ADR-0035). All work happens in the {@code wms} worker
 * ({@link WmsService}); the plugin calls no host but the servers of its saved settings, and takes no address from a request
 * (ADR-0030).
 */
public final class BasemapWmsPlugin implements Plugin {

  /** Sent with every call to a server. */
  static final String USER_AGENT = "emc2-basemap-wms/0.1 (emc2 WMS background maps)";

  private @Nullable PluginContext context;
  private @Nullable WorkerRef<WmsMsg> wms;
  private @Nullable Cancellable clock;
  private @Nullable Cancellable settingsSubscription;

  @Override
  public void init(PluginContext context) {
    this.context = context;
    var http = context.http();
    var status = context.status();
    var ctx = context;
    // The factory reads the settings in force when it runs, so a restarted worker does not fall back to the first ones.
    wms = context.workers().spawn(
        WorkerSpec.of("wms", WmsMsg.class, () -> new WmsService(ctx.settings(), http, status))
            .mailbox(2_000, Overflow.dropNewest())
            .restartable(true));
    settingsSubscription = context.subscribeSettings(wms, WmsMsg.SettingsChanged::new);
    var endpoints = context.endpoints();
    endpoints.register(Endpoint.get("/map/{background}").timeout(WmsService.QUEUE_WAIT), wms, WmsMsg.MapGet::new);
    endpoints.register(Endpoint.get("/backgrounds"), wms, WmsMsg.BackgroundsGet::new);
    endpoints.register(
        Endpoint.get("/servers/{server}/layers").timeout(WmsService.LAYERS_TIMEOUT).requires(Permissions.SETTINGS_ADMIN), wms, WmsMsg.LayersGet::new);
  }

  @Override
  public void start() {
    if (context == null || wms == null) {
      return;
    }
    clock = context.timers().every(WmsService.TICK, wms, new WmsMsg.Tick());
    wms.send(new WmsMsg.Start());
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
