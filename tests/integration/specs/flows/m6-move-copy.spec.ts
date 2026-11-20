// Quick run: @plugin-map-view-2d @plugin-draw-symbols @plugin-ais @plugin-cot @plugin-adsb @tak
import { expect, test, type Page } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createServer, type AddressInfo, type Socket } from 'node:net';
import { applied, watchRequests, type Request, type State } from '../../lib/fields';
import { setLinks } from '../../lib/cot';
import { createLayer, seededLayer, type LiveClient } from '../../lib/live.mjs';
import { colourAround, frameSymbol, FRIEND, HOSTILE, IDENTITY, mapCentre, nextEvent, positionAt, userPause, withM0, type Point } from '../../lib/m0';
import { startTakDouble } from '../../lib/tak-double.mjs';

// Move to layer… and Copy to layer… (T-155, ADR-0053; web/shell/src/actions/layerMoves.ts): the
// shell's two shared object actions in the map's right-click menu, for one object and for a
// selection. A move is one update per object with the new layerId (the id stays); a copy is a create
// of a new, hand-made object (dataSource manual, no observation, ADR-0053 point 3). The layer choice
// leaves out locked layers; a move out of a locked layer is refused with LAYER_LOCKED and a copy out
// of it is applied (point 5); a copy of an AIS vessel does not fade with its data type (CR-0038 point
// 9). Without the permission: specs/keycloak/m6-rights.spec.ts. Each test has a server of its own.
// Without a GPU here: software mode.
//
// SDK 1.5.0 part 5 (ADR-0053 point 8; cot function 31, criterion 45): a CoT track moved with "Move
// to layer…" stays in its new layer after its next report, from its own link and from a second
// one; a new uid still goes to the link's layer; a copy has no external identity and is never
// updated. Through the TAK double. An ADS-B aircraft the same way (adsb criterion 19), from an SBS-1
// stand-in, moved with the shell's change request. gmti's and the simulator's moved tracks:
// m5-sim-sensors.

test.describe.configure({ timeout: 120_000 });

const NEUTRAL = IDENTITY.neutral.colour;
const offset = (p: Point, dx: number, dy: number): Point => ({ x: p.x + dx, y: p.y + dy });

type Placed = { id: string; at: Point; name: string };

/** A framed symbol with a name, at a pixel of the map, waited for until it is drawn. */
async function place(page: Page, live: LiveClient, layerId: string, at: Point, identity: 'friend' | 'hostile' | 'neutral', name: string, data: State = {}): Promise<Placed> {
  const request = frameSymbol(layerId, await positionAt(page, at), identity) as Request;
  Object.assign(request.data!, { properties: { name }, ...data });
  await applied(live, request);
  const colour = identity === 'friend' ? FRIEND : identity === 'hostile' ? HOSTILE : NEUTRAL;
  await expect.poll(() => colourAround(page, at, colour), { timeout: 10_000, message: `${name} is drawn` }).toBeGreaterThan(50);
  return { id: request.entityId, at, name };
}

async function layer(live: LiveClient, name: string): Promise<string> {
  const request = createLayer(name);
  await applied(live, request as unknown as Request);
  return request.entityId;
}

/** The shared selection (`MapView.selection`), sorted. */
function selection(page: Page): Promise<string[]> {
  return page.evaluate(() => [...(window as unknown as { __itaProbe: { mapView: { selection: { value: readonly string[] } } } }).__itaProbe.mapView.selection.value].sort());
}

/** Selects the two with a click and a Ctrl+click (Ctrl, as on Windows and Linux). */
async function selectBoth(page: Page, first: Placed, second: Placed): Promise<void> {
  await page.mouse.click(first.at.x, first.at.y);
  await userPause(page);
  await page.keyboard.down('Control');
  await page.mouse.click(second.at.x, second.at.y);
  await page.keyboard.up('Control');
  await userPause(page);
  await expect.poll(() => selection(page)).toEqual([first.id, second.id].sort());
}

const objects = (n: number) => `${n} object${n === 1 ? '' : 's'}`;

/**
 * Right-clicks the object, chooses "Move to layer…" or "Copy to layer…" and opens the layer choice.
 * Returns the dialog's parts and the layers it offers.
 */
