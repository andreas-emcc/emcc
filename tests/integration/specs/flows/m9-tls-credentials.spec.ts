// Quick run: @settings @tak
// Quick run of this file alone: node tests/integration/run.mjs --skip-build -- specs/flows/m9-tls-credentials.spec.ts
import { expect, test } from '@playwright/test';
import { externalMissing, externalPath } from '../../lib/external.mjs';
import { X509Certificate } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stopOwnServer, withOwnServers, type OwnServer } from '../../lib/own-server';
import { emccFolderOf } from '../../lib/server.mjs';

// TLS credentials (M9 T1; ADR-0062, the CDA's C3; server/README.md, "TLS credentials"): servers of the test's own
// with named credentials in settings/credentials/tls-<name>.properties, made of the ESA's TAK client
// certificates (external/tak-server/README.md, E2: PEM and PKCS #12, one that expires soon and one that has
// expired), copied into the test's emcc folder. Checked: the names for the settings field
// (GET /api/settings/tls-credentials), the Monitor's core.tls with each certificate's end and state, an
// unreadable and a deprecated credential, and a missing file stopping the start. The TAK link's part (the
// field on cot's TLS links, a renamed link falling back to its name, an expired certificate on a real link)
// waits for PCA-cot's K1.

test.describe.configure({ timeout: 180_000 });

const TAK = externalPath('credentials', 'tak-server');
test.skip(TAK === '' || !existsSync(join(TAK, 'tak-server.json')), `${externalMissing('the TAK client certificates', TAK)} (the ESA's external/tak-server/, E2)`);

type Certificate = { subject: string; issuer: string; notAfterMillis: number; state: string };
type Credential = { name: string; setting: string; error: string | null; identity: Certificate[]; trusted: Certificate[] };

/** The ESA's index of the TAK credentials (with passwords: never printed). */
function takIndex() {
  return JSON.parse(readFileSync(join(TAK, 'tak-server.json'), 'utf8')).tls;
}

/** A certificate's end, from its PEM (the first certificate of a chain). */
function notAfter(pemFile: string): number {
  return Date.parse(new X509Certificate(readFileSync(join(TAK, pemFile))).validTo);
}

async function credentials(server: OwnServer): Promise<Credential[]> {
  return (await (await fetch(`${server.baseUrl}/api/monitor`)).json()).core.tls;
}

