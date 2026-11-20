// A stand-in for the plugin's own server part: `fetch` answers the two endpoints the web part uses, and records every URL.
import { vi } from 'vitest';
import type { JsonValue, Settings } from '@emc2/plugin-sdk';

export const SERVER_BASE = '/api/plugins/basemap-wms/';

export interface FakeLayer {
  readonly name: string;
  readonly title: string;
  readonly projections: readonly string[];
}

export const LAND: FakeLayer = { name: 'land', title: 'Land', projections: ['EPSG:4326', 'EPSG:3857', 'EPSG:3413'] };
export const SEA: FakeLayer = { name: 'sea', title: 'Sea', projections: ['EPSG:4326', 'EPSG:3857', 'EPSG:3413'] };
export const GROUP: FakeLayer = { name: 'group', title: 'A group', projections: ['EPSG:4326', 'EPSG:3857', 'EPSG:3031'] };

export class FakeServerPart {
  offered: { id: string; projections: string[] }[] = [];
  reading = false;
  version = 1;
  /** Layers by saved server id. */
  layers: Record<string, readonly FakeLayer[]> = {};
  /** Status of the layer list, 200 unless set. */
  layersStatus = 200;
  /** Every URL asked, in order. */
  readonly urls: string[] = [];
  /** When true, `fetch` fails like a lost connection. */
  down = false;
  /** When true, the backgrounds request never answers. */
  hang = false;

  install(): void {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: unknown) => {
        const url = String(input);
        this.urls.push(url);
        if (this.down) return Promise.reject(new TypeError('Failed to fetch'));
        if (url === `${SERVER_BASE}backgrounds`) {
          if (this.hang) return new Promise<Response>(() => undefined);
          return Promise.resolve(json({ backgrounds: this.offered, reading: this.reading, version: this.version }));
        }
        const match = /^\/api\/plugins\/basemap-wms\/servers\/([^/]+)\/layers(\?refresh=true)?$/.exec(url);
        if (match?.[1] !== undefined) {
          if (this.layersStatus !== 200) return Promise.resolve(new Response('', { status: this.layersStatus }));
          const layers = this.layers[decodeURIComponent(match[1])];
          if (layers === undefined) return Promise.resolve(new Response('', { status: 404 }));
          return Promise.resolve(json({ server: match[1], layers, readAt: '2026-01-01T00:00:00Z', error: null, reading: false }));
        }
        return Promise.reject(new Error(`unexpected request: ${url}`));
      }),
    );
  }

  /** The URLs of the layer list asked. */
  get layerRequests(): string[] {
    return this.urls.filter((u) => u.includes('/layers'));
  }
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export function server(id: string, url = 'http://wms.test/ows', version: '1.3.0' | '1.1.1' = '1.3.0'): JsonValue {
  return { id, name: `Server ${id}`, url, protocol: 'wms', version, timeoutSeconds: 8 };
}

export function background(id: string, serverId: string, layers: readonly string[], more: Record<string, JsonValue> = {}): JsonValue {
  return {
    id,
    name: `Background ${id}`,
    server: serverId,
    layers: [...layers],
    mode: 'tiles',
    format: 'image/png',
    transparent: false,
    attribution: { text: `(c) ${id}`, url: 'https://example.org/copyright' },
    ...more,
  };
}

export function settings(servers: readonly JsonValue[], backgrounds: readonly JsonValue[]): Settings {
  return { servers: [...servers], backgrounds: [...backgrounds] };
}
