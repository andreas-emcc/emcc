// Quick run: @release
// Quick run of this file alone, with a release zip of this platform (node tools/release.mjs):
//   $env:EMC2_RELEASE_ZIP = '<this checkout>\releases\<the zip>'
//   node tests/integration/run.mjs --skip-build -- specs/release/help-menu.spec.ts
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, cpSync, existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { freePort, unpack, withRelease } from '../../lib/release';

// The help menu of M9 RC2 (owner ACQ, 2026-11-18), against a built release zip (EMC2_RELEASE_ZIP; skipped without):
//  1. the release's version.properties (the MCA's tools/version-file.mjs) names the release as its zip's name does;
//  2. started with a login (emc2.login.mode=oidc in settings/emcc.properties, against an IAM double of this test that
//     serves only its discovery document; nobody logs in): GET /manual/ answers the shipped manual/index.html
//     without a session (GET and HEAD; /manual redirects to /manual/), while / goes to the login and the API answers
//     401, so the login is on; GET /api/health's "version" is the file's keys ({name, date, commit, dirty, sdk}; the
//     CDA's ReleaseInfo) and its "manual" is true;
//  3. started with -standalone, in a browser: the shell's "?" button (named "Help", web/shell/src/ui/HelpMenu.tsx)
//     opens the Help popover with the version line "emcc <name> · <date> · <commit>" (" · uncommitted changes" for a
//     dirty build; help.ts), and its "Manual" opens /manual/ in a new tab, the manual's contents page.
// The developer run's side (version "dev", "Manual" disabled) is flows/m9-help-menu.spec.ts's.

test.describe.configure({ timeout: 300_000 });

const ZIP = process.env.EMC2_RELEASE_ZIP ?? '';
const REALM = 'ita-help';

