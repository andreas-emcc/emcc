// One-command integration test run (ITA): build, start the server, run the tests, stop it,
// check the server log. Plain Node.js, works on Windows and Linux.
//
// Usage: node tests/integration/run.mjs [--skip-build] [--keep] [--performance] [--keycloak | --no-keycloak]
//          [--multicast-interface <name>] [-- <Playwright arguments>]
//   --skip-build   use the existing build (server/app/target/emc2-app.jar, web/shell/dist)
//   --keep         keep the temporary data and plugin folders (they are kept anyway on failure)
//   --performance  run only the performance suite (specs/performance/, measures, takes long)
//   (neither)      the login specs (specs/keycloak/) run when the ESA's Keycloak runs (its status
//                  command, external/keycloak/status.mjs), else they are skipped and the run says why
//   --keycloak     run them in any case: the run fails if Keycloak does not answer or refuses the
//                  admin login. To run only them: --keycloak -- specs/keycloak
//   --no-keycloak  skip them
//                  Keycloak is at EMC2_KEYCLOAK_URL, default http://localhost:8180; the admin login
//                  is the ESA's for tests (lib/keycloak.mjs, T-069)
//   --multicast-interface <name>
//                  the network interface (as Java names it) for the multicast tests; by default the
//                  loopback interface when it supports multicast (lib/multicast.mjs); without one
//                  they are skipped, with the reason printed
//   --quick --changed <base-ref>
//                  the quick run (T-063): the spec files that the paths of git diff <base-ref>...HEAD
//                  select (lib/quick.mjs, README "Quick run"), without the tests tagged @full; a
//                  path that needs the full run makes it a full run. It prints what it chose and why.
//   --explain --changed <base-ref> [--head <ref>]
//                  only prints that choice for <base-ref>...<ref> (default HEAD) and exits
//   after "--"     passed to "playwright test", e.g. -- specs/smoke --grep health
//
// Exit code 0 only if the build, the server start, every test, the graceful stop, the check for
// servers left running and the server log check pass. 130 after Ctrl+C or SIGTERM.
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startFakeTiles } from './lib/fake-tiles.mjs';
import { checkLog } from './lib/log-check.mjs';
import { adminCredentials, KeycloakAdmin, keycloakStatus, NOT_ASKED } from './lib/keycloak.mjs';
import { describe, FULL_ONLY, selectForBranch, specPath } from './lib/quick.mjs';
import { assembledPlugins, installPlugins } from './lib/plugins.mjs';
import { closedOf, interruptTree, isAlive, killTree, spawnGroup } from './lib/processes.mjs';
import { testCaEnvironment } from './lib/test-ca.mjs';
import { findMulticastInterface, multicastEnvironment } from './lib/multicast.mjs';
import { jarPath, killAll, makeRunFolders, root, startServer, sweepRegistry, webRoot } from './lib/server.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const runs = join(here, 'out');
const KEEP_RUNS = 10;
const INTERRUPT_GRACE_MS = 15_000;

// Every run writes into a folder of its own, so parallel runs never share output.
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const out = join(runs, `run-${stamp}-${process.pid}`);
const serverLog = join(out, 'server.log');
// The run's temporary data and plugin folders, its own and the tests' (lib/server.mjs): kept with
// the run's output, so a folder kept after a failure is pruned with its run.
const runFolders = join(out, 'folders');
const registry = join(out, 'servers');

const args = process.argv.slice(2);
const dashes = args.indexOf('--');
const own = dashes < 0 ? args : args.slice(0, dashes);
const playwrightArgs = dashes < 0 ? [] : args.slice(dashes + 1);
const skipBuild = own.includes('--skip-build');
const keep = own.includes('--keep');
const performance = own.includes('--performance');
const valueOf = (name) => {
  const at = own.indexOf(name);
  return at >= 0 ? own[at + 1] : undefined;
};
const quick = own.includes('--quick');
const explain = own.includes('--explain');
const changedBase = valueOf('--changed');
const multicastName = valueOf('--multicast-interface');
const keycloakAddress = (process.env.EMC2_KEYCLOAK_URL || 'http://localhost:8180').replace(/\/+$/, '');
/** 'required' with --keycloak, 'off' with --no-keycloak, else 'auto': by Keycloak's status command. */
const keycloakMode = own.includes('--keycloak') ? 'required' : own.includes('--no-keycloak') ? 'off' : 'auto';
/** Keycloak's address once the login specs run, else undefined. */
let keycloak;
/** Why the login specs are skipped, for the run's log. */
let keycloakSkipped = 'run.mjs --no-keycloak';

if ((quick || explain) && (!changedBase || changedBase.startsWith('--'))) {
  console.error('--quick and --explain need --changed <base-ref>, e.g. --changed main');
  process.exit(2);
}
if (quick && (performance || own.includes('--head'))) {
  console.error('--quick runs HEAD and the normal suites: not with --performance or --head (--head is for --explain)');
  process.exit(2);
}
if (explain) {
  console.log(describe(selectForBranch(changedBase, valueOf('--head') ?? 'HEAD')));
  process.exit(0);
}

