import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BACKGROUND_MAP,
  fieldHint,
  fieldWidth,
  formSections,
  pluginIcon,
  settingsHintsProblem,
  type BackgroundMapProvider,
  type JsonValue,
  type SettingsSchema,
} from '@emc2/plugin-sdk';
import { createFakeContext } from '@emc2/plugin-sdk/testing';
import manifest from '../../plugin.json' with { type: 'json' };
import pkg from '../package.json' with { type: 'json' };
import plugin from '../src/index.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The settings as the shell passes them in SDK v0: the default of every setting. */
function settingDefaults(): Record<string, JsonValue> {
  return Object.fromEntries(Object.entries(manifest.settings.properties).map(([name, schema]) => [name, schema.default]));
}

async function activated(settings: Record<string, JsonValue> = settingDefaults()) {
  const ctx = createFakeContext({ pluginId: manifest.id, settings, provides: manifest.provides });
  await plugin.activate(ctx);
  return ctx;
}

async function provider(settings?: Record<string, JsonValue>): Promise<BackgroundMapProvider> {
  const ctx = await activated(settings);
  const [only, ...others] = ctx.services.getAll(BACKGROUND_MAP).current;
  expect(others).toEqual([]);
  if (!only) throw new Error('no background map provided');
  return only;
}

/** The tile source of a provider: SDK v1 allows a vector source too, which this plugin never uses. */
function xyz(osm: BackgroundMapProvider | undefined): Extract<BackgroundMapProvider['source'], { type: 'xyz' }> {
  if (osm?.source.type !== 'xyz') throw new Error('basemap-osm must provide an XYZ tile source');
  return osm.source;
}

