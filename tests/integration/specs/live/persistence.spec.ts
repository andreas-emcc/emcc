// Quick run: @persistence
import { expect, test } from '@playwright/test';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSymbols, seededLayer, LiveClient } from '../../lib/live.mjs';
import { stopOwnServer, withOwnServers, type OwnServer } from '../../lib/own-server';
import { root } from '../../lib/server.mjs';

// Objects created over the live picture survive restarts (T-012 persistence, overview 4.8), and a
// client that connects again gets them in its snapshot. Each test starts servers of its own.

test.describe.configure({ timeout: 180_000 });

type Snapshot = Awaited<ReturnType<LiveClient['subscribe']>>;

async function snapshotOf(server: OwnServer): Promise<Snapshot> {
  const client = await LiveClient.open(server.baseUrl);
  const snapshot = await client.subscribe(30_000);
  await client.close();
  return snapshot;
}

function journalLines(dataDir: string): string[] {
  const file = join(dataDir, 'journal.jsonl');
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n') : [];
}

/** Waits until the journal on disk holds `sequenceNo` (persistence is write-behind). */
async function journalled(dataDir: string, sequenceNo: number): Promise<void> {
  await expect
    .poll(
      () =>
        journalLines(dataDir)
          .filter((line) => line.endsWith('}'))
          .map((line) => JSON.parse(line).sequenceNo as number)
          .at(-1) ?? 0,
      { timeout: 10_000 },
    )
    .toBeGreaterThanOrEqual(sequenceNo);
}

function ids(snapshot: Snapshot): string[] {
  return snapshot.objects.map((o: { id: string }) => o.id).sort();
}

test('objects survive a clean restart, and a client that connects again gets them and continues in sequence', async ({}, testInfo) => {
  await withOwnServers(testInfo, async (_folders, start) => {
    let server = await start();
    const client = await LiveClient.open(server.baseUrl);
    const layer = seededLayer(await client.subscribe());
    const created = await createSymbols(client, layer, 10);
    await client.close();
    const before = await snapshotOf(server);
    await stopOwnServer(server);

    server = await start();
    const after = await snapshotOf(server);
    expect(ids(after)).toEqual(ids(before));
    expect(after.objects).toEqual(expect.arrayContaining(before.objects));
    expect(after.sequenceNo).toBe(created.at(-1).sequenceNo);

    const again = await LiveClient.open(server.baseUrl);
    await again.subscribe();
    const [next] = await createSymbols(again, layer, 1);
    expect(next.sequenceNo).toBe(after.sequenceNo + 1);
    await again.close();
    await stopOwnServer(server);
  });
});

test('objects that reached the journal survive a hard kill', async ({}, testInfo) => {
  await withOwnServers(testInfo, async (folders, start) => {
    let server = await start();
    const client = await LiveClient.open(server.baseUrl);
    const layer = seededLayer(await client.subscribe());
    const created = await createSymbols(client, layer, 20);
    await client.close();
    await journalled(folders.dataDir, created.at(-1).sequenceNo);
    await server.kill();

    server = await start();
    const after = await snapshotOf(server);
    expect(ids(after)).toEqual(created.map((e: { entityId: string }) => e.entityId).sort());
    expect(after.sequenceNo).toBe(created.at(-1).sequenceNo);
    await stopOwnServer(server);
  });
});

for (const [what, damage, recovery] of [
  [
    'a half-written last line',
    (file: string) => appendFileSync(file, '{"sequenceNo":99,"requestId":"0199'),
    /WARN .*Cutting off the incomplete last line/,
  ],
  [
    'a complete last event without its line feed',
    (file: string) => writeFileSync(file, readFileSync(file, 'utf8').replace(/\n$/, '')),
    /WARN .*had no line end; added it/,
  ],
] as const) {
  test(`after a crash that left ${what} in the journal, the next change is kept (B1 regression)`, async ({}, testInfo) => {
    await withOwnServers(testInfo, async (folders, start) => {
      let server = await start();
      const client = await LiveClient.open(server.baseUrl);
      const layer = seededLayer(await client.subscribe());
      const created = await createSymbols(client, layer, 5);
      await client.close();
      await stopOwnServer(server);
      // The damage must hit a journal that holds every event (not one emptied into a snapshot).
      expect(journalLines(folders.dataDir).length - 1).toBe(created.at(-1).sequenceNo);
      damage(join(folders.dataDir, 'journal.jsonl'));

      server = await start();
      // The server's output reaches the log file through a pipe: wait until the line is there.
      await expect.poll(() => readFileSync(server.logFile, 'utf8'), { message: 'the recovery was logged' }).toMatch(recovery);
      expect(ids(await snapshotOf(server))).toEqual(created.map((e: { entityId: string }) => e.entityId).sort());
      const again = await LiveClient.open(server.baseUrl);
      await again.subscribe();
      const [next] = await createSymbols(again, layer, 1);
      await again.close();
      expect(next.sequenceNo).toBe(created.at(-1).sequenceNo + 1);
      await server.stop();

      // Every line is one complete event again, numbered without a gap, ending with a line feed.
      const lines = journalLines(folders.dataDir);
      expect(lines.at(-1), 'the journal ends with a line feed').toBe('');
      const numbers = lines.slice(0, -1).map((line) => JSON.parse(line).sequenceNo);
      expect(numbers).toEqual(numbers.map((_: number, i: number) => i + 1));

      server = await start();
      expect(ids(await snapshotOf(server))).toEqual(
        [...created.map((e: { entityId: string }) => e.entityId), next.entityId].sort(),
      );
      await server.stop();
    });
  });
}

