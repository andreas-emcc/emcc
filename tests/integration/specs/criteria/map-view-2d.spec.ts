// Quick run: @plugin-map-view-2d @plugin-layer-panel
import { expect, test, type Page } from '@playwright/test';
import {
  closeCoordinates,
  colourAround,
  colourCentreInMap,
  coordinates,
  frameSymbol,
  IDENTITY,
  layerRequest,
  mapCentre,
  mapPane,
  nextEvent,
  positionAt,
  switchProjection,
  userPause,
  withM0,
  type LonLat,
  type Point,
} from '../../lib/m0';
import { fitScreen, projections } from '../../lib/projections.mjs';
import { seededLayer, type LiveClient } from '../../lib/live.mjs';
import { grid, LoadClient, symbolData } from '../../lib/load.mjs';
import { watchMapSubscription, type MapSubscription } from '../../lib/map-subscription';
import { pickAt, viewport } from '../../lib/perf';

// map-view-2d's acceptance criteria in a real browser with real OpenLayers
// (docs/plugins/briefs/map-view-2d.md), the column "Left for the ITA" of
// docs/handover/pca-map-view-2d.md and review remark N4. Criterion 14 is M0's (see below); criteria
// 8 and 9 are measured, not gated, by the performance suite (specs/performance/). Without a GPU
// here: every run is in software mode.

test.describe.configure({ timeout: 120_000 });

type Placed = { identity: keyof typeof IDENTITY; position: LonLat };

async function place(live: LiveClient, layerId: string, symbols: Placed[]) {
  for (const s of symbols) {
    const outcome = await live.change(frameSymbol(layerId, s.position, s.identity));
    expect(outcome.outcome, `${s.identity} placed`).toBe('applied');
  }
}

/** Where each symbol is drawn: the centre of its identity's colour in the Map Pane. */
async function drawn(page: Page, symbols: Placed[]): Promise<Point[]> {
  const points: Point[] = [];
  for (const s of symbols) {
    let at: Point | null = null;
    await expect
      .poll(async () => (at = await colourCentreInMap(page, IDENTITY[s.identity].colour)), { timeout: 10_000, message: `${s.identity} drawn` })
      .not.toBeNull();
    points.push(at!);
  }
  return points;
}

/**
 * Checks the drawn positions against independent projection maths: a scale and offset fitted to
 * the two symbols drawn farthest apart (so that their small measuring errors grow least) must put
 * every other one within `tolerance` pixels. Then the reverse:
 * the cursor display at a drawn symbol shows a position that maps back to that pixel, within
 * `tolerance` too.
 */
async function expectProjected(page: Page, code: 'EPSG:3857' | 'EPSG:3413', symbols: Placed[], tolerance = 1.5) {
  const at = await drawn(page, symbols);
  let [a, b] = [0, 1];
  for (let i = 0; i < at.length; i++) {
    for (let j = i + 1; j < at.length; j++) {
      if (Math.hypot(at[i].x - at[j].x, at[i].y - at[j].y) > Math.hypot(at[a].x - at[b].x, at[a].y - at[b].y)) [a, b] = [i, j];
    }
  }
  const fit = fitScreen(projections[code], [symbols[a].position, at[a]], [symbols[b].position, at[b]]);
  const report: string[] = [];
  for (const [i, s] of symbols.entries()) {
    const predicted = fit.predict(s.position);
    const dx = at[i].x - predicted.x;
    const dy = at[i].y - predicted.y;
    report.push(`${s.identity} [${s.position}] drawn ${at[i].x.toFixed(1)},${at[i].y.toFixed(1)} off ${dx.toFixed(2)},${dy.toFixed(2)} px`);
    expect(Math.hypot(dx, dy), `${code}: ${s.identity} at the projected place`).toBeLessThan(tolerance);
  }
  for (const [i, s] of symbols.entries()) {
    const pixel = { x: Math.round(at[i].x), y: Math.round(at[i].y) };
    const shown = await positionAt(page, pixel);
    const back = fit.predict(shown);
    const readBack = Math.hypot(back.x - pixel.x, back.y - pixel.y);
    report.push(`read back at ${s.identity}: ${readBack.toFixed(2)} px`);
    expect(readBack, `${code}: cursor display at ${s.identity}`).toBeLessThan(tolerance);
  }
  test.info().annotations.push({ type: code, description: `${(fit.resolution / 1000).toFixed(3)} km/px; ${report.join('; ')}` });
}

