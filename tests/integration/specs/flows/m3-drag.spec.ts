// Quick run: @plugin-draw-shapes @plugin-draw-symbols @plugin-map-view-2d @plugin-coordinates @plugin-simulator @plugin-layer-panel @plugin-symbology
// Quick run of this file alone: node tests/integration/run.mjs --skip-build -- specs/flows/m3-drag.spec.ts
import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createLayer, LiveClient } from '../../lib/live.mjs';
import { bottomPanel, drag, frameSymbol, mapCentre, mapPane, nextEvent, placeSymbols, positionAt, userPause, withM0, type LonLat, type Point } from '../../lib/m0';
import { pickAt, viewport } from '../../lib/perf';

// T-066 in the browser (T-086 part 5c): a selected shape is dragged to move it, next to
// draw-symbols' drag of a selected symbol (draw-shapes criterion 25's polygon, line, circle and
// ellipse, 27, 29 and 30's browser part; draw-symbols criterion 35's browser part; map-view-2d
// criterion 51 through the drop). Each test has a server of its own with every assembled plugin
// and the test probe (for the selection). The drop is the first position moved by the drag in
// pixels, so a drag's difference is read from the cursor display, before the gesture, at the
// first position's pixel and at that pixel moved by the drag; every position must move by exactly
// that difference (the display shows 6 decimals).
// The change requests are read from the page's live picture socket, so "one update, from the right
// plugin" is what the browser sent.

test.describe.configure({ timeout: 180_000 });

