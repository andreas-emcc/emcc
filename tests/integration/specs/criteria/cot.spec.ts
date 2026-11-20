// Quick run: @plugin-cot @tak
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { byUid, cotStatus, setLinks, linkStatus, type CotObject } from '../../lib/cot';
import { LiveClient } from '../../lib/live.mjs';
import { colourAround, drag, expectNear, FRIEND, HIGHLIGHT, mapCentre, pixelsAround, positionAt, withM0, type LonLat, type Point } from '../../lib/m0';
import { stopOwnServer, withOwnServers, type OwnServer } from '../../lib/own-server';
import { installPlugins } from '../../lib/plugins.mjs';
import { cotEvent, hostile, startTakDouble } from '../../lib/tak-double.mjs';
import { listenerCredentialArgs, testCertificates } from '../../lib/test-certs.mjs';

// The cot plugin's acceptance criteria (docs/plugins/briefs/cot.md, T-040) against the ITA's TAK
// test double (lib/tak-double.mjs, T-043), each on a server of its own. Incoming links (M3,
// T-084 part 1; M1's streams) are set at runtime through the plugin's settings. Criteria 11 and
// 13 are checked in the plugin's own build; criterion 10 (the load) is in the performance suite
// (specs/performance/cot.spec.ts).

test.describe.configure({ timeout: 180_000 });

type Event = { entityType: string; entityId: string; operation: string; sequenceNo: number; state: CotObject | null; by?: { plugin?: string; system?: string } };

/** The change events for a CoT uid that a whole-picture client has received. */
function eventsOf(client: LiveClient, uid: string): Event[] {
  return (client.events as Event[]).filter((e) => e.state?.meta?.externalRef?.system === 'cot' && e.state.meta.externalRef.id === uid);
}

async function lastOf(client: LiveClient, uid: string, count = 1): Promise<Event> {
  await expect.poll(() => eventsOf(client, uid).length, { timeout: 20_000, message: `${count} event(s) for ${uid}` }).toBeGreaterThanOrEqual(count);
  return eventsOf(client, uid).at(-1)!;
}

/** A server with only the cot plugin, and a whole-picture client. */
async function withCot(
  testInfo: Parameters<typeof withOwnServers>[0],
  body: (start: (extra?: string[]) => Promise<{ server: OwnServer; client: LiveClient }>) => Promise<void>,
) {
  await withOwnServers(testInfo, async (folders, start) => {
    installPlugins(folders.pluginsDir, { only: ['cot'] });
    const clients: LiveClient[] = [];
    try {
      await body(async (extra = []) => {
        const server = await start(extra);
        const client = await LiveClient.open(server.baseUrl);
        await client.subscribe();
        clients.push(client);
        return { server, client };
      });
    } finally {
      await Promise.all(clients.map((c) => c.close()));
    }
  });
}

const near = (a: number[], b: number[]) => expect(Math.hypot(a[0] - b[0], a[1] - b[1])).toBeLessThan(1e-6);

/** Pixels around a point that differ from the square's most common colour (the background). */
async function drawnPixels(page: Parameters<typeof pixelsAround>[0], at: Point): Promise<number> {
  const image = await pixelsAround(page, at);
  const all: number[][] = [];
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) all.push(image.pixel(x, y));
  const counts = new Map<string, number>();
  for (const p of all) counts.set(p.slice(0, 3).join(','), (counts.get(p.slice(0, 3).join(',')) ?? 0) + 1);
  const [r, g, b] = [...counts.entries()].sort((x, y) => y[1] - x[1])[0][0].split(',').map(Number);
  return all.filter((p) => Math.abs(p[0] - r) + Math.abs(p[1] - g) + Math.abs(p[2] - b) > 30).length;
}

test('criterion 12: without a link the plugin starts, does nothing and reports "no link configured"', async ({}, testInfo) => {
  await withCot(testInfo, async (start) => {
    const { server, client } = await start();
    await expect.poll(() => cotStatus(server)).toEqual({ state: 'OK', detail: 'no link configured' });
    const reader = await LiveClient.open(server.baseUrl);
    const snapshot = await reader.subscribe();
    await reader.close();
    expect(snapshot.layers.map((l: { name: string }) => l.name), 'no link layer made').toEqual(['Drawing']);
    expect(snapshot.objects, 'nothing created').toEqual([]);
    await client.close();
    await stopOwnServer(server);
  });
});

