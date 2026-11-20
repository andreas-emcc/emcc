// The entry module: provides the Natural Earth vector background to the map view. The data is a
// file of this plugin, so the browser contacts no other host and nothing is fetched until the
// background is first shown.
import { BACKGROUND_MAP, definePlugin } from '@emc2/plugin-sdk';
import { createProvider, readShowBorders } from './provider.ts';

export default definePlugin({
  activate(ctx) {
    // Read once: a provider is data, and the map view reads its layers when it takes the provider.
    const configured = readShowBorders(ctx.settings['showBorders']);
    if (configured === null) {
      ctx.log.warn('setting showBorders is not true or false; using true');
    }
    ctx.services.provide(BACKGROUND_MAP, createProvider(ctx.webBase, configured ?? true));
    ctx.status.set(configured === null ? 'DEGRADED' : 'OK', configured === null ? 'bad showBorders setting, using the default' : 'ready');
  },
});