describe('basemap-osm web part', () => {
  it('is named after the plugin id', () => {
    // npm refuses two workspaces with the same name, so a copy must rename the package.
    expect(pkg.name).toBe(`@emc2/plugin-${manifest.id}`);
  });

  it('declares the service it provides and no CSS', () => {
    expect(manifest.provides).toEqual(['emc2.background-map']);
    expect('css' in manifest.web).toBe(false);
  });

  // Acceptance criterion 1 (the attribution and the projection; the pixels are the ITA's browser test)
  it('provides one background map "OpenStreetMap" in EPSG:3857 with zoom 0-19', async () => {
    const osm = await provider();
    expect(osm.name).toBe('OpenStreetMap');
    expect(osm.source).toMatchObject({ type: 'xyz', minZoom: 0, maxZoom: 19, tileSize: 256 });
  });

  it('carries the attribution the OSM licence requires, with a link to the copyright page', async () => {
    const osm = await provider();
    expect(osm.attribution).toEqual({ text: '© OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' });
  });

  // Acceptance criterion 2
  it('is offered in EPSG:3857 only, not in other projections such as EPSG:3413', async () => {
    const osm = await provider();
    expect(osm.projections).toEqual(['EPSG:3857']);
    expect(osm.projections).not.toContain('EPSG:3413');
  });

  // Acceptance criterion 3 (jsdom part: every URL the web part gives out points at the emc2 server)
  it('points its tiles at its own server part, never at another host', async () => {
    const ctx = await activated();
    const [osm] = ctx.services.getAll(BACKGROUND_MAP).current;
    expect(xyz(osm).url).toBe(`${ctx.serverBase}tiles/{z}/{x}/{y}.png`);
    expect(xyz(osm).url.startsWith('/api/plugins/basemap-osm/')).toBe(true);
    expect(xyz(osm).url).not.toMatch(/^[a-z]+:/i);
    expect(xyz(osm).url).not.toMatch(/^\/\//);
  });

  it('makes no request while activating', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    await activated();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('takes the highest zoom from the settings', async () => {
    const osm = await provider({ ...settingDefaults(), maxZoom: 12 });
    expect(xyz(osm).maxZoom).toBe(12);
  });

  it.each([20, -1, 3.5, '12', null])('reports a bad maxZoom setting (%s) and uses 19', async (bad) => {
    const ctx = await activated({ ...settingDefaults(), maxZoom: bad as JsonValue });
    expect(xyz(ctx.services.getAll(BACKGROUND_MAP).current[0]).maxZoom).toBe(19);
    expect(ctx.statusHistory.at(-1)?.state).toBe('DEGRADED');
    expect(ctx.logs.some((l) => l.level === 'warn')).toBe(true);
  });

  // SDK v1: settings changes from the settings view apply without a reload (owner, 2026-10-12)
  it('follows a change of the maxZoom setting without a reload', async () => {
    const ctx = await activated();
    const [osm] = ctx.services.getAll(BACKGROUND_MAP).current;
    expect(xyz(osm).maxZoom).toBe(19);

    ctx.changeSettings({ ...settingDefaults(), maxZoom: 10 });

    expect(xyz(osm).maxZoom).toBe(10);
    expect(ctx.services.getAll(BACKGROUND_MAP).current).toEqual([osm]);
    expect(ctx.statusHistory.at(-1)).toEqual({ state: 'OK', detail: 'ready' });
  });

  it('keeps the maxZoom in force and reports a bad one in a settings change', async () => {
    const ctx = await activated({ ...settingDefaults(), maxZoom: 12 });
    const [osm] = ctx.services.getAll(BACKGROUND_MAP).current;

    ctx.changeSettings({ ...settingDefaults(), maxZoom: 25 });
    expect(xyz(osm).maxZoom).toBe(12);
    expect(ctx.statusHistory.at(-1)?.state).toBe('DEGRADED');
    expect(ctx.logs.some((l) => l.level === 'warn')).toBe(true);

    ctx.changeSettings({ ...settingDefaults(), maxZoom: 8 });
    expect(xyz(osm).maxZoom).toBe(8);
    expect(ctx.statusHistory.at(-1)).toEqual({ state: 'OK', detail: 'ready' });
  });

  it('reports OK with the default settings', async () => {
    const ctx = await activated();
    expect(ctx.statusHistory.at(-1)).toEqual({ state: 'OK', detail: 'ready' });
  });

  // T-204 (SDK 1.8.0 part D; owner UZ A): the settings form's groups, hints, units and widths, and the manifest's icon.
  it('T-204: the settings schema passes the SDK hint check and the manifest has the icon Map', () => {
    expect(settingsHintsProblem(manifest.settings)).toBeNull();
    expect(manifest.icon).toBe('Map');
    expect(pluginIcon(manifest.icon)).not.toBeNull();
    expect(manifest.sdkVersion).toBe('^1.8.0');
  });

  it('T-204: the form has two groups, every setting in one, a hint on every long description, units and widths', () => {
    const settings = manifest.settings as SettingsSchema;
    const sections = formSections(settings);
    expect(sections.map((s) => [s.label, s.properties])).toEqual([
      ['Upstream', ['upstreamUrl', 'upstreamTimeoutSeconds']],
      ['Tiles served', ['maxZoom', 'cacheTiles']],
    ]);
    expect(sections.flatMap((s) => s.properties).sort()).toEqual(Object.keys(manifest.settings.properties).sort());
    for (const [name, property] of Object.entries(settings.properties ?? {})) {
      const { hint } = fieldHint(property);
      if ((property.description ?? '').length > 80) expect(hint, `${name}: a long description has a hint`).not.toBeNull();
      expect(hint === null || hint.length <= 80, name).toBe(true);
    }
    const properties = manifest.settings.properties;
    expect(properties.cacheTiles['x-emc2'].unit).toBe('tiles');
    expect(properties.upstreamTimeoutSeconds['x-emc2'].unit).toBe('s');
    expect(fieldWidth(properties.upstreamUrl as SettingsSchema)).toBe('full');
    expect(fieldWidth(properties.maxZoom as SettingsSchema)).toBe('short');
  });
});
