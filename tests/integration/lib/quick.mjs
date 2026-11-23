// The quick run's selection (T-063; agents/ita.md "Quick and full runs", agents/mca.md merge
// procedure step 3). Given the paths a branch changes, it decides between the quick and the full
// run and, for a quick run, which spec files run. Mechanical, so that the MCA gets the same answer
// every time; every decision comes with its reason. Plain Node.js.
//
// Each spec file declares its areas in a line near its top:  // Quick run: @plugin-cot @tak
// "@always" files run in every quick run; a changed plugin selects the files of "@plugin-<id>";
// a changed spec file selects itself; a changed fixture selects the files that use it. A test that
// is too slow for a quick run carries Playwright's tag "@full" and runs only in the full run.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const integration = join(here, '..');
const repository = join(integration, '..', '..');
const SPECS = join(integration, 'specs');

/** The tag of tests that run only in the full run. */
export const FULL_ONLY = '@full';

/** The areas a spec file may name. */
export const AREAS = new Set([
  '@always', // every quick run: smoke, offline, the basic server and live picture API
  '@live',
  '@persistence',
  '@settings',
  '@limits',
  '@login',
  '@tak',
  '@harness',
  '@release', // a built release zip (specs/release/, skipped without EMC2_RELEASE_ZIP; T-187)
  '@performance',
  '@streams', // the streams to a plugin's web part (SDK 1.8.0 part E1, T-208)
]);
const PLUGIN_AREA = /^@plugin-([a-z0-9-]+)$/;

/** Fixtures and the spec files that use them (spec files relative to specs/). */
export const FIXTURES = {
  'plugins/ita-limits': ['flows/m1-settings.spec.ts', 'harness/log-check.spec.ts', 'limits/caps.spec.ts', 'limits/sdk-version.spec.ts', 'limits/watchdog.spec.ts'],
  'plugins/ita-listener': ['tak/listener.spec.ts'],
  'plugins/ita-stream': ['flows/m8-streams.spec.ts', 'keycloak/streams.spec.ts', 'live/streams.spec.ts'],
  'plugins/ita-probe': [
    'criteria/map-view-2d.spec.ts',
    'criteria/selection.spec.ts',
    'criteria/symbology.spec.ts',
    'flows/m2-actions.spec.ts',
    'flows/m2-bookmarks.spec.ts',
    'flows/m2-objects.spec.ts',
    'flows/m2-shapes.spec.ts',
    'flows/m3-drag.spec.ts',
    'flows/m3-sim-panels.spec.ts',
  ],
  'data/m0': ['live/persistence.spec.ts'],
};

/**
 * The full-run rule of agents/mca.md (merge procedure, step 3), for the paths of the branch
 * (Markdown files are left out before). Returns the reason for a full run, or null.
 */
export function fullRunReason(path, pomOnlyAddsModules) {
  if (path === 'server/pom.xml') return pomOnlyAddsModules ? null : 'server/pom.xml changes more than plugin module lines';
  if (path.startsWith('server/')) return 'server/ (ECore, the edge, the Java SDK)';
  if (path.startsWith('web/shell/') || path.startsWith('web/plugin-sdk/')) return 'the web shell or the web SDK';
  if (path.startsWith('web/')) return 'web/ outside the shell and the SDK (not mapped)';
  if (path.startsWith('model/')) return 'model/';
  if (path.startsWith('tools/')) return 'tools/';
  if (!path.includes('/')) return 'a file at the repository root';
  if (path.startsWith('tests/integration/') && !path.startsWith('tests/integration/specs/') && !path.startsWith('tests/integration/fixtures/') && !isMassTest(path)) {
    return 'the test runner or shared test code (tests/integration/ outside specs/ and fixtures/)';
  }
  return null;
}

/**
 * Paths that never need tests of their own: Markdown anywhere (agents/mca.md leaves it out), and
 * the documentation folders docs/ and documents/ whatever their files. Other files of agents/ or
 * .claude/ (settings, scripts) are not covered, so they give the full run.
 */
function isDocumentation(path) {
  return path.endsWith('.md') || path.startsWith('docs/') || path.startsWith('documents/');
}

/**
 * The multi-instance mass test (tests/integration/mass/): never part of a quick or full run, it has its own command
 * and the owner approves each run, so a change to it needs no run (MCA, 2026-11-21, owner AEE A).
 */
function isMassTest(path) {
  return path.startsWith('tests/integration/mass/');
}

/** Every spec file of the normal runs (not performance), relative to specs/, with its areas. */
export function specAreas() {
  const files = [];
  for (const folder of readdirSync(SPECS)) {
    if (folder === 'performance') continue;
    for (const name of readdirSync(join(SPECS, folder))) {
      if (!name.endsWith('.spec.ts')) continue;
      const file = `${folder}/${name}`;
      const line = /^\/\/ Quick run: (.*)$/m.exec(readFileSync(join(SPECS, file), 'utf8'));
      files.push({ file, areas: line ? line[1].trim().split(/\s+/) : [] });
    }
  }
  return files.sort((a, b) => a.file.localeCompare(b.file));
}

/** Problems with the areas the spec files declare (none expected; checked by the harness specs). */
export function areaProblems(specs = specAreas()) {
  const problems = [];
  for (const { file, areas } of specs) {
    if (areas.length === 0) problems.push(`${file}: no "// Quick run:" line`);
    for (const area of areas) {
      if (!AREAS.has(area) && !PLUGIN_AREA.test(area)) problems.push(`${file}: unknown area ${area}`);
    }
  }
  for (const [fixture, files] of Object.entries(FIXTURES)) {
    for (const file of files) if (!specs.some((s) => s.file === file)) problems.push(`fixture ${fixture}: no spec file ${file}`);
  }
  return problems;
}

