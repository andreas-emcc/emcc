// The entry module: provides the OpenStreetMap background to the map view. The tiles come from the
// plugin's own server part (the tile proxy), so the browser never contacts another host.
import { BACKGROUND_MAP, definePlugin } from '@emc2/plugin-sdk';
import { OSM_MAX_ZOOM, createProvider, readMaxZoom } from './provider.ts';

export default definePlugin({
  activate(ctx) {
    const current = { maxZoom: OSM_MAX_ZOOM };

    /** Takes the `maxZoom` setting; a bad value keeps the one in force and is reported. */
    const apply = (value: unknown) => {
      const valid = readMaxZoom(value);
      if (valid === null) {
        ctx.log.warn(`setting maxZoom is not an integer from 0 to ${String(OSM_MAX_ZOOM)}; using ${String(current.maxZoom)}`);
        ctx.status.set('DEGRADED', 'bad maxZoom setting, using ' + String(current.maxZoom));
      } else {
        current.maxZoom = valid;
        ctx.status.set('OK', 'ready');
      }
    };

    apply(ctx.settings['maxZoom']);
    ctx.services.provide(BACKGROUND_MAP, createProvider(ctx.serverBase, current));
    // Settings changes from the settings view apply without a reload (SDK v1).
    ctx.onSettingsChange((next) => {
      apply(next['maxZoom']);
    });
  },
});
