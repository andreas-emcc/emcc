// Quick run: @plugin-cot @plugin-simulator @plugin-layer-panel @plugin-draw-shapes @plugin-draw-symbols @plugin-map-view-2d @tak @settings
import { expect, test, type Locator, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { setLinks } from '../../lib/cot';
import { createLayer, createSymbol, LiveClient, seededLayer } from '../../lib/live.mjs';
import { bottomPanel, colourAround, drag, frameSymbol, FRIEND, mapCentre, nextEvent, positionAt, settle, userPause, withM0 } from '../../lib/m0';
import { withOwnServers, type OwnServer } from '../../lib/own-server';
import { installPlugins } from '../../lib/plugins.mjs';
import { startTakDouble } from '../../lib/tak-double.mjs';

// The layer lock (data model 1.3.0, ADR-0042, T-098): a locked layer refuses every user's change
// to its content with LAYER_LOCKED, takes the lock and the draw order, and still takes incoming
// data and the simulator's moves, which come from plugins' server parts (BW). Two users are two
// live picture sessions (no-login mode: each a browser session, ADR-0042 point 4); the login
// variant with real users is in specs/keycloak/permissions.spec.ts. In the browser, through the
// lock beside the eye in the layer list (T-099): Settings › Layers shows a locked layer with no
// controls, the list itself keeps a locked layer's name, and draw-shapes and the simulator's
// route editor treat it as read only (T-120). Positions have latitude ≠ longitude (ADR-0007).
// draw-symbols' part of T-120 too: the place button, read-only properties and no drag.

test.describe.configure({ timeout: 180_000 });

const SIMULATION = 'simulator.simulation';
type State = Record<string, any>;
type Event = { sequenceNo: number; entityType: string; entityId: string; operation: string; state: State | null; by?: { plugin?: string; user?: string } };
type Outcome = { outcome: string; event?: Event; rejection?: { code: string; message?: string; details?: Array<{ path: string; problem: string }> } };
type Request = { requestId: string; entityType: string; operation: string; entityId: string; [key: string]: unknown };

/** A change request that sends an entity's state again as its content, with `changes` applied. */
function updateOf(state: State, changes: State = {}): Request {
  const { id, version, meta: _meta, ...data } = state;
  return {
    requestId: randomUUID(),
    entityType: 'layerId' in state ? 'object' : 'layer',
    operation: 'update',
    entityId: id,
    baseVersion: version,
    data: { ...data, ...changes },
    source: { plugin: 'ita-test' },
  };
}

function deleteOf(entityType: 'object' | 'layer', entityId: string): Request {
  return { requestId: randomUUID(), entityType, operation: 'delete', entityId, source: { plugin: 'ita-test' } };
}

async function applied(client: LiveClient, request: Request): Promise<State> {
  const outcome: Outcome = await client.change(request);
  expect(outcome, `${request.entityType} ${request.operation}: ${JSON.stringify(outcome.rejection ?? '')}`).toMatchObject({ outcome: 'applied' });
  return outcome.event!.state!;
}

/** The request is refused with LAYER_LOCKED; its one detail names the layer, at `path`. */
async function refused(client: LiveClient, request: Request, layerId: string, path: '' | '/data/layerId', what: string): Promise<void> {
  const outcome: Outcome = await client.change(request);
  expect(outcome, what).toMatchObject({ outcome: 'rejected', rejection: { code: 'LAYER_LOCKED' } });
  expect(outcome.rejection!.details, `${what}: the one detail`).toHaveLength(1);
  expect(outcome.rejection!.details![0].path, `${what}: the detail's path`).toBe(path);
  expect(outcome.rejection!.details![0].problem, `${what}: the detail names the layer`).toContain(layerId);
}

/** A client's newest state of an entity from its events (undefined before its first event). */
function latest(client: LiveClient, id: string): State | undefined {
  return (client.events as Event[]).filter((e) => e.entityId === id && e.state !== null).at(-1)?.state ?? undefined;
}

/** Two user sessions on a server of the test's own with only cot and the simulator: both see every workspace. */
async function withTwoUsers(testInfo: Parameters<typeof withOwnServers>[0], body: (run: { server: OwnServer; a: LiveClient; b: LiveClient }) => Promise<void>): Promise<void> {
  await withOwnServers(testInfo, async (folders, start) => {
    installPlugins(folders.pluginsDir, { only: ['cot', 'simulator'] });
    const server = await start();
    const a = await LiveClient.open(server.baseUrl);
    const b = await LiveClient.open(server.baseUrl);
    try {
      await a.subscribe({ workspaces: ['*'] });
      await b.subscribe({ workspaces: ['*'] });
      await body({ server, a, b });
    } finally {
      await a.close();
      await b.close();
    }
  });
}

test("two users: A locks a layer; B's create, change, move in or out and delete get LAYER_LOCKED, and so do A's own, with no change sent; B changes the draw order and unlocks it, and then B's create is applied", async ({}, testInfo) => {
  await withTwoUsers(testInfo, async ({ a, b }) => {
    const reference = await applied(a, createLayer('Reference', { drawOrder: 2 }));
    const other = await applied(a, createLayer('Other', { drawOrder: 3 }));
    const kept = createSymbol(reference.id, 1, { name: 'kept' });
    const removable = createSymbol(reference.id, 2, { name: 'removable' });
    const outside = createSymbol(other.id, 3, { name: 'outside' });
    const x = await applied(b, kept);
    const y = await applied(b, removable);
    const z = await applied(b, outside);

    const locked = await applied(a, updateOf(reference, { locked: true }));
    expect(locked.locked, 'the lock in A\'s event').toBe(true);
    const lock = await nextEvent(b, (e) => e.entityId === reference.id && e.state?.locked === true);

    await refused(b, createSymbol(reference.id, 4, { name: 'new' }), reference.id, '/data/layerId', 'B: a create in the layer');
    await refused(b, updateOf(x, { geometry: { type: 'Point', coordinates: [18.25, 59.75] } }), reference.id, '/data/layerId', 'B: a change of an object in it');
    await refused(b, deleteOf('object', y.id), reference.id, '', 'B: a delete of an object in it');
    await refused(b, updateOf(x, { layerId: other.id }), reference.id, '', 'B: a move out of it');
    await refused(b, updateOf(z, { layerId: reference.id }), reference.id, '/data/layerId', 'B: a move into it');
    await refused(b, updateOf(locked, { name: 'Reference, renamed' }), reference.id, '', 'B: a rename of the layer');
    await refused(b, updateOf(locked, { name: 'Reference, renamed', drawOrder: 5 }), reference.id, '', 'B: a rename with a draw order');
    await refused(b, deleteOf('layer', reference.id), reference.id, '', 'B: a delete of the layer');
    await refused(a, createSymbol(reference.id, 5, { name: 'by A' }), reference.id, '/data/layerId', 'A, who locked it: a create in the layer');
    // Nothing changed: no event for the layer or its objects (nor for z) after the lock.
    const after = (await settle(b, other.id)).filter((e) => e.sequenceNo > lock.sequenceNo);
    expect(after.filter((e) => [reference.id, x.id, y.id, z.id].includes(e.entityId)), 'no change event for a refused request').toEqual([]);
    const objects = (await b.queryLayer(reference.id)).objects as State[];
    expect(objects.map((o) => [o.id, o.version]).sort(), 'the layer\'s objects as they were').toEqual([[x.id, x.version], [y.id, y.version]].sort());

    // The draw order is not content: B moves the layer, with an update that leaves out "locked" (it keeps the lock).
    const { locked: _lock, ...withoutLock } = updateOf(locked, { drawOrder: 4 }).data as State;
    const reordered = await applied(b, { ...updateOf(locked), data: withoutLock });
    expect(reordered).toMatchObject({ drawOrder: 4, locked: true });

    const unlocked = await applied(b, updateOf(reordered, { locked: false }));
    expect(unlocked.locked, 'false is stored as absent').toBeUndefined();
    const fresh = await applied(b, createSymbol(reference.id, 6, { name: 'after the unlock' }));
    expect(fresh.layerId).toBe(reference.id);
    await applied(a, updateOf(x, { geometry: { type: 'Point', coordinates: [18.5, 59.25] } }));
  });
});

test('incoming data passes the lock: cot keeps creating and moving objects in its locked layer, while a user\'s change of one of them gets LAYER_LOCKED', async ({}, testInfo) => {
  const double = await startTakDouble();
  try {
    await withTwoUsers(testInfo, async ({ server, a, b }) => {
      await setLinks(server, [{ name: 'tak-north', port: double.port }]);
      await double.waitForConnections(1);
      const t = Date.now();
      double.send({ uid: 'ita-lock-1', lon: 18.1, lat: 59.2, time: t });
      const first = await nextEvent(a, (e) => e.state?.meta?.externalRef?.id === 'ita-lock-1', 20_000);
      const layerId = first.state.layerId as string;
      const layer = latest(a, layerId); // made by cot after A subscribed
      expect(layer, 'cot\'s layer').toBeDefined();
      const locked = await applied(a, updateOf(layer!, { locked: true }));
      expect(locked.locked).toBe(true);

      double.send({ uid: 'ita-lock-1', lon: 18.3, lat: 59.4, time: t + 2_000 });
      double.send({ uid: 'ita-lock-2', lon: 18.6, lat: 59.1, time: t + 2_000 });
      const moved = await nextEvent(a, (e) => e.entityId === first.entityId && e.operation === 'update' && e.state?.geometry.coordinates[0] > 18.2, 20_000);
      expect(moved.state.geometry.coordinates[0], 'moved in the locked layer: longitude').toBeCloseTo(18.3, 6);
      expect(moved.state.geometry.coordinates[1], 'moved in the locked layer: latitude').toBeCloseTo(59.4, 6);
      expect(moved.state.layerId).toBe(layerId);
      expect(moved.by?.plugin, 'by cot\'s server part').toBe('cot');
      const second = await nextEvent(a, (e) => e.state?.meta?.externalRef?.id === 'ita-lock-2' && e.operation === 'create', 20_000);
      expect(second.state.layerId, 'created in the locked layer').toBe(layerId);
      expect(latest(a, layerId)?.locked, 'still locked').toBe(true);

      await refused(b, updateOf(moved.state, { properties: { name: 'renamed by B' } }), layerId, '/data/layerId', 'B: a change of a cot object');
      await refused(b, deleteOf('object', second.entityId), layerId, '', 'B: a delete of a cot object');
    });
  } finally {
    await double.close();
  }
});

async function simulator(server: OwnServer, path: string, body: unknown) {
  const response = await fetch(`${server.baseUrl}/api/plugins/simulator${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await response.text();
  expect(response.status, `POST ${path}: ${text}`).toBe(200);
  return JSON.parse(text);
}

test("the simulator passes the lock: in a locked Simulation layer its commands put a track on a route and start it, and the track moves; a user's change of the track or the route gets LAYER_LOCKED", async ({}, testInfo) => {
  await withTwoUsers(testInfo, async ({ server, a, b }) => {
    const layer = await applied(a, createLayer('Ground truth', { workspace: SIMULATION, drawOrder: 1 }));
    const trackRequest = createSymbol(layer.id, 0, { name: 'ALPHA' }) as Request & { data: State };
    trackRequest.data.geometry.coordinates = [17.99, 58.99];
    trackRequest.data.symbol = { standard: 'APP-6B', sidc: 'SFGPUCI--------' };
    const track = await applied(a, trackRequest);
    const routeRequest = createSymbol(layer.id, 0, { name: 'Route A' }) as Request & { data: State };
    routeRequest.data = {
      type: 'core.shape',
      dataType: 'simulator.route',
      dataSource: 'manual',
      layerId: layer.id,
      geometry: { type: 'LineString', coordinates: [[18.0, 59.0], [18.01, 59.0], [18.01, 59.006]] },
      style: { strokeColor: '#2C784C', strokeWidth: 2, strokeDash: 'dash', pointMarkers: 'circle' },
      properties: { name: 'Route A' },
      label: trackRequest.data.label,
      extensions: { simulator: { points: [{ speedKind: 'instant', speed: 30 }, { speedKind: 'instant', speed: 30 }, {}], groups: [], end: 'stop' } },
    };
    const route = await applied(a, routeRequest);
    await applied(a, updateOf(layer, { locked: true }));

    await simulator(server, '/put-on-route', { route: route.id, kind: 'single', objects: [track.id] });
    const started = await simulator(server, '/routes/start', {});
    expect(started.routes.find((r: State) => r.id === route.id), 'the route runs').toMatchObject({ runnable: true, problems: [] });
    await expect
      .poll(() => (a.events as Event[]).filter((e) => e.entityId === track.id && e.state?.symbol?.modifiers?.speed > 0).length, { timeout: 20_000, message: 'the track moves' })
      .toBeGreaterThanOrEqual(3);
    const moving = latest(a, track.id)!;
    expect(moving.layerId).toBe(layer.id);
    expect(latest(a, layer.id)?.locked, 'still locked').toBe(true);
    const routeWrites = (a.events as Event[]).filter((e) => e.entityId === route.id && e.operation === 'update').map((e) => e.by?.plugin);
    expect(routeWrites, '"Put on route" wrote the route in the locked layer, through the simulator\'s server part').toContain('simulator');

    await refused(b, updateOf(moving, { properties: { name: 'BRAVO' } }), layer.id, '/data/layerId', 'B: a change of the moving track');
    await refused(b, updateOf(latest(b, route.id) ?? route, { properties: { name: 'Route B' } }), layer.id, '/data/layerId', 'B: a change of the route');
    await simulator(server, '/routes/pause', {});
  });
});

/** A layer's row in the Layers tab of the bottom pane. */
async function layerRow(page: Page, name: string): Promise<Locator> {
  const panel = await bottomPanel(page, 'Layers');
  return panel.getByRole('list', { name: 'Layers', exact: true }).getByRole('listitem').filter({ has: page.getByRole('button', { name: `Make ${name} active`, exact: true }) });
}

/**
 * Locks or unlocks a layer with the lock beside its eye in the layer list (T-099) and waits until
 * `live` has the change event and the button has turned.
 */
async function lockButton(page: Page, live: LiveClient, layer: { id: string; name: string }, locked: boolean): Promise<Event> {
  const from = (live.events as Event[]).length;
  const row = await layerRow(page, layer.name);
  await row.getByRole('button', { name: `${locked ? 'Lock' : 'Unlock'} ${layer.name}`, exact: true }).click();
  let event: Event | undefined;
  await expect
    .poll(() => (event = (live.events as Event[]).slice(from).find((e) => e.entityId === layer.id && e.operation === 'update')) !== undefined, { timeout: 10_000, message: `the ${locked ? 'lock' : 'unlock'} of ${layer.name}` })
    .toBe(true);
  expect(event!.state?.locked === true, 'the lock as sent').toBe(locked);
  await expect(row.getByRole('button', { name: `${locked ? 'Unlock' : 'Lock'} ${layer.name}`, exact: true })).toHaveAttribute('aria-pressed', String(locked));
  return event!;
}

test('Settings › Layers: a layer locked in another browser\'s layer list shows as locked at once, its objects still listed but its classification and "Delete all objects" off, and its controls come back when it is unlocked', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ live, snapshot, open }) => {
    const drawing = { id: seededLayer(snapshot), name: 'Drawing' };
    // One object, so that "Delete all objects" is not off for an empty layer (T-175).
    await applied(live, createSymbol(drawing.id, 0, { name: 'Locked 1' }));
    const page = await open();
    const other = await open();
    await page.goto('/#settings/layers');
    const card = page.getByRole('article', { name: 'Drawing' });
    // T-175 (A1): a locked layer's card lists its objects (read only) and keeps "Delete all objects", off.
    const NOTE = 'This layer is locked. Unlock it in the Layers panel to change its classification or raise or delete its objects.';
    const emptyAll = (c: Locator) => c.getByRole('button', { name: 'Delete all objects', exact: true });
    await expect(card).toContainText('1 object');
    await expect(card.getByLabel('Classification')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Apply' })).toBeVisible();
    await expect(emptyAll(card)).toBeEnabled();
    await expect(card).not.toContainText(NOTE);

    await lockButton(other, live, drawing, true);
    await expect(card).toContainText(NOTE);
    await expect(emptyAll(card), 'Delete all objects off on a locked layer').toBeDisabled();
    for (const role of ['checkbox', 'combobox', 'textbox'] as const) {
      await expect(card.getByRole(role), `no ${role} on a locked layer's card`).toHaveCount(0);
    }
    await expect(card.getByRole('button'), 'only Show objects and Delete all objects').toHaveText(['Show objects', 'Delete all objects']);
    await page.reload();
    const reloaded = page.getByRole('article', { name: 'Drawing' });
    await expect(reloaded, 'still locked after a reload').toContainText(NOTE);
    await expect(reloaded.getByRole('button')).toHaveText(['Show objects', 'Delete all objects']);
    await expect(emptyAll(reloaded)).toBeDisabled();
    await reloaded.getByRole('button', { name: 'Show objects', exact: true }).click();
    await expect(reloaded.getByRole('table', { name: 'Objects of Drawing', exact: true }).getByRole('rowheader'), 'a locked layer still lists its objects').toHaveText(['Locked 1']);

    await lockButton(other, live, drawing, false);
    const again = page.getByRole('article', { name: 'Drawing' });
    await expect(again.getByLabel('Classification')).toBeVisible();
    await expect(again.getByRole('button', { name: 'Apply' })).toBeVisible();
    await expect(emptyAll(again), 'Delete all objects on again after the unlock').toBeEnabled();
    await expect(again).not.toContainText(NOTE);
  });
});

