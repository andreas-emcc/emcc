// Starts and stops emc2 servers for the integration tests. Used by run.mjs and by the specs that
// need servers of their own (persistence, plugin folders). Plain Node.js, Windows and Linux.
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandLineOf, isAlive, killTree, spawnGroup } from './processes.mjs';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const jarPath = join(root, 'server', 'app', 'target', 'emc2-app.jar');
export const webRoot = join(root, 'web', 'shell', 'dist');

const START_TIMEOUT_MS = 90_000;
const STOP_TIMEOUT_MS = 30_000;
// The server's port is the first: with a redirect port Tomcat logs "started on ports 50313 (https), 51369 (http)".
const STARTED = /Tomcat started on ports? (\d+)/;

/**
 * Servers started by this process and not yet exited; killed if the process exits first. Their
 * registry entries stay, so the runner reports that a test left them running.
 */
const live = new Set();

process.on('exit', () => {
  for (const server of live) killTree(server.pid);
});

/**
 * The run's server registry (a folder set by run.mjs in EMC2_SERVER_REGISTRY): one file per
 * running server, from every process of the run, including Playwright's workers. The runner
 * uses it to find servers that a test left running.
 */
const registry = process.env.EMC2_SERVER_REGISTRY;

function register(child, logFile, dataDir) {
  if (!registry || child.pid === undefined) return;
  mkdirSync(registry, { recursive: true });
  writeFileSync(join(registry, `${child.pid}.json`), JSON.stringify({ pid: child.pid, logFile, dataDir }));
}

function unregister(child) {
  if (registry && child.pid !== undefined) rmSync(join(registry, `${child.pid}.json`), { force: true });
}

/**
 * Clears the registry and returns every server still in it as { pid, logFile, dataDir, state }: servers
 * whose start and stop did not both happen in one process lifetime. `state` is 'killed' (it still
 * ran emc2-app.jar and was killed now), 'not running', or 'not verified' (the pid is alive but its
 * command line cannot be read, e.g. without /proc on macOS; it is not killed, since a pid can be
 * reused by another program).
 * After a run every entry is a test that did not stop its server. Never throws: an unreadable
 * entry is returned with an `error`.
 */
export function sweepRegistry(folder) {
  let names;
  try {
    names = readdirSync(folder);
  } catch {
    return [];
  }
  const leftovers = [];
  for (const name of names) {
    const file = join(folder, name);
    try {
      const entry = JSON.parse(readFileSync(file, 'utf8'));
      let state = 'not running';
      if (isAlive(entry.pid)) {
        const commandLine = commandLineOf(entry.pid);
        if (commandLine === undefined) state = 'not verified';
        else if (commandLine.includes('emc2-app.jar')) {
          killTree(entry.pid);
          state = 'killed';
        }
      }
      leftovers.push({ ...entry, state });
    } catch (error) {
      leftovers.push({ pid: name, state: 'not running', error: error.message });
    }
    try {
      rmSync(file, { force: true });
    } catch {
      // The folder belongs to the run's output and is pruned with it later.
    }
  }
  return leftovers;
}

/**
 * Where a run's temporary folders go: `folders/` in the run's output folder (EMC2_OUT, set by
 * run.mjs), or in out/manual/ for runs started by hand. A folder kept after a failure therefore
 * stays with its run and is pruned with it (run.mjs keeps the newest runs), never in the system's
 * temporary folder.
 */
export function runFoldersParent() {
  return join(process.env.EMC2_OUT || join(root, 'tests', 'integration', 'out', 'manual'), 'folders');
}

/** A fresh, empty temporary folder of the run (runFoldersParent); the caller removes it. */
export function makeTempFolder(prefix = 'emc2-ita-', parent = runFoldersParent()) {
  mkdirSync(parent, { recursive: true });
  return mkdtempSync(join(parent, prefix));
}

/**
 * The test server's emcc folder, beside its data folder: made with the empty `settings/terrain/` a
 * release ships (owner SB A, 2026-11-12: terrain's default `%emcc%/settings/terrain`, T-157; a
 * missing folder stays an error), so terrain starts OK with no cells. Kept if it is there.
 */
export function emccFolderOf(dataDir) {
  const emcc = join(dirname(resolve(dataDir)), 'emcc');
  mkdirSync(join(emcc, 'settings', 'terrain'), { recursive: true });
  return emcc;
}

/** Fresh, empty data and plugin folders of the run (runFoldersParent). */
export function makeRunFolders(prefix = 'emc2-ita-', parent = runFoldersParent()) {
  const base = makeTempFolder(prefix, parent);
  const dataDir = join(base, 'data');
  const pluginsDir = join(base, 'plugins');
  mkdirSync(dataDir);
  mkdirSync(pluginsDir);
  return { base, dataDir, pluginsDir, remove: () => rmSync(base, { recursive: true, force: true }) };
}

/**
 * Starts the server jar with the dev profile on 127.0.0.1 and a port the server chooses itself
 * (port 0, read back from its log, so two runs never race for a port). Resolves when
 * GET /api/health reports UP; rejects with a readable Error otherwise (and leaves nothing running).
 * An aborted `signal` (e.g. Ctrl+C in the runner) ends the wait at once and kills the server.
 * `login: true` starts it without the dev profile, so with login (its settings in `extraArgs` and
 * `env`); such a server has no stop endpoint and is ended with `kill()`.
 * The server runs in its own emcc folder (`emccFolderOf`), as a release does in its own (SDK 1.6.0
 * part H: `%emcc%/` settings resolve below the working directory), never in the repository.
 * `https: true` is for a server whose emcc folder holds an HTTPS certificate (lib/test-ca.mjs, ADR-0061):
 * its `baseUrl` is then `https://`, which the test processes trust through run.mjs's NODE_EXTRA_CA_CERTS.
 * `port` fixes the server's port (default 0: the server chooses one).
 */
