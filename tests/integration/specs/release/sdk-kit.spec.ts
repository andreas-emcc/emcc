// Quick run: @release
// Quick run of this file alone, with a release zip of this platform and its SDK kit (node tools/release.mjs makes both):
//   $env:EMC2_RELEASE_ZIP = '<this checkout>\releases\<the release zip>'
//   $env:EMC2_SDK_KIT_ZIP = '<this checkout>\releases\<the emcc-sdk zip>'
//   node tests/integration/run.mjs --skip-build -- specs/release/sdk-kit.spec.ts
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, join, sep } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { isWindows } from '../../lib/processes.mjs';
import { logHolding, unpack, withRelease } from '../../lib/release';

// M9 T3 (the MCA's B5; plugin gap analysis G1): someone outside this repository builds a plugin with the SDK kit that
// ships next to the release (tools/sdk-kit.mjs; its README.md), and the release loads it. The kit and the release are
// unpacked into a folder of the system's temporary folder, outside the repository. Checked, as the kit's README says:
//  1. Maven: a local repository with no dev.emcc artifact but the kit's (a copy of the user's repository without
//     dev/emcc, then the kit's install-maven script): the template's server part builds offline (mvn -o verify), its
//     unit tests and InstalledPluginIT pass, and its jar is made;
//  2. npm: the web part installs from the kit's SDK package and npm's cache only (--offline; nothing is downloaded,
//     owner ABR A allowed downloads for the MCA only), npm test (eslint, tsc, vitest) and npm run build pass;
//  3. the release: the built plugin installed as plugins/template, started with -standalone, logs "Plugin template
//     0.1.0 started", its endpoint answers, and in a browser the shell loads its web part: the Template panel shows
//     the greeting from the settings and, asked, the server part's answer, with no console error.

test.describe.configure({ timeout: 900_000 });

const RELEASE = process.env.EMC2_RELEASE_ZIP ?? '';
const KIT = process.env.EMC2_SDK_KIT_ZIP ?? '';
const MAVEN_REPO = process.env.EMC2_MAVEN_REPO ?? join(homedir(), '.m2', 'repository');
const DEV_EMCC = `${sep}dev${sep}emcc`;

/** Runs a command line in `cwd`, its output kept in the test's output as `<name>.log`; returns the output. */
function run(name: string, command: string, cwd: string, { allowFailure = false } = {}): { status: number; output: string } {
  const result = spawnSync(command, { cwd, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, CI: 'true', NO_COLOR: '1' } });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  writeFileSync(test.info().outputPath(`${name}.log`), `> ${command}\n(in ${cwd})\n\n${output}`);
  if (!allowFailure) expect(result.status, `${command} in ${cwd} (see ${name}.log)`).toBe(0);
  return { status: result.status ?? -1, output };
}

test('the SDK kit builds the template outside the repository, offline, and the release loads it, its web part in the shell (M9 T3, B5)', async ({ page }) => {
  test.skip(RELEASE === '' || KIT === '', 'set EMC2_RELEASE_ZIP and EMC2_SDK_KIT_ZIP to a release zip of this platform and its SDK kit (node tools/release.mjs)');
  for (const zip of [RELEASE, KIT]) expect(existsSync(zip), `${zip} exists`).toBe(true);
  test.info().annotations.push({ type: 'zips', description: `${basename(RELEASE)}, ${basename(KIT)}` });
  // A short folder of the system's temporary folder (the release's start script and MAX_PATH; release-log.spec.ts).
  const base = mkdtempSync(join(tmpdir(), 'emcc-'));
  try {
    await checkKit(base, page);
  } finally {
    for (const name of readdirSync(base)) {
      const logs = join(base, name, 'logs');
      if (existsSync(logs)) cpSync(logs, test.info().outputPath('release-logs'), { recursive: true });
    }
    rmSync(base, { recursive: true, force: true });
  }
});

