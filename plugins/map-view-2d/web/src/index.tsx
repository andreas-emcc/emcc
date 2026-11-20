// The entry module ("web.entry" in plugin.json, built to dist/index.js). The shell imports it and
// calls activate(ctx) once, with a 10 s timeout. Everything is set up synchronously; the symbology
// service is used when it comes (activate.tsx).
import { definePlugin } from '@emc2/plugin-sdk';
import { activateMapView } from './activate.tsx';
import { storageChoices } from './core/background.ts';
import { storageControlsOpen } from './ui/controlsOpen.ts';
import { browserClock } from './core/cadence.ts';
import { isMac, OpenLayersEngine, registerWithOpenLayers } from './engine/olEngine.ts';
import './map-view-2d.css';

export default definePlugin({
  activate(ctx) {
    activateMapView(ctx, {
      createCanvas: () => document.createElement('canvas'),
      createEngine: (request, context) => {
        registerWithOpenLayers(request.projections);
        return new OpenLayersEngine({ ...request, log: context.log, mac: isMac(navigator) });
      },
      clock: browserClock,
      origin: window.location.origin,
      choices: storageChoices(() => window.localStorage),
      controlsOpen: storageControlsOpen(() => window.localStorage),
    });
  },
});
