// Quick run: @login @plugin-draw-symbols @plugin-layer-panel
import { expect, test } from '@playwright/test';
import { setLinks } from '../../lib/cot';
import { newLayer } from '../../lib/layer-panel';
import { createSymbol, type LiveClient } from '../../lib/live.mjs';
import { useTestRealm, viewTabs, withLoginServer, type LoginRun, type UserKey } from '../../lib/login';
import { layerRequest, mapCentre, nextEvent, placeSymbols, settle } from '../../lib/m0';
import { startTakDouble } from '../../lib/tak-double.mjs';

// Permissions with login against a real Keycloak (T-043, ADR-0022, ADR-0026): the groups of the
// test realm map to permissions as in server/README.md. The viewer has none, the editor
// objects.edit and layers.edit, the drawer objects.edit only, the admin also settings.admin. The
// server enforces them on change requests (overview 4.4, T-062), and the layer lock after them
// (ADR-0042). Runs only with run.mjs --keycloak.

const realm = useTestRealm();

const PLUGIN_SETTINGS = '/api/settings/plugins/coordinates';
const DATA_TYPE = '/api/settings/data-types/core.general';

/** The settings endpoints (GET and PUT) as the user: the statuses, and the bodies of the GETs. */
async function settingsAs(run: LoginRun, context: Parameters<LoginRun['api']>[0]) {
  const plugin = await run.api(context, PLUGIN_SETTINGS);
  const dataType = await run.api(context, DATA_TYPE);
  const pluginBody = plugin.ok ? await plugin.json() : null;
  const dataTypeBody = dataType.ok ? await dataType.json() : null;
  const put = (path: string, values: unknown) =>
    run.api(context, path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
  // A PUT of the values as they are (the admin's GET gives them; others send the defaults).
  const pluginPut = await put(PLUGIN_SETTINGS, pluginBody?.values ?? { defaultFormat: 'dd' });
  const dataTypePut = await put(DATA_TYPE, dataTypeBody?.behaviour ?? { fadeWhenExpired: false });
  return { plugin: plugin.status, dataType: dataType.status, pluginPut: pluginPut.status, dataTypePut: dataTypePut.status, pluginBody, dataTypeBody };
}

test('a user without permissions sees only View, cannot place symbols or change layers in the browser, and gets 403 from the settings endpoints', async ({ browser }, testInfo) => {
  await withLoginServer(testInfo, browser, realm(), async (run) => {
    const { context, page } = await run.logIn('viewer');
    const config = await (await run.api(context, '/api/config')).json();
    expect(config.user.permissions, 'no permissions').toEqual([]);

    expect(await viewTabs(page), 'only the View tab').toEqual(['View']);
    await page.goto('/#settings');
    await expect(page.getByRole('status', { name: 'Live picture' })).toHaveText('Live picture: connected');
    expect(await viewTabs(page), 'still only View when the address names Settings').toEqual(['View']);
    await expect(page.getByRole('tab', { name: 'View' })).toHaveAttribute('aria-selected', 'true');
    // Nor a plugin's settings entry, at its address or at M1's old one (ADR-0031).
    for (const address of ['/#settings/plugin/coordinates', '/#plugin/coordinates']) {
      await page.goto(address);
      await expect(page.getByRole('status', { name: 'Live picture' })).toHaveText('Live picture: connected');
      expect(await viewTabs(page), `only View at ${address}`).toEqual(['View']);
      await expect(page.getByRole('tablist', { name: 'Settings' }), `no Settings list at ${address}`).toHaveCount(0);
    }

    const symbols = page.getByRole('region', { name: 'Symbols' });
    await symbols.getByRole('group', { name: 'Symbols' }).getByRole('button', { name: 'Infantry', exact: true }).click();
    await expect(symbols.getByRole('button', { name: 'Place on map' })).toBeDisabled();
    await expect(symbols.getByRole('status')).toHaveText('You may not edit objects');
    const layers = page.getByRole('tabpanel', { name: 'Layers', exact: true });
    await expect(layers.getByRole('button', { name: /New layer|Create first layer/ })).toBeDisabled();
    await expect(layers.getByText('You may not change layers.')).toBeVisible();

    const settings = await settingsAs(run, context);
    expect(settings).toMatchObject({ plugin: 403, dataType: 403, pluginPut: 403, dataTypePut: 403 });
  });
});

test('an editor places symbols and creates layers in the browser, as itself, but sees no Settings or Monitor and gets 403 from the settings endpoints', async ({ browser }, testInfo) => {
  await withLoginServer(testInfo, browser, realm(), async (run) => {
    const { context, page } = await run.logIn('editor');
    const config = await (await run.api(context, '/api/config')).json();
    expect([...config.user.permissions].sort()).toEqual(['layers.edit', 'objects.edit']);
    expect(await viewTabs(page), 'only the View tab').toEqual(['View']);

    const live = await run.live(context);
    await live.subscribe();
    const layers = page.getByRole('tabpanel', { name: 'Layers', exact: true });
    await newLayer(page); // T-171: the dialog, with its name and classification
    const layer = await nextEvent(live, (e) => e.entityType === 'layer' && e.operation === 'create');
    await expect(layers.getByRole('button', { name: `Make ${layer.state.name} active` })).toHaveAttribute('aria-pressed', 'true');
    await placeSymbols(page, 'Infantry', [await mapCentre(page)]);
    const symbol = await nextEvent(live, (e) => e.entityType === 'object' && e.operation === 'create');
    expect(symbol.state.layerId, 'on the new layer').toBe(layer.entityId);
    const editorId = run.realm.users.editor.id;
    expect((layer as { by?: { user?: string } }).by?.user, 'the layer is the editor\'s change').toBe(editorId);
    expect((symbol as { by?: { user?: string } }).by?.user, 'the symbol is the editor\'s change').toBe(editorId);
    await live.close();

    const settings = await settingsAs(run, context);
    expect(settings).toMatchObject({ plugin: 403, dataType: 403, pluginPut: 403, dataTypePut: 403 });
  });
});

test('an admin sees View, Settings and Monitor; a plugin\'s settings are its entry in the Settings list, also at M1\'s old address; the admin reads and changes settings', async ({ browser }, testInfo) => {
  await withLoginServer(testInfo, browser, realm(), async (run) => {
    const { context, page } = await run.logIn('admin');
    // The top bar has exactly these three (SDK 1.1.0 part 6, ADR-0031): no plugin tabs any more.
    expect(await viewTabs(page)).toEqual(['View', 'Settings', 'Monitor']);
    const views = page.getByRole('tablist', { name: 'Views' });
    await views.getByRole('tab', { name: 'Settings' }).click();
    await expect(views.getByRole('tab', { name: 'Settings' })).toHaveAttribute('aria-selected', 'true');

    // A plugin's settings: its entry in the Settings list, at #settings/plugin/<id>.
    const list = page.getByRole('tablist', { name: 'Settings' });
    await expect(list.getByRole('tab', { name: 'Data types' })).toBeVisible();
    await list.getByRole('tab', { name: 'Coordinates' }).click();
    await expect(page).toHaveURL(/#settings\/plugin\/coordinates$/);
    await expect(list.getByRole('tab', { name: 'Coordinates' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel').getByRole('heading', { name: 'Coordinates', level: 2 })).toBeVisible();
    // M1's address of the plugin tab leads there too.
    await page.goto('/#view');
    await page.goto('/#plugin/coordinates');
    await expect(page).toHaveURL(/#settings\/plugin\/coordinates$/);
    await expect(list.getByRole('tab', { name: 'Coordinates' })).toHaveAttribute('aria-selected', 'true');

    const settings = await settingsAs(run, context);
    expect(settings).toMatchObject({ plugin: 200, dataType: 200, pluginPut: 200, dataTypePut: 200 });
    expect(settings.pluginBody.values).toHaveProperty('defaultFormat');
    expect(settings.dataTypeBody).toMatchObject({ id: 'core.general' });
  });
});

type Outcome = { outcome: string; code?: string };
type Rejection = { code: string; message?: string };
type Change = { requestId: string; entityType: string; operation: string; entityId: string; [key: string]: unknown };

function outcomeOf(message: { outcome: string; rejection?: { code: string } }): Outcome {
  return message.rejection ? { outcome: message.outcome, code: message.rejection.code } : { outcome: message.outcome };
}

const APPLIED: Outcome = { outcome: 'applied' };
const DENIED: Outcome = { outcome: 'rejected', code: 'PERMISSION_DENIED' };
const OBJECT_CHANGES = ['object create', 'object update', 'object delete'];
const LAYER_CHANGES = ['layer create', 'layer rename', 'layer drawOrder', 'layer visibility', 'layer delete'];

function expected(objects: Outcome, layers: Outcome): Record<string, Outcome> {
  return Object.fromEntries([...OBJECT_CHANGES.map((w) => [w, objects]), ...LAYER_CHANGES.map((w) => [w, layers])]);
}

/** An object update: the whole object again, at a new position (lat ≠ lon). */
function moveObject(request: ReturnType<typeof createSymbol>, position: [number, number]): Change {
  const update = structuredClone(request);
  update.requestId = crypto.randomUUID();
  update.operation = 'update';
  update.data.geometry.coordinates = position;
  return update;
}

function deleteRequest(entityType: 'object' | 'layer', entityId: string): Change {
  return { requestId: crypto.randomUUID(), entityType, operation: 'delete', entityId, source: { plugin: 'ita-test' } };
}

type Layer = { id: string; name: string; drawOrder: number; version?: number };

/** A layer the admin makes; resolves with it and its version. */
async function adminLayer(admin: LiveClient, name: string, drawOrder: number): Promise<Layer> {
  const layer: Layer = { id: crypto.randomUUID(), name, drawOrder };
  const outcome = await admin.change(layerRequest('create', layer));
  expect(outcome.outcome, `the admin's layer ${name}`).toBe('applied');
  return { ...layer, version: outcome.event.state.version };
}

/**
 * Every kind of change request, made by the user over its own live picture connection, each on an
 * object or layer of its own that the admin made first (so the attempts do not depend on each
 * other, and every user starts from the same state). Resolves with each request's outcome and the
 * change events the user's requests caused (from the admin's connection, which sees everything).
 */
async function tryEveryChange(run: LoginRun, truth: LiveClient, seededLayer: string, user: UserKey, n: number) {
  const home = await adminLayer(truth, `${user}: objects`, 10 * n + 1);
  const object = createSymbol(home.id, n, { name: `the admin's, for ${user}` });
  expect((await truth.change(object)).outcome, `the admin's object for ${user}`).toBe('applied');
  const renamed = await adminLayer(truth, `${user}: to rename`, 10 * n + 2);
  const reordered = await adminLayer(truth, `${user}: to reorder`, 10 * n + 3);
  const hidden = await adminLayer(truth, `${user}: to hide`, 10 * n + 4);
  const removed = await adminLayer(truth, `${user}: to delete`, 10 * n + 5);
  await settle(truth, seededLayer);
  const before = truth.events.length;

  const visibility = layerRequest('update', hidden);
  visibility.data.visible = false;
  const requests: Record<string, Change> = {
    'object create': createSymbol(home.id, 100 + n, { name: `by ${user}` }),
    'object update': moveObject(object, [21.5 + n, 61.25]),
    'object delete': deleteRequest('object', object.entityId),
    'layer create': layerRequest('create', { id: crypto.randomUUID(), name: `by ${user}`, drawOrder: 10 * n + 6 }),
    'layer rename': layerRequest('update', { ...renamed, name: `${renamed.name}, renamed` }),
    'layer drawOrder': layerRequest('update', { ...reordered, drawOrder: 10 * n + 7 }),
    'layer visibility': visibility,
    'layer delete': deleteRequest('layer', removed.id),
  };
  const { context } = await run.logIn(user);
  const live = await run.live(context);
  await live.subscribe();
  const outcomes: Record<string, Outcome> = {};
  for (const [what, request] of Object.entries(requests)) {
    const answer = await live.change(request);
    outcomes[what] = outcomeOf(answer);
    const rejection = answer.rejection as Rejection | undefined;
    if (rejection?.code === 'PERMISSION_DENIED') {
      const permission = request.entityType === 'object' ? 'objects.edit' : 'layers.edit';
      expect(rejection.message ?? '', `${user}, ${what}: the refusal names ${permission}`).toContain(permission);
    }
  }
  await live.close();
  await settle(truth, seededLayer);
  const ids = new Set(Object.values(requests).map((r) => r.entityId));
  const events = truth.events.slice(before).filter((e: { entityId: string }) => ids.has(e.entityId));
  return { outcomes, events, requests };
}

test('on the server, every change request needs its permission: objects.edit for objects, layers.edit for layers; a refused one changes nothing', async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  await withLoginServer(testInfo, browser, realm(), async (run) => {
    const admin = await run.logIn('admin');
    const truth = await run.live(admin.context);
    const snapshot = await truth.subscribe();
    const seededLayer = snapshot.layers[0].id;

    const results: Record<string, Record<string, Outcome>> = {};
    for (const [n, user] of (['viewer', 'drawer', 'editor'] as UserKey[]).entries()) {
      const { outcomes, events, requests } = await tryEveryChange(run, truth, seededLayer, user, n + 1);
      results[user] = outcomes;
      // One change event per applied request, the user's, and none for a refused one.
      const applied = Object.entries(outcomes).filter(([, o]) => o.outcome === 'applied').map(([what]) => requests[what].entityId);
      expect(events.map((e: { entityId: string }) => e.entityId).sort(), `${user}: change events only for the applied requests`).toEqual([...applied].sort());
      for (const event of events) expect(event.by?.user, `${user}: the events are the user's`).toBe(run.realm.users[user].id);
    }
    testInfo.annotations.push({ type: 'outcomes', description: JSON.stringify(results) });
    expect(results.viewer, 'the viewer (no permission): everything refused').toEqual(expected(DENIED, DENIED));
    expect(results.drawer, 'the drawer (objects.edit only): objects applied, layers refused').toEqual(expected(APPLIED, DENIED));
    expect(results.editor, 'the editor (objects.edit and layers.edit): everything applied, on the admin\'s objects and layers too').toEqual(expected(APPLIED, APPLIED));
    await truth.close();
  });
});

test('the permission is checked before everything else in the request: a viewer\'s request the schema would refuse, in ECore\'s name, or beyond the limit of waiting requests, gets PERMISSION_DENIED', async ({ browser }, testInfo) => {
  await withLoginServer(testInfo, browser, realm(), async (run) => {
    const outcomes: Record<string, Outcome> = {};
    // 150 creates at once, without waiting: more than the 100 a session may have waiting, but
    // refused requests do not count, so every one is refused for its permission. (Whether more than
    // 100 were ever waiting at once is not observed: a fast server may answer them as they come.)
    {
      const { context } = await run.logIn('viewer');
      const live = await run.live(context);
      const snapshot = await live.subscribe();
      const flood = Array.from({ length: 150 }, (_, i) => createSymbol(snapshot.layers[0].id, 200 + i));
      for (const request of flood) live.send({ type: 'change-request', request });
      const answers = await Promise.all(flood.map((r) => live.next((m: { type: string; requestId?: string }) => m.type === 'change-outcome' && m.requestId === r.requestId)));
      const codes = answers.map((a) => (a.rejection as Rejection | undefined)?.code ?? a.outcome);
      expect(codes.filter((c) => c !== 'PERMISSION_DENIED'), '150 requests at once: all refused for the permission, none for the limit').toEqual([]);
      await live.close();
    }
    for (const user of ['viewer', 'editor'] as UserKey[]) {
      const { context } = await run.logIn(user);
      const live = await run.live(context);
      const snapshot = await live.subscribe();
      const broken = createSymbol(snapshot.layers[0].id, 0);
      delete (broken.data as { geometry?: unknown }).geometry;
      outcomes[`${user}: object without geometry`] = outcomeOf(await live.change(broken));
      const brokenLayer = layerRequest('create', { id: crypto.randomUUID(), name: '', drawOrder: -1 });
      delete (brokenLayer.data as { label?: unknown }).label;
      outcomes[`${user}: layer without label`] = outcomeOf(await live.change(brokenLayer));
      outcomes[`${user}: object in ECore's name`] = outcomeOf(await live.change(createSymbol(snapshot.layers[0].id, 1, { plugin: 'core' })));
      // The session's user counts, never source.plugin: a request in a plugin's name is the user's.
      outcomes[`${user}: object in cot's name`] = outcomeOf(await live.change(createSymbol(snapshot.layers[0].id, 2, { plugin: 'cot' })));
      await live.close();
    }
    const invalid = { outcome: 'rejected', code: 'VALIDATION_FAILED' };
    expect(outcomes).toEqual({
      'viewer: object without geometry': DENIED,
      'viewer: layer without label': DENIED,
      "viewer: object in ECore's name": DENIED,
      "viewer: object in cot's name": DENIED,
      // The same requests from a user with the permissions fail on their content.
      'editor: object without geometry': invalid,
      'editor: layer without label': invalid,
      "editor: object in ECore's name": invalid,
      "editor: object in cot's name": { outcome: 'applied' },
    });
  });
});

test('changes without a user are not checked, and a plugin\'s objects are no exception: cot creates an object; the viewer may not move it, the drawer may', async ({ browser }, testInfo) => {
  const tak = await startTakDouble();
  try {
    await withLoginServer(testInfo, browser, realm(), async (run) => {
      const admin = await run.logIn('admin');
      const truth = await run.live(admin.context);
      await truth.subscribe();
      await setLinks(run.server, [{ name: 'tak-perm', port: tak.port }], {}, { Cookie: await run.cookieOf(admin.context) });
      await tak.waitForConnections(1);
      tak.send({ uid: 'ita-perm-1', lon: 16.5, lat: 58.25, callsign: 'PERM1' });
      // The plugin's server part creates it, with no user: not checked (it acts as the plugin).
      const created = await nextEvent(truth, (e) => e.entityType === 'object' && e.operation === 'create' && e.by?.plugin === 'cot');
      expect(created.by?.user, 'a change without a user').toBeUndefined();

      const outcomes: Record<string, Outcome> = {};
      for (const user of ['viewer', 'drawer'] as UserKey[]) {
        const { context } = await run.logIn(user);
        const live = await run.live(context);
        await live.subscribe();
        const update = { requestId: crypto.randomUUID(), entityType: 'object', operation: 'update', entityId: created.entityId, data: { ...created.state, geometry: { type: 'Point', coordinates: [16.75, 58.5] } }, source: { plugin: 'draw-symbols' } };
        delete (update.data as { id?: unknown }).id;
        delete (update.data as { meta?: unknown }).meta;
        delete (update.data as { version?: unknown }).version;
        outcomes[`${user}: move cot's object`] = outcomeOf(await live.change(update));
        await live.close();
      }
      expect(outcomes).toEqual({ "viewer: move cot's object": DENIED, "drawer: move cot's object": APPLIED });
      await truth.close();
    });
  } finally {
    await tak.close();
  }
});


test('the layer lock with real users (ADR-0042): the drawer may not lock a layer (layers.edit); the editor locks it, and then the drawer\'s create and delete in it get LAYER_LOCKED, the viewer\'s PERMISSION_DENIED (the permission first); the admin, who did not lock it, unlocks it', async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  await withLoginServer(testInfo, browser, realm(), async (run) => {
    const users = {} as Record<'viewer' | 'drawer' | 'editor' | 'admin', LiveClient>;
    for (const user of ['viewer', 'drawer', 'editor', 'admin'] as const) {
      users[user] = await run.live((await run.logIn(user)).context);
      await users[user].subscribe();
    }
    const lockOf = (layer: Layer, locked: boolean) => {
      const request = layerRequest('update', layer);
      (request.data as { locked?: boolean }).locked = locked;
      return request;
    };
    const editors = await adminLayer(users.editor, 'Reference', 7);
    const object = createSymbol(editors.id, 7, { name: 'the drawer\'s' });
    expect((await users.drawer.change(object)).outcome, 'the drawer draws in it').toBe('applied');

    const outcomes: Record<string, Outcome> = {};
    outcomes['drawer: lock'] = outcomeOf(await users.drawer.change(lockOf(editors, true)));
    const lock = await users.editor.change(lockOf(editors, true));
    outcomes['editor: lock'] = outcomeOf(lock);
    const locked = { ...editors, version: lock.event?.state.version };
    outcomes['drawer: create'] = outcomeOf(await users.drawer.change(createSymbol(editors.id, 8)));
    outcomes['drawer: delete'] = outcomeOf(await users.drawer.change(deleteRequest('object', object.entityId)));
    outcomes['drawer: draw order'] = outcomeOf(await users.drawer.change(layerRequest('update', { ...locked, drawOrder: 8 })));
    outcomes['viewer: create'] = outcomeOf(await users.viewer.change(createSymbol(editors.id, 9)));
    outcomes['admin: unlock'] = outcomeOf(await users.admin.change(lockOf(locked, false)));
    outcomes['drawer: create after the unlock'] = outcomeOf(await users.drawer.change(createSymbol(editors.id, 10)));
    const LOCKED = { outcome: 'rejected', code: 'LAYER_LOCKED' };
    expect(outcomes).toEqual({
      'drawer: lock': DENIED,
      'editor: lock': APPLIED,
      'drawer: create': LOCKED,
      'drawer: delete': LOCKED,
      'drawer: draw order': DENIED,
      'viewer: create': DENIED,
      'admin: unlock': APPLIED,
      'drawer: create after the unlock': APPLIED,
    });
    expect(lock.event?.by?.user, 'the lock is the editor\'s change').toBe(run.realm.users.editor.id);
    for (const live of Object.values(users)) await live.close();
  });
});
