// The entry module ("web.entry" in plugin.json, built to dist/index.js). The shell imports it and
// calls activate(ctx) once, with a 10 s timeout. Everything it adds appears in Simulation only
// (brief function 11): the Cameras panel and the object action "New camera" (function 12).
import { Video } from 'lucide-react';
import { definePlugin, MAP_VIEW } from '@emc2/plugin-sdk';
import { CamerasModel } from './cameras.ts';
import { CAMERAS_TITLE, CamerasPanel } from './CamerasPanel.tsx';
import type { Rights } from './CamerasPanel.tsx';
import { CamerasServer } from './server.ts';
import './uav-simulation.css';

export const SIMULATION = 'simulator.simulation';
export const VIEW = 'plugin.uav-simulation.view';
export const EDIT = 'plugin.uav-simulation.edit';
export const RUN = 'plugin.uav-simulation.run';

const WORKSPACES = [SIMULATION];

export default definePlugin({
  activate(ctx) {
    // Without view the server refuses every read, so nothing is added (brief section 6).
    if (!ctx.user.has(VIEW)) {
      ctx.status.set('OK', `no ${VIEW}: nothing to show`);
      return;
    }
    const rights: Rights = { edit: ctx.user.has(EDIT), run: ctx.user.has(RUN) };
    const model = new CamerasModel(new CamerasServer(ctx.serverBase));
    const panel = ctx.ui.addPanel({
      id: 'cameras',
      title: CAMERAS_TITLE,
      icon: Video,
      defaultPane: 'right',
      order: 130,
      workspaces: WORKSPACES,
      component: () => <CamerasPanel model={model} rights={rights} />,
    });
    // Function 12: on one core.symbol, in Simulation, for users with edit. The server refuses an
    // object that is not in a Simulation layer, and opens the camera a track already has (U2).
    ctx.actions.addObjectAction({
      id: 'new-camera',
      label: 'New camera',
      icon: Video,
      group: 'simulator',
      order: 40,
      appliesTo: { types: ['core.symbol'] },
      multiple: false,
      permission: EDIT,
      workspaces: WORKSPACES,
      run: ([id]) => {
        if (id === undefined) return;
        panel.show();
        void model.newCamera(id).then((ok) => {
          if (!ok) ctx.notify({ severity: 'warning', message: model.getState().failure?.message ?? 'No camera was made' });
        });
      },
    });
    ctx.status.set('OK', 'ready');
    // "Use selection" for Track an object follows the map's selection; without a map view it stays off.
    ctx.services.get(MAP_VIEW).then(
      (map) => {
        model.setSelection(map.selection.value);
        map.selection.onChange((ids) => {
          model.setSelection(ids);
        });
      },
      (e: unknown) => {
        ctx.log.info('no map view: "Use selection" stays off', e);
      },
    );
  },
});
