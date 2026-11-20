// Quick run: @login @plugin-terrain
// Quick run of this file alone: node tests/integration/run.mjs --skip-build --keycloak -- specs/keycloak/terrain-rights.spec.ts
import { expect, test, type BrowserContext } from '@playwright/test';
import { useTestRealm, withLoginServer, type LoginRun } from '../../lib/login';
import { bottomPanel } from '../../lib/m0';

// Terrain's permission against a real Keycloak (the terrain brief; plugins/terrain/README.md):
// plugin.terrain.use, "Use the terrain tools", covers both tools and every endpoint. Without it the
// panel is not shown and ECore answers the endpoints with 403 before the plugin sees them (server
// README, "Endpoints"); with it the range answers. Only terrainUser holds it (lib/keycloak.mjs).
// The tools themselves, without login: flows/m5-terrain.spec.ts. Runs only with run.mjs --keycloak.

test.describe.configure({ timeout: 180_000 });

const realm = useTestRealm();
const STOCKHOLM = [18.0686, 59.3293];
const UPPSALA = [17.6389, 59.8586];

/** A call to terrain's server part with the user's session; resolves with the status. */
async function call(run: LoginRun, context: BrowserContext, path: string, body?: unknown): Promise<number> {
  const init = body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
  return (await run.api(context, `/api/plugins/terrain${path}`, init)).status;
}

test('plugin.terrain.use: without it the Terrain panel is not shown and every endpoint answers 403; with it the panel is shown and the range answers', async ({ browser }, testInfo) => {
  await withLoginServer(testInfo, browser, realm(), async (run) => {
    const viewshed = { observer: STOCKHOLM, observerHeight: 2, targetHeight: 2, maxRange: 5_000 };

    // terrainUser first, so that the panel's name is known to show where it is shown.
    const allowed = await run.logIn('terrainUser');
    const config = await (await run.api(allowed.context, '/api/config')).json();
    expect(config.user.permissions, 'terrainUser: only the terrain permission').toEqual(['plugin.terrain.use']);
    await expect(allowed.page.getByRole('region', { name: 'Terrain', exact: true }).last(), 'terrainUser: the Terrain panel').toBeVisible();
    expect(await call(run, allowed.context, '/status'), 'terrainUser: status').toBe(200);
    expect(await call(run, allowed.context, '/range', { from: STOCKHOLM, to: UPPSALA }), 'terrainUser: range').toBe(200);
    // Past the permission, refused only for the data: the test server's empty settings/terrain/ is ready with 0 cells
    // (T-157, owner SB A and SC A), so no height data at the observer: 404 (terrain README, Refusals; 503 is a folder not set or not readable).
    expect(await call(run, allowed.context, '/viewshed', viewshed), 'terrainUser: viewshed, refused only for the missing data').toBe(404);

    // The editor (objects.edit, layers.edit) and the viewer (nothing): no panel, 403 for every endpoint.
    for (const user of ['editor', 'viewer'] as const) {
      const { context, page } = await run.logIn(user);
      await bottomPanel(page, 'Layers'); // the shell is up, its panels placed
      await expect(page.getByRole('region', { name: 'Terrain', exact: true }), `${user}: no Terrain panel`).toHaveCount(0);
      expect(await call(run, context, '/status'), `${user}: status`).toBe(403);
      expect(await call(run, context, '/range', { from: STOCKHOLM, to: UPPSALA }), `${user}: range`).toBe(403);
      expect(await call(run, context, '/viewshed', viewshed), `${user}: viewshed`).toBe(403);
    }
  });
});
