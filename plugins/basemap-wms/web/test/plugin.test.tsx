// The backgrounds this plugin provides (brief, function 5) and the criteria that concern them: 1, 2, 5, 6, 11, 12, 13, 19.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import { BACKGROUND_MAP } from '@emc2/plugin-sdk';
import type { BackgroundMapProvider, WmsSource } from '@emc2/plugin-sdk';
import { checkLookCss, createFakeContext, wmsGetMapUrl } from '@emc2/plugin-sdk/testing';
import manifest from '../../plugin.json' with { type: 'json' };
import pkg from '../package.json' with { type: 'json' };
import plugin from '../src/index.tsx';
import { AFTER_CHANGE_MS, BackgroundSync, IDLE_POLL_MS, READING_POLL_MS } from '../src/providers.ts';
import { FakeServerPart, SERVER_BASE, background, server, settings } from './fakeServer.ts';

let fake: FakeServerPart;
let starts: MockInstance<BackgroundSync['start']>;

beforeEach(() => {
  vi.useFakeTimers();
  starts = vi.spyOn(BackgroundSync.prototype, 'start');
  fake = new FakeServerPart();
  fake.install();
});

afterEach(() => {
  // every activation of a test ends here, so that none keeps asking or listening
  for (const sync of starts.mock.contexts as BackgroundSync[]) sync.stop();
  starts.mockRestore();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  Object.defineProperty(globalThis.document, 'visibilityState', { configurable: true, value: 'visible' });
});

/** Lets the pending fetches and their promise chains settle without moving the clock. */
async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

async function started(initial = settings([server('geo')], [background('topo', 'geo', ['land', 'sea'])])) {
  fake.offered = [{ id: 'topo', projections: ['EPSG:3857', 'EPSG:3413'] }];
  const ctx = createFakeContext({ pluginId: manifest.id, settings: initial, provides: manifest.provides });
  await plugin.activate(ctx);
  await settle();
  return ctx;
}

function provided(ctx: ReturnType<typeof createFakeContext>): readonly BackgroundMapProvider[] {
  return ctx.services.getAll(BACKGROUND_MAP).current;
}

function wms(provider: BackgroundMapProvider): WmsSource {
  if (provider.source.type !== 'wms') throw new Error('not a wms source');
  return provider.source;
}

describe('the package', () => {
  it('is named after the plugin id', () => {
    expect(pkg.name).toBe(`@emc2/plugin-${manifest.id}`);
  });

  it('lists the CSS file the build writes (<id>.css) and provides the background map key', () => {
    expect(manifest.web.css).toEqual([`${manifest.id}.css`]);
    expect(manifest.provides).toEqual([BACKGROUND_MAP.id]);
  });

  it('uses design tokens only: the test kit’s checkLookCss finds nothing', () => {
    const css = readFileSync(join(import.meta.dirname, '../src/basemap-wms.css'), 'utf8');
    expect(checkLookCss(css, { pluginId: manifest.id })).toEqual([]);
  });
});

