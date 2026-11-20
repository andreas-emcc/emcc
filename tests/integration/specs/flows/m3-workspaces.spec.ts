// Quick run: @live @plugin-simulator
// Quick run of this file alone: node tests/integration/run.mjs --skip-build -- specs/flows/m3-workspaces.spec.ts
import { expect, test } from '@playwright/test';
import { createLayer, createSymbol, LiveClient } from '../../lib/live.mjs';
import { stopOwnServer, withOwnServers, type OwnServer } from '../../lib/own-server';
import { installPlugins } from '../../lib/plugins.mjs';

// Workspaces at the API and the live picture (T-086; ADR-0039 points 5 and 7, T-080's server part):
// a layer names its workspace, and a subscription gets the layers of the workspaces it names that
// its user may see. Without login the local user has every permission, so it may see Simulation,
// the workspace the simulator declares; what a user without its permissions gets is in
// specs/keycloak/workspaces.spec.ts. The shell's workspace tabs are not part of this file.

test.describe.configure({ timeout: 120_000 });

const SIMULATION = 'simulator.simulation';

type Layer = { id: string; name: string; workspace?: string };
type Event = { entityType: string; entityId: string; operation: string; state: { layerId?: string; workspace?: string } | null };

/** A server of the test's own with the simulator, which declares the Simulation workspace. */
async function withSimulator(testInfo: Parameters<typeof withOwnServers>[0], body: (start: () => Promise<OwnServer>) => Promise<void>) {
  await withOwnServers(testInfo, async (folders, start) => {
    installPlugins(folders.pluginsDir, { only: ['simulator'] });
    await body(() => start());
  });
}

async function applied(client: LiveClient, request: ReturnType<typeof createLayer> | ReturnType<typeof createSymbol>) {
  const outcome = await client.change(request);
  expect(outcome, `${request.entityType} ${request.operation}`).toMatchObject({ outcome: 'applied' });
  return outcome.event as Event & { sequenceNo: number };
}

const names = (layers: Layer[]) => layers.map((l) => l.name).sort();
// A fresh system has View's "Drawing" (ECore) and Simulation's "Simulation" (the simulator, from M4, T-101).

test('/api/config lists View first, then Simulation with its permissions, which the local user has', async ({}, testInfo) => {
  await withSimulator(testInfo, async (start) => {
    const server = await start();
    const config = await (await fetch(`${server.baseUrl}/api/config`)).json();
    testInfo.annotations.push({ type: 'workspaces', description: JSON.stringify(config.workspaces) });
    expect(config.workspaces.map((w: { id: string }) => w.id)).toEqual(['core.view', SIMULATION]);
    expect(config.workspaces[1]).toMatchObject({ id: SIMULATION, name: 'Simulation', viewPermission: 'plugin.simulator.view', editPermission: 'plugin.simulator.edit' });
    // The local user lists no permissions but has every one, Simulation's view permission included.
    expect(config.user).toMatchObject({ noLogin: true });
    await stopOwnServer(server);
  });
});

test('a subscription gets View without "workspaces", Simulation only when it names it or "*", and its sequence moves past what it does not get', async ({}, testInfo) => {
  await withSimulator(testInfo, async (start) => {
    const server = await start();
    const writer = await LiveClient.open(server.baseUrl);
    const view = await LiveClient.open(server.baseUrl);
    const all = await LiveClient.open(server.baseUrl);
    const simulation = await LiveClient.open(server.baseUrl);
    try {
      const viewSnapshot = await view.subscribe();
      await all.subscribe({ workspaces: ['*'] });
      // A workspace nobody declares is left out without a word, so a browser cannot learn which exist.
      await simulation.subscribe({ workspaces: [SIMULATION, 'nobody.declares-this'] });
      expect(names(viewSnapshot.layers), 'View: only its seeded layer').toEqual(['Drawing']);

      const layerEvent = await applied(writer, createLayer('Ground truth', { workspace: SIMULATION }));
      expect(layerEvent.state, 'the layer names its workspace').toMatchObject({ workspace: SIMULATION });
      const objectEvent = await applied(writer, createSymbol(layerEvent.entityId, 3));
      const viewLayer = viewSnapshot.layers[0].id;
      const viewObject = await applied(writer, createSymbol(viewLayer, 4));

      // View's subscription is brought past both Simulation changes without seeing either.
      await view.waitForSequence(viewObject.sequenceNo);
      expect(view.events.map((e: Event) => e.entityId), 'View gets only its own change').toEqual([viewObject.entityId]);
      await all.waitForSequence(viewObject.sequenceNo);
      expect(all.events.map((e: Event) => e.entityId), '"*" gets all three').toEqual([layerEvent.entityId, objectEvent.entityId, viewObject.entityId]);
      await simulation.waitForSequence(viewObject.sequenceNo);
      expect(simulation.events.map((e: Event) => e.entityId), 'Simulation gets only its own').toEqual([layerEvent.entityId, objectEvent.entityId]);

      // Fresh snapshots agree.
      const fresh = await LiveClient.open(server.baseUrl);
      try {
        const v = await fresh.subscribe({ id: 'v' });
        const s = await fresh.subscribe({ id: 's', workspaces: [SIMULATION] });
        const a = await fresh.subscribe({ id: 'a', workspaces: ['*'] });
        expect([names(v.layers), v.objects.map((o: { id: string }) => o.id)]).toEqual([['Drawing'], [viewObject.entityId]]);
        expect([names(s.layers), s.objects.map((o: { id: string }) => o.id)]).toEqual([['Ground truth', 'Simulation'], [objectEvent.entityId]]);
        for (const layer of s.layers) expect(layer).toMatchObject({ workspace: SIMULATION });
        expect(names(a.layers)).toEqual(['Drawing', 'Ground truth', 'Simulation']);
        expect(a.objects.map((o: { id: string }) => o.id).sort()).toEqual([objectEvent.entityId, viewObject.entityId].sort());
      } finally {
        await fresh.close();
      }
    } finally {
      await Promise.all([writer, view, all, simulation].map((c) => c.close()));
    }
    await stopOwnServer(server);
  });
});

