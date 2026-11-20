// Quick run: @login @plugin-nvg
import { expect, test } from '@playwright/test';
import { createLayer, createSymbol } from '../../lib/live.mjs';
import { useTestRealm, withLoginServer } from '../../lib/login';

// T-173 with login against a real Keycloak (lib/keycloak.mjs USERS): the NVG panel's links and
// "Get capabilities" are for admins only (brief section 4, the owner's NV1 A): the endpoints need
// settings.admin, else 403, and the panel shows the Links section only to such a user. The admin's
// consumer link reads this server's own provider link, so no outside service is needed. Without
// the edit right Import is greyed with its reason (N1). Runs only with run.mjs --keycloak.

const realm = useTestRealm();

test('NVG with login (T-173, NV1): only a user with settings.admin sees the links and "Get capabilities", which lists the provider\'s filter items; the drawer gets 403 from the links endpoints; the viewer\'s Import is greyed', async ({ browser }, testInfo) => {
  await withLoginServer(testInfo, browser, realm(), async (run) => {
    const admin = await run.logIn('admin');
    const live = await run.live(admin.context);
    await live.subscribe();
    const layer = createLayer('ITA served', { drawOrder: 6 });
    expect((await live.change(layer)).outcome).toBe('applied');
    expect((await live.change(createSymbol(layer.entityId, 0, { name: 'Served 1' }))).outcome).toBe('applied');
    const settings = '/api/settings/plugins/nvg';
    const values = (await (await run.api(admin.context, settings)).json()).values;
    const put = await run.api(admin.context, settings, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...values,
        links: [
          { name: 'ita-out', kind: 'soap-provider', sourceLayers: [{ id: layer.entityId, name: 'ITA served' }] },
          { name: 'ita-in', kind: 'soap-consumer', url: `${run.server.baseUrl}/api/services/nvg/nvg/ita-out`, intervalSeconds: 3600, targetLayer: { name: 'ITA loop' } },
        ],
      }),
    });
    expect(put.status, await put.clone().text()).toBe(200);

    // The admin: the Links section with the consumer's "Get capabilities", which lists the filter item.
    await admin.page.reload();
    const adminPanel = admin.page.getByRole('region', { name: 'NVG', exact: true }).last(); // the shell's panel holds the plugin's PanelFrame of the same name
    const links = adminPanel.getByRole('region', { name: 'NVG links', exact: true });
    await expect(links).toContainText('ita-in');
    await links.getByRole('button', { name: 'Get capabilities', exact: true }).click();
    await expect(links.getByRole('list', { name: 'Filter items of ita-in', exact: true }), 'the provider\'s filter item').toContainText('layers');
    const asked = await run.api(admin.context, '/api/plugins/nvg/links/ita-in/capabilities', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: run.server.baseUrl }, body: '{}' });
    expect(asked.status, 'the admin may call it').toBe(200);

    // The drawer (objects.edit, no settings.admin): the panel and Import, no links; the endpoints refuse.
    const drawer = await run.logIn('drawer');
    const drawerPanel = drawer.page.getByRole('region', { name: 'NVG', exact: true }).last(); // the shell's panel holds the plugin's PanelFrame of the same name
    await expect(drawerPanel.getByRole('heading', { name: 'Import NVG', exact: true })).toBeVisible();
    await expect(drawerPanel.getByRole('button', { name: 'Choose file…', exact: true })).toBeEnabled();
    await expect(drawerPanel.getByRole('region', { name: 'NVG links', exact: true }), 'no links for a user without settings.admin').toHaveCount(0);
    await expect(drawerPanel.getByRole('button', { name: 'Get capabilities' })).toHaveCount(0);
    const refused = await run.api(drawer.context, '/api/plugins/nvg/links/ita-in/capabilities', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: run.server.baseUrl }, body: '{}' });
    expect(refused.status, 'Get capabilities without settings.admin').toBe(403);
    expect((await run.api(drawer.context, '/api/plugins/nvg/links')).status, 'the links without settings.admin').toBe(403);

    // The viewer (no permissions): Import is greyed with its reason.
    const viewer = await run.logIn('viewer');
    const viewerPanel = viewer.page.getByRole('region', { name: 'NVG', exact: true }).last(); // the shell's panel holds the plugin's PanelFrame of the same name
    await expect(viewerPanel).toContainText('You may not edit the layers of View: import is not available.');
    await expect(viewerPanel.getByRole('button', { name: 'Choose file…', exact: true })).toBeDisabled();
    await expect(viewerPanel.getByRole('button', { name: 'Import', exact: true })).toBeDisabled();
    await expect(viewerPanel.getByRole('region', { name: 'NVG links', exact: true })).toHaveCount(0);
    await live.close();
  });
});
