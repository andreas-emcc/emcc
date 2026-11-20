// The entry module ("web.entry" in plugin.json, built to dist/index.js). The shell imports it and
// calls activate(ctx) once, with a 10 s timeout. The services are required in the manifest, so
// their providers have activated before this runs.
import { Crosshair, Pencil } from 'lucide-react';
import { definePlugin, EVERY_WORKSPACE, MAP_VIEW, SYMBOLS, VIEW_WORKSPACE } from '@emc2/plugin-sdk';
import { GraphicsController } from './controller.ts';
import { EditPanel } from './EditPanel.tsx';
import { GraphicsPanel } from './GraphicsPanel.tsx';
import { LayerTracker } from './layers.ts';
import { GraphicWatch } from './watch.ts';
import { editPermissionOf, knownWorkspaces } from './workspace.ts';
import './draw-tactical.css';

export default definePlugin({
  async activate(ctx) {
    // Two subscriptions, never one by the viewport (brief, function 9): the layers, all the time;
    // and, while a graphic is open in the edit panel or selected, a small fixed area round it (`GraphicWatch`).
    const layers = new LayerTracker();
    ctx.livePicture.subscribe(
      {
        snapshot: (snapshot) => {
          layers.snapshot(snapshot);
        },
        changes: (batch) => {
          layers.changes(batch);
        },
      },
      { objects: false },
    );
    const watch = new GraphicWatch((listener, options) => ctx.livePicture.subscribe(listener, options));

    let services;
    try {
      services = await Promise.all([ctx.services.get(MAP_VIEW), ctx.services.get(SYMBOLS)] as const);
    } catch (error) {
      ctx.status.set('FAILED', 'a service this plugin needs is not available');
      throw error;
    }
    const [map, symbols] = services;

    const controller = new GraphicsController(ctx, symbols, layers, watch, map, () =>
      // The edit panel exists while a graphic is being edited (ADR-0031: it works in every pane).
      ctx.ui.addPanel({
        id: 'draw-tactical-edit',
        title: 'Edit graphic',
        icon: Pencil,
        defaultPane: 'right',
        workspaces: [EVERY_WORKSPACE],
        component: () => <EditPanel controller={controller} symbols={symbols} />,
      }),
    );

    ctx.ui.addPanel({
      id: 'draw-tactical',
      title: 'Graphics',
      icon: Crosshair,
      defaultPane: 'left',
      workspaces: [EVERY_WORKSPACE],
      component: () => <GraphicsPanel controller={controller} />,
    });

    // Edit (ADR-0032 point 6): one tactical graphic, for users who may edit objects. It selects the graphic and opens the edit panel.
    // Registered once per workspace, with that workspace's edit permission (`objects.edit` in View), so the shell offers each only where
    // the user may use it (brief, function 10). The ids come from `ctx.workspaces`, never from this code.
    for (const workspace of knownWorkspaces(ctx)) {
      ctx.actions.addObjectAction({
        id: workspace.id === VIEW_WORKSPACE ? 'edit' : `edit:${workspace.id}`,
        label: 'Edit',
        icon: Pencil,
        group: 'edit',
        appliesTo: { types: ['core.multipoint'] },
        multiple: false,
        workspaces: [workspace.id],
        permission: editPermissionOf(workspace),
        run: async (ids) => {
          const id = ids[0];
          if (id !== undefined) await controller.openEditor(id);
        },
      });
    }
  },
});
