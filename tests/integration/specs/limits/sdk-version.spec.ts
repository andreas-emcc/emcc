// Quick run: @limits
import { expect, test } from '@playwright/test';
import { stopOwnServer, withOwnServers } from '../../lib/own-server';
import { installTestPlugin, sdkVersion } from '../../lib/test-plugins.mjs';

// The plugin host checks a manifest's sdkVersion range against the SDK version ECore implements
// (server/README.md "Plugin host", CR-0005). The version is read from the SDK's pom, so the test
// follows an SDK bump: a range for the current version runs; one for the next minor is refused
// (it needs features ECore lacks), and so is one for M0's SDK 0.1.0 (a caret range below 1.0.0
// allows no other minor, and SDK v1 changed the API incompatibly). The ITA's test plugin is
// installed under three ids with the three ranges.

const current = sdkVersion();
const [major, minor] = current.split('.').map(Number);
const next = `${major}.${minor + 1}.0`;
const m0 = '0.1.0';

test(`a plugin asking for ^${current} runs; plugins asking for ^${next} or for M0's ^${m0} are refused for their SDK version`, async ({}, testInfo) => {
  testInfo.setTimeout(120_000);
  await withOwnServers(testInfo, async (folders, start) => {
    installTestPlugin(folders.pluginsDir, 'ita-limits', { as: 'ita-sdk-current', sdkVersion: `^${current}` });
    installTestPlugin(folders.pluginsDir, 'ita-limits', { as: 'ita-sdk-future', sdkVersion: `^${next}` });
    installTestPlugin(folders.pluginsDir, 'ita-limits', { as: 'ita-sdk-m0', sdkVersion: `^${m0}` });
    const server = await start();
    const plugins = (await (await fetch(`${server.baseUrl}/api/plugins`)).json()) as Array<{ id: string; active: boolean; status: { state: string; detail: string } }>;
    const byId = Object.fromEntries(plugins.map((p) => [p.id, p]));

    expect(byId['ita-sdk-current'].active).toBe(true);
    expect(byId['ita-sdk-current'].status.state).toBe('OK');
    expect((await fetch(`${server.baseUrl}/api/plugins/ita-sdk-current/ping`)).status).toBe(200);

    for (const [id, range] of [
      ['ita-sdk-future', `^${next}`],
      ['ita-sdk-m0', `^${m0}`],
    ]) {
      expect(byId[id].active, id).toBe(false);
      expect(byId[id].status, id).toEqual({ state: 'FAILED', detail: `needs SDK ${range}, but ECore implements ${current}` });
      expect((await fetch(`${server.baseUrl}/api/plugins/${id}/ping`)).status, `${id}: a refused plugin has no endpoints`).toBe(404);
    }
    const escaped = (text: string) => text.replace(/[.^]/g, (c) => `\\${c}`);
    await stopOwnServer(server, {
      expectedLog: [
        new RegExp(`Plugin ita-sdk-future is disabled: needs SDK ${escaped(`^${next}`)}, but ECore implements ${escaped(current)}`),
        new RegExp(`Plugin ita-sdk-m0 is disabled: needs SDK ${escaped(`^${m0}`)}, but ECore implements ${escaped(current)}`),
      ],
    });
  });
});
