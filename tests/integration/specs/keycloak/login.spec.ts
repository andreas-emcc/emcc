// Quick run: @login
import { expect, test } from '@playwright/test';
import { createSymbol } from '../../lib/live.mjs';
import { fillLoginForm, isLoginPage, useTestRealm, withLoginServer } from '../../lib/login';

// Login with OpenID Connect against a real Keycloak (T-043, ADR-0022, server/README.md "Login with
// OpenID Connect"). Runs only with run.mjs --keycloak; each test has a server of its own in the
// login mode, and the file a realm of its own.

const realm = useTestRealm();

test('without login, the API answers 401 and pages go to Keycloak; after login the user works under the IAM\'s id', async ({ browser }, testInfo) => {
  await withLoginServer(testInfo, browser, realm(), async ({ server, realm, logIn, newContext, api, live }) => {
    // Not logged in: /api/** answers 401 and never redirects; /api/health stays open.
    const anonymous = await fetch(`${server.baseUrl}/api/config`, { redirect: 'manual' });
    expect(anonymous.status, 'GET /api/config without login').toBe(401);
    expect((await fetch(`${server.baseUrl}/api/session`, { redirect: 'manual' })).status, 'GET /api/session without login').toBe(401);
    expect(await (await fetch(`${server.baseUrl}/api/health`)).json()).toMatchObject({ status: 'UP' });

    // A page goes to Keycloak's login page (a top-level navigation) and comes back to the page.
    const context = await newContext();
    const page = await context.newPage();
    await page.goto('/#settings');
    await expect.poll(() => isLoginPage(page, realm), { message: `Keycloak's login page, not ${page.url()}` }).toBe(true);
    expect(new URL(page.url()).searchParams.get('code_challenge_method'), 'PKCE').toBe('S256');
    await fillLoginForm(page, realm, 'admin');
    await page.waitForURL((url) => url.href.startsWith(server.baseUrl));
    await expect(page.getByRole('status', { name: 'Live picture' })).toHaveText('Live picture: connected');
    await expect(page.getByRole('status', { name: 'Login' })).toHaveText('Logged in as ita-admin');
    await expect(page.getByRole('button', { name: 'Log out' })).toBeVisible();

    // The user is Keycloak's sub, named by preferred_username, with the permissions of its groups.
    const config = await (await api(context, '/api/config')).json();
    expect(config.loginMode).toBe('oidc');
    expect(config.user).toMatchObject({ id: realm.users.admin.id, name: 'ita-admin' });
    expect(config.user.noLogin ?? false).toBe(false);
    expect([...config.user.permissions].sort()).toEqual(['layers.edit', 'objects.edit', 'settings.admin']);

    // Every change carries the user as source.user, set by the server.
    const client = await live(context);
    const snapshot = await client.subscribe();
    const request = createSymbol(snapshot.layers[0].id, 0, { name: 'by the admin' });
    request.source = { plugin: 'ita-test', user: 'someone-else' };
    const outcome = await client.change(request);
    expect(outcome.outcome).toBe('applied');
    expect(JSON.stringify(outcome.event)).not.toContain('someone-else');
    expect(outcome.event.by).toMatchObject({ plugin: 'ita-test', user: realm.users.admin.id });
    await client.close();

    // A second browser of the same user is a session of its own, with its own login.
    const second = await logIn('admin');
    await expect(second.page.getByRole('status', { name: 'Login' })).toHaveText('Logged in as ita-admin');
  });
});

test('"Log out" ends the session on the server and at Keycloak, and comes back through the login', async ({ browser }, testInfo) => {
  await withLoginServer(testInfo, browser, realm(), async ({ realm, logIn, api }) => {
    const { context, page } = await logIn('editor');
    expect(await realm.sessionsOf('editor'), 'one session at Keycloak').toHaveLength(1);
    const cookie = await api(context, '/api/session');
    expect(cookie.status, 'GET /api/session while logged in').toBe(200);
    const oldCookies = await context.cookies();

    await page.getByRole('button', { name: 'Log out' }).click();
    // Keycloak ends its session and returns to "/", which is not logged in any more: the login page.
    await expect.poll(() => isLoginPage(page, realm), { message: `Keycloak's login page after the logout, not ${page.url()}` }).toBe(true);
    await expect.poll(() => realm.sessionsOf('editor'), { message: 'no session at Keycloak after the logout' }).toHaveLength(0);
    expect((await realm.events('LOGOUT')).length, 'a LOGOUT event at Keycloak').toBeGreaterThanOrEqual(1);

    // The old session cookie no longer works.
    await context.clearCookies();
    await context.addCookies(oldCookies);
    expect((await api(context, '/api/session')).status, 'GET /api/session with the old cookie').toBe(401);
  });
});

