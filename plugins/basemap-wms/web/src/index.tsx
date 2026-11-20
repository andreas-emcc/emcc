// The entry module ("web.entry" in plugin.json, built to dist/index.js). The shell imports it and calls activate(ctx) once,
// with a 10 s timeout, so nothing here waits for the server part: the first question about the offered backgrounds is sent
// and answered later (brief, function 5). The browser talks only to the emc2 server (ADR-0030).
import { definePlugin } from '@emc2/plugin-sdk';
import { BackgroundSync } from './providers.ts';
import { SettingsPanel } from './SettingsPanel.tsx';
import './basemap-wms.css';

export default definePlugin({
  activate(ctx) {
    // The plugin's entry in the Settings list shows this panel instead of the generated form (CR-0023). The shell shows
    // it to users with settings.admin only; it asks the server part for layers through endpoints that need it too.
    ctx.ui.setSettingsPanel({
      component: (props) => <SettingsPanel {...props} serverBase={ctx.serverBase} />,
    });

    const sync = new BackgroundSync(ctx);
    ctx.onSettingsChange((settings) => {
      sync.settingsChanged(settings);
    });
    sync.start();
    ctx.status.set('OK', 'ready');
  },
});
