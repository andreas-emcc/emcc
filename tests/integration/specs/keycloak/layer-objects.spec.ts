// Quick run: @login @settings
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createLayer, createSymbol } from '../../lib/live.mjs';
import { useTestRealm, withLoginServer } from '../../lib/login';

// T-175 with login against a real Keycloak (lib/keycloak.mjs USERS): Settings › Layers' "Delete all
// objects" needs the shared Delete's right, objects.edit in View (owner A1). The setter has
// settings.admin only: it sees the Settings workspace and a layer's objects, but no "Delete all
// objects", and the server refuses its delete. The admin has both. Runs only with run.mjs --keycloak.

const realm = useTestRealm();

test('Settings › Layers with login (T-175): without objects.edit "Delete all objects" is not shown, the objects are still listed, and the server refuses the delete; the admin, with objects.edit, gets it', async ({ browser }, testInfo) => {
  await withLoginServer(testInfo, browser, realm(), async (run) => {
    const admin = await run.logIn('admin');
    const live = await run.live(admin.context);
    await live.subscribe();
    const layer = createLayer('ITA rights', { drawOrder: 7 });
    expect((await live.change(layer)).outcome).toBe('applied');
    const objects = [createSymbol(layer.entityId, 0, { name: 'Right 1' }), createSymbol(layer.entityId, 1, { name: 'Right 2' })];
    for (const r of objects) expect((await live.change(r)).outcome).toBe('applied');

    const setter = await run.logIn('setter');
    const config = await (await run.api(setter.context, '/api/config')).json();
    expect(config.user.permissions, 'settings.admin only').toEqual(['settings.admin']);
    await setter.page.goto('/#settings/layers');
    const card = setter.page.getByRole('article', { name: 'ITA rights', exact: true });
    await expect(card).toContainText('NATO UNCLASSIFIED · 2 objects');
    await expect(card.getByRole('button', { name: 'Delete all objects' }), 'not shown without objects.edit').toHaveCount(0);
    await expect(card, 'nor its note').not.toContainText("Deleting all objects also deletes a data link's live tracks");
    await card.getByRole('button', { name: 'Show objects', exact: true }).click();
    // Sorted: the list is in id order, and two UUID v7 ids made in one millisecond are not ordered (MCA, M7 RC1 run).
    await expect.poll(() => card.getByRole('table', { name: 'Objects of ITA rights', exact: true }).getByRole('rowheader').allTextContents().then((names) => names.sort()), { message: 'listed all the same' }).toEqual(['Right 1', 'Right 2']);
    // The server checks every delete: the setter's is refused, whatever the browser shows.
    const setterLive = await run.live(setter.context);
    const refused = await setterLive.change({ requestId: randomUUID(), entityType: 'object', operation: 'delete', entityId: objects[0].entityId, source: { plugin: 'core-shell' } });
    expect(refused, 'the setter\'s delete').toMatchObject({ outcome: 'rejected', rejection: { code: 'PERMISSION_DENIED' } });
    await setterLive.close();

    await admin.page.goto('/#settings/layers');
    const adminCard = admin.page.getByRole('article', { name: 'ITA rights', exact: true });
    await expect(adminCard).toContainText('NATO UNCLASSIFIED · 2 objects');
    await expect(adminCard.getByRole('button', { name: 'Delete all objects', exact: true }), 'the admin, with objects.edit').toBeEnabled();
    await live.close();
  });
});