/** version.properties as a map. */
function properties(text: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const m = /^([^#!=\s][^=]*)=(.*)$/.exec(line);
    if (m) map[m[1].trim()] = m[2].trim();
  }
  return map;
}

/** An IAM double: only the discovery document, which the server reads at start (OidcConfiguration). */
async function startIam(): Promise<{ server: Server; issuer: string }> {
  const port = await freePort();
  const issuer = `http://127.0.0.1:${port}/realms/${REALM}`;
  const discovery = JSON.stringify({
    issuer,
    authorization_endpoint: `${issuer}/auth`,
    token_endpoint: `${issuer}/token`,
    jwks_uri: `${issuer}/jwks`,
    userinfo_endpoint: `${issuer}/userinfo`,
    end_session_endpoint: `${issuer}/logout`,
    response_types_supported: ['code'],
    subject_types_supported: ['public'],
    id_token_signing_alg_values_supported: ['RS256'],
    code_challenge_methods_supported: ['S256'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['client_secret_basic'],
  });
  const server = createServer((request, response) => {
    if (request.url === `/realms/${REALM}/.well-known/openid-configuration`) {
      response.writeHead(200, { 'content-type': 'application/json' }).end(discovery);
    } else {
      response.writeHead(404).end();
    }
  });
  await new Promise<void>((resolveListen) => server.listen(port, '127.0.0.1', resolveListen));
  return { server, issuer };
}

/** The "?" button's popover, opened, once the menu is in (health is asked each time it opens). */
async function openHelp(page: Page) {
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  const popover = page.getByRole('dialog', { name: 'Help' });
  await expect(popover.getByRole('menu', { name: 'Help' })).toBeVisible();
  return popover;
}

test('the release names its version in version.properties and GET /api/health, serves its manual at /manual/ without login, and the shell\'s "?" menu shows the version and opens the manual in a new tab (M9 RC2, owner ACQ)', async ({ page }) => {
  test.skip(ZIP === '', 'set EMC2_RELEASE_ZIP to a release zip of this platform (node tools/release.mjs)');
  expect(existsSync(ZIP), `EMC2_RELEASE_ZIP ${ZIP} exists`).toBe(true);
  test.info().annotations.push({ type: 'release zip', description: basename(ZIP) });
  // A short folder of the system's temporary folder (the start script and MAX_PATH; release-log.spec.ts).
  const base = mkdtempSync(join(tmpdir(), 'emcc-'));
  const iam = await startIam();
  try {
    await checkRelease(base, iam.issuer, page);
  } finally {
    iam.server.close();
    for (const name of readdirSync(base)) {
      const logs = join(base, name, 'logs');
      if (existsSync(logs)) cpSync(logs, test.info().outputPath('logs'), { recursive: true });
    }
    rmSync(base, { recursive: true, force: true });
  }
});

async function checkRelease(base: string, issuer: string, page: Page) {
  const folder = unpack(ZIP, base);

  // 1. The version file, and the zip's name: emcc-<version>-<date>-<commit>[-dirty]-<os>-<arch>.zip.
  const versionFile = join(folder, 'version.properties');
  expect(existsSync(versionFile), 'version.properties in the release root').toBe(true);
  const version = properties(readFileSync(versionFile, 'utf8'));
  test.info().annotations.push({ type: 'version.properties', description: JSON.stringify(version) });
  for (const key of ['emcc.version', 'emcc.build.date', 'emcc.build.commit', 'emcc.build.dirty', 'emcc.sdk.version']) {
    expect(version[key], `version.properties: ${key}`).toMatch(/^[A-Za-z0-9.-]+$/);
  }
  const dirty = version['emcc.build.dirty'] === 'true' ? '-dirty' : '';
  const quoted = (key: string) => version[key].replace(/\./g, '\\.');
  expect(basename(ZIP), "the zip's name is the file's version, date and commit").toMatch(
    new RegExp(`^emcc-${quoted('emcc.version')}-${quoted('emcc.build.date')}-${quoted('emcc.build.commit')}${dirty}-[a-z]+-[a-z0-9]+\\.zip$`),
  );
  expect(basename(folder), 'the folder it unpacks to is named as the zip').toBe(basename(ZIP, '.zip'));
  const manualIndex = join(folder, 'manual', 'index.html');
  expect(existsSync(manualIndex), 'the release ships manual/index.html').toBe(true);
  const shippedIndex = readFileSync(manualIndex, 'utf8');

  // 2. With a login: the settings decide (no -standalone); nobody logs in.
  const settings = join(folder, 'settings', 'emcc.properties');
  const shipped = readFileSync(settings, 'utf8');
  writeFileSync(settings, `${shipped.replace(/\s*$/, '')}\n# The ITA's help menu test: a login against the test's IAM double.\nemc2.login.mode=oidc\nemc2.login.oidc.issuer-uri=${issuer}\nemc2.login.oidc.client-id=emc2\n`);
  const credentials = join(folder, 'settings', 'credentials');
  mkdirSync(credentials, { recursive: true });
  // Not a secret: the IAM double checks no client (it has no token endpoint).
  writeFileSync(join(credentials, 'login.properties'), '# the ITA\'s IAM double checks no client secret\nemc2.login.oidc.client-secret=ita-no-secret\n');
  await withRelease(folder, 'login', async (run) => {
    const url = `http://127.0.0.1:${run.port}`;
    // As a browser asks (a page): a request without text/html gets 401 instead.
    const root = await fetch(`${url}/`, { redirect: 'manual', headers: { accept: 'text/html' } });
    expect(root.status, 'the login is on: / goes to the login').toBe(302);
    expect(root.headers.get('location') ?? '', 'to the login').toMatch(/oauth2\/authorization\/emc2|\/login/);
    expect((await fetch(`${url}/api/monitor`, { redirect: 'manual' })).status, 'the login is on: the API answers 401').toBe(401);

    const slashless = await fetch(`${url}/manual`, { redirect: 'manual' });
    expect(slashless.status, '/manual redirects').toBeGreaterThanOrEqual(301);
    expect(slashless.status).toBeLessThanOrEqual(308);
    expect(new URL(slashless.headers.get('location') ?? '', url).pathname, 'to /manual/').toBe('/manual/');
    expect((await fetch(`${url}/manual/`, { method: 'HEAD', redirect: 'manual' })).status, 'HEAD /manual/ without login').toBe(200);
    const manual = await fetch(`${url}/manual/`, { redirect: 'manual' });
    expect(manual.status, 'GET /manual/ without login').toBe(200);
    expect(manual.headers.get('content-type') ?? '', 'as HTML').toMatch(/^text\/html/);
    expect(await manual.text(), "the manual's index, as shipped").toBe(shippedIndex);
    const chapter = readdirSync(join(folder, 'manual')).find((f) => /^\d.*\.html$/.test(f));
    if (chapter) expect((await fetch(`${url}/manual/${chapter}`, { redirect: 'manual' })).status, `a chapter, ${chapter}, without login`).toBe(200);

    const health = await (await fetch(`${url}/api/health`)).json();
    test.info().annotations.push({ type: 'GET /api/health (login)', description: JSON.stringify(health) });
    expect(health.status).toBe('UP');
    expect(health.version, "GET /api/health's version is the file's").toEqual({
      name: version['emcc.version'],
      date: version['emcc.build.date'],
      commit: version['emcc.build.commit'],
      dirty: version['emcc.build.dirty'] === 'true',
      sdk: version['emcc.sdk.version'],
    });
    expect(health.manual, 'the release has its manual').toBe(true);
  });
  writeFileSync(settings, shipped);
  rmSync(join(credentials, 'login.properties'));

  // 3. Standalone, in a browser: the version line and the manual in a new tab.
  await withRelease(folder, 'standalone', async (run) => {
    const url = `http://127.0.0.1:${run.port}`;
    await page.goto(url);
    const popover = await openHelp(page);
    const line = `emcc ${version['emcc.version']} · ${version['emcc.build.date']} · ${version['emcc.build.commit']}${version['emcc.build.dirty'] === 'true' ? ' · uncommitted changes' : ''}`;
    await expect(popover.locator('.help-version'), 'the version line').toHaveText(line);
    test.info().annotations.push({ type: 'the "?" menu', description: (await popover.innerText()).replace(/\s+/g, ' ').trim() });
    const manualItem = popover.getByRole('menuitem', { name: 'Manual', exact: true });
    await expect(manualItem).toBeEnabled();
    const [tab] = await Promise.all([page.context().waitForEvent('page'), manualItem.click()]);
    await tab.waitForLoadState();
    expect(new URL(tab.url()).pathname, 'the new tab opens /manual/').toMatch(/^\/manual\/(index\.html)?$/);
    await expect(tab, "the manual's contents page").toHaveTitle(/emcc User Manual/);
    expect(page.url(), 'the shell stays in its own tab').toMatch(new RegExp(`^${url}/`));
    await tab.close();
  }, ['-standalone']);
}
