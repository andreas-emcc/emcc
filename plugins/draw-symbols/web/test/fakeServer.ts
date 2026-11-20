// A tiny in-memory object store for the tests. It applies change requests from several fake
// browsers (fake plugin contexts) by the rules of model/README.md and sends every applied change to
// all of them, as the live picture would. Every request is checked against
// model/schemas/change-request.schema.json. Answers can be held, lost ("outcome unknown") or
// refused, per browser, to test the cases that are hard to reach otherwise.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { ObjectQueryError, OutcomeUnknownError, uuidv7 } from '@emc2/plugin-sdk';
import type {
  DeclaredField, Extensions, FieldSet, FieldValue, RelationKind,
  Area, ChangeEvent, ChangeOutcome, ChangeRejection, ChangeRequest, ChangeRequestContent, FetchResult, Layer, LivePictureListener, LivePictureOptions, MapObject, MapObjectContent, Position, RejectionCode, SecurityLabel, Unsubscribe, Uuid,
} from '@emc2/plugin-sdk';
import { fieldsRejection, setsAndRelationsRejection } from '@emc2/plugin-sdk/testing';
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
  return { id: uuidv7(), version: 1, name, drawOrder, visible: true, label, ...(workspace === undefined ? {} : { workspace }), meta: { created: { at: AT, by: BY }, modified: { at: AT, by: BY } } };
}

/** A longitude relative to another one, in -180 to 180. */
function lonFrom(centre: number, lon: number): number {
  return ((((lon - centre + 180) % 360) + 360) % 360) - 180;
}

/** Whether a position is inside an area, taken as the box of its ring (enough for the small areas of the tests; the margin is not used). */
export function inArea(area: Area, position: Position): boolean {
  const centre = area.inside[0];
  const lons = area.ring.map(([lon]) => lonFrom(centre, lon));
  const lats = area.ring.map(([, lat]) => lat);
  const x = lonFrom(centre, position[0]);
  return x >= Math.min(...lons) && x <= Math.max(...lons) && position[1] >= Math.min(...lats) && position[1] <= Math.max(...lats);
}

function positionOf(object: MapObject | null): Position | null {
  return object !== null && object.geometry.type === 'Point' ? object.geometry.coordinates : null;
}

/** The object with the declared fields set in its extensions; a null value removes the field, and a namespace left empty goes. */
function withDeclaredFields(object: MapObject, fields: readonly FieldValue[]): MapObject {
  if (fields.length === 0) return object;
  const extensions = new Map<string, Map<string, unknown>>(
    Object.entries(object.extensions ?? {}).map(([plugin, values]) => [plugin, new Map(Object.entries(values))]),
  );
  for (const field of fields) {
    const namespace = extensions.get(field.plugin) ?? new Map<string, unknown>();
    if (field.value === null) namespace.delete(field.name);
    else namespace.set(field.name, field.value);
    extensions.set(field.plugin, namespace);
  }
  const kept = [...extensions].filter(([, values]) => values.size > 0).map(([plugin, values]) => [plugin, Object.fromEntries(values)] as const);
  const rest = Object.fromEntries(Object.entries(object).filter(([name]) => name !== 'extensions')) as MapObject;
  return kept.length > 0 ? { ...rest, extensions: Object.fromEntries(kept) as Extensions } : rest;
}

/** A core.symbol object as another user's browser or plugin would have created it. */
export function symbolObject(layerId: Uuid, overrides: Partial<MapObject> = {}): MapObject {
  return {
    id: uuidv7(), version: 1, type: 'core.symbol', dataType: 'core.general', dataSource: 'manual', layerId, geometry: { type: 'Point', coordinates: [15.5, 60.25] },
    symbol: { standard: 'APP-6D', sidc: '10031000001211000000' }, label: LABEL, meta: { created: { at: AT, by: BY }, modified: { at: AT, by: BY } },
    ...overrides,
  };
}

/** One browser's connection to the fake store. */
export class Connection {
  /** While true, answers are kept until {@link release}. */
  hold = false;
  /** While true, the browser does not hear of changes through the live picture until {@link flushLive}. */
  lagLive = false;
  /** The next requests are lost: no answer arrives. `arrived` says whether the store still applied them. */
  readonly unknownNext: { readonly arrived: boolean }[] = [];
  /** The next requests are refused with these codes. */
  readonly rejectNext: RejectionCode[] = [];
  /** `ctx.objects.get` fails (no answer from the server) while true. */
  failReads = false;
  /** While true, `ctx.objects.get` answers only after {@link releaseReads} (a slow server). */
  holdReads = false;
  private readonly heldReads: (() => void)[] = [];

  /** Answers the reads that were kept back, and stops keeping them back. */
  releaseReads(): void {
    this.holdReads = false;
    for (const answer of this.heldReads.splice(0)) answer();
  }
  /** The ids every `ctx.objects.get` asked for, in order. */
  readonly reads: (readonly Uuid[])[] = [];
  private readonly held: (() => void)[] = [];
  private readonly lagged: ChangeEvent[] = [];