describe('one provider per offered background (criteria 1, 2 and 5)', () => {
  it('provides the background with its name, attribution, projections and a wms source on its own endpoint', async () => {
    const ctx = await started();

    const [topo] = provided(ctx);
    expect(provided(ctx)).toHaveLength(1);
    expect(topo?.id).toBe('basemap-wms.topo');
    expect(topo?.name).toBe('Background topo');
    expect(topo?.attribution).toEqual({ text: '(c) topo', url: 'https://example.org/copyright' });
    // the projections come from the server part's offer, the rest from the settings
    expect(topo?.projections).toEqual(['EPSG:3857', 'EPSG:3413']);
    expect(topo && wms(topo)).toEqual({
      type: 'wms',
      url: `${SERVER_BASE}map/topo`,
      layers: ['land', 'sea'],
      version: '1.3.0',
      format: 'image/png',
      transparent: false,
      mode: 'tiles',
    });
  });

  it('draws a background set to one image as an image, and takes the server’s version, the format and transparency', async () => {
    fake.offered = [{ id: 'photo', projections: ['EPSG:3857'] }];
    const ctx = createFakeContext({
      pluginId: manifest.id,
      settings: settings([server('old', 'http://old.test/ows', '1.1.1')], [background('photo', 'old', ['a'], { mode: 'image', format: 'image/jpeg' })]),
    });
    await plugin.activate(ctx);
    await settle();

    const [photo] = provided(ctx);
    expect(photo && wms(photo)).toMatchObject({ mode: 'image', version: '1.1.1', format: 'image/jpeg', transparent: false });
  });

  it('gives the map view the polar background in the polar projections the server offers', async () => {
    fake.offered = [{ id: 'polar', projections: ['EPSG:3413', 'EPSG:3031'] }];
    const ctx = createFakeContext({ pluginId: manifest.id, settings: settings([server('geo')], [background('polar', 'geo', ['group'])]) });
    await plugin.activate(ctx);
    await settle();

    expect(provided(ctx)[0]?.projections).toEqual(['EPSG:3413', 'EPSG:3031']);
  });

  it('leaves out a background the server part does not offer, and one the settings do not have', async () => {
    fake.offered = [{ id: 'ghost', projections: ['EPSG:3857'] }];
    const ctx = createFakeContext({ pluginId: manifest.id, settings: settings([server('geo')], [background('topo', 'geo', ['land'])]) });
    await plugin.activate(ctx);
    await settle();

    expect(provided(ctx)).toEqual([]);
  });

  it('lets the map view build GetMap URLs on the plugin’s endpoint, in the layers’ order, matching the server part’s tests', async () => {
    const ctx = await started();
    const [topo] = provided(ctx);
    if (!topo) throw new Error('nothing provided');

    const url = wmsGetMapUrl(wms(topo), { projection: 'EPSG:3857', bbox: [-100, -50, 100, 50], width: 256, height: 256 });

    // the same query string as MapRequestTest.webMercatorQuery() on the server side
    expect(url).toBe(
      `${SERVER_BASE}map/topo?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0&LAYERS=land%2Csea&STYLES=&FORMAT=image%2Fpng&TRANSPARENT=FALSE&CRS=EPSG%3A3857` +
        '&BBOX=-100%2C-50%2C100%2C50&WIDTH=256&HEIGHT=256',
    );
  });

  it('asks latitude first in EPSG:4326 with WMS 1.3.0 and longitude first with 1.1.1 (criterion 4, the same area)', async () => {
    const ctx = await started();
    const [topo] = provided(ctx);
    if (!topo) throw new Error('nothing provided');
    const box = { projection: 'EPSG:4326', bbox: [10, 55, 20, 65] as const, width: 256, height: 256 };

    expect(wmsGetMapUrl(wms(topo), box)).toContain('CRS=EPSG%3A4326&BBOX=55%2C10%2C65%2C20');
    expect(wmsGetMapUrl({ ...wms(topo), version: '1.1.1' }, box)).toContain('SRS=EPSG%3A4326&BBOX=10%2C55%2C20%2C65');
  });

  it('does not wait for the server part: activate returns while the first question is open', async () => {
    fake.hang = true;
    const ctx = createFakeContext({ pluginId: manifest.id, settings: settings([server('geo')], [background('topo', 'geo', ['land'])]) });

    await plugin.activate(ctx);

    expect(provided(ctx)).toEqual([]);
    expect(fake.urls).toEqual([`${SERVER_BASE}backgrounds`]);
    expect(ctx.statusHistory.at(-1)?.state).toBe('OK');
  });

  it('adds the settings panel, instead of the generated form', async () => {
    const ctx = await started();

    expect(ctx.settingsPanel).not.toBeNull();
  });
});

