// The entry module ("web.entry" in plugin.json, built to dist/index.js). The shell imports it and
// calls activate(ctx) once, with a 10 s timeout. The panel is added at once for a user who may use
// the tools (the server checks every call anyway); the map view comes from `requires`.
import { COORDINATES, EVERY_WORKSPACE, MAP_VIEW, definePlugin, pluginIcon, type CoordinateService } from '@emc2/plugin-sdk';
import { DEFAULT_MAX_RANGE, TerrainController } from './controller.ts';
import { TerrainPanel } from './TerrainPanel.tsx';
import './terrain.css';

/** The panel's icon: the manifest's `icon` (a test keeps the two the same). */
const PANEL_ICON = 'Mountain';

/** The permission both tools and every endpoint need (the brief's "Permissions"). */
const PERMISSION = 'plugin.terrain.use';

/** The admin's longest range from the settings, or the default when the setting is unusable. */
function maxRangeOf(settings: Readonly<Record<string, unknown>>): number {
  const value = settings['maxRange'];
  return typeof value === 'number' && Number.isFinite(value) && value >= 1000 && value <= 200_000 ? value : DEFAULT_MAX_RANGE;
}

export default definePlugin({
  async activate(ctx) {
    if (!ctx.user.has(PERMISSION)) {
      // Users without the permission do not see the panel (the brief's function 1).
      ctx.status.set('OK', `no panel: the user lacks ${PERMISSION}`);
      return;
    }
    const mapView = await ctx.services.get(MAP_VIEW);
    // "uses": the coordinate service gives the user's chosen format; without it positions are decimal degrees.
    const coordinates: CoordinateService | null = await ctx.services.get(COORDINATES).catch(() => null);
    const controller = new TerrainController({
      mapView,
      overlay: mapView.createOverlay(),
      heightMapOverlay: mapView.createOverlay(),
      heightMarkerOverlay: mapView.createOverlay(),
      serverBase: ctx.serverBase,
      maxRange: maxRangeOf(ctx.settings),
      log: ctx.log,
    });
    ctx.onSettingsChange((settings) => {
      controller.setMaxRange(maxRangeOf(settings));
      void controller.refreshStatus();
    });
    const icon = pluginIcon(PANEL_ICON);
    // Both tools are in every workspace (assumption A1), by default in the right pane.
    ctx.ui.addPanel({
      id: 'terrain',
      title: 'Terrain',
      // The manifest's icon (Mountain) is also the panel's: every panel of a ^1.8.0 plugin has one (SDK 1.8.0 part C).
      ...(icon === null ? {} : { icon }),
      defaultPane: 'right',
      workspaces: [EVERY_WORKSPACE],
      component: () => <TerrainPanel controller={controller} coordinates={coordinates} />,
    });
    void controller.refreshStatus();
    ctx.status.set('OK', 'ready');
  },
});
