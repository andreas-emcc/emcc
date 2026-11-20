// Quick run: @plugin-object-list @plugin-layer-panel @plugin-map-view-2d @plugin-coordinates
import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createSymbol, type LiveClient } from '../../lib/live.mjs';
import { watchMapSubscription, type MapSubscription } from '../../lib/map-subscription';
import { frameSymbol, layerRequest, mapCentre, nextEvent, positionAt, settle, visibleMap, withM0, type LonLat } from '../../lib/m0';
import { viewport } from '../../lib/perf';

// object-list in the real shell (T-056 part 4; docs/plugins/briefs/object-list.md, acceptance
// criteria 1, 2, 5, 6, 7 and 12). The list reads a layer's objects from the server, page by page,
// independent of what the map holds. Every test has a server of its own. Without a GPU here:
// software mode.

test.describe.configure({ timeout: 180_000 });

function objectsPanel(page: Page) {
  return page.locator('section[aria-label="Objects"]');
}
function rows(page: Page) {
  return objectsPanel(page).getByRole('listbox', { name: 'Objects of the layer' }).getByRole('option');
}
function names(page: Page): Promise<string[]> {
  return rows(page).locator('.object-list-cell-name').allTextContents();
}

/** A double-click on the layer's row in the Layers panel (not on its buttons or name) opens the list. */
async function openList(page: Page, layerName: string) {
  const row = page.getByRole('tabpanel', { name: 'Layers', exact: true }).getByRole('listitem').filter({ hasText: layerName });
  await row.getByText(/UNCLASSIFIED ·/).dblclick();
  await expect(objectsPanel(page)).toBeVisible();
}

/** The shared selection (`MapView.selection`), sorted. */
function selection(page: Page): Promise<string[]> {
  return page.evaluate(() => [...(window as unknown as { __itaProbe: { mapView: { selection: { value: readonly string[] } } } }).__itaProbe.mapView.selection.value].sort());
}

/** Creates the requests at most 50 waiting at a time (the server allows 100 per session). */
async function createAll(live: LiveClient, requests: Array<{ entityId: string }>) {
  for (let i = 0; i < requests.length; i += 50) {
    const outcomes = await Promise.all(requests.slice(i, i + 50).map((r) => live.change(r, 30_000)));
    for (const o of outcomes) expect(o.outcome, JSON.stringify(o.rejection ?? '')).toBe('applied');
  }
}

async function newLayer(live: LiveClient, name: string): Promise<string> {
  const id = randomUUID();
  expect((await live.change(layerRequest('create', { id, name, drawOrder: 50 }))).outcome).toBe('applied');
  return id;
}

/**
 * A UUID v7 for a time in ms (RFC 9562): ids made later sort later, as the plugins' ids do. The list
 * is in the order of creation, which is the server's order by id (brief, open question 1).
 */
function uuidv7(ms: number): string {
  const time = ms.toString(16).padStart(12, '0');
  const random = randomUUID().replace(/-/g, '');
  const variant = ((parseInt(random[16], 16) & 0x3) | 0x8).toString(16);
  return `${time.slice(0, 8)}-${time.slice(8)}-7${random.slice(13, 16)}-${variant}${random.slice(17, 20)}-${random.slice(20)}`;
}
let clock = Date.now();

/** A named friendly symbol at a position, with an id later than every one before it. */
function named(layerId: string, position: LonLat, name: string) {
  const request = frameSymbol(layerId, position, 'friend');
  request.entityId = uuidv7(clock++);
  request.data.properties = { name };
  return request;
}

/** How wide the visible map is, in metres on the ground at its centre. */
async function viewWidthMetres(page: Page): Promise<number> {
  return (await viewport(page)).resolution * (await visibleMap(page)).width;
}

/** Zoom to for one object: a view about `zoomToWidthMetres` (10 km) wide (map-view-2d README). */
async function expectTenKilometresWide(page: Page) {
  await expect.poll(() => viewWidthMetres(page), { timeout: 10_000, message: 'a view about 10 km wide' }).toBeGreaterThan(8_500);
  expect(await viewWidthMetres(page)).toBeLessThan(11_500);
}

