// Quick run: @login @plugin-simulator
// Quick run of this file alone: node tests/integration/run.mjs --skip-build --keycloak -- specs/keycloak/workspaces.spec.ts
import { expect, test } from '@playwright/test';
import { createLayer, createSymbol, type LiveClient } from '../../lib/live.mjs';
import { useTestRealm, withLoginServer, type LoginRun, type UserKey } from '../../lib/login';

// The Simulation workspace's permissions on the server (T-086; ADR-0039 point 7, simulator
// criterion 1; T-080's server part), against a real Keycloak. The sim-* users of the test realm
// hold Simulation's view, edit and run permissions in different combinations (lib/keycloak.mjs);
// the others hold none of them. For a user without the view permission, what is in Simulation does
// not exist: not in /api/config, snapshots, changes or queries, and a change to it is "not found"
// (owner, 2026-10-27). Without the edit permission a change is refused, and the simulator's commands
// need its run permission. The shell's workspace tabs are not part of this file. Runs only with
// run.mjs --keycloak.

test.describe.configure({ timeout: 180_000 });

const realm = useTestRealm();
const SIMULATION = 'simulator.simulation';

type Outcome = { outcome: string; code?: string };
type Event = { entityId: string; sequenceNo: number };

function outcomeOf(message: { outcome: string; rejection?: { code: string } }): Outcome {
  return message.rejection ? { outcome: message.outcome, code: message.rejection.code } : { outcome: message.outcome };
}

/** A user's live connection with a whole-picture subscription that asks for every workspace. */
async function watching(run: LoginRun, user: UserKey) {
  const { context } = await run.logIn(user);
  const live = await run.live(context);
  const snapshot = await live.subscribe({ workspaces: ['*'] });
  return { context, live, snapshot };
}

/** An object update: the whole object again, at a new position (lat ≠ lon). */
function moved(request: ReturnType<typeof createSymbol>) {
  const update = structuredClone(request);
  update.requestId = crypto.randomUUID();
  update.operation = 'update';
  update.data.geometry.coordinates = [17.25, 58.75];
  return update;
}

test('only users with Simulation\'s view permission get it: in /api/config, snapshots, changes and queries; the others\' sequence still moves past it', async ({ browser }, testInfo) => {
  await withLoginServer(testInfo, browser, realm(), async (run) => {
    const workspacesOf = async (user: UserKey) => {
      const { context } = await run.logIn(user);
      const config = await (await run.api(context, '/api/config')).json();
      return config.workspaces.map((w: { id: string }) => w.id);
    };
    expect(await workspacesOf('viewer'), 'no permission').toEqual(['core.view']);
    expect(await workspacesOf('simBlind'), 'edit without view').toEqual(['core.view']);
    expect(await workspacesOf('simViewer'), 'view').toEqual(['core.view', SIMULATION]);

    const editor = await watching(run, 'simEditor');
    const viewer = await watching(run, 'viewer');
    const blind = await watching(run, 'simBlind');
    const simViewer = await watching(run, 'simViewer');
    try {
      const layer = createLayer('Ground truth', { workspace: SIMULATION });
      expect(outcomeOf(await editor.live.change(layer)), 'the sim editor makes a Simulation layer').toEqual({ outcome: 'applied' });
      const object = createSymbol(layer.entityId, 7);
      const made = await editor.live.change(object);
      expect(outcomeOf(made), 'and an object in it').toEqual({ outcome: 'applied' });
      const sequenceNo = (made.event as Event).sequenceNo;

      for (const [user, watcher] of [['viewer', viewer], ['simBlind', blind]] as const) {
        await watcher.live.waitForSequence(sequenceNo);
        expect(watcher.live.events, `${user}: no Simulation event, though its sequence moved past both`).toEqual([]);
        const fresh = await watcher.live.subscribe({ id: 'again', workspaces: ['*', SIMULATION] });
        expect(fresh.layers.map((l: { name: string }) => l.name), `${user}: View's layer only`).toEqual(['Drawing']);
        expect(fresh.objects, `${user}: no object`).toEqual([]);
        expect(await watcher.live.getObjects([object.entityId]), `${user}: the object is missing`).toMatchObject({ type: 'objects', found: [], missing: [object.entityId] });
        expect(await watcher.live.queryLayer(layer.entityId), `${user}: the layer does not exist`).toMatchObject({ type: 'query-failed', problem: 'no-layer' });
      }
      await simViewer.live.waitForSequence(sequenceNo);
      expect(simViewer.live.events.map((e: Event) => e.entityId), 'the sim viewer gets both').toEqual([layer.entityId, object.entityId]);
      expect(await simViewer.live.getObjects([object.entityId])).toMatchObject({ type: 'objects', missing: [] });
      expect(await simViewer.live.queryLayer(layer.entityId)).toMatchObject({ type: 'layer-page', total: 1 });
    } finally {
      await Promise.all([editor, viewer, blind, simViewer].map((w) => w.live.close()));
    }
  });
});

