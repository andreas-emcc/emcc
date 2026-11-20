// Quick run: @login @settings @plugin-map-view-2d
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { useTestRealm, withLoginServer } from '../../lib/login';
import { createLayer } from '../../lib/live.mjs';
import { colourAround, frameSymbol, FRIEND, mapCentre, positionAt } from '../../lib/m0';

// M6's permissions with login against a real Keycloak (lib/keycloak.mjs USERS): Move to layer… and
// Copy to layer… (T-155, ADR-0053 point 5) need the edit permission for the workspace's objects
// (objects.edit in View), and Settings › Labeling (T-170) needs settings.admin. The browser only
// hides; the server decides (overview 4.4). Runs only with run.mjs --keycloak.

const realm = useTestRealm();

test('without objects.edit Move to layer… and Copy to layer… are not offered, and a move and a copy sent anyway are refused by the server', async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  await withLoginServer(testInfo, browser, realm(), async (run) => {
    const admin = await run.logIn('admin');
    const truth = await run.live(admin.context);
    const snapshot = await truth.subscribe();
    const drawing = snapshot.layers[0].id;
    const bravo = createLayer('ITA Bravo');
    expect((await truth.change(bravo)).outcome).toBe('applied');

    const { context, page } = await run.logIn('viewer');
    const centre = await mapCentre(page);
    const at = { x: centre.x - 160, y: centre.y + 40 };
    const symbol = frameSymbol(drawing, await positionAt(page, at), 'friend');
    expect((await truth.change(symbol)).outcome).toBe('applied');
    await expect.poll(() => colourAround(page, at, FRIEND), { timeout: 10_000, message: 'the symbol is drawn' }).toBeGreaterThan(50);
    await page.mouse.click(at.x, at.y, { button: 'right' });
    const menu = page.getByRole('menu', { name: 'Actions' });
    await expect(menu.getByRole('menuitem').first()).toBeVisible();
    const labels = (await menu.getByRole('menuitem').allTextContents()).map((t) => t.trim());
    expect(labels, 'no Move or Copy for the viewer').not.toContain('Move to layer…');
    expect(labels).not.toContain('Copy to layer…');
    expect(labels, "the map view's own actions need no permission").toContain('Centre on object(s)');
    await page.keyboard.press('Escape');

    // What the browser would send for a move and a copy (ADR-0053 points 2 and 3), sent anyway.
    const viewer = await run.live(context);
    await viewer.subscribe();
    const { found } = await truth.getObjects([symbol.entityId]);
    const { id, version, meta: _meta, ...content } = found[0];
    const move = await viewer.change({ requestId: randomUUID(), entityType: 'object', operation: 'update', entityId: id, baseVersion: version, data: { ...content, layerId: bravo.entityId }, source: { plugin: 'core-shell' } });
    expect(move, 'the move').toMatchObject({ outcome: 'rejected', rejection: { code: 'PERMISSION_DENIED' } });
    const copy = await viewer.change({ requestId: randomUUID(), entityType: 'object', operation: 'create', entityId: randomUUID(), data: { ...content, layerId: bravo.entityId, dataSource: 'manual' }, source: { plugin: 'core-shell' } });
    expect(copy, 'the copy').toMatchObject({ outcome: 'rejected', rejection: { code: 'PERMISSION_DENIED' } });
    expect((await truth.getObjects([symbol.entityId])).found[0].layerId, 'not moved').toBe(drawing);
    await viewer.close();
  });
});

test('Settings › Labeling is the admin\'s: without settings.admin GET and PUT /api/settings/labeling get 403', async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  await withLoginServer(testInfo, browser, realm(), async (run) => {
    const admin = await run.logIn('admin');
    expect((await run.api(admin.context, '/api/settings/labeling')).status, 'the admin reads it').toBe(200);
    for (const user of ['editor', 'viewer'] as const) {
      const { context } = await run.logIn(user);
      expect((await run.api(context, '/api/settings/labeling')).status, `${user}: GET`).toBe(403);
      const put = await run.api(context, '/api/settings/labeling', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ policies: {} }) });
      expect(put.status, `${user}: PUT`).toBe(403);
    }
  });
});