// A data folder written by the M0 server (main before SDK v1, data model 0.1.0): only a journal
// with the Default layer, a second layer and a symbol in each. Recorded by the ITA, 2026-10-12.
const M0_JOURNAL = join(root, 'tests', 'integration', 'fixtures', 'data', 'm0', 'journal.jsonl');
// ECore migrates old data to the current data model: the model package's version (model/package.json,
// SemVer), so a new minor version of the model needs no change here.
const DATA_MODEL: string = JSON.parse(readFileSync(join(root, 'model', 'package.json'), 'utf8')).version;

test('M0 data (data model 0.1.0) is migrated once at the first start: objects get core.general and manual, nothing else changes, the old files are kept', async ({}, testInfo) => {
  await withOwnServers(testInfo, async (folders, start) => {
    const m0 = readFileSync(M0_JOURNAL, 'utf8');
    writeFileSync(join(folders.dataDir, 'journal.jsonl'), m0);
    const events = m0.trim().split('\n').map((line) => JSON.parse(line));
    const states = (type: string) => events.filter((e) => e.entityType === type).map((e) => e.state);
    expect(states('object').every((o) => o.dataType === undefined && o.dataSource === undefined), 'the fixture is M0 data').toBe(true);

    let server = await start();
    await expect
      .poll(() => readFileSync(server.logFile, 'utf8'), { message: 'the migration was logged' })
      // The model README promises a log of how many objects were migrated; the rest of the line may change.
      .toMatch(new RegExp(`Migrated the stored live picture from data model 0\\.1\\.0 to ${DATA_MODEL.replaceAll('.', '\\.')}: 2 objects got the data type core\\.general and the data source manual`));
    const migrated = await snapshotOf(server);
    expect(migrated.sequenceNo).toBe(4);
    expect(migrated.layers).toEqual(expect.arrayContaining(states('layer')));
    expect(migrated.layers).toHaveLength(2);
    expect(migrated.objects).toHaveLength(2);
    for (const before of states('object')) {
      expect(migrated.objects.find((o: { id: string }) => o.id === before.id), before.properties.name).toEqual({ ...before, dataType: 'core.general', dataSource: 'manual' });
    }
    // The M0 files are kept as they were; the new snapshot records the data model; the journal is empty.
    expect(readFileSync(join(folders.dataDir, 'data-model-0.1.0', 'journal.jsonl'), 'utf8')).toBe(m0);
    expect(JSON.parse(readFileSync(join(folders.dataDir, 'snapshot.json'), 'utf8'))).toMatchObject({ dataModel: DATA_MODEL, sequenceNo: 4 });
    expect(journalLines(folders.dataDir).join('')).toBe('');

    // Changes continue in sequence after the migrated picture. The M0 data's "Default" layer stays
    // (T-100 renamed only the layer ECore seeds into an empty View, now "Drawing").
    const client = await LiveClient.open(server.baseUrl);
    await client.subscribe();
    const [next] = await createSymbols(client, migrated.layers.find((l: { name: string }) => l.name === 'Default').id, 1);
    await client.close();
    expect(next.sequenceNo).toBe(5);
    await stopOwnServer(server);

    // The second start loads data of the current model: no migration again, the kept files untouched.
    server = await start();
    const again = await snapshotOf(server);
    expect(again.objects).toEqual(expect.arrayContaining(migrated.objects));
    expect(again.objects).toHaveLength(3);
    expect(readFileSync(server.logFile, 'utf8')).not.toMatch(/Migrated the stored live picture/);
    expect(readFileSync(join(folders.dataDir, 'data-model-0.1.0', 'journal.jsonl'), 'utf8')).toBe(m0);
    await stopOwnServer(server);
  });
});

test('a snapshot of many objects arrives complete, in parts of at most 1 000, and changes continue after it', async ({}, testInfo) => {
  await withOwnServers(testInfo, async (_folders, start) => {
    const server = await start();
    const writer = await LiveClient.open(server.baseUrl);
    const layer = seededLayer(await writer.subscribe());
    const created = await createSymbols(writer, layer, 2500);

    const reader = await LiveClient.open(server.baseUrl);
    const snapshot = await reader.subscribe(30_000);
    expect(snapshot.objects.length).toBe(2500);
    expect(snapshot.parts).toEqual([1000, 1000, 500]);
    expect(ids(snapshot)).toEqual(created.map((e: { entityId: string }) => e.entityId).sort());
    expect(snapshot.endSequenceNo).toBe(snapshot.sequenceNo);
    expect(snapshot.sequenceNo).toBe(created.at(-1).sequenceNo);

    const [next] = await createSymbols(writer, layer, 1);
    await reader.waitForSequence(next.sequenceNo);
    expect(reader.events.map((e: { sequenceNo: number }) => e.sequenceNo)).toEqual([snapshot.sequenceNo + 1]);
    await Promise.all([writer.close(), reader.close()]);
    await stopOwnServer(server);
  });
});
