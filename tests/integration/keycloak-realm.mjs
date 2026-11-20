// Sets up or tears down a Keycloak realm for emc2 with login (T-043): for checks by hand with a
// real login, by the CDA, the PCAs or the owner. The login specs make their own realms (emc2-ita-<time>-<random>, T-124).
// Plain Node.js, Windows and Linux; through Keycloak's admin REST API only.
//
// Usage: node tests/integration/keycloak-realm.mjs setup|teardown [--realm emc2] [--server http://localhost:8080] [--keycloak http://localhost:8180] [--force]
//   setup     makes the realm (with --force afresh, when one of that name exists): the confidential client
//             "emc2" for the server at --server, its groups mapper, the groups drawers, editors and
//             admins, and the users ita-viewer, ita-drawer, ita-editor and ita-admin with random
//             passwords. Writes the server's login settings (with the client secret) and the passwords to
//             tests/integration/keycloak-<realm>.local.properties, which git ignores; prints none.
//   teardown  deletes the realm and that file.
// Keycloak's own realm "master" is refused.
// Keycloak's admin user and password: EMC2_KEYCLOAK_ADMIN and EMC2_KEYCLOAK_ADMIN_PASSWORD, or
// the ESA's admin login for tests (external/keycloak/README.md; T-069).
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KeycloakAdmin, PERMISSIONS_BY_GROUP, USERS } from './lib/keycloak.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const command = args[0];
const realmName = option('--realm', 'emc2');
const serverUrl = option('--server', 'http://localhost:8080').replace(/\/+$/, '');
const keycloak = option('--keycloak', process.env.EMC2_KEYCLOAK_URL || 'http://localhost:8180').replace(/\/+$/, '');
const force = args.includes('--force');
const settingsFile = join(here, `keycloak-${realmName}.local.properties`);

if (command !== 'setup' && command !== 'teardown') {
  console.error('Usage: node tests/integration/keycloak-realm.mjs setup|teardown [--realm emc2] [--server http://localhost:8080] [--keycloak http://localhost:8180] [--force]');
  process.exitCode = 2;
} else {
  try {
    const admin = await KeycloakAdmin.connect(keycloak);
    if (command === 'teardown') {
      await admin.deleteRealm(realmName);
      rmSync(settingsFile, { force: true });
      console.log(`Deleted the realm ${realmName} at ${keycloak} and ${settingsFile}.`);
    } else if (!force && (await admin.realmExists(realmName))) {
      console.error(`The realm ${realmName} exists at ${keycloak} already: nothing changed. "setup --force" makes it afresh (new secrets, its users and sessions lost); "teardown" deletes it.`);
      process.exitCode = 1;
    } else {
      const realm = await admin.createRealm({ realm: realmName, serverUrl });
      const lines = [
        `# emc2 login settings for the Keycloak realm "${realmName}" (made by tests/integration/keycloak-realm.mjs,`,
        `# ${new Date().toISOString()}), for the server at ${serverUrl}. Local only: git ignores this file.`,
        '# Use it as application-local.properties with the profile "local" (server/README.md), or pass the',
        '# lines as command-line options; never commit the client secret.',
        ...realm.serverLogin().args.map((arg) => arg.replace(/^--/, '')),
        `emc2.login.oidc.client-secret=${realm.clientSecret}`,
        '',
        '# Test users (password login at Keycloak):',
        ...Object.entries(USERS).map(([key, user]) => `#   ${user.username} / ${realm.users[key].password}   groups: ${user.groups.join(', ') || '(none)'}`),
        `# Permissions by group: ${Object.entries(PERMISSIONS_BY_GROUP).map(([p, g]) => `${p} = ${g.join(', ')}`).join('; ')}`,
        '',
      ];
      writeFileSync(settingsFile, lines.join('\n'));
      console.log(`Made the realm ${realmName} at ${keycloak} (issuer ${realm.issuer}) for the server at ${serverUrl}.`);
      console.log(`Server settings, client secret and the test users' passwords: ${settingsFile} (ignored by git).`);
    }
  } catch (error) {
    console.error(`keycloak-realm: ${error.message}`);
    process.exitCode = 1;
  }
}
