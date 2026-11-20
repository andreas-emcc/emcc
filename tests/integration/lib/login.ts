import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isExternal } from '../fixtures';
import { expandWhenCollapsed } from './collapsed';
import { startFakeTiles } from './fake-tiles.mjs';
import { KeycloakAdmin, keycloakUrl, NOT_ASKED, type TestRealm, USERS } from './keycloak.mjs';
import { LiveClient } from './live.mjs';
import { checkLogExpecting } from './log-check.mjs';
import { openApp } from './m0';
import { installPlugins } from './plugins.mjs';
import { installTestPlugin } from './test-plugins.mjs';
import { emccFolderOf, makeRunFolders, startServer } from './server.mjs';

// Helpers for the login tests against a real Keycloak (T-043, ADR-0022): a test realm per spec
// file, servers of the test's own in the login mode, browsers that log in at Keycloak's page.

export type UserKey = keyof typeof USERS;
type LoginServer = Awaited<ReturnType<typeof startServer>>;

/**
 * The login specs' test realms are `emc2-ita-<UTC time>-<random>`, one per spec file and run, so
 * that runs in parallel on the shared Keycloak never touch each other's realm (T-124).
 */
export const TEST_REALM_PREFIX = 'emc2-ita-';
/** A test realm left behind by a run that was killed is deleted by a later run once it is this old. */
const STALE_REALM_MS = 24 * 60 * 60 * 1000;

/** A new test realm name, e.g. emc2-ita-20261031-101500-3f9a0c1d. */
export function testRealmName(now = new Date()): string {
  const stamp = now.toISOString().slice(0, 19).replace(/[-:]/g, '').replace('T', '-');
  return `${TEST_REALM_PREFIX}${stamp}-${randomBytes(4).toString('hex')}`;
}

