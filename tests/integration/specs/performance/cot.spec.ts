import { expect, test } from '@playwright/test';
import { byUid, setLinks, linkStatus, type CotObject } from '../../lib/cot';
import { LiveClient } from '../../lib/live.mjs';
import { stopOwnServer, withOwnServers } from '../../lib/own-server';
import { saveResult } from '../../lib/perf';
import { installPlugins } from '../../lib/plugins.mjs';
import { startTakDouble } from '../../lib/tak-double.mjs';

// The cot plugin's criterion 10 (docs/plugins/briefs/cot.md), "once in the ITA's environment":
// 1 000 events per second over 10 000 uids are applied without a growing backlog. The TAK test
// double streams for 30 s; every uid's last position is known, so the test fails only if events
// are lost (each uid must end as one object at its last position). The backlog (events read by the
// plugin minus objects created and updated, from its status, once a second) and the time to catch
// up after the stream are recorded, not gated.

test.describe.configure({ timeout: 10 * 60_000 });

const RATE = 1_000;
const UIDS = 10_000;
const SECONDS = 30;

/** uid n's position in round r (lat ≠ lon: lon 10–19.9, lat 55–60). */
const position = (n: number, round: number): [number, number] => [10 + (n % 100) / 10, 55 + Math.floor(n / 100) / 20 + round / 10_000];

function counters(status: string) {
  const m = /(\d+) read, (\d+) created, (\d+) updated/.exec(status);
  return m ? { read: Number(m[1]), created: Number(m[2]), updated: Number(m[3]) } : { read: 0, created: 0, updated: 0 };
}

test(`cot criterion 10: ${RATE} events per second over ${UIDS} uids for ${SECONDS} s are all applied`, async ({}, testInfo) => {
  const double = await startTakDouble();
  try {
    await withOwnServers(testInfo, async (folders, start) => {
      installPlugins(folders.pluginsDir, { only: ['cot'] });
      const server = await start();
      await setLinks(server, [{ name: 'tak-load', port: double.port }]);
      await double.waitForConnections(1);

      const samples: Array<{ s: number; read: number; applied: number; backlog: number }> = [];
      const started = Date.now();
      let sampling = true;
      const sampler = (async () => {
        while (sampling) {
          const c = counters(await linkStatus(server, 'tak-load'));
          samples.push({ s: Math.round((Date.now() - started) / 100) / 10, read: c.read, applied: c.created + c.updated, backlog: c.read - c.created - c.updated });
          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }
      })();
      const sent = await double.stream({
        rate: RATE,
        uids: UIDS,
        seconds: SECONDS,
        make: (uid: string, i: number) => {
          const n = Number(uid.slice(4));
          const [lon, lat] = position(n, Math.floor(i / UIDS));
          return { uid, lon, lat };
        },
      });
      const streamEnded = Date.now();
      const total = sent.sent;
      await expect
        .poll(async () => counters(await linkStatus(server, 'tak-load')).read, { timeout: 60_000, intervals: [500], message: 'every event read' })
        .toBe(total);
      await expect
        .poll(async () => {
          const c = counters(await linkStatus(server, 'tak-load'));
          return c.created + c.updated;
        }, { timeout: 120_000, intervals: [500], message: 'every event applied' })
        .toBe(total);
      const caughtUp = (Date.now() - streamEnded) / 1000;
      sampling = false;
      await sampler;

      // Every uid is one object at its last position.
      const reader = await LiveClient.open(server.baseUrl);
      const snapshot = await reader.subscribe(60_000);
      await reader.close();
      const objects = snapshot.objects as CotObject[];
      const lastRound = Math.floor((total - 1) / UIDS);
      let wrong = 0;
      for (let n = 0; n < UIDS; n++) {
        const found = byUid(objects, `ita-${n}`);
        const round = n < total - lastRound * UIDS ? lastRound : lastRound - 1;
        const [lon, lat] = position(n, round);
        if (found.length !== 1 || Math.abs(found[0].geometry.coordinates[0] - lon) > 1e-9 || Math.abs(found[0].geometry.coordinates[1] - lat) > 1e-9) wrong++;
      }
      const final = counters(await linkStatus(server, 'tak-load'));
      const result = {
        rate: RATE,
        uids: UIDS,
        sent: total,
        ratePerSecond: Math.round(sent.ratePerSecond),
        created: final.created,
        updated: final.updated,
        maxBacklog: Math.max(...samples.map((x) => x.backlog)),
        caughtUpSeconds: caughtUp,
        wrongObjects: wrong,
        samples,
      };
      testInfo.annotations.push({ type: 'cot load', description: JSON.stringify({ ...result, samples: undefined }) });
      await saveResult(testInfo, 'cot-load', result);
      expect(final.created, 'one object per uid').toBe(UIDS);
      expect(wrong, 'every uid is one object at its last position').toBe(0);
      await stopOwnServer(server);
    });
  } finally {
    await double.close();
  }
});
