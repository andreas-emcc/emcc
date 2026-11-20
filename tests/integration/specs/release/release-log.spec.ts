// Quick run: @release
// Quick run of this file alone, with a release zip of this platform (node tools/release.mjs):
//   $env:EMC2_RELEASE_ZIP = '<this checkout>\releases\<the zip>'
//   node tests/integration/run.mjs --skip-build -- specs/release/release-log.spec.ts
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { logHolding, unpack, withRelease } from '../../lib/release';

// T-187 (the M7 plan's Q9 A, owner RZ A, 2026-11-12): a release writes the server's log to
// logs/emcc.log. Since M9 (ADR-0060, the MCA's B3) the release ships settings/emcc.properties with
// logging.file.name and logback's rolling limits, and its start script's -standalone starts it
// without login; without arguments the settings decide the login, so the starts here use -standalone.
// This checks a built release zip, named by EMC2_RELEASE_ZIP; without it the test is skipped. It
// is meant for a release candidate's full run (the MCA names the zip).
//
// The zip is unpacked into an empty folder of the run and started with its own start script and a
// free port, from the release folder, as a user does. Three starts:
//  1. as unpacked: logs/emcc.log is made, with the start and every plugin's line; after the stop
//     (Ctrl+C on Linux; on Windows, which has no signal for it, the tree is killed, as when the
//     window is closed) it holds every log line the window showed, ends with a whole line, and
//     is no longer locked (it can be renamed);
//  2. with settings/emcc.properties naming logs/local.log (and data/ deleted, for an empty map): the
//     log goes there, and logs/emcc.log is not touched; on an empty map the simulator's engine logs
//     that it made the Simulation layer;
//  3. as 2 with logging.level.plugin.simulator=WARN as well: that line is gone from the log, while
//     ECore still logs the simulator's start. So one plugin's level set there takes effect.
// The rolling limits (20 MB, 14 days, 280 MB) are read from the shipped settings/emcc.properties,
// not exercised. The readme's logs/ row and plugin level row and README.txt's line are checked.
// (application-local.properties, deprecated since M9, is m9-settings-files.spec.ts's.)

test.describe.configure({ timeout: 300_000 });

const ZIP = process.env.EMC2_RELEASE_ZIP ?? '';
const SIMULATION_LAYER = /plugin\.simulator\.engine\s*: created the layer "Simulation"/;
/** The start script's arguments: no login, this computer only (B3). */
const STANDALONE = ['-standalone'];

/** The shipped settings with `lines` set: each replaces the line of its name, or is added at the end. */
function withSettings(shipped: string, lines: string[]): string {
  let text = shipped;
  for (const line of lines) {
    const name = line.slice(0, line.indexOf('='));
    const own = new RegExp(`^${name.replace(/[.[\]]/g, '\\$&')}=.*$`, 'm');
    text = own.test(text) ? text.replace(own, line) : `${text.replace(/\s*$/, '')}\n${line}\n`;
  }
  return text;
}

/** Log messages ("logger : message") of a log's or a console's text, without colour codes. */
function messages(text: string): string[] {
  // eslint-disable-next-line no-control-regex
  const plain = text.replace(/\x1b\[[0-9;]*m/g, '');
  return plain
    .split(/\r?\n/)
    .map((line) => /\s(?:TRACE|DEBUG|INFO|WARN|ERROR)\s.*?\]\s+(\S+\s*:\s.*)$/.exec(line)?.[1])
    .filter((m): m is string => m !== undefined)
    // The window's text is in the console's code page, the file in UTF-8: compared without non-ASCII.
    .map((m) => m.replace(/\s+:\s/, ' : ').replace(/[^\x20-\x7e]/g, '?').trim());
}

test('a release writes its log to logs/emcc.log; settings/emcc.properties changes the file and one plugin level (T-187, M9)', async () => {
  test.skip(ZIP === '', 'set EMC2_RELEASE_ZIP to a release zip of this platform (node tools/release.mjs)');
  expect(existsSync(ZIP), `EMC2_RELEASE_ZIP ${ZIP} exists`).toBe(true);
  test.info().annotations.push({ type: 'release zip', description: basename(ZIP) });
  // A short folder in the system's temporary folder, not the run's folders/ (owner, 2026-10-15): the start
  // script's `if not exist "runtime\bin\java.exe"` fails in cmd when the path is longer than MAX_PATH
  // (260), so below a deep run folder the release refused to start (MCA, M7 RC1 run, 2026-11-12). It is
  // always removed below; its logs go with the test's output.
  const base = mkdtempSync(join(tmpdir(), 'emcc-'));
  try {
    await checkRelease(base);
  } finally {
    // The release's logs go with the test's output; the unpacked release (about 200 MB) does not stay.
    for (const name of readdirSync(base)) {
      const logs = join(base, name, 'logs');
      if (existsSync(logs)) cpSync(logs, test.info().outputPath('logs'), { recursive: true });
    }
    rmSync(base, { recursive: true, force: true });
  }
});