/**
 * Decides the run for a list of changed paths (repository-relative, forward slashes; `deleted`
 * lists those the branch removes). Resolves with
 * { mode: 'quick' | 'full', reasons: [path, decision][], files: [spec files relative to specs/], needsRun }.
 * needsRun is false when every path is documentation or the mass test: such a branch needs no ITA run
 * (agents/mca.md; the mass test, owner AEE A), and the quick run's files are only what it would run if asked.
 */
export function selectRun(paths, { pomOnlyAddsModules = false, addedModules = [], deleted = new Set(), specs = specAreas() } = {}) {
  const reasons = [];
  const chosen = new Set(specs.filter((s) => s.areas.includes('@always')).map((s) => s.file));
  let full = false;
  let needsRun = false;
  const byPlugin = (id) => specs.filter((s) => s.areas.includes(`@plugin-${id}`)).map((s) => s.file);
  const choosePlugin = (path, id) => {
    const files = byPlugin(id);
    for (const file of files) chosen.add(file);
    reasons.push([path, files.length > 0 ? `plugin ${id}: ${files.join(', ')}` : `plugin ${id}: no specs of its own (the @always files load every plugin)`]);
  };
  for (const path of paths) {
    if (isDocumentation(path)) {
      reasons.push([path, 'documentation: no tests']);
      continue;
    }
    if (isMassTest(path)) {
      reasons.push([path, 'the mass test: no tests (its own command, run when the owner approves)']);
      continue;
    }
    needsRun = true;
    const fullReason = fullRunReason(path, pomOnlyAddsModules);
    if (fullReason) {
      full = true;
      reasons.push([path, `FULL: ${fullReason}`]);
      continue;
    }
    if (path === 'server/pom.xml') {
      for (const id of addedModules) choosePlugin(path, id); // only plugin module lines added
      continue;
    }
    const plugin = /^plugins\/([^/]+)\//.exec(path);
    if (plugin) {
      if (plugin[1] === '_template') reasons.push([path, 'the plugin template is never assembled: no tests']);
      else choosePlugin(path, plugin[1]);
      continue;
    }
    const spec = /^tests\/integration\/specs\/(.+)$/.exec(path);
    if (spec) {
      if (spec[1].startsWith('performance/')) reasons.push([path, 'performance suite: its own option (--performance)']);
      else if (!spec[1].endsWith('.spec.ts')) {
        full = true;
        reasons.push([path, 'FULL: a file in specs/ that is not a spec file']);
      } else if (deleted.has(path)) reasons.push([path, 'spec file deleted']);
      else {
        chosen.add(spec[1]);
        reasons.push([path, 'changed spec file: runs']);
      }
      continue;
    }
    const fixture = /^tests\/integration\/fixtures\/(plugins\/[^/]+|data\/[^/]+)\//.exec(path);
    if (fixture && FIXTURES[fixture[1]]) {
      for (const file of FIXTURES[fixture[1]]) chosen.add(file);
      reasons.push([path, `fixture ${fixture[1]}: ${FIXTURES[fixture[1]].join(', ')}`]);
      continue;
    }
    full = true;
    reasons.push([path, 'FULL: not covered by the quick run mapping']);
  }
  return { mode: full ? 'full' : 'quick', reasons, files: full ? [] : [...chosen].sort(), needsRun };
}

function git(args) {
  return execFileSync('git', args, { cwd: repository, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/**
 * The run for a branch: the paths of `git diff <base>...<head>` (the changes since the merge
 * base, as the merge would bring them).
 */
export function selectForBranch(base, head = 'HEAD') {
  const range = `${base}...${head}`;
  const lines = git(['diff', '--name-status', '--no-renames', range]).split('\n').filter(Boolean);
  const paths = [];
  const deleted = new Set();
  for (const line of lines) {
    const [status, path] = line.split('\t');
    paths.push(path);
    if (status === 'D') deleted.add(path);
  }
  let pomOnlyAddsModules = false;
  const addedModules = [];
  if (paths.includes('server/pom.xml')) {
    const changed = git(['diff', '-U0', range, '--', 'server/pom.xml'])
      .split('\n')
      .filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l));
    const module = /^([+-])\s*<module>\.\.\/plugins\/([a-z0-9-]+)\/server<\/module>\s*$/;
    pomOnlyAddsModules = changed.length > 0 && changed.every((l) => module.test(l) && l.startsWith('+'));
    for (const l of changed) {
      const m = module.exec(l);
      if (m && m[1] === '+') addedModules.push(m[2]);
    }
  }
  return { range, ...selectRun(paths, { pomOnlyAddsModules, addedModules, deleted }) };
}

/** The selection as text, for the runner's output and --explain. */
export function describe(selection) {
  const lines = [`Changes ${selection.range ?? ''}: ${selection.reasons.length} path(s)`];
  for (const [path, reason] of selection.reasons) lines.push(`  ${path}  →  ${reason}`);
  if (selection.needsRun === false) lines.push('Decision: NO ITA run needed (only documentation or the mass test); if one is asked for, the quick run below.');
  if (selection.mode === 'full') lines.push('Decision: FULL run (a path above needs it).');
  else {
    lines.push(`Decision: QUICK run, ${selection.files.length} spec file(s), without the tests tagged ${FULL_ONLY}:`);
    for (const file of selection.files) lines.push(`  specs/${file}`);
  }
  return lines.join('\n');
}

export function specPath(file) {
  return relative(integration, join(SPECS, file)).replaceAll('\\', '/');
}