test('"workspaces" that is not a list of strings gets an error and opens no subscription', async ({}, testInfo) => {
  await withSimulator(testInfo, async (start) => {
    const server = await start();
    const client = await LiveClient.open(server.baseUrl);
    try {
      for (const workspaces of ['*', [1], { id: SIMULATION }]) {
        const id = `bad-${typeof workspaces}-${JSON.stringify(workspaces).length}`;
        client.send({ type: 'subscribe', subscription: id, workspaces });
        const error = await client.next((m: { type: string }) => m.type === 'error' || (m.type === 'snapshot-begin' && (m as { subscription?: string }).subscription === id));
        expect(error, `workspaces ${JSON.stringify(workspaces)}`).toMatchObject({ type: 'error' });
      }
      // The connection still works.
      const snapshot = await client.subscribe({ id: 'good', workspaces: ['*'] });
      expect(names(snapshot.layers)).toEqual(['Drawing', 'Simulation']);
    } finally {
      await client.close();
    }
    await stopOwnServer(server);
  });
});

test('queries reach every workspace the user may see: get-objects and query-layer find a Simulation object', async ({}, testInfo) => {
  await withSimulator(testInfo, async (start) => {
    const server = await start();
    const client = await LiveClient.open(server.baseUrl);
    try {
      const layer = await applied(client, createLayer('Ground truth', { workspace: SIMULATION }));
      const object = await applied(client, createSymbol(layer.entityId, 5));
      const found = await client.getObjects([object.entityId]);
      expect(found).toMatchObject({ type: 'objects', missing: [] });
      expect(found.found.map((o: { id: string }) => o.id)).toEqual([object.entityId]);
      const page = await client.queryLayer(layer.entityId);
      expect(page).toMatchObject({ type: 'layer-page', total: 1 });
    } finally {
      await client.close();
    }
    await stopOwnServer(server);
  });
});

test('ECore seeds "Drawing" whenever View has no layer, also when only Simulation has one', async ({}, testInfo) => {
  await withSimulator(testInfo, async (start) => {
    let server = await start();
    const client = await LiveClient.open(server.baseUrl);
    const snapshot = await client.subscribe({ workspaces: ['*'] });
    const seeded = snapshot.layers.find((l: Layer) => l.name === 'Drawing')!;
    await applied(client, createLayer('Ground truth', { workspace: SIMULATION }));
    // View's only layer is empty, so it can go; Simulation keeps one.
    const removed = await client.change({ requestId: crypto.randomUUID(), entityType: 'layer', operation: 'delete', entityId: seeded.id, baseVersion: (seeded as { version?: number }).version, source: { plugin: 'ita-test' } });
    expect(removed, 'delete View\'s Drawing').toMatchObject({ outcome: 'applied' });
    await client.close();
    await stopOwnServer(server);

    server = await start();
    const again = await LiveClient.open(server.baseUrl);
    try {
      const after = await again.subscribe({ workspaces: ['*'] });
      testInfo.annotations.push({ type: 'layers after the restart', description: JSON.stringify(after.layers.map((l: Layer) => ({ name: l.name, workspace: l.workspace }))) });
      const view = after.layers.filter((l: Layer) => l.workspace === undefined || l.workspace === 'core.view');
      expect(names(view), 'View has a new Drawing').toEqual(['Drawing']);
      expect(view[0].id, 'a new layer, not the deleted one').not.toBe(seeded.id);
      expect(names(after.layers.filter((l: Layer) => l.workspace === SIMULATION))).toEqual(['Ground truth', 'Simulation']);
    } finally {
      await again.close();
    }
    await stopOwnServer(server);
  });
});