/** The map's centre within a pixel or two of the position (degrees at the zoom shown). */
async function expectCentredOn(page: Page, position: LonLat, degrees: number) {
  await expect
    .poll(async () => {
      const [lon, lat] = (await viewport(page)).center;
      return Math.max(Math.abs(lon - position[0]), Math.abs(lat - position[1]));
    }, { timeout: 10_000, message: `the map centred on ${position}` })
    .toBeLessThan(degrees);
}

test('criteria 1, 2 and 12: a double-click in the Layers panel opens a hidden layer\'s list; 250 objects in pages of 100, 100 and 50, also those outside the view and in clusters; a double-click on a row zooms the map to one the map does not hold', async ({
  browser,
}, testInfo) => {
  await withM0(
    testInfo,
    browser,
    async ({ server, live, open }) => {
      let map!: MapSubscription;
      const page = await open((p) => {
        map = watchMapSubscription(p);
      });
      const layer = await newLayer(live, 'ITA 250');
      const here = await positionAt(page, await mapCentre(page));
      // 150 close together at the centre, 50 spread over the view, 50 far outside it (lat ≠ lon).
      const positions: LonLat[] = [
        ...Array.from({ length: 150 }, (_, i): LonLat => [here[0] + (i % 15) * 0.0002, here[1] + Math.floor(i / 15) * 0.0001]),
        ...Array.from({ length: 50 }, (_, i): LonLat => [here[0] - 8 + (i % 10) * 1.7, here[1] - 3 + Math.floor(i / 10) * 1.4]),
        ...Array.from({ length: 50 }, (_, i): LonLat => [-60.5 + (i % 10) * 0.5, -30.25 + Math.floor(i / 10) * 0.5]),
      ];
      // Named so that their order by name is the reverse of the order of creation.
      const requests = positions.map((p, i) => named(layer, p, `ITA ${String(positions.length - 1 - i).padStart(3, '0')}`));
      await createAll(live, requests);
      const outside = requests.slice(200);

      // The map view's budget at runtime: 20, so the dense ones become a cluster.
      const settingsUrl = `${server.baseUrl}/api/settings/plugins/map-view-2d`;
      const values = (await (await fetch(settingsUrl)).json()).values;
      const put = await fetch(settingsUrl, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, softwareBudget: 20, hardwareBudget: 20 }) });
      expect(put.status).toBe(200);
      await expect.poll(() => map.subscribe()?.budget, { timeout: 10_000 }).toBe(20);
      await expect.poll(() => map.clusters().reduce((n, c) => n + (c.byLayer[layer] ?? 0), 0), { timeout: 10_000, message: 'objects of the layer in clusters' }).toBeGreaterThan(100);
      const held = map.objectIds();
      expect(outside.filter((r) => held.has(r.entityId)), 'the map holds none of those outside its view').toEqual([]);

      // Criterion 1: hidden on the map, the layer's list still opens with a double-click on its row.
      await page.getByRole('tabpanel', { name: 'Layers', exact: true }).getByRole('button', { name: 'Hide ITA 250' }).click();
      await expect(page.getByRole('tabpanel', { name: 'Layers', exact: true }).getByRole('button', { name: 'Show ITA 250' }), 'hidden on the map').toBeVisible();
      await openList(page, 'ITA 250');
      await expect(objectsPanel(page).getByRole('combobox')).toHaveValue(layer);
      await expect(objectsPanel(page).locator('.object-list-count')).toHaveText('250 objects');

      // Criterion 2: three pages, in the order of creation.
      const range = objectsPanel(page).locator('.object-list-range');
      const button = (name: string) => objectsPanel(page).getByRole('button', { name, exact: true });
      const listed: string[] = [];
      await expect(range).toHaveText('1–100 of 250');
      await expect(rows(page)).toHaveCount(100);
      await expect(button('First page')).toBeDisabled();
      await expect(button('Previous page')).toBeDisabled();
      listed.push(...(await names(page)));
      await button('Next page').click();
      await expect(range).toHaveText('101–200 of 250');
      await expect(rows(page)).toHaveCount(100);
      listed.push(...(await names(page)));
      await button('Next page').click();
      await expect(range).toHaveText('201–250 of 250');
      await expect(rows(page)).toHaveCount(50);
      await expect(button('Next page')).toBeDisabled();
      await expect(button('Last page')).toBeDisabled();
      listed.push(...(await names(page)));
      expect(listed, 'all 250, in the order of creation').toEqual(requests.map((r) => r.data.properties!.name));
      expect(listed, 'not in the order of names').not.toEqual([...listed].sort());
      await button('First page').click();
      await expect(range).toHaveText('1–100 of 250');
      await button('Last page').click();
      await expect(range).toHaveText('201–250 of 250');

      // Criterion 12: a double-click on the row of an object far outside the view zooms the map to it.
      const far = outside[23];
      expect(await viewWidthMetres(page), 'zoomed out before').toBeGreaterThan(100_000);
      await rows(page).filter({ hasText: far.data.properties!.name }).dblclick();
      await expectCentredOn(page, far.data.geometry.coordinates as LonLat, 0.01);
      await expectTenKilometresWide(page);
      testInfo.annotations.push({ type: 'criterion 12', description: `centred on ${JSON.stringify((await viewport(page)).center)} for ${JSON.stringify(far.data.geometry.coordinates)}` });
    },
    { probe: true },
  );
});

