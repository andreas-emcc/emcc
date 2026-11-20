// The mass test's instances (mass/PLAN.md, section 1): each with its own data folder and port, from the tree's build or
// a release zip; the picture each one shows, with the time every event arrived; settings and load.
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { externalMissing, externalPath } from '../lib/external.mjs';
import { LiveClient } from '../lib/live.mjs';
import { freePort, startRelease, unpack } from '../lib/release';
import { installPlugins } from '../lib/plugins.mjs';
import { emccFolderOf, makeRunFolders, startServer } from '../lib/server.mjs';
import { freeUdpPort } from '../lib/udp-peer.mjs';

const run = promisify(execFile);

/** Never used: WinTAK's TAK port and the owner's RC copy (MCA, 2026-11-20). */
export const AVOIDED_PORTS = new Set([8087, 18433]);

export type Instance = {
  index: number;
  name: string;
  baseUrl: string;
  port: number;
  /** Where its settings live (its emcc folder, or the release's). */
  home: string;
  log: () => string | undefined;
  live: LiveClient;
  picture: Picture;
  stop: () => Promise<string>;
};

/** The TAK Server's client certificate as a named TLS credential, `mass-tak` (PEM, its key without a password). */
export const TAK_CREDENTIAL = 'mass-tak';
const TAK_FOLDER = externalPath('credentials', 'tak-server');

export function takCredentialsMissing(): string | null {
  if (TAK_FOLDER === '' || !existsSync(join(TAK_FOLDER, 'tak-server.json'))) return externalMissing('the TAK client certificates', TAK_FOLDER);
  return null;
}

/** Copies the client certificate, its unencrypted key and the CA into the instance's settings (never a password). */
function writeTakCredential(home: string) {
  const tls = JSON.parse(readFileSync(join(TAK_FOLDER, 'tak-server.json'), 'utf8')).tls;
  const folder = join(home, 'settings', 'credentials');
  mkdirSync(folder, { recursive: true });
  for (const f of ['ca.pem', tls.clientCertificatePem, tls.clientKeyPemUnencrypted]) copyFileSync(join(TAK_FOLDER, f), join(folder, f));
  const at = (f: string) => `%emcc%/settings/credentials/${f}`;
  writeFileSync(
    join(folder, `tls-${TAK_CREDENTIAL}.properties`),
    [
      `emc2.tls.${TAK_CREDENTIAL}.trust-store=${at('ca.pem')}`,
      `emc2.tls.${TAK_CREDENTIAL}.trust-store-type=PEM`,
      `emc2.tls.${TAK_CREDENTIAL}.key-store-type=PEM`,
      `emc2.tls.${TAK_CREDENTIAL}.certificate=${at(tls.clientCertificatePem)}`,
      `emc2.tls.${TAK_CREDENTIAL}.private-key=${at(tls.clientKeyPemUnencrypted)}`,
    ].join('\n'),
  );
}

/** A free port that is none of the avoided ones. */
export async function freeTcpPort(): Promise<number> {
  for (;;) {
    const port = await freePort();
    if (!AVOIDED_PORTS.has(port)) return port;
  }
}

export async function freeUdp(): Promise<number> {
  for (;;) {
    const port = await freeUdpPort();
    if (!AVOIDED_PORTS.has(port)) return port;
  }
}

export async function startInstance(index: number, out: string, options: { release: string; tak: boolean }): Promise<Instance> {
  const name = String.fromCharCode(65 + index);
  const folders = join(out, 'folders');
  mkdirSync(folders, { recursive: true });
  let baseUrl: string;
  let port: number;
  let home: string;
  let log: () => string | undefined;
  let stop: () => Promise<string>;
  if (options.release === '') {
    const run = makeRunFolders(`emc2-mass-${name.toLowerCase()}-`, folders);
    home = emccFolderOf(run.dataDir);
    // Every assembled plugin but basemap-osm (without a tile server of the test's, so nothing reaches the internet).
    if (installPlugins(run.pluginsDir).length === 0) throw new Error('no assembled plugins in build/plugins (build first: --build)');
    if (options.tak) writeTakCredential(home);
    const logFile = join(out, `instance-${name}.log`);
    const server = await startServer({ dataDir: run.dataDir, pluginsDir: run.pluginsDir, logFile });
    if (AVOIDED_PORTS.has(server.port)) {
      await server.stop();
      throw new Error(`instance ${name} got port ${server.port}, which this test must not use`);
    }
    baseUrl = server.baseUrl;
    port = server.port;
    log = () => logFile;
    stop = async () => (await server.stop()).detail;
  } else {
    const base = mkdtempSync(join(folders, `emcc-${name.toLowerCase()}-`));
    home = unpack(options.release, base);
    if (options.tak) writeTakCredential(home);
    port = await freeTcpPort();
    const started = await startRelease(home, port, `mass-${name}`, ['-standalone']);
    baseUrl = `http://127.0.0.1:${port}`;
    log = () => {
      const logs = join(home, 'logs');
      if (!existsSync(logs)) return undefined;
      const files = readdirSync(logs).filter((f) => f.endsWith('.log')).map((f) => join(logs, f));
      return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
    };
    stop = async () => {
      await started.stop();
      return 'stopped';
    };
  }
  const live = await LiveClient.open(baseUrl);
  const snapshot = await live.subscribe({ workspaces: ['*'], timeoutMs: 60_000 });
  const picture = new Picture(live, snapshot);
  return { index, name, baseUrl, port, home, log, live, picture, stop };
}