test('the layer list (T-099): a lock beside the eye locks the layer for every browser; a locked row has Rename (and F2) and Delete off with "The layer is locked", still moves (the lock kept) and is unlocked from the other browser', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ live, snapshot, open }) => {
    const drawing = (snapshot.layers as State[]).find((l) => l.name === 'Drawing')!;
    const reference = await applied(live, createLayer('Reference', { drawOrder: drawing.drawOrder + 5 }));
    const page = await open();
    const other = await open();
    for (const shown of [page, other]) await expect(await layerRow(shown, 'Reference')).toBeVisible();
    const row = await layerRow(other, 'Reference');
    const rename = row.getByRole('button', { name: 'Rename Reference', exact: true });
    const remove = row.getByRole('button', { name: 'Delete Reference', exact: true });
    await expect(rename).toBeEnabled();
    await expect(remove, 'an empty layer may be deleted').toBeEnabled();

    await lockButton(page, live, { id: reference.id, name: 'Reference' }, true);
    await expect(row.getByRole('button', { name: 'Unlock Reference', exact: true }), 'the other browser shows the lock').toHaveAttribute('aria-pressed', 'true');
    for (const button of [rename, remove]) {
      await expect(button).toBeDisabled();
      await expect(button).toHaveAttribute('title', 'The layer is locked');
    }
    await row.getByRole('button', { name: 'Make Reference active', exact: true }).focus();
    await other.keyboard.press('F2');
    await expect(row.getByRole('textbox'), 'F2 opens no name field on a locked layer').toHaveCount(0);

    // The draw order is not content: the locked layer moves below Drawing, and stays locked.
    const from = (live.events as Event[]).length;
    await row.getByRole('button', { name: 'Move Reference down', exact: true }).click();
    let moved: Event | undefined;
    await expect.poll(() => (moved = (live.events as Event[]).slice(from).find((e) => e.entityId === reference.id && e.operation === 'update')) !== undefined, { message: 'the move' }).toBe(true);
    expect(moved!.state!.drawOrder, 'below Drawing').toBeLessThan(drawing.drawOrder);
    expect(moved!.state!.locked, 'the move keeps the lock').toBe(true);

    await lockButton(other, live, { id: reference.id, name: 'Reference' }, false);
    const first = await layerRow(page, 'Reference');
    await expect(first.getByRole('button', { name: 'Lock Reference', exact: true }), 'the first browser shows the unlock').toHaveAttribute('aria-pressed', 'false');
    await expect(first.getByRole('button', { name: 'Rename Reference', exact: true })).toBeEnabled();
    await expect(first.getByRole('button', { name: 'Delete Reference', exact: true })).toBeEnabled();
  });
});