async function layerChoice(page: Page, at: Point, verb: 'Move' | 'Copy', count: number) {
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await page.getByRole('menu', { name: 'Actions' }).getByRole('menuitem', { name: `${verb} to layer…`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `${verb} to layer`, exact: true });
  await expect(dialog).toBeVisible();
  const list = dialog.getByRole('combobox', { name: `${verb} ${objects(count)} to`, exact: true });
  const confirm = dialog.getByRole('button', { name: `${verb} ${objects(count)}`, exact: true });
  await expect(list.locator('option').nth(1), 'the layers are read').toBeAttached();
  const offered = (await list.locator('option').allTextContents()).map((t) => t.trim());
  return { dialog, list, confirm, offered };
}

/** Chooses the layer, confirms and waits until the dialog has closed. */
async function moveOrCopy(page: Page, at: Point, verb: 'Move' | 'Copy', count: number, layerName: string): Promise<string[]> {
  const { dialog, list, confirm, offered } = await layerChoice(page, at, verb, count);
  expect(offered[0], 'nothing chosen at first').toBe('Choose a layer');
  await expect(confirm, 'not before a layer is chosen').toBeDisabled();
  await list.selectOption({ label: layerName });
  await confirm.click();
  await expect(dialog).toBeHidden();
  return offered;
}

/** The shell's notification with this text (web/shell/src/ui/Notifications.tsx). */
function notice(page: Page, text: string) {
  return page.getByRole('list', { name: 'Notifications' }).getByRole('listitem').filter({ hasText: text });
}

async function stored(live: LiveClient, ids: string[]): Promise<State[]> {
  const { found } = await live.getObjects(ids);
  return ids.map((id) => found.find((o: State) => o.id === id));
}

test('one object and a selection: a move is one update that keeps the id, a copy a new hand-made object; both go to the layer chosen, and the shell reports the outcome', async ({
  browser,
}, testInfo) => {
  await withM0(
    testInfo,
    browser,
    async ({ live, snapshot, open }) => {
      let sent: Request[] = [];
      const page = await open((p) => {
        sent = watchRequests(p);
      });
      const drawing = seededLayer(snapshot);
      const bravo = await layer(live, 'ITA Bravo');
      const centre = await mapCentre(page);
      const a = await place(page, live, drawing, offset(centre, -180, -40), 'friend', 'ITA A');
      const b = await place(page, live, drawing, offset(centre, -60, -40), 'hostile', 'ITA B');
      const c = await place(page, live, drawing, offset(centre, -180, 110), 'neutral', 'ITA C');
      const [before] = await stored(live, [a.id]);

      // One object, moved.
      let from = sent.length;
      const offered = await moveOrCopy(page, a.at, 'Move', 1, 'ITA Bravo');
      expect(offered, 'the layers of View').toEqual(expect.arrayContaining(['Drawing', 'ITA Bravo']));
      await expect(notice(page, 'Moved 1 object to ITA Bravo.')).toBeVisible();
      await expect.poll(async () => (await stored(live, [a.id]))[0].layerId, { message: 'A in Bravo' }).toBe(bravo);
      const moveOfA = sent.slice(from);
      expect(moveOfA.map((r) => [r.operation, r.entityId]), 'one update, the same id').toEqual([['update', a.id]]);
      expect(moveOfA[0].data?.layerId).toBe(bravo);
      const [afterMove] = await stored(live, [a.id]);
      expect(afterMove.version, 'one change event').toBe(before.version + 1);
      expect(afterMove.properties?.name).toBe('ITA A');

      // A selection of two (B and C), moved; then selected again and copied back to Drawing.
      await selectBoth(page, b, c);
      from = sent.length;
      await moveOrCopy(page, c.at, 'Move', 2, 'ITA Bravo');
      await expect(notice(page, 'Moved 2 objects to ITA Bravo.')).toBeVisible();
      expect(sent.slice(from).map((r) => [r.operation, r.entityId]).sort(), 'one update each').toEqual([['update', b.id], ['update', c.id]].sort());
      await expect.poll(async () => (await stored(live, [b.id, c.id])).map((o) => o.layerId), { message: 'both in Bravo' }).toEqual([bravo, bravo]);

      await selectBoth(page, b, c);
      from = sent.length;
      await moveOrCopy(page, c.at, 'Copy', 2, 'Drawing');
      await expect(notice(page, 'Copied 2 objects to Drawing.')).toBeVisible();
      const copies = sent.slice(from);
      expect(copies.map((r) => r.operation), 'one create each').toEqual(['create', 'create']);
      await expect.poll(async () => (await stored(live, copies.map((r) => r.entityId))).map((o) => o?.layerId), { message: 'both copies in Drawing' }).toEqual([drawing, drawing]);
      expect((await stored(live, [b.id, c.id])).map((o) => o.layerId), 'the originals stay in Bravo').toEqual([bravo, bravo]);

      // One object (A, alone on its point), copied: a new object; the original stays where it is.
      from = sent.length;
      await moveOrCopy(page, a.at, 'Copy', 1, 'Drawing');
      await expect(notice(page, 'Copied 1 object to Drawing.')).toBeVisible();
      const copyOfA = sent.slice(from);
      expect(copyOfA.map((r) => r.operation), 'one create').toEqual(['create']);
      expect(copyOfA[0].entityId, 'a new id').not.toBe(a.id);
      await expect.poll(async () => (await stored(live, [copyOfA[0].entityId]))[0]?.layerId, { message: 'the copy in Drawing' }).toBe(drawing);
      const [original, copy] = await stored(live, [a.id, copyOfA[0].entityId]);
      expect(original.layerId, 'the original stays in Bravo').toBe(bravo);
      expect(copy).toMatchObject({ type: original.type, dataType: original.dataType, dataSource: 'manual', symbol: original.symbol, geometry: original.geometry, label: original.label, properties: { name: 'ITA A' } });
    },
    { probe: true },
  );
});

