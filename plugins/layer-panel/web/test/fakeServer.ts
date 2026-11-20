// A tiny in-memory object store for the tests: it applies change requests from several fake
// browsers (fake plugin contexts) and sends every applied change to all of them, as the live
// picture would. After a change to objects it also sends the complete object counts per layer,
// which is all a subscription with `objects: false` gets of the objects (SDK v1). Every request is
// checked against model/schemas/change-request.schema.json. Layers keep their workspace as the
// store does (data model 1.2.0); each fake browser's live picture filters by the workspace shown.
// A locked layer refuses every change but one to its lock and draw order (ADR-0042), since every
// request from a browser is a user's.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormatsModule from 'ajv-formats';
import { uuidv7, VIEW_WORKSPACE, workspaceOf } from '@emc2/plugin-sdk';
import type { ChangeEvent, ChangeOutcome, ChangeRejection, ChangeRequest, Layer, MapObject, ObjectCounts, RejectionCode, SecurityLabel, Uuid } from '@emc2/plugin-sdk';
import { appliedEvent, type FakeContext } from '@emc2/plugin-sdk/testing';

// import.meta.url is not a file URL under jsdom; import.meta.dirname is the test folder.
const schemas = join(import.meta.dirname, '../../../../model/schemas');
// ajv-formats is CommonJS; its default export arrives wrapped under ESM.
const addFormats = ((addFormatsModule as unknown as { default?: typeof addFormatsModule }).default ?? addFormatsModule);
const ajv = new Ajv2020({ strict: true, strictTuples: false, strictRequired: false, allowUnionTypes: true, allErrors: true });
addFormats(ajv);
for (const file of readdirSync(schemas).filter((f) => f.endsWith('.json'))) {
  ajv.addSchema(JSON.parse(readFileSync(join(schemas, file), 'utf8')) as object);
}
const validateRequest = ajv.getSchema('urn:emc2:schema:change-request');

/** Throws unless the request is valid against the change request schema. */
export function assertSchemaValid(request: ChangeRequest): void {
  if (!validateRequest) throw new Error('change request schema not loaded');
  if (!validateRequest(request)) throw new Error(`invalid change request: ${JSON.stringify(validateRequest.errors)}`);
}

