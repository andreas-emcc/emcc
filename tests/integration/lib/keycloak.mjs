// A Keycloak test realm for the login tests (T-043; ADR-0022), set up and torn down through
// Keycloak's admin REST API only: nothing in Keycloak's installation or its keycloak.conf changes.
// Plain Node.js, used by the specs in specs/keycloak/ and by keycloak-realm.mjs.
//
// Secrets: Keycloak's admin user and password come from the environment (EMC2_KEYCLOAK_ADMIN,
// EMC2_KEYCLOAK_ADMIN_PASSWORD) or from the ESA's admin login for tests, keycloak.json in the
// service's credentials folder outside the repository (external/keycloak/README.md; T-069). The
// client secret is Keycloak's own, read after the realm is made; the test users' passwords are
// random for each realm. None of them is written to the repository.
import { spawnSync } from 'node:child_process';
import { externalMissing, externalPath } from './external.mjs';
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repository = join(here, '..', '..', '..');
/**
 * The ESA's admin login for tests (external/keycloak/README.md), with `admin.user` and
 * `admin.password`, in the ESA's folder named by EMC2_EXTERNAL_ROOT.
 */
export const ESA_CREDENTIALS = externalPath('credentials', 'keycloak', 'keycloak.json');
const REQUEST_TIMEOUT_MS = 15_000;

/** The client id at the IAM and the server's registration id (server/README.md). */
export const CLIENT_ID = 'emc2';

/**
 * The test users and their groups. The groups map to permissions as in server/README.md: editors
 * have objects.edit and layers.edit (what draw-symbols and layer-panel need), admins every
 * permission, settings.admin included. The viewer has none. The drawer has objects.edit only
 * (owner, 2026-10-14), so that the two edit permissions are tested apart.
 *
 * The simulator's Simulation workspace (ADR-0039) has view, edit and run permissions of its own,
 * which only the sim-* users have, each a different combination: simViewer may see it, simEditor
 * also change it, simRunner see it and run the simulation, and simBlind holds the edit permission
 * without the view permission. None of the other users has them.
 *
 * terrainUser alone has terrain's plugin.terrain.use (its README), so that the others show the
 * tools refused; the admin's and the editor's permissions stay as login.spec and permissions.spec
 * expect them.
 *
 * setter has settings.admin only, without objects.edit (T-175): the Settings workspace without the
 * shared Delete's right.
 */
export const USERS = {
  viewer: { username: 'ita-viewer', groups: [], firstName: 'Ita', lastName: 'Viewer' },
  drawer: { username: 'ita-drawer', groups: ['drawers'], firstName: 'Ita', lastName: 'Drawer' },
  editor: { username: 'ita-editor', groups: ['editors'], firstName: 'Ita', lastName: 'Editor' },
  admin: { username: 'ita-admin', groups: ['admins'], firstName: 'Ita', lastName: 'Admin' },
  simViewer: { username: 'ita-sim-viewer', groups: ['sim-viewers'], firstName: 'Ita', lastName: 'Sim Viewer' },
  simEditor: { username: 'ita-sim-editor', groups: ['sim-viewers', 'sim-editors'], firstName: 'Ita', lastName: 'Sim Editor' },
  simRunner: { username: 'ita-sim-runner', groups: ['sim-viewers', 'sim-runners'], firstName: 'Ita', lastName: 'Sim Runner' },
  simBlind: { username: 'ita-sim-blind', groups: ['sim-editors'], firstName: 'Ita', lastName: 'Sim Blind' },
  terrainUser: { username: 'ita-terrain', groups: ['terrain-users'], firstName: 'Ita', lastName: 'Terrain' },
  setter: { username: 'ita-setter', groups: ['setters'], firstName: 'Ita', lastName: 'Setter' },
};

