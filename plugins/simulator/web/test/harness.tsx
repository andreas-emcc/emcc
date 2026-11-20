// What the web part's tests share: the fake context in the Simulation workspace, a fake map view,
// objects of the simulation, and a fake server part behind `fetch`.
import { vi } from 'vitest';
import { MAP_VIEW, SYMBOLS } from '@emc2/plugin-sdk';
import type { ChangeRequest, DeclaredField, FieldSet, JsonValue, Layer, MapObject, MapObjectContent, RelationKind, Uuid, WorkspaceInfo } from '@emc2/plugin-sdk';
import { createFakeContext, createFakeMapView, createFakeSymbolService, createFakeUser } from '@emc2/plugin-sdk/testing';
import type { FakeContext, FakeContextOptions, FakeMapView } from '@emc2/plugin-sdk/testing';
import manifest from '../../plugin.json' with { type: 'json' };
import plugin from '../src/index.tsx';
import { EDIT, RUN, VIEW } from '../src/permissions.ts';
import { unitsKey } from '../src/unitsModel.ts';
import { SIMULATION } from '../src/picture.ts';

export const SIMULATION_INFO: WorkspaceInfo = { id: SIMULATION, name: 'Simulation', viewPermission: VIEW, editPermission: EDIT, order: 10 };

const LABEL = { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' };
const META = { created: { at: '2026-10-27T08:00:00.000Z', by: { plugin: 'test' } }, modified: { at: '2026-10-27T08:00:00.000Z', by: { plugin: 'test' } } };

export const SIM_LAYER = '0192f000-0000-7000-8000-00000000000a';
export const VIEW_LAYER = '0192f000-0000-7000-8000-00000000000b';
export const ROUTE_A = '0192f000-0000-7000-8000-0000000000a1';
export const ROUTE_B = '0192f000-0000-7000-8000-0000000000b1';
export const TRACK_1 = '0192f000-0000-7000-8000-000000000001';
export const TRACK_2 = '0192f000-0000-7000-8000-000000000002';
export const TRACK_3 = '0192f000-0000-7000-8000-000000000003';
export const VIEW_TRACK = '0192f000-0000-7000-8000-000000000009';

export function layer(id: Uuid, workspace?: string): Layer {
  return { id, version: 1, meta: META, name: workspace === undefined ? 'View layer' : 'Simulation layer', drawOrder: 0, visible: true, label: LABEL, ...(workspace === undefined ? {} : { workspace }) };
}

/** A symbol at a point where latitude ≠ longitude. */
export function symbol(id: Uuid, layerId: Uuid, simulator?: { readonly [key: string]: JsonValue }): MapObject {
  return {
    id, version: 1, meta: META, type: 'core.symbol', dataType: 'core.general', dataSource: 'manual', layerId, label: LABEL,
    geometry: { type: 'Point', coordinates: [18.07, 59.33] },
    symbol: { standard: 'APP-6D', sidc: '10031000001211000000' },
    properties: { name: `Track ${id.slice(-1)}` },
    ...(simulator === undefined ? {} : { extensions: { simulator } }),
  };
}

export function route(id: Uuid, name: string, simulator: { readonly [key: string]: JsonValue } = {}, version = 3): MapObject {
  return {
    id, version, meta: META, type: 'core.shape', dataType: 'simulator.route', dataSource: 'manual', layerId: SIM_LAYER, label: LABEL,
    geometry: { type: 'LineString', coordinates: [[18.0, 59.3], [18.2, 59.4]] },
    style: { strokeDash: 'dash', pointMarkers: 'circle' },
    properties: { name },
    extensions: { simulator: { points: [{ speed: 8.33 }, { speed: 8.33 }], ...simulator }, other: { kept: true } },
  };
}

export function groups(...ids: Uuid[]): JsonValue {
  return [{ kind: 'single', objects: ids.map((id) => ({ id })) }];
}

/** The routes as `GET /routes` answers them. */
export function routeInfo(id: Uuid, name: string, more: { readonly [key: string]: JsonValue } = {}): { readonly [key: string]: JsonValue } {
  return {
    id, version: 3, name, layerId: SIM_LAYER, state: 'paused', runnable: true, problems: [], objects: [],
    lengthMetres: 12_000, durationSeconds: 1440,
    points: [], ...more,
  };
}

export interface Call {
  readonly method: string;
  readonly path: string;
  readonly body: unknown;
}

type Handler = (body: unknown) => { readonly status: number; readonly body?: JsonValue };

/** The server part behind `fetch`: answers by method and path under the plugin's base, records every call. */
export class FakeServer {
  readonly calls: Call[] = [];
  private readonly handlers = new Map<string, Handler>();
  /** While true, `fetch` rejects, as when the server cannot be reached. */
  down = false;

  constructor(private readonly base: string) {
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => this.fetch(url, init));
  }

  on(method: 'GET' | 'POST', path: string, handler: Handler | { readonly status: number; readonly body?: JsonValue }): this {
    this.handlers.set(`${method} ${path}`, typeof handler === 'function' ? handler : () => handler);
    return this;
  }

  posts(path?: string): Call[] {
    return this.calls.filter((c) => c.method === 'POST' && (path === undefined || c.path === path));
  }

  gets(path: string): number {
    return this.calls.filter((c) => c.method === 'GET' && c.path === path).length;
  }

  private fetch(url: string, init?: RequestInit): Promise<Response> {
    if (this.down) return Promise.reject(new TypeError('Failed to fetch'));
    if (!url.startsWith(this.base)) throw new Error(`a call outside the plugin's base: ${url}`);
    const method = init?.method ?? 'GET';
    const path = url.slice(this.base.length);
    if (method === 'POST' && (init?.headers as Record<string, string> | undefined)?.['Content-Type'] !== 'application/json') {
      return Promise.resolve(new Response(null, { status: 415 }));
    }
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : null;
    this.calls.push({ method, path, body });
    // A handler for the path with its query, or else for the path alone (function 43's `?since=`).
    const handler = this.handlers.get(`${method} ${path}`) ?? this.handlers.get(`${method} ${path.split('?')[0] ?? path}`);
    const answer = handler === undefined ? { status: 404, body: { error: 'no such endpoint' } } : handler(body);
    if (answer.status === 304) return Promise.resolve(new Response(null, { status: 304 })); // a 304 has no body
    return Promise.resolve(new Response(answer.body === undefined ? null : JSON.stringify(answer.body), { status: answer.status, headers: { 'Content-Type': 'application/json' } }));
  }
}