test('a locked layer: the choice leaves it out; a move out of it is refused with its layer locked and the object stays, a copy out of it is applied', async ({
  browser,
}, testInfo) => {
  await withM0(
    testInfo,
    browser,
    async ({ live, snapshot, open }) => {
      let sent: Request[] = [];
      const page = await open((p) => {
        sent = watchRequests(p);
      });
      const drawing = seededLayer(snapshot);
      const lockedRequest = createLayer('ITA Locked');
      const lockedState = await applied(live, lockedRequest as unknown as Request);
      const locked = lockedRequest.entityId;
      const centre = await mapCentre(page);
      const x = await place(page, live, drawing, offset(centre, -180, -40), 'friend', 'ITA X');
      const y = await place(page, live, locked, offset(centre, -60, -40), 'hostile', 'ITA Y');
      const { id, version, meta: _meta, ...content } = lockedState;
      await applied(live, { requestId: randomUUID(), entityType: 'layer', operation: 'update', entityId: id, baseVersion: version, data: { ...content, locked: true }, source: { plugin: 'ita-test' } } as unknown as Request);

      // The choice for an object elsewhere: without the locked layer.
      const choice = await layerChoice(page, x.at, 'Move', 1);
      expect(choice.offered).toContain('Drawing');
      expect(choice.offered, 'no locked layer to choose').not.toContain('ITA Locked');
      await choice.dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(choice.dialog).toBeHidden();

      // Out of the locked layer: the move is sent, the store refuses it, and the shell says why.
      let from = sent.length;
      const offered = await moveOrCopy(page, y.at, 'Move', 1, 'Drawing');
      expect(offered, 'not even its own layer').not.toContain('ITA Locked');
      expect(sent.slice(from).map((r) => [r.operation, r.entityId]), 'the update is sent: the store decides').toEqual([['update', y.id]]);
      await expect(notice(page, 'Moved 0 of 1 object to Drawing. 1 could not be moved: ITA Y: its layer is locked.')).toBeVisible();
      expect((await stored(live, [y.id]))[0].layerId, 'Y stays in the locked layer').toBe(locked);

      // A copy out of it changes nothing there: applied.
      from = sent.length;
      await moveOrCopy(page, y.at, 'Copy', 1, 'Drawing');
      await expect(notice(page, 'Copied 1 object to Drawing.')).toBeVisible();
      const [copyOfY] = sent.slice(from);
      expect(copyOfY.operation).toBe('create');
      await expect.poll(async () => (await stored(live, [copyOfY.entityId]))[0]?.layerId, { message: 'the copy in Drawing' }).toBe(drawing);
      expect((await stored(live, [y.id]))[0].layerId, 'the original still in the locked layer').toBe(locked);
    },
    { probe: true },
  );
});

