// Quick run: @limits
import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { stopOwnServer, withOwnServers, type OwnServer } from '../../lib/own-server';
import { installTestPlugin } from '../../lib/test-plugins.mjs';

// The caps per plugin (CR-0005, overview 4.2): at most N outstanding asks and M active timers per
// plugin, lowered here with --emc2.plugins.max-outstanding-asks and --emc2.plugins.max-active-timers.
// The ITA's test plugin ita-limits (fixtures/plugins/ita-limits) makes the asks and timers.

test.describe.configure({ timeout: 120_000 });

async function get(server: OwnServer, path: string, id = 'ita-limits') {
  const started = Date.now();
  const response = await fetch(`${server.baseUrl}/api/plugins/${id}${path}`);
  return { status: response.status, text: await response.text(), ms: Date.now() - started };
}

async function pluginStatus(server: OwnServer, id = 'ita-limits') {
  const plugins = (await (await fetch(`${server.baseUrl}/api/plugins`)).json()) as Array<{ id: string; active: boolean; status: { state: string; detail: string } }>;
  return plugins.find((p) => p.id === id)!;
}

function logLines(server: OwnServer, pattern: RegExp): string[] {
  return readFileSync(server.logFile, 'utf8').split(/\r?\n/).filter((line) => pattern.test(line));
}

test('an ask over the cap is answered at once with "too many outstanding asks", the refusal is logged once, and the status does not change', async ({}, testInfo) => {
  await withOwnServers(testInfo, async (folders, start) => {
    installTestPlugin(folders.pluginsDir, 'ita-limits');
    const server = await start(['--emc2.plugins.max-outstanding-asks=5']);

    // 8 asks that are never answered: 5 stay outstanding, 3 are refused.
    expect((await get(server, '/asks?n=8')).text).toBe('asked 8');
    const asked = Date.now();
    await expect.poll(async () => JSON.parse((await get(server, '/asks-result')).text), { timeout: 5_000, intervals: [50] }).toEqual({
      failed: 3,
      reasons: { 'too many outstanding asks': 3 },
    });
    const ms = Date.now() - asked;
    testInfo.annotations.push({ type: 'asks', description: `3 refusals answered within ${ms} ms` });
    expect(ms, 'the refusals come at once, not after the ask timeout (60 s)').toBeLessThan(1_000);

    // More refusals in the same minute: counted, but not logged again.
    await get(server, '/asks?n=4');
    await expect.poll(async () => JSON.parse((await get(server, '/asks-result')).text).failed).toBe(7);
    expect(logLines(server, /reached its cap of 5 outstanding asks/), 'logged at most once a minute').toHaveLength(1);
    expect((await pluginStatus(server)).status.state, 'the plugin status does not change').toBe('OK');
    expect((await get(server, '/ping')).text).toBe('pong');
    await stopOwnServer(server, { expectedLog: [/ita-limits reached its cap of 5 outstanding asks/] });
  });
});

test('a timer over the cap is refused; a handler that does not catch it fails alone, and the worker continues', async ({}, testInfo) => {
  await withOwnServers(testInfo, async (folders, start) => {
    installTestPlugin(folders.pluginsDir, 'ita-limits');
    const server = await start(['--emc2.plugins.max-active-timers=3']);

    const caught = JSON.parse((await get(server, '/timers?n=5')).text);
    expect(caught.created, 'timers up to the cap').toBe(3);
    expect(caught.refusal).toMatch(/too many active timers: ita-limits has 3, its cap/);

    // Not caught: ECore logs the handler's failure, drops the message (the endpoint gets no
    // answer: 504 at its 3 s timeout) and the same worker handles the next message.
    expect((await get(server, '/timers-uncaught?n=1')).status).toBe(504);
    const again = JSON.parse((await get(server, '/timers?n=1')).text);
    expect(again).toEqual({ created: 0, refusal: expect.stringMatching(/too many active timers/) });

    expect(logLines(server, /reached its cap of 3 active timers/), 'logged at most once a minute').toHaveLength(1);
    expect((await pluginStatus(server)).status.state, 'the plugin status does not change').toBe('OK');
    await stopOwnServer(server, {
      expectedLog: [/ita-limits reached its cap of 3 active timers/, /Worker ita-limits\/timekeeper: handler call for .*TimersUncaught failed; message dropped/],
    });
  });
});

test('a cap hit in start disables the plugin with the reason, and the server keeps running', async ({}, testInfo) => {
  await withOwnServers(testInfo, async (folders, start) => {
    installTestPlugin(folders.pluginsDir, 'ita-limits', { settings: { timersInStart: 4 } });
    installTestPlugin(folders.pluginsDir, 'ita-limits', { as: 'ita-neighbour' });
    const server = await start(['--emc2.plugins.max-active-timers=3']);

    const plugin = await pluginStatus(server);
    expect(plugin.active).toBe(false);
    expect(plugin.status).toEqual({ state: 'FAILED', detail: expect.stringMatching(/^start failed: .*too many active timers: ita-limits has 3, its cap/) });
    // The cap is per plugin: another plugin starts and works.
    expect((await pluginStatus(server, 'ita-neighbour')).status.state).toBe('OK');
    expect((await get(server, '/ping', 'ita-neighbour')).text).toBe('pong');
    expect((await fetch(`${server.baseUrl}/api/health`)).status).toBe(200);
    await stopOwnServer(server, {
      // Exactly "start failed" (the reason is on the next line, the stack trace) and the
      // disabled line with its reason; nothing else of this plugin is tolerated.
      expectedLog: [
        /ita-limits reached its cap of 3 active timers/,
        /Plugin ita-limits: start failed(?:\r?\n|$)/,
        /Plugin ita-limits is disabled: start failed: java\.lang\.IllegalStateException: too many active timers/,
      ],
    });
  });
});
