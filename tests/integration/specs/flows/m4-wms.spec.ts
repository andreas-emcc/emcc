// Quick run: @plugin-basemap-wms @plugin-map-view-2d @settings
import { expect, test, type Page } from '@playwright/test';
import { colourAround, mapCentre, mapPane, openMapControls, switchProjection, withM0 } from '../../lib/m0';
import type { OwnServer } from '../../lib/own-server';
import { GETMAP_PARAMETERS, startWmsDouble, WMS_COLOURS } from '../../lib/wms-double.mjs';

// WMS background maps (ADR-0035, T-074; basemap-wms brief, map-view-2d function 3) against the ITA's
// WMS test double (lib/wms-double.mjs), each on a server of its own with every assembled plugin. The
// map view builds the GetMap parameters and the plugin's server part checks them and builds its own
// request (CR-0023), so the double's requests are compared with the browser's by their parameters,
// not as strings (owner, DX; map-view-2d criterion 55). The browser asks only the emc2 server (the
// offline guard of withM0). basemap-wms has no server or background until settings name them.

test.describe.configure({ timeout: 180_000 });

type Double = Awaited<ReturnType<typeof startWmsDouble>>;
type WmsRequest = Double['requests'][number];
type Background = { id: string; name: string; layers: string[]; mode?: 'tiles' | 'image'; attribution?: { text: string } };

/** Sets basemap-wms' settings: one server, the double, and the backgrounds. */
async function setWms(server: OwnServer, double: Double, version: '1.3.0' | '1.1.1', backgrounds: Background[]): Promise<void> {
  const values = {
    servers: [{ id: 'ita', name: 'ITA double', url: double.url, protocol: 'wms', version, timeoutSeconds: 5 }],
    backgrounds: backgrounds.map((b) => ({ server: 'ita', mode: 'tiles', format: 'image/png', transparent: false, attribution: { text: `${b.name} by the ITA double` }, ...b })),
  };
  const response = await fetch(`${server.baseUrl}/api/settings/plugins/basemap-wms`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
  expect(response.status, `basemap-wms settings: ${await response.clone().text()}`).toBe(200);
}

/** What the server part offers: { backgrounds: [{ id, projections }], reading, version }. */
async function offered(server: OwnServer): Promise<{ backgrounds: Array<{ id: string; projections: string[] }>; reading: boolean }> {
  return (await fetch(`${server.baseUrl}/api/plugins/basemap-wms/backgrounds`)).json();
}

function backgroundList(page: Page) {
  return mapPane(page).getByRole('combobox').nth(1);
}

/** The background choices of the map controls (provider ids), for the projection shown. */
async function choices(page: Page): Promise<string[]> {
  await openMapControls(page);
  return backgroundList(page).locator('option').evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
}

/** Chooses a background in the map controls once it is offered there (the web part asks at start). */
async function choose(page: Page, id: string): Promise<void> {
  await expect.poll(() => choices(page), { timeout: 30_000, message: `${id} offered` }).toContain(id);
  await backgroundList(page).selectOption(id);
  await expect(backgroundList(page)).toHaveValue(id);
  await mapPane(page).getByRole('button', { name: 'Close map controls' }).click();
}

/** Waits until the map's middle shows the colour (a WMS layer drawn there). */
async function drawn(page: Page, colour: readonly number[], what: string): Promise<void> {
  await expect.poll(async () => colourAround(page, await mapCentre(page), colour, 60), { timeout: 20_000, message: what }).toBeGreaterThan(1_000);
}

/** The map requests the page sends to basemap-wms' server part, with their parameters (names in upper case). */
/**
 * Saves basemap-wms' settings panel and waits until the server has stored the values. The Save button is disabled
 * from the click on, while the save is still on its way, so a disabled button alone does not mean "stored".
 */
async function savePanel(page: Page): Promise<void> {
  const panel = page.getByRole('tabpanel');
  const put = page.waitForResponse((r) => r.request().method() === 'PUT' && new URL(r.url()).pathname === '/api/settings/plugins/basemap-wms');
  await panel.getByRole('button', { name: 'Save', exact: true }).click();
  expect((await put).ok(), 'the settings stored').toBe(true);
  await expect(panel.getByText('Saved.', { exact: true }), 'the panel took the answer').toBeVisible();
  await expect(panel.getByRole('button', { name: 'Save', exact: true }), 'saved: nothing left to save').toBeDisabled();
}

function watchMapRequests(page: Page): Array<Map<string, string>> {
  const sent: Array<Map<string, string>> = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (!url.pathname.includes('/api/plugins/basemap-wms/map/')) return;
    sent.push(new Map([...url.searchParams].map(([name, value]) => [name.toUpperCase(), value])));
  });
  return sent;
}

