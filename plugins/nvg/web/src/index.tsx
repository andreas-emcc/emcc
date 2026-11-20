// The entry module ("web.entry" in plugin.json, built to dist/index.js). The shell imports it and
// calls activate(ctx) once, with a 10 s timeout.
import { definePlugin } from '@emc2/plugin-sdk';
import { Network } from 'lucide-react';
import { NvgPanel } from './NvgPanel.tsx';
import './nvg.css';

export default definePlugin({
  activate(ctx) {
    // N1: the panel is in every workspace, in the right pane by default; the user may move it.
    // SDK 1.8.0 part C: its icon, the manifest's too (T-204).
    ctx.ui.addPanel({
      id: 'nvg',
      title: 'NVG',
      icon: Network,
      defaultPane: 'right',
      workspaces: ['*'],
      component: () => <NvgPanel ctx={ctx} />,
    });
    ctx.status.set('OK', 'ready');
  },
});
