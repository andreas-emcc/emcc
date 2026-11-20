// Quick run: @always @persistence
import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stopOwnServer, withOwnServers } from '../../lib/own-server';

// T-012, T-025: the object store seeds the "Drawing" layer into an empty store and the file
// persistence journals it; a restart on the same data folder loads it and seeds nothing.
// Each test starts servers of its own on fresh folders.

test.describe.configure({ timeout: 180_000 });

type Event = { sequenceNo: number; entityType: string; operation: string; entityId: string; state?: { name?: string } };

function journal(dataDir: string): Event[] {
  const file = join(dataDir, 'journal.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Event);
}

/** Ids of all layers named "Drawing", in the snapshot (if one was written) and the journal. */
function drawingLayerIds(dataDir: string): Set<string> {
  const ids = new Set<string>();
  const snapshot = join(dataDir, 'snapshot.json');
  if (existsSync(snapshot)) {
    JSON.stringify(JSON.parse(readFileSync(snapshot, 'utf8')), (key, value) => {
      if (value && typeof value === 'object' && value.name === 'Drawing' && 'drawOrder' in value) ids.add(value.id);
      return value;
    });
  }
  for (const event of journal(dataDir)) {
    if (event.entityType === 'layer' && event.operation === 'create' && event.state?.name === 'Drawing') {
      ids.add(event.entityId);
    }
  }
  return ids;
}

test('the Drawing layer is journalled with sequence 1 and not seeded again after a restart', async ({}, testInfo) => {
  await withOwnServers(testInfo, async (folders, start) => {
    const first = await start();
    const health = await fetch(`${first.baseUrl}/api/health`);
    expect(await health.json()).toMatchObject({ status: 'UP', ecore: 'RUNNING' }); // and since M9 RC2 version and manual (the help menu)
    await stopOwnServer(first);

    const events = journal(folders.dataDir);
    expect(events.length, 'journal events after the first run').toBe(1);
    expect(events[0]).toMatchObject({
      sequenceNo: 1,
      entityType: 'layer',
      operation: 'create',
      state: { name: 'Drawing' },
    });
    const seeded = events[0].entityId;

    await stopOwnServer(await start());

    expect([...drawingLayerIds(folders.dataDir)], 'Drawing layers after the restart').toEqual([seeded]);
    const sequence = journal(folders.dataDir).map((event) => event.sequenceNo);
    expect(sequence, 'journal sequence numbers are gapless from 1').toEqual(sequence.map((_, i) => i + 1));
  });
});