test('changes in Simulation need its edit permission, and for a user who may not see it they are "not found"', async ({ browser }, testInfo) => {
  await withLoginServer(testInfo, browser, realm(), async (run) => {
    const editor = await watching(run, 'simEditor');
    const layer = createLayer('Ground truth', { workspace: SIMULATION });
    expect(outcomeOf(await editor.live.change(layer))).toEqual({ outcome: 'applied' });
    const object = createSymbol(layer.entityId, 8);
    expect(outcomeOf(await editor.live.change(object))).toEqual({ outcome: 'applied' });

    const outcomes: Record<string, Outcome> = {};
    const tryAs = async (user: UserKey) => {
      const { live } = await watching(run, user);
      try {
        outcomes[`${user}: object update`] = outcomeOf(await live.change(moved(object)));
        outcomes[`${user}: object create`] = outcomeOf(await live.change(createSymbol(layer.entityId, 9)));
        outcomes[`${user}: layer create`] = outcomeOf(await live.change(createLayer(`Made by ${user}`, { workspace: SIMULATION })));
      } finally {
        await live.close();
      }
    };
    for (const user of ['viewer', 'editor', 'simViewer', 'simBlind', 'simEditor'] as UserKey[]) await tryAs(user);
    testInfo.annotations.push({ type: 'outcomes', description: JSON.stringify(outcomes) });

    const denied = { outcome: 'rejected', code: 'PERMISSION_DENIED' };
    const notFound = { outcome: 'rejected', code: 'ENTITY_NOT_FOUND' };
    const noLayer = { outcome: 'rejected', code: 'LAYER_NOT_FOUND' };
    const invalid = { outcome: 'rejected', code: 'VALIDATION_FAILED' };
    const applied = { outcome: 'applied' };
    expect(outcomes).toEqual({
      // No permission that could allow a change: refused by the session, before anything else.
      'viewer: object update': denied,
      'viewer: object create': denied,
      'viewer: layer create': denied,
      'simViewer: object update': denied,
      'simViewer: object create': denied,
      'simViewer: layer create': denied,
      // View's edit permissions do not reach Simulation, which the editor may not see: what is
      // there does not exist, and a new layer there is refused as in a workspace nobody declares
      // (View's layers.edit is checked, then the workspace is invalid).
      'editor: object update': notFound,
      'editor: object create': noLayer,
      'editor: layer create': invalid,
      // Simulation's edit permission without its view permission: the same; without View's
      // layers.edit its new layer is refused for that permission first.
      'simBlind: object update': notFound,
      'simBlind: object create': noLayer,
      'simBlind: layer create': denied,
      'simEditor: object update': applied,
      'simEditor: object create': applied,
      'simEditor: layer create': applied,
    });
    await editor.live.close();
  });
});

test('the simulator\'s endpoints: reading needs Simulation\'s view permission, choosing outputs its edit permission, start, pause and reset its run permission (403 otherwise)', async ({ browser }, testInfo) => {
  await withLoginServer(testInfo, browser, realm(), async (run) => {
    const statuses: Record<string, number> = {};
    const post = { method: 'POST', headers: { 'Content-Type': 'application/json' } };
    for (const user of ['viewer', 'simViewer', 'simEditor', 'simRunner'] as UserKey[]) {
      const { context } = await run.logIn(user);
      statuses[`${user}: GET /routes`] = (await run.api(context, '/api/plugins/simulator/routes')).status;
      statuses[`${user}: GET /outputs`] = (await run.api(context, '/api/plugins/simulator/outputs')).status;
      statuses[`${user}: POST /outputs`] = (await run.api(context, '/api/plugins/simulator/outputs', { ...post, body: JSON.stringify({ channels: [] }) })).status;
      for (const command of ['start', 'pause', 'reset']) {
        statuses[`${user}: POST /routes/${command}`] = (await run.api(context, `/api/plugins/simulator/routes/${command}`, { ...post, body: '{}' })).status;
      }
    }
    testInfo.annotations.push({ type: 'statuses', description: JSON.stringify(statuses) });
    const row = (get: number, outputs: number, commands: number) => ({ get, outputs, commands });
    const byUser = Object.fromEntries(
      ['viewer', 'simViewer', 'simEditor', 'simRunner'].map((u) => [
        u,
        row(statuses[`${u}: GET /routes`], statuses[`${u}: POST /outputs`], Math.max(...['start', 'pause', 'reset'].map((c) => statuses[`${u}: POST /routes/${c}`]))),
      ]),
    );
    expect(byUser).toEqual({
      viewer: row(403, 403, 403),
      simViewer: row(200, 403, 403),
      simEditor: row(200, 200, 403),
      simRunner: row(200, 403, 200),
    });
    for (const user of ['simViewer', 'simEditor', 'simRunner']) expect(statuses[`${user}: GET /outputs`], user).toBe(200);
    expect(Math.min(...['start', 'pause', 'reset'].map((c) => statuses[`simRunner: POST /routes/${c}`])), 'every command').toBe(200);
  });
});