// Latitude ≠ longitude everywhere (ADR-0007).
const AROUND_SCANDINAVIA: Placed[] = [
  { identity: 'friend', position: [12.5, 60.2] },
  { identity: 'hostile', position: [17.8, 63.9] },
  { identity: 'neutral', position: [21.3, 58.7] },
  { identity: 'unknown', position: [9.4, 64.6] },
];

test('criterion 3 (N4): positions are drawn where independent projection maths puts them, in EPSG:3857 and EPSG:3413, and read back the same', async ({
  browser,
}, testInfo) => {
  await withM0(testInfo, browser, async ({ live, snapshot, open }) => {
    const page = await open();
    const layer = snapshot.layers.find((l: { name: string }) => l.name === 'Drawing')!.id;
    await place(live, layer, AROUND_SCANDINAVIA);
    await expectProjected(page, 'EPSG:3857', AROUND_SCANDINAVIA);

    await switchProjection(page, 'EPSG:3413');
    await expectProjected(page, 'EPSG:3413', AROUND_SCANDINAVIA);
  });
});

test('criterion 4: in EPSG:3413 objects near the North Pole, over it and across the antimeridian are drawn correctly', async ({
  browser,
}, testInfo) => {
  await withM0(testInfo, browser, async ({ live, snapshot, open }) => {
    const page = await open();
    await switchProjection(page, 'EPSG:3413');
    const panel = await coordinates(page);
    await panel.getByRole('textbox').fill('89.990000° N 30.000000° E');
    await panel.getByRole('button', { name: 'Go' }).click();
    await closeCoordinates(page);
    await expect.poll(async () => (await positionAt(page, await mapCentre(page)))[1], { timeout: 10_000 }).toBeGreaterThan(89.9);

    const layer = snapshot.layers.find((l: { name: string }) => l.name === 'Drawing')!.id;
    const nearPole: Placed[] = [
      { identity: 'friend', position: [175, 84] }, // west of the antimeridian ...
      { identity: 'hostile', position: [-175, 84] }, // ... and east of it: neighbours on the map
      { identity: 'neutral', position: [60, 89.95] }, // next to the pole
      { identity: 'unknown', position: [-45, 85.5] },
    ];
    await place(live, layer, nearPole);
    await expectProjected(page, 'EPSG:3413', nearPole);
    // Across the antimeridian the two are close, not drawn on opposite sides of the map.
    const [west, east] = await drawn(page, nearPole.slice(0, 2));
    expect(Math.hypot(west.x - east.x, west.y - east.y), 'distance across the antimeridian in px').toBeLessThan(80);
  });
});

test('criterion 2: an object created elsewhere appears without reload at the correct position within 1 s', async ({
  browser,
}, testInfo) => {
  await withM0(testInfo, browser, async ({ live, snapshot, open }) => {
    const page = await open();
    const centre = await mapCentre(page);
    const point = { x: centre.x + 160, y: centre.y + 110 };
    const position = await positionAt(page, point);
    const layer = snapshot.layers.find((l: { name: string }) => l.name === 'Drawing')!.id;

    const sent = Date.now();
    const outcome = await live.change(frameSymbol(layer, position, 'friend'));
    expect(outcome.outcome).toBe('applied');
    while ((await colourAround(page, point, IDENTITY.friend.colour)) < 50) {
      expect(Date.now() - sent, 'shown in the browser').toBeLessThan(1000);
    }
    testInfo.annotations.push({ type: 'criterion 2', description: `${Date.now() - sent} ms from the change request to the pixels (upper bound)` });
    const [at] = await drawn(page, [{ identity: 'friend', position }]);
    expect(Math.hypot(at.x - point.x, at.y - point.y), 'drawn at the pixel of its position').toBeLessThan(1.5);
  });
});

