// A tiny in-memory object store for the tests (the same double as draw-symbols uses). It applies change requests from several fake
// browsers (fake plugin contexts) by the rules of model/README.md and sends every applied change to
// all of them, as the live picture would. Every request is checked against
// model/schemas/change-request.schema.json. Answers can be held, lost ("outcome unknown") or
// refused, per browser, to test the cases that are hard to reach otherwise.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { ObjectQueryError, OutcomeUnknownError, uuidv7, VIEW_WORKSPACE, workspaceOf } from '@emc2/plugin-sdk';
import type {
  Area, ChangeEvent, ChangeOutcome, ChangeRejection, ChangeRequest, ChangeRequestContent, Geometry, Layer, LivePictureListener, LivePictureOptions, MapObject,
  MapObjectContent, Position, RejectionCode, SecurityLabel, Uuid,
} from '@emc2/plugin-sdk';
import type { FakeContext } from '@emc2/plugin-sdk/testing';

// import.meta.url is not a file URL under jsdom; import.meta.dirname is the test folder.
const modelDir = join(import.meta.dirname, '../../../../model');
// ajv-formats is CommonJS; its default export arrives wrapped under ESM.
const addFormats = (addFormatsModule as unknown as { default?: typeof addFormatsModule }).default ?? addFormatsModule;
const ajv = new Ajv2020({ strict: true, strictTuples: false, strictRequired: false, allowUnionTypes: true, allErrors: true });
addFormats(ajv);
for (const file of readdirSync(join(modelDir, 'schemas')).filter((f) => f.endsWith('.json'))) {
  ajv.addSchema(JSON.parse(readFileSync(join(modelDir, 'schemas', file), 'utf8')) as object);
}
const validateRequest = ajv.getSchema('urn:emc2:schema:change-request');

/** Throws unless the request is valid against the change request schema. */
export function assertSchemaValid(request: ChangeRequest): void {
  if (!validateRequest) throw new Error('change request schema not loaded');
  if (!validateRequest(request)) throw new Error(`invalid change request: ${JSON.stringify(validateRequest.errors)}`);
}

/** A map object example from model/examples/valid. */
export function modelExample(name: string): MapObject {
  return JSON.parse(readFileSync(join(modelDir, 'examples/valid', name), 'utf8')) as MapObject;
}