test('criterion 1: an atom from TAK appears in every browser within 2 s, in place, with its symbol, callsign, data type, data source and external identity; the plugin announces itself (function 9)', async ({
  browser,
}, testInfo) => {
  const double = await startTakDouble();
  try {
    await withM0(testInfo, browser, async ({ server, live, open }) => {
      const pages = [await open(), await open()];
      const centre = await mapCentre(pages[0]);
      const [lon, lat] = await positionAt(pages[0], centre);
      await setLinks(server, [{ name: 'tak-north', port: double.port }]);
      await double.waitForConnections(1);
      await expect.poll(() => double.receivedText(), { message: 'the presence event' }).toMatch(/type="t-x-c-t"[\s\S]*callsign="emcc"/); // the product's name as users see it (T-134); the uid stays emc2-<callsign>

      const sent = Date.now();
      double.send({ uid: 'ita-alpha', type: 'a-f-G-U-C-I', lon, lat, callsign: 'ALPHA 1', remarks: 'first report' });
      const shown: number[] = [];
      for (const page of pages) {
        while ((await colourAround(page, centre, FRIEND)) < 50) expect(Date.now() - sent, 'shown in the browser').toBeLessThan(2_000);
        shown.push(Date.now() - sent);
      }
      testInfo.annotations.push({ type: 'criterion 1', description: `shown after ${shown.join(' and ')} ms (upper bounds, with the screenshots)` });
      for (const ms of shown) expect(ms, 'shown in every browser within 2 s').toBeLessThan(2_000);

      const created = await lastOf(live, 'ita-alpha');
      const object = created.state!;
      near(object.geometry.coordinates, [lon, lat]);
      expect(object.symbol).toMatchObject({ sidc: 'SFGPUCI--------' });
      expect(object.symbol.modifiers?.uniqueDesignation).toBe('ALPHA 1');
      expect(object.properties).toMatchObject({ name: 'ALPHA 1', description: 'first report' });
      expect(object).toMatchObject({ dataType: 'cot.cot', dataSource: 'tak-north' });
      expect(object.meta.externalRef).toEqual({ system: 'cot', id: 'ita-alpha' });
    });
  } finally {
    await double.close();
  }
});

test('criteria 2 and 3: repeated events move the same object, an older one is ignored, and after a restart no second object is made', async ({}, testInfo) => {
  const double = await startTakDouble();
  try {
    await withCot(testInfo, async (start) => {
      let { server, client } = await start();
      await setLinks(server, [{ name: 'tak-north', port: double.port }]);
      await double.waitForConnections(1);
      const t = Date.parse('2026-10-13T08:00:00Z');
      double.send({ uid: 'ita-bravo', lon: 18.1, lat: 59.1, time: t });
      const created = await lastOf(client, 'ita-bravo');
      double.send({ uid: 'ita-bravo', lon: 18.2, lat: 59.2, time: t + 2_000 });
      await lastOf(client, 'ita-bravo', 2);
      // An older event than the last applied, alone (two events of one uid in one burst are coalesced,
      // the latest winning): it is counted and dropped.
      double.send({ uid: 'ita-bravo', lon: 18.3, lat: 59.3, time: t + 1_000 });
      await expect.poll(() => linkStatus(server, 'tak-north'), { timeout: 10_000 }).toMatch(/dropped 1 \(older 1\)/);
      double.send({ uid: 'ita-bravo', lon: 18.4, lat: 59.4, time: t + 3_000 });
      const last = await lastOf(client, 'ita-bravo', 3);
      const moves = eventsOf(client, 'ita-bravo');
      expect(new Set(moves.map((e) => e.entityId)), 'one object').toEqual(new Set([created.entityId]));
      expect(moves.map((e) => e.operation)).toEqual(['create', 'update', 'update']);
      expect(moves.map((e) => e.state!.geometry.coordinates[0]), 'the older event never applied').toEqual([18.1, 18.2, 18.4]);
      near(last.state!.geometry.coordinates, [18.4, 59.4]);
      await client.close();
      await stopOwnServer(server);

      // After a restart the plugin finds its object again: the next event updates it.
      ({ server, client } = await start());
      await double.waitForConnections(2);
      double.send({ uid: 'ita-bravo', lon: 18.5, lat: 59.5, time: t + 4_000 });
      const again = await lastOf(client, 'ita-bravo');
      expect(again).toMatchObject({ operation: 'update', entityId: created.entityId });
      const snapshot = await (async () => {
        const reader = await LiveClient.open(server.baseUrl);
        const s = await reader.subscribe();
        await reader.close();
        return s;
      })();
      expect(byUid(snapshot.objects as CotObject[], 'ita-bravo'), 'still one object').toHaveLength(1);
      await stopOwnServer(server);
    });
  } finally {
    await double.close();
  }
});