/** The time (ms) in a test realm's name, or null for any other name. */
export function testRealmTime(name: string): number | null {
  const m = /^emc2-ita-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-[0-9a-f]{8}$/.exec(name);
  return m === null ? null : Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

/**
 * Declares the spec file's realm: skips every test of the file with a clear message unless the
 * login tests were asked for (run.mjs --keycloak), makes a realm of its own with a new name before
 * the first test and deletes it after the last. Test realms older than a day (of killed runs) are
 * deleted first. Returns a getter for the realm.
 */
export function useTestRealm(options: { accessTokenLifespan?: number } = {}): () => TestRealm {
  let realm: TestRealm | undefined;
  test.skip(keycloakUrl() === undefined, NOT_ASKED);
  test.beforeAll(async () => {
    const admin = await KeycloakAdmin.connect();
    for (const name of await admin.realmNames()) {
      const time = testRealmTime(name);
      if (time !== null && Date.now() - time > STALE_REALM_MS) await admin.deleteRealm(name);
    }
    realm = await admin.createRealm({ realm: testRealmName(), ...options });
  });
  test.afterAll(async () => {
    await realm?.delete();
  });
  return () => realm!;
}

export type LoginRun = {
  server: LoginServer;
  realm: TestRealm;
  /** A new browser context that has logged in as the user at Keycloak, on the loaded app. */
  logIn: (user: UserKey) => Promise<{ context: BrowserContext; page: Page }>;
  /** A new browser context, not logged in, guarded like the others. */
  newContext: () => Promise<BrowserContext>;
  /** The Cookie header of a context's session with the server. */
  cookieOf: (context: BrowserContext) => Promise<string>;
  /** A request to the server with that session (Node's fetch: no Origin header). */
  api: (context: BrowserContext, path: string, init?: RequestInit) => Promise<Response>;
  /** A live picture connection with that session (and the server's own Origin, as a browser's). */
  live: (context: BrowserContext) => Promise<LiveClient>;
};

export type LoginOptions = {
  /** Start the server with this client secret instead of the realm's (a wrong one). */
  clientSecret?: string;
  /** Log lines this test expects (each must appear; only they are tolerated as problems). */
  expectedLog?: RegExp[];
  /** Console errors of emc2 pages this test expects. */
  allowConsoleErrors?: RegExp;
  /** The ITA's test plugins with a server part to install as well (fixtures/plugins, lib/test-plugins.mjs). */
  testPlugins?: string[];
  /** More permissions by group than lib/keycloak.mjs's PERMISSIONS_BY_GROUP, e.g. a test plugin's. */
  permissions?: Record<string, string[]>;
  /**
   * HTTPS with the ESA's test CA (ADR-0061, M9 T1): this function writes the server's https.properties into its emcc folder
   * (lib/test-ca.mjs), the server and the realm's redirect are https://, and the browsers ignore the certificate.
   */
  https?: (emccFolder: string) => void;
};

/**
 * Runs `body` against a server of its own in the login mode, with every assembled plugin
 * (basemap-osm on a local fake tile server) and the realm's client pointed at it. Browser contexts
 * made through the run may reach only this server and Keycloak, and Keycloak only for page
 * navigations and the pages Keycloak serves (its login and logout pages); emc2's pages must not
 * log console errors. A server with login has no stop endpoint (it is the dev profile's): it is
 * ended with a hard kill, and its log is checked as usual.
 */
export async function withLoginServer(testInfo: TestInfo, browser: Browser, realm: TestRealm, body: (run: LoginRun) => Promise<void>, options: LoginOptions = {}): Promise<void> {
  const tiles = await startFakeTiles();
  const folders = makeRunFolders();
  const contexts: Array<{ context: BrowserContext; blocked: string[]; errors: string[] }> = [];
  let server: LoginServer | undefined;
  let failure: unknown;
  try {
    installPlugins(folders.pluginsDir, { tileTemplate: tiles.template });
    for (const id of options.testPlugins ?? []) installTestPlugin(folders.pluginsDir, id);
    const login = realm.serverLogin(options.clientSecret === undefined ? {} : { clientSecret: options.clientSecret });
    for (const [permission, groups] of Object.entries(options.permissions ?? {})) login.args.push(`--emc2.login.oidc.permissions[${permission}]=${groups.join(',')}`);
    const logFile = testInfo.outputPath('server-1.log');
    testInfo.annotations.push({ type: 'server log', description: logFile });
    options.https?.(emccFolderOf(folders.dataDir));
    server = await startServer({ dataDir: folders.dataDir, pluginsDir: folders.pluginsDir, logFile, extraArgs: login.args, env: login.env, login: true, https: options.https !== undefined });
    await realm.pointAt(server.baseUrl);
    const started = server;
    const keycloak = new URL(realm.issuer).origin;

    const newContext = async () => {
      const context = await browser.newContext({ baseURL: started.baseUrl, serviceWorkers: 'block', ignoreHTTPSErrors: options.https !== undefined });
      const blocked: string[] = [];
      const errors: string[] = [];
      const serverUrl = new URL(started.baseUrl);
      const external = (url: URL) => isExternal(url, serverUrl);
      await context.route(external, async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        let fromKeycloak = false;
        try {
          fromKeycloak = new URL(request.frame().url()).origin === keycloak;
        } catch {
          // No frame (e.g. a worker's request): not a Keycloak page.
        }
        if (url.origin === keycloak && (request.isNavigationRequest() || fromKeycloak)) {
          await route.continue();
          return;
        }
        blocked.push(request.url());
        await route.abort('blockedbyclient');
      });
      await context.routeWebSocket(external, async (ws) => {
        blocked.push(ws.url());
        await ws.close();
      });
      context.on('console', (message) => {
        if (message.type() !== 'error') return;
        const page = message.page();
        if (page !== null && !page.url().startsWith(started.baseUrl)) return; // Keycloak's pages are not emc2's
        if (options.allowConsoleErrors?.test(message.text())) return;
        errors.push(`console.error: ${message.text()} (${page?.url() ?? '?'})`);
      });
      context.on('weberror', (error) => errors.push(`uncaught: ${error.error().message}`));
      // Every page of the run, logged in through logIn or not: collapsed side panels and settings
      // entries (T-153, T-161) are opened as on openApp's pages (lib/collapsed). The 'page' event
      // comes before newPage returns, so the handler is there before the spec's first step.
      context.on('page', (page) => void expandWhenCollapsed(page).catch(() => {}));
      contexts.push({ context, blocked, errors });
      return context;
    };

    const logIn = async (user: UserKey) => {
      const context = await newContext();
      const page = await context.newPage();
      await logInAt(page, realm, user, started.baseUrl);
      await openApp(page);
      return { context, page };
    };

    const cookieOf = async (context: BrowserContext) => {
      const cookies = await context.cookies(started.baseUrl);
      return cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    };
    const api = async (context: BrowserContext, path: string, init: RequestInit = {}) =>
      fetch(`${started.baseUrl}${path}`, { ...init, redirect: 'manual', headers: { ...(init.headers as Record<string, string>), Cookie: await cookieOf(context) } });
    // With login the handshake needs a browser's Origin as well as the cookie (LoginHandshakeInterceptor).
    const live = async (context: BrowserContext) => LiveClient.open(started.baseUrl, { headers: { Cookie: await cookieOf(context), Origin: started.baseUrl } });

    await body({ server: started, realm, logIn, newContext, cookieOf, api, live });
  } catch (error) {
    failure = error;
  }
  for (const { context, blocked, errors } of contexts) {
    try {
      await context.close();
      expect(blocked, 'requests to anything but the emc2 server and Keycloak pages (ADR-0014)').toEqual([]);
      expect(errors, 'browser console errors on emc2 pages').toEqual([]);
    } catch (error) {
      if (failure === undefined) failure = error;
      else testInfo.annotations.push({ type: 'also failed', description: String(error) });
    }
  }
  try {
    if (server) {
      await server.kill(); // no stop endpoint with login
      const { missing, unexpected } = checkLogExpecting(readFileSync(server.logFile, 'utf8'), options.expectedLog ?? []);
      if (failure === undefined) {
        expect(missing.map(String), `expected but missing in ${server.logFile}`).toEqual([]);
        expect(unexpected, `problems in ${server.logFile}`).toEqual([]);
      }
    }
  } catch (error) {
    if (failure === undefined) failure = error;
  } finally {
    await tiles.close();
  }
  if (failure !== undefined && testInfo.expectedStatus === 'failed') {
    folders.remove(); // a known gap (test.fail): nothing to look into
    throw failure;
  }
  if (failure !== undefined) {
    testInfo.annotations.push({ type: 'kept folders', description: folders.base });
    console.error(`[${testInfo.title}] failed; kept its data and plugin folders: ${folders.base}`);
    throw failure;
  }
  folders.remove();
}

