// Quick run: @settings @harness
// Quick run of this file alone: node tests/integration/run.mjs --skip-build -- specs/flows/m9-settings-files.spec.ts
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stopOwnServer, withOwnServers, type OwnServer } from '../../lib/own-server';
import { emccFolderOf, root } from '../../lib/server.mjs';

// The settings layout (M9 T1; ADR-0060, the CDA's C1; server/README.md, "Settings files"): servers of the
// test's own read application-local.properties (deprecated), settings/emcc.properties and every
// settings/credentials/*.properties from their emcc folder, a later one winning, the command line over all;
// `%emcc%/` in a value; hand-edited JSON with comments; and the credentials' permission check, which
// warns in the log only (owner ZE A: no Monitor entry) or, with emc2.credentials.require-private, refuses
// the start. The observable keys are the label format's (GET /api/config's labelFormat), which the browsers
// get; their meaning does not matter here.

test.describe.configure({ timeout: 180_000 });

const WINDOWS = process.platform === 'win32';
const PERMISSION_WARNING = /settings\/credentials\/(\S+) can be read by other users of this computer/g;

async function labelFormat(server: OwnServer) {
  return (await (await fetch(`${server.baseUrl}/api/config`)).json()).labelFormat as { fieldSeparator: string; releasableToSeparator: string; releasableToPrefix: string };
}

/** The files the log names in a permission warning. */
function warnedFiles(server: OwnServer): string[] {
  return [...readFileSync(server.logFile, 'utf8').matchAll(PERMISSION_WARNING)].map((m) => m[1]).sort();
}

