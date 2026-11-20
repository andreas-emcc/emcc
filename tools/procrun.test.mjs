// Tests for tools/procrun.mjs: the Windows service of ADR-0063 (M9 B2).
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  ACCOUNT, installScript, PROCRUN_VERSION, procrunFiles, procrunNotice, PRUNSRV_SHA256, SERVICE, STOP_TIMEOUT_S,
  uninstallScript, ZIP_SHA512,
} from './procrun.mjs';

test('procrun is pinned exactly', () => {
  assert.match(PROCRUN_VERSION, /^\d+\.\d+\.\d+$/);
  assert.match(PRUNSRV_SHA256, /^[0-9a-f]{64}$/);
  assert.match(ZIP_SHA512, /^[0-9a-f]{128}$/);
});

test('the install script runs the CDA\'s entry in procrun\'s jvm mode, from the emcc folder (C4)', () => {
  const s = installScript();
  for (const part of [
    `//IS//${SERVICE}`, '--StartMode=jvm', '--StartClass=dev.emcc.service.Service', '--StartMethod=start',
    '--StopMode=jvm', '--StopClass=dev.emcc.service.Service', '--StopMethod=stop', `--StopTimeout=${STOP_TIMEOUT_S}`,
    '--StartPath="%EMCC%"', '--StopPath="%EMCC%"', '--Classpath="%EMCC%\\app\\emc2-app.jar;%EMCC%\\app\\emcc-service.jar"',
    '--LogPath="%EMCC%\\logs"', 'runtime\\bin\\server\\jvm.dll', 'EMCC_JAVA_HOME',
  ]) assert.ok(s.includes(part), part);
  assert.equal(STOP_TIMEOUT_S, 60, 'ADR-0063 point 4');
});

test('the service starts delayed, as the virtual account, and restarts with a back-off (ADR-0063 points 1 and 5)', () => {
  const s = installScript();
  assert.ok(s.includes(`start= delayed-auto obj= "${ACCOUNT}"`));
  assert.equal(ACCOUNT, 'NT SERVICE\\emcc');
  assert.match(s, /sc failure emcc reset= \d+ actions= restart\/10000\/restart\/30000\/restart\/60000/);
  assert.ok(s.includes(`"%EMCC%\\data" /grant "${ACCOUNT}:(OI)(CI)M"`));
  assert.ok(s.includes(`"%EMCC%\\logs" /grant "${ACCOUNT}:(OI)(CI)M"`));
  assert.ok(s.includes(`"%EMCC%" /grant "${ACCOUNT}:(OI)(CI)RX"`));
  assert.ok(s.includes('settings\\credentials" /inheritance:r'));
});

test('no secret and no command-line login in the service\'s definition (ADR-0060, ADR-0063 point 3)', () => {
  for (const s of [installScript(), uninstallScript()]) {
    assert.ok(!/--StartParams|--JvmOptions|client-secret=[^.]|password/i.test(s.replace(/client-secret=\./g, '')), s);
    assert.ok(!s.includes('--emc2.login'));
  }
  // The login is checked in the settings, the secret in its credentials file.
  assert.ok(installScript().includes('settings\\credentials\\login.properties'));
});

test('both scripts need an administrator, use CRLF, and keep parentheses out of echo blocks', () => {
  for (const s of [installScript(), uninstallScript()]) {
    assert.ok(s.includes('net session >nul 2>&1 ||'));
    assert.ok(!/[^\r]\n/.test(s), 'CRLF only');
    for (const line of s.split('\r\n')) {
      const block = line.match(/\|\| \((echo [^&]*)&/) ?? line.match(/&& \((echo [^&]*)&/);
      if (block) assert.ok(!/[()]/.test(block[1]), `a parenthesis ends the block early: ${line}`);
    }
  }
});

test('the uninstall stops in order, takes the rights back before deleting', () => {
  const s = uninstallScript();
  const stop = s.indexOf(`//SS//${SERVICE}`); const rights = s.indexOf(`/remove "${ACCOUNT}"`); const del = s.indexOf(`//DS//${SERVICE}`);
  assert.ok(stop > 0 && stop < rights && rights < del);
});

test('procrunFiles checks the binary\'s hash; the notice carries NOTICE and the licence', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'procrun-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  assert.throws(() => procrunFiles(dir), /no .*prunsrv\.exe/);
  mkdirSync(join(dir, 'amd64'));
  writeFileSync(join(dir, 'amd64', 'prunsrv.exe'), 'not procrun');
  writeFileSync(join(dir, 'LICENSE.txt'), 'Apache License\nVersion 2.0');
  writeFileSync(join(dir, 'NOTICE.txt'), 'Apache Commons Daemon\nCopyright The Apache Software Foundation');
  assert.throws(() => procrunFiles(dir), /SHA-256/);
  const notice = procrunNotice({ license: join(dir, 'LICENSE.txt'), notice: join(dir, 'NOTICE.txt') });
  assert.match(notice, /Apache Commons Daemon \(procrun\) 1\.6\.1/);
  assert.match(notice, /Apache-2\.0/);
  assert.match(notice, /Version 2\.0/);
});