/** Keycloak's login page for the realm, as the browser reaches it from emc2. */
export function isLoginPage(page: Page, realm: TestRealm): boolean {
  return page.url().startsWith(`${realm.issuer}/protocol/openid-connect/auth`) || page.url().startsWith(`${realm.issuer}/login-actions/`);
}

/**
 * Opens emc2, which sends the browser to Keycloak's login page; logs in there as the user, as a
 * person would, and waits until the browser is back on emc2.
 */
export async function logInAt(page: Page, realm: TestRealm, user: UserKey, baseUrl: string): Promise<void> {
  await page.goto('/');
  await expect.poll(() => isLoginPage(page, realm), { message: `Keycloak's login page, not ${page.url()}` }).toBe(true);
  await fillLoginForm(page, realm, user);
  await page.waitForURL((url) => url.href.startsWith(baseUrl));
}

export async function fillLoginForm(page: Page, realm: TestRealm, user: UserKey): Promise<void> {
  await page.getByLabel('Username or email').fill(realm.users[user].username);
  await page.getByLabel('Password', { exact: true }).fill(realm.users[user].password);
  await page.getByRole('button', { name: 'Sign In' }).click();
}

/** The top bar's view tabs, by name. */
export async function viewTabs(page: Page): Promise<string[]> {
  return page.getByRole('tablist', { name: 'Views' }).getByRole('tab').allTextContents();
}
