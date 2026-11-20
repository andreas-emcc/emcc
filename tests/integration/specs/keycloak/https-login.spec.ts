// Quick run: @login
import { expect, test } from '@playwright/test';
import { fillLoginForm, isLoginPage, useTestRealm, withLoginServer } from '../../lib/login';
import { settled } from '../../lib/collapsed';
import { mapPane } from '../../lib/m0';
import { testCaMissing, writeHttpsSettings } from '../../lib/test-ca.mjs';

// Login over HTTPS (M9 T1; ADR-0061 point 7, ADR-0022; server/README.md, "What T1 sees"): a server of the test's own
// in the login mode with the ESA's test CA certificate (external/test-ca/, E1), its realm's client pointed at its
// https:// address. Runs only with run.mjs --keycloak. Keycloak stays on http://localhost:8180; its back-channel
// logout to an https:// emcc is not tested here (Keycloak does not trust the test CA; the ESA's sheet, "One
// back-channel logout address").

test.skip(testCaMissing() !== undefined, testCaMissing() ?? '');
test.describe.configure({ timeout: 180_000 });

const realm = useTestRealm();
const https = (emcc: string) => void writeHttpsSettings(emcc, 'emcc-server', 'pkcs12');

test('login over HTTPS: OIDC\'s redirect is https://, the session cookie is Secure (and HttpOnly), the live picture runs over wss://, HSTS is sent; "Log out" ends the session and the old cookie no longer works', async ({ browser }, testInfo) => {
  await withLoginServer(testInfo, browser, realm(), async ({ server, realm, newContext, api }) => {
    expect(server.baseUrl, 'the server over HTTPS').toMatch(/^https:\/\//);
    const anonymous = await fetch(`${server.baseUrl}/api/config`, { redirect: 'manual' });
    expect(anonymous.status, 'GET /api/config without login').toBe(401);
    expect(anonymous.headers.get('strict-transport-security'), 'HSTS').toBe('max-age=31536000');

    const context = await newContext();
    const page = await context.newPage();
    const sockets: string[] = [];
    page.on('websocket', (socket) => sockets.push(socket.url()));
    const loaded = new Set<string>();
    page.on('response', (r) => {
      const m = /\/plugins\/([a-z0-9-]+)\/web\/index\.js$/.exec(r.url());
      if (m && r.ok()) loaded.add(m[1]);
    });
    await page.goto('/');
    await expect.poll(() => isLoginPage(page, realm), { message: `Keycloak's login page, not ${page.url()}` }).toBe(true);
    const redirect = new URL(page.url()).searchParams.get('redirect_uri') ?? '';
    testInfo.annotations.push({ type: 'redirect_uri', description: redirect });
    expect(redirect, 'OIDC\'s redirect is https:// to the server').toMatch(new RegExp(`^${server.baseUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/`));

    await fillLoginForm(page, realm, 'editor');
    await page.waitForURL((url) => url.href.startsWith(server.baseUrl));
    await expect(page.getByRole('status', { name: 'Live picture', includeHidden: true })).toHaveText('Live picture: connected', { timeout: 60_000 });
    await expect(page.getByRole('status', { name: 'Login', includeHidden: true })).toHaveText('Logged in as ita-editor');
    // Every plugin's web part loaded before the logout: the shell loads them one by one, and a logout during
    // their load gives 401s, as it should.
    const withWeb = ((await (await api(context, '/api/plugins')).json()) as Array<{ id: string; active: boolean; web?: unknown }>).filter((p) => p.active && p.web != null).map((p) => p.id).sort();
    await expect.poll(() => [...loaded].sort(), { timeout: 60_000, message: 'every web part loaded' }).toEqual(withWeb);
    await expect(mapPane(page).getByRole('button', { name: 'Coordinates', exact: true })).toBeVisible({ timeout: 60_000 });
    await settled(page, 60_000);
    expect(sockets.length, 'the live picture\'s socket').toBeGreaterThan(0);
    expect(sockets.filter((u) => !u.startsWith(server.baseUrl.replace(/^https/, 'wss'))), 'over wss:// on the HTTPS port').toEqual([]);

    const cookies = await context.cookies(server.baseUrl);
    testInfo.annotations.push({ type: 'cookies', description: JSON.stringify(cookies.map((c) => ({ name: c.name, secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite }))) });
    expect(cookies.length, 'a session cookie').toBeGreaterThan(0);
    expect(cookies.filter((c) => !c.secure).map((c) => c.name), 'every cookie Secure').toEqual([]);
    expect(cookies.filter((c) => !c.httpOnly).map((c) => c.name), 'every cookie HttpOnly').toEqual([]);
    expect((await api(context, '/api/session')).status, 'GET /api/session while logged in').toBe(200);

    await page.getByRole('button', { name: 'Log out' }).click();
    await expect.poll(() => isLoginPage(page, realm), { message: `Keycloak's login page after the logout, not ${page.url()}` }).toBe(true);
    await expect.poll(() => realm.sessionsOf('editor'), { message: 'no session at Keycloak after the logout' }).toHaveLength(0);
    await context.clearCookies();
    await context.addCookies(cookies);
    expect((await api(context, '/api/session')).status, 'GET /api/session with the old cookie').toBe(401);
  }, { https });
});