test('Keycloak\'s back-channel logout ends that user\'s sessions at once: live picture closed with 4401, the shell asks to log in again; other users go on', async ({ browser }, testInfo) => {
  await withLoginServer(testInfo, browser, realm(), async ({ realm, logIn, api, live }) => {
    const editor = await logIn('editor');
    const editorAgain = await logIn('editor');
    const admin = await logIn('admin');
    const editorLive = await live(editor.context);
    const adminLive = await live(admin.context);
    expect(await realm.sessionsOf('editor'), 'two sessions at Keycloak').toHaveLength(2);

    // As an administrator ending the user's sessions in Keycloak: Keycloak calls the client's
    // back-channel logout URL for each.
    await realm.logOut('editor');

    expect(await editorLive.closed, 'the editor\'s live picture closes with 4401').toBe(4401);
    for (const { page } of [editor, editorAgain]) {
      await expect(page.getByRole('status', { name: 'Live picture' })).toHaveText('Live picture: your login has ended');
      await expect(page.getByRole('button', { name: 'Log in again' })).toBeVisible();
    }
    expect((await api(editor.context, '/api/session')).status, 'the editor\'s session').toBe(401);
    expect((await api(editorAgain.context, '/api/session')).status, 'the editor\'s second session').toBe(401);

    // The admin goes on.
    expect((await api(admin.context, '/api/session')).status, 'the admin\'s session').toBe(200);
    await expect(admin.page.getByRole('status', { name: 'Live picture' })).toHaveText('Live picture: connected');
    expect(adminLive.closeCode, 'the admin\'s live picture stays open').toBeUndefined();
    await adminLive.close();

    // "Log in again" goes through Keycloak's login page and back.
    await editor.page.getByRole('button', { name: 'Log in again' }).click();
    await expect.poll(() => isLoginPage(editor.page, realm)).toBe(true);
    await fillLoginForm(editor.page, realm, 'editor');
    await expect(editor.page.getByRole('status', { name: 'Live picture' })).toHaveText('Live picture: connected');
  });
});

test('a server with a wrong client secret shows a page that the login did not succeed, not a redirect loop', async ({ browser }, testInfo) => {
  await withLoginServer(
    testInfo,
    browser,
    realm(),
    async ({ server, realm, newContext }) => {
      const page = await (await newContext()).newPage();
      const documents: string[] = [];
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) documents.push(frame.url());
      });
      await page.goto('/');
      await expect.poll(() => isLoginPage(page, realm)).toBe(true);
      await fillLoginForm(page, realm, 'viewer');
      // Spring Security names the failed code exchange (invalid_token_response).
      await expect(page.getByText(/The login did not succeed \([a-z_]+\)\./)).toBeVisible();
      expect(page.url().startsWith(server.baseUrl), `on emc2's page, not ${page.url()}`).toBe(true);
      await expect(page.getByRole('link', { name: 'Try again' })).toHaveAttribute('href', '/');
      // It stays there: no further navigation back to Keycloak.
      const count = documents.length;
      await page.waitForTimeout(1_500); // nothing to wait for: proving that nothing happens
      expect(documents.length, `no navigation after the failure page (${documents.join(' → ')})`).toBe(count);
      expect(documents.filter((url) => isLoginUrl(url, realm.issuer)).length, 'Keycloak\'s login page shown once').toBe(1);
      expect((await realm.events('CODE_TO_TOKEN_ERROR')).length, 'Keycloak refused the code exchange').toBeGreaterThanOrEqual(1);
    },
    { clientSecret: 'not-the-client-secret', allowConsoleErrors: /status of 401/ },
  );
});

function isLoginUrl(url: string, issuer: string): boolean {
  return url.startsWith(`${issuer}/protocol/openid-connect/auth`);
}