export const PERMISSIONS_BY_GROUP = {
  'objects.edit': ['drawers', 'editors', 'admins'],
  'layers.edit': ['editors', 'admins'],
  'settings.admin': ['admins', 'setters'],
  'plugin.simulator.view': ['sim-viewers'],
  'plugin.simulator.edit': ['sim-editors'],
  'plugin.simulator.run': ['sim-runners'],
  'plugin.terrain.use': ['terrain-users'],
};

/** Keycloak's address when the login tests run (run.mjs: Keycloak runs, or --keycloak), else undefined. */
export function keycloakUrl() {
  const url = process.env.EMC2_KEYCLOAK_URL;
  return url ? url.replace(/\/+$/, '') : undefined;
}

export const NOT_ASKED =
  'The Keycloak specs run when the ESA\'s Keycloak runs (node external/keycloak/status.mjs) or with run.mjs --keycloak (Keycloak at http://localhost:8180, or set EMC2_KEYCLOAK_URL), with the ESA\'s admin login for tests (external/keycloak/README.md) or EMC2_KEYCLOAK_ADMIN and EMC2_KEYCLOAK_ADMIN_PASSWORD. See tests/integration/README.md, "Login with Keycloak".';

/**
 * Whether the ESA's Keycloak runs, by its status command (external/keycloak/README.md): `running`
 * when it exits with 0, and its STATUS line for the run's log.
 */
export function keycloakStatus() {
  const result = spawnSync(process.execPath, [join(repository, 'external', 'keycloak', 'status.mjs')], { cwd: repository, encoding: 'utf8', timeout: 30_000 });
  const line = (result.stdout ?? '').split(/\r?\n/).find((l) => l.startsWith('STATUS:')) ?? result.error?.message ?? `exit code ${result.status}`;
  return { running: result.status === 0, line };
}

/**
 * Keycloak's admin user and password: the environment first, then the ESA's admin login for tests
 * (T-069; the owner's keycloak.local.json is no longer read).
 */
export function adminCredentials() {
  let user = process.env.EMC2_KEYCLOAK_ADMIN;
  let password = process.env.EMC2_KEYCLOAK_ADMIN_PASSWORD;
  if ((!user || !password) && existsSync(ESA_CREDENTIALS)) {
    const admin = JSON.parse(readFileSync(ESA_CREDENTIALS, 'utf8').replace(/^﻿/, '')).admin ?? {};
    user ||= admin.user;
    password ||= admin.password;
  }
  if (!user || !password) {
    throw new Error(`no Keycloak admin credentials: set EMC2_KEYCLOAK_ADMIN and EMC2_KEYCLOAK_ADMIN_PASSWORD, or ${externalMissing("have the ESA's keycloak.json", ESA_CREDENTIALS)} (external/keycloak/README.md)`);
  }
  return { user, password };
}

/** Keycloak's admin REST API as the admin user of the master realm (admin-cli, password grant). */
export class KeycloakAdmin {
  static async connect(url = keycloakUrl() ?? 'http://localhost:8180', credentials = adminCredentials()) {
    const admin = new KeycloakAdmin(url, credentials);
    await admin.token();
    return admin;
  }

  constructor(url, credentials) {
    this.url = url;
    this.credentials = credentials;
    this.accessToken = undefined;
    this.renewAt = 0;
  }

