// Quick run: @plugin-basemap-osm @plugin-basemap-naturalearth
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { colourFor, startFakeTiles } from '../../lib/fake-tiles.mjs';
import {
  colourAround,
  drag,
  frameSymbol,
  IDENTITY,
  mapCentre,
  mapPane,
  positionAt,
  openMapControls,
  switchProjection,
  withM0,
} from '../../lib/m0';
import { stopOwnServer, withOwnServers } from '../../lib/own-server';
import { installPlugins } from '../../lib/plugins.mjs';

// basemap-osm's acceptance criteria 1, 2, 3, 7 and 9 (docs/plugins/briefs/basemap-osm.md), the
// browser and real-watchdog parts its handover leaves to the ITA. Offline: the plugin fetches from
// the test's fake tile server, never from OpenStreetMap. Criterion 3 is also map-view-2d's
// criterion 11 (a full network capture).

test.describe.configure({ timeout: 120_000 });

const tiles = (page: import('@playwright/test').Page) => mapPane(page).getByRole('combobox').nth(1);

test('criterion 1: the background appears in EPSG:3857 and the attribution stays visible while zooming and panning', async ({
  browser,
}, testInfo) => {
  await withM0(testInfo, browser, async ({ open, tiles: fake }) => {
    const page = await open();
    const centre = await mapCentre(page);
    const attribution = mapPane(page).getByRole('link', { name: /OpenStreetMap contributors/ });
    await openMapControls(page);
    await expect(tiles(page)).toHaveValue('osm');
    await expect.poll(() => colourAround(page, centre, colourFor(5), 40), { timeout: 10_000 }).toBeGreaterThan(3000);
    await expect(attribution).toBeVisible();

    await mapPane(page).getByTitle('Zoom in').click();
    await expect.poll(() => colourAround(page, centre, colourFor(6), 40), { timeout: 10_000 }).toBeGreaterThan(3000);
    await expect(attribution).toBeVisible();
    await drag(page, { x: centre.x + 100, y: centre.y + 100 }, { x: centre.x - 150, y: centre.y - 50 });
    await expect.poll(() => colourAround(page, centre, colourFor(6), 40), { timeout: 10_000 }).toBeGreaterThan(3000);
    await expect(attribution).toBeVisible();
    expect(fake.requests.some((path) => path.startsWith('/6/'))).toBe(true);
  });
});

test('criterion 2: the provider is not offered in EPSG:3413, and is offered again in EPSG:3857', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ open }) => {
    const page = await open();
    const options = () => tiles(page).locator('option').allTextContents();
    await openMapControls(page);
    expect(await options()).toContain('OpenStreetMap');
    await switchProjection(page, 'EPSG:3413');
    await expect.poll(options).not.toContain('OpenStreetMap');
    await expect(mapPane(page).getByRole('link', { name: /OpenStreetMap contributors/ })).toHaveCount(0);
    await switchProjection(page, 'EPSG:3857');
    await expect.poll(options).toContain('OpenStreetMap');
  });
});

test('criterion 3 (map-view-2d 11): every request of the page, from loading through a flow, goes to the emc2 server', async ({
  browser,
}, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open }) => {
    const requests: string[] = [];
    const page = await open((p) => {
      p.on('request', (request) => requests.push(request.url()));
      p.on('websocket', (socket) => requests.push(socket.url()));
    });
    const centre = await mapCentre(page);
    await mapPane(page).getByTitle('Zoom in').click();
    await drag(page, { x: centre.x + 80, y: centre.y }, { x: centre.x - 120, y: centre.y + 60 });
    const panel = page.getByRole('region', { name: 'Symbols' });
    await panel.getByRole('group', { name: 'Symbols' }).getByRole('button', { name: 'Infantry', exact: true }).click();
    await panel.getByRole('button', { name: 'Place on map' }).click();
    await page.mouse.click(centre.x, centre.y);
    await page.keyboard.press('Escape');
    await switchProjection(page, 'EPSG:3413');
    await switchProjection(page, 'EPSG:3857');
    await expect.poll(() => colourAround(page, centre, IDENTITY.friend.colour), { timeout: 10_000 }).toBeGreaterThan(50);

    const origin = new URL(server.baseUrl);
    const elsewhere = requests.filter((url) => {
      const u = new URL(url);
      return u.protocol !== 'data:' && u.protocol !== 'blob:' && u.host !== origin.host;
    });
    const tileRequests = requests.filter((url) => url.includes('/api/plugins/basemap-osm/tiles/'));
    testInfo.annotations.push({ type: 'criterion 3', description: `${requests.length} requests, ${tileRequests.length} tiles, all to ${origin.host}` });
    expect(tileRequests.length, 'tiles came through the emc2 server').toBeGreaterThan(0);
    expect(elsewhere, 'requests to anything but the emc2 server').toEqual([]);
  });
});