test('criteria 5 and 6: Centre on and Zoom to from a row move the map to an object it does not hold; the shared Delete of 3 selected rows removes them in both browsers, and both lists follow', async ({
  browser,
}, testInfo) => {
  await withM0(
    testInfo,
    browser,
    async ({ live, open }) => {
      let map!: MapSubscription;
      const page = await open((p) => {
        map = watchMapSubscription(p);
      });
      const other = await open();
      const layer = await newLayer(live, 'ITA three');
      const here = await positionAt(page, await mapCentre(page));
      const far: LonLat = [-60.5, -30.25];
      const requests = [named(layer, [here[0] - 2.5, here[1] + 1.25], 'ITA one'), named(layer, [here[0] + 2.5, here[1] - 1.25], 'ITA two'), named(layer, far, 'ITA far')];
      await createAll(live, requests);
      await expect.poll(() => map.objectIds().has(requests[0].entityId), { timeout: 10_000, message: 'the map holds the near ones' }).toBe(true);
      expect(map.objectIds().has(requests[2].entityId), 'the map does not hold the far one').toBe(false);
      for (const shown of [page, other]) {
        await openList(shown, 'ITA three');
        await expect(objectsPanel(shown).locator('.object-list-count')).toHaveText('3 objects');
        await expect(rows(shown)).toHaveCount(3);
      }

      // Criterion 6: on the row of the far object (not selected), the menu selects it first; Centre
      // on keeps the zoom, Zoom to shows about 10 km.
      const before = await viewport(page);
      const farRow = rows(page).filter({ hasText: 'ITA far' });
      await farRow.click({ button: 'right' });
      await expect.poll(() => selection(page)).toEqual([requests[2].entityId]);
      await page.getByRole('menu', { name: 'Actions' }).getByRole('menuitem', { name: 'Centre on object(s)' }).click();
      await expectCentredOn(page, far, 0.1);
      // The viewport's resolution is metres on the ground at the centre: the same zoom gives more of
      // them nearer the equator (EPSG:3857), by the ratio of the latitudes' cosines.
      const cos = (lat: number) => Math.cos((lat * Math.PI) / 180);
      const sameZoom = (before.resolution * cos(far[1])) / cos(before.center[1]);
      expect(Math.abs((await viewport(page)).resolution / sameZoom - 1), 'Centre on keeps the zoom').toBeLessThan(0.01);
      await farRow.click({ button: 'right' });
      await page.getByRole('menu', { name: 'Actions' }).getByRole('menuitem', { name: 'Zoom to object(s)' }).click();
      await expectTenKilometresWide(page);
      await expectCentredOn(page, far, 0.001);
      testInfo.annotations.push({ type: 'criterion 6', description: `resolution ${before.resolution.toFixed(0)} → ${(await viewport(page)).resolution.toFixed(2)} map units per pixel` });

      // Criterion 5: three rows selected (click, Ctrl+click), the menu on a selected one, Delete.
      await rows(page).filter({ hasText: 'ITA one' }).click();
      await rows(page).filter({ hasText: 'ITA two' }).click({ modifiers: ['Control'] });
      await farRow.click({ modifiers: ['Control'] });
      const three = requests.map((r) => r.entityId).sort();
      await expect.poll(() => selection(page)).toEqual(three);
      await expect(rows(page).and(page.locator('[aria-selected="true"]'))).toHaveCount(3);
      await rows(page).filter({ hasText: 'ITA two' }).click({ button: 'right' });
      await page.getByRole('menu', { name: 'Actions' }).getByRole('menuitem', { name: 'Delete' }).click();
      const question = page.getByRole('alertdialog', { name: 'Delete objects' });
      await expect(question).toContainText('Delete 3 objects? This cannot be undone.');
      await question.getByRole('button', { name: 'Delete 3 objects' }).click();
      for (const id of three) await nextEvent(live, (e) => e.entityId === id && e.operation === 'delete');
      for (const shown of [page, other]) {
        await expect(objectsPanel(shown).getByText('No objects in this layer')).toBeVisible();
        await expect(objectsPanel(shown).locator('.object-list-count')).toHaveText('0 objects');
      }
      const deletes = (await settle(live, layer)).filter((e) => e.operation === 'delete').map((e) => e.entityId).sort();
      expect(deletes, 'exactly the three').toEqual(three);
    },
    { probe: true },
  );
});