test('a copy of an observed AIS vessel is hand-made: it keeps the data type and its field set, has no observation, and stays in full colour while the vessel fades and goes', async ({
  browser,
}, testInfo) => {
  await withM0(
    testInfo,
    browser,
    async ({ server, live, snapshot, open }) => {
      // Expires 3 s after its observation, faded, removed 5 s later (the settings view's endpoint).
      const behaviour = await fetch(`${server.baseUrl}/api/settings/data-types/ais.vessel`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fadeWhenExpired: true, expiresAfterSeconds: 3, removeAfterExpirySeconds: 5 }),
      });
      expect(behaviour.status).toBe(200);
      let sent: Request[] = [];
      const page = await open((p) => {
        sent = watchRequests(p);
      });
      const bravo = await layer(live, 'ITA Bravo');
      const centre = await mapCentre(page);
      // As ais writes a vessel: its data type and an observation time.
      const vessel = await place(page, live, seededLayer(snapshot), offset(centre, -120, 40), 'hostile', 'ITA VESSEL', { dataType: 'ais.vessel', time: { observed: new Date().toISOString() } });

      const from = sent.length;
      await moveOrCopy(page, vessel.at, 'Copy', 1, 'ITA Bravo');
      await expect(notice(page, 'Copied 1 object to ITA Bravo.')).toBeVisible();
      const [create] = sent.slice(from);
      expect(create.operation).toBe('create');
      expect(create.data?.time?.observed, 'no observation sent').toBeUndefined();

      await live.next(
        (m: { type: string; events?: Array<{ entityId: string; operation: string }> }) => m.type === 'changes' && (m.events ?? []).some((e) => e.entityId === vessel.id && e.operation === 'delete'),
        30_000,
      );
      const [gone, copy] = await stored(live, [vessel.id, create.entityId]);
      expect(gone, 'the vessel faded and went').toBeUndefined();
      expect(copy, 'the copy stays').toBeDefined();
      expect(copy).toMatchObject({ layerId: bravo, dataType: 'ais.vessel', dataSource: 'manual', fieldSets: ['ais.ship'], properties: { name: 'ITA VESSEL' } });
      expect(copy.time?.observed, 'no observation').toBeUndefined();
      expect(await colourAround(page, vessel.at, HOSTILE), 'the copy in full colour where the vessel was').toBeGreaterThan(50);
    },
    { probe: true },
  );
});

type Event = { entityType: string; entityId: string; operation: string; state: State | null; by?: { plugin?: string } };

/** The live client's newest state of the CoT object with this uid. */
function cotObject(live: LiveClient, uid: string): State | undefined {
  return (live.events as Event[]).filter((e) => e.state?.meta?.externalRef?.system === 'cot' && e.state.meta.externalRef.id === uid).at(-1)?.state ?? undefined;
}