/** A filled circle about 60 px across, 120 px left of the map's centre, created through the API (its radius from the cursor display: no test probe). */
async function circleOnMap(page: Page, live: LiveClient, layerId: string): Promise<{ at: { x: number; y: number }; id: string }> {
  const centre = await mapCentre(page);
  const at = { x: centre.x - 120, y: centre.y + 60 };
  const center = await positionAt(page, at);
  const rim = await positionAt(page, { x: at.x + 30, y: at.y }); // 30 px east, read from the cursor display
  const request = createSymbol(layerId, 0) as Request & { data: State };
  request.data = {
    type: 'core.shape',
    dataType: 'core.general',
    dataSource: 'manual',
    layerId,
    geometry: { type: 'Circle', center, radius: Math.round((rim[0] - center[0]) * 111_320 * Math.cos((center[1] * Math.PI) / 180)) },
    style: { strokeColor: '#106010', strokeWidth: 2, fillColor: '#20c020', fillOpacity: 1 },
    properties: { name: 'ITA circle' },
    label: request.data.label,
  };
  await applied(live, request);
  await expect.poll(() => colourAround(page, at, [32, 192, 32]), { timeout: 10_000, message: 'the circle is drawn' }).toBeGreaterThan(50);
  return { at, id: request.entityId };
}

