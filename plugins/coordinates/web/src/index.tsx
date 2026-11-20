// The entry module ("web.entry" in plugin.json, built to dist/index.js). The shell imports it and
// calls activate(ctx) once, with a 10 s timeout. The service is provided at once; the cursor
// display and "go to" follow when the map view is there, without holding up activate. The map
// view is in the manifest's "uses": the plugin also works without one (CR-0012).
import { COORDINATES, EVERY_WORKSPACE, MAP_VIEW, definePlugin, type MapView } from '@emc2/plugin-sdk';
import { CursorPosition } from './CursorPosition.tsx';
import { GoToControl } from './GoToControl.tsx';
import { localOpenStore } from './openStore.ts';
import { createCoordinateService, localFormatStore } from './service.ts';
import { readSettings, type Settings } from './settings.ts';
import { sharedState } from './state.ts';
import './coordinates.css';

export default definePlugin({
  activate(ctx) {
    const first = readSettings(ctx.settings);
    for (const problem of first.problems) ctx.log.warn(problem);
    const settings = sharedState<Settings>(first.settings);
    let problems = first.problems;

    const service = createCoordinateService(settings, localFormatStore());
    ctx.services.provide(COORDINATES, service);

    const mapView = sharedState<MapView | null>(null);
    // M4 (brief function 8): the format choice and "go to" are an icon over the map at the top right,
    // after the map view's "Map controls" (order 10), not a panel. Added at once, so that the format
    // choice works without a map view too.
    // SDK 1.2.0: the icon and the cursor display appear in every workspace (ADR-0039; briefs README,
    // M3 rule 1). The map view is one map that always shows the workspace shown, with that
    // workspace's own map state. The shell mounts both again on a switch (SDK CurrentWorkspace). In a
    // shell that kept them mounted, the window clears its last message and the cursor display its
    // last position, which were of the other workspace's map (owner, 2026-10-28; kept, 2026-10-29).
    const openStore = localOpenStore();
    ctx.ui.addMapPaneOverlay({
      id: 'coordinates-goto',
      position: 'top-right',
      order: 15,
      workspaces: [EVERY_WORKSPACE],
      component: () => <GoToControl service={service} mapView={mapView} settings={settings} workspace={ctx.workspace} openStore={openStore} />,
    });

    // The status needs both: whether the map view is there, and whether the settings were usable.
    let map: 'waiting' | 'ready' | 'unavailable' = 'waiting';
    const reportStatus = () => {
      if (map === 'waiting') return;
      const note = problems.length > 0 ? `; ${problems.join('; ')}` : '';
      if (map === 'unavailable') ctx.status.set('DEGRADED', `map view unavailable: no cursor position and no go to${note}`);
      else ctx.status.set(problems.length > 0 ? 'DEGRADED' : 'OK', `ready${note}`);
    };

    // SDK v1: settings change at runtime (CR-0012). The service and the components follow them.
    ctx.onSettingsChange((values) => {
      const next = readSettings(values);
      for (const problem of next.problems) ctx.log.warn(problem);
      problems = next.problems;
      settings.set(next.settings);
      reportStatus();
    });

    // "uses" (CR-0012): without a map view this rejects at once, and the service still works.
    ctx.services.get(MAP_VIEW).then(
      (view) => {
        mapView.set(view);
        ctx.ui.addMapPaneOverlay({
          id: 'coordinates-cursor',
          position: 'bottom-left',
          workspaces: [EVERY_WORKSPACE],
          component: () => <CursorPosition map={view} service={service} settings={settings} workspace={ctx.workspace} />,
        });
        map = 'ready';
        reportStatus();
      },
      (error: unknown) => {
        ctx.log.warn('map view unavailable', error);
        map = 'unavailable';
        reportStatus();
      },
    );
  },
});
