// The entry module ("web.entry" in plugin.json, built to dist/index.js). The shell imports it and
// calls activate(ctx) once, with a 10 s timeout. Nothing here waits: the map view and object-list
// are attached when they arrive, and the list works without them.
import { definePlugin, EVERY_WORKSPACE, MAP_VIEW, OBJECT_LIST } from '@emc2/plugin-sdk';
import { Layers } from 'lucide-react';
import { ActiveLayer } from './ActiveLayer.tsx';
import { LayerPanelController, NO_OBJECT_LIST } from './controller.ts';
import { LayerPanel } from './LayerPanel.tsx';
import { PanelErrorBoundary } from './PanelErrorBoundary.tsx';
import './layer-panel.css';

export default definePlugin({
  activate(ctx) {
    const controller = new LayerPanelController(ctx);
    // The bottom pane for a user who has not moved it (brief, function 15; BS, M4), in every workspace, where
    // it lists the layers of the workspace shown (function 16; rule 1 of the briefs README).
    ctx.ui.addPanel({
      id: 'layer-panel',
      title: 'Layers',
      icon: Layers,
      defaultPane: 'bottom',
      workspaces: [EVERY_WORKSPACE],
      component: () => (
        <PanelErrorBoundary log={ctx.log}>
          <LayerPanel controller={controller} />
        </PanelErrorBoundary>
      ),
    });

    let map: 'waiting' | 'ready' | 'failed' = 'waiting';
    let objectListMissing = false;
    // Set once the map view has settled; object-list only adds to the detail.
    const report = () => {
      if (map === 'waiting') return;
      const missing = objectListMissing ? [NO_OBJECT_LIST] : [];
      if (map === 'ready') ctx.status.set('OK', ['ready', ...missing].join('; '));
      else ctx.status.set('DEGRADED', ['map view not available: visibility and the active layer cannot be changed', ...missing].join('; '));
    };
    ctx.services.get(MAP_VIEW).then(
      (view) => {
        controller.attachMapView(view);
        // The active layer over the map, bottom left just above the cursor display (100), in every
        // workspace (brief, function 24). Only with a map view, as the active layer itself.
        ctx.ui.addMapPaneOverlay({
          id: 'layer-panel-active',
          position: 'bottom-left',
          order: 110,
          workspaces: [EVERY_WORKSPACE],
          component: () => (
            <PanelErrorBoundary log={ctx.log}>
              <ActiveLayer controller={controller} />
            </PanelErrorBoundary>
          ),
        });
        map = 'ready';
        report();
      },
      (error: unknown) => {
        controller.mapViewFailed();
        ctx.log.warn('map view not available', error);
        map = 'failed';
        report();
      },
    );
    // Optional: without object-list a double-click does nothing (brief, function 12).
    ctx.services.get(OBJECT_LIST).then(
      (list) => {
        controller.attachObjectList(list);
      },
      (error: unknown) => {
        ctx.log.info('object-list not available: a double-click opens nothing', error);
        objectListMissing = true;
        report();
      },
    );
  },
});
