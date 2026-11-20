// The entry module ("web.entry" in plugin.json, built to dist/index.js). The shell imports it and
// calls activate(ctx) once, with a 10 s timeout. Nothing here waits: the map view is attached when
// it arrives, and the list works without it (brief, function 8).
import { definePlugin, EVERY_WORKSPACE, MAP_VIEW, OBJECT_LIST, SYMBOLS } from '@emc2/plugin-sdk';
import { Rows3 } from 'lucide-react';
import { ObjectListController } from './controller.ts';
import { ObjectsPanel } from './ObjectsPanel.tsx';
import { PanelErrorBoundary } from './PanelErrorBoundary.tsx';
import './object-list.css';

export default definePlugin({
  activate(ctx) {
    const controller = new ObjectListController(ctx);
    const panel = ctx.ui.addPanel({
      id: 'object-list',
      title: 'Objects',
      icon: Rows3,
      defaultPane: 'bottom',
      // In every workspace, for that workspace's own layers (rule 1, functions 10 and 11).
      workspaces: [EVERY_WORKSPACE],
      component: () => (
        <PanelErrorBoundary log={ctx.log}>
          <ObjectsPanel controller={controller} />
        </PanelErrorBoundary>
      ),
    });
    controller.setShowPanel(() => {
      panel.show();
    });
    ctx.services.provide(OBJECT_LIST, {
      open: (layerId) => {
        controller.open(layerId);
      },
    });
    // The symbol images are a nicety: without them the rows simply have no image (a `uses` key).
    ctx.services.get(SYMBOLS).then(
      (symbols) => {
        controller.attachSymbols(symbols);
      },
      (error: unknown) => {
        ctx.log.info('no symbol service: rows have no symbol image', error);
      },
    );
    ctx.services.get(MAP_VIEW).then(
      (map) => {
        controller.attachMapView(map);
        ctx.status.set('OK', 'ready');
      },
      (error: unknown) => {
        controller.mapViewFailed();
        ctx.log.warn('map view not available', error);
        ctx.status.set('DEGRADED', 'map view not available: objects cannot be selected and the menu has no map actions');
      },
    );
  },
});