async function checkKit(base: string, page: Page) {
  const kit = unpack(KIT, join(base, 'kit'));
  const template = join(kit, 'template');
  for (const part of ['README.md', 'LICENSE', isWindows ? 'install-maven.bat' : 'install-maven.sh', 'template', 'schemas', 'maven']) {
    expect(existsSync(join(kit, part)), `the kit holds ${part}`).toBe(true);
  }
  const webSdk = readdirSync(join(kit, 'web'));
  expect(webSdk, 'the kit\'s web SDK package and import map').toEqual(expect.arrayContaining([expect.stringMatching(/^emc2-plugin-sdk-\d+\.\d+\.\d+\.tgz$/), 'importmap.json']));

  // 1. Maven: no dev.emcc artifact but the kit's.
  const repo = join(base, 'm2');
  expect(existsSync(MAVEN_REPO), `the user's Maven repository ${MAVEN_REPO} (the third-party artifacts, offline)`).toBe(true);
  cpSync(MAVEN_REPO, repo, { recursive: true, filter: (src) => !src.slice(MAVEN_REPO.length).startsWith(DEV_EMCC) });
  expect(existsSync(join(repo, 'dev', 'emcc')), 'no dev.emcc before the kit\'s install').toBe(false);
  // `.\`: cmd does not look in the current folder when NoDefaultCurrentDirectoryInExePath is set.
  run('install-maven', isWindows ? `.\\install-maven.bat "${repo}"` : `./install-maven.sh "${repo}"`, kit);
  expect(readdirSync(join(repo, 'dev', 'emcc')).sort(), 'only the kit\'s dev.emcc artifacts').toEqual(['emc2-plugin-parent', 'emc2-plugin-sdk', 'emc2-plugin-sdk-testkit']);
  const maven = run('mvn-verify', `mvn -B -o "-Dmaven.repo.local=${repo}" verify`, join(template, 'server')).output;
  expect(maven, 'BUILD SUCCESS').toContain('BUILD SUCCESS');
  // Surefire's and failsafe's summaries: "Tests run: N, Failures: 0, Errors: 0, Skipped: S" after "Results:".
  const totals = [...maven.matchAll(/Results:\s*(?:\[\w+\]\s*)*\s*(?:\[\w+\]\s*)?Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)/g)].map((m) => m.slice(1).map(Number));
  test.info().annotations.push({ type: 'Maven tests (run, failures, errors, skipped), unit then integration', description: JSON.stringify(totals) });
  expect(totals.length, 'the unit and the integration tests\' summaries').toBe(2);
  for (const [, failures, errors] of totals) expect([failures, errors], 'no failure, no error').toEqual([0, 0]);
  expect(totals[0][0], 'the unit tests ran').toBeGreaterThan(0);
  expect(maven, 'InstalledPluginIT ran').toMatch(/Running dev\.emcc\.[\w.]*InstalledPluginIT/);
  const jars = readdirSync(join(template, 'server', 'target')).filter((f) => /^emc2-plugin-template-.*\.jar$/.test(f) && !/(sources|javadoc)\.jar$/.test(f));
  expect(jars, 'the plugin\'s jar').toHaveLength(1);

  // 2. npm: offline, from the kit's SDK package and npm's cache.
  const web = join(template, 'web');
  const install = run('npm-install', 'npm install --offline --no-audit --no-fund', web, { allowFailure: true });
  if (install.status !== 0 && /ENOTCACHED/.test(install.output)) {
    throw new Error('npm\'s cache lacks a public package the template needs (see npm-install.log); a download needs the owner\'s go first');
  }
  expect(install.status, 'npm install --offline (see npm-install.log)').toBe(0);
  const tests = run('npm-test', 'npm test', web).output;
  test.info().annotations.push({ type: 'vitest', description: (/Tests\s+\d+ passed[^\n]*/.exec(tests) ?? ['?'])[0].trim() });
  run('npm-build', 'npm run build', web);
  const dist = join(web, 'dist');
  expect(readdirSync(dist), 'the built web part').toEqual(expect.arrayContaining(['plugin.json', 'index.js', 'template.css']));

  // 3. The release with the plugin, as the kit's README says: plugin.json from web/dist, server/ the jar, web/ the rest.
  const release = unpack(RELEASE, join(base, 'release'));
  const plugin = join(release, 'plugins', 'template');
  expect(existsSync(plugin), 'the release has no template of its own').toBe(false);
  mkdirSync(join(plugin, 'server'), { recursive: true });
  cpSync(join(dist, 'plugin.json'), join(plugin, 'plugin.json'));
  cpSync(join(template, 'server', 'target', jars[0]), join(plugin, 'server', jars[0]));
  cpSync(dist, join(plugin, 'web'), { recursive: true, filter: (src) => basename(src) !== 'plugin.json' });

  const consoleErrors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  const webPart: string[] = [];
  page.on('response', (r) => { if (/\/template\/.*\.(js|css)(\?|$)/.test(r.url())) webPart.push(`${r.status()} ${new URL(r.url()).pathname}`); });

  await withRelease(release, 'release', async (running) => {
    const url = `http://127.0.0.1:${running.port}`;
    const log = await logHolding(join(release, 'logs', 'emcc.log'), /Plugins: \d+ running/);
    const started = log.split(/\r?\n/).filter((l) => /Plugin template /.test(l)).map((l) => l.replace(/^.*? : /, ''));
    test.info().annotations.push({ type: 'the template in the release\'s log', description: started.join(' | ') });
    expect(started, 'Plugin template 0.1.0 started').toContainEqual(expect.stringMatching(/^Plugin template 0\.1\.0 started/));
    const plugins = await (await fetch(`${url}/api/plugins`)).json();
    const listed = (Array.isArray(plugins) ? plugins : plugins.plugins).find((p: { id: string }) => p.id === 'template');
    expect(listed, 'the template in /api/plugins').toBeTruthy();
    const greeting = await fetch(`${url}/api/plugins/template/greeting`);
    const answer = await greeting.text();
    expect(greeting.status, `its endpoint: ${answer}`).toBe(200);

    // The shell loads the web part: the Template panel with the settings' greeting, and the server's answer.
    await page.goto(url);
    let panel = page.getByRole('region', { name: 'Template', exact: true });
    const tab = page.getByRole('tab', { name: 'Template', exact: true });
    await expect(panel.or(tab).first(), 'the Template panel or its tab').toBeVisible({ timeout: 60_000 });
    if (!(await panel.isVisible())) {
      await tab.click();
      panel = page.getByRole('tabpanel', { name: 'Template', exact: true });
    }
    // A new panel may show collapsed: its heading's button expands it.
    const head = panel.getByRole('heading', { name: 'Template' }).getByRole('button', { name: 'Template', exact: true });
    if ((await head.count()) === 1 && (await head.getAttribute('aria-expanded')) !== 'true') await head.click();
    const greetingText = panel.getByText('Hello from the template', { exact: true });
    await expect(greetingText, 'the greeting from the settings, once').toHaveCount(1);
    await expect(greetingText, 'the greeting from the settings').toBeVisible();
    await panel.getByRole('button', { name: 'Ask the server', exact: true }).click();
    // The server part answers with the same greeting (the settings' default): it shows a second time, in a notice.
    expect(answer, 'the server part\'s greeting').toBe('Hello from the template');
    await expect(greetingText, 'the server part\'s answer shown as well').toHaveCount(2);
    await expect(greetingText.nth(1), 'the server part\'s answer').toBeVisible();
    test.info().annotations.push({ type: 'the web part loaded', description: `${webPart.join(', ')}; the server answered "${answer}"` });
    expect(webPart.filter((w) => !w.startsWith('200 ')), 'the web part\'s files load').toEqual([]);
    expect(webPart.some((w) => /index\.js/.test(w)), 'its entry module loaded').toBe(true);
    expect(consoleErrors, 'no console errors').toEqual([]);
  }, ['-standalone']);
}
