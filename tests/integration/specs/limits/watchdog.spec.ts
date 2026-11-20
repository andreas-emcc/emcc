// Quick run: @limits
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { stopOwnServer, withOwnServers, type OwnServer } from '../../lib/own-server';
import { installTestPlugin } from '../../lib/test-plugins.mjs';

// The watchdog (overview 4.2, ADR-0004): a handler call over its budget is reported as hung, the
// plugin is DEGRADED unless the worker is restartable, and other workers keep running. The ITA's
// test plugin ita-limits has workers with a 1 s budget that sleep or spin on request.

test.describe.configure({ timeout: 120_000 });

async function get(server: OwnServer, path: string) {
  const started = Date.now();
  const response = await fetch(`${server.baseUrl}/api/plugins/ita-limits${path}`);
  return { status: response.status, text: await response.text(), ms: Date.now() - started };
}

async function pluginStatus(server: OwnServer) {
  const plugins = (await (await fetch(`${server.baseUrl}/api/plugins`)).json()) as Array<{ id: string; status: { state: string; detail: string } }>;
  return plugins.find((p) => p.id === 'ita-limits')!.status;
}

test('a handler that blocks past its budget is reported hung, the plugin turns DEGRADED, and other workers keep answering', async ({}, testInfo) => {
  await withOwnServers(testInfo, async (folders, start) => {
    installTestPlugin(folders.pluginsDir, 'ita-limits');
    const server = await start();
    expect((await pluginStatus(server)).state).toBe('OK');

    const sleeping = get(server, '/sleep?ms=3000');
    sleeping.catch(() => undefined); // awaited below; no unhandled rejection if the test fails first
    await expect.poll(() => pluginStatus(server), { timeout: 5_000, intervals: [100] }).toEqual({
      state: 'DEGRADED',
      detail: expect.stringMatching(/^worker sleeper hung \(\d+ ms\) and is not restarted$/),
    });
    const ping = await get(server, '/ping');
    expect(ping.text).toBe('pong');
    // A ping takes milliseconds; 2 s leaves room for a loaded machine.
    expect(ping.ms, 'another worker answers during the hang').toBeLessThan(2_000);
    expect((await sleeping).text, 'the blocked call ends by itself').toBe('slept 3000');
    expect((await pluginStatus(server)).state, 'ECore keeps the DEGRADED it set').toBe('DEGRADED');
    await stopOwnServer(server, {
      expectedLog: [/Worker ita-limits\/sleeper hung: handler call running for \d+ ms \(budget 1000 ms\)\. The worker is not restartable\./],
    });
  });
});

test('a restartable worker that hangs gets a fresh handler at once; the plugin stays OK', async ({}, testInfo) => {
  await withOwnServers(testInfo, async (folders, start) => {
    installTestPlugin(folders.pluginsDir, 'ita-limits');
    const server = await start();
    // The handler sleeps 5 s, longer than the endpoint's 3 s timeout, so the 504 never races with
    // the late answer.
    const hung = get(server, '/sleep-restartable?ms=5000');
    hung.catch(() => undefined); // awaited below
    await expect.poll(async () => (await get(server, '/restartable-ping')).text, { timeout: 5_000, intervals: [100] }).toBe('pong');
    expect((await pluginStatus(server)).state, 'a restart does not degrade the plugin').toBe('OK');
    // The hung message is not delivered again, and its late answer comes from a fenced thread and is
    // dropped: the request ends with the endpoint's timeout (3 s in the test plugin).
    expect((await hung).status).toBe(504);
    // The stuck thread wakes after 5 s; its answer is dropped and logged. Wait for that line, so
    // the server is not stopped before the thread has woken.
    await expect
      .poll(() => readFileSync(server.logFile, 'utf8'), { timeout: 10_000, message: 'the late answer was dropped' })
      .toMatch(/Plugin ita-limits: dropped an HTTP answer sent from a fenced thread/);
    await stopOwnServer(server, {
      expectedLog: [
        /Worker ita-limits\/restartable hung: handler call running for \d+ ms \(budget 1000 ms\)\. Restarting with a fresh handler\./,
        /Plugin ita-limits: dropped an HTTP answer sent from a fenced thread/,
      ],
    });
  });
});

test('a CPU-bound handler is detected as hung, and with cores to spare (at least 2) the other workers keep answering', async ({}, testInfo) => {
  await withOwnServers(testInfo, async (folders, start) => {
    installTestPlugin(folders.pluginsDir, 'ita-limits');
    const server = await start();
    // server/README.md, "Known limit": a spinning handler cannot be stopped; it keeps one carrier
    // thread busy. With fewer spinning handlers than cores (here one, so at least 2 cores) the rest
    // keeps running. The detection itself holds with any number of cores.
    const spinning = get(server, '/spin?ms=3000');
    spinning.catch(() => undefined); // awaited below
    await expect.poll(() => pluginStatus(server), { timeout: 5_000, intervals: [100] }).toEqual({
      state: 'DEGRADED',
      detail: expect.stringMatching(/^worker spinner hung/),
    });
    if (availableParallelism() >= 2) {
      const ping = await get(server, '/ping');
      expect(ping.text).toBe('pong');
      expect(ping.ms, 'another worker answers during the spin').toBeLessThan(2_000);
    } else {
      testInfo.annotations.push({ type: 'skipped part', description: 'one core: no spare carrier thread for other workers' });
    }
    expect((await spinning).text).toMatch(/^spun \d+$/);
    await stopOwnServer(server, {
      expectedLog: [/Worker ita-limits\/spinner hung: handler call running for \d+ ms \(budget 1000 ms\)\. The worker is not restartable\./],
    });
  });
});
