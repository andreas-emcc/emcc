// Quick run: @plugin-draw-shapes @plugin-simulator @plugin-map-view-2d @plugin-layer-panel
import { expect, test, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { watchRequests, type Request, type State } from '../../lib/fields';
import { createLayer, createSymbol, LiveClient, seededLayer } from '../../lib/live.mjs';
import { bottomPanel, colourAround, mapCentre, positionAt, settle, userPause, withM0, type LonLat, type Point } from '../../lib/m0';

// M7, T-176 (SDK 1.6.0 part B, CR-0041; map-view-2d function 44 `MapView.append`; draw-shapes
// function 19, criteria 37 and 38; simulator function 49): "Append" continues a line from its last
// point, click by click; Enter or a double-click finishes and the plugin sends one update with the
// whole line; Escape, or a workspace switch, sends nothing. draw-shapes offers it beside Reshape in
// "Edit shape" for a LineString only (no Append for a polygon); the simulator in the route editor,
// where the new points copy the last point's entry. Both are off on a locked layer with its title.
// "Without rights" needs a user without the edit permission, so a login: not in this spec (see the
// handover). Positions are read from the cursor display (latitude ≠ longitude in the M0 view);
// change requests from the page's live picture socket.

test.describe.configure({ timeout: 180_000 });

const SIMULATION = 'simulator.simulation';
const LINE_COLOUR = [192, 48, 48] as const; // #C03030
type Event = { sequenceNo: number; entityId: string; operation: string; state: State | null };

/** Sends the request and resolves with the stored state; fails unless it is applied. */
async function applied(client: LiveClient, request: Request): Promise<State> {
  const outcome = await client.change(request);
  expect(outcome, `${request.entityType} ${request.operation}: ${JSON.stringify(outcome.rejection ?? '')}`).toMatchObject({ outcome: 'applied' });
  return outcome.event.state;
}

/** A create request for a core.shape (or a simulator.route) with this geometry, made through the API (the label createSymbol gives). */
function shapeRequest(layerId: string, geometry: State, name: string, extra: State = {}): Request {
  const request = createSymbol(layerId, 0, { name }) as Request & { data: State };
  request.data = {
    type: 'core.shape',
    dataType: 'core.general',
    dataSource: 'manual',
    layerId,
    geometry,
    style: { strokeColor: '#C03030', strokeWidth: 3 },
    properties: { name },
    label: request.data.label,
    ...extra,
  };
  return request;
}

const offset = (at: Point, dx: number, dy: number): Point => ({ x: at.x + dx, y: at.y + dy });

/** The positions under some pixels, read from the cursor display. */
async function positions(page: Page, points: Point[]): Promise<LonLat[]> {
  const out: LonLat[] = [];
  for (const p of points) out.push(await positionAt(page, p));
  return out;
}

/** Equal within the cursor display's 6 decimals and a pixel's rounding. */
function expectNearAll(actual: number[][], expected: LonLat[], what: string): void {
  expect(actual.length, `${what}: points`).toBe(expected.length);
  actual.forEach((p, i) => {
    expect(Math.abs(p[0] - expected[i][0]), `${what}: point ${i + 1}'s longitude`).toBeLessThan(2e-4);
    expect(Math.abs(p[1] - expected[i][1]), `${what}: point ${i + 1}'s latitude`).toBeLessThan(2e-4);
  });
}

/** Clicks the points at a user's pace (two clicks too close in time would be a double-click). */
async function clickPoints(page: Page, points: Point[]): Promise<void> {
  for (const p of points) {
    await page.mouse.click(p.x, p.y);
    await userPause(page);
  }
}

/** The page's requests for an object after `from`. */
const requestsFor = (sent: Request[], from: number, id: string) => sent.slice(from).filter((r) => r.entityId === id);

/** Waits for exactly one update of the object after `from` and returns it (a user's pause after the first, so that a second would show). */
async function oneUpdate(page: Page, sent: Request[], from: number, id: string, what: string): Promise<Request> {
  await expect.poll(() => requestsFor(sent, from, id).length, { message: `${what}: an update` }).toBeGreaterThanOrEqual(1);
  await userPause(page);
  const updates = requestsFor(sent, from, id);
  expect(updates.map((r) => r.operation), `${what}: one update`).toEqual(['update']);
  return updates[0];
}

/** A layer's row in the Layers tab of the bottom pane. */
async function layerRow(page: Page, name: string): Promise<Locator> {
  const panel = await bottomPanel(page, 'Layers');
  return panel.getByRole('list', { name: 'Layers', exact: true }).getByRole('listitem').filter({ has: page.getByRole('button', { name: `Make ${name} active`, exact: true }) });
}

/** Locks or unlocks a layer with the lock beside its eye in the layer list (T-099), and waits for the change event. */
async function lock(page: Page, live: LiveClient, layer: { id: string; name: string }, locked: boolean): Promise<void> {
  const from = (live.events as Event[]).length;
  const row = await layerRow(page, layer.name);
  await row.getByRole('button', { name: `${locked ? 'Lock' : 'Unlock'} ${layer.name}`, exact: true }).click();
  await expect
    .poll(() => (live.events as Event[]).slice(from).some((e) => e.entityId === layer.id && e.operation === 'update' && (e.state?.locked === true) === locked), { timeout: 10_000, message: `the ${locked ? 'lock' : 'unlock'}` })
    .toBe(true);
}

/** Opens "Edit shape" for the shape under the pixel (an outline is picked on its line, T-102). */
async function editShape(page: Page, at: Point): Promise<Locator> {
  await expect(async () => {
    await page.mouse.click(at.x, at.y, { button: 'right' });
    await page.getByRole('menu', { name: 'Actions' }).getByRole('menuitem', { name: 'Edit' }).click({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
  const edit = page.getByRole('region', { name: 'Edit shape', exact: true }).last(); // the plugin's frame inside the shell's panel of the same name
  await expect(edit.getByLabel('Name')).toBeVisible();
  return edit;
}

test('draw-shapes Append (T-176; criteria 37 and 38): on a polyline, beside Reshape; two clicks and Enter send one update with the five points, the data type, style and name unchanged; a click and a double-click finish too; Escape and a workspace switch send nothing; a polygon has no Append; off on a locked layer with its title, back after the unlock', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ live, snapshot, open }) => {
    const drawing = { id: seededLayer(snapshot), name: 'Drawing' };
    const probe = await applied(live, createLayer('Probe', { drawOrder: -5 }) as Request); // for settle(), below Drawing
    let sent: Request[] = [];
    const page = await open((p) => {
      sent = watchRequests(p);
    });
    const centre = await mapCentre(page);
    const own = [offset(centre, -180, -90), offset(centre, -120, -90), offset(centre, -60, -90)];
    const line = shapeRequest(drawing.id, { type: 'LineString', coordinates: await positions(page, own) }, 'ITA line');
    const created = await applied(live, line);
    const onLine = offset(centre, -150, -90);
    await expect.poll(() => colourAround(page, onLine, LINE_COLOUR, 8), { timeout: 10_000, message: 'the line is drawn' }).toBeGreaterThan(5);

    let edit = await editShape(page, onLine);
    let append = edit.getByRole('button', { name: 'Append', exact: true });
    await expect(edit.getByRole('button', { name: 'Reshape', exact: true })).toBeEnabled();
    await expect(append, 'Append beside Reshape for a line').toBeEnabled();

    // Two clicks and Enter: one update with the line's three points and the two new ones.
    const added = [offset(centre, 0, -40), offset(centre, 60, -10)];
    const addedAt = await positions(page, added);
    let from = sent.length;
    await append.click();
    await expect(edit, 'the hint while it runs').toContainText('Click to add points after the last point. Double-click or Enter finishes, Escape cancels.');
    await clickPoints(page, added);
    await page.keyboard.press('Enter');
    const first = await oneUpdate(page, sent, from, line.entityId, 'Enter');
    expect(first.data!.geometry.type).toBe('LineString');
    expectNearAll(first.data!.geometry.coordinates.slice(0, 3), line.data!.geometry.coordinates, 'the line\'s own points');
    expect(first.data!.geometry.coordinates.slice(0, 3), 'its own points exactly').toEqual(line.data!.geometry.coordinates);
    expectNearAll(first.data!.geometry.coordinates.slice(3), addedAt, 'the appended points');
    expect(first.data!.dataType, 'the data type unchanged').toBe('core.general');
    expect(first.data!.style, 'the style unchanged').toEqual(created.style);
    expect(first.data!.properties?.name, 'the name unchanged').toBe('ITA line');
    await expect(edit).not.toContainText('Click to add points');

    // A click, then a double-click: finishes too (one update, the line longer, its last point at the double-click).
    await expect.poll(async () => (await live.getObjects([line.entityId])).found[0]?.geometry.coordinates.length, { message: 'stored with five points' }).toBe(5);
    const more = [offset(centre, 110, 30), offset(centre, 160, 60)];
    const moreAt = await positions(page, more);
    from = sent.length;
    await append.click();
    await clickPoints(page, [more[0]]);
    await page.mouse.dblclick(more[1].x, more[1].y);
    const second = await oneUpdate(page, sent, from, line.entityId, 'double-click');
    const coordinates = second.data!.geometry.coordinates as number[][];
    testInfo.annotations.push({ type: 'points after a click and a double-click', description: `${coordinates.length} (from 5)` });
    expect(coordinates.length, 'at least the click\'s point added').toBeGreaterThanOrEqual(6);
    expect(coordinates.slice(0, 5), 'the five before unchanged').toEqual(first.data!.geometry.coordinates);
    expectNearAll([coordinates[5]], [moreAt[0]], 'the click\'s point');
    expectNearAll([coordinates.at(-1)!], [moreAt[1]], 'the last point at the double-click');
    await expect.poll(async () => (await live.getObjects([line.entityId])).found[0]?.geometry.coordinates.length, { message: 'stored' }).toBe(coordinates.length);
    // After a double-click the line is no longer selected, so "Edit shape" closes (after Enter it stays open): recorded, and opened again.
    const stillOpen = await page.getByRole('region', { name: 'Edit shape', exact: true }).count();
    testInfo.annotations.push({ type: '"Edit shape" after the double-click', description: stillOpen > 0 ? 'still open' : 'closed (the line deselected)' });
    edit = await editShape(page, onLine);
    append = edit.getByRole('button', { name: 'Append', exact: true });

    // Escape: nothing sent.
    from = sent.length;
    await append.click();
    await clickPoints(page, [offset(centre, 40, 80)]);
    await page.keyboard.press('Escape');
    await expect(edit).not.toContainText('Click to add points');
    // A workspace switch while it runs: nothing sent either.
    await append.click();
    await clickPoints(page, [offset(centre, -40, 80)]);
    const views = page.getByRole('tablist', { name: 'Views' });
    await views.getByRole('tab', { name: 'Simulation', exact: true }).click();
    await expect(views.getByRole('tab', { name: 'Simulation', exact: true })).toHaveAttribute('aria-selected', 'true');
    await views.getByRole('tab', { name: 'View', exact: true }).click();
    await expect(views.getByRole('tab', { name: 'View', exact: true })).toHaveAttribute('aria-selected', 'true');
    const before = (await live.getObjects([line.entityId])).found[0].version;
    await settle(live, probe.id);
    await userPause(page);
    expect(requestsFor(sent, from, line.entityId), 'Escape and the switch send nothing').toEqual([]);
    expect((await live.getObjects([line.entityId])).found[0].version, 'the line unchanged').toBe(before);

    // A polygon: Reshape, no Append.
    const corners = [offset(centre, -60, 60), offset(centre, 0, 60), offset(centre, 0, 120), offset(centre, -60, 120)];
    const ring = await positions(page, corners);
    await applied(live, shapeRequest(drawing.id, { type: 'Polygon', coordinates: [[...ring, ring[0]]] }, 'ITA area'));
    const onEdge = offset(centre, -30, 60);
    await expect.poll(() => colourAround(page, onEdge, LINE_COLOUR, 8), { timeout: 10_000, message: 'the polygon is drawn' }).toBeGreaterThan(5);
    const areaEdit = await editShape(page, onEdge);
    await expect(areaEdit.getByLabel('Name')).toHaveValue('ITA area');
    await expect(areaEdit.getByRole('button', { name: 'Reshape', exact: true })).toBeVisible();
    await expect(areaEdit.getByRole('button', { name: 'Append', exact: true }), 'no Append for a polygon').toHaveCount(0);

    // Locked: Append off with the lock as its title; back after the unlock.
    const lineEdit = await editShape(page, onLine);
    await expect(lineEdit.getByLabel('Name')).toHaveValue('ITA line');
    await lock(page, live, drawing, true);
    await expect(lineEdit).toContainText('Layer "Drawing" is locked');
    const lockedAppend = lineEdit.getByRole('button', { name: 'Append', exact: true });
    await expect(lockedAppend).toBeDisabled();
    await expect(lockedAppend).toHaveAttribute('title', 'Layer "Drawing" is locked');
    await lock(page, live, drawing, false);
    await expect(lockedAppend).toBeEnabled();
  });
});

test('simulator Append on a route (T-176; function 49): beside Reshape in the route editor; two clicks and Enter send one update of the route with five points, the new ones copying the last point\'s entry; Escape sends nothing; off on a locked layer with its title, back after the unlock', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open }) => {
    const all = await LiveClient.open(server.baseUrl);
    try {
      await all.subscribe({ workspaces: ['*'] });
      const layer = await applied(all, createLayer('Ground truth', { workspace: SIMULATION, drawOrder: 1 }) as Request);
      const probe = await applied(all, createLayer('Probe', { workspace: SIMULATION, drawOrder: -5 }) as Request);
      let sent: Request[] = [];
      const page = await open((p) => {
        sent = watchRequests(p);
      });
      const views = page.getByRole('tablist', { name: 'Views' });
      await views.getByRole('tab', { name: 'Simulation', exact: true }).click();
      await expect(views.getByRole('tab', { name: 'Simulation', exact: true })).toHaveAttribute('aria-selected', 'true');
      const centre = await mapCentre(page);
      const own = [offset(centre, -160, 40), offset(centre, -100, 40), offset(centre, -40, 40)];
      const LAST = { speedKind: 'instant', speed: 40 };
      const route = shapeRequest(layer.id, { type: 'LineString', coordinates: await positions(page, own) }, 'Route A', {
        dataType: 'simulator.route',
        style: { strokeColor: '#C03030', strokeWidth: 3, strokeDash: 'dash', pointMarkers: 'circle' },
        extensions: { simulator: { points: [{ speedKind: 'instant', speed: 30 }, { speedKind: 'instant', speed: 30 }, LAST], groups: [], end: 'stop' } },
      });
      await applied(all, route);

      const routes = page.getByRole('region', { name: 'Routes', exact: true }).first();
      const editor = page.getByRole('region', { name: 'Route editor', exact: true }).first();
      await routes.getByRole('button', { name: 'Edit Route A' }).click();
      await expect(editor.getByLabel('Name')).toHaveValue('Route A');
      const append = editor.getByRole('button', { name: 'Append', exact: true });
      await expect(editor.getByRole('button', { name: 'Reshape', exact: true })).toBeEnabled();
      await expect(append).toBeEnabled();

      const added = [offset(centre, 20, 0), offset(centre, 80, -30)];
      const addedAt = await positions(page, added);
      let from = sent.length;
      await append.click();
      await clickPoints(page, added);
      await page.keyboard.press('Enter');
      const update = await oneUpdate(page, sent, from, route.entityId, 'Enter');
      const coordinates = update.data!.geometry.coordinates as number[][];
      expect(coordinates.slice(0, 3), 'the route\'s own points').toEqual(route.data!.geometry.coordinates);
      expectNearAll(coordinates.slice(3), addedAt, 'the appended points');
      const points = update.data!.extensions?.simulator?.points as State[];
      expect(points, 'an entry per point').toHaveLength(5);
      expect(points.slice(0, 3), 'the old entries').toEqual(route.data!.extensions.simulator.points);
      for (const entry of points.slice(3)) expect(entry, 'a new point copies the last point\'s entry').toMatchObject(LAST);
      expect(update.data!.dataType).toBe('simulator.route');
      expect(update.data!.properties?.name).toBe('Route A');
      await expect.poll(async () => (await all.getObjects([route.entityId])).found[0]?.geometry.coordinates.length, { message: 'stored with five points' }).toBe(5);

      // Escape: nothing sent.
      from = sent.length;
      await append.click();
      await clickPoints(page, [offset(centre, 60, 60)]);
      await page.keyboard.press('Escape');
      const version = (await all.getObjects([route.entityId])).found[0].version;
      await settle(all, probe.id);
      await userPause(page);
      expect(requestsFor(sent, from, route.entityId), 'Escape sends nothing').toEqual([]);
      expect((await all.getObjects([route.entityId])).found[0].version).toBe(version);

      // Locked: off with the lock as its title; back after the unlock.
      await lock(page, all, { id: layer.id, name: 'Ground truth' }, true);
      await expect(editor).toContainText('Layer "Ground truth" is locked');
      await expect(append).toBeDisabled();
      await expect(append).toHaveAttribute('title', /Layer "Ground truth" is locked/);
      await lock(page, all, { id: layer.id, name: 'Ground truth' }, false);
      await expect(append).toBeEnabled();
    } finally {
      await all.close();
    }
  });
});