const SIMULATION = 'simulator.simulation';
const LABEL = { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' };
/** Another plugin's extension, which a drag must forward untouched. */
const FOREIGN = { 'nvg-in': { kept: 'exactly as it was', n: 0.1 } };

type Request = { requestId: string; entityType: string; operation: string; entityId: string; baseVersion?: number; data?: any; source?: { plugin: string } };

/** The change requests a page sends over its live picture connection, in order. */
function watchRequests(page: Page): Request[] {
  const sent: Request[] = [];
  page.on('websocket', (socket) =>
    socket.on('framesent', (frame) => {
      try {
        const message = JSON.parse(String(frame.payload));
        if (message.type === 'change-request') sent.push(message.request);
      } catch {
        // not JSON: not a change request
      }
    }),
  );
  return sent;
}

function at(base: Point, dx: number, dy: number): Point {
  return { x: base.x + dx, y: base.y + dy };
}

function selection(page: Page): Promise<string[]> {
  return page.evaluate(() => [...(window as unknown as { __itaProbe: { mapView: { selection: { value: readonly string[] } } } }).__itaProbe.mapView.selection.value].sort());
}

function shape(layerId: string, name: string, geometry: unknown, dataType = 'core.general', extensions: Record<string, unknown> = FOREIGN) {
  return {
    requestId: randomUUID(),
    entityType: 'object',
    operation: 'create',
    entityId: randomUUID(),
    data: {
      type: 'core.shape',
      dataType,
      dataSource: 'manual',
      layerId,
      geometry,
      style: { strokeColor: '#106010', strokeWidth: 6, fillColor: '#20c020', fillOpacity: 1 },
      properties: { name },
      label: LABEL,
      extensions,
    },
    source: { plugin: 'ita-test' },
  };
}

async function applied(client: LiveClient, request: { entityId: string }): Promise<number> {
  const outcome = await client.change(request);
  expect(outcome, `create ${request.entityId}`).toMatchObject({ outcome: 'applied' });
  return outcome.event.state.version as number;
}

/**
 * Ground metres per pixel at a latitude: the map view's resolution is that at the map's centre (SDK
 * Viewport), and in Web Mercator it goes with the cosine of the latitude.
 */
async function metresPerPixel(page: Page, latitude: number): Promise<number> {
  const { resolution, center } = await viewport(page);
  return (resolution * Math.cos((latitude * Math.PI) / 180)) / Math.cos((center[1] * Math.PI) / 180);
}

function moved(position: number[], by: LonLat): number[] {
  return [position[0] + by[0], position[1] + by[1], ...position.slice(2)];
}

/** Every position equal within the cursor display's rounding (two readings of 6 decimals). */
function expectPositions(actual: number[][], expected: number[][], what: string): void {
  expect(actual.length, what).toBe(expected.length);
  actual.forEach((p, i) => {
    expect(Math.abs(p[0] - expected[i][0]), `${what}, position ${i}, longitude ${p[0]} vs ${expected[i][0]}`).toBeLessThanOrEqual(2e-6);
    expect(Math.abs(p[1] - expected[i][1]), `${what}, position ${i}, latitude ${p[1]} vs ${expected[i][1]}`).toBeLessThanOrEqual(2e-6);
  });
}

/**
 * A pixel on an area's outline, east of `from` along its row: the middle of the pixels where the map
 * view picks the object (an area is picked on its outline only, T-102). Waits until it is drawn.
 */
async function outlineEast(page: Page, id: string, from: Point, max = 100): Promise<Point> {
  let found: Point | undefined;
  await expect(async () => {
    const hits: number[] = [];
    for (let dx = 0; dx <= max; dx++) if ((await pickAt(page, at(from, dx, 0), 0)).includes(id)) hits.push(dx);
    expect(hits.length, `the outline of ${id} east of ${from.x}, ${from.y}`).toBeGreaterThan(0);
    found = at(from, hits[Math.floor(hits.length / 2)], 0);
  }).toPass({ timeout: 15_000 });
  return found!;
}

/**
 * Waits until the drag of the object under the point is armed: the map view then shows the "move"
 * cursor over it (map-view-2d `setDragHover`). The pointer is moved a pixel back and forth so that
 * the map view sees a move there.
 */
async function armedAt(page: Page, point: Point): Promise<void> {
  const map = mapPane(page).locator('.ol-viewport');
  let side = 1;
  await expect.poll(async () => {
    side = -side;
    await page.mouse.move(point.x + side, point.y);
    await page.mouse.move(point.x, point.y);
    return map.evaluate((e) => (e as HTMLElement).style.cursor);
  }, { timeout: 15_000, message: 'the drag armed (the move cursor)' }).toBe('move');
}

/**
 * Clicks the point at a user's pace until the map view selects the object there: a new object is
 * selectable once the map has drawn it.
 */
async function selectAt(page: Page, id: string, point: Point): Promise<void> {
  await expect.poll(async () => {
    await page.mouse.click(point.x, point.y);
    await userPause(page);
    return selection(page);
  }, { timeout: 15_000, intervals: [0], message: `${id} selected by a click` }).toEqual([id]);
}

/**
 * Selects the object under `press` with a click, then drags from there to `release` at a user's
 * pace. Resolves with the one update the page sent for it; fails on none or more than one, also
 * within 1.5 s after the first, and on any change request for another object.
 */
async function dragOnce(page: Page, sent: Request[], id: string, press: Point, release: Point): Promise<Request> {
  await selectAt(page, id, press);
  await armedAt(page, press);
  const before = sent.length;
  await drag(page, press, release);
  await expect.poll(() => sent.slice(before).length, { message: 'an update sent' }).toBeGreaterThan(0);
  await page.waitForTimeout(1_500); // no second update may follow: a fixed wait, the absence is the check
  const after = sent.slice(before);
  expect(after.map((r) => `${r.operation} ${r.entityId}`), 'one update, for the dragged object only').toEqual([`update ${id}`]);
  return after[0];
}

test('draw-shapes 25, map-view-2d 51: a polygon with a hole, a line, a circle and an ellipse, each dragged by a difference not the same in longitude and latitude, each send one update from draw-shapes with every position moved by exactly that difference, the rest unchanged', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ live, snapshot, open }) => {
    let sent: Request[] = [];
    const page = await open((p) => {
      sent = watchRequests(p);
    });
    const layerId = snapshot.layers.find((l: { name: string }) => l.name === 'Drawing')!.id as string;
    const c = await mapCentre(page);
    const read = (dx: number, dy: number) => positionAt(page, at(c, dx, dy));

    // Each shape built from the positions the cursor display gives at chosen pixels.
    const outer = [[-210, -160], [-110, -160], [-110, -70], [-210, -70]];
    const hole = [[-180, -135], [-140, -135], [-140, -95], [-180, -95]];
    const ring = async (corners: number[][]) => {
      const positions: number[][] = [];
      for (const [dx, dy] of corners) positions.push(await read(dx, dy));
      return [...positions, positions[0]];
    };
    const polygon = shape(layerId, 'ITA polygon', { type: 'Polygon', coordinates: [await ring(outer), await ring(hole)] });
    const line = shape(layerId, 'ITA line', { type: 'LineString', coordinates: [await read(-60, -150), await read(40, -90), await read(90, -150)] });
    const circleCentre = await read(130, 60);
    const circle = shape(layerId, 'ITA circle', { type: 'Circle', center: circleCentre, radius: Math.round(30 * (await metresPerPixel(page, circleCentre[1]))) });
    const ellipseCentre = await read(-150, 90);
    const perPixel = await metresPerPixel(page, ellipseCentre[1]);
    const ellipse = shape(layerId, 'ITA ellipse', { type: 'Ellipse', center: ellipseCentre, semiMajorAxis: Math.round(45 * perPixel), semiMinorAxis: Math.round(25 * perPixel), rotation: 30 });
    expect(Math.abs(circleCentre[0] - circleCentre[1]), 'latitude ≠ longitude').toBeGreaterThan(1);

    // `first`: the pixel of the geometry's first position (the centre for a circle or an ellipse).
    // An area is pressed on its outline (T-102), found east of a point inside it once it is drawn.
    const cases = [
      { request: polygon, press: at(c, -195, -150), first: at(c, -210, -160), area: true }, // from inside the outer ring, outside the hole
      { request: line, press: at(c, -40, -138), first: at(c, -60, -150), area: false }, // on its first segment
      { request: circle, press: at(c, 130, 60), first: at(c, 130, 60), area: true },
      { request: ellipse, press: at(c, -150, 90), first: at(c, -150, 90), area: true },
    ];
    // The stored geometry is the reference: the store turns rings to the right-hand rule (model rule 1).
    const stored = new Map<string, any>();
    for (const { request } of cases) {
      const outcome = await live.change(request);
      expect(outcome, `create ${request.data.properties.name}`).toMatchObject({ outcome: 'applied' });
      (request as { version?: number }).version = outcome.event.state.version;
      stored.set(request.entityId, outcome.event.state.geometry);
    }

    for (const { request, press: inside, first, area } of cases) {
      const press = area ? await outlineEast(page, request.entityId, inside) : inside;
      const release = at(press, 70, 45);
      // The drop is the first position moved by the drag in pixels (map-view-2d 51), and every
      // position moves by the drop minus the first position in lon/lat (draw-shapes function 16).
      // Latitude's scale changes across the map, so the difference is read at the first position.
      const from = await positionAt(page, first);
      const to = await positionAt(page, at(first, 70, 45));
      const by: LonLat = [to[0] - from[0], to[1] - from[1]];
      expect(Math.abs(Math.abs(by[0]) - Math.abs(by[1])), 'a difference not the same in longitude and latitude').toBeGreaterThan(0.05);

      const update = await dragOnce(page, sent, request.entityId, press, release);
      const name = request.data.properties.name;
      expect(update.source?.plugin, `${name}: from draw-shapes`).toBe('draw-shapes');
      expect(update.baseVersion, `${name}: the newest version`).toBe((request as { version?: number }).version);
      const kept = await nextEvent(live, (e) => e.entityId === request.entityId && e.operation === 'update');
      expect(kept.state.extensions?.['nvg-in'], `${name}: another plugin's namespace kept in the store`).toEqual(FOREIGN['nvg-in']);
      expect(update.data.properties, `${name}: properties unchanged`).toEqual(request.data.properties);
      expect(update.data.style, `${name}: style unchanged`).toEqual(request.data.style);
      const was = stored.get(request.entityId);
      const now = update.data.geometry;
      if (was.type === 'Polygon') {
        was.coordinates.forEach((r: number[][], i: number) => expectPositions(now.coordinates[i], r.map((p) => moved(p, by)), `${name}, ring ${i}`));
      } else if (was.type === 'LineString') {
        expectPositions(now.coordinates, was.coordinates.map((p: number[]) => moved(p, by)), name);
      } else {
        expectPositions([now.center], [moved(was.center, by)], `${name}: the centre at the drop`);
        expect({ ...now, center: undefined }, `${name}: its other values unchanged`).toEqual({ ...was, center: undefined });
      }
      await page.keyboard.press('Escape');
      await userPause(page);
    }
  }, { probe: true });
});