export async function startServer({ dataDir, pluginsDir, logFile, extraArgs = [], env = {}, login = false, https = false, port: fixedPort = 0, signal }) {
  if (!existsSync(jarPath)) {
    throw new Error(`no server jar at ${jarPath} (build first)`);
  }
  mkdirSync(dirname(logFile), { recursive: true });
  const log = createWriteStream(logFile);
  const args = [
    ...(login ? [] : ['-Dspring.profiles.active=dev']),
    '-jar',
    jarPath,
    '--server.address=127.0.0.1',
    `--server.port=${fixedPort}`,
    `--emc2.web.root=${webRoot}`,
    `--emc2.data.directory=${dataDir}`,
    `--emc2.plugins.directory=${pluginsDir}`,
    ...extraArgs,
  ];
  const emccFolder = emccFolderOf(dataDir);
  const child = spawnGroup('java', args, { cwd: emccFolder, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  register(child, logFile, dataDir);

  let spawnError;
  let exitCode = null;
  let port;
  let pending = '';
  // "close" comes after "exit" and after both pipes are drained, so the log is complete then.
  const closed = new Promise((resolveClosed) => {
    child.once('close', (code, signal) => {
      exitCode = code ?? signal;
      live.delete(child);
      unregister(child);
      log.end(() => resolveClosed());
    });
  });
  // A failed spawn emits "error", then "close".
  child.once('error', (error) => {
    spawnError = error;
  });
  if (child.pid !== undefined) live.add(child);

  child.stdout.on('data', (chunk) => {
    if (port !== undefined) return;
    pending += chunk.toString();
    const match = STARTED.exec(pending);
    if (match) port = Number(match[1]);
    else pending = pending.slice(-500);
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });

  let stopping;
  const server = {
    get port() {
      return port;
    },
    get baseUrl() {
      return `${https ? 'https' : 'http'}://127.0.0.1:${port}`;
    },
    logFile,
    /** Its emcc folder, the working directory (`emccFolderOf`). */
    emccFolder,
    get exitCode() {
      return exitCode;
    },
    closed,
    // Idempotent: a second call waits for the first stop.
    stop: () => (stopping ??= stopServer(server, child, closed)),
    /** A hard kill of the process tree, as a crash would end it; resolves when it has exited. */
    kill: async () => {
      killTree(child.pid);
      await closed;
    },
  };

  try {
    const deadline = Date.now() + START_TIMEOUT_MS;
    for (;;) {
      if (spawnError) throw new Error(`could not start java: ${spawnError.message} (is JDK 25 on the PATH?)`);
      if (signal?.aborted) throw new Error('the start was interrupted');
      if (exitCode !== null) throw new Error(`the server exited during start-up (exit code ${exitCode}), see ${logFile}`);
      if (Date.now() > deadline) {
        throw new Error(
          port === undefined
            ? `the server never logged "Tomcat started on port …" within ${START_TIMEOUT_MS / 1000} s, so its port is unknown (did the log format change?), see ${logFile}`
            : `the server on port ${port} was not healthy within ${START_TIMEOUT_MS / 1000} s, see ${logFile}`,
        );
      }
      if (port !== undefined && (await isHealthy(server.baseUrl))) return server;
      await waitForChange(child, 200, signal);
    }
  } catch (error) {
    killTree(child.pid);
    await closed;
    throw error;
  }
}

async function isHealthy(baseUrl) {
  try {
    const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok && (await response.json()).status === 'UP';
  } catch {
    return false;
  }
}

/** Waits until the child prints something, exits or the signal aborts, at most `ms` (polling, not a fixed delay). */
function waitForChange(child, ms, signal) {
  return new Promise((resolveWait) => {
    const done = () => {
      clearTimeout(timer);
      child.stdout.off('data', done);
      child.off('exit', done);
      signal?.removeEventListener('abort', done);
      resolveWait();
    };
    const timer = setTimeout(done, ms);
    child.stdout.once('data', done);
    child.once('exit', done);
    signal?.addEventListener('abort', done, { once: true });
  });
}

/**
 * Stops the server through POST /api/dev/stop and waits for the process to end. Falls back to
 * killing the process tree after a timeout. Resolves with { graceful, exitCode, detail };
 * graceful is true only for a 202 answer followed by exit code 0.
 */
async function stopServer(server, child, closed) {
  if (server.exitCode !== null) {
    return { graceful: false, exitCode: server.exitCode, detail: 'the server had already exited' };
  }
  let detail;
  try {
    // Node's fetch sends no Origin header, which the endpoint requires.
    const response = await fetch(`${server.baseUrl}/api/dev/stop`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    });
    if (response.status !== 202) detail = `POST /api/dev/stop answered ${response.status}`;
  } catch (error) {
    detail = `POST /api/dev/stop failed: ${error.message}`;
  }

  let timer;
  const timedOut = new Promise((resolveTimeout) => {
    timer = setTimeout(() => resolveTimeout(true), STOP_TIMEOUT_MS);
  });
  const killed = await Promise.race([closed.then(() => false), timedOut]);
  clearTimeout(timer);
  if (killed) {
    killTree(child.pid);
    await closed;
    detail = `${detail ? `${detail}; ` : ''}no exit within ${STOP_TIMEOUT_MS / 1000} s, process tree killed`;
  }
  const exitCode = server.exitCode;
  if (!detail && exitCode !== 0) detail = `exit code ${exitCode}`;
  return { graceful: !detail, exitCode, detail: detail ?? 'stopped cleanly (exit code 0)' };
}

/** Kills every server this process started that is still running (last resort on a signal). */
export function killAll() {
  for (const child of [...live]) killTree(child.pid);
}
