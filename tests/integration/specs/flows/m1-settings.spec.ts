// Quick run: @settings @plugin-coordinates
import { expect, test } from '@playwright/test';
import { createSymbol, seededLayer, LiveClient } from '../../lib/live.mjs';
import { mapCentre, withM0 } from '../../lib/m0';
import { stopOwnServer, withOwnServers, type OwnServer } from '../../lib/own-server';
import { installTestPlugin } from '../../lib/test-plugins.mjs';

// M1 flows in the no-login mode (T-043): data types (ADR-0023, SDK v1) and settings that change
// at runtime (SDK v1, server/README.md "Settings"), seen over the HTTP API, the live socket, a
// plugin's server part and an open page. In the no-login mode the local user has settings.admin.
// A data type's behaviour is changed through the settings view's endpoint (T-039).

test.describe.configure({ timeout: 120_000 });

type DataType = { id: string; name: string; declaredBy: string | null; defaults: Record<string, unknown>; behaviour: Record<string, unknown> };

async function json(server: OwnServer, path: string, init?: RequestInit) {
  const response = await fetch(`${server.baseUrl}${path}`, init);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

function put(values: unknown): RequestInit {
  return { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) };
}

test('data types declared by started plugins are offered over /api/config and the live socket, and objects can use them; a refused plugin declares none', async ({}, testInfo) => {
  await withOwnServers(testInfo, async (folders, start) => {
    const defaults = { expiresAfterSeconds: 600, fadeWhenExpired: true };
    installTestPlugin(folders.pluginsDir, 'ita-limits', { dataTypes: [{ suffix: 'thing', name: 'ITA thing', description: 'A data type of the ITA', defaults }] });
    installTestPlugin(folders.pluginsDir, 'ita-limits', { as: 'ita-refused', sdkVersion: '^0.1.0', dataTypes: [{ suffix: 'gone', name: 'Gone' }] });
    const server = await start();

    const { body: config } = await json(server, '/api/config');
    const types = config.dataTypes as DataType[];
    expect(types.map((t) => t.id), 'core.general first, the refused plugin declares nothing').toEqual(['core.general', 'ita-limits.thing']);
    expect(types[1]).toMatchObject({ name: 'ITA thing', description: 'A data type of the ITA', declaredBy: 'ita-limits', defaults, behaviour: defaults });

    const client = await LiveClient.open(server.baseUrl);
    const { dataTypes } = await client.next((m: { type: string }) => m.type === 'data-types');
    expect(dataTypes, 'the live socket says the same').toEqual(types);

    const layer = seededLayer(await client.subscribe());
    const thing = createSymbol(layer, 1);
    thing.data.dataType = 'ita-limits.thing';
    const applied = await client.change(thing);
    expect(applied.outcome).toBe('applied');
    expect(applied.event.state).toMatchObject({ dataType: 'ita-limits.thing', dataSource: 'manual' });
    const gone = createSymbol(layer, 2);
    gone.data.dataType = 'ita-refused.gone';
    const rejected = await client.change(gone);
    expect(rejected.outcome, 'the refused plugin\'s data type is not available').toBe('rejected');
    expect(rejected.rejection.code).toBe('VALIDATION_FAILED');
    await client.close();
    await stopOwnServer(server, { expectedLog: [/Plugin ita-refused is disabled: needs SDK \^0\.1\.0/] });
  });
});