test('draw-shapes 27: Escape while the drag only waits clears the selection; Escape while a shape is dragged sends nothing and keeps it selected', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ live, snapshot, open }) => {
    let sent: Request[] = [];
    const page = await open((p) => {
      sent = watchRequests(p);
    });
    const layerId = snapshot.layers.find((l: { name: string }) => l.name === 'Drawing')!.id as string;
    const c = await mapCentre(page);
    const centre = await positionAt(page, c);
    const circle = shape(layerId, 'ITA circle', { type: 'Circle', center: centre, radius: Math.round(40 * (await metresPerPixel(page, centre[1]))) });
    await applied(live, circle);

    // While the drag only waits (armed, nothing pressed), one Escape clears the selection. The
    // circle is pressed on its outline, 40 px east of its centre (T-102).
    const rim = at(c, 40, 0);
    const before = sent.length;
    await selectAt(page, circle.entityId, rim);
    await armedAt(page, rim);
    await page.keyboard.press('Escape');
    await expect.poll(() => selection(page), { message: 'Escape while the drag only waits clears the selection' }).toEqual([]);

    // On a grabbed shape, Escape cancels the drag only. (Whether the drag is armed again after
    // that is not in the brief, so nothing is checked after it.)
    await userPause(page);
    await selectAt(page, circle.entityId, rim);
    await armedAt(page, rim);
    await page.mouse.down();
    for (let i = 1; i <= 5; i++) {
      await page.mouse.move(rim.x + 8 * i, rim.y + 6 * i);
      await page.waitForTimeout(50); // part of the gesture
    }
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.waitForTimeout(1_500); // nothing may be sent: a fixed wait, the absence is the check
    expect(sent.slice(before), 'nothing sent after Escape during the drag').toEqual([]);
    expect(await selection(page), 'the shape stays selected').toEqual([circle.entityId]);
  }, { probe: true });
});