test('a moved CoT track stays (part 5; cot criterion 45): moved with "Move to layer…", its next report from its link and one from a second link update it in its new layer; a new uid goes to the link\'s layer; its copy is never updated', async ({
  browser,
}, testInfo) => {
  const north = await startTakDouble();
  const south = await startTakDouble();
  try {
    await withM0(
      testInfo,
      browser,
      async ({ server, live, snapshot, open }) => {
        const page = await open();
        const bravo = await layer(live, 'ITA Bravo');
        const drawing = seededLayer(snapshot);
        await setLinks(server, [{ name: 'tak-north', port: north.port }, { name: 'tak-south', port: south.port }]);
        await north.waitForConnections(1);
        await south.waitForConnections(1);
        const centre = await mapCentre(page);
        const at = [offset(centre, -180, -40), offset(centre, -60, -40), offset(centre, -180, 110), offset(centre, -60, 110)];
        const where: Array<[number, number]> = [];
        for (const p of at) where.push(await positionAt(page, p));
        const t = Date.now();
        const report = (double: typeof north, uid: string, i: number, after: number) => double.send({ uid, lon: where[i][0], lat: where[i][1], time: t + after, callsign: uid.toUpperCase() });
        const at_ = (e: Event, i: number) => Math.abs(e.state?.geometry.coordinates[0] - where[i][0]) < 1e-6 && Math.abs(e.state?.geometry.coordinates[1] - where[i][1]) < 1e-6;

        // A track from tak-north, in its link's layer, on the map.
        report(north, 'ita-move-1', 0, 0);
        const first = await nextEvent(live, (e) => e.state?.meta?.externalRef?.id === 'ita-move-1' && e.operation === 'create', 20_000);
        const linkLayer = first.state.layerId as string;
        expect(linkLayer, 'not one of the test\'s layers').not.toBe(bravo);
        await expect.poll(() => colourAround(page, at[0], FRIEND), { timeout: 10_000, message: 'the track is drawn' }).toBeGreaterThan(50);

        // Moved by the user: the shell's one update.
        await moveOrCopy(page, at[0], 'Move', 1, 'ITA Bravo');
        await expect(notice(page, 'Moved 1 object to ITA Bravo.')).toBeVisible();
        await expect.poll(() => cotObject(live, 'ita-move-1')?.layerId, { message: 'in Bravo' }).toBe(bravo);

        // Its next report from tak-north: updated in Bravo, at the new place.
        report(north, 'ita-move-1', 1, 2_000);
        const next = await nextEvent(live, (e) => e.entityId === first.entityId && e.operation === 'update' && e.by?.plugin === 'cot' && at_(e, 1), 20_000);
        expect(next.state.layerId, 'its next report keeps it in Bravo').toBe(bravo);
        await expect.poll(() => colourAround(page, at[1], FRIEND), { timeout: 10_000, message: 'drawn at its new place' }).toBeGreaterThan(50);

        // A report from the second link (function 5): still in Bravo.
        report(south, 'ita-move-1', 2, 4_000);
        const fromSouth = await nextEvent(live, (e) => e.entityId === first.entityId && e.operation === 'update' && e.by?.plugin === 'cot' && at_(e, 2), 20_000);
        expect(fromSouth.state.layerId, 'a report from tak-south keeps it there too').toBe(bravo);

        // A new uid: the link's layer, as before.
        report(north, 'ita-move-2', 3, 4_000);
        const fresh = await nextEvent(live, (e) => e.state?.meta?.externalRef?.id === 'ita-move-2' && e.operation === 'create', 20_000);
        expect(fresh.state.layerId, 'a new track goes to the link\'s layer').toBe(linkLayer);

        // A copy into Drawing: no external identity, so the next report leaves it as copied.
        await expect.poll(() => colourAround(page, at[2], FRIEND), { timeout: 10_000, message: 'drawn where tak-south put it' }).toBeGreaterThan(50);
        await moveOrCopy(page, at[2], 'Copy', 1, 'Drawing');
        await expect(notice(page, 'Copied 1 object to Drawing.')).toBeVisible();
        const copied = await nextEvent(live, (e) => e.operation === 'create' && e.state?.layerId === drawing, 10_000);
        expect(copied.state.meta?.externalRef, 'a copy has no external identity').toBeUndefined();
        report(north, 'ita-move-1', 0, 6_000);
        await nextEvent(live, (e) => e.entityId === first.entityId && e.operation === 'update' && at_(e, 0), 20_000);
        expect(cotObject(live, 'ita-move-1')?.layerId, 'the original goes on in Bravo').toBe(bravo);
        const [copy] = await stored(live, [copied.entityId]);
        expect(copy.version, 'the copy is not updated').toBe(copied.state.version);
        expect(copy.geometry.coordinates, 'the copy stays where it was copied').toEqual(copied.state.geometry.coordinates);
        expect(copy.layerId).toBe(drawing);
      },
      { probe: true },
    );
  } finally {
    await north.close();
    await south.close();
  }
});

/**
 * A stand-in for a decoder's SBS-1 output (dump1090's port 30003): adsb connects to it as a client,
 * and `send` writes BaseStation lines to every connection.
 */
