// Quick run: @limits
// Quick run of this file alone: node tests/integration/run.mjs --skip-build -- specs/limits/compute.spec.ts
import { expect, test } from '@playwright/test';
import { cpus } from 'node:os';
import { stopOwnServer, withOwnServers, type OwnServer } from '../../lib/own-server';
import { installTestPlugin } from '../../lib/test-plugins.mjs';

// Compute tasks under load (M9 T4; ADR-0064, the CDA's C7, SDK 1.9.0 part P; server/README.md, "Compute tasks"),
// with the ITA's test plugin ita-compute (fixtures/plugins/ita-compute; owner ABJ A): tasks that spin until they
// are stopped, one that ignores its stop, and an echo. Checked: the server's cap emc2.compute.max-threads (a start
// above it refused and counted, a place freed by a stop), the admin's lower number for the plugin, a task that will
// not stop marked Hung after 5 s with its plugin DEGRADED and its place kept, and the other plugins' workers and the
// core's API answering while the compute tasks hold every core the cap allows. ita-limits is the other plugin.

test.describe.configure({ timeout: 180_000 });

const BASE = '/api/plugins/ita-compute';

type Events = { events: string[]; echoes: Record<string, number>; posts: string[] };

async function call(server: OwnServer, path: string): Promise<any> {
  const response = await fetch(`${server.baseUrl}${path}`);
  const text = await response.text();
  expect(response.status, `${path}: ${text}`).toBe(200);
  return text === '' ? null : JSON.parse(text);
}

const start = (server: OwnServer, name: string, kind: 'spin' | 'stubborn' | 'echo') => call(server, `${BASE}/start?name=${name}&kind=${kind}`);
const stop = (server: OwnServer, name: string) => call(server, `${BASE}/stop?name=${name}`);
const events = async (server: OwnServer): Promise<Events> => call(server, `${BASE}/events`);

async function monitor(server: OwnServer) {
  const answer = await call(server, '/api/monitor');
  const plugin = (answer.plugins as Array<{ id: string; state: string; detail: string; compute: any }>).find((p) => p.id === 'ita-compute')!;
  return { cap: answer.core.compute.cap as number, held: answer.core.compute.held as number, plugin };
}

/** Waits until the control worker has got `event` (e.g. "Running a"). */
async function until(server: OwnServer, event: string | RegExp, timeout = 15_000): Promise<void> {
  await expect
    .poll(async () => (await events(server)).events.some((e) => (typeof event === 'string' ? e === event : event.test(e))), { timeout, message: `the event ${event}` })
    .toBe(true);
}

test('the total cap and the admin\'s number (ADR-0064 points 1, 2 and 4; T4): with emc2.compute.max-threads=2, two spinning tasks run and a third is refused (TOTAL_CAP), counted, the Monitor showing 2 of 2; a stop frees the place for it; an echo task gets what a worker posts and sends it back; the admin lowering the plugin to 1 stops the newest task first, and a start above it is refused (PLUGIN_LIMIT)', async ({}, testInfo) => {
  await withOwnServers(testInfo, async (folders, startServer) => {
    installTestPlugin(folders.pluginsDir, 'ita-compute');
    const server = await startServer(['--emc2.compute.max-threads=2']);
    const declared = await call(server, '/api/settings/plugins/ita-compute/compute');
    expect(declared, 'declared and allowed').toMatchObject({ declared: 64, allowed: 64 });

    await start(server, 'a', 'spin');
    await start(server, 'b', 'spin');
    await until(server, 'Running a');
    await until(server, 'Running b');
    await start(server, 'c', 'spin');
    await until(server, 'Refused c TOTAL_CAP');
    let m = await monitor(server);
    testInfo.annotations.push({ type: 'at the cap', description: JSON.stringify({ cap: m.cap, held: m.held, running: m.plugin.compute.running, refusals: m.plugin.compute.refusals, tasks: m.plugin.compute.tasks.map((t: any) => `${t.name} ${t.state} cpu ${t.cpuMillis} ms`) }) });
    expect([m.cap, m.held], 'the cap 2, held 2').toEqual([2, 2]);
    expect(m.plugin.compute.running, 'two running').toBe(2);
    expect(m.plugin.compute.refusals, 'the refusal counted').toMatchObject({ TOTAL_CAP: 1 });
    expect(m.plugin.compute.tasks.filter((t: any) => t.cpuMillis > 0).length, 'the spinning tasks use CPU').toBe(2);

    // A stop frees the place: the thread ends, and a new start runs.
    await stop(server, 'a');
    await until(server, /^Stopped a/);
    await expect.poll(async () => (await monitor(server)).held, { message: 'a\'s place free once its thread ended' }).toBe(1);
    await start(server, 'c', 'spin');
    await until(server, 'Running c');

    // An echo: what a worker posts reaches the task, and the task sends it back to a worker.
    await stop(server, 'b');
    await until(server, /^Stopped b/);
    await start(server, 'e', 'echo');
    await until(server, 'Running e');
    await call(server, `${BASE}/post?name=e&n=25`);
    await expect.poll(async () => (await events(server)).echoes.e ?? 0, { message: 'every item echoed' }).toBe(25);
    expect([...new Set((await events(server)).posts)], 'the posts accepted').toEqual(['ACCEPTED']);

    // The admin's number below the running two: the newest (e) is stopped, with the reason; a start above it is refused.
    const put = await fetch(`${server.baseUrl}/api/settings/plugins/ita-compute/compute`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ allowed: 1 }) });
    expect(put.status, `PUT allowed 1: ${await put.clone().text()}`).toBe(200);
    await until(server, /^Stopped e: the admin lowered the plugin's compute threads to 1/);
    expect((await events(server)).events.filter((e) => e.startsWith('Stopped c')), 'c, the older, keeps running').toEqual([]);
    await start(server, 'f', 'spin');
    await until(server, 'Refused f PLUGIN_LIMIT');
    m = await monitor(server);
    expect([m.plugin.compute.allowed, m.plugin.compute.running], 'allowed 1, running 1').toEqual([1, 1]);
    testInfo.annotations.push({ type: 'events', description: (await events(server)).events.join('; ') });
    await stop(server, 'c');
    await until(server, /^Stopped c/);
    await stopOwnServer(server);
  });
});

