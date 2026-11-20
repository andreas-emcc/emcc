// The multi-instance mass test (owner, 2026-11-20; mass/PLAN.md): N emcc instances exchange a known set of objects
// over every link that carries them. Its own command, never part of the quick or the full run. The owner approves
// each mass run.
//
// Usage: node tests/integration/mass/run.mjs [options]
//   --build                  build first (node tools/build.mjs); otherwise the existing build is used
//   --release <zip>          start the instances from a release zip (also EMC2_RELEASE_ZIP) instead of the tree
//   --instances N            instances, linked pairwise (default 2)
//   --phases 1,2,3[,4]       phases (default 1,2,3)
//   --links cot,nvg,gmti     links (default all of them)
//   --objects N              symbols per instance (default 25; the graphics stay 12)
//   --move-interval s        phase 2's interval (default 2)
//   --duration s             phases 2 and 3's length each (default 120)
//   --share p                phase 2: the share of each instance's symbols moved each time (default 0.2)
//   --both                   phase 3 in every instance, not only in A
//   --direct-cot             cot over UDP between the instances instead of through the ESA's TAK Server
//   --echo                   phase 1's echo variant: a received cot layer is also sent on
//   --conflict               phase 2's variant: an instance also moves its copy of another instance's symbol
//   --seed n                 the moves' order (default 1)
//   --keep                   keep the instances' folders after a passing run
// Outside folders, by environment variable only (README "Run"): EMC2_EXTERNAL_ROOT (the TAK client certificates),
// EMC2_RELEASE_ZIP.
//
// Writes report.json and report.md to tests/integration/out/mass-<time>/. Exit code 0 only if every check passed.
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { closedOf, spawnGroup } from '../lib/processes.mjs';
import { root } from '../lib/server.mjs';

const here = resolve(fileURLToPath(import.meta.url), '..', '..');
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) {
    console.error(`${name} needs a value`);
    process.exit(2);
  }
  return v;
};
const number = (name, fallback, min) => {
  const n = Number(value(name, String(fallback)));
  if (!Number.isFinite(n) || n < min) {
    console.error(`${name}: a number of at least ${min}`);
    process.exit(2);
  }
  return n;
};
const list = (name, fallback, allowed) => {
  const items = value(name, fallback).split(',').map((s) => s.trim()).filter(Boolean);
  const wrong = items.filter((s) => !allowed.includes(s));
  if (wrong.length > 0) {
    console.error(`${name}: ${wrong.join(', ')} not one of ${allowed.join(', ')}`);
    process.exit(2);
  }
  return items;
};

const params = {
  instances: number('--instances', 2, 2),
  phases: list('--phases', '1,2,3', ['1', '2', '3', '4']).map(Number),
  links: list('--links', 'cot,nvg,gmti', ['cot', 'nvg', 'gmti', 'fmv']),
  objects: number('--objects', 25, 1),
  moveInterval: number('--move-interval', 2, 0.2),
  duration: number('--duration', 120, 10),
  share: number('--share', 0.2, 0),
  both: flag('--both'),
  directCot: flag('--direct-cot'),
  echo: flag('--echo'),
  conflict: flag('--conflict'),
  seed: number('--seed', 1, 0),
  keep: flag('--keep'),
  release: value('--release', process.env.EMC2_RELEASE_ZIP ?? ''),
};
if (params.phases.includes(4)) {
  console.error('Phase 4 (video) is not written yet: run phases 1 to 3 (mass/PLAN.md, section 5).');
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const out = join(here, 'out', `mass-${stamp}`);
mkdirSync(out, { recursive: true });

function runNode(script, scriptArgs, cwd, env = {}) {
  const child = spawnGroup(process.execPath, [script, ...scriptArgs], { cwd, stdio: 'inherit', env: { ...process.env, ...env } });
  return closedOf(child).then((code) => (typeof code === 'number' ? code : 1));
}

if (flag('--build')) {
  console.log('==> Build (node tools/build.mjs)');
  if ((await runNode(join(root, 'tools', 'build.mjs'), [], root)) !== 0) process.exit(1);
}
const cli = join(here, 'node_modules', '@playwright', 'test', 'cli.js');
if (!existsSync(cli)) {
  console.error('Playwright is not installed in tests/integration (npm ci there)');
  process.exit(1);
}
const minutes = Math.round((3 + params.instances + (params.phases.includes(2) ? params.duration / 60 + 1 : 0) + (params.phases.includes(3) ? params.duration / 60 + 1 : 0)) * 10) / 10;
console.log(`==> The mass run: ${JSON.stringify(params)}`);
console.log(`    about ${minutes} min; output ${out}`);
const code = await runNode(cli, ['test', '-c', join('mass', 'playwright.config.ts')], here, {
  EMC2_MASS: JSON.stringify(params),
  EMC2_OUT: out,
});
console.log(code === 0 ? `PASS. Report: ${join(out, 'report.md')}` : `FAIL (exit code ${code}). Report: ${join(out, 'report.md')}`);
process.exit(code === 0 ? 0 : 1);