const failures = [];
let server;
let folders;
/** The fake tile server that basemap-osm fetches from instead of OpenStreetMap. */
let tiles;
/** The child the runner is waiting for (the build or Playwright), if any. */
let current;
let interrupted = false;
/** Aborted on the first signal, so that a server start in progress ends at once. */
const interruption = new AbortController();

function step(label) {
  console.log(`\n==> ${label}`);
}

/** Runs a Node.js script as a child the runner can stop. Resolves with its exit code. */
async function runNode(script, scriptArgs, cwd, env = process.env) {
  const child = spawnGroup(process.execPath, [script, ...scriptArgs], {
    cwd,
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  current = child;
  let spawnError;
  child.once('error', (error) => (spawnError = error));
  const code = await closedOf(child);
  current = undefined;
  if (spawnError) {
    console.error(`Could not run "${script}": ${spawnError.message}`);
    return 127;
  }
  return code ?? 1;
}

// Ctrl+C, Ctrl+Break, SIGTERM or a closed console or terminal (SIGHUP): stop the child the runner
// waits for, or the server start in progress; main() then stops the server and cleans up as usual.
// A second signal kills everything at once.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(signal, () => {
    if (interrupted) {
      console.error(`\n${signal} again: killing everything.`);
      try {
        if (current) killTree(current.pid);
        killAll();
        sweepRegistry(registry);
      } finally {
        process.exit(130);
      }
    }
    interrupted = true;
    interruption.abort();
    console.error(`\n${signal}: stopping the tests and the server (again to kill at once).`);
    if (current) {
      const child = current;
      interruptTree(child.pid);
      setTimeout(() => {
        if (isAlive(child.pid)) killTree(child.pid);
      }, INTERRUPT_GRACE_MS).unref();
    }
  });
}

/** Keeps the newest runs. A folder that cannot be removed (e.g. a file open on Windows) stays. */
function pruneOldRuns() {
  const old = readdirSync(runs)
    .filter((name) => name.startsWith('run-') && join(runs, name) !== out)
    .sort()
    .slice(0, -(KEEP_RUNS - 1) || undefined);
  for (const name of old) {
    try {
      rmSync(join(runs, name), { recursive: true, force: true });
    } catch (error) {
      console.warn(`Could not remove the old run folder ${name}: ${error.message}`);
    }
  }
}