async function checkRelease(base: string) {
  const folder = unpack(ZIP, base);
  const logs = join(folder, 'logs');
  const emccLog = join(logs, 'emcc.log');

  // What the release ships: the defaults, and where the readme and README.txt say the log is.
  const settings = join(folder, 'settings', 'emcc.properties');
  const shippedText = readFileSync(settings, 'utf8');
  const shipped = shippedText.split(/\r?\n/);
  for (const line of [
    'logging.file.name=logs/emcc.log',
    'logging.logback.rollingpolicy.max-file-size=20MB',
    'logging.logback.rollingpolicy.max-history=14',
    'logging.logback.rollingpolicy.total-size-cap=280MB',
  ]) {
    expect(shipped, `settings/emcc.properties: ${line}`).toContain(line);
  }
  expect(existsSync(join(folder, 'application-local.properties')), 'no application-local.properties shipped').toBe(false);
  const readme = readFileSync(join(folder, 'readme.md'), 'utf8');
  const logsRow = readme.split(/\r?\n/).find((line) => line.startsWith('| `logs/` |')) ?? '';
  expect(logsRow, "readme.md's logs/ row").toContain('`logs/emcc.log`');
  for (const part of ['20 MB', '14 days', '280 MB', 'problem report']) expect(logsRow, `the logs/ row names ${part}`).toContain(part);
  expect(readme, 'readme.md: the plugin level row').toContain('| `logging.level.plugin.<id>=DEBUG` |');
  expect(readFileSync(join(folder, 'README.txt'), 'utf8'), 'README.txt names the log').toContain("The server's log is logs/emcc.log. Send it with a problem report.");

  // 1. As unpacked.
  expect(existsSync(emccLog), 'no log before the first start').toBe(false);
  const first = await withRelease(folder, 'start-1', async () => {
    const text = await logHolding(emccLog, /Plugins: \d+ running/);
    expect(text).toMatch(/Started Emc2Application in/);
    expect(text).toMatch(/Plugin terrain [\d.]+ started/);
    expect(text, 'no colour codes in the file').not.toContain('\x1b[');
  }, STANDALONE);
  const firstLog = readFileSync(emccLog, 'utf8');
  expect(firstLog.endsWith('\n'), 'the log ends with a whole line after the stop').toBe(true);
  const missing = messages(first.console).filter((m) => !messages(firstLog).includes(m));
  expect(missing, 'every log line the window showed is in logs/emcc.log').toEqual([]);
  expect(messages(first.console).length, 'the window showed log lines').toBeGreaterThan(10);
  renameSync(emccLog, `${emccLog}.moved`); // throws while the file is still open (Windows)
  renameSync(`${emccLog}.moved`, emccLog);
  const firstSize = statSync(emccLog).size;
  test.info().annotations.push({ type: 'logs/emcc.log', description: `${firstSize} bytes, ${messages(firstLog).length} log lines` });

  // 2. settings/emcc.properties names another file; an empty map.
  rmSync(join(folder, 'data'), { recursive: true, force: true });
  writeFileSync(settings, withSettings(shippedText, ['logging.file.name=logs/local.log']));
  const localLog = join(logs, 'local.log');
  await withRelease(folder, 'start-2', async () => {
    const text = await logHolding(localLog, /Plugins: \d+ running/);
    expect(text, 'the simulator makes its layer on an empty map').toMatch(SIMULATION_LAYER);
  }, STANDALONE);
  expect(statSync(emccLog).size, 'logs/emcc.log is not written when application-local.properties names another file').toBe(firstSize);

  // 3. One plugin's level set there as well.
  rmSync(join(folder, 'data'), { recursive: true, force: true });
  writeFileSync(settings, withSettings(shippedText, ['logging.file.name=logs/level.log', 'logging.level.plugin.simulator=WARN']));
  const levelLog = join(logs, 'level.log');
  await withRelease(folder, 'start-3', async () => {
    const text = await logHolding(levelLog, /Plugins: \d+ running/);
    expect(text).toMatch(/Plugin simulator [\d.]+ started/);
    expect(text, "the simulator's INFO line is gone at WARN").not.toMatch(SIMULATION_LAYER);
    expect(text, 'no line of a plugin.simulator logger at all').not.toMatch(/\]\s+plugin\.simulator\S*\s+:/);
  }, STANDALONE);
}