test('a task that will not stop (ADR-0064 point 4; T4): stopped, a task that ignores its stop is Hung after the 5 s grace, its plugin DEGRADED, and it keeps its place in the cap; the plugin\'s other tasks and workers go on', async ({}, testInfo) => {
  await withOwnServers(testInfo, async (folders, startServer) => {
    installTestPlugin(folders.pluginsDir, 'ita-compute');
    const server = await startServer(['--emc2.compute.max-threads=2']);
    await start(server, 'stubborn', 'stubborn');
    await until(server, 'Running stubborn');
    expect((await monitor(server)).plugin.state, 'OK before').toBe('OK');

    await stop(server, 'stubborn');
    const stopped = Date.now();
    await until(server, 'Hung stubborn', 20_000);
    const after = Date.now() - stopped;
    testInfo.annotations.push({ type: 'Hung after', description: `${after} ms` });
    expect(after, 'after the 5 s grace').toBeGreaterThanOrEqual(4_500);
    expect(after, 'soon after it').toBeLessThanOrEqual(10_000);
    const m = await monitor(server);
    testInfo.annotations.push({ type: 'the plugin after', description: JSON.stringify({ state: m.plugin.state, detail: m.plugin.detail, held: m.held, tasks: m.plugin.compute.tasks.map((t: any) => `${t.name} ${t.state} hung ${t.hung}`) }) });
    expect(m.plugin.state, 'the plugin DEGRADED').toBe('DEGRADED');
    expect(m.held, 'its place kept').toBe(1);
    expect(m.plugin.compute.tasks.find((t: any) => t.name === 'stubborn')?.hung, 'marked hung in the Monitor').toBe(true);

    // One place is left: one more task runs, a second is refused.
    await start(server, 'one', 'echo');
    await until(server, 'Running one');
    await start(server, 'two', 'echo');
    await until(server, 'Refused two TOTAL_CAP');
    await call(server, `${BASE}/post?name=one&n=3`);
    await expect.poll(async () => (await events(server)).echoes.one ?? 0, { message: 'the plugin\'s other task goes on' }).toBe(3);
    expect(await (await fetch(`${server.baseUrl}${BASE}/ping`)).text(), 'its workers answer').toBe('pong');
    // The hung thread stays until the process ends (ADR-0064 point 4): the server is ended, not stopped gracefully.
    await server.kill();
  });
});

test('the other plugins\' workers answer under load (ADR-0064, ADR-0004; T4): with the default cap (the cores minus one) held by spinning tasks, ita-limits\' worker, ita-compute\'s own worker and the core\'s API each answer 20 pings in time', async ({}, testInfo) => {
  await withOwnServers(testInfo, async (folders, startServer) => {
    installTestPlugin(folders.pluginsDir, 'ita-compute');
    installTestPlugin(folders.pluginsDir, 'ita-limits');
    const server = await startServer();
    const cap = (await monitor(server)).cap;
    expect(cap, 'the default cap: the cores minus one, at least one').toBe(Math.max(1, cpus().length - 1));
    const names = Array.from({ length: cap }, (_, i) => `spin-${i + 1}`);
    for (const name of names) await start(server, name, 'spin');
    for (const name of names) await until(server, `Running ${name}`);
    await start(server, 'over', 'spin');
    await until(server, 'Refused over TOTAL_CAP');
    // Let them run a moment, so that the cores are busy.
    await expect.poll(async () => (await monitor(server)).plugin.compute.tasks.filter((t: any) => t.cpuMillis > 500).length, { timeout: 20_000, message: 'the tasks hold their cores' }).toBe(cap);

    const timings: Record<string, number[]> = {};
    for (const [label, path] of [['ita-limits worker', '/api/plugins/ita-limits/ping'], ['ita-compute worker', `${BASE}/ping`], ['core API', '/api/health']] as const) {
      timings[label] = [];
      for (let i = 0; i < 20; i++) {
        const t = performance.now();
        const response = await fetch(`${server.baseUrl}${path}`);
        await response.text();
        expect(response.status, `${label} answers`).toBe(200);
        timings[label].push(Math.round(performance.now() - t));
      }
    }
    const summary = Object.fromEntries(Object.entries(timings).map(([k, v]) => [k, { max: Math.max(...v), median: [...v].sort((a, b) => a - b)[10] }]));
    testInfo.annotations.push({ type: `ping times in ms with ${cap} spinning tasks on ${cpus().length} cores`, description: JSON.stringify(summary) });
    for (const [label, v] of Object.entries(timings)) {
      expect([...v].sort((a, b) => a - b)[10], `${label}: the median within 200 ms`).toBeLessThanOrEqual(200);
      expect(Math.max(...v), `${label}: each within 2 s`).toBeLessThanOrEqual(2_000);
    }
    const workers = (await monitor(server)).plugin;
    expect(workers.state, 'ita-compute OK under load').toBe('OK');
    for (const name of names) await stop(server, name);
    for (const name of names) await until(server, new RegExp(`^Stopped ${name}`));
    await stopOwnServer(server);
  });
});