export type Arrival = { at: number; event: any };

/** The objects an instance holds, kept from its live stream, and when each event arrived. */
export class Picture {
  objects = new Map<string, any>();
  arrivals: Arrival[] = [];

  constructor(live: LiveClient, snapshot: any) {
    for (const o of snapshot.objects ?? []) this.objects.set(o.id, o);
    const client = live as any;
    client.socket.addEventListener('message', (message: { data: unknown }) => {
      const m = JSON.parse(String(message.data));
      if (m.type !== 'changes') return;
      const at = Date.now();
      for (const e of m.events) {
        if (e.entityType !== 'object') continue;
        this.arrivals.push({ at, event: e });
        if (e.operation === 'delete' || e.state == null) this.objects.delete(e.entityId);
        else this.objects.set(e.entityId, e.state);
      }
      // The live client keeps every message; the mass test reads them here, so its lists stay short.
      if (client.inbox.length > 500) client.inbox = client.inbox.filter((x: any) => x.type !== 'changes');
      if (client.events.length > 5000) client.events.length = 0;
      client.eventsBy.clear();
    });
  }

  /** The objects whose externalRef is `system`, by its id. */
  bySystem(system: string): Map<string, any[]> {
    const map = new Map<string, any[]>();
    for (const o of this.objects.values()) {
      const ref = o.meta?.externalRef;
      if (ref?.system !== system) continue;
      map.set(ref.id, [...(map.get(ref.id) ?? []), o]);
    }
    return map;
  }

  inLayer(layerId: string): any[] {
    return [...this.objects.values()].filter((o) => o.layerId === layerId);
  }
}

/** PUT a plugin's settings, keeping the values not named. */
export async function putSettings(baseUrl: string, plugin: string, patch: Record<string, unknown>): Promise<void> {
  const url = `${baseUrl}/api/settings/plugins/${plugin}`;
  const current = await fetch(url);
  const text = await current.text();
  if (current.status !== 200 || text === '') throw new Error(`GET ${url}: ${current.status} ${text.slice(0, 200)}`);
  const values = JSON.parse(text).values;
  const response = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, ...patch }) });
  if (response.status !== 200) throw new Error(`${plugin} settings on ${baseUrl}: ${response.status} ${await response.text()}`);
}

export async function getJson(url: string): Promise<any> {
  const response = await fetch(url);
  const text = await response.text();
  if (response.status !== 200) throw new Error(`GET ${url}: ${response.status} ${text}`);
  return text === '' ? null : JSON.parse(text);
}

export async function postJson(url: string, body: unknown): Promise<any> {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await response.text();
  if (response.status !== 200) throw new Error(`POST ${url}: ${response.status} ${text}`);
  return text === '' ? null : JSON.parse(text);
}

export type Load = { at: number; instance: string; cpuSeconds: number | null; memoryMb: number | null };

/** The CPU time and memory of the process listening on `port` (Windows: PowerShell; Linux: ss and ps). */
export async function sampleLoad(instance: string, port: number): Promise<Load> {
  const at = Date.now();
  try {
    if (process.platform === 'win32') {
      const script = `$p=(Get-NetTCPConnection -LocalPort ${port} -State Listen | Select-Object -First 1).OwningProcess; $g=Get-Process -Id $p; '{0} {1}' -f $g.CPU,$g.WorkingSet64`;
      const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { timeout: 20_000 });
      const [cpu, bytes] = stdout.trim().split(/\s+/).map((s) => Number(s.replace(',', '.')));
      return { at, instance, cpuSeconds: cpu, memoryMb: Math.round(bytes / 1048576) };
    }
    const { stdout: ss } = await run('ss', ['-ltnpH', `sport = :${port}`], { timeout: 10_000 });
    const pid = /pid=(\d+)/.exec(ss)?.[1];
    if (!pid) return { at, instance, cpuSeconds: null, memoryMb: null };
    const { stdout } = await run('ps', ['-o', 'times=,rss=', '-p', pid], { timeout: 10_000 });
    const [cpu, rss] = stdout.trim().split(/\s+/).map(Number);
    return { at, instance, cpuSeconds: cpu, memoryMb: Math.round(rss / 1024) };
  } catch {
    return { at, instance, cpuSeconds: null, memoryMb: null };
  }
}
