import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  BACKGROUND_MAP, PLUGIN_ICONS, fieldHint, fieldWidth, pluginIcon, settingsHintsProblem,
  type BackgroundMapProvider, type JsonValue, type SettingsSchema, type VectorFeature, type VectorSource,
} from '@emc2/plugin-sdk';
import { createFakeContext, createFakeVectorBackground } from '@emc2/plugin-sdk/testing';
import manifest from '../../plugin.json' with { type: 'json' };
import pkg from '../package.json' with { type: 'json' };
import plugin from '../src/index.tsx';

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The settings as the shell passes them when nothing is configured: the default of every setting. */
function settingDefaults(): Record<string, JsonValue> {
  return Object.fromEntries(Object.entries(manifest.settings.properties).map(([name, schema]) => [name, schema.default]));
}

async function activated(settings: Record<string, JsonValue> = settingDefaults()) {
  const ctx = createFakeContext({ pluginId: manifest.id, settings, provides: manifest.provides });
  await plugin.activate(ctx);
  return ctx;
}

function vectorOf(provider: BackgroundMapProvider): VectorSource {
  if (provider.source.type !== 'vector') throw new Error('not a vector source');
  return provider.source;
}

async function provider(settings?: Record<string, JsonValue>): Promise<BackgroundMapProvider> {
  const ctx = await activated(settings);
  const [only, ...others] = ctx.services.getAll(BACKGROUND_MAP).current;
  expect(others).toEqual([]);
  if (!only) throw new Error('no background map provided');
  return only;
}

