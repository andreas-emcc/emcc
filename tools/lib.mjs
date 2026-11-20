// Shared helpers for the emc2 build scripts. Plain Node.js, no dependencies.
// Works on Windows and Linux: commands are run without a shell wrapper where possible.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const isWindows = process.platform === 'win32';

export const hasServer = () => existsSync(join(root, 'server', 'pom.xml'));
// The npm workspace root is the repository root (CR-0006): it holds web/shell, web/plugin-sdk and plugins/*/web.
export const hasWeb = () => existsSync(join(root, 'package.json'));

/**
 * The plugins' own Node checks, `plugins/<id>/check/*.test.mjs` (for example a manifest check of a plugin without a web
 * part, which has no npm workspace), as paths relative to `base`, sorted. Empty when there are none.
 */
export function pluginCheckFiles(base = root) {
  const plugins = join(base, 'plugins');
  if (!existsSync(plugins)) return [];
  const files = [];
  for (const id of readdirSync(plugins, { withFileTypes: true })) {
    if (!id.isDirectory()) continue;
    const check = join(plugins, id.name, 'check');
    if (!existsSync(check)) continue;
    for (const f of readdirSync(check, { withFileTypes: true })) {
      if (f.isFile() && f.name.endsWith('.test.mjs')) files.push(`plugins/${id.name}/check/${f.name}`);
    }
  }
  return files.sort();
}

/** Quotes an argument for cmd.exe when it contains spaces or other special characters. */
function quoteForCmd(arg) {
  return /^[\w@%+=:,./\\-]+$/.test(arg) ? arg : `"${arg.replace(/"/g, '""')}"`;
}

/** Runs a command in `cwd`, streaming output. Returns the exit code. */
export function run(label, command, args, cwd = root) {
  console.log(`\n==> ${label}: ${command} ${args.join(' ')}   (in ${cwd})`);
  // .cmd launchers (mvn, npm) need a shell on Windows. Node warns (DEP0190) when arguments are
  // passed separately together with a shell, so on Windows one quoted command line is passed.
  const result = isWindows
    ? spawnSync([command, ...args].map(quoteForCmd).join(' '), { cwd, stdio: 'inherit', shell: true })
    : spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) {
    console.error(`Could not run "${command}": ${result.error.message}. Is it installed and on the PATH?`);
    return 127;
  }
  return result.status ?? 1;
}

/**
 * Runs the steps in order and exits on the first failure. `after` (optional) runs once all steps passed and
 * returns a list of problems; any problem fails the run.
 */
export function runAll(steps, after = () => []) {
  if (steps.length === 0) {
    console.log('Nothing to do: neither server/pom.xml nor the root package.json exists yet.');
    return;
  }
  runSteps(steps);
  const problems = after();
  if (problems.length > 0) {
    console.error(`\nFAILED: ${problems.length} problem(s) after the steps`);
    process.exit(1);
  }
  console.log('\nOK');
}

/** Runs the steps in order and exits on the first failure. */
export function runSteps(steps) {
  for (const [label, command, args, cwd] of steps) {
    const code = run(label, command, args, cwd);
    if (code !== 0) {
      console.error(`\nFAILED: ${label} (exit code ${code})`);
      process.exit(code);
    }
  }
}

export function serverSteps(goals) {
  return hasServer() ? [['server (Maven)', 'mvn', ['-B', '-f', join(root, 'server', 'pom.xml'), ...goals]]] : [];
}

export function webSteps(...npmArgs) {
  const cwd = root;
  if (!hasWeb()) return [];
  return [
    ['web (npm install)', 'npm', ['install'], cwd],
    ...npmArgs.map((a) => [`web (npm ${a.join(' ')})`, 'npm', a, cwd]),
  ];
}

/** The data model's schema tests (model/, owned by the PDA). Installs exactly what its lock file says. */
export function modelSteps() {
  const cwd = join(root, 'model');
  if (!existsSync(join(cwd, 'package.json'))) return [];
  return [
    ['model (npm ci)', 'npm', ['ci'], cwd],
    ['model (npm test)', 'npm', ['test'], cwd],
  ];
}