test('criterion 5: layers are drawn in drawOrder, a reorder shows without reload, and hiding a layer locally leaves a second browser unaffected', async ({
  browser,
}, testInfo) => {
  await withM0(testInfo, browser, async ({ live, snapshot, open }) => {
    const page = await open();
    const other = await open();
    const point = await mapCentre(page);
    const position = await positionAt(page, point);
    const base = snapshot.layers.find((l: { name: string }) => l.name === 'Drawing')!;

    // A layer above Drawing; a friend frame in it and a hostile frame in Drawing, at one position.
    const top = { id: crypto.randomUUID(), name: 'Top', drawOrder: base.drawOrder + 1 };
    expect((await live.change(layerRequest('create', top))).outcome).toBe('applied');
    expect((await live.change(frameSymbol(top.id, position, 'friend'))).outcome).toBe('applied');
    expect((await live.change(frameSymbol(base.id, position, 'hostile'))).outcome).toBe('applied');
    const colourAtCentre = async (p: Page) => {
      const friend = await colourAround(p, point, IDENTITY.friend.colour, 3);
      const hostile = await colourAround(p, point, IDENTITY.hostile.colour, 3);
      return friend > hostile ? 'friend' : hostile > friend ? 'hostile' : 'none';
    };
    await expect.poll(() => colourAtCentre(page), { timeout: 10_000 }).toBe('friend');

    // Drawing goes above Top: the map reorders without reload.
    const update = layerRequest('update', { ...base, drawOrder: top.drawOrder + 1 });
    expect((await live.change(update)).outcome).toBe('applied');
    await expect.poll(() => colourAtCentre(page), { timeout: 10_000 }).toBe('hostile');

    // Hiding Drawing in one browser shows Top's symbol there, and changes nothing in the other.
    await expect.poll(() => colourAtCentre(other), { timeout: 10_000 }).toBe('hostile');
    await page.getByRole('tabpanel', { name: 'Layers', exact: true }).getByRole('button', { name: 'Hide Drawing' }).click();
    await expect.poll(() => colourAtCentre(page), { timeout: 10_000 }).toBe('friend');
    expect(await colourAtCentre(other)).toBe('hostile');
  });
});

// Criterion 14 (the budget warning in software mode) is M0's: from M1 the map view subscribes to an
// area of interest and the server sends clusters above the object budget, so there is no warning
// any more (brief function 12). Criteria 20 to 22 replace it. What the map view receives is read
// from the page's WebSocket (lib/map-subscription.ts); what it draws from the pixels and pick.

type ProbeView = { goTo(c: LonLat, r: number): void; selection: { value: readonly string[] } };

async function goTo(page: Page, center: LonLat, resolution: number) {
  await page.evaluate(([c, r]) => (window as unknown as { __itaProbe: { mapView: ProbeView } }).__itaProbe.mapView.goTo(c, r), [center, resolution] as const);
}