test('draw-shapes (T-120): with the active layer locked in the layer list the shape tools are off with its title, and an open Edit turns read only with "Layer … is locked"; the unlock gives both back', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ live, snapshot, open }) => {
    const drawing = { id: seededLayer(snapshot), name: 'Drawing' };
    const probe = await applied(live, createLayer('Probe', { drawOrder: -5 })); // unlocked, below Drawing: for settle()
    const page = await open();
    const circle = await circleOnMap(page, live, drawing.id);
    await page.mouse.click(circle.at.x + 30, circle.at.y, { button: 'right' }); // on the rim: an area is picked on its outline only (T-102)
    await page.getByRole('menu', { name: 'Actions' }).getByRole('menuitem', { name: 'Edit' }).click();
    const edit = page.getByRole('region', { name: 'Edit shape', exact: true }).last(); // the plugin's frame inside the shell's panel of the same name
    const tools = page.getByRole('region', { name: 'Shapes', exact: true }).getByRole('group', { name: 'Shape tools' });
    await expect(edit.getByLabel('Name')).toBeEditable();
    await expect(tools.getByRole('button', { name: 'Circle', exact: true })).toBeEnabled();

    const lockedAt = (await lockButton(page, live, drawing, true)).sequenceNo;
    await expect(edit).toContainText('Layer "Drawing" is locked');
    await expect(edit.getByLabel('Name')).not.toBeEditable();
    await expect(edit.getByRole('button', { name: 'Reshape' })).toBeDisabled();
    for (const tool of await tools.getByRole('button').all()) {
      await expect(tool).toBeDisabled();
      await expect(tool).toHaveAttribute('title', 'The active layer "Drawing" is locked');
    }
    const after = (await settle(live, probe.id)).filter((e) => e.sequenceNo > lockedAt);
    expect(after.filter((e) => e.entityId === circle.id), 'nothing sent for the circle').toEqual([]);

    await lockButton(page, live, drawing, false);
    await expect(edit).not.toContainText('is locked');
    await expect(edit.getByLabel('Name')).toBeEditable();
    await expect(tools.getByRole('button', { name: 'Circle', exact: true })).toBeEnabled();
  });
});

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