export interface Rig {
  readonly ctx: FakeContext;
  readonly map: FakeMapView;
  readonly server: FakeServer;
}

/**
 * The plugin activated in Simulation, with the default answers of an empty simulation. Without
 * `permissions`, the no-login user, who has every permission.
 */
export async function activated(
  options: { readonly permissions?: readonly string[]; readonly declaredFields?: readonly DeclaredField[]; readonly fieldSets?: readonly FieldSet[]; readonly dataTypes?: FakeContextOptions['dataTypes']; readonly relationKinds?: readonly RelationKind[]; readonly symbols?: boolean; readonly storedUnits?: string; readonly sensors?: JsonValue; readonly userDocuments?: { readonly [name: string]: JsonValue } } = {},
): Promise<Rig> {
  // The units are kept in this browser (A67): each test starts without them, or with `storedUnits`.
  globalThis.localStorage.clear();
  const ctx = createFakeContext({
    pluginId: manifest.id,
    settings: { outputStaleSeconds: 5 },
    workspaces: [SIMULATION_INFO],
    workspace: SIMULATION,
    ...(options.declaredFields === undefined ? {} : { declaredFields: options.declaredFields }),
    ...(options.fieldSets === undefined ? {} : { fieldSets: options.fieldSets }),
    ...(options.dataTypes === undefined ? {} : { dataTypes: options.dataTypes }),
    ...(options.relationKinds === undefined ? {} : { relationKinds: options.relationKinds }),
    ...(options.permissions === undefined ? {} : { user: createFakeUser({ permissions: options.permissions }) }),
  });
  const map = createFakeMapView({ pluginId: manifest.id });
  if (options.storedUnits !== undefined) globalThis.localStorage.setItem(unitsKey(ctx.user.id), options.storedUnits);
  ctx.provideAs(MAP_VIEW, map);
  if (options.symbols === true) ctx.provideAs(SYMBOLS, createFakeSymbolService());
  const server = new FakeServer(ctx.serverBase)
    .on('GET', 'routes', { status: 200, body: { running: false, routes: [] } })
    .on('GET', 'outputs', { status: 200, body: { channels: [], chosen: [] } })
    // The coverage overlay reads the sensors while Simulation is shown (function 33).
    .on('GET', 'sensors', { status: 200, body: options.sensors ?? { running: false, pairing: false, channels: [], sensors: [] } })
    // The dwells while Simulation is shown and "Show dwells" is on (function 43).
    .on('GET', 'sensors/dwells', { status: 200, body: { seq: 0, whole: true, sensors: [] } });
  // The user's own documents from an earlier session (a reload).
  for (const [name, value] of Object.entries(options.userDocuments ?? {})) await ctx.userDocuments.put(name, value);
  await plugin.activate(ctx);
  await settled();
  return { ctx, map, server };
}

/** Lets the promises activate started settle (the map view's), also under fake timers. */
export async function settled(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

/** The simulation's picture: a Simulation layer and a View layer, with tracks in both. */
export function feedPicture(ctx: FakeContext, objects: readonly MapObject[]): void {
  ctx.live.snapshot({ layers: [layer(SIM_LAYER, SIMULATION), layer(VIEW_LAYER)], objects });
  ctx.setServerObjects(objects);
}

export function panel(ctx: FakeContext, id: string) {
  const entry = ctx.addedPanels.find((p) => p.panel.id === id);
  if (entry === undefined) throw new Error(`no panel ${id}`);
  return entry.panel.component;
}

/** SDK 1.6.0 part F: a top-bar item's component (function 48's Scenario button). */
export function topBarItem(ctx: FakeContext, id: string) {
  const item = ctx.topBarItems.find((i) => i.id === id);
  if (item === undefined) throw new Error(`no top-bar item ${id}`);
  return item.component;
}

export { EDIT, RUN, VIEW };

/** The content of the last change request the plugin sent. */
export function lastData(ctx: FakeContext): MapObjectContent {
  const request: ChangeRequest | undefined = ctx.submitted.at(-1);
  if (request === undefined || request.entityType !== 'object' || !('data' in request)) throw new Error('no object create or update was sent');
  return request.data;
}

/** The simulator's extension in the last change request. */
export function lastExtension(ctx: FakeContext): { readonly [key: string]: JsonValue } {
  return lastData(ctx).extensions?.['simulator'] ?? {};
}