export const LABEL: SecurityLabel = { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' };
const AT = '2026-10-08T12:00:00.000Z';
const BY = { plugin: 'test-seed' };

export function layer(name: string, drawOrder: number, label: SecurityLabel = LABEL): Layer {
  return { id: uuidv7(), version: 1, name, drawOrder, visible: true, label, meta: { created: { at: AT, by: BY }, modified: { at: AT, by: BY } } };
}

/** A layer of a declared workspace (data model 1.2.0). */
export function layerIn(workspace: string, name: string, drawOrder: number): Layer {
  return { ...layer(name, drawOrder), workspace };
}

/** Whether a request to a locked layer is an update that changes nothing but `locked` and `drawOrder` (ADR-0042 point 3). */
function onlyLockOrOrder(request: ChangeRequest, stored: Layer): boolean {
  if (request.operation !== 'update' || request.entityType !== 'layer') return false;
  const { name, visible, label, extensions } = request.data;
  return name === stored.name && visible === stored.visible && JSON.stringify(label) === JSON.stringify(stored.label)
    && JSON.stringify(extensions) === JSON.stringify(stored.extensions);
}

export class FakeServer {
  readonly layers = new Map<Uuid, Layer>();
  readonly objects = new Map<Uuid, MapObject>();
  /** Every request any browser sent, in order. */
  readonly requests: ChangeRequest[] = [];
  private readonly browsers: FakeContext[] = [];
  private sequenceNo = 0;
  /** Answers the next requests with this rejection code instead of applying them. */
  rejectWith: RejectionCode | null = null;
  /** Applied changes not yet sent to the browsers, while {@link holdEvents} is on. */
  private held: ChangeEvent[] | null = null;

  constructor(layers: readonly Layer[] = []) {
    for (const l of layers) this.layers.set(l.id, l);
  }

  /** Layers in draw order, top first, as the map view draws them. */
  drawOrder(): string[] {
    return [...this.layers.values()].sort((a, b) => b.drawOrder - a.drawOrder || (a.id < b.id ? 1 : -1)).map((l) => l.name);
  }

  layerNamed(name: string): Layer {
    const found = [...this.layers.values()].find((l) => l.name === name);
    if (!found) throw new Error(`no layer ${name}`);
    return found;
  }

  /**
   * Holds back the live events of applied changes, as when the answer to a request arrives before
   * the next live batch. {@link deliver} sends them and ends the hold.
   */
  holdEvents(): void {
    this.held = [];
  }

  deliver(): void {
    const events = this.held ?? [];
    this.held = null;
    for (const event of events) this.broadcast(event);
  }

  /** Lets a browser send change requests here. */
  connect(ctx: FakeContext): void {
    this.browsers.push(ctx);
    ctx.answerWith((request) => this.apply(request));
  }

  /** Sends a browser the current state as a snapshot. */
  sendSnapshot(ctx: FakeContext): void {
    ctx.live.snapshot({ layers: [...this.layers.values()], objects: [...this.objects.values()], sequenceNo: this.sequenceNo });
  }

  /** Adds an object to a layer, as another plugin would. With `broadcast: false` no browser hears of it yet. */
  addObject(layerId: Uuid, options: { readonly broadcast?: boolean } = {}): MapObject {
    const object: MapObject = {
      id: uuidv7(), version: 1, type: 'core.symbol', dataType: 'core.general', dataSource: 'manual', layerId, geometry: { type: 'Point', coordinates: [15.5, 60.25] },
      symbol: { standard: 'APP-6D', sidc: '10031000001211000000' }, label: LABEL, meta: { created: { at: AT, by: BY }, modified: { at: AT, by: BY } },
    };
    this.objects.set(object.id, object);
    const event: ChangeEvent = {
      sequenceNo: ++this.sequenceNo, requestId: uuidv7(), entityType: 'object', operation: 'create', entityId: object.id,
      version: 1, previousVersion: null, state: object, label: LABEL, at: AT, by: BY,
    };
    if (options.broadcast !== false) this.broadcast(event);
    return object;
  }

  /** Creates a layer as another plugin would (e.g. one per `cot` stream), and sends it to every browser. */
  addLayerAs(plugin: string, name: string, drawOrder: number): Layer {
    const request: ChangeRequest = {
      requestId: uuidv7(), entityType: 'layer', operation: 'create', entityId: uuidv7(), source: { plugin },
      data: { name, drawOrder, visible: true, label: LABEL },
    };
    const outcome = this.apply(request);
    if (outcome.outcome !== 'applied') throw new Error(`layer ${name} not created`);
    this.requests.pop(); // not one of the panel's requests
    return this.layerNamed(name);
  }

  /** Deletes an object, as another browser would. With `broadcast: false` no browser hears of it yet. */
  removeObject(object: MapObject, options: { readonly broadcast?: boolean } = {}): void {
    this.objects.delete(object.id);
    const event: ChangeEvent = {
      sequenceNo: ++this.sequenceNo, requestId: uuidv7(), entityType: 'object', operation: 'delete', entityId: object.id,
      version: object.version + 1, previousVersion: object.version, state: null, label: LABEL, at: AT, by: BY,
    };
    if (options.broadcast !== false) this.broadcast(event);
  }

  /** The object store's counts: layer id → number of objects, over the whole picture. */
  counts(): ObjectCounts {
    const counts: Record<Uuid, number> = {};
    for (const o of this.objects.values()) counts[o.layerId] = (counts[o.layerId] ?? 0) + 1;
    return counts;
  }

  private apply(request: ChangeRequest): ChangeOutcome {
    assertSchemaValid(request);
    this.requests.push(request);
    if (request.entityType !== 'layer') throw new Error('the layer panel only changes layers');
    const forced = this.rejectWith;
    if (forced !== null) return this.reject(request, forced, 'rejected by the test');
    const existing = this.layers.get(request.entityId);
    if (request.operation === 'create' && existing) return this.reject(request, 'ENTITY_EXISTS', 'layer exists');
    if (request.operation !== 'create' && !existing) return this.reject(request, 'ENTITY_NOT_FOUND', 'no such layer');
    if (request.operation === 'delete' && [...this.objects.values()].some((o) => o.layerId === request.entityId)) {
      return this.reject(request, 'LAYER_NOT_EMPTY', 'the layer still has objects');
    }
    // A layer stays in its workspace: an update without one keeps the stored one, another one is
    // rejected; View is kept as absent (data model 1.2.0).
    const sent = 'data' in request ? (request.data as Layer).workspace : undefined;
    if (existing && sent !== undefined && sent !== workspaceOf(existing)) return this.reject(request, 'VALIDATION_FAILED', 'a layer stays in its workspace');
    if (existing?.locked === true && !onlyLockOrOrder(request, existing)) return this.reject(request, 'LAYER_LOCKED', `the layer ${existing.name} is locked`);
    const applied = appliedEvent(request, ++this.sequenceNo, existing?.label ?? LABEL);
    let event = applied;
    if (applied.state !== null) {
      // An update without `locked` keeps the stored lock, and `false` is kept as absent (data model 1.3.0).
      const { workspace, locked, ...rest } = applied.state as Layer;
      const kept = existing?.workspace ?? (workspace === VIEW_WORKSPACE ? undefined : workspace);
      const lock = locked ?? existing?.locked;
      event = { ...applied, state: { ...rest, ...(kept !== undefined ? { workspace: kept } : {}), ...(lock === true ? { locked: true } : {}) } };
    }
    if (event.state === null) this.layers.delete(request.entityId);
    else this.layers.set(request.entityId, event.state as Layer);
    this.broadcast(event);
    return { outcome: 'applied', event };
  }

  private reject(request: ChangeRequest, code: RejectionCode, message: string): ChangeOutcome {
    const rejection: ChangeRejection = {
      requestId: request.requestId, entityType: request.entityType, operation: request.operation, entityId: request.entityId, code, message, at: AT,
    };
    return { outcome: 'rejected', rejection };
  }

  /** Sends an applied change to every browser; after a change to objects, the new counts too. */
  private broadcast(event: ChangeEvent): void {
    if (this.held !== null) {
      this.held.push(event);
      return;
    }
    for (const browser of this.browsers) {
      browser.live.changes([event]);
      if (event.entityType === 'object') browser.live.counts(this.counts());
    }
  }
}
