// Runs the test script of every npm workspace, faster than `npm test --workspaces`: each script's checks
// (eslint, tsc and the like) run for several workspaces at once, then the test runs (vitest) one workspace
// after another, as before. Test runs stay serial because their timing tests are sensitive to load.
// A script that is not a plain `a && b && c` chain runs whole, serially, as npm would run it.
// EMC2_TEST_JOBS sets how many checks run at once (default: one per processor, at most 8); 1 gives the old order.
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import { delimiter, join } from 'node:path';
import { root } from './lib.mjs';

/** The workspace folders in the order of the root package.json's `workspaces` (globs with one `*`). */
export function workspaceDirs(rootDir = root) {
  const patterns = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8')).workspaces ?? [];
  const dirs = [];
  for (const pattern of patterns) {
    const star = pattern.split('/').indexOf('*');
    if (star < 0) {
      dirs.push(pattern);
      continue;
    }
    const parts = pattern.split('/');
    const base = parts.slice(0, star).join('/');
    const rest = parts.slice(star + 1).join('/');
    if (!existsSync(join(rootDir, base))) continue;
    for (const entry of readdirSync(join(rootDir, base), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
      dirs.push([base, entry, rest].filter(Boolean).join('/'));
    }
  }
  return dirs.filter((dir) => existsSync(join(rootDir, dir, 'package.json')));
}

/**
 * Splits a test script into checks and test runs. Returns undefined when the script is not a plain chain of
 * commands joined by `&&` (then it runs whole). Checks are the commands before the first test run (vitest).
 */
export function splitScript(script) {
  if (/[|;&<>`$()]/.test(script.replace(/&&/g, ''))) return undefined;
  const commands = script.split('&&').map((c) => c.trim());
  if (commands.some((c) => c === '')) return undefined;
  const first = commands.findIndex((c) => /^vitest(\s|$)/.test(c));
  if (first < 0) return { checks: [], tests: commands };
  if (commands.slice(first).some((c) => !/^vitest(\s|$)/.test(c))) return undefined;
  return { checks: commands.slice(0, first), tests: commands.slice(first) };
}

/** How many checks run at once. */
export function jobCount(env = process.env, cpus = availableParallelism()) {
  const asked = Number.parseInt(env.EMC2_TEST_JOBS ?? '', 10);
  if (Number.isInteger(asked) && asked >= 1) return asked;
  return Math.min(8, Math.max(1, cpus));
}

/** Runs one command line in a workspace, with the workspace's and the root's node_modules/.bin on the PATH. */
function runLine(dir, line, { capture }) {
  const cwd = join(root, dir);
  const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
  const env = { ...process.env, [pathKey]: [join(cwd, 'node_modules', '.bin'), join(root, 'node_modules', '.bin'), process.env[pathKey]].join(delimiter) };
  return new Promise((resolveRun) => {
    const child = spawn(line, { cwd, env, shell: true, stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', windowsHide: true });
    let output = '';
    if (capture) {
      child.stdout.on('data', (d) => { output += d; });
      child.stderr.on('data', (d) => { output += d; });
    }
    child.on('error', (e) => resolveRun({ code: 127, output: `${output}\nCould not run "${line}": ${e.message}` }));
    child.on('close', (code) => resolveRun({ code: code ?? 1, output }));
  });
}

/** Runs the workspaces' tests. Returns 0 when all passed, else the first failing exit code. */
export async function runWebTests() {
  const plans = [];
  for (const dir of workspaceDirs()) {
    const script = JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8')).scripts?.test;
    if (script) plans.push({ dir, script, split: splitScript(script) });
  }
  const jobs = jobCount();
  console.log(`\n==> web: checks of ${plans.length} workspaces, ${jobs} at a time; then the test runs one after another`);

  // Checks, several workspaces at once; each workspace's own checks stay in their order.
  const queue = plans.filter((p) => p.split && p.split.checks.length > 0);
  const failures = [];
  const started = Date.now();
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    for (let plan = queue.shift(); plan; plan = queue.shift()) {
      const t0 = Date.now();
      for (const line of plan.split.checks) {
        const { code, output } = await runLine(plan.dir, line, { capture: true });
        if (code !== 0) {
          failures.push({ dir: plan.dir, line, code, output });
          break;
        }
      }
      console.log(`    checks ${failures.some((f) => f.dir === plan.dir) ? 'FAILED' : 'passed'}: ${plan.dir} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    }
  }));
  console.log(`    all checks: ${((Date.now() - started) / 1000).toFixed(1)} s`);
  if (failures.length > 0) {
    for (const f of failures) console.error(`\n--- ${f.dir}: "${f.line}" failed (exit code ${f.code}) ---\n${f.output}`);
    return failures[0].code;
  }

  // Test runs, one workspace after another, streamed; scripts that are not plain chains run whole here.
  for (const plan of plans) {
    const lines = plan.split ? plan.split.tests : [plan.script];
    for (const line of lines) {
      console.log(`\n==> web test: ${plan.dir}: ${line}`);
      const { code } = await runLine(plan.dir, line, { capture: false });
      if (code !== 0) {
        console.error(`\nFAILED: ${plan.dir}: "${line}" (exit code ${code})`);
        return code;
      }
    }
  }
  return 0;
}