test('criterion 4: unmapped CoT is kept in the cot extension, and stays unchanged when a user drags the object in the browser', async ({
  browser,
}, testInfo) => {
  const double = await startTakDouble();
  try {
    await withM0(testInfo, browser, async ({ server, live, open }) => {
      const page = await open();
      const at = await mapCentre(page);
      const [lon, lat] = await positionAt(page, at);
      const to: Point = { x: at.x + 120, y: at.y + 60 };
      const dropAt = await positionAt(page, to);
      await setLinks(server, [{ name: 'tak-north', port: double.port }]);
      await double.waitForConnections(1);
      const detail = '<__ita mark="kept"><inner>text &amp; more</inner></__ita>';
      double.send({ uid: 'ita-charlie', lon, lat, how: 'h-e', ce: 12.5, le: 7.25, qos: '1-r-c', detail });
      const created = await lastOf(live, 'ita-charlie');
      const cot = created.state!.extensions!.cot;
      expect(cot).toMatchObject({ how: 'h-e', qos: '1-r-c' });
      expect([String(cot.ce), String(cot.le)], 'ce and le as sent').toEqual(['12.5', '7.25']);
      expect(String(cot.detail)).toContain(detail);
      testInfo.annotations.push({ type: 'cot extension', description: JSON.stringify(cot) });

      // A user selects the symbol and drags it with draw-symbols.
      await expect.poll(() => colourAround(page, at, FRIEND), { timeout: 10_000 }).toBeGreaterThan(50);
      await page.mouse.click(at.x, at.y);
      await expect.poll(() => colourAround(page, at, HIGHLIGHT, 32), { timeout: 10_000 }).toBeGreaterThan(20);
      await drag(page, at, to);
      const moved = await lastOf(live, 'ita-charlie', 2);
      expect(moved.operation).toBe('update');
      expectNear(moved.state!.geometry.coordinates, dropAt as LonLat);
      expect(moved.state!.extensions!.cot, 'the extension is forwarded untouched (ADR-0018)').toEqual(cot);
    });
  } finally {
    await double.close();
  }
});

test("criterion 5: @time, @start and @stale become the time attributes; after the expiry the symbol is drawn faded, and ECore removes it after the data type's removal time", async ({
  browser,
}, testInfo) => {
  const double = await startTakDouble();
  try {
    await withM0(testInfo, browser, async ({ server, live, open }) => {
      const page = await open();
      const at = await mapCentre(page);
      const [lon, lat] = await positionAt(page, at);
      // The plugin declares cot.cot's defaults: faded from the expiry, removed 10 minutes after it.
      const declared = (await (await fetch(`${server.baseUrl}/api/config`)).json()).dataTypes.find((t: { id: string }) => t.id === 'cot.cot');
      expect(declared.defaults).toEqual({ fadeWhenExpired: true, removeAfterExpirySeconds: 600 });
      // Removed 4 s after its expiry instead (the complete behaviour), through the settings view's endpoint.
      const behaviour = await fetch(`${server.baseUrl}/api/settings/data-types/cot.cot`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fadeWhenExpired: true, removeAfterExpirySeconds: 4 }),
      });
      expect(behaviour.status).toBe(200);
      await setLinks(server, [{ name: 'tak-north', port: double.port }]);
      await double.waitForConnections(1);
      const time = Date.now() - 1_000;
      const stale = Date.now() + 4_000;
      double.send({ uid: 'ita-delta', lon, lat, time, start: time, stale });
      const created = await lastOf(live, 'ita-delta');
      const t = created.state!.time!;
      expect([Date.parse(t.observed), Date.parse(t.validFrom), Date.parse(t.expires)], '@time, @start, @stale').toEqual([time, time, stale]);

      await expect.poll(() => colourAround(page, at, FRIEND), { timeout: 10_000, message: 'drawn in full before the expiry' }).toBeGreaterThan(50);
      const deletedYet = () => live.events.some((e: Event) => e.entityId === created.entityId && e.operation === 'delete');
      await expect.poll(() => colourAround(page, at, FRIEND), { timeout: 10_000, message: 'not in full colour after the expiry' }).toBe(0);
      // Faded, not gone: the symbol still differs from the background, before ECore removes it.
      expect(deletedYet(), 'checked before the removal').toBe(false);
      expect(await drawnPixels(page, at), 'still drawn, faded').toBeGreaterThan(50);
      const removal = await live.next(
        (m: { type: string; events?: Event[] }) => m.type === 'changes' && (m.events ?? []).some((e) => e.entityId === created.entityId && e.operation === 'delete'),
        30_000,
      );
      const deleted = (removal.events as Event[]).find((e) => e.entityId === created.entityId)!;
      expect(deleted.by, 'removed by ECore, not by the plugin').toMatchObject({ plugin: 'core' });
      expect(Date.now() - stale, 'not before the removal time').toBeGreaterThanOrEqual(4_000);
    });
  } finally {
    await double.close();
  }
});

