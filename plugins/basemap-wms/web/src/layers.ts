// The layers of a saved server, as the plugin's server part reads them from the server's capabilities (brief, function 4).
// Needs `settings.admin`; the request names the server by its saved id and carries no address (ADR-0030).
import type { LayerInfo } from './settings.ts';

export interface LayerList {
  readonly layers: readonly LayerInfo[];
  /** When the server part read the capabilities, or null if it has not. */
  readonly readAt: string | null;
  /** Why the last read failed, or null. */
  readonly error: string | null;
  /** Whether the server part is reading the capabilities now. */
  readonly reading: boolean;
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && (value as unknown[]).every((v) => typeof v === 'string');
}

/** @throws Error with a message for the admin, if the request fails or the answer is not a layer list */
export async function fetchLayers(serverBase: string, serverId: string, refresh: boolean): Promise<LayerList> {
  const response = await fetch(`${serverBase}servers/${encodeURIComponent(serverId)}/layers${refresh ? '?refresh=true' : ''}`, { cache: 'no-store' });
  if (response.status === 403) throw new Error('Reading the server’s layers needs the settings permission.');
  if (response.status === 404) throw new Error('The server is not saved yet.');
  if (!response.ok) throw new Error(`The server part answered ${String(response.status)}.`);
  const json = (await response.json()) as unknown;
  const o = typeof json === 'object' && json !== null ? (json as Readonly<Record<string, unknown>>) : {};
  const raw: unknown = o['layers'];
  if (!Array.isArray(raw)) throw new Error('The server part gave an answer that is not a layer list.');
  const layers: LayerInfo[] = [];
  for (const item of raw as unknown[]) {
    const layer = typeof item === 'object' && item !== null ? (item as Readonly<Record<string, unknown>>) : {};
    if (typeof layer['name'] !== 'string' || typeof layer['title'] !== 'string' || !isStrings(layer['projections'])) {
      throw new Error('The server part gave an answer that is not a layer list.');
    }
    layers.push({ name: layer['name'], title: layer['title'], projections: layer['projections'] });
  }
  return {
    layers,
    readAt: typeof o['readAt'] === 'string' ? o['readAt'] : null,
    error: typeof o['error'] === 'string' ? o['error'] : null,
    reading: o['reading'] === true,
  };
}
