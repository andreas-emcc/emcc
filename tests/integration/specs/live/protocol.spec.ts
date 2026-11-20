// Quick run: @always @live
import { expect, test } from '@playwright/test';
import { createSymbol, seededLayer, LiveClient } from '../../lib/live.mjs';

// The live picture protocol, version 2 (server/live-picture-protocol.md), on the shared server.
// Other tests may have created objects there, so these tests only rely on what they create.

const clients: LiveClient[] = [];

async function open(baseURL: string): Promise<LiveClient> {
  const client = await LiveClient.open(baseURL);
  clients.push(client);
  return client;
}

test.afterEach(async () => {
  await Promise.all(clients.splice(0).map((c) => c.close()));
});

test('the server greets with protocol 2 and sends a consistent snapshot with the Drawing layer', async ({
  baseURL,
}) => {
  const client = await open(baseURL!);
  expect(client.protocol).toBe(2);
  const snapshot = await client.subscribe();
  expect(snapshot.endSequenceNo).toBe(snapshot.sequenceNo);
  expect(snapshot.layers.map((l: { name: string }) => l.name)).toContain('Drawing');
  for (const size of snapshot.parts) expect(size).toBeLessThanOrEqual(1000);
});

test('right after welcome, without subscribing, the server sends the data types (core.general first) and the settings of every started plugin', async ({
  baseURL,
}) => {
  const plugins = (await (await fetch(`${baseURL}/api/plugins`)).json()) as Array<{ id: string; active: boolean }>;
  const started = plugins.filter((p) => p.active).map((p) => p.id);
  expect(started.length, 'the run installs plugins').toBeGreaterThan(0);

  const client = await open(baseURL!);
  // In order, right after welcome (which open() took): data-types, then the settings messages.
  await expect.poll(() => client.inbox.length).toBeGreaterThanOrEqual(1 + started.length);
  expect(client.inbox.slice(0, 1 + started.length).map((m: { type: string }) => m.type)).toEqual(['data-types', ...started.map(() => 'settings')]);

  const { dataTypes } = await client.next((m: { type: string }) => m.type === 'data-types');
  expect(dataTypes[0]).toMatchObject({ id: 'core.general', declaredBy: null });
  for (const type of dataTypes) expect(type).toEqual(expect.objectContaining({ id: expect.any(String), name: expect.any(String), behaviour: expect.any(Object) }));
  const settings: string[] = [];
  for (const _ of started) {
    const message = await client.next((m: { type: string }) => m.type === 'settings');
    expect(message.values, `settings of ${message.plugin}`).toEqual(expect.any(Object));
    settings.push(message.plugin);
  }
  expect(settings.sort(), 'one settings message per started plugin').toEqual([...started].sort());
});

test('a change by one client reaches another client live, in sequence after its snapshot', async ({
  baseURL,
}) => {
  const writer = await open(baseURL!);
  const reader = await open(baseURL!);
  const seen = await reader.subscribe();
  const request = createSymbol(seededLayer(seen), 1, { name: 'seen by both' });

  const outcome = await writer.change(request);
  expect(outcome.outcome).toBe('applied');
  expect(outcome.event).toMatchObject({ entityId: request.entityId, operation: 'create', requestId: request.requestId });

  await reader.waitForSequence(outcome.event.sequenceNo);
  const event = reader.events.find((e: { entityId: string }) => e.entityId === request.entityId);
  expect(event.state.geometry.coordinates).toEqual(request.data.geometry.coordinates);
  // Batches continue the snapshot without a gap.
  const numbers = reader.events.map((e: { sequenceNo: number }) => e.sequenceNo);
  expect(numbers[0]).toBe(seen.sequenceNo + 1);
  expect(numbers).toEqual(numbers.map((_: number, i: number) => seen.sequenceNo + 1 + i));
});

test("the requester's applied change also arrives in a changes batch", async ({ baseURL }) => {
  const client = await open(baseURL!);
  const snapshot = await client.subscribe();
  const outcome = await client.change(createSymbol(seededLayer(snapshot), 2));
  await client.waitForSequence(outcome.event.sequenceNo);
  expect(client.events.map((e: { requestId: string }) => e.requestId)).toContain(outcome.requestId);
});

test('the server sets source.user itself: what a client sends is ignored', async ({ baseURL }) => {
  const client = await open(baseURL!);
  const snapshot = await client.subscribe();
  const request = createSymbol(seededLayer(snapshot), 3);
  const outcome = await client.change({ ...request, source: { plugin: 'ita-test', user: 'someone-else' } });
  expect(outcome.outcome).toBe('applied');
  expect(JSON.stringify(outcome.event)).not.toContain('someone-else');
  // The dev profile is the no-login mode: every change is the local user's (ADR-0022).
  expect(outcome.event.by.user).toBe('local');
  expect(outcome.event.by.plugin).toBe('ita-test');
});

for (const plugin of ['core', 'core-persistence']) {
  test(`a change request in ECore's name (source.plugin "${plugin}") is rejected`, async ({ baseURL }) => {
    const client = await open(baseURL!);
    const snapshot = await client.subscribe();
    const outcome = await client.change(createSymbol(seededLayer(snapshot), 4, { plugin }));
    expect(outcome.outcome).toBe('rejected');
    expect(outcome.rejection.code).toBe('VALIDATION_FAILED');
  });
}

test('a change request the schema refuses gets a VALIDATION_FAILED outcome with details', async ({ baseURL }) => {
  const client = await open(baseURL!);
  const snapshot = await client.subscribe();
  const request = createSymbol(seededLayer(snapshot), 5);
  const outcome = await client.change({ ...request, data: { ...request.data, geometry: { type: 'Point' } } });
  expect(outcome.outcome).toBe('rejected');
  expect(outcome.rejection.code).toBe('VALIDATION_FAILED');
  expect(outcome.rejection.details).toBeTruthy();
});

test('data model 1.0.0: an object without dataType or dataSource, or with a data type nobody declares, is rejected', async ({ baseURL }) => {
  const client = await open(baseURL!);
  const snapshot = await client.subscribe();
  const request = createSymbol(seededLayer(snapshot), 6);
  const { dataType, dataSource, ...m0Content } = request.data;
  expect([dataType, dataSource]).toEqual(['core.general', 'manual']);
  for (const [what, data, field] of [
    ['M0 content, without both', m0Content, 'dataType'],
    ['without dataType', { ...m0Content, dataSource }, 'dataType'],
    ['without dataSource', { ...m0Content, dataType }, 'dataSource'],
    ['an undeclared data type (model rule 14)', { ...request.data, dataType: 'ita-test.nothing' }, 'dataType'],
  ] as const) {
    const outcome = await client.change({ ...createSymbol(seededLayer(snapshot), 6), data });
    expect(outcome.outcome, what).toBe('rejected');
    expect(outcome.rejection.code, what).toBe('VALIDATION_FAILED');
    expect(JSON.stringify(outcome.rejection.details), `${what}: the details name the field`).toContain(field);
  }
});

test('unusable messages get an error and the connection stays open', async ({ baseURL }) => {
  const client = await open(baseURL!);
  client.sendRaw('this is not JSON');
  expect((await client.next((m) => m.type === 'error')).message).toBeTruthy();
  client.send({ type: 'no-such-type' });
  expect((await client.next((m) => m.type === 'error')).message).toBeTruthy();
  client.send({ type: 'change-request', request: { entityType: 'object' } });
  expect((await client.next((m) => m.type === 'error')).message).toBeTruthy();

  const snapshot = await client.subscribe();
  expect(snapshot.layers.length).toBeGreaterThan(0);
});