test('draw-shapes 30, draw-symbols 35: a shape selected after a symbol gets the shape\'s drag and a symbol selected after a shape the symbol\'s, each drag one update from the right plugin; placing a symbol while a shape is selected goes on', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ live, snapshot, open }) => {
    let sent: Request[] = [];
    const page = await open((p) => {
      sent = watchRequests(p);
    });
    const layerId = snapshot.layers.find((l: { name: string }) => l.name === 'Drawing')!.id as string;
    const c = await mapCentre(page);
    const symbolAt = at(c, -120, -60);
    const shapeAt = at(c, 80, -60);
    const symbol = frameSymbol(layerId, await positionAt(page, symbolAt), 'hostile');
    await applied(live, symbol);
    const shapeCentre = await positionAt(page, shapeAt);
    const circle = shape(layerId, 'ITA circle', { type: 'Circle', center: shapeCentre, radius: Math.round(30 * (await metresPerPixel(page, shapeCentre[1]))) });
    await applied(live, circle);

    // Symbol, then shape, then the symbol again: each drag from its own plugin.
    let update = await dragOnce(page, sent, symbol.entityId, symbolAt, at(symbolAt, 50, 70));
    expect(update.source?.plugin, 'the symbol by draw-symbols').toBe('draw-symbols');
    const rim = at(shapeAt, 30, 0); // on the circle's outline (T-102)
    update = await dragOnce(page, sent, circle.entityId, rim, at(rim, -40, 80));
    expect(update.source?.plugin, 'the shape by draw-shapes').toBe('draw-shapes');
    update = await dragOnce(page, sent, symbol.entityId, at(symbolAt, 50, 70), at(symbolAt, 110, 90));
    expect(update.source?.plugin, 'the symbol again by draw-symbols').toBe('draw-symbols');

    // A shape selected, then a symbol placed on empty map: placing goes on, and the shape is not changed.
    const shapeNow = at(rim, -40, 80); // the rim, moved with the circle
    await selectAt(page, circle.entityId, shapeNow);
    const before = sent.length;
    await placeSymbols(page, 'Infantry', [at(c, -60, 120)]);
    await expect.poll(() => sent.slice(before).length, { message: 'a symbol placed' }).toBeGreaterThan(0);
    await page.waitForTimeout(1_500); // nothing else may be sent: a fixed wait, the absence is the check
    expect(sent.slice(before).map((r) => `${r.operation} ${r.source?.plugin}`), 'only the placed symbol').toEqual(['create draw-symbols']);
  }, { probe: true });
});

