// Quick run: @always
import { expect, test } from '@playwright/test';
import { cpSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { stopOwnServer, withOwnServers } from '../../lib/own-server';
import { assembledPlugins } from '../../lib/plugins.mjs';
import { root } from '../../lib/server.mjs';

// T-015: GET /api/plugins lists the plugin folders. The list's shape is provisional until T-014;
// if it changes, these tests are skipped (test.fixme) until they are adapted.

test('every assembled plugin is installed in the run, active and OK on the server', async ({ request }) => {
  const assembled = assembledPlugins();
  // A run without plugins would pass most suites silently, so it fails here.
  expect(assembled, 'build/plugins/ is empty: run node tools/build.mjs').not.toEqual([]);
  const listed = (await (await request.get('/api/plugins')).json()) as Array<{ id: string; active: boolean; status: { state: string; detail: string } }>;
  expect(listed.map((p) => p.id).sort()).toEqual([...assembled].sort());
  for (const plugin of listed) {
    expect(plugin.active, `${plugin.id} active`).toBe(true);
    expect(plugin.status.state, `${plugin.id}: ${plugin.status.detail}`).toBe('OK');
  }
});

test('with an empty plugin folder the plugin list is empty', async ({}, testInfo) => {
  testInfo.setTimeout(120_000);
  // The shared server runs with the assembled plugins, so this needs a server of its own.
  await withOwnServers(testInfo, async (_folders, start) => {
    const server = await start();
    const response = await fetch(`${server.baseUrl}/api/plugins`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    await stopOwnServer(server);
  });
});

test('a folder named _template is skipped, so the plugin list stays empty', async ({}, testInfo) => {
  testInfo.setTimeout(120_000);
  await withOwnServers(testInfo, async (folders, start) => {
    // A real manifest whose id does not match the folder name: if the host read the folder, it
    // would list it as a failed plugin instead of skipping it.
    const template = join(folders.pluginsDir, '_template');
    mkdirSync(template);
    cpSync(join(root, 'model', 'examples', 'valid', 'manifest-draw-symbols.json'), join(template, 'plugin.json'));

    const server = await start();
    const response = await fetch(`${server.baseUrl}/api/plugins`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([]);
    await stopOwnServer(server);
  });
});