test('criterion 21: over the budget the map shows a cluster instead of its objects; hiding its layers locally removes it at once; a click on it zooms in', async ({
  browser,
}, testInfo) => {
  await withM0(
    testInfo,
    browser,
    async ({ server, live, snapshot, open }) => {
      let map!: MapSubscription;
      const page = await open((p) => {
        map = watchMapSubscription(p);
      });
      const base = snapshot.layers.find((l: { name: string }) => l.name === 'Drawing')!;
      const second = { id: crypto.randomUUID(), name: 'Second', drawOrder: base.drawOrder + 1 };
      expect((await live.change(layerRequest('create', second))).outcome).toBe('applied');
      const centre = await mapCentre(page);
      const here = await positionAt(page, centre);
      // 50 objects on the centre (30 friend in Drawing, 20 hostile in Second), 10 spread over the view.
      const requests = [
        ...Array.from({ length: 50 }, (_, i) =>
          frameSymbol(i < 30 ? base.id : second.id, [here[0] + (i % 5) * 0.0001, here[1] + Math.floor(i / 5) * 0.0001], i < 30 ? 'friend' : 'hostile'),
        ),
        ...Array.from({ length: 10 }, (_, i) => frameSymbol(base.id, [here[0] - 8 + (i % 5) * 4, here[1] - 4 + Math.floor(i / 5) * 6.5], 'neutral')),
      ];
      for (const r of requests) expect((await live.change(r)).outcome).toBe('applied');
      await expect.poll(() => map.objectIds().size, { timeout: 10_000, message: 'all 60 one by one at the default budget' }).toBe(60);
      await expect.poll(() => pickAt(page, centre), { timeout: 10_000 }).not.toEqual([]);

      // The map view's budget at runtime (its settings, SDK v1): 20.
      const settingsUrl = `${server.baseUrl}/api/settings/plugins/map-view-2d`;
      const values = (await (await fetch(settingsUrl)).json()).values;
      const put = await fetch(settingsUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, softwareBudget: 20, hardwareBudget: 20 }),
      });
      expect(put.status).toBe(200);
      await expect.poll(() => map.subscribe()?.budget, { timeout: 10_000, message: 'a new subscription with the budget' }).toBe(20);
      await expect.poll(() => map.clusters().map((c) => c.count), { timeout: 10_000 }).toEqual([50]);
      expect(map.objectIds().size, 'the spread ones stay objects').toBe(10);
      testInfo.annotations.push({ type: 'cluster', description: JSON.stringify(map.clusters()[0]) });

      // Drawn as a cluster: not pickable, in both identities' colours.
      await expect.poll(() => pickAt(page, centre), { timeout: 10_000, message: 'clusters are not objects' }).toEqual([]);
      await expect.poll(() => colourAround(page, centre, IDENTITY.friend.colour, 12), { timeout: 10_000 }).toBeGreaterThan(20);
      expect(await colourAround(page, centre, IDENTITY.hostile.colour, 12)).toBeGreaterThan(20);

      // Hiding a layer in this browser lowers the cluster's count at once, without the server: with
      // Second hidden 30 of 50 are left, so the marker (its radius grows with the count) gets
      // smaller. Both identities stay: the split is scaled in proportion (known limit, owner
      // 2026-10-11, plugins/map-view-2d/web/src/core/clusters.ts). With both hidden the count is 0
      // and the cluster is gone. The count itself is drawn on the canvas and not read; its value is
      // checked on the wire.
      const panel = page.getByRole('tabpanel', { name: 'Layers', exact: true });
      const held = map.clusters().length;
      const marker = async () => (await colourAround(page, centre, IDENTITY.friend.colour)) + (await colourAround(page, centre, IDENTITY.hostile.colour));
      const full = await marker();
      await panel.getByRole('button', { name: 'Hide Second' }).click();
      await expect.poll(marker, { timeout: 2_000, message: 'a smaller marker for 30' }).toBeLessThan(full * 0.97);
      expect(await colourAround(page, centre, IDENTITY.friend.colour, 12), 'Drawing still counts').toBeGreaterThan(20);
      testInfo.annotations.push({ type: 'marker pixels', description: `50: ${full}, 30: ${await marker()}` });
      await panel.getByRole('button', { name: 'Hide Drawing' }).click();
      await expect.poll(() => colourAround(page, centre, IDENTITY.hostile.colour, 12), { timeout: 2_000 }).toBe(0);
      await expect.poll(() => colourAround(page, centre, IDENTITY.friend.colour, 12), { timeout: 2_000 }).toBe(0);
      expect(map.clusters().length, 'the server still sends the cluster').toBe(held);
      await panel.getByRole('button', { name: 'Show Second' }).click();
      await panel.getByRole('button', { name: 'Show Drawing' }).click();
      await expect.poll(() => colourAround(page, centre, IDENTITY.friend.colour, 12), { timeout: 2_000 }).toBeGreaterThan(20);

      // A click on the cluster zooms in; a click on empty map does not. The clicks are a user's
      // pace apart (two quick clicks zoom the map anyway).
      const before = (await viewport(page)).resolution;
      await page.mouse.click(centre.x - 150, centre.y + 120);
      await userPause(page);
      expect((await viewport(page)).resolution, 'a click on empty map does not zoom').toBe(before);
      await page.mouse.click(centre.x, centre.y);
      await expect.poll(async () => (await viewport(page)).resolution, { timeout: 10_000 }).toBeLessThan(before * 0.9);
    },
    { probe: true },
  );
});