test('criterion 6: malformed, truncated, too large and DTD input is dropped and counted, no entity is resolved, the link continues, and within the minute one warning is logged', async ({}, testInfo) => {
  const double = await startTakDouble();
  try {
    await withCot(testInfo, async (start) => {
      const { server, client } = await start();
      await setLinks(server, [{ name: 'tak-north', port: double.port }]);
      await double.waitForConnections(1);
      const valid = (uid: string, lon: number) => cotEvent({ uid, lon, lat: 59.5 });
      double.sendRaw(
        [
          valid('ita-e1', 18.1),
          hostile.malformed(),
          valid('ita-e2', 18.2),
          hostile.huge(),
          valid('ita-e3', 18.3),
          hostile.externalEntity(double.entityUrl),
          valid('ita-e4', 18.4),
          hostile.entityExpansion(),
          valid('ita-e5', 18.5),
          hostile.truncated(),
          valid('ita-e6', 18.6),
        ].join(''),
      );
      for (const uid of ['ita-e1', 'ita-e2', 'ita-e3', 'ita-e4', 'ita-e5', 'ita-e6']) await lastOf(client, uid);
      expect(double.entityRequests, 'no external entity was fetched').toEqual([]);
      // The plugin refreshes its status once a second.
      await expect.poll(() => linkStatus(server, 'tak-north'), { timeout: 10_000 }).toMatch(/too large 1/);
      const status = await linkStatus(server, 'tak-north');
      testInfo.annotations.push({ type: 'status', description: status });
      expect(status, 'malformed, truncated, external entity and entity expansion: 4; the 1 MB event: 1').toMatch(/dropped 5 \(malformed 4, too large 1\)/);
      for (const uid of ['ita-malformed', 'ita-huge', 'ita-xxe', 'ita-laughs', 'ita-truncated']) expect(eventsOf(client, uid), uid).toEqual([]);
      await client.close();
      await stopOwnServer(server, { expectedLog: [/link tak-north: dropped an event that/] });
      const warnings = readFileSync(server.logFile, 'utf8').split(/\r?\n/).filter((l) => / WARN .*link tak-north: dropped/.test(l));
      expect(warnings.length, 'at most one warning per minute').toBeLessThanOrEqual(1);
    });
  } finally {
    await double.close();
  }
});