test('named TLS credentials (ADR-0062 points 2 and 4; T1): PEM with a plain and an encrypted key, PKCS #12 with a JKS trust store, one that expires soon, one that has expired, one whose password is wrong and one under the deprecated keys are listed by name for the settings field, sorted; the Monitor lists each with its client\'s chain and its trusted certificates, their ends and states (valid, soon, expired), or why it cannot be read, and never a path or a password; the log warns of the expired, the expiring, the unreadable and the deprecated ones, without a password; the server runs', async ({}, testInfo) => {
  await withOwnServers(testInfo, async (folders, start) => {
    const tls = takIndex();
    const emcc = emccFolderOf(folders.dataDir);
    const folder = join(emcc, 'settings', 'credentials');
    mkdirSync(folder, { recursive: true });
    for (const f of ['ca.pem', 'truststore.jks', 'truststore.p12', tls.clientCertificate, tls.clientCertificatePem, tls.clientKeyPem, tls.clientKeyPemUnencrypted, tls.expiringClient.pem, tls.expiringClient.keyUnencrypted, tls.expiredClient.pem, tls.expiredClient.keyUnencrypted]) {
      copyFileSync(join(TAK, f), join(folder, f));
    }
    const at = (f: string) => `%emcc%/settings/credentials/${f}`;
    const pem = (name: string, certificate: string, key: string, extra: string[] = []) =>
      writeFileSync(join(folder, `tls-${name}.properties`), [`emc2.tls.${name}.trust-store=${at('ca.pem')}`, `emc2.tls.${name}.trust-store-type=PEM`, `emc2.tls.${name}.key-store-type=PEM`, `emc2.tls.${name}.certificate=${at(certificate)}`, `emc2.tls.${name}.private-key=${at(key)}`, ...extra].join('\n'));
    pem('tak-pem', tls.clientCertificatePem, tls.clientKeyPemUnencrypted);
    pem('tak-encrypted', tls.clientCertificatePem, tls.clientKeyPem, [`emc2.tls.tak-encrypted.private-key-password=${tls.clientCertificatePassword}`]);
    pem('expiring', tls.expiringClient.pem, tls.expiringClient.keyUnencrypted);
    pem('expired', tls.expiredClient.pem, tls.expiredClient.keyUnencrypted);
    const p12 = (name: string, password: string) =>
      writeFileSync(join(folder, `tls-${name}.properties`), [`emc2.tls.${name}.trust-store=${at('truststore.jks')}`, `emc2.tls.${name}.trust-store-type=JKS`, `emc2.tls.${name}.trust-store-password=${tls.truststorePassword}`, `emc2.tls.${name}.key-store=${at(tls.clientCertificate)}`, `emc2.tls.${name}.key-store-type=PKCS12`, `emc2.tls.${name}.key-store-password=${password}`].join('\n'));
    p12('tak-p12', tls.clientCertificatePassword);
    p12('broken', 'not-the-password');
    // The deprecated keys, on the command line as tests may (ADR-0060 point 1).
    const legacy = [
      `--emc2.listeners.credentials.legacy.trust-store=${join(folder, 'truststore.p12')}`,
      `--emc2.listeners.credentials.legacy.trust-store-password=${tls.truststorePassword}`,
      `--emc2.listeners.credentials.legacy.key-store=${join(folder, tls.clientCertificate)}`,
      `--emc2.listeners.credentials.legacy.key-store-password=${tls.clientCertificatePassword}`,
    ];

    const server = await start(legacy);
    const names = await (await fetch(`${server.baseUrl}/api/settings/tls-credentials`)).json();
    expect(names, 'the names for the settings field, sorted').toEqual({ names: ['broken', 'expired', 'expiring', 'legacy', 'tak-encrypted', 'tak-p12', 'tak-pem'] });

    const listed = await credentials(server);
    const byName = Object.fromEntries(listed.map((c) => [c.name, c]));
    testInfo.annotations.push({ type: 'core.tls', description: JSON.stringify(listed.map((c) => ({ name: c.name, setting: c.setting, error: c.error, identity: c.identity.map((i) => `${i.subject} ${new Date(i.notAfterMillis).toISOString()} ${i.state}`), trusted: c.trusted.length }))) });
    expect(listed.map((c) => c.name).sort(), 'every credential in the Monitor').toEqual(names.names);
    const own = notAfter(tls.clientCertificatePem);
    for (const name of ['tak-pem', 'tak-encrypted', 'tak-p12', 'legacy']) {
      expect(byName[name].error, `${name}: readable`).toBeNull();
      expect(byName[name].identity[0], `${name}: the client's certificate, valid`).toMatchObject({ state: 'valid', notAfterMillis: own });
      expect(byName[name].trusted.length, `${name}: the trusted CA`).toBeGreaterThan(0);
    }
    expect(byName['tak-pem'].setting, 'read from emc2.tls.<name>').toBe('emc2.tls.tak-pem');
    expect(byName.legacy.setting, 'the deprecated keys').toBe('emc2.listeners.credentials.legacy');
    expect(byName.expiring.identity[0], 'expires within 30 days: soon, with its end').toMatchObject({ state: 'soon', notAfterMillis: notAfter(tls.expiringClient.pem) });
    expect(byName.expired.identity[0], 'expired, with its end').toMatchObject({ state: 'expired', notAfterMillis: notAfter(tls.expiredClient.pem) });
    expect(byName.broken.error, 'why it cannot be read').toBeTruthy();
    expect(byName.broken.identity, 'no chain with an error').toEqual([]);

    const secrets = [tls.clientCertificatePassword, tls.truststorePassword, 'not-the-password'];
    const monitor = JSON.stringify(listed);
    for (const s of secrets) expect(monitor.includes(s), 'no password in the Monitor').toBe(false);
    expect(monitor, 'no path in the Monitor').not.toMatch(/settings[\\/]credentials|%emcc%|\.p12|\.jks|ca\.pem/);

    const log = readFileSync(server.logFile, 'utf8');
    for (const s of secrets) expect(log.includes(s), 'no password in the log').toBe(false);
    const warnings = log.split(/\r?\n/).filter((l) => / WARN /.test(l) && /tls|TLS|credential/.test(l)).map((l) => l.replace(/^.*? : /, ''));
    testInfo.annotations.push({ type: 'TLS warnings in the log', description: warnings.join(' | ') });
    const expected = [/TLS credential broken/i, /TLS credential expired.*expired/i, /TLS credential expiring/i, /emc2\.listeners\.credentials\.legacy/];
    for (const pattern of expected) expect(warnings.some((w) => pattern.test(w)), `a warning: ${pattern}`).toBe(true);
    // The permission warning depends on the run folder's rights (private under the user's own Temp folder, readable
    // by Users elsewhere); m9-settings-files tests it on purpose, so here it is tolerated but not required.
    const readable = /can be read by other users/;
    await stopOwnServer(server, { expectedLog: [...expected, ...(readable.test(log) ? [readable] : [])] });
  });
});

test('a TLS credential whose file is missing stops the start, naming the setting (ADR-0062; server/README.md, "At start"; T1)', async ({}, testInfo) => {
  await withOwnServers(testInfo, async (folders, start) => {
    const folder = join(emccFolderOf(folders.dataDir), 'settings', 'credentials');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'tls-missing.properties'), 'emc2.tls.missing.trust-store=%emcc%/settings/credentials/no-such-ca.pem\nemc2.tls.missing.trust-store-type=PEM\n');
    await expect(start(), 'the start is stopped').rejects.toThrow(/exited during start-up/);
    const log = readFileSync(testInfo.outputPath('server-1.log'), 'utf8');
    testInfo.annotations.push({ type: 'why', description: (log.match(/^.*emc2\.tls\.missing.*$/m) ?? [''])[0].slice(0, 400) });
    expect(log, 'the setting named').toContain('emc2.tls.missing.trust-store');
  });
});
