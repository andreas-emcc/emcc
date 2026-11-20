import { definePlugin } from '@emc2/plugin-sdk';
import { FmvPanel, VideoWindows } from './FmvPanel.tsx';
import { createStreamsStore, createWindowsStore, hasLinks } from './store.ts';
import './fmv.css';

export default definePlugin({
  activate(ctx) {
    // The list is read only while a link is configured (and something shows it): a server without links is never asked.
    let configured = hasLinks(ctx.settings);
    const streams = createStreamsStore(ctx.serverBase, {
      get: () => configured,
      onChange: (listener) =>
        ctx.onSettingsChange((settings) => {
          configured = hasLinks(settings);
          listener(configured);
        }),
    });
    const windows = createWindowsStore();
    // A control panel in View (brief section 6); its icon is the manifest's.
    ctx.ui.addControlPanel({ id: 'fmv', title: 'FMV', workspaces: ['core.view'], component: () => <FmvPanel ctx={ctx} streams={streams} windows={windows} /> });
    // The windows stay open while the user works elsewhere, also when the panel's pane is closed: they sit in the map pane.
    ctx.ui.addMapPaneOverlay({
      id: 'fmv-windows',
      position: 'bottom-left',
      workspaces: ['*'],
      component: () => <VideoWindows ctx={ctx} streams={streams} windows={windows} />,
    });
    ctx.status.set('OK', 'ready');
  },
});