// 200 000 objects take over a minute to create: only in the full run (T-063).
test('criterion 22: with 200 000 objects and the view zoomed out, the map view gets at most its budget in items (objects and clusters)', { tag: '@full' }, async ({
  browser,
}, testInfo) => {
  testInfo.setTimeout(600_000);
  await withM0(
    testInfo,
    browser,
    async ({ server, live, snapshot, open }) => {
      const layer = seededLayer(snapshot);
      await live.close(); // its whole-picture subscription would keep 200 000 events in this process
      const load = await LoadClient.open(server.baseUrl);
      // A grid over the world (lat = lon at a grid point is not excluded, but improbable).
      const created = await load.create(grid([-170.5, -60.25, 170.5, 70.25], 200_000).map((p, i) => symbolData(layer, i, p)));
      expect(load.summary()).toMatchObject({ applied: 200_000, rejected: 0, unknown: 0, errors: 0 });
      await load.close();
      testInfo.annotations.push({ type: 'created', description: `200 000 objects in ${(created.ms / 1000).toFixed(0)} s` });

      let map!: MapSubscription;
      const page = await open((p) => {
        map = watchMapSubscription(p);
      });
      await expect.poll(() => map.items(), { timeout: 60_000 }).toBeGreaterThan(0);
      const { center } = await viewport(page);
      const answeredBefore = map.moves().answered;
      await goTo(page, center, 1e6); // clamped to the widest zoom
      await expect.poll(() => map.moves().answered, { timeout: 60_000, message: 'the area moved with the view' }).toBeGreaterThan(answeredBefore);
      // Settled: the same number of items for 3 s.
      let last = -1;
      let same = 0;
      await expect
        .poll(
          () => {
            const now = map.items();
            same = now === last ? same + 1 : 0;
            last = now;
            return same >= 6;
          },
          { timeout: 120_000, intervals: [500] },
        )
        .toBe(true);
      const budget = map.subscribe()!.budget as number;
      const result = {
        budget,
        items: map.items(),
        objects: map.objectIds().size,
        clusters: map.clusters().length,
        inClusters: map.clusters().reduce((n, c) => n + c.count, 0),
        resolution: (await viewport(page)).resolution,
        moves: map.moves(),
      };
      testInfo.annotations.push({ type: 'zoomed out', description: JSON.stringify(result) });
      expect(map.errors(), 'no subscribe or move refused (e.g. the 600 000 objects per connection)').toEqual([]);
      expect(result.clusters, `clusters at the widest zoom: ${JSON.stringify(result)}`).toBeGreaterThan(0);
      expect(result.items, `at most the budget: ${JSON.stringify(result)}`).toBeLessThanOrEqual(budget);
    },
    { probe: true },
  );
});

test('criterion 13: the map view reports how it draws; without a GPU the notice is shown and the status says so', async ({
  browser,
}, testInfo) => {
  await withM0(testInfo, browser, async ({ open }) => {
    let notice = '';
    const page = await open(async (p) => {
      // Load once before openApp, which dismisses the notice, to see it as the user does.
      await p.goto('/');
      const row = p.getByRole('complementary', { name: 'Control Pane' }).getByRole('listitem', { includeHidden: true }).filter({ hasText: '2D map view' });
      await expect(row).toContainText(/web (OK|DEGRADED)/, { timeout: 10_000 });
      if (/without a GPU/.test((await row.textContent()) ?? '')) {
        const shown = mapPane(p).getByRole('status').filter({ hasText: 'without a GPU' });
        await expect(shown).toBeVisible();
        notice = (await shown.textContent()) ?? '';
      }
    });
    const row = page.getByRole('complementary', { name: 'Control Pane' }).getByRole('listitem', { includeHidden: true }).filter({ hasText: '2D map view' });
    const status = (await row.textContent()) ?? '';
    testInfo.annotations.push({ type: 'criterion 13', description: `status: ${status}; notice: ${notice || '(none)'}` });
    if (notice === '') {
      // Hardware: no notice, and the web part is OK (not tested here: this machine has no GPU).
      expect(status).toContain('web OK');
      await expect(mapPane(page).getByRole('status').filter({ hasText: 'without a GPU' })).toHaveCount(0);
    } else {
      // Software: the notice was shown, and the status reports it.
      expect(status).toContain('web DEGRADED: drawn without a GPU');
      expect(notice).toContain('without a GPU');
    }
  });
});
