import { expect } from '@playwright/test';
import type { OwnServer } from './own-server';

// Helpers for the cot plugin's acceptance criteria (docs/plugins/briefs/cot.md, T-040, T-043): its
// links are set at runtime through its settings, and what it does shows in its status. Since M3
// (T-084 part 1) the plugin reads `links`, not the `streams` of M1.

/**
 * A link (plugins/cot/plugin.json): `in` by default, over TCP to 127.0.0.1 unless it says otherwise.
 * `targetLayer.name` is the M1 stream's `layerName` (absent: a new layer named like the link); out
 * and both links send the objects of their `sourceLayers`.
 */
export type Link = {
  name: string;
  direction?: 'in' | 'out' | 'both';
  transport?: 'tcp' | 'tls' | 'udp' | 'multicast';
  host?: string;
  port: number;
  /** udp: the local address to listen on; multicast: the group. */
  address?: string;
  /** multicast: the network interface's name. */
  interface?: string;
  targetLayer?: { id?: string; name: string };
  sourceLayers?: Array<{ id?: string; name: string }>;
  highestClassification?: { policy: string; classification: string };
  staleSeconds?: number;
  refreshSeconds?: number;
  enabled?: boolean;
};

/** A link as the settings take it: TCP and TLS links, and UDP links that send, get the host 127.0.0.1 unless they name one. */
function settingOf(link: Link) {
  const direction = link.direction ?? 'in';
  const transport = link.transport ?? 'tcp';
  const needsHost = transport === 'tcp' || transport === 'tls' || (transport === 'udp' && direction !== 'in');
  return { direction, ...(needsHost ? { host: '127.0.0.1' } : {}), ...link };
}

type Server = Pick<OwnServer, 'baseUrl'>;

/**
 * Sets the cot plugin's links (the rest of its settings as they are); resolves with the values.
 * With login, `headers` carry an admin's session (Cookie).
 */
export async function setLinks(server: Server, links: Link[], other: Record<string, unknown> = {}, headers: Record<string, string> = {}) {
  const url = `${server.baseUrl}/api/settings/plugins/cot`;
  const values = (await (await fetch(url, { headers })).json()).values;
  const response = await fetch(url, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...values, ...other, links: links.map(settingOf) }),
  });
  expect(response.status, `cot settings: ${await response.clone().text()}`).toBe(200);
  return (await response.json()).values;
}

/** The cot plugin's status: { state, detail }, the detail with one part per link. */
export async function cotStatus(server: Server): Promise<{ state: string; detail: string }> {
  const plugins = (await (await fetch(`${server.baseUrl}/api/plugins`)).json()) as Array<{ id: string; status: { state: string; detail: string } }>;
  return plugins.find((p) => p.id === 'cot')!.status;
}

/** One link's part of the status detail, e.g. "tak-north: connected since …, 3 read, 1 created, 2 updated". */
export async function linkStatus(server: Server, name: string): Promise<string> {
  const { detail } = await cotStatus(server);
  return detail.split('; ').find((part) => part.startsWith(`${name}: `)) ?? '';
}

export type CotObject = {
  id: string;
  layerId: string;
  dataType: string;
  dataSource: string;
  geometry: { coordinates: [number, number] };
  symbol: { standard: string; sidc: string; modifiers?: Record<string, unknown> };
  properties?: Record<string, unknown>;
  time?: Record<string, string>;
  extensions?: Record<string, Record<string, unknown>>;
  meta: { externalRef?: { system: string; id: string }; modified?: { by?: { system?: string } }; created?: { by?: { system?: string } } };
};

/** The objects of a snapshot that came from CoT with this uid. */
export function byUid(objects: CotObject[], uid: string): CotObject[] {
  return objects.filter((o) => o.meta.externalRef?.system === 'cot' && o.meta.externalRef.id === uid);
}