/** Relative luminance of a `#rrggbb` colour, enough to tell which of two is lighter. */
function luminance(hex: string): number {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const SAMPLE: VectorFeature[] = [
  { layer: 'land', geometry: { type: 'Polygon', coordinates: [[[18, -34], [19, -34], [19, -33], [18, -34]]] } },
  { layer: 'borders', geometry: { type: 'LineString', coordinates: [[10, 50], [11, 51]] } },
];

describe('basemap-naturalearth web part', () => {
  it('is named after the plugin id', () => {
    // npm refuses two workspaces with the same name, so a copy must rename the package.
    expect(pkg.name).toBe(`@emc2/plugin-${manifest.id}`);
  });

  it('declares the service it provides, has no server part, no CSS and no internet access (brief)', () => {
    expect(manifest.provides).toEqual(['emc2.background-map']);
    expect('server' in manifest).toBe(false);
    expect('css' in manifest.web).toBe(false);
    expect('internet' in manifest).toBe(false);
    expect('network' in manifest).toBe(false);
  });

  // T-204 (SDK 1.8.0 parts C and D): the icon, and the settings form's hints. The plugin has no panel (part C).
  it('T-204: names SDK ^1.8.0, the icon Globe, and a settings hint that the SDK accepts', () => {
    expect(manifest.sdkVersion).toBe('^1.8.0');
    expect(manifest.icon).toBe('Globe');
    expect(Object.keys(PLUGIN_ICONS)).toContain(manifest.icon);
    expect(pluginIcon(manifest.icon)).not.toBeNull();
    expect(settingsHintsProblem(manifest.settings)).toBeNull();
    const showBorders = manifest.settings.properties.showBorders as unknown as SettingsSchema;
    const { hint, more } = fieldHint(showBorders);
    expect(hint?.length ?? 0).toBeGreaterThan(0);
    expect(hint?.length ?? 81).toBeLessThanOrEqual(80);
    expect(more).toBe(manifest.settings.properties.showBorders.description);
    expect(fieldWidth(showBorders)).toBe('short');
  });

  // Acceptance criterion 1 (offered in every projection; the drawing is the browser check)
  it('provides one vector background "Natural Earth" that is offered in every projection', async () => {
    const naturalEarth = await provider();
    expect(naturalEarth.name).toBe('Natural Earth');
    expect(naturalEarth.projections).toBe('any');
    expect(naturalEarth.source.type).toBe('vector');
  });

  // Acceptance criterion 1, and function 6 (the credit)
  it('carries the credit "Made with Natural Earth"', async () => {
    expect((await provider()).attribution.text).toBe('Made with Natural Earth');
  });

  it('has the same shape as the SDK test kit\'s vector background', async () => {
    const fake = createFakeVectorBackground();
    const ours = await provider();
    expect(Object.keys(ours).sort()).toEqual(Object.keys(fake).filter((k) => k !== 'loadCalls').sort());
    expect(Object.keys(vectorOf(ours)).sort()).toEqual(Object.keys(vectorOf(fake)).sort());
    expect(ours.projections).toBe(fake.projections);
  });

  // Function 2 and 3: five layers in drawing order, muted style, no labels
  it('draws land, ice shelves, lakes, coastline and borders, in that order', async () => {
    expect(vectorOf(await provider()).layers.map((l) => l.id)).toEqual(['land', 'ice-shelves', 'lakes', 'coastline', 'borders']);
  });

  it('fills the polygon layers without an outline, and draws coastline and borders as lines', async () => {
    const layers = new Map(vectorOf(await provider()).layers.map((l) => [l.id, l.style]));
    for (const id of ['land', 'ice-shelves', 'lakes']) {
      expect(layers.get(id)?.fillColor).toMatch(/^#[0-9a-f]{6}$/);
      expect(layers.get(id)?.strokeColor).toBeUndefined();
      expect(layers.get(id)?.strokeWidth).toBeUndefined();
    }
    for (const id of ['coastline', 'borders']) {
      expect(layers.get(id)?.strokeColor).toMatch(/^#[0-9a-f]{6}$/);
      expect(layers.get(id)?.strokeWidth).toBeGreaterThan(0);
      expect(layers.get(id)?.fillColor).toBeUndefined();
    }
    // Borders are thinner than the coastline.
    expect(layers.get('borders')?.strokeWidth).toBeLessThan(layers.get('coastline')?.strokeWidth ?? 0);
  });

  it('draws the ice shelves lighter than land, and lakes in the water colour', async () => {
    const source = vectorOf(await provider());
    const fill = (id: string) => source.layers.find((l) => l.id === id)?.style.fillColor ?? '';
    expect(luminance(fill('ice-shelves'))).toBeGreaterThan(luminance(fill('land')));
    expect(source.background).toBeDefined();
    expect(fill('lakes')).toBe(source.background);
  });

  // Acceptance criterion 8: nothing is loaded while another background is shown
  it('makes no request while activating, nor when the provider is only registered', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const naturalEarth = await provider();
    expect(vectorOf(naturalEarth).layers.length).toBe(5);
    expect(fetch).not.toHaveBeenCalled();
  });

  // Acceptance criterion 4 (jsdom part: the one URL this plugin fetches is its own file)
  it('loads its data from its own built files only, and only when load() is called', async () => {
    const fetch = vi.fn(() => Promise.resolve(Response.json({ features: SAMPLE })));
    vi.stubGlobal('fetch', fetch);
    const ctx = await activated();
    const [naturalEarth] = ctx.services.getAll(BACKGROUND_MAP).current;
    expect(fetch).not.toHaveBeenCalled();
    const loaded = await vectorOf(naturalEarth as BackgroundMapProvider).load();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(`${ctx.webBase}data/natural-earth.json`);
    expect(ctx.webBase).toBe('/plugins/basemap-naturalearth/web/');
    const url = (fetch.mock.calls as unknown as string[][])[0]?.[0] ?? '';
    expect(url).not.toMatch(/^[a-z]+:/i);
    expect(url).not.toMatch(/^\/\//);
    expect(loaded.features).toEqual(SAMPLE);
  });

  it('rejects load() when the data cannot be fetched, so the map view shows "background unavailable"', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('missing', { status: 404 }))));
    const naturalEarth = await provider();
    await expect(vectorOf(naturalEarth).load()).rejects.toThrow('HTTP 404');
  });

  // Settings: "Show country borders" (default yes)
  it('shows the borders by default', () => {
    expect(settingDefaults()).toEqual({ showBorders: true });
  });

  it('leaves out the borders layer, and its features, when the setting is off', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(Response.json({ features: SAMPLE }))));
    const naturalEarth = await provider({ showBorders: false });
    const source = vectorOf(naturalEarth);
    expect(source.layers.map((l) => l.id)).toEqual(['land', 'ice-shelves', 'lakes', 'coastline']);
    expect((await source.load()).features.map((f) => f.layer)).toEqual(['land']);
  });

  it.each(['yes', 1, null])('reports a bad showBorders setting (%s) and shows the borders', async (bad) => {
    const ctx = await activated({ showBorders: bad as JsonValue });
    expect(vectorOf(ctx.services.getAll(BACKGROUND_MAP).current[0] as BackgroundMapProvider).layers.map((l) => l.id)).toContain('borders');
    expect(ctx.statusHistory.at(-1)?.state).toBe('DEGRADED');
    expect(ctx.logs.some((l) => l.level === 'warn')).toBe(true);
  });

  it('reports OK with the default settings', async () => {
    const ctx = await activated();
    expect(ctx.statusHistory.at(-1)).toEqual({ state: 'OK', detail: 'ready' });
  });
});
