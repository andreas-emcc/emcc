// Certificates made at test time for TLS tests (the cot brief's criterion 9): a CA, a server
// certificate for 127.0.0.1 and localhost, and a client certificate, each signed by the CA. Made
// with the JDK's keytool, which the suite needs anyway (test plugins), so nothing is installed.
// Everything goes into a folder of the caller's (a run's or a test's output), with random
// passwords; nothing of it is ever committed.
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const VALID_DAYS = '2';

function keytool(args) {
  execFileSync('keytool', args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

/**
 * Makes the certificates in `folder` and returns their files and passwords:
 * - `server`: PKCS #12 with the server's key and certificate chain (for the TAK test double);
 * - `client`: PKCS #12 with the client's key and chain (a TAK client: emc2's key store);
 * - `trustStore`: PKCS #12 with only the CA certificate (emc2's trust store);
 * - `caPem`: the CA certificate as PEM (for Node's TLS: whom the double trusts).
 * One password for all of them, random per call.
 */
export function makeTestCertificates(folder, { clientName = 'emc2-ita-client' } = {}) {
  mkdirSync(folder, { recursive: true });
  const password = randomBytes(18).toString('base64url');
  const file = (name) => join(folder, name);
  const store = (name) => ['-keystore', file(name), '-storetype', 'PKCS12', '-storepass', password];
  const key = (alias, dname, name, extra = []) =>
    keytool(['-genkeypair', '-alias', alias, '-keyalg', 'RSA', '-keysize', '2048', '-dname', dname, '-validity', VALID_DAYS, ...extra, ...store(name)]);

  // The CA, and its certificate as PEM.
  key('ca', 'CN=emc2 ITA test CA', 'ca.p12', ['-ext', 'bc:c']);
  keytool(['-exportcert', '-rfc', '-alias', 'ca', '-file', file('ca.pem'), ...store('ca.p12')]);

  // A key pair signed by the CA, with the chain imported into its store.
  const signed = (alias, dname, name, extensions) => {
    key(alias, dname, name);
    keytool(['-certreq', '-alias', alias, '-file', file(`${alias}.csr`), ...store(name)]);
    keytool(['-gencert', '-alias', 'ca', '-infile', file(`${alias}.csr`), '-outfile', file(`${alias}.pem`), '-rfc', '-validity', VALID_DAYS, ...extensions.flatMap((e) => ['-ext', e]), ...store('ca.p12')]);
    keytool(['-importcert', '-noprompt', '-trustcacerts', '-alias', 'ca', '-file', file('ca.pem'), ...store(name)]);
    keytool(['-importcert', '-noprompt', '-alias', alias, '-file', file(`${alias}.pem`), ...store(name)]);
  };
  signed('server', 'CN=127.0.0.1', 'server.p12', ['san=ip:127.0.0.1,dns:localhost', 'eku=serverAuth']);
  signed('client', `CN=${clientName}`, 'client.p12', ['eku=clientAuth']);

  keytool(['-importcert', '-noprompt', '-alias', 'ca', '-file', file('ca.pem'), ...store('truststore.p12')]);

  const result = {
    folder,
    password,
    server: file('server.p12'),
    client: file('client.p12'),
    trustStore: file('truststore.p12'),
    caPem: file('ca.pem'),
    clientName,
  };
  writeFileSync(file('README.txt'), 'Made at test time by tests/integration/lib/test-certs.mjs. Never commit these files.\n');
  return result;
}

let shared;

/**
 * The certificates of this test process, made once (keytool takes seconds) into the run's output
 * folder (ignored by git; the runner keeps the newest 10 run folders).
 */
export function testCertificates() {
  shared ??= makeTestCertificates(join(process.env.EMC2_OUT ?? join('out', 'manual'), 'certs', String(process.pid)));
  return shared;
}

/**
 * The server options that give emc2's listeners the credentials `name` (server/README.md,
 * "Listeners": emc2.listeners.credentials.<name>.*): the CA as trust store, the client certificate
 * as key store.
 */
export function listenerCredentialArgs(certs, name) {
  const prefix = `--emc2.listeners.credentials.${name}`;
  return [
    `${prefix}.trust-store=${certs.trustStore}`,
    `${prefix}.trust-store-password=${certs.password}`,
    `${prefix}.key-store=${certs.client}`,
    `${prefix}.key-store-password=${certs.password}`,
  ];
}

/** Node TLS options for the double's server side: its certificate, and the CA it trusts for clients. */
export function serverTlsOptions(certs) {
  return { pfx: readFileSync(certs.server), passphrase: certs.password, ca: readFileSync(certs.caPem) };
}

/** Node TLS options for a test client with the client certificate (or without, `withCertificate: false`). */
export function clientTlsOptions(certs, { withCertificate = true } = {}) {
  return {
    ca: readFileSync(certs.caPem),
    ...(withCertificate ? { pfx: readFileSync(certs.client), passphrase: certs.password } : {}),
  };
}