test("ECore removes expired objects of a data type whose defaults say so, counted from their observation, and leaves core.general's alone (model rule 15; ADR-0054 point 9)", async ({}, testInfo) => {
  await withOwnServers(testInfo, async (folders, start) => {
    // Expires 2 s after its last change, removed right after expiry; ECore looks every 5 s.
    installTestPlugin(folders.pluginsDir, 'ita-limits', { dataTypes: [{ suffix: 'brief', name: 'Short-lived', defaults: { expiresAfterSeconds: 2, removeAfterExpirySeconds: 0 } }] });
    const server = await start();
    const client = await LiveClient.open(server.baseUrl);
    const layer = seededLayer(await client.subscribe());
    const brief = createSymbol(layer, 1);
    brief.data.dataType = 'ita-limits.brief';
    const general = createSymbol(layer, 2);
    const created = Date.now(); // before the change, so its expiry cannot come earlier than this
    // A data type's expiry counts from the observation only (ADR-0054 point 9, CR-0038).
    brief.data.time = { observed: new Date(created).toISOString() };
    expect((await client.change(brief)).outcome).toBe('applied');
    expect((await client.change(general)).outcome).toBe('applied');

    const removal = await client.next((m: { type: string; events?: Array<{ entityId: string; operation: string }> }) => m.type === 'changes' && m.events!.some((e) => e.entityId === brief.entityId && e.operation === 'delete'), 20_000);
    const event = removal.events.find((e: { entityId: string }) => e.entityId === brief.entityId);
    expect(event.by, 'an ordinary delete by ECore').toMatchObject({ plugin: 'core' });
    const seconds = (Date.now() - created) / 1000;
    testInfo.annotations.push({ type: 'removed after', description: `${seconds.toFixed(1)} s` });
    expect(seconds, 'not before its expiry').toBeGreaterThanOrEqual(2);

    await client.close();
    const later = await LiveClient.open(server.baseUrl);
    const ids = (await later.subscribe()).objects.map((o: { id: string }) => o.id);
    expect(ids).not.toContain(brief.entityId);
    expect(ids, 'core.general never expires by default').toContain(general.entityId);
    await later.close();
    await stopOwnServer(server);
  });
});

test("a data type's behaviour changes at runtime: every live socket gets the new data types, ECore follows it, an invalid one is refused, and it survives a restart", async ({}, testInfo) => {
  await withOwnServers(testInfo, async (folders, start) => {
    const defaults = { fadeWhenExpired: true };
    installTestPlugin(folders.pluginsDir, 'ita-limits', { dataTypes: [{ suffix: 'thing', name: 'ITA thing', defaults }] });
    let server = await start();
    const path = '/api/settings/data-types/ita-limits.thing';
    const before = await json(server, path);
    expect(before.status).toBe(200);
    expect(before.body).toMatchObject({ id: 'ita-limits.thing', declaredBy: 'ita-limits', defaults, behaviour: defaults });

    const client = await LiveClient.open(server.baseUrl);
    const other = await LiveClient.open(server.baseUrl);
    await client.next((m: { type: string }) => m.type === 'data-types');
    await other.next((m: { type: string }) => m.type === 'data-types');
    const layer = seededLayer(await client.subscribe());
    const thing = createSymbol(layer, 1);
    thing.data.dataType = 'ita-limits.thing';
    thing.data.time = { observed: new Date().toISOString() }; // the expiry counts from it (ADR-0054 point 9)
    expect((await client.change(thing)).outcome, 'by default it never expires').toBe('applied');

    // Expire 2 s after the last change and remove at once: the object made before goes.
    const behaviour = { fadeWhenExpired: true, expiresAfterSeconds: 2, removeAfterExpirySeconds: 0 };
    const changed = await json(server, path, put(behaviour));
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ defaults, behaviour });
    for (const socket of [client, other]) {
      const message = await socket.next((m: { type: string }) => m.type === 'data-types');
      expect(message.dataTypes.find((t: DataType) => t.id === 'ita-limits.thing').behaviour, 'every browser gets the new behaviour').toEqual(behaviour);
    }
    await other.close();
    const removal = await client.next(
      (m: { type: string; events?: Array<{ entityId: string; operation: string }> }) => m.type === 'changes' && m.events!.some((e) => e.entityId === thing.entityId && e.operation === 'delete'),
      20_000,
    );
    expect(removal.events.find((e: { entityId: string }) => e.entityId === thing.entityId).by).toMatchObject({ plugin: 'core' });

    const invalid = await json(server, path, put({ expiresAfterSeconds: 0 }));
    expect(invalid.status).toBe(400);
    expect(invalid.body.problems.length).toBeGreaterThan(0);
    expect((await json(server, '/api/settings/data-types/ita-limits.nothing')).status, 'an unknown data type').toBe(404);
    expect((await json(server, path)).body.behaviour, 'nothing changed').toEqual(behaviour);
    await client.close();
    await stopOwnServer(server);

    server = await start();
    expect((await json(server, path)).body).toMatchObject({ defaults, behaviour });
    await stopOwnServer(server);
  });
});