test('criterion 7: without internet the map stays usable: no background, objects drawn, at most one warning, status DEGRADED', async ({
  browser,
}, testInfo) => {
  await withM0(
    testInfo,
    browser,
    async ({ server, live, snapshot, open }) => {
      const page = await open();
      const centre = await mapCentre(page);
      // Panning and zooming ask for many tiles; every one fails upstream.
      await mapPane(page).getByTitle('Zoom in').click();
      await drag(page, { x: centre.x + 150, y: centre.y }, { x: centre.x - 150, y: centre.y });
      await mapPane(page).getByTitle('Zoom out').click();
      expect(await colourAround(page, centre, colourFor(5), 40)).toBe(0);
      for (const z of [4, 6]) expect(await colourAround(page, centre, colourFor(z), 40)).toBe(0);

      const layer = snapshot.layers.find((l: { name: string }) => l.name === 'Drawing')!.id;
      expect((await live.change(frameSymbol(layer, await positionAt(page, centre), 'friend'))).outcome).toBe('applied');
      await expect.poll(() => colourAround(page, centre, IDENTITY.friend.colour), { timeout: 10_000 }).toBeGreaterThan(50);

      await expect
        .poll(async () => {
          const plugins = (await (await fetch(`${server.baseUrl}/api/plugins`)).json()) as Array<{ id: string; status: { state: string; detail: string } }>;
          const basemap = plugins.find((p) => p.id === 'basemap-osm')!;
          return `${basemap.status.state}: ${basemap.status.detail}`;
        }, { timeout: 10_000 })
        .toMatch(/^DEGRADED: upstream tile server unreachable/);
      const warnings = readFileSync(server.logFile, 'utf8')
        .split(/\r?\n/)
        .filter((line) => /\sWARN\s/.test(line) && /basemap/i.test(line));
      testInfo.annotations.push({ type: 'criterion 7', description: `${warnings.length} warning(s): ${warnings.join(' | ')}` });
      expect(warnings.length, 'warnings logged by basemap-osm (at most one per minute)').toBeLessThanOrEqual(1);
    },
    // The browser reports each failed tile (502 from the proxy) as a console error; that is the
    // expected result here, not a fault.
    { upstream: 'unreachable', allowConsoleErrors: /Failed to load resource: the server responded with a status of 50[234]/ },
  );
});

test('criterion 9: with an upstream that answers after 10 s, no handler waits: the worker is never HUNG and cached tiles still come at once', async ({}, testInfo) => {
  const fake = await startFakeTiles();
  try {
    await withOwnServers(testInfo, async (folders, start) => {
      installPlugins(folders.pluginsDir, { tileTemplate: fake.template, only: ['basemap-osm'] });
      const server = await start();
      const tile = (z: number, x: number, y: number) => fetch(`${server.baseUrl}/api/plugins/basemap-osm/tiles/${z}/${x}/${y}.png`);

      expect((await tile(5, 17, 9)).status, 'a first tile, now in the cache').toBe(200);
      fake.setDelay(10_000);
      const startedSlow = Date.now();
      const slow = tile(5, 18, 9);
      // While the slow tile waits for the upstream, cached tiles are answered at once.
      for (let i = 0; i < 5; i++) {
        const t = Date.now();
        expect((await tile(5, 17, 9)).status).toBe(200);
        expect(Date.now() - t, 'a cached tile while the upstream is slow (ms)').toBeLessThan(1000);
      }
      const slowStatus = (await slow).status;
      const slowMs = Date.now() - startedSlow;
      testInfo.annotations.push({ type: 'criterion 9', description: `slow tile: ${slowStatus} after ${slowMs} ms` });
      expect([502, 504], 'the slow tile is cut off by the upstream timeout').toContain(slowStatus);
      expect(slowMs).toBeLessThan(10_000);

      const plugins = (await (await fetch(`${server.baseUrl}/api/plugins`)).json()) as Array<{ id: string; status: { state: string; detail: string } }>;
      const basemap = plugins.find((p) => p.id === 'basemap-osm')!;
      expect(basemap.status.detail, 'status').not.toMatch(/hung/i);
      expect(readFileSync(server.logFile, 'utf8'), 'the watchdog never reported a hung worker').not.toMatch(/Worker .* hung:/);
      fake.setDelay(0);
      await stopOwnServer(server);
    });
  } finally {
    await fake.close();
  }
});