  constructor(
    readonly server: FakeServer,
    readonly ctx: FakeContext,
  ) {}

  /** How many area subscriptions were made, and the areas, in order (the fake sends only what is inside). */
  readonly areas: Area[] = [];
  /** While true, the snapshot of a new area subscription is kept back until {@link releaseSnapshots} (a slow answer). */
  holdSnapshots = false;
  private readonly heldSnapshots: (() => void)[] = [];

  /** Delivers the snapshots that were kept back. */
  releaseSnapshots(): void {
    this.holdSnapshots = false;
    for (const deliver of this.heldSnapshots.splice(0)) deliver();
  }

  /**
   * An area subscription as the server serves it: the snapshot comes a moment after subscribing and holds the objects inside the
   * area; a change of an object it holds is delivered, a change that moves it out becomes `left` (no change event), and an object
   * that moves in becomes `entered`. Layer events do not reach it. Any other subscription is passed on as it is.
   */
  readonly subscribe = (
    real: (listener: LivePictureListener, options?: LivePictureOptions) => Unsubscribe,
    listener: LivePictureListener,
    options?: LivePictureOptions,
  ): Unsubscribe => {
    const area = options?.area;
    if (area === undefined || area === 'viewport' || options?.objects === false) return real(listener, options);
    this.areas.push(area);
    const held = new Set<Uuid>();
    let active = true;
    // A subscription follows the workspace shown unless it names workspaces (SDK 1.2.0): it holds that workspace's objects only.
    const followed = options?.workspaces ?? [this.ctx.workspace.current.id];
    const inWorkspace = (o: MapObject): boolean => {
      const workspace = this.server.layers.get(o.layerId)?.workspace ?? 'core.view';
      return followed.includes('*') || followed.includes(workspace);
    };
    const inside = (): MapObject[] => [...this.server.objects.values()].filter((o) => {
      const at = positionOf(o);
      return at !== null && inArea(area, at) && inWorkspace(o);
    });
    const wrapper: LivePictureListener = {
      snapshot: (snapshot) => {
        const objects = snapshot.objects.filter((o) => {
          const at = positionOf(o);
          return at !== null && inArea(area, at);
        });
        held.clear();
        for (const o of objects) held.add(o.id);
        listener.snapshot({ ...snapshot, objects });
      },
      changes: (batch) => {
        for (const event of batch) {
          if (event.entityType !== 'object') continue;
          const state = event.state as MapObject | null;
          const at = positionOf(state);
          const now = at !== null && inArea(area, at);
          if (held.has(event.entityId)) {
            if (state === null) {
              held.delete(event.entityId);
              listener.changes([event]);
            } else if (now) {
              listener.changes([event]);
            } else {
              held.delete(event.entityId);
              listener.area?.({ sequenceNo: event.sequenceNo, entered: [], left: [event.entityId] });
            }
          } else if (state !== null && now) {
            held.add(event.entityId);
            listener.area?.({ sequenceNo: event.sequenceNo, entered: [state], left: [] });
          }
        }
      },
    };
    if (listener.area !== undefined) wrapper.area = (change) => { listener.area?.(change); };
    const stop = real(wrapper, options);
    // The snapshot of the new subscription arrives a moment later, as over a real connection.
    const deliverSnapshot = (): void => {
      if (!active) return;
      const objects = inside();
      for (const o of objects) held.add(o.id);
      listener.snapshot({ layers: [...this.server.layers.values()], objects, sequenceNo: 0 });
    };
    void Promise.resolve().then(() => {
      if (this.holdSnapshots) this.heldSnapshots.push(deliverSnapshot);
      else deliverSnapshot();
    });
    return () => {
      active = false;
      stop();
    };
  };