describe('changes apply at once (criterion 12)', () => {
  it('takes back a removed background and replaces a changed one, without a reload and without asking the server part', async () => {
    const ctx = await started(settings([server('geo')], [background('topo', 'geo', ['land', 'sea']), background('polar', 'geo', ['group'])]));
    fake.offered = [{ id: 'topo', projections: ['EPSG:3857'] }, { id: 'polar', projections: ['EPSG:3413'] }];
    await vi.advanceTimersByTimeAsync(IDLE_POLL_MS);
    expect(provided(ctx).map((p) => p.id)).toEqual(['basemap-wms.topo', 'basemap-wms.polar']);

    // the layers of topo change and polar is removed: the providers follow before the server part has answered
    const asked = fake.urls.length;
    ctx.changeSettings(settings([server('geo')], [background('topo', 'geo', ['sea', 'land'])]));

    expect(provided(ctx).map((p) => [p.id, wms(p).layers])).toEqual([['basemap-wms.topo', ['sea', 'land']]]);
    expect(fake.urls.length).toBeGreaterThanOrEqual(asked);
  });

  it('adds a new background once the server part offers it, within the follow-up questions after the change', async () => {
    const ctx = await started();
    const newSettings = settings([server('geo')], [background('topo', 'geo', ['land', 'sea']), background('extra', 'geo', ['group'])]);

    ctx.changeSettings(newSettings);
    expect(provided(ctx).map((p) => p.id)).toEqual(['basemap-wms.topo']);
    fake.reading = true;
    fake.offered = [{ id: 'topo', projections: ['EPSG:3857', 'EPSG:3413'] }, { id: 'extra', projections: ['EPSG:3031'] }];
    await vi.advanceTimersByTimeAsync(AFTER_CHANGE_MS[0] ?? 1_000);

    expect(provided(ctx).map((p) => p.id)).toEqual(['basemap-wms.topo', 'basemap-wms.extra']);
  });

  it('replaces a provider whose projections changed, and removes one the server part stopped offering', async () => {
    const ctx = await started();
    fake.offered = [{ id: 'topo', projections: ['EPSG:3857'] }];
    await vi.advanceTimersByTimeAsync(IDLE_POLL_MS);
    expect(provided(ctx)[0]?.projections).toEqual(['EPSG:3857']);

    fake.offered = [];
    await vi.advanceTimersByTimeAsync(IDLE_POLL_MS);
    expect(provided(ctx)).toEqual([]);
  });

  it('keeps what is provided when the server part cannot be asked, and recovers later (criterion 13)', async () => {
    const ctx = await started();
    fake.down = true;
    await vi.advanceTimersByTimeAsync(IDLE_POLL_MS);
    expect(provided(ctx)).toHaveLength(1);

    fake.down = false;
    fake.offered = [];
    await vi.advanceTimersByTimeAsync(IDLE_POLL_MS);
    expect(provided(ctx)).toEqual([]);
  });
});

describe('asking the server part', () => {
  it('asks every 5 s while it is reading, every 60 s otherwise', async () => {
    await started();
    expect(fake.urls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(IDLE_POLL_MS - 1);
    expect(fake.urls).toHaveLength(1);
    fake.reading = true;
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.urls).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(READING_POLL_MS * 3);
    expect(fake.urls).toHaveLength(5);
    fake.reading = false;
    await vi.advanceTimersByTimeAsync(READING_POLL_MS);
    expect(fake.urls).toHaveLength(6);
    await vi.advanceTimersByTimeAsync(READING_POLL_MS * 3);
    expect(fake.urls).toHaveLength(6);
  });

  it('does not ask while the page is hidden, and asks as soon as it is visible again', async () => {
    await started();
    Object.defineProperty(globalThis.document, 'visibilityState', { configurable: true, value: 'hidden' });
    await vi.advanceTimersByTimeAsync(IDLE_POLL_MS * 3);
    expect(fake.urls).toHaveLength(1);

    Object.defineProperty(globalThis.document, 'visibilityState', { configurable: true, value: 'visible' });
    globalThis.document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(fake.urls).toHaveLength(2);
  });

  it('asks again soon after an accepted settings change', async () => {
    const ctx = await started();
    const before = fake.urls.length;

    ctx.changeSettings(settings([server('geo')], [background('topo', 'geo', ['land'])]));
    await settle();
    expect(fake.urls.length).toBe(before + 1);
    await vi.advanceTimersByTimeAsync(AFTER_CHANGE_MS[0] ?? 1_000);
    expect(fake.urls.length).toBe(before + 2);
  });

  it('makes no request outside the emc2 server’s plugin endpoints (criterion 11)', async () => {
    const ctx = await started();
    ctx.changeSettings(settings([server('geo', 'http://elsewhere.example/ows')], [background('topo', 'geo', ['land'])]));
    await vi.advanceTimersByTimeAsync(IDLE_POLL_MS * 2);

    expect(fake.urls.length).toBeGreaterThan(2);
    expect(fake.urls.every((u) => u.startsWith(SERVER_BASE))).toBe(true);
    // the server addresses are in the settings, and are never used by the browser
    expect(fake.urls.some((u) => u.includes('elsewhere') || u.includes('wms.test'))).toBe(false);
  });
});

describe('WMTS stays out of sight (criterion 19)', () => {
  it('has no word about it in the manifest’s texts or the code that users see', () => {
    const source = ['../src/SettingsPanel.tsx', '../src/providers.ts'].map((f) => readFileSync(join(import.meta.dirname, f), 'utf8')).join('\n');
    expect(source.toLowerCase()).not.toContain('wmts');
    expect(JSON.stringify(manifest.settings).toLowerCase()).not.toContain('wmts');
  });
});