  async token() {
    if (this.accessToken && Date.now() < this.renewAt) return this.accessToken;
    const response = await fetch(`${this.url}/realms/master/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: this.credentials.user, password: this.credentials.password }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`Keycloak at ${this.url} refused the admin login (${response.status}): check the admin credentials`);
    }
    const body = await response.json();
    this.accessToken = body.access_token;
    // Renewed well before it expires (admin-cli's tokens last 60 s by default).
    this.renewAt = Date.now() + Math.max(5, body.expires_in - 20) * 1000;
    return this.accessToken;
  }

  /** One admin API call; resolves with the parsed body (or null), rejects on a status not in `ok`. */
  async request(method, path, body, { ok = [200, 201, 204] } = {}) {
    const response = await fetch(`${this.url}/admin/realms${path}`, {
      method,
      headers: { Authorization: `Bearer ${await this.token()}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const text = await response.text();
    if (!ok.includes(response.status)) {
      throw new Error(`Keycloak ${method} /admin/realms${path} answered ${response.status}: ${text.slice(0, 300)}`);
    }
    return { status: response.status, body: text ? JSON.parse(text) : null };
  }

  /** The names of every realm. */
  async realmNames() {
    const { body } = await this.request('GET', '', undefined, { ok: [200] });
    return body.map((r) => r.realm);
  }

  async realmExists(realm) {
    const { status } = await this.request('GET', `/${encodeURIComponent(realm)}`, undefined, { ok: [200, 404] });
    return status === 200;
  }

  async deleteRealm(realm) {
    refuseMaster(realm);
    await this.request('DELETE', `/${encodeURIComponent(realm)}`, undefined, { ok: [204, 404] });
  }

  /**
   * Makes the realm afresh (an old one of that name is deleted first) with the client, its groups
   * mapper, the groups and the test users (README, "Login with Keycloak"). `serverUrl` is the emc2
   * server the client sends the browser back to; with a server whose port is not known yet, call
   * `realm.pointAt(url)` once it is. Resolves with the realm's handle.
   */
  async createRealm({ realm, serverUrl = 'http://127.0.0.1:8080', accessTokenLifespan = 300 }) {
    refuseMaster(realm);
    const passwords = Object.fromEntries(Object.keys(USERS).map((key) => [key, randomBytes(18).toString('base64url')]));
    await this.deleteRealm(realm);
    await this.request('POST', '', {
      realm,
      enabled: true,
      displayName: `emc2 test realm (${realm})`,
      accessTokenLifespan,
      // Events as evidence for the tests (renewals, logouts); Keycloak keeps them in its database.
      eventsEnabled: true,
      enabledEventTypes: ['LOGIN', 'LOGIN_ERROR', 'LOGOUT', 'CODE_TO_TOKEN', 'CODE_TO_TOKEN_ERROR', 'REFRESH_TOKEN', 'REFRESH_TOKEN_ERROR'],
      eventsExpiration: 86_400,
      groups: [...new Set(Object.values(USERS).flatMap((user) => user.groups))].map((name) => ({ name })),
      clients: [clientRepresentation(serverUrl)],
      users: Object.entries(USERS).map(([key, user]) => ({
        username: user.username,
        enabled: true,
        email: `${user.username}@emc2.test`,
        emailVerified: true,
        firstName: user.firstName,
        lastName: user.lastName,
        requiredActions: [],
        credentials: [{ type: 'password', value: passwords[key], temporary: false }],
        groups: user.groups.map((group) => `/${group}`),
      })),
    });
    const handle = new TestRealm(this, realm, passwords);
    await handle.load();
    return handle;
  }
}

/** Keycloak's own realm, which holds its admin user, is never made or deleted here. */
function refuseMaster(realm) {
  if (realm.toLowerCase() === 'master') throw new Error("the realm 'master' is Keycloak's own: choose another name");
}

/** The client at the IAM for an emc2 server at `serverUrl` (server/README.md, "The client at the IAM"). */
function clientRepresentation(serverUrl) {
  return {
    clientId: CLIENT_ID,
    name: 'emc2',
    protocol: 'openid-connect',
    enabled: true,
    publicClient: false,
    clientAuthenticatorType: 'client-secret',
    standardFlowEnabled: true,
    implicitFlowEnabled: false,
    directAccessGrantsEnabled: false,
    serviceAccountsEnabled: false,
    frontchannelLogout: false,
    ...clientUrls(serverUrl),
    protocolMappers: [
      {
        name: 'groups',
        protocol: 'openid-connect',
        protocolMapper: 'oidc-group-membership-mapper',
        config: { 'claim.name': 'groups', 'full.path': 'false', 'id.token.claim': 'true', 'access.token.claim': 'true', 'userinfo.token.claim': 'true' },
      },
    ],
  };
}

function clientUrls(serverUrl) {
  const base = serverUrl.replace(/\/+$/, '');
  return {
    rootUrl: base,
    baseUrl: '/',
    redirectUris: [`${base}/login/oauth2/code/${CLIENT_ID}`],
    webOrigins: [],
    attributes: {
      'pkce.code.challenge.method': 'S256',
      'post.logout.redirect.uris': `${base}/`,
      'backchannel.logout.url': `${base}/logout/connect/back-channel/${CLIENT_ID}`,
      'backchannel.logout.session.required': 'true',
      'backchannel.logout.revoke.offline.tokens': 'false',
    },
  };
}

/** A test realm made by `KeycloakAdmin.createRealm`. */
export class TestRealm {
  constructor(admin, name, passwords) {
    this.admin = admin;
    this.name = name;
    this.passwords = passwords;
    this.issuer = `${admin.url}/realms/${name}`;
    this.clientId = CLIENT_ID;
    this.clientSecret = undefined;
    /** key → { username, password, id } */
    this.users = {};
  }

