// The entry module ("web.entry" in plugin.json, built to dist/index.js). The shell imports it and
// calls activate(ctx) once, with a 10 s timeout. Register everything here; keep it fast.
import { definePlugin } from '@emc2/plugin-sdk';
import { Puzzle } from 'lucide-react';
import { GreetingPanel } from './GreetingPanel.tsx';
import './template.css';

export default definePlugin({
  activate(ctx) {
    const greeting = typeof ctx.settings['greeting'] === 'string' ? ctx.settings['greeting'] : '';
    // SDK 1.1.0: a panel with a default pane; the user may move it, so it must work in every pane (ADR-0031).
    // SDK 1.8.0: name once, icon always: the shell's head shows the title and the icon; the panel repeats neither.
    ctx.ui.addPanel({
      id: 'template',
      title: 'Template',
      icon: Puzzle,
      defaultPane: 'right',
      component: () => <GreetingPanel greeting={greeting} serverBase={ctx.serverBase} />,
    });
    ctx.status.set('OK', 'ready');
  },
});