test('draw-symbols (T-120): with the active layer locked in the layer list "Place on map" is off with its title, a selected symbol\'s properties turn read only with "Layer … is locked", and a drag of the symbol sends nothing; the unlock gives them back', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ live, snapshot, open }) => {
    const drawing = { id: seededLayer(snapshot), name: 'Drawing' };
    let sent: Request[] = [];
    const page = await open((p) => {
      sent = watchRequests(p);
    });
    const centre = await mapCentre(page);
    const at = { x: centre.x - 100, y: centre.y - 60 };
    const symbol = frameSymbol(drawing.id, await positionAt(page, at), 'friend') as Request & { data: State };
    const created = await applied(live, symbol);
    await expect.poll(() => colourAround(page, at, FRIEND), { timeout: 10_000, message: 'the symbol is drawn' }).toBeGreaterThan(50);

    const symbols = page.getByRole('region', { name: 'Symbols', exact: true }).last();
    const place = symbols.getByRole('button', { name: 'Place on map' });
    await symbols.getByRole('group', { name: 'Symbols' }).getByRole('button', { name: 'Infantry', exact: true }).click();
    await expect(place).toBeEnabled();
    // Selected with a click on the map: "Symbol properties" shows it, editable.
    const properties = page.getByRole('region', { name: 'Symbol properties', exact: true }).last(); // the plugin's frame inside the shell's panel of the same name
    await expect(async () => {
      await page.mouse.click(at.x, at.y);
      await userPause(page);
      await expect(properties.getByLabel('Name')).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: 15_000 });
    await expect(properties.getByLabel('Name')).toBeEditable();

    await lockButton(page, live, drawing, true);
    await expect(place).toBeDisabled();
    await expect(place).toHaveAttribute('title', 'The active layer "Drawing" is locked');
    await expect(symbols).toContainText('The active layer "Drawing" is locked');
    await expect(properties).toContainText('Layer "Drawing" is locked');
    // Every field read only, except the two unit choices, which only change how this browser shows
    // values and stay usable on a locked layer (owner, FQ, 2026-11-01; T-130).
    const UNITS = ['Speed unit', 'Altitude unit'];
    const units = await Promise.all(UNITS.map((unit) => properties.getByRole('combobox', { name: unit, exact: true }).elementHandle()));
    const fields = [...(await properties.getByRole('combobox').all()), ...(await properties.getByRole('textbox').all())];
    expect(fields.length, 'the fields of the properties').toBeGreaterThan(5);
    for (const field of fields) {
      if (await field.evaluate((e, skip) => skip.includes(e as never), units)) continue;
      await expect(field, `${(await field.getAttribute('id')) ?? 'a field'} read only`).not.toBeEditable();
    }
    for (const label of [/^Heading/, /^Speed \(/, /^Altitude \(/]) await expect(properties.getByRole('textbox', { name: label }), `${label} read only`).not.toBeEditable();
    for (const unit of UNITS) await expect(properties.getByRole('combobox', { name: unit, exact: true }), `${unit} stays usable`).toBeEnabled();
    // No drag: pressing the symbol and moving drags the map, and nothing is sent for the symbol.
    const before = sent.length;
    await drag(page, at, { x: at.x + 60, y: at.y + 40 });
    await page.waitForTimeout(1_500); // nothing may be sent: a fixed wait, the absence is the check
    expect(sent.slice(before).filter((r) => r.entityId === symbol.entityId), 'no update of the symbol in a locked layer').toEqual([]);
    expect((await live.getObjects([symbol.entityId])).found[0].version, 'the symbol unchanged in the store').toBe(created.version);

    await lockButton(page, live, drawing, false);
    await expect(place).toBeEnabled();
    await expect(properties).not.toContainText('is locked');
    await expect(properties.getByLabel('Name')).toBeEditable();
  });
});

