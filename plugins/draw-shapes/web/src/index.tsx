// The entry module ("web.entry" in plugin.json, built to dist/index.js). The shell imports it and
// calls activate(ctx) once, with a 10 s timeout. The map view is required in the manifest, so its
// provider has activated before this runs.
import { Pencil, Shapes } from 'lucide-react';
import { definePlugin, EVERY_WORKSPACE, MAP_VIEW, VIEW_WORKSPACE } from '@emc2/plugin-sdk';
import { ShapesController } from './controller.ts';
import { EditPanel } from './EditPanel.tsx';
import { ShapesPanel } from './ShapesPanel.tsx';
import { LayerTracker } from './layers.ts';
import { ShapeWatch } from './watch.ts';
import { editPermissionOf, knownWorkspaces } from './workspace.ts';
import './draw-shapes.css';

/** The simulator's routes have their own editor ("Edit route"); Edit is not offered for them (brief, function 3; owner, 2026-10-30). */
const ROUTE_DATA_TYPE = 'simulator.route';

export default definePlugin({
  async activate(ctx) {
    // Two subscriptions, never one by the viewport (brief, function 7): the layers, all the time;
    // and, while a shape is open in the edit panel, a small fixed area round it (`ShapeWatch`).
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
    const watch = new ShapeWatch((listener, options) => ctx.livePicture.subscribe(listener, options));

    const map = await ctx.services.get(MAP_VIEW);
    const controller = new ShapesController(ctx, layers, watch, map, () =>
      // The edit panel exists while a shape is being edited (ADR-0031: it works in every pane).
      ctx.ui.addPanel({ id: 'draw-shapes-edit', title: 'Edit shape', icon: Pencil, defaultPane: 'right', workspaces: [EVERY_WORKSPACE], component: () => <EditPanel controller={controller} /> }),
    );

    ctx.ui.addPanel({ id: 'draw-shapes', title: 'Shapes', icon: Shapes, defaultPane: 'left', workspaces: [EVERY_WORKSPACE], component: () => <ShapesPanel controller={controller} /> });

    // Edit (ADR-0032 point 6): one shape, for users who may edit objects. It selects the shape and opens the edit panel.
    // Registered once per workspace, with that workspace's edit permission (`objects.edit` in View), so the shell offers each only where
    // the user may use it (function 10; workspace rule 4). The ids come from `ctx.workspaces`, never from this code.
    for (const workspace of knownWorkspaces(ctx)) {
      ctx.actions.addObjectAction({
        id: workspace.id === VIEW_WORKSPACE ? 'edit' : `edit:${workspace.id}`,
        label: 'Edit',
        icon: Pencil,
        group: 'edit',
        appliesTo: { types: ['core.shape'], test: (object) => object.dataType !== ROUTE_DATA_TYPE },
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
