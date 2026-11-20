// Quick run: @login
import { expect, test } from '@playwright/test';
import { createSymbol } from '../../lib/live.mjs';
import { useTestRealm, withLoginServer } from '../../lib/login';

// The login session renewing and ending at the IAM (T-043, ADR-0022, server/README.md "Login with
// OpenID Connect"). The realm's access tokens last 20 s here, less than Spring Security's 60 s
// margin, so every request with login renews through Keycloak. Runs only with run.mjs --keycloak.

const LIFESPAN_S = 20;
const realm = useTestRealm({ accessTokenLifespan: LIFESPAN_S });

test('the shell\'s keep-alive renews the login at Keycloak; the page keeps working past several token lifetimes', async ({ browser }, testInfo) => {
  test.setTimeout(150_000);
  await withLoginServer(testInfo, browser, realm(), async ({ realm, logIn, api, live }) => {
    const { context, page } = await logIn('editor');
    const loggedInAt = Date.now();
    const before = (await realm.events('REFRESH_TOKEN')).length;

    // Nothing but the page runs now: its keep-alive (GET /api/session, every minute) is the only
    // request, and with tokens of 20 s each one renews at Keycloak.
    await expect
      .poll(async () => (await realm.events('REFRESH_TOKEN')).length, { message: 'a renewal at Keycloak from the shell\'s keep-alive', timeout: 80_000, intervals: [2_000] })
      .toBeGreaterThan(before);
    const renewedAfter = (Date.now() - loggedInAt) / 1000;
    testInfo.annotations.push({ type: 'renewal', description: `first renewal seen ${renewedAfter.toFixed(0)} s after the login` });
    expect(renewedAfter, 'by the keep-alive after about a minute, not at once').toBeGreaterThan(LIFESPAN_S);

    // More than three token lifetimes after the login the session is valid, with a fresh token,
    // and the user can still change the picture.
    const session = await api(context, '/api/session');
    expect(session.status).toBe(200);
    const { expiresAt } = await session.json();
    expect(Date.parse(expiresAt), 'the access token expires in the future').toBeGreaterThan(Date.now());
    expect(Date.parse(expiresAt) - loggedInAt, 'a token issued well after the login').toBeGreaterThan(3 * LIFESPAN_S * 1000);
    await expect(page.getByRole('status', { name: 'Live picture' })).toHaveText('Live picture: connected');
    const client = await live(context);
    const snapshot = await client.subscribe();
    expect((await client.change(createSymbol(snapshot.layers[0].id, 0))).outcome).toBe('applied');
    await client.close();
  });
});

test('a user disabled at Keycloak: the next renewal is refused, the session ends (401, live picture 4401, the shell asks to log in again)', async ({ browser }, testInfo) => {
  await withLoginServer(testInfo, browser, realm(), async ({ realm, logIn, api, live }) => {
    const viewer = await logIn('viewer');
    const admin = await logIn('admin');
    const viewerLive = await live(viewer.context);
    expect((await api(viewer.context, '/api/session')).status).toBe(200);
    const refusedBefore = (await realm.events('REFRESH_TOKEN_ERROR')).length;

    await realm.setEnabled('viewer', false);

    // The next request renews (tokens of 20 s) and Keycloak refuses: the login ends.
    expect((await api(viewer.context, '/api/session')).status, 'GET /api/session after the user was disabled').toBe(401);
    expect(await viewerLive.closed, 'the viewer\'s live picture closes with 4401').toBe(4401);
    await expect(viewer.page.getByRole('status', { name: 'Live picture' })).toHaveText('Live picture: your login has ended');
    await expect(viewer.page.getByRole('button', { name: 'Log in again' })).toBeVisible();
    expect((await realm.events('REFRESH_TOKEN_ERROR')).length, 'Keycloak refused a renewal').toBeGreaterThan(refusedBefore);

    // Another user goes on.
    expect((await api(admin.context, '/api/session')).status, 'the admin\'s session').toBe(200);
    await expect(admin.page.getByRole('status', { name: 'Live picture' })).toHaveText('Live picture: connected');
  });
});
