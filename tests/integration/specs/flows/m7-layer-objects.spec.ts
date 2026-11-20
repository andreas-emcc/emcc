// Quick run: @settings
import { expect, test, type Page } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';
import { createLayer, createSymbol, seededLayer, type LiveClient } from '../../lib/live.mjs';
import { settle, withM0 } from '../../lib/m0';

// T-175 (owner, QE and QF A, 2026-11-11; web/README.md, Settings › Layers): in the Settings
// workspace each layer's card lists its objects ("Show objects", 50 a page in the order of creation,
// Previous, Next, Refresh, not live) and empties the layer ("Delete all objects": a question with the
// number, then every object deleted as core-shell; objects added while it runs stay; off on a locked
// and on an empty layer). Without objects.edit it is not shown: specs/keycloak/layer-objects.spec.ts.
// Every test has a server of its own.

test.describe.configure({ timeout: 180_000 });

type Request = ReturnType<typeof createSymbol>;
type State = { id: string; version: number; meta?: unknown; [key: string]: unknown };

/** Sends the creates 50 at a time (the server takes 100 waiting per session); each must be applied. Resolves with the events' sequence numbers. */
async function createAll(live: LiveClient, requests: Request[]): Promise<number[]> {
  const sequence: number[] = [];
  for (let start = 0; start < requests.length; start += 50) {
    const outcomes = await Promise.all(requests.slice(start, start + 50).map((r) => live.change(r)));
    for (const o of outcomes) {
      expect(o.outcome, JSON.stringify(o.rejection ?? '')).toBe('applied');
      sequence.push(o.event.sequenceNo);
    }
  }
  return sequence;
}

/** A UUID v7 for a time in ms (RFC 9562): its text sorts by the time. */
function uuidV7(ms: number): string {
  const time = ms.toString(16).padStart(12, '0');
  const random = randomBytes(10).toString('hex');
  const variant = ((parseInt(random[3], 16) & 0x3) | 0x8).toString(16);
  return `${time.slice(0, 8)}-${time.slice(8)}-7${random.slice(0, 3)}-${variant}${random.slice(4, 7)}-${random.slice(8, 20)}`;
}

let clock = Date.now();

/**
 * A symbol in the layer with a name, as the list shows it. Its id is a UUID v7, one ms after the one
 * before, as the shell makes them: the list's order is the ids' order, the order of creation for v7
 * ids (server/README.md, query-layer).
 */
function named(layer: string, index: number, name?: string): Request {
  return { ...createSymbol(layer, index, name === undefined ? {} : { name }), entityId: uuidV7(clock++) };
}