  /** `ctx.objects.get`: what the store holds, whatever this browser's area is. */
  readonly read = (ids: readonly Uuid[]): Promise<FetchResult> => {
    this.reads.push([...ids]);
    if (this.failReads) return Promise.reject(new ObjectQueryError('no answer from the server (test)'));
    const answer = (): FetchResult => ({ found: ids.flatMap((id) => this.server.objects.get(id) ?? []), missing: ids.filter((id) => !this.server.objects.has(id)) });
    if (this.holdReads) return new Promise((resolve) => { this.heldReads.push(() => { resolve(answer()); }); });
    return Promise.resolve(answer());
  };

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
    const events = this.lagged.splice(0);
    if (events.length > 0) this.ctx.live.changes(events);
  }

  deliver(event: ChangeEvent): void {
    if (this.lagLive) this.lagged.push(event);
    else this.ctx.live.changes([event]);
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
  /** The fields the loaded plugins declare (ADR-0038): a request's `fields` are checked against them and applied to the object's extensions. */
  declaredFields: readonly DeclaredField[] = [];
  /** The field sets and relation kinds the loaded plugins declare (SDK 1.4.0): a request that adds a set or a relation of a kind nobody declares is refused (rules 17 and 18). */
  fieldSets: readonly FieldSet[] = [];
  relationKinds: readonly RelationKind[] = [];
  /** The field sets each data type brings (SDK 1.5.0, model rule 21): the store adds them to a symbol on a create and on a data type change. */
  typeSets: Readonly<Record<string, readonly string[]>> = {};
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
    (ctx.objects as { get: typeof connection.read }).get = connection.read;
    const realSubscribe = ctx.livePicture.subscribe.bind(ctx.livePicture);
    ctx.livePicture.subscribe = (listener, options) => connection.subscribe(realSubscribe, listener, options);
    this.connections.push(connection);
    return connection;
  }

  /** Sends a browser the current state as a snapshot. */
  sendSnapshot(ctx: FakeContext): void {
    ctx.live.snapshot({ layers: [...this.layers.values()], objects: [...this.objects.values()], sequenceNo: this.sequenceNo });
  }

  /** Puts an object in the store as if it had been there already; browsers learn of it with the next snapshot. */
  seed(object: MapObject): MapObject {
    this.objects.set(object.id, object);
    return object;
  }

  /** Another user locks or unlocks a layer (SDK 1.3.0, ADR-0042); every browser hears of it. */
  setLocked(layerId: Uuid, locked: boolean): void {
    const known = this.layers.get(layerId);
    if (known === undefined) throw new Error('no such layer');
    const rest = Object.fromEntries(Object.entries(known).filter(([name]) => name !== 'locked')) as unknown as Layer; // the store keeps false as absent
    const state: Layer = { ...rest, version: known.version + 1, ...(locked ? { locked: true } : {}) };
    this.layers.set(layerId, state);
    const event: ChangeEvent = {
      sequenceNo: ++this.sequenceNo, requestId: uuidv7(), entityType: 'layer', operation: 'update', entityId: layerId, version: state.version,
      previousVersion: known.version, state, label: state.label, at: new Date().toISOString(), by: { plugin: 'layer-panel' },
    };
    for (const connection of this.connections) connection.deliver(event);
  }

  /** Removes an object without telling any browser, so that a browser still shows it. */
  deleteSilently(id: Uuid): void {
    this.objects.delete(id);
  }

  /** Another user's plugin changes an object; every browser hears of it. */
  changeElsewhere(request: ChangeRequestContent, source: { readonly plugin: string; readonly user?: string } = { plugin: 'someone-else' }): ChangeOutcome {
    const full = { ...request, requestId: uuidv7(), source } as ChangeRequest;
    assertSchemaValid(full);
    return this.applyRequest(null, full);
  }

  applyRequest(from: Connection | null, request: ChangeRequest): ChangeOutcome {
    const forced = from?.rejectNext.shift();
    if (forced !== undefined) return this.reject(request, forced, 'refused by the test');
    if (request.entityType !== 'object') throw new Error('draw-symbols only changes objects');
    // ADR-0042: a user's change to a locked layer's content is refused, before the declared fields; a move out of it too.
    if (request.operation !== 'delete') {
      const to = this.layers.get((request as { data: MapObjectContent }).data.layerId);
      if (to?.locked === true) return this.reject(request, 'LAYER_LOCKED', `the layer ${to.name} is locked`);
    }
    const stored = this.layers.get(this.objects.get(request.entityId)?.layerId ?? '');
    if (stored?.locked === true) return this.reject(request, 'LAYER_LOCKED', `the layer ${stored.name} is locked`);
    const setsRefused = setsAndRelationsRejection(request, this.fieldSets, this.relationKinds, this.objects.get(request.entityId));
    if (setsRefused !== null) return { outcome: 'rejected', rejection: setsRefused };
    const refused = fieldsRejection(request, this.declaredFields);
    if (refused !== null) return { outcome: 'rejected', rejection: refused };
    const existing = this.objects.get(request.entityId);
    if (request.operation === 'create' && existing) return this.reject(request, 'ENTITY_EXISTS', 'the object exists');
    if (request.operation !== 'create' && !existing) return this.reject(request, 'ENTITY_NOT_FOUND', 'no such object');
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
        const core = Object.fromEntries(Object.entries(base).filter(([name]) => name !== 'extensions' && name !== 'fieldSets'));
        // Rule 5's third exception (SDK 1.4.0): the stored field sets stay and the listed ones are added; a list of relations replaces the stored one.
        const sets = [...new Set([...(existing.fieldSets ?? []), ...(data.fieldSets ?? [])])];
        state = { ...(core as typeof base), ...(sets.length > 0 ? { fieldSets: sets } : {}), ...(Object.keys(extensions).length > 0 ? { extensions } : {}), meta: { ...existing.meta, modified: { at, by } } };
      }
      // Rule 21 (SDK 1.5.0, symbols only): a create and a data type change add the new type's sets after the listed ones.
      if (data.type === 'core.symbol' && (existing === undefined || data.dataType !== existing.dataType)) {
        const sets = [...new Set([...(state.fieldSets ?? []), ...(this.typeSets[data.dataType] ?? [])])];
        if (sets.length > 0) state = { ...state, fieldSets: sets };
      }
      state = withDeclaredFields(state, 'fields' in request ? (request.fields ?? []) : []);
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