async function main() {
  mkdirSync(out, { recursive: true });
  pruneOldRuns();
  console.log(`Output of this run: ${out}`);

  if (!existsSync(join(here, 'node_modules', '@playwright', 'test'))) {
    failures.push('Playwright is not installed: run "npm ci" and "npx playwright install chromium" in tests/integration');
    return;
  }

  let quickFiles;
  if (quick) {
    step(`Choose the run (--quick --changed ${changedBase})`);
    const selection = selectForBranch(changedBase);
    if (selection.mode === 'quick') quickFiles = selection.files;
    console.log(describe(selection));
    if (selection.mode === 'quick') playwrightArgs.unshift(...selection.files.map(specPath), '--grep-invert', FULL_ONLY);
    else console.log('So this is the full run: every suite as without --quick.');
  }

  const loginSpecsInRun = !performance && (quickFiles === undefined || quickFiles.some((f) => f.startsWith('keycloak/')));
  let useKeycloak = keycloakMode === 'required';
  if (keycloakMode === 'auto' && loginSpecsInRun) {
    step('Does the ESA\'s Keycloak run? (node external/keycloak/status.mjs)');
    const status = keycloakStatus();
    console.log(status.line);
    useKeycloak = status.running;
    if (!status.running) keycloakSkipped = `the ESA's Keycloak does not run (${status.line})`;
    // No admin login named (EMC2_KEYCLOAK_ADMIN*, or EMC2_EXTERNAL_ROOT with the ESA's keycloak.json; owner ADN A):
    // skipped with the reason, as without Keycloak. A login that is named but fails still fails the run below.
    if (useKeycloak) {
      try {
        adminCredentials();
      } catch (error) {
        useKeycloak = false;
        keycloakSkipped = error.message;
      }
    }
  }
  if (useKeycloak) {
    step(`Check Keycloak at ${keycloakAddress}${keycloakMode === 'required' ? ' (--keycloak)' : ''}`);
    try {
      await KeycloakAdmin.connect(keycloakAddress, adminCredentials());
      keycloak = keycloakAddress;
      console.log('Reachable, and the admin login works.');
    } catch (error) {
      failures.push(`Keycloak: ${error.message}`);
      return;
    }
  }

  if (!skipBuild) {
    step('Build (node tools/build.mjs)');
    if ((await runNode(join(root, 'tools', 'build.mjs'), [], root)) !== 0) {
      failures.push('build');
      return;
    }
  }
  if (interrupted) return;
  if (!existsSync(jarPath)) {
    failures.push(`no server jar at ${jarPath} (build first)`);
    return;
  }
  if (!existsSync(join(webRoot, 'index.html'))) {
    failures.push(`no ${join(webRoot, 'index.html')} (build first)`);
    return;
  }

  folders = makeRunFolders('emc2-ita-', runFolders);
  step('Install the assembled plugins (build/plugins/)');
  tiles = await startFakeTiles();
  const installed = installPlugins(folders.pluginsDir, { tileTemplate: tiles.template });
  if (assembledPlugins().length === 0) console.warn('No assembled plugins in build/plugins/: the server runs without plugins.');
  else console.log(`Installed: ${installed.join(', ')} (basemap-osm fetches from the fake tile server ${tiles.url})`);

  step(`Start the server (data and plugins in ${folders.base})`);
  try {
    server = await startServer({
      dataDir: folders.dataDir,
      pluginsDir: folders.pluginsDir,
      logFile: serverLog,
      signal: interruption.signal,
    });
  } catch (error) {
    if (!interrupted) failures.push(`server start: ${error.message}`);
    return;
  }
  console.log(`Server healthy on ${server.baseUrl}`);

  try {
    if (!interrupted) {
      step('Run the tests (playwright test)');
      if (!keycloak && loginSpecsInRun) console.log(`Login specs (specs/keycloak/) skipped: ${keycloakSkipped}. ${NOT_ASKED}`);
      const multicast = findMulticastInterface(multicastName);
      console.log(multicast.skip ? `Multicast tests skipped: ${multicast.skip}` : `Multicast tests on the interface ${multicast.name} (${multicast.address})`);
      const cli = join(here, 'node_modules', '@playwright', 'test', 'cli.js');
      const code = await runNode(cli, ['test', ...playwrightArgs], here, {
        ...process.env,
        EMC2_BASE_URL: server.baseUrl,
        EMC2_OUT: out,
        EMC2_SERVER_REGISTRY: registry,
        EMC2_FAKE_TILES: tiles.url,
        EMC2_PERFORMANCE: performance ? '1' : '0',
        EMC2_KEYCLOAK_URL: keycloak ?? '',
        ...multicastEnvironment(multicast),
        // The ESA's test CA, the trust of the HTTPS specs' servers (lib/test-ca.mjs; M9 E1).
        ...testCaEnvironment(),
      });
      if (code !== 0 && !interrupted) failures.push(`tests (exit code ${code})`);
    }
  } finally {
    step('Stop the server (POST /api/dev/stop)');
    const stopped = await server.stop();
    console.log(stopped.detail);
    if (!stopped.graceful && !interrupted) failures.push(`graceful stop: ${stopped.detail}`);
  }

  step('Check for temporary folders that tests left');
  // A test removes its folders when it passes and keeps them when it fails; after passing tests
  // every folder but the runner's own is one a test forgot.
  let left = [];
  try {
    left = readdirSync(runFolders).filter((name) => name !== basename(folders.base));
  } catch {
    // No folder made at all.
  }
  if (left.length === 0) console.log('None.');
  else {
    for (const name of left) console.error(`  ${join(runFolders, name)}`);
    if (!interrupted && !failures.some((f) => f.startsWith('tests'))) failures.push(`${left.length} temporary folder(s) left by passing tests`);
  }

  step('Check for servers that tests left running');
  // After an interrupt these are the servers of the tests that were stopped: reported, not failed.
  const leftovers = sweepRegistry(registry);
  for (const { pid, logFile, dataDir, state, error } of leftovers) {
    if (error) {
      console.error(`  registry entry ${pid} could not be read: ${error}`);
      continue;
    }
    const what = { killed: 'still running, killed now', 'not running': 'no longer running', 'not verified': 'still running, but could not verify that it is an emc2 server: not killed, check it' };
    console.error(`  pid ${pid}, ${what[state]}`);
    console.error(`    log: ${logFile}`);
    console.error(`    data folder kept: ${dataDir}`);
  }
  if (leftovers.length > 0 && !interrupted) failures.push(`${leftovers.length} server(s) left running by tests`);
  else if (leftovers.length === 0) console.log('None.');

  step('Check the server log');
  const problems = checkLog(readFileSync(serverLog, 'utf8'));
  if (problems.length > 0) {
    console.error(`${problems.length} problem(s) in ${serverLog}:`);
    for (const line of problems) console.error(`  ${line}`);
    failures.push('server log contains errors or warnings with a stack trace');
  } else {
    console.log('No error lines and no warnings with a stack trace.');
  }
}

try {
  await main();
} catch (error) {
  failures.push(`runner: ${error.message}`);
} finally {
  await tiles?.close();
}
if (folders) {
  if (keep || interrupted || failures.length > 0) console.log(`\nKept the run's data and plugin folders: ${folders.base}`);
  else folders.remove();
}
// The exit code is set, not forced with process.exit(): exiting while Node's own threads still
// post to the event loop (e.g. the HTTP client's) can crash Node on Windows with a libuv
// assertion and exit code 127. The loop ends by itself, as after a passing run.
if (interrupted) {
  console.error(`\nINTERRUPTED${failures.length > 0 ? `: ${failures.join('; ')}` : ''}. Output: ${out}`);
  process.exitCode = 130;
} else if (failures.length > 0) {
  console.error(`\nFAIL: ${failures.join('; ')}. Output: ${out}`);
  process.exitCode = 1;
} else {
  console.log(`\nPASS. Output: ${out}`);
}