/** The change requests a page sends over its live picture connection. */
function watchRequests(page: Page): Array<{ entityType: string; operation: string; entityId: string; source?: { plugin?: string } }> {
  const sent: any[] = [];
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

const ita = (i: number) => `ITA ${String(i).padStart(3, '0')}`;

async function layersEntry(page: Page) {
  await page.goto('/#settings/layers');
  await expect(page.getByRole('heading', { name: 'Layers', exact: true, level: 2 })).toBeVisible();
}

const card = (page: Page, layer: string) => page.getByRole('article', { name: layer, exact: true });
const notifications = (page: Page) => page.getByRole('list', { name: 'Notifications' });

test('Settings › Layers, "Show objects" (T-175): a layer\'s objects in pages of 50 in the order of creation, with name (else id), data type, source and classification (its policy when not the layer\'s); Previous and Next; not live: Refresh reads the page again', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ live, snapshot, open }) => {
    const layer = seededLayer(snapshot);
    // 120 objects: ITA 001 to ITA 120, except the 7th, another policy's, and the 60th, without a name.
    const requests = Array.from({ length: 120 }, (_, i) => named(layer, i, i === 59 ? undefined : ita(i + 1)));
    requests[6].data.label = { policyIdentifier: { name: 'EU' }, classification: 'RESTRICTED' };
    await createAll(live, requests);
    const names = requests.map((r, i) => (i === 59 ? r.entityId : ita(i + 1)));

    const page = await open();
    await layersEntry(page);
    const drawing = card(page, 'Drawing');
    await expect(drawing).toContainText('NATO UNCLASSIFIED · 120 objects');
    const show = drawing.getByRole('button', { name: 'Show objects', exact: true });
    await expect(show).toHaveAttribute('aria-expanded', 'false');
    await show.click();
    await expect(drawing.getByRole('button', { name: 'Hide objects', exact: true })).toHaveAttribute('aria-expanded', 'true');

    const table = drawing.getByRole('table', { name: 'Objects of Drawing', exact: true });
    const previous = drawing.getByRole('button', { name: 'Previous', exact: true });
    const next = drawing.getByRole('button', { name: 'Next', exact: true });
    const refresh = drawing.getByRole('button', { name: 'Refresh', exact: true });
    const shown = () => table.getByRole('rowheader').allTextContents();
    const pageOf = async (from: number, to: number, total: number) => {
      await expect(drawing).toContainText(`Objects ${from}–${to} of ${total}`);
      await expect.poll(shown, { message: `objects ${from} to ${to}, in the order of creation` }).toEqual(names.slice(from - 1, to));
    };

    await pageOf(1, 50, 120);
    await expect(table.getByRole('columnheader')).toHaveText(['Name', 'Data type', 'Source', 'Classification']);
    await expect(table.getByRole('row', { name: ita(1) }).getByRole('cell')).toHaveText(['core.general', 'manual', 'UNCLASSIFIED']);
    await expect(table.getByRole('row', { name: ita(7) }).getByRole('cell'), 'another policy: named').toHaveText(['core.general', 'manual', 'EU RESTRICTED']);
    await expect(previous, 'on the first page').toBeDisabled();
    await expect(next).toBeEnabled();

    await next.click();
    await pageOf(51, 100, 120);
    await expect(table.getByRole('row', { name: requests[59].entityId }), 'without a name: its id').toHaveCount(1);
    await next.click();
    await pageOf(101, 120, 120);
    await expect(next, 'on the last page').toBeDisabled();
    await previous.click();
    await pageOf(51, 100, 120);

    // Not live: a new object shows in the card's count (the live layers channel), not in the list until Refresh.
    const late = named(layer, 120, ita(121));
    await createAll(live, [late]);
    names.push(ita(121));
    await expect(drawing).toContainText('NATO UNCLASSIFIED · 121 objects');
    await expect(drawing, 'the list as read').toContainText('Objects 51–100 of 120');
    await refresh.click();
    await pageOf(51, 100, 121);
    await next.click();
    await pageOf(101, 121, 121);

    await drawing.getByRole('button', { name: 'Hide objects', exact: true }).click();
    await expect(table).toHaveCount(0);
    await expect(show).toHaveAttribute('aria-expanded', 'false');
  });
});