async function startSbsDecoder(): Promise<{ port: number; connections: () => number; send: (lines: string[]) => void; close: () => Promise<void> }> {
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    connections: () => sockets.size,
    send: (lines) => {
      for (const s of sockets) s.write(lines.map((l) => `${l}\r\n`).join(''));
    },
    close: async () => {
      for (const s of sockets) s.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** An SBS-1 airborne position (MSG,3): 22 fields, latitude before longitude as the format has it. */
function sbsPosition(icao: string, [lon, lat]: [number, number], when = new Date()): string {
  const date = when.toISOString().slice(0, 10).replace(/-/g, '/');
  const time = when.toISOString().slice(11, 23);
  return ['MSG', '3', '1', '1', icao, '1', date, time, date, time, '', '37000', '', '', lat.toFixed(5), lon.toFixed(5), '', '', '0', '0', '0', '0'].join(',');
}

test('a moved ADS-B aircraft stays (part 5; adsb criterion 19): an aircraft a user moved into another layer is updated there by its next positions, a new aircraft goes to the link\'s layer, and a copy is not updated', async ({ browser }, testInfo) => {
  const decoder = await startSbsDecoder();
  try {
    await withM0(testInfo, browser, async ({ server, live }) => {
      const url = `${server.baseUrl}/api/settings/plugins/adsb`;
      const values = (await (await fetch(url)).json()).values;
      const put = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, links: [{ name: 'ita-decoder', host: '127.0.0.1', port: decoder.port }] }) });
      expect(put.status, `adsb settings: ${await put.clone().text()}`).toBe(200);
      await expect.poll(() => decoder.connections(), { timeout: 20_000, message: 'adsb connects to the decoder' }).toBeGreaterThan(0);
      const bravo = await layer(live, 'ITA Bravo');
      const copies = await layer(live, 'ITA Copies');
      const ofIcao = (icao: string) => (live.events as Event[]).filter((e) => e.state?.meta?.externalRef?.id?.toUpperCase?.().includes(icao));
      // Latitude ≠ longitude (ADR-0007); each position a little further east.
      const at = (i: number): [number, number] => [15.6 + i * 0.01, 58.4];

      decoder.send([sbsPosition('4CA2D6', at(0))]);
      await expect.poll(() => ofIcao('4CA2D6').length, { timeout: 20_000, message: 'the aircraft arrives' }).toBeGreaterThan(0);
      const aircraft = ofIcao('4CA2D6')[0].state!;
      const linkLayer = aircraft.layerId as string;
      expect(aircraft.geometry.coordinates[0]).toBeCloseTo(at(0)[0], 4);
      expect(aircraft.geometry.coordinates[1]).toBeCloseTo(at(0)[1], 4);

      // Moved by a user (as the shell sends it), then copied.
      const latest = () => ofIcao('4CA2D6').at(-1)!.state!;
      const { id, version, meta: _meta, ...data } = latest();
      const moved = await applied(live, { requestId: randomUUID(), entityType: 'object', operation: 'update', entityId: id, baseVersion: version, data: { ...data, layerId: bravo }, source: { plugin: 'ita-test' } } as unknown as Request);
      const { id: _id, version: _v, meta: _m, time: _t, ...content } = moved;
      const copy = await applied(live, { requestId: randomUUID(), entityType: 'object', operation: 'create', entityId: randomUUID(), data: { ...content, layerId: copies, dataSource: 'manual' }, source: { plugin: 'ita-test' } } as unknown as Request);

      // Its next positions: updated in Bravo, by adsb.
      for (let i = 1; i <= 3; i++) {
        decoder.send([sbsPosition('4CA2D6', at(i))]);
        await expect.poll(() => Math.abs(latest().geometry.coordinates[0] - at(i)[0]) < 1e-4, { timeout: 20_000, message: `position ${i}` }).toBe(true);
      }
      const after = (live.events as Event[]).filter((e) => e.entityId === id && e.by?.plugin === 'adsb' && (e.state?.version ?? 0) > moved.version);
      expect(after.length, 'adsb\'s updates after the move').toBeGreaterThanOrEqual(1);
      expect([...new Set(after.map((e) => e.state?.layerId))], 'each one in Bravo').toEqual([bravo]);

      // A new aircraft: the link's layer.
      decoder.send([sbsPosition('4CA2D7', at(5))]);
      await expect.poll(() => ofIcao('4CA2D7').length, { timeout: 20_000, message: 'a second aircraft' }).toBeGreaterThan(0);
      expect(ofIcao('4CA2D7')[0].state!.layerId, 'a new aircraft goes to the link\'s layer').toBe(linkLayer);

      const [copyNow] = await stored(live, [copy.id]);
      expect(copyNow.version, 'the copy is not updated').toBe(copy.version);
      expect(copyNow.geometry.coordinates).toEqual(copy.geometry.coordinates);
      expect(copyNow.meta?.externalRef, 'no external identity').toBeUndefined();
    });
  } finally {
    await decoder.close();
  }
});