test('criterion 7: a TAK system that goes away is retried after 1, 2, 4 and 8 s; another link is not affected; the status shows each link', async ({}, testInfo) => {
  const north = await startTakDouble();
  const south = await startTakDouble();
  try {
    await withCot(testInfo, async (start) => {
      const { server, client } = await start();
      await setLinks(server, [
        { name: 'tak-north', port: north.port },
        { name: 'tak-south', port: south.port },
      ]);
      await north.waitForConnections(1);
      await south.waitForConnections(1);
      const away = Date.now();
      await north.goAway(); // the port closes: every new try is refused by the system
      // ECore's next tries, as the status names them ("next try <time>", cut to the second; the plugin
      // refreshes its status at each disconnect, so every one is seen). Function 8: 1 s, doubling, at
      // most 60 s (owner, 2026-10-13: the first wait is the back-off's initial delay). The tries are
      // refused by the system, so the double cannot see them; the cap is not reached in this test.
      const tries = new Set<string>();
      const deadline = Date.now() + 30_000;
      while (tries.size < 4 && Date.now() < deadline) {
        const next = /next try ([0-9T:-]+Z)/.exec(await linkStatus(server, 'tak-north'))?.[1];
        if (next) tries.add(next);
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      const times = [...tries].map((t) => Date.parse(t));
      const gaps = times.slice(1).map((t, i) => (t - times[i]) / 1000);
      testInfo.annotations.push({ type: 'tries', description: `first ${((times[0] - away) / 1000).toFixed(1)} s after going away; gaps ${gaps.join(', ')} s` });
      expect(times.length, 'four tries named').toBe(4);
      // The named times are cut to the second, so the first lies up to 1 s before the real try at
      // 1 s plus the time ECore takes to notice the loss; 2 s leaves room for a busy machine. The
      // gaps are what tell the first wait apart: a first wait of 2 s gives gaps of 4, 8 and 16 s.
      const first = (times[0] - away) / 1000;
      expect(first, `the first try after 1 s (named ${first.toFixed(1)} s after going away)`).toBeGreaterThanOrEqual(-0.2);
      expect(first, `the first try after 1 s (named ${first.toFixed(1)} s after going away)`).toBeLessThanOrEqual(2);
      // Then 2, 4 and 8 s, each within 1.2 s (the status's 1 s resolution).
      gaps.forEach((gap, i) => expect(Math.abs(gap - 2 ** (i + 1)), `gap ${i + 1}: about ${2 ** (i + 1)} s (${gaps.join(', ')} s)`).toBeLessThanOrEqual(1.2));

      // Meanwhile the other link works, and the status shows both.
      south.send({ uid: 'ita-south', lon: 12.5, lat: 55.5 });
      await lastOf(client, 'ita-south');
      expect(await cotStatus(server)).toMatchObject({ state: 'DEGRADED' });
      expect(await linkStatus(server, 'tak-north')).toMatch(/^tak-north: not connected/);
      expect(await linkStatus(server, 'tak-south')).toMatch(/^tak-south: connected since/);
      expect(south.connections, 'the other link kept its one connection').toHaveLength(1);

      await north.comeBack();
      await north.waitForConnections(2, 90_000);
      north.send({ uid: 'ita-north', lon: 18.5, lat: 59.5 });
      await lastOf(client, 'ita-north');
      await expect.poll(() => cotStatus(server)).toMatchObject({ state: 'OK' });
      await client.close();
      await stopOwnServer(server);
    });
  } finally {
    await Promise.all([north.close(), south.close()]);
  }
});

test("criterion 8: two links give different data sources and layers; the same uid on both is one object that keeps the first link's", async ({}, testInfo) => {
  const north = await startTakDouble();
  const south = await startTakDouble();
  try {
    await withCot(testInfo, async (start) => {
      const { server, client } = await start();
      await setLinks(server, [
        { name: 'tak-north', port: north.port },
        { name: 'tak-south', port: south.port },
      ]);
      await north.waitForConnections(1);
      await south.waitForConnections(1);
      const t = Date.now();
      north.send({ uid: 'ita-n', lon: 18.5, lat: 59.5, time: t });
      south.send({ uid: 'ita-s', lon: 12.5, lat: 55.5, time: t });
      const n = (await lastOf(client, 'ita-n')).state!;
      const s = (await lastOf(client, 'ita-s')).state!;
      expect([n.dataSource, s.dataSource]).toEqual(['tak-north', 'tak-south']);
      expect(n.layerId).not.toBe(s.layerId);

      north.send({ uid: 'ita-both', lon: 18.25, lat: 59.75, time: t });
      const first = await lastOf(client, 'ita-both');
      south.send({ uid: 'ita-both', lon: 12.25, lat: 55.75, time: t + 1_000 });
      const second = await lastOf(client, 'ita-both', 2);
      expect(second).toMatchObject({ operation: 'update', entityId: first.entityId });
      expect(second.state).toMatchObject({ dataSource: 'tak-north', layerId: n.layerId });
      near(second.state!.geometry.coordinates, [12.25, 55.75]);
      expect(second.state!.meta.modified?.by?.system, 'the change came from the south link').toBe('tak-south');
      expect(second.state!.meta.created?.by?.system).toBe('tak-north');
      await client.close();
      await stopOwnServer(server);
    });
  } finally {
    await Promise.all([north.close(), south.close()]);
  }
});

test('criterion 9: TLS with a client certificate made at test time, named like the link in local configuration', async ({}, testInfo) => {
  const certs = testCertificates();
  const double = await startTakDouble({ certs });
  try {
    await withCot(testInfo, async (start) => {
      const { server, client } = await start(listenerCredentialArgs(certs, 'tak-secure'));
      await setLinks(server, [{ name: 'tak-secure', port: double.port, transport: 'tls' }]);
      const connection = await double.waitForConnections(1);
      expect(connection).toMatchObject({ authorized: true, peer: certs.clientName });
      double.send({ uid: 'ita-tls', lon: 18.5, lat: 59.25 });
      expect((await lastOf(client, 'ita-tls')).state).toMatchObject({ dataSource: 'tak-secure' });
      expect(double.rejected).toEqual([]);
      await client.close();
      await stopOwnServer(server);
    });
  } finally {
    await double.close();
  }
});