export const LABEL: SecurityLabel = { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' };
const AT = '2026-10-09T12:00:00.000Z';
const BY = { plugin: 'test-seed' };

export function layer(name: string, drawOrder: number, label: SecurityLabel = LABEL, workspace?: string): Layer {
  return {
    id: uuidv7(), version: 1, name, drawOrder, visible: true, label, meta: { created: { at: AT, by: BY }, modified: { at: AT, by: BY } },
    ...(workspace === undefined ? {} : { workspace }),
  };
}

/** The boundary of the fake catalogue (APP-6D, set 25, entity 110100) with friend, present and brigade echelon (`16`). */
export const BOUNDARY_SIDC = '10032500161101000000';
/** The phase line (entity 140300), friend and present. */
export const PHASE_LINE_SIDC = '10032500001403000000';
/** The axis of advance "Main Attack" (entity 151403), friend and present. */
export const AXIS_SIDC = '10032500001514030000';
/** The sector range fan (entity 242200), friend and present. */
export const FAN_SIDC = '10032500002422000000';

/** A core.multipoint boundary as another user's browser or plugin would have created it; latitude and longitude differ in every point. */
export function graphicObject(layerId: Uuid, overrides: Partial<MapObject> = {}): MapObject {
  const geometry: Geometry = { type: 'LineString', coordinates: [[16.5, 58.6], [17.1, 58.9], [18.07, 59.33]] };
  return {
    id: uuidv7(), version: 1, type: 'core.multipoint', dataType: 'core.general', dataSource: 'manual', layerId, geometry,
    symbol: { standard: 'APP-6D', sidc: BOUNDARY_SIDC }, label: LABEL,
    meta: { created: { at: AT, by: BY }, modified: { at: AT, by: BY } },
    ...overrides,
  };
}

/** A box of longitudes and latitudes, for the fake store's rough area test. */
interface Box {
  readonly west: number;
  readonly south: number;
  readonly east: number;
  readonly north: number;
}

const METRES_PER_DEGREE = 111_320;

function boxOf(positions: readonly Position[], extraMetres = 0): Box {
  const dLat = extraMetres / METRES_PER_DEGREE;
  const lats = positions.map((p) => p[1]);
  const lons = positions.map((p) => p[0]);
  const dLon = dLat / Math.max(0.05, Math.cos(((Math.min(...lats) + Math.max(...lats)) / 2) * (Math.PI / 180)));
  return { west: Math.min(...lons) - dLon, south: Math.min(...lats) - dLat, east: Math.max(...lons) + dLon, north: Math.max(...lats) + dLat };
}

/** The bound of a geometry as a box (the real store uses a cap round the centroid; the tests use shapes where the two agree). */
export function boundOf(geometry: Geometry): Box {
  switch (geometry.type) {
    case 'Point':
      return boxOf([geometry.coordinates]);
    case 'MultiPoint':
    case 'LineString':
      return boxOf(geometry.coordinates);
    case 'Corridor':
      return boxOf(geometry.coordinates, geometry.width / 2);
    case 'Polygon':
      return boxOf(geometry.coordinates[0] ?? []);
    case 'Circle':
      return boxOf([geometry.center], geometry.radius);
    case 'Ellipse':
      return boxOf([geometry.center], geometry.semiMajorAxis);
    case 'ArcBand':
      return boxOf([geometry.center], geometry.outerRadius);
  }
}

/** True when the object's bound reaches into the area's ring. */
export function inArea(object: MapObject, area: Area): boolean {
  const ring = boxOf(area.ring);
  const bound = boundOf(object.geometry);
  return bound.west <= ring.east && bound.east >= ring.west && bound.south <= ring.north && bound.north >= ring.south;
}

/** One live picture subscription of a browser, as the store keeps it. */
export interface Subscription {
  readonly listener: LivePictureListener;
  readonly options: LivePictureOptions;
  /** The objects sent to it individually. */
  readonly held: Set<Uuid>;
}

/** One browser's connection to the fake store. */
export class Connection {
  /** The workspace this browser shows: its subscriptions (without `workspaces`) get the layers and objects of this one only (SDK 1.2.0). */
  shown = VIEW_WORKSPACE;
  /** While true, answers are kept until {@link release}. */
  hold = false;
  /** While true, the browser does not hear of changes through the live picture until {@link flushLive}. */
  lagLive = false;
  /** The next requests are lost: no answer arrives. `arrived` says whether the store still applied them. */
  readonly unknownNext: { readonly arrived: boolean }[] = [];
  /** The browser's live picture subscriptions, in order. */
  readonly subscriptions: Subscription[] = [];
  /** True after the first snapshot: a subscription opened from then on gets its snapshot at once, as the store sends it. */
  connected = false;
  /** While true, reading objects by id fails as a lost connection does. */
  failReads = false;
  /** The next requests are refused with these codes. */
  readonly rejectNext: RejectionCode[] = [];
  private readonly held: (() => void)[] = [];
  private readonly lagged: ChangeEvent[] = [];
  /** The ids of the objects the store told this browser's subscriptions about, in order of the snapshots and changes (for assertions). */
  readonly log: string[] = [];

  constructor(
    readonly server: FakeServer,
    readonly ctx: FakeContext,
  ) {}

  /** Answers all requests that were held, in order. */
  release(): void {
    this.hold = false;
    for (const answer of this.held.splice(0)) answer();
  }

  /** How many requests wait for an answer. */
  get waiting(): number {
    return this.held.length;
  }

  /** Delivers the changes the live picture kept back. */
  flushLive(): void {
    this.lagLive = false;
    for (const event of this.lagged.splice(0)) this.route(event);
  }

  deliver(event: ChangeEvent): void {
    if (this.lagLive) this.lagged.push(event);
    else this.route(event);
  }

  /** The store's snapshot for one subscription: the layers, and the objects it asks for (none for `objects: false`, those reaching into an area). */
  snapshotFor(sub: Subscription): void {
    const { options } = sub;
    const layers = [...this.server.layers.values()].filter((l) => this.follows(sub, workspaceOf(l)));
    const layerIds = new Set(layers.map((l) => l.id));
    const objects =
      options.objects === false
        ? []
        : [...this.server.objects.values()].filter((o) => layerIds.has(o.layerId) && (options.area === undefined || options.area === 'viewport' || inArea(o, options.area)));
    sub.held.clear();
    for (const o of objects) sub.held.add(o.id);
    this.log.push(`snapshot ${options.objects === false ? 'layers' : options.area === undefined ? 'all' : 'area'} ${String(objects.length)}`);
    sub.listener.snapshot({ layers, objects, sequenceNo: this.server.sequence });
  }

  /** Whether a subscription gets what is in `workspace`: those it names, else the workspace shown. */
  private follows(sub: Subscription, workspace: string): boolean {
    const list = sub.options.workspaces ?? [this.shown];
    return list.includes('*') || list.includes(workspace);
  }

  /** The first snapshot of every subscription (a reconnect sends them again). */
  sendSnapshots(): void {
    this.connected = true;
    for (const sub of [...this.subscriptions]) this.snapshotFor(sub);
  }

  /** Sends a change to the subscriptions as the store does (protocol, "How an area subscription follows changes"). */
  private route(event: ChangeEvent): void {
    for (const sub of [...this.subscriptions]) {
      if (event.entityType === 'layer') {
        if (event.state === null || this.follows(sub, workspaceOf(event.state as Layer))) sub.listener.changes([event]);
        continue;
      }
      if (sub.options.objects === false) continue;
      const eventLayer = event.state === null ? undefined : this.server.layers.get((event.state as MapObject).layerId);
      if (eventLayer !== undefined && !this.follows(sub, workspaceOf(eventLayer))) continue;
      const area = sub.options.area;
      if (area === undefined || area === 'viewport') {
        sub.listener.changes([event]);
        continue;
      }
      const now = event.state !== null && inArea(event.state as MapObject, area);
      if (now) {
        sub.held.add(event.entityId);
        sub.listener.changes([event]);
      } else if (sub.held.has(event.entityId)) {
        sub.held.delete(event.entityId);
        if (event.state === null) sub.listener.changes([event]);
        else sub.listener.area?.({ sequenceNo: event.sequenceNo, entered: [], left: [event.entityId] });
      }
    }
  }

  submit = (content: ChangeRequestContent): Promise<ChangeOutcome> => {
    const request = { ...content, requestId: uuidv7(), source: { plugin: this.ctx.pluginId } } as ChangeRequest;
    assertSchemaValid(request);
    this.server.requests.push(request);
    const lost = this.unknownNext.shift();
    if (lost !== undefined) {
      if (lost.arrived) this.server.applyRequest(this, request);
      return Promise.reject(new OutcomeUnknownError('no answer from the server (test)'));
    }
    if (this.hold) {
      return new Promise((resolve) => {
        this.held.push(() => {
          resolve(this.server.applyRequest(this, request));
        });
      });
    }
    return Promise.resolve(this.server.applyRequest(this, request));
  };
}

export class FakeServer {
  readonly layers = new Map<Uuid, Layer>();
  readonly objects = new Map<Uuid, MapObject>();
  /** Every request any browser sent, in order. */
  readonly requests: ChangeRequest[] = [];
  /** The data types the store accepts for a new object or a changed data type (model rule 14). */
  readonly dataTypes: Set<string>;
  private readonly connections: Connection[] = [];
  private sequenceNo = 0;

  constructor(layers: readonly Layer[] = [], dataTypes: readonly string[] = ['core.general']) {
    for (const l of layers) this.layers.set(l.id, l);
    this.dataTypes = new Set(dataTypes);
  }

  /** Lets a browser send change requests here and hear the live picture. */
  connect(ctx: FakeContext): Connection {
    const connection = new Connection(this, ctx);
    ctx.changes.submit = connection.submit;
    ctx.objects.get = (ids) => {
      if (connection.failReads) return Promise.reject(new ObjectQueryError('no answer from the server (test)'));
      const found: MapObject[] = [];
      const missing: Uuid[] = [];
      for (const id of new Set(ids)) {
        const o = this.objects.get(id);
        if (o === undefined) missing.push(id);
        else found.push(o);
      }
      return Promise.resolve({ found, missing });
    };
    // The fake context keeps its own list of subscriptions (`liveSubscriptions`, which the tests read); the store routes to the same listeners.
    const original = ctx.livePicture.subscribe.bind(ctx.livePicture);
    ctx.livePicture.subscribe = (listener: LivePictureListener, options: LivePictureOptions = {}) => {
      const end = original(listener, options);
      const sub: Subscription = { listener, options, held: new Set() };
      connection.subscriptions.push(sub);
      if (connection.connected) {
        queueMicrotask(() => {
          if (connection.subscriptions.includes(sub)) connection.snapshotFor(sub);
        });
      }
      return () => {
        end();
        const i = connection.subscriptions.indexOf(sub);
        if (i >= 0) connection.subscriptions.splice(i, 1);
      };
    };
    this.connections.push(connection);
    return connection;
  }

  /** Sends a browser a snapshot on each of its subscriptions, as after a (re)connect. */
  sendSnapshot(ctx: FakeContext): void {
    const connection = this.connections.find((c) => c.ctx === ctx);
    if (connection === undefined) throw new Error('the browser is not connected to this store');
    connection.sendSnapshots();
  }

  /** The sequence number of the last applied change. */
  get sequence(): number {
    return this.sequenceNo;
  }

  /** Puts an object in the store as if it had been there already; browsers learn of it with the next snapshot. */
  seed(object: MapObject): MapObject {
    this.objects.set(object.id, object);
    return object;
  }

  /** Removes an object without telling any browser, so that a browser still shows it. */
  deleteSilently(id: Uuid): void {
    this.objects.delete(id);
  }

  /** Another user locks or unlocks a layer (SDK 1.3.0, ADR-0042); every browser hears of the layer's new version. */
  setLock(layerId: Uuid, locked: boolean): void {
    const known = this.layers.get(layerId);
    if (known === undefined) throw new Error('no such layer');
    // The store keeps `false` as absent.
    const rest = Object.fromEntries(Object.entries(known).filter(([name]) => name !== 'locked')) as unknown as Layer;
    const state: Layer = { ...rest, ...(locked ? { locked: true } : {}), version: known.version + 1 };
    this.layers.set(layerId, state);
    const at = new Date().toISOString();
    const event: ChangeEvent = {
      sequenceNo: ++this.sequenceNo, requestId: uuidv7(), entityType: 'layer', operation: 'update', entityId: layerId,
      version: state.version, previousVersion: known.version, state, label: state.label, at, by: { plugin: 'layer-panel' },
    };
    for (const connection of this.connections) connection.deliver(event);
  }

  /** Another user's plugin changes an object; every browser hears of it. */
  changeElsewhere(request: ChangeRequestContent): ChangeOutcome {
    const full = { ...request, requestId: uuidv7(), source: { plugin: 'someone-else' } } as ChangeRequest;
    assertSchemaValid(full);
    return this.applyRequest(null, full);
  }

  applyRequest(from: Connection | null, request: ChangeRequest): ChangeOutcome {
    const forced = from?.rejectNext.shift();
    if (forced !== undefined) return this.reject(request, forced, 'refused by the test');
    if (request.entityType !== 'object') throw new Error('draw-tactical only changes objects');
    const existing = this.objects.get(request.entityId);
    if (request.operation === 'create' && existing) return this.reject(request, 'ENTITY_EXISTS', 'the object exists');
    if (request.operation !== 'create' && !existing) return this.reject(request, 'ENTITY_NOT_FOUND', 'no such object');
    // ADR-0042: every request from a web part is a user's, and a locked layer's content is refused: the layer it goes to, then the one it leaves.
    const refused = [request.operation === 'delete' ? undefined : (request as { data: MapObjectContent }).data.layerId, existing?.layerId]
      .map((id) => (id === undefined ? undefined : this.layers.get(id)))
      .find((l) => l?.locked === true);
    if (refused !== undefined) return this.reject(request, 'LAYER_LOCKED', `the layer ${refused.name} is locked`);
    const at = new Date().toISOString();
    const by = request.source;
    let state: MapObject | null = null;
    if (request.operation !== 'delete') {
      const { data } = request as { data: MapObjectContent };
      if (!this.layers.has(data.layerId)) return this.reject(request, 'LAYER_NOT_FOUND', 'no such layer');
      // Model rule 14: the data type must be available when it is new or changed; the data source is fixed at creation.
      if ((existing === undefined || data.dataType !== existing.dataType) && !this.dataTypes.has(data.dataType)) {
        return this.reject(request, 'VALIDATION_FAILED', `data type ${data.dataType} is not available (/data/dataType)`);
      }
      if (existing !== undefined && data.dataSource !== existing.dataSource) {
        return this.reject(request, 'VALIDATION_FAILED', 'the data source is fixed at creation (/data/dataSource)');
      }
      const base = { ...data, id: request.entityId, version: (existing?.version ?? 0) + 1 };
      if (existing === undefined) {
        state = { ...base, meta: { created: { at, by }, modified: { at, by } } };
      } else {
        // Rule 5: only the requester's own namespace is applied; the others come from the stored object.
        const own = data.extensions?.[by.plugin];
        const kept = Object.entries(existing.extensions ?? {}).filter(([namespace]) => namespace !== by.plugin || own === undefined);
        const written = own === undefined || Object.keys(own).length === 0 ? [] : [[by.plugin, own] as const];
        const extensions = Object.fromEntries([...kept, ...written]);
        const core = Object.fromEntries(Object.entries(base).filter(([name]) => name !== 'extensions'));
        state = { ...(core as typeof base), ...(Object.keys(extensions).length > 0 ? { extensions } : {}), meta: { ...existing.meta, modified: { at, by } } };
      }
      this.objects.set(state.id, state);
    } else {
      this.objects.delete(request.entityId);
    }
    const event: ChangeEvent = {
      sequenceNo: ++this.sequenceNo, requestId: request.requestId, entityType: 'object', operation: request.operation, entityId: request.entityId,
      version: (existing?.version ?? 0) + 1, previousVersion: existing?.version ?? null, state, label: state?.label ?? existing?.label ?? LABEL, at, by,
      ...(request.baseVersion !== undefined ? { baseVersion: request.baseVersion } : {}),
    };
    for (const connection of this.connections) connection.deliver(event);
    return { outcome: 'applied', event };
  }

  private reject(request: ChangeRequest, code: RejectionCode, message: string): ChangeOutcome {
    const rejection: ChangeRejection = {
      requestId: request.requestId, entityType: request.entityType, operation: request.operation, entityId: request.entityId, code, message, at: AT,
    };
    return { outcome: 'rejected', rejection };
  }
}
