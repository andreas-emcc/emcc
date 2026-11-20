// Quick run: @login @plugin-draw-shapes
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { useTestRealm, withLoginServer } from '../../lib/login';
import { colourAround, drag, mapCentre, positionAt, settle, userPause } from '../../lib/m0';

// draw-shapes without objects.edit (docs/plugins/briefs/draw-shapes.md, function 9 and acceptance
// criterion 12; T-056 part 3) with login against a real Keycloak: the test realm's viewer has no
// permissions. Runs only with run.mjs --keycloak.

const realm = useTestRealm();

test('criterion 12: without objects.edit no shape tool can be used, the hint is shown and Edit is not offered; a request the browser sends anyway is refused, and the refusal is shown', async ({
  browser,
}, testInfo) => {
  test.setTimeout(90_000);
  await withLoginServer(testInfo, browser, realm(), async (run) => {
    const admin = await run.logIn('admin');
    const truth = await run.live(admin.context);
    const snapshot = await truth.subscribe();
    const layer = snapshot.layers[0].id;

    const { context, page } = await run.logIn('viewer');
    const panel = page.getByRole('region', { name: 'Shapes', exact: true });
    await expect(panel.getByText('You may not edit objects')).toBeVisible();
    const tools = panel.getByRole('group', { name: 'Shape tools' }).getByRole('button');
    await expect(tools).toHaveCount(7);
    for (const tool of await tools.all()) await expect(tool, 'every tool switched off').toBeDisabled();

    // A filled circle the admin made, in the viewer's view: its menu has no Edit (nor Delete).
    const at = { x: (await mapCentre(page)).x - 120, y: (await mapCentre(page)).y + 60 };
    // About 30 px of radius, from the cursor display; an area is picked on its outline only (T-102), so the click is on the rim.
    const center = await positionAt(page, at);
    const rim = await positionAt(page, { x: at.x + 30, y: at.y });
    const circle = {
      requestId: randomUUID(),
      entityType: 'object',
      operation: 'create',
      entityId: randomUUID(),
      data: {
        type: 'core.shape',
        dataType: 'core.general',
        dataSource: 'manual',
        layerId: layer,
        geometry: { type: 'Circle', center, radius: Math.round((rim[0] - center[0]) * 111_320 * Math.cos((center[1] * Math.PI) / 180)) },
        style: { strokeColor: '#106010', strokeWidth: 2, fillColor: '#20c020', fillOpacity: 1 },
        properties: { name: "The admin's circle" },
        label: { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' },
      },
      source: { plugin: 'ita-test' },
    };
    expect((await truth.change(circle)).outcome).toBe('applied');
    await expect.poll(() => colourAround(page, at, [32, 192, 32]), { timeout: 10_000, message: 'the circle is drawn' }).toBeGreaterThan(50);
    await page.mouse.click(at.x + 30, at.y, { button: 'right' });
    const menu = page.getByRole('menu', { name: 'Actions' });
    await expect(menu.getByRole('menuitem').first()).toBeVisible();
    const labels = (await menu.getByRole('menuitem').allTextContents()).map((t) => t.trim());
    expect(labels, 'no Edit for the viewer').not.toContain('Edit');
    expect(labels).not.toContain('Delete');
    expect(labels, 'the map view\'s own actions need no permission').toContain('Centre on object(s)');
    await page.keyboard.press('Escape');

    // The browser only hides; the server decides (overview 4.4). The viewer's page is told it may
    // edit (its /api/config rewritten in this browser alone), so the tools work and the circle is
    // sent: the server refuses it, and the panel shows the refusal.
    await context.route('**/api/config', async (route) => {
      const response = await route.fetch();
      const config = await response.json();
      config.user.permissions = [...config.user.permissions, 'objects.edit'];
      await route.fulfill({ response, json: config });
    });
    await page.reload();
    await expect(page.getByRole('status', { name: 'Live picture' })).toHaveText('Live picture: connected');
    await expect(panel.getByText('You may not edit objects')).toHaveCount(0);
    await panel.getByRole('group', { name: 'Shape tools' }).getByRole('button', { name: 'Rectangle', exact: true }).click();
    const centre = await mapCentre(page);
    await drag(page, { x: centre.x + 60, y: centre.y - 60 }, { x: centre.x + 130, y: centre.y - 20 });
    await userPause(page);
    await expect(page.getByRole('list', { name: 'Notifications' })).toContainText('PERMISSION_DENIED');
    const created = (await settle(truth, layer)).filter((e: { operation: string; entityId: string }) => e.operation === 'create' && e.entityId !== circle.entityId);
    expect(created, 'nothing created by the viewer').toEqual([]);
    await truth.close();
  });
});
