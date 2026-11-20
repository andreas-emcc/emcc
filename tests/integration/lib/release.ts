// Releases for the release specs (specs/release/): a release zip unpacked as a user does, and started with its own
// start script on a free port, from its folder. Taken out of release-log.spec.ts for the SDK kit's spec (M9 T3).
import { type ChildProcess } from 'node:child_process';
import { chmodSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { closedOf, interruptTree, isWindows, killTree, spawnGroup } from './processes.mjs';
import { readZipEntries } from '../../../tools/zip.mjs';

const START_MS = 90_000;
const STOP_MS = 30_000;

/** A free local TCP port. */
export function freePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolvePort(port));
    });
  });
}

/** Unpacks the zip into `into`; returns the one folder it unpacks to. */
export function unpack(zip: string, into: string): string {
  const tops = new Set<string>();
  for (const entry of readZipEntries(readFileSync(zip))) {
    if (entry.name.endsWith('/')) continue;
    tops.add(entry.name.split('/')[0]);
    const file = join(into, ...entry.name.split('/'));
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, entry.read());
  }
  expect([...tops], 'the zip unpacks to one folder').toHaveLength(1);
  const folder = join(into, [...tops][0]);
  if (!isWindows) {
    // The zip keeps no Unix modes, so on Linux the scripts and the runtime's programs are made
    // executable, as after `unzip` with a chmod.
    for (const name of readdirSync(folder)) if (name.endsWith('.sh')) chmodSync(join(folder, name), 0o755);
    const bin = join(folder, 'runtime', 'bin');
    if (existsSync(bin)) for (const name of readdirSync(bin)) chmodSync(join(bin, name), 0o755);
    const helper = join(folder, 'runtime', 'lib', 'jspawnhelper');
    if (existsSync(helper)) chmodSync(helper, 0o755);
  }
  return folder;
}

export async function isUp(base: string): Promise<boolean> {
  try {
    const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) });
    return response.ok && (await response.json()).status === 'UP';
  } catch {
    return false;
  }
}

export type Run = { child: ChildProcess; closed: Promise<unknown>; port: number; console: string; stop: () => Promise<void> };

/**
 * Starts the release with its start script, `args` (e.g. -standalone) and `port`, from its folder; resolves when it
 * is up.
 */
export async function startRelease(folder: string, port: number, name: string, args: string[] = []): Promise<Run> {
  const script = isWindows ? 'start.bat' : 'start.sh';
  expect(existsSync(join(folder, script)), `${script} in the release (is EMC2_RELEASE_ZIP the zip of this platform?)`).toBe(true);
  // `.\start.bat`: cmd does not look in the current folder when NoDefaultCurrentDirectoryInExePath is set.
  const child = isWindows
    ? spawnGroup('cmd.exe', ['/d', '/c', `.\\${script}`, ...args, String(port)], { cwd: folder, stdio: ['ignore', 'pipe', 'pipe'] })
    : spawnGroup(`./${script}`, [...args, String(port)], { cwd: folder, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = closedOf(child);
  const consoleFile = test.info().outputPath(`${name}-console.log`);
  const copy = createWriteStream(consoleFile);
  let text = '';
  const keep = (chunk: Buffer) => {
    text += chunk.toString();
    copy.write(chunk);
  };
  child.stdout!.on('data', keep);
  child.stderr!.on('data', keep);
  let exited = false;
  void closed.then(() => {
    exited = true;
    copy.end();
  });
  const run: Run = {
    child,
    closed,
    port,
    get console() {
      return text;
    },
    stop: async () => {
      if (exited) return;
      interruptTree(child.pid);
      const timer = setTimeout(() => killTree(child.pid), STOP_MS);
      await closed;
      clearTimeout(timer);
    },
  };
  const deadline = Date.now() + START_MS;
  while (!(await isUp(`http://127.0.0.1:${port}`))) {
    if (exited) throw new Error(`the release exited during start-up, see ${consoleFile}`);
    if (Date.now() > deadline) {
      killTree(child.pid);
      await closed;
      throw new Error(`the release was not up within ${START_MS / 1000} s on port ${port}, see ${consoleFile}`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return run;
}

/** Starts, checks while it runs, stops; the release is stopped whatever happens. */
export async function withRelease(folder: string, name: string, check: (run: Run) => Promise<void> | void, args: string[] = []): Promise<Run> {
  const run = await startRelease(folder, await freePort(), name, args);
  try {
    await check(run);
  } finally {
    await run.stop();
  }
  return run;
}

/** The log file's text once it holds `what` (logback writes each line at once; polled briefly). */
export async function logHolding(file: string, what: RegExp): Promise<string> {
  let text = '';
  await expect
    .poll(() => {
      text = existsSync(file) ? readFileSync(file, 'utf8') : '';
      return what.test(text);
    }, { message: `${file} holds ${what}`, timeout: 10_000 })
    .toBe(true);
  return text;
}