test('simulator (T-120): with Simulation\'s active layer locked in the layer list "New route" is off with its title, and the route editor and the route\'s "At the end" turn read only with "Layer … is locked"; the unlock gives them back', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open }) => {
    const all = await LiveClient.open(server.baseUrl);
    try {
      await all.subscribe({ workspaces: ['*'] });
      const layer = await applied(all, createLayer('Ground truth', { workspace: SIMULATION, drawOrder: 1 }));
      const route = createSymbol(layer.id, 0, { name: 'Route A' }) as Request & { data: State };
      route.data = {
        type: 'core.shape',
        dataType: 'simulator.route',
        dataSource: 'manual',
        layerId: layer.id,
        geometry: { type: 'LineString', coordinates: [[18.0, 59.0], [18.01, 59.0], [18.01, 59.006]] },
        style: { strokeColor: '#2C784C', strokeWidth: 2, strokeDash: 'dash', pointMarkers: 'circle' },
        properties: { name: 'Route A' },
        label: route.data.label,
        extensions: { simulator: { points: [{ speedKind: 'instant', speed: 30 }, { speedKind: 'instant', speed: 30 }, {}], groups: [], end: 'stop' } },
      };
      await applied(all, route);

      const page = await open();
      const views = page.getByRole('tablist', { name: 'Views' });
      await views.getByRole('tab', { name: 'Simulation', exact: true }).click();
      await expect(views.getByRole('tab', { name: 'Simulation', exact: true })).toHaveAttribute('aria-selected', 'true');
      const routes = page.getByRole('region', { name: 'Routes', exact: true }).first();
      const editor = page.getByRole('region', { name: 'Route editor', exact: true }).first();
      const newRoute = routes.getByRole('button', { name: 'New route' });
      const atTheEnd = routes.getByRole('listitem', { name: 'Route A' }).getByLabel('At the end');
      await expect((await layerRow(page, 'Ground truth')).getByRole('button', { name: 'Make Ground truth active', exact: true }), 'the top layer is active').toHaveAttribute('aria-pressed', 'true');
      await expect(newRoute).toBeEnabled();
      await routes.getByRole('button', { name: 'Edit Route A' }).click();
      await expect(editor.getByLabel('Name')).toHaveValue('Route A');
      await expect(editor.getByLabel('Name')).toBeEditable();
      await expect(atTheEnd).toBeEnabled();

      await lockButton(page, all, { id: layer.id, name: 'Ground truth' }, true);
      await expect(newRoute).toBeDisabled();
      await expect(newRoute).toHaveAttribute('title', 'The active layer "Ground truth" is locked');
      await expect(editor).toContainText('Layer "Ground truth" is locked');
      await expect(editor.getByLabel('Name')).not.toBeEditable();
      await expect(atTheEnd).toBeDisabled();

      await lockButton(page, all, { id: layer.id, name: 'Ground truth' }, false);
      await expect(newRoute).toBeEnabled();
      await expect(editor).not.toContainText('is locked');
      await expect(editor.getByLabel('Name')).toBeEditable();
      await expect(atTheEnd).toBeEnabled();
    } finally {
      await all.close();
    }
  });
});