/** The account the test runs as, for icacls. */
function me(): string {
  return process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${process.env.USERNAME}` : String(process.env.USERNAME);
}

/** Makes the credentials folder and its files private: on Windows only this account, nothing inherited; on POSIX 700 and 600. */
function makePrivate(folder: string): void {
  if (WINDOWS) {
    execFileSync('icacls', [folder, '/inheritance:r', '/grant:r', `${me()}:(OI)(CI)F`], { stdio: 'pipe' });
    // Users' entry that makeReadable adds is removed; inherited ones go with the inheritance.
    for (const f of readdirSync(folder)) execFileSync('icacls', [join(folder, f), '/inheritance:r', '/remove:g', '*S-1-5-32-545', '/grant:r', `${me()}:F`], { stdio: 'pipe' });
  } else {
    chmodSync(folder, 0o700);
    for (const f of readdirSync(folder)) chmodSync(join(folder, f), 0o600);
  }
}

/** Lets other users read one file: on Windows read for Users (S-1-5-32-545), on POSIX 644. */
function makeReadable(file: string): void {
  if (WINDOWS) execFileSync('icacls', [file, '/grant', '*S-1-5-32-545:R'], { stdio: 'pipe' });
  else chmodSync(file, 0o644);
}

test('the order of the settings files and %emcc%/ (ADR-0060 points 1, 4 and 5; T1): application-local.properties is read with a deprecation warning, settings/emcc.properties wins over it, a settings/credentials/ file wins over both, the command line over all; the warning names the overridden keys and never a value; a value with %emcc%/ is resolved below the emcc folder; the labeling definitions may carry // and /* */ comments', async ({}, testInfo) => {
  await withOwnServers(testInfo, async (folders, start) => {
    const emcc = emccFolderOf(folders.dataDir);
    const credentials = join(emcc, 'settings', 'credentials');
    mkdirSync(credentials, { recursive: true });
    // The deprecated file, the installation's file and a credentials file each set some of the three keys.
    writeFileSync(join(emcc, 'application-local.properties'), [
      'emc2.labeling.field-separator=" L "',
      'emc2.labeling.releasable-to-prefix=FROM-LOCAL',
      'emc2.labeling.releasable-to-separator=;LOCAL;',
    ].join('\n'));
    writeFileSync(join(emcc, 'settings', 'emcc.properties'), [
      '# The installation\'s settings (a test of the ITA)',
      'emc2.labeling.releasable-to-prefix=FROM-EMCC',
      'emc2.labeling.releasable-to-separator=;EMCC;',
      'emc2.labeling.definitions=%emcc%/settings/labeling-definitions.json',
    ].join('\n'));
    writeFileSync(join(credentials, 'zz-ita.properties'), '# not a secret; the order is the test\nemc2.labeling.releasable-to-separator=;CREDENTIALS;\n');
    makePrivate(credentials);
    // Hand-edited JSON with comments: the bundled definitions with one set renamed.
    const bundled = readFileSync(join(root, 'server', 'app', 'src', 'main', 'resources', 'labeling-definitions.json'), 'utf8');
    expect(bundled, 'the bundled definitions have the NATO set').toContain('"name": "NATO",');
    writeFileSync(join(emcc, 'settings', 'labeling-definitions.json'), `/* The ITA's definitions: */\n${bundled.replace('"name": "NATO",', '"name": "NATO (ITA)", // renamed by the test')}`);

    const server = await start(['--emc2.labeling.field-separator=-CLI-']);
    expect(await labelFormat(server), 'command line > credentials > emcc.properties > application-local.properties').toEqual({
      fieldSeparator: '-CLI-',
      releasableToSeparator: ';CREDENTIALS;',
      releasableToPrefix: 'FROM-EMCC',
    });
    const config = await (await fetch(`${server.baseUrl}/api/config`)).json();
    expect(config.labelDefinitions.classificationSets.map((s: { name: string }) => s.name), '%emcc%/ and comments: the ITA\'s definitions').toContain('NATO (ITA)');

    const log = readFileSync(server.logFile, 'utf8');
    const lines = log.split(/\r?\n/).filter((l) => /application-local\.properties|Settings read from/.test(l));
    testInfo.annotations.push({ type: 'the log on the files', description: lines.map((l) => l.replace(/^.*? : /, '')).join(' | ') });
    expect(log, 'deprecated, with a warning').toMatch(/WARN .*application-local\.properties is deprecated/);
    expect(log, 'the overridden keys named').toMatch(/application-local\.properties: these keys are also in the settings files, whose values count: emc2\.labeling\.releasable-to-prefix, emc2\.labeling\.releasable-to-separator/);
    expect(log, 'each file read, named').toMatch(/Settings read from settings\/credentials\/zz-ita\.properties/);
    for (const value of ['FROM-LOCAL', 'FROM-EMCC', ';CREDENTIALS;', ';LOCAL;', ';EMCC;']) expect(log, `no value in the log: ${value}`).not.toContain(value);
    expect(warnedFiles(server), 'private credentials: no permission warning').toEqual([]);
    await stopOwnServer(server, { expectedLog: [/application-local\.properties is deprecated/, /application-local\.properties: these keys/] });
  });
});

test('the credentials\' permissions (ADR-0060 point 3; owner ZE A, Q2 A, ABV A; T1): a file other users can read gets a warning in the log naming it, and only it, and the server runs; a file of only comments and blank lines (as the templates ship) is not checked, readable or not; there is no Monitor entry for it; with emc2.credentials.require-private=true the start is refused naming the file; with the file private again it starts', async ({}, testInfo) => {
  await withOwnServers(testInfo, async (folders, start) => {
    const emcc = emccFolderOf(folders.dataDir);
    const credentials = join(emcc, 'settings', 'credentials');
    mkdirSync(credentials, { recursive: true });
    // A setting of no service and no real value: since ABV a file that holds no setting is not checked.
    writeFileSync(join(credentials, 'http-ita.properties'), '# an HTTP token of no service (a test of the ITA)\nita.test.http-token=not-a-secret\n');
    // Only comments and blank lines, as the release's templates ship: readable as well, and no warning.
    writeFileSync(join(credentials, 'login.properties'), '# empty: no login in this test\n\n! a comment too\n');
    makePrivate(credentials);
    makeReadable(join(credentials, 'http-ita.properties'));
    makeReadable(join(credentials, 'login.properties'));

    const server = await start();
    expect(warnedFiles(server), 'the readable file with a setting, and only it: not the readable comment-only one').toEqual(['http-ita.properties']);
    const monitor = JSON.stringify(await (await fetch(`${server.baseUrl}/api/monitor`)).json());
    expect(monitor, 'no Monitor entry (ZE A)').not.toContain('http-ita');
    await stopOwnServer(server, { expectedLog: [/settings\/credentials\/http-ita\.properties can be read by other users/] });

    // Refused with require-private (a failed start writes server-2.log, as the first is counted).
    await expect(start(['--emc2.credentials.require-private=true']), 'refused').rejects.toThrow(/exited during start-up/);
    const refused = readFileSync(testInfo.outputPath('server-2.log'), 'utf8');
    expect(refused, 'the reason names the file').toMatch(/emc2\.credentials\.require-private is true and other users can read settings\/credentials\/http-ita\.properties/);

    makePrivate(credentials);
    const again = await start(['--emc2.credentials.require-private=true']);
    expect(warnedFiles(again), 'private: no warning').toEqual([]);
    await stopOwnServer(again);
  });
});