test('Settings › Layers, "Delete all objects" (T-175): asks "Delete all N objects in <layer>? This cannot be undone."; Cancel deletes nothing; yes deletes every object of the layer and nothing else, in both browsers; objects added while it runs stay; off on an empty and on a locked layer; a lock set while the question is open sends nothing', async ({ browser }, testInfo) => {
  await withM0(testInfo, browser, async ({ live, snapshot, open }) => {
    const layer = seededLayer(snapshot);
    const doomed = Array.from({ length: 300 }, (_, i) => named(layer, i, `Doomed ${i + 1}`));
    await createAll(live, doomed);
    // Another layer, with two objects that stay, and one for settle()'s probes.
    const otherLayer = createLayer('ITA other', { drawOrder: 5 });
    const otherCreated = await live.change(otherLayer);
    expect(otherCreated.outcome).toBe('applied');
    const probes = createLayer('ITA probes', { drawOrder: 6 });
    expect((await live.change(probes)).outcome).toBe('applied');
    const kept = [named(otherLayer.entityId, 0, 'Kept 1'), named(otherLayer.entityId, 1, 'Kept 2')];
    await createAll(live, kept);
    let since = (await settle(live, probes.entityId)).length;

    let sent: ReturnType<typeof watchRequests> = [];
    const page = await open((p) => {
      sent = watchRequests(p);
    });
    const second = await open();
    for (const p of [page, second]) await layersEntry(p);
    const drawing = card(page, 'Drawing');
    await expect(drawing).toContainText('300 objects');
    await expect(drawing, 'the card\'s note').toContainText("Deleting all objects also deletes a data link's live tracks; they come back with their next report.");
    const empty = drawing.getByRole('button', { name: 'Delete all objects', exact: true });
    const question = page.getByRole('alertdialog', { name: 'Delete all objects', exact: true });

    // Cancel: nothing deleted.
    await empty.click();
    await expect(question).toContainText('Delete all 300 objects in Drawing? This cannot be undone.');
    await question.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(question).toBeHidden();
    let events = await settle(live, probes.entityId);
    expect(events.slice(since).filter((e) => e.operation === 'delete'), 'nothing deleted after Cancel').toEqual([]);
    since = events.length;

    // Yes: the reading, then the deletes; three objects added once the deletes have started stay.
    await empty.click();
    await expect(question).toContainText('Delete all 300 objects in Drawing? This cannot be undone.');
    await question.getByRole('button', { name: 'Delete all objects', exact: true }).click();
    await expect(notifications(page)).toContainText('Deleting the objects of Drawing:', { timeout: 30_000 });
    const added = [named(layer, 400, 'Added 1'), named(layer, 401, 'Added 2'), named(layer, 402, 'Added 3')];
    const addedAt = await createAll(live, added);
    await expect(notifications(page)).toContainText('Deleted 300 objects in Drawing.', { timeout: 60_000 });

    events = (await settle(live, probes.entityId)).slice(since);
    const deletes = events.filter((e) => e.operation === 'delete');
    expect(deletes.map((e) => e.entityId).sort(), 'exactly the 300 there when it was asked').toEqual(doomed.map((r) => r.entityId).sort());
    const asked = sent.filter((r) => r.operation === 'delete');
    expect(asked.map((r) => r.entityId).sort(), 'one delete request each').toEqual(doomed.map((r) => r.entityId).sort());
    expect(asked.every((r) => r.entityType === 'object' && r.source?.plugin === 'core-shell'), 'as core-shell').toBe(true);
    const lastDelete = Math.max(...deletes.map((e) => e.sequenceNo));
    testInfo.annotations.push({ type: 'added while it ran', description: `the three applied at ${addedAt.join(', ')}; deletes from ${Math.min(...deletes.map((e) => e.sequenceNo))} to ${lastDelete}` });
    expect(Math.min(...addedAt), 'the three were added before the last delete, while it ran').toBeLessThan(lastDelete);
    for (const p of [page, second]) {
      await expect(card(p, 'Drawing'), 'the three added stay').toContainText('NATO UNCLASSIFIED · 3 objects');
      await expect(card(p, 'ITA other'), 'the other layer untouched').toContainText('NATO UNCLASSIFIED · 2 objects');
    }
    await drawing.getByRole('button', { name: 'Show objects', exact: true }).click();
    await expect.poll(() => drawing.getByRole('table', { name: 'Objects of Drawing', exact: true }).getByRole('rowheader').allTextContents()).toEqual(['Added 1', 'Added 2', 'Added 3']);

    // Emptied again: then the layer is empty and the button is off, in both browsers.
    await empty.click();
    await expect(question).toContainText('Delete all 3 objects in Drawing? This cannot be undone.');
    await question.getByRole('button', { name: 'Delete all objects', exact: true }).click();
    await expect(notifications(page)).toContainText('Deleted 3 objects in Drawing.');
    for (const p of [page, second]) {
      await expect(card(p, 'Drawing')).toContainText('NATO UNCLASSIFIED · 0 objects');
      await expect(card(p, 'Drawing').getByRole('button', { name: 'Delete all objects', exact: true }), 'off on an empty layer').toBeDisabled();
    }
    await expect(drawing, 'the open list read again').toContainText('The layer has no objects.');

    // A lock set while the question is open: nothing is sent.
    const other = card(page, 'ITA other');
    const otherEmpty = other.getByRole('button', { name: 'Delete all objects', exact: true });
    await otherEmpty.click();
    await expect(question).toContainText('Delete all 2 objects in ITA other? This cannot be undone.');
    since = (await settle(live, probes.entityId)).length;
    const { id, version, meta: _meta, ...data } = otherCreated.event.state as State;
    const locked = await live.change({ requestId: randomUUID(), entityType: 'layer', operation: 'update', entityId: id, baseVersion: version, data: { ...data, locked: true }, source: { plugin: 'ita-test' } });
    expect(locked.outcome, JSON.stringify(locked.rejection ?? '')).toBe('applied');
    await expect(other).toContainText('This layer is locked. Unlock it in the Layers panel to change its classification or raise or delete its objects.');
    await question.getByRole('button', { name: 'Delete all objects', exact: true }).click();
    await expect(notifications(page)).toContainText('The layer ITA other is locked now, so nothing was deleted.');
    events = (await settle(live, probes.entityId)).slice(since);
    expect(events.filter((e) => e.operation === 'delete'), 'nothing deleted in the locked layer').toEqual([]);
    for (const p of [page, second]) {
      await expect(card(p, 'ITA other').getByRole('button', { name: 'Delete all objects', exact: true }), 'off on a locked layer').toBeDisabled();
      await expect(card(p, 'ITA other')).toContainText('NATO UNCLASSIFIED · 2 objects');
    }
    // A locked layer still lists its objects.
    await other.getByRole('button', { name: 'Show objects', exact: true }).click();
    await expect.poll(() => other.getByRole('table', { name: 'Objects of ITA other', exact: true }).getByRole('rowheader').allTextContents()).toEqual(['Kept 1', 'Kept 2']);
  });
});