test('draw-shapes 29: a route in Simulation is dragged as a whole: one update from draw-shapes, every point moved by the same difference, the simulator\'s extension untouched', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open }) => {
    const all = await LiveClient.open(server.baseUrl);
    try {
      await all.subscribe({ workspaces: ['*'] });
      let sent: Request[] = [];
      const page = await open((p) => {
        sent = watchRequests(p);
      });
      const c = await mapCentre(page);
      // Positions read in View: the first visit to Simulation shows View's map (map-view-2d 45),
      // and Simulation has no cursor display yet (coordinates' T-085 is not merged).
      const pixels = [[-160, -40], [-40, 40], [80, -20]];
      const points: number[][] = [];
      for (const [dx, dy] of pixels) points.push(await positionAt(page, at(c, dx, dy)));
      const press = at(c, -160, -40);
      const release = at(press, 90, 60);
      const from = await positionAt(page, press);
      const to = await positionAt(page, release);
      const by: LonLat = [to[0] - from[0], to[1] - from[1]];

      const layer = createLayer('Ground truth', { workspace: SIMULATION, drawOrder: 1 });
      await applied(all, layer);
      const simulator = { points: [{ speedKind: 'instant', speed: 50 }, { speedKind: 'instant', speed: 50 }, {}], groups: [], end: 'stop' };
      const route = shape(layer.entityId, 'ITA route', { type: 'LineString', coordinates: points }, 'simulator.route', { simulator });
      route.data.style = { strokeColor: '#2C784C', strokeWidth: 6, strokeDash: 'solid', pointMarkers: 'circle' } as never;
      const version = await applied(all, route);

      await page.getByRole('tablist', { name: 'Views' }).getByRole('tab', { name: 'Simulation', exact: true }).click();
      await expect(page.getByRole('tabpanel', { name: 'Simulation' }).getByRole('tab', { name: 'Layers', exact: true })).toBeVisible();
      await bottomPanel(page, 'Layers'); // Simulation's bottom pane may show Objects first (M4, T-108)
      await expect(page.getByRole('tabpanel', { name: 'Layers', exact: true }).getByRole('button', { name: 'Make Ground truth active' })).toBeVisible();
      // The pixels read in View hold in Simulation: the same Map Pane, and the same map (first visit).
      expect(await mapCentre(page), 'the same Map Pane centre in Simulation').toEqual(c);
      expect(Math.abs(points[0][0] - points[0][1]), 'latitude ≠ longitude').toBeGreaterThan(1);

      const update = await dragOnce(page, sent, route.entityId, press, release);
      expect(update.source?.plugin).toBe('draw-shapes');
      expect(update.baseVersion).toBe(version);
      expect(update.data.dataType).toBe('simulator.route');
      const stored = await nextEvent(all, (e) => e.entityId === route.entityId && e.operation === 'update');
      expect(stored.state.extensions?.simulator, 'the simulator\'s extension kept in the store').toEqual(simulator);
      expectPositions(update.data.geometry.coordinates, points.map((p) => moved(p, by)), 'the route');
      const deltas = (update.data.geometry.coordinates as number[][]).map((p, i) => [p[0] - points[i][0], p[1] - points[i][1]]);
      for (const d of deltas) expectPositions([d], [deltas[0]], 'the same difference for every point');
    } finally {
      await all.close();
    }
  }, { probe: true });
});

// Not here: a press on a shape before its read answers moves nothing (draw-shapes 30): the browser
// gives no hook to hold the read, so it is the plugins' own test with the fake map view.
