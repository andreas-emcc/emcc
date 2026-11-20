// The entry module ("web.entry" in plugin.json, built to dist/index.js). The shell imports it and
// calls activate(ctx) once, with a 10 s timeout. The control is in the top bar at once; it follows
// the map view when there is one, without holding up activate. The map view and the coordinates
// are in the manifest's "uses": the plugin works without them (CR-0011).
import { COORDINATES, MAP_VIEW, definePlugin } from '@emc2/plugin-sdk';
import { BookmarksControl } from './BookmarksControl.tsx';
import { BookmarksController } from './controller.ts';
import { readMaxItems } from './settings.ts';
import { BookmarkStore } from './store.ts';
import './bookmarks.css';

export default definePlugin({
  activate(ctx) {
    let setting = readMaxItems(ctx.settings);
    const controller = new BookmarksController({
      store: new BookmarkStore(ctx.userDocuments),
      newId: () => ctx.newId(),
      notify: (notification) => {
        ctx.notify(notification);
      },
      logError: (message, error) => {
        ctx.log.error(message, error);
      },
      maxItems: setting.value,
    });
    ctx.ui.addTopBarItem({ id: 'bookmarks', order: 0, component: () => <BookmarksControl controller={controller} /> });

    // The status needs both: whether the map view is there, and whether the setting was usable.
    let map: 'waiting' | 'ready' | 'none' = 'waiting';
    const reportStatus = () => {
      if (map === 'waiting') return;
      const problems = [map === 'none' ? 'No map view' : null, setting.problem].filter((p) => p !== null);
      if (problems.length > 0) ctx.status.set('DEGRADED', problems.join('; '));
      else ctx.status.set('OK', 'ready');
    };

    // Settings change at runtime (SDK v1): the limit follows at once.
    ctx.onSettingsChange((values) => {
      setting = readMaxItems(values);
      if (setting.problem !== null) ctx.log.warn(setting.problem);
      controller.setMaxItems(setting.value);
      reportStatus();
    });

    // "uses": without a provider these reject at once, and the plugin goes on without the service.
    ctx.services.get(MAP_VIEW).then(
      (view) => {
        controller.setMap(view);
        map = 'ready';
        reportStatus();
      },
      (error: unknown) => {
        ctx.log.warn('map view unavailable', error);
        controller.setMap(null);
        map = 'none';
        reportStatus();
      },
    );
    ctx.services.get(COORDINATES).then(
      (service) => {
        controller.setCoordinates(service);
      },
      () => {
        controller.setCoordinates(null);
      },
    );
  },
});