  path(rest = '') {
    return `/${encodeURIComponent(this.name)}${rest}`;
  }

  async load() {
    const { body: clients } = await this.admin.request('GET', this.path(`/clients?clientId=${CLIENT_ID}`));
    this.clientUuid = clients[0].id;
    const { body: secret } = await this.admin.request('GET', this.path(`/clients/${this.clientUuid}/client-secret`));
    this.clientSecret = secret.value;
    for (const [key, user] of Object.entries(USERS)) {
      const { body: found } = await this.admin.request('GET', this.path(`/users?exact=true&username=${user.username}`));
      this.users[key] = { username: user.username, password: this.passwords[key], id: found[0].id };
    }
  }

  /** Points the client's redirect, post-logout and back-channel logout URLs at the emc2 server. */
  async pointAt(serverUrl) {
    const { body: client } = await this.admin.request('GET', this.path(`/clients/${this.clientUuid}`));
    const urls = clientUrls(serverUrl);
    await this.admin.request('PUT', this.path(`/clients/${this.clientUuid}`), { ...client, ...urls, attributes: { ...client.attributes, ...urls.attributes } });
  }

  /**
   * The server's login settings (server/README.md): command-line arguments, and the environment
   * that carries the client secret (not on the command line, where other programs could read it).
   */
  serverLogin({ clientSecret = this.clientSecret } = {}) {
    return {
      args: [
        '--emc2.login.mode=oidc',
        `--emc2.login.oidc.issuer-uri=${this.issuer}`,
        `--emc2.login.oidc.client-id=${this.clientId}`,
        '--emc2.login.oidc.roles-claim=groups',
        ...Object.entries(PERMISSIONS_BY_GROUP).map(([permission, groups]) => `--emc2.login.oidc.permissions[${permission}]=${groups.join(',')}`),
      ],
      env: { EMC2_LOGIN_OIDC_CLIENT_SECRET: clientSecret },
    };
  }

  /** The user's sessions at the IAM. */
  async sessionsOf(key) {
    return (await this.admin.request('GET', this.path(`/users/${this.users[key].id}/sessions`))).body;
  }

  /** Ends all of the user's sessions at the IAM; Keycloak tells the client by back-channel logout. */
  async logOut(key) {
    await this.admin.request('POST', this.path(`/users/${this.users[key].id}/logout`));
  }

  async setEnabled(key, enabled) {
    const { body: user } = await this.admin.request('GET', this.path(`/users/${this.users[key].id}`));
    await this.admin.request('PUT', this.path(`/users/${this.users[key].id}`), { ...user, enabled });
  }

  /** The realm's events of a type, newest first (Keycloak's event store). */
  async events(type) {
    return (await this.admin.request('GET', this.path(`/events?type=${type}&client=${CLIENT_ID}&max=1000`))).body;
  }

  async delete() {
    await this.admin.deleteRealm(this.name);
  }
}