const NUMERIC = new Set(['BBOX', 'WIDTH', 'HEIGHT']);
const ANY_CASE = new Set(['SERVICE', 'REQUEST', 'TRANSPARENT']);

/** Two parameter values equal as WMS reads them: numbers as numbers, a few values in any case. */
function sameValue(name: string, a: string, b: string): boolean {
  if (NUMERIC.has(name)) {
    const x = a.split(',').map(Number);
    const y = b.split(',').map(Number);
    return x.length === y.length && x.every((v, i) => Math.abs(v - y[i]) <= 1e-6 * Math.max(1, Math.abs(v)));
  }
  return ANY_CASE.has(name) ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/**
 * Every GetMap the double got came from a request the page sent, with the same parameters and
 * nothing else (criterion 55; basemap-wms 10), at the double's own address.
 */
function expectFromThePage(got: WmsRequest[], sent: Array<Map<string, string>>, projection: 'CRS' | 'SRS'): void {
  expect(got.length, 'GetMap requests at the double').toBeGreaterThan(0);
  const names = [...GETMAP_PARAMETERS, projection].sort();
  for (const request of got) {
    expect(request.path, 'the saved server\'s address').toBe('/wms');
    expect([...request.names].map((n) => n.toUpperCase()).sort(), `only the GetMap parameters, each once: ${request.query}`).toEqual(names);
    const match = sent.find((s) => names.every((n) => s.has(n) && sameValue(n, s.get(n)!, request.params.get(n)!)) && s.size === names.length);
    expect(match, `the page sent this request: ${request.query}`).toBeDefined();
  }
}

/** Each box is four numbers, minima below maxima, within ±limit (the projection's extent). */
function expectBoxesInside(got: WmsRequest[], limit: number): void {
  for (const request of got) {
    const [minX, minY, maxX, maxY] = request.params.get('BBOX')!.split(',').map(Number);
    expect(minX < maxX && minY < maxY, `a box: ${request.params.get('BBOX')}`).toBe(true);
    for (const v of [minX, minY, maxX, maxY]) expect(Math.abs(v), `inside the extent: ${request.params.get('BBOX')}`).toBeLessThanOrEqual(limit);
  }
}

const MERCATOR_LIMIT = 20_037_508.35;

test('a WMS background in Web Mercator: offered in EPSG:3857, drawn as tiles with its attribution, every tile asked with the page\'s own parameters, square, inside the extent', async ({ browser }, testInfo) => {
  const double = await startWmsDouble();
  try {
    await withM0(testInfo, browser, async ({ server, open }) => {
      await setWms(server, double, '1.3.0', [{ id: 'land', name: 'ITA land', layers: ['ita:land'] }]);
      let sent: Array<Map<string, string>> = [];
      const page = await open((p) => {
        sent = watchMapRequests(p);
      });
      await choose(page, 'basemap-wms.land');
      await drawn(page, WMS_COLOURS['ita:land'], 'the land layer drawn');
      await expect(mapPane(page).getByText('ITA land by the ITA double')).toBeVisible();

      const got = double.getMaps();
      expectFromThePage(got, sent, 'CRS');
      expectBoxesInside(got, MERCATOR_LIMIT);
      for (const request of got) {
        expect(request.params.get('CRS')).toBe('EPSG:3857');
        expect(request.params.get('VERSION')).toBe('1.3.0');
        expect(request.params.get('LAYERS')).toBe('ita:land');
        expect(request.params.get('WIDTH'), 'a square tile').toBe(request.params.get('HEIGHT'));
      }
      testInfo.annotations.push({ type: 'tiles', description: `${got.length} GetMap requests, e.g. ${got[0].query}` });
    });
  } finally {
    await double.close();
  }
});

test('a polar WMS background: offered and drawn in EPSG:3413 (a projection inherited from its parent layer) and EPSG:3031, never in EPSG:3857, where only the Mercator one is offered', async ({ browser }, testInfo) => {
  const double = await startWmsDouble();
  try {
    await withM0(testInfo, browser, async ({ server, open }) => {
      await setWms(server, double, '1.3.0', [
        { id: 'land', name: 'ITA land', layers: ['ita:land'] },
        { id: 'polar', name: 'ITA polar', layers: ['ita:polar'] },
      ]);
      await expect.poll(async () => (await offered(server)).backgrounds.map((b) => [b.id, [...b.projections].sort()]), { timeout: 20_000 }).toEqual(
        expect.arrayContaining([['land', ['EPSG:3857', 'EPSG:4326']], ['polar', ['EPSG:3031', 'EPSG:3413']]]),
      );
      let sent: Array<Map<string, string>> = [];
      const page = await open((p) => {
        sent = watchMapRequests(p);
      });
      await expect.poll(() => choices(page), { timeout: 30_000 }).toContain('basemap-wms.land');
      expect(await choices(page), 'not in Web Mercator').not.toContain('basemap-wms.polar');

      for (const code of ['EPSG:3413', 'EPSG:3031']) {
        const before = double.getMaps().length;
        await switchProjection(page, code);
        expect(await choices(page), `${code}: only the backgrounds that list it`).not.toContain('basemap-wms.land');
        await choose(page, 'basemap-wms.polar');
        await drawn(page, WMS_COLOURS['ita:polar'], `the polar layer drawn in ${code}`);
        const got = double.getMaps().slice(before);
        expectFromThePage(got, sent, 'CRS');
        for (const request of got) expect(request.params.get('CRS'), 'the server\'s own projection').toBe(code);
      }
    });
  } finally {
    await double.close();
  }
});

test('WMS 1.1.1 with a bare DOCTYPE (owner, EX): the capabilities are read without fetching their DTD, the background is offered and drawn, and the maps are asked with VERSION 1.1.1 and SRS', async ({ browser }, testInfo) => {
  const double = await startWmsDouble({ version: '1.1.1', doctype: 'bare' });
  try {
    await withM0(testInfo, browser, async ({ server, open }) => {
      await setWms(server, double, '1.1.1', [{ id: 'land', name: 'ITA land', layers: ['ita:land'] }]);
      let sent: Array<Map<string, string>> = [];
      const page = await open((p) => {
        sent = watchMapRequests(p);
      });
      await choose(page, 'basemap-wms.land');
      await drawn(page, WMS_COLOURS['ita:land'], 'the land layer drawn');
      const got = double.getMaps();
      expectFromThePage(got, sent, 'SRS');
      for (const request of got) {
        expect(request.params.get('VERSION')).toBe('1.1.1');
        expect(request.params.get('SRS')).toBe('EPSG:3857');
      }
      for (const read of double.capabilityReads()) expect(read.params.get('VERSION'), 'capabilities asked in 1.1.1').toBe('1.1.1');
      expect(double.dtdReads(), 'the DTD is never fetched').toEqual([]);
    });
  } finally {
    await double.close();
  }
});

test('capabilities with a DOCTYPE that has an internal subset and an entity are refused (owner, EX): the background is not offered, the status names the server, and nothing but the capabilities is fetched', async ({ browser }, testInfo) => {
  const double = await startWmsDouble({ doctype: 'internal' });
  try {
    await withM0(testInfo, browser, async ({ server }) => {
      await setWms(server, double, '1.3.0', [{ id: 'land', name: 'ITA land', layers: ['ita:land'] }]);
      await expect.poll(() => double.capabilityReads().length, { timeout: 20_000, message: 'the capabilities read' }).toBeGreaterThan(0);
      await expect.poll(async () => {
        const plugins = (await (await fetch(`${server.baseUrl}/api/plugins`)).json()) as Array<{ id: string; status: { state: string; detail: string } }>;
        return plugins.find((p) => p.id === 'basemap-wms')!.status.detail;
      }, { timeout: 20_000, message: 'the status names the server' }).toMatch(/ITA double|\bita\b/);
      const offer = await offered(server);
      expect(offer.backgrounds, 'not offered').toEqual([]);
      expect(double.requests.filter((r) => (r.params.get('REQUEST') ?? '').toLowerCase() !== 'getcapabilities'), 'nothing fetched but the capabilities').toEqual([]);
    });
  } finally {
    await double.close();
  }
});

test('basemap-wms\' own settings panel: a server saved first ("Save the server to see its layers"), then its layers by checkbox with titles and projections, "Read the layers again", the drawing order by "Move up", and one image per view; the map asks for that order, one image', async ({ browser }, testInfo) => {
  const double = await startWmsDouble();
  try {
    await withM0(testInfo, browser, async ({ server, open }) => {
      const page = await open();
      await page.goto('/#settings/plugin/basemap-wms');
      const panel = page.getByRole('tabpanel');
      await panel.getByRole('button', { name: 'Add server' }).click();
      const card = panel.getByRole('region', { name: 'Server New server' });
      await card.getByLabel('Name').fill('ITA double');
      await panel.getByRole('region', { name: 'Server ITA double' }).getByLabel('Address').fill(double.url);
      await panel.getByRole('button', { name: 'Add background' }).click();
      await expect(panel.getByRole('region', { name: 'Background New background' })).toContainText('Save the server to see its layers');
      await panel.getByRole('button', { name: 'Remove background New background' }).click();
      await savePanel(page);

      await panel.getByRole('button', { name: 'Add background' }).click();
      const background = panel.getByRole('region', { name: 'Background New background' });
      await background.getByLabel('Name').fill('ITA stack');
      const stack = panel.getByRole('region', { name: 'Background ITA stack' });
      const layers = stack.getByRole('list', { name: 'Layers on the server' });
      await expect(layers.getByRole('checkbox', { name: 'Land (ita:land)' })).toBeVisible({ timeout: 20_000 });
      await expect(layers.getByRole('listitem').filter({ hasText: 'Land (ita:land)' })).toContainText('EPSG:3857, EPSG:4326');
      await expect(layers.getByRole('listitem').filter({ hasText: 'Polar (ita:polar)' })).toContainText('EPSG:3413');
      await expect(layers.getByRole('listitem').filter({ hasText: 'Polar (ita:polar)' })).toContainText('EPSG:3031');
      const reads = double.capabilityReads().length;
      await stack.getByRole('button', { name: 'Read the layers again' }).click();
      await expect.poll(() => double.capabilityReads().length, { message: 'read again' }).toBeGreaterThan(reads);

      await layers.getByRole('checkbox', { name: 'Land (ita:land)' }).check();
      await layers.getByRole('checkbox', { name: 'Roads (ita:roads)' }).check();
      const order = stack.getByRole('list', { name: 'Drawing order of ITA stack, top-most first' });
      await expect(order.getByRole('listitem')).toHaveText([/Roads/, /Land/]);
      await stack.getByRole('button', { name: 'Move up ita:land' }).click();
      await expect(order.getByRole('listitem')).toHaveText([/Land/, /Roads/]);
      await stack.getByLabel('Maps are drawn as').selectOption('image');
      await stack.getByLabel('Attribution text').fill('ITA stack by the ITA double');
      await savePanel(page);
      const saved = (await (await fetch(`${server.baseUrl}/api/settings/plugins/basemap-wms`)).json()).values;
      expect(saved.backgrounds, 'stored bottom first').toMatchObject([{ name: 'ITA stack', server: saved.servers[0].id, layers: ['ita:roads', 'ita:land'], mode: 'image' }]);

      await page.goto('/#view');
      const id = `basemap-wms.${saved.backgrounds[0].id}`;
      const before = double.getMaps().length;
      await choose(page, id);
      await drawn(page, WMS_COLOURS['ita:land'], 'Land drawn on top');
      await page.waitForTimeout(1_500); // no further image may follow for this view: a fixed wait, the count is the check
      const got = double.getMaps().slice(before);
      expect(got.length, 'one image for the view').toBe(1);
      expect(got[0].params.get('LAYERS'), 'the new order, bottom first').toBe('ita:roads,ita:land');
      for (const name of ['WIDTH', 'HEIGHT']) expect(Number(got[0].params.get(name)), name).toBeLessThanOrEqual(4096);
      // Another view (a zoom step; a small pan may stay inside the image, which is larger than the view): one more image.
      await mapPane(page).getByTitle('Zoom in').click();
      await expect.poll(() => double.getMaps().length - before, { message: 'one image for the new view' }).toBe(2);
    });
  } finally {
    await double.close();
  }
});

test('the fallback when a provider goes: the WMS server stops, the server part stops offering its background, and the map falls back to another background with a notice and stays usable', async ({ browser }, testInfo) => {
  const double = await startWmsDouble();
  try {
    await withM0(testInfo, browser, async ({ server, open }) => {
      await setWms(server, double, '1.3.0', [{ id: 'land', name: 'ITA land', layers: ['ita:land'] }]);
      const page = await open();
      await choose(page, 'basemap-wms.land');
      await drawn(page, WMS_COLOURS['ita:land'], 'the land layer drawn');

      double.refuseConnections();
      // The user goes on zooming in (new tiles each time, never cached): the map calls fail, and the
      // server part reads the capabilities again after a failed one, at most every 10 s, which fails too.
      await expect.poll(async () => {
        await mapPane(page).getByTitle('Zoom in').click();
        await page.waitForTimeout(2_000); // a zoom step at a user's pace
        return (await offered(server)).backgrounds;
      }, { timeout: 90_000, intervals: [0], message: 'no longer offered' }).toEqual([]);
      expect(double.refused.count, 'calls to the server that went').toBeGreaterThan(0);
      // The web part asks every 60 s while the page is visible.
      await expect(page.getByRole('list', { name: 'Notifications' })).toContainText('The background map ITA land is not available; showing', { timeout: 90_000 });
      await openMapControls(page);
      await expect(backgroundList(page)).not.toHaveValue('basemap-wms.land');
      expect(await choices(page)).not.toContain('basemap-wms.land');
      await mapPane(page).getByRole('button', { name: 'Close map controls' }).click();
      await expect.poll(async () => colourAround(page, await mapCentre(page), WMS_COLOURS['ita:land'], 60), { message: 'the WMS map is gone' }).toBe(0);
      await expect(page.getByRole('status', { name: 'Live picture' })).toHaveText('Live picture: connected');
    }, { allowConsoleErrors: /Failed to load resource: the server responded with a status of (400|50[234])/ }); // the images of the server that went: 502, then 400 once it is not offered, until the page's next question
  } finally {
    await double.close();
  }
});
