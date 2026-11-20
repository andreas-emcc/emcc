// The entry module ("web.entry" in plugin.json, built to dist/index.js). The shell imports it and
// calls activate(ctx) once, with a 10 s timeout. The services are required in the manifest, so
// their providers have activated before this runs.
import { Pencil, Shapes, SlidersHorizontal } from 'lucide-react';
import { COORDINATES, definePlugin, EVERY_WORKSPACE, MAP_VIEW, PERMISSIONS, SYMBOLS, VIEW_WORKSPACE } from '@emc2/plugin-sdk';
import { DrawController } from './controller.ts';
import { PropertiesPanel } from './PropertiesPanel.tsx';
import { SymbolsPanel } from './SymbolsPanel.tsx';
import { ObjectTracker } from './tracker.ts';
import './draw-symbols.css';

export default definePlugin({
  async activate(ctx) {
    // Subscribed at once, so no snapshot is missed while the services are being awaited. The plugin needs the
    // layers always and one object at a time: the layers come from a subscription with `objects: false`; the
    // selected symbol from a small area round it, which the controller subscribes and ends (watch.ts; brief
    // function 8). It does not subscribe to the viewport: that reads the whole view on every map move.
    const tracker = new ObjectTracker();
    ctx.livePicture.subscribe(
      {
        snapshot: (snapshot) => {
          tracker.layerSnapshot(snapshot);
        },
        changes: (batch) => {
          tracker.changes(batch);
        },
      },
      { objects: false },
    );

    let services;
    try {
      services = await Promise.all([ctx.services.get(MAP_VIEW), ctx.services.get(SYMBOLS), ctx.services.get(COORDINATES)] as const);
    } catch (error) {
      ctx.status.set('FAILED', 'a service this plugin needs is not available');
      throw error;
    }
    const [map, symbols, coordinates] = services;

    const controller = new DrawController(ctx, tracker, map);
    // "Symbols" starts in the left pane and "Symbol properties" in the right (owner, 2026-10-30); both work in every pane (ADR-0031). The map view selects and the shell's
    // shared Delete deletes (ADR-0032), so this plugin has no click selection, no Delete and no key handler.
    ctx.ui.addPanel({
      id: 'draw-symbols-symbols',
      title: 'Symbols',
      icon: Shapes,
      defaultPane: 'left',
      order: 20,
      workspaces: [EVERY_WORKSPACE],
      component: () => <SymbolsPanel controller={controller} symbols={symbols} />,
    });
    const properties = ctx.ui.addPanel({
      id: 'draw-symbols-properties',
      title: 'Symbol properties',
      icon: SlidersHorizontal,
      defaultPane: 'right',
      order: 21,
      workspaces: [EVERY_WORKSPACE],
      component: () => <PropertiesPanel controller={controller} symbols={symbols} coordinates={coordinates} />,
    });
    // Edit (ADR-0032 point 6): one symbol; the menu starts it, the user may then change the symbol in the panel. Registered once per
    // workspace (M3 rule 4), with that workspace's edit permission, so that the shell offers it only where the user may edit.
    for (const workspace of ctx.workspaces) {
      ctx.actions.addObjectAction({
        id: workspace.id === VIEW_WORKSPACE ? 'edit' : `edit:${workspace.id}`,
        label: 'Edit',
        icon: Pencil,
        group: 'edit',
        appliesTo: { types: ['core.symbol'] },
        multiple: false,
        permission: workspace.editPermission ?? PERMISSIONS.objectsEdit,
        workspaces: [workspace.id],
        run: ([id]) => {
          if (id === undefined) return;
          controller.select(id);
          properties.show();
        },
      });
    }
  },
});