test("a settings change reaches the plugin's server part and every live socket without a restart; an invalid one is refused; the values survive a restart", async ({}, testInfo) => {
  await withOwnServers(testInfo, async (folders, start) => {
    installTestPlugin(folders.pluginsDir, 'ita-limits');
    let server = await start();
    const plugin = async () => (await json(server, '/api/plugins/ita-limits/settings')).body;

    const { status, body } = await json(server, '/api/settings/plugins/ita-limits');
    expect(status).toBe(200);
    expect(body.values).toEqual({ timersInStart: 0, note: 'initial' });
    expect(body.schema.properties.note.type).toBe('string');
    expect(await plugin()).toEqual({ changes: 0, note: 'initial', timersInStart: 0 });

    const client = await LiveClient.open(server.baseUrl);
    await client.next((m: { type: string; plugin?: string }) => m.type === 'settings' && m.plugin === 'ita-limits');

    const changed = await json(server, '/api/settings/plugins/ita-limits', put({ timersInStart: 0, note: 'changed' }));
    expect(changed).toEqual({ status: 200, body: { values: { timersInStart: 0, note: 'changed' } } });
    const message = await client.next((m: { type: string; plugin?: string }) => m.type === 'settings' && m.plugin === 'ita-limits');
    expect(message.values, 'the live socket gets the complete new values').toEqual({ timersInStart: 0, note: 'changed' });
    await expect.poll(plugin, { message: 'the server part got them, without a restart' }).toEqual({ changes: 1, note: 'changed', timersInStart: 0 });

    const invalid = await json(server, '/api/settings/plugins/ita-limits', put({ timersInStart: -1, note: 'never' }));
    expect(invalid.status).toBe(400);
    expect(invalid.body.problems).toEqual(expect.arrayContaining([expect.objectContaining({ path: expect.stringContaining('timersInStart') })]));
    expect((await json(server, '/api/settings/plugins/ita-limits')).body.values.note, 'nothing changed').toBe('changed');
    expect(await plugin(), 'nothing delivered').toEqual({ changes: 1, note: 'changed', timersInStart: 0 });
    expect(client.inbox.filter((m: { type: string }) => m.type === 'settings'), 'no settings message for a refused change').toEqual([]);
    await client.close();
    await stopOwnServer(server);

    server = await start();
    expect((await json(server, '/api/settings/plugins/ita-limits')).body.values).toEqual({ timersInStart: 0, note: 'changed' });
    expect(await plugin(), 'the plugin starts with the configured values').toEqual({ changes: 0, note: 'changed', timersInStart: 0 });
    await stopOwnServer(server);
  });
});

test("a settings change reaches an open page without a reload: the coordinates panel follows defaultFormat until the user picks a format", async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ server, open }) => {
    const following = await open(undefined, { pickFormat: false });
    const picked = await open();
    const display = (page: typeof following) => page.locator('[aria-label="Pointer position"]');
    for (const page of [following, picked]) {
      const centre = await mapCentre(page);
      await page.mouse.move(centre.x, centre.y);
    }
    await expect(display(following), 'the default format, DMS').toHaveText(/\d+°\d+'[\d.]+" [NS]/);
    await expect(display(picked), 'the user picked DD').toHaveText(/\d+\.\d{6}° [NS]/);

    const current = (await (await fetch(`${server.baseUrl}/api/settings/plugins/coordinates`)).json()).values;
    const response = await fetch(`${server.baseUrl}/api/settings/plugins/coordinates`, put({ ...current, defaultFormat: 'utm' }));
    expect(response.status).toBe(200);

    // The pointer moves a little, as a user's does; no reload.
    for (const page of [following, picked]) {
      const centre = await mapCentre(page);
      await page.mouse.move(centre.x + 3, centre.y + 2);
    }
    await expect(display(following), 'now UTM').toHaveText(/^\d{1,2}[C-HJ-NP-X] /);
    await expect(display(picked), "the user's pick stays").toHaveText(/\d+\.\d{6}° [NS]/);
    testInfo.annotations.push({ type: 'displays', description: `${await display(following).textContent()} | ${await display(picked).textContent()}` });
  });
});