test('criterion 7: an object created or deleted in another session (a live picture client) changes the count and the page within 2 s; Refresh shows a changed name', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ live, open }) => {
    const page = await open();
    const layer = await newLayer(live, 'ITA live');
    const here = await positionAt(page, await mapCentre(page));
    const a = named(layer, [here[0] - 1.5, here[1] + 0.75], 'ITA a');
    const b = named(layer, [here[0] + 1.5, here[1] - 0.75], 'ITA b');
    await createAll(live, [a, b]);
    await openList(page, 'ITA live');
    await expect(rows(page)).toHaveCount(2);
    const count = objectsPanel(page).locator('.object-list-count');

    const c = named(layer, [here[0], here[1] + 2.25], 'ITA c');
    await createAll(live, [c]);
    // One deadline for both: the count and the page within 2 s of the change.
    const listShows = async () => [await count.textContent(), await names(page)];
    await expect.poll(listShows, { timeout: 2_000, message: 'the count and the page within 2 s of the create' }).toEqual(['3 objects', ['ITA a', 'ITA b', 'ITA c']]);

    const deleted = await live.change({ requestId: randomUUID(), entityType: 'object', operation: 'delete', entityId: a.entityId, source: { plugin: 'ita-test' } });
    expect(deleted.outcome).toBe('applied');
    await expect.poll(listShows, { timeout: 2_000, message: 'the count and the page within 2 s of the delete' }).toEqual(['2 objects', ['ITA b', 'ITA c']]);

    // A changed name (no count change) shows on Refresh.
    const created = await nextEvent(live, (e) => e.entityId === b.entityId && e.operation === 'create');
    const rename = structuredClone(b) as ReturnType<typeof createSymbol> & { baseVersion?: number };
    rename.requestId = randomUUID();
    rename.operation = 'update';
    rename.baseVersion = created.state.version;
    // A name after "ITA c", so that the order shown is still that of creation, not of names.
    rename.data.properties = { name: 'ITA z renamed' };
    expect((await live.change(rename)).outcome).toBe('applied');
    await objectsPanel(page).getByRole('button', { name: 'Refresh', exact: true }).click();
    await expect(rows(page).filter({ hasText: 'ITA z renamed' })).toHaveCount(1);
    expect(await names(page), 'in the order of creation').toEqual(['ITA z renamed', 'ITA c']);
  });
});
