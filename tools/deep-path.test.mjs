// Tests for tools/deep-path.mjs: start.bat's check for a folder too deep for Windows (TJ A, M8).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { deepestLength, depthCheckLines, WINDOWS_PATH_LIMIT } from './deep-path.mjs';

test('the deepest length is the longest relative path, 0 for none', () => {
  assert.equal(deepestLength([]), 0);
  assert.equal(deepestLength(['a.txt', 'runtime\\lib\\modules', 'b']), 'runtime\\lib\\modules'.length);
});

test('the check allows a folder of the limit less a backslash and the deepest file', () => {
  const lines = depthCheckLines(100);
  assert.ok(lines.includes(`if %LEN% LEQ ${WINDOWS_PATH_LIMIT - 1 - 100} goto depthok`));
  assert.ok(lines.includes('echo This folder is too deep for Windows: "%CD%"'));
  assert.equal(lines.at(-1), ':depthok');
});

/**
 * Runs the check in a script inside `dir`, started as Explorer starts it (cmd /s /c with the path quoted), and
 * returns { status, out, err }; the script ends with "LEN=…" when it passes.
 */
function runCheck(dir, deepest) {
  const bat = join(dir, 'check.bat');
  writeFileSync(bat, ['@echo off', 'setlocal', 'cd /d "%~dp0"', ...depthCheckLines(deepest), 'echo LEN=%LEN%', ''].join('\r\n'));
  const r = spawnSync('cmd.exe', ['/d', '/s', '/c', `""${bat}""`], { encoding: 'utf8', windowsVerbatimArguments: true });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

test('in cmd.exe the check measures the folder and stops just past the limit', { skip: process.platform !== 'win32' }, (t) => {
  const base = mkdtempSync(join(tmpdir(), 'emc2-deep-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const dir = join(base, 'emcc (M8) & more'); // a space, brackets and an ampersand, as a user's folder may have
  mkdirSync(dir);

  const measured = runCheck(dir, 0);
  assert.equal(measured.status, 0, measured.out + measured.err);
  const len = Number(/LEN=(\d+)/.exec(measured.out)?.[1]);
  assert.equal(len, dir.length, measured.out);

  const fits = runCheck(dir, WINDOWS_PATH_LIMIT - 1 - len); // the folder exactly as long as allowed
  assert.equal(fits.status, 0, fits.out + fits.err);
  assert.match(fits.out, /LEN=/);

  const deep = runCheck(dir, WINDOWS_PATH_LIMIT - len); // one character too many
  assert.equal(deep.status, 1, deep.out + deep.err);
  assert.match(deep.out, /This folder is too deep for Windows: ".*emcc \(M8\) & more"/);
  assert.match(deep.out, /C:\\emcc/);
  assert.equal(deep.err, '');
  assert.doesNotMatch(deep.out, /LEN=/);
});
