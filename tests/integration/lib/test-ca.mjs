// The ESA's test CA (external/test-ca/README.md; M9 E1, ADR-0061): the certificates of emcc's HTTPS test
// server, read from the ESA's credentials folder and copied into a test server's own emcc folder
// (settings/credentials/), never into the repository. The CA's certificate is the trust of the test
// processes: run.mjs puts it in NODE_EXTRA_CA_CERTS, so Node's fetch and the WebSocket client trust the
// test server, and only it. Passwords are read from the folder's index and never printed.
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { externalMissing, externalPath } from './external.mjs';
import { join } from 'node:path';

/** The ESA's credentials folder of the test CA (EMC2_EXTERNAL_ROOT, else the sheet's). */
export const TEST_CA_FOLDER = externalPath('credentials', 'test-ca');
/** The CA's certificate, the clients' trust. */
export const TEST_CA_PEM = TEST_CA_FOLDER === '' ? '' : join(TEST_CA_FOLDER, 'test-ca.pem');

/** Why the HTTPS specs cannot run, or undefined when they can. */
export function testCaMissing() {
  if (TEST_CA_FOLDER === '' || !existsSync(join(TEST_CA_FOLDER, 'test-ca.json'))) return `${externalMissing('the test CA', TEST_CA_FOLDER)} (the ESA's external/test-ca/, E1)`;
  if (process.env.NODE_EXTRA_CA_CERTS !== TEST_CA_PEM) return 'the test processes do not trust the test CA (run through run.mjs, which sets NODE_EXTRA_CA_CERTS)';
  return undefined;
}

/** run.mjs: the environment that makes the test processes trust the test CA, when the ESA's folder is there. */
export function testCaEnvironment() {
  return existsSync(TEST_CA_PEM) ? { NODE_EXTRA_CA_CERTS: TEST_CA_PEM } : {};
}

/**
 * A server certificate of the test CA: its files and its index entry (`notAfter`, `serial`, `names`).
 * @param {string} name `emcc-server` or `emcc-server-expiring`
 */
export function serverCertificate(name) {
  const index = JSON.parse(readFileSync(join(TEST_CA_FOLDER, 'test-ca.json'), 'utf8'));
  const entry = index.servers?.[name];
  if (!entry) throw new Error(`the test CA has no server certificate ${name}`);
  return entry;
}

/** Copies a file of the test CA's folder into `folder` under `as` (default: its own name). */
function copy(file, folder, as = file) {
  mkdirSync(folder, { recursive: true });
  copyFileSync(join(TEST_CA_FOLDER, file), join(folder, as));
}

/**
 * Writes `settings/credentials/https.properties` into an emcc folder for a test CA certificate, with the
 * files beside it, named by `%emcc%/` (ADR-0061 point 3). Formats: `pkcs12` (the `.p12`, alias `emcc`),
 * `pem` (the chain and the unencrypted key) or `pem-encrypted` (the chain and the encrypted key with its
 * password). The PEM files are copied as `server.pem` and `server.key`, so that a renewal can replace them.
 * Returns the written file's path.
 */
export function writeHttpsSettings(emccFolder, name, format = 'pkcs12') {
  const cert = serverCertificate(name);
  const credentials = join(emccFolder, 'settings', 'credentials');
  const lines = [`# The test CA's ${name} (tests/integration/lib/test-ca.mjs), ${format}`];
  if (format === 'pkcs12') {
    copy(cert.pkcs12, credentials, 'server.p12');
    lines.push(
      'spring.ssl.bundle.jks.emcc.keystore.location=%emcc%/settings/credentials/server.p12',
      `spring.ssl.bundle.jks.emcc.keystore.password=${cert.password}`,
      'spring.ssl.bundle.jks.emcc.keystore.type=PKCS12',
      `spring.ssl.bundle.jks.emcc.key.alias=${cert.alias}`,
    );
  } else {
    copy(cert.pem, credentials, 'server.pem');
    copy(format === 'pem' ? cert.key : cert.encryptedKey, credentials, 'server.key');
    lines.push('spring.ssl.bundle.pem.emcc.keystore.certificate=%emcc%/settings/credentials/server.pem', 'spring.ssl.bundle.pem.emcc.keystore.private-key=%emcc%/settings/credentials/server.key');
    if (format === 'pem-encrypted') lines.push(`spring.ssl.bundle.pem.emcc.keystore.private-key-password=${cert.password}`);
  }
  const file = join(credentials, 'https.properties');
  writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

/** A renewal of a PEM bundle written by `writeHttpsSettings`: the chain and the unencrypted key of `name` replace the ones there. */
export function renewPem(emccFolder, name) {
  const cert = serverCertificate(name);
  const credentials = join(emccFolder, 'settings', 'credentials');
  // The key first, then the chain: the bundle reloads on a change of either; both are there within ms.
  copy(cert.key, credentials, 'server.key');
  copy(cert.pem, credentials, 'server.pem');
}
