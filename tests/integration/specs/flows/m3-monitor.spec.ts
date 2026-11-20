// Quick run: @settings @plugin-cot @tak
// Quick run of this file alone: node tests/integration/run.mjs --skip-build -- specs/flows/m3-monitor.spec.ts
import { expect, test } from '@playwright/test';
import { setLinks } from '../../lib/cot';
import { createLayer, createSymbol } from '../../lib/live.mjs';
import { withM0 } from '../../lib/m0';
import { startTakDouble } from '../../lib/tak-double.mjs';

// Connection tasks in the Monitor (T-086; ADR-0036 point 6, T-079's monitor, cot's criterion 25 in
// part): cot runs each link as a connection task, and the monitor shows the tasks with their state,
// peer and the plugin's own counters, the manifest's declared connections, and the output channel
// of an out link. The plugin row's "Connections" column counts the running tasks and listeners
// (owner, 2026-10-26). Against the TAK test double, on a server of the test's own.

test.describe.configure({ timeout: 120_000 });

type Task = { name: string; state: string; peer: string | null; counters: Record<string, number>; details: Record<string, string>; reason: string | null };
type Channel = { link: string; name: string; outputType: string; canDelete: boolean; sent: number };
type MonitorPlugin = { id: string; tasks: Task[]; channels: Channel[]; connections: Array<{ kinds: string[]; direction: string; settings: string | null }> };

async function cotInMonitor(baseUrl: string): Promise<MonitorPlugin> {
  const monitor = await (await fetch(`${baseUrl}/api/monitor`)).json();
  return (monitor.plugins as MonitorPlugin[]).find((p) => p.id === 'cot')!;
}

const byName = (tasks: Task[]) => Object.fromEntries(tasks.map((t) => [t.name, t]));

/** A task's row header: its name, then a mark such as "Check" when it needs attention (not the child tasks named after it). */
const taskName = (name: string) => new RegExp(`^${name}(\\s|$)`);

test("the Monitor shows cot's links as connection tasks with their peers and counters, its out link's channel, and a link that went away as restarting", async ({
  browser,
}, testInfo) => {
  const double = await startTakDouble();
  try {
    await withM0(testInfo, browser, async ({ server, live, open }) => {
      const outbound = createLayer('Outbound', { drawOrder: 1 });
      expect(await live.change(outbound)).toMatchObject({ outcome: 'applied' });
      await setLinks(server, [
        { name: 'tak-in', port: double.port },
        { name: 'tak-out', direction: 'out', port: double.port, sourceLayers: [{ id: outbound.entityId, name: 'Outbound' }] },
      ]);
      await double.waitForConnections(2);
      double.send({ uid: 'ita-monitor-in', lon: 18.25, lat: 59.5 });
      const symbol = createSymbol(outbound.entityId, 11);
      expect(await live.change(symbol)).toMatchObject({ outcome: 'applied' });
      await expect.poll(() => double.receivedEvents().some((e) => e.uid === symbol.entityId), { message: 'the out link sent the symbol', timeout: 10_000 }).toBe(true);

      // The API: both tasks running, with their peer and the counters of what went in and out.
      await expect
        .poll(async () => {
          const tasks = byName((await cotInMonitor(server.baseUrl)).tasks);
          return [tasks['tak-in']?.counters['events in'] ?? 0, tasks['tak-out']?.counters['events out'] ?? 0];
        }, { timeout: 10_000, message: 'events in and events out counted' })
        .toEqual([1, 1]);
      const cot = await cotInMonitor(server.baseUrl);
      testInfo.annotations.push({ type: 'cot in /api/monitor', description: JSON.stringify({ tasks: cot.tasks, channels: cot.channels }) });
      const tasks = byName(cot.tasks);
      // A TCP out link also reads its connection, in a child task, and ignores what comes.
      expect(Object.keys(tasks).sort()).toEqual(['tak-in', 'tak-out', 'tak-out/reader']);
      expect(tasks['tak-out/reader'].state).toBe('RUNNING');
      for (const name of ['tak-in', 'tak-out']) {
        expect(tasks[name], name).toMatchObject({ state: 'RUNNING', details: { transport: 'tcp' } });
        expect(tasks[name].peer, `${name}: the double`).toContain(String(double.port));
      }
      expect(cot.channels, 'one channel, for the out link').toEqual([expect.objectContaining({ link: 'tak-out', outputType: 'cot', canDelete: true })]);
      expect(cot.connections, 'the declared connections').toEqual([expect.objectContaining({ direction: 'both', settings: '/links' })]);
      expect(cot.connections[0].kinds).toEqual(expect.arrayContaining(['tcp-client', 'udp', 'multicast']));

      // The view: the Connections column and the plugin's details.
      const page = await open();
      await page.goto(`${server.baseUrl}/#monitor`);
      const table = page.getByRole('table', { name: 'Plugins' });
      const row = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'Cursor on Target' }) });
      await expect(row.getByRole('cell').nth(6), 'the Connections column').toHaveText('3 of 3 running');
      await row.getByRole('button', { name: 'Cursor on Target' }).click();
      const taskTable = page.getByRole('table', { name: 'Cursor on Target: connection tasks' });
      for (const name of ['tak-in', 'tak-out']) {
        const taskRow = taskTable.getByRole('row').filter({ has: page.getByRole('rowheader', { name: taskName(name) }) });
        await expect(taskRow.getByRole('cell').first(), `${name}: state`).toHaveText('running');
      }
      await expect(taskTable.getByRole('row').filter({ has: page.getByRole('rowheader', { name: taskName('tak-in') }) })).toContainText('events in 1');
      await expect(taskTable.getByRole('row').filter({ has: page.getByRole('rowheader', { name: taskName('tak-out') }) })).toContainText('events out 1');
      const channels = page.getByRole('table', { name: 'Cursor on Target: output channels' });
      await expect(channels.getByRole('row').filter({ hasText: 'cot/tak-out' })).toContainText('cot, with deletes');
      await expect(page.getByText(/^Declares connections \(ADR-0036\): tcp-client, udp, multicast; receives and sends, configured at \/links in its settings\./)).toBeVisible();

      // The TAK system goes away: both links' tasks restart, and the column says none runs.
      await double.goAway();
      const linkStates = async () => {
        const all = byName((await cotInMonitor(server.baseUrl)).tasks);
        return [all['tak-in']?.state, all['tak-out']?.state];
      };
      await expect.poll(linkStates, { timeout: 15_000 }).toEqual(['RESTARTING', 'RESTARTING']);
      await expect(row.getByRole('cell').nth(6)).toHaveText(/^0 of \d running$/, { timeout: 10_000 });
      await expect(taskTable.getByRole('row').filter({ has: page.getByRole('rowheader', { name: taskName('tak-in') }) }).getByRole('cell').first()).toContainText('restarting at');
    });
  } finally {
    await double.close();
  }
});
