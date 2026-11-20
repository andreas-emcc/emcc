// Scenarios (brief function 32; T-143; A108 to A112): the Simulation workspace as one file of emcc's
// own versioned JSON. The browser builds it from the live picture and the server part's own part
// (`GET /scenario-state`), and imports it with ordinary change requests, one in flight at a time,
// then the own part (`POST /scenario-state`, at most 1 MiB). Every id is new on import, and every
// reference to an object or layer of the file is remapped; a relation to an object not in the file
// is dropped.
import { changeRequests, uuidv7 } from '@emc2/plugin-sdk';
import type { ChangeOutcome, ChangeRequestContent, JsonValue, Layer, LayerContent, MapObject, MapObjectContent, Relation, Uuid } from '@emc2/plugin-sdk';
import { ROUTE_TYPE } from './picture.ts';
import { KIND_LABELS, kindOf, OFFERED_KINDS } from './sensors.ts';
import type { SimulatorServer } from './server.ts';

export const FORMAT = 'emcc-simulator-scenario';
export const VERSION = 1;
/** The SDK's largest endpoint body (ADR-0041's documents are as large). */
export const MAX_STATE_BYTES = 1024 * 1024;

export interface ScenarioLayer extends LayerContent {
  readonly id: Uuid;
  readonly locked?: boolean;
}

export interface ScenarioObject extends MapObjectContent {
  readonly id: Uuid;
}

export interface ScenarioSensor {
  readonly platform: Uuid;
  readonly settings: { readonly [key: string]: JsonValue };
}

/** The simulator's own part: the chosen Ground truth outputs, and the sensors with every setting (A108). */
export interface ScenarioState {
  readonly outputs: readonly string[];
  readonly sensors: readonly ScenarioSensor[];
}

export interface Scenario {
  readonly format: typeof FORMAT;
  readonly version: number;
  readonly name: string;
  readonly exportedAt: string;
  readonly layers: readonly ScenarioLayer[];
  readonly objects: readonly ScenarioObject[];
  readonly simulator: ScenarioState;
}

function isRecord(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A layer's or object's content: the store's version and meta are not part of a scenario. */
function content<T extends { readonly version: number; readonly meta: unknown }>(entity: T): Omit<T, 'version' | 'meta'> {
  return without(entity, ['version', 'meta']);
}

/** `value` without the members `keys`. */
function without<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Omit<T, K> {
  return Object.fromEntries(Object.entries(value).filter(([k]) => !(keys as readonly string[]).includes(k))) as Omit<T, K>;
}

export function buildScenario(name: string, layers: readonly Layer[], objects: readonly MapObject[], state: ScenarioState, now: Date): Scenario {
  const ids = new Set(layers.map((l) => l.id));
  return {
    format: FORMAT,
    version: VERSION,
    name,
    exportedAt: now.toISOString(),
    layers: layers.map((l) => content(l)),
    objects: objects.filter((o) => ids.has(o.layerId)).map((o) => content(o)),
    simulator: state,
  };
}

/** `<name>.emcc-scenario.json`, with characters a file name cannot hold replaced (A112). */
export function fileName(name: string): string {
  const safe = name.trim().replace(/[\\/:*?"<>|]+/g, '-');
  return `${safe === '' ? 'Scenario' : safe}.emcc-scenario.json`;
}

export function parseState(body: unknown): ScenarioState | null {
  if (!isRecord(body) || !Array.isArray(body['outputs']) || !Array.isArray(body['sensors'])) return null;
  const outputs = body['outputs'].filter((o): o is string => typeof o === 'string');
  const sensors = body['sensors'].flatMap((s): ScenarioSensor[] =>
    isRecord(s) && typeof s['platform'] === 'string' && isRecord(s['settings']) ? [{ platform: s['platform'], settings: s['settings'] as { readonly [key: string]: JsonValue } }] : [],
  );
  return { outputs, sensors };
}

/** The scenario in `text`, or why it cannot be imported; nothing is changed before this passes. */
export function readScenario(text: string): { readonly scenario: Scenario } | { readonly error: string } {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { error: 'The file is not JSON' };
  }
  if (!isRecord(value) || value['format'] !== FORMAT) return { error: 'The file is not an emcc simulator scenario' };
  const version = value['version'];
  if (typeof version !== 'number') return { error: 'The scenario has no version' };
  if (version > VERSION) return { error: `The scenario is of version ${String(version)}, made by a newer emcc; this one reads version ${String(VERSION)}` };
  if (!Array.isArray(value['layers']) || !Array.isArray(value['objects'])) return { error: 'The scenario has no layers or objects' };
  const state = parseState(value['simulator']);
  if (state === null) return { error: "The scenario has no simulator part" };
  if (new TextEncoder().encode(JSON.stringify(state)).length > MAX_STATE_BYTES) {
    return { error: "The scenario's simulator part is larger than 1 MiB, the most the server takes" };
  }
  const layers = value['layers'].filter((l): l is ScenarioLayer => isRecord(l) && typeof l['id'] === 'string' && typeof l['name'] === 'string');
  const objects = value['objects'].filter((o): o is ScenarioObject => isRecord(o) && typeof o['id'] === 'string' && typeof o['layerId'] === 'string');
  return {
    scenario: {
      format: FORMAT,
      version,
      name: typeof value['name'] === 'string' ? value['name'] : 'Scenario',
      exportedAt: typeof value['exportedAt'] === 'string' ? value['exportedAt'] : '',
      layers,
      objects,
      simulator: state,
    },
  };
}

/** Replaces every string equal to an old id with its new id, everywhere in `value` (A111). */
function remapDeep(value: JsonValue, ids: ReadonlyMap<string, string>): JsonValue {
  if (typeof value === 'string') return ids.get(value) ?? value;
  if (Array.isArray(value)) return value.map((v: JsonValue) => remapDeep(v, ids));
  if (isRecord(value)) {
    const out: { [key: string]: JsonValue } = {};
    for (const [k, v] of Object.entries(value)) out[k] = remapDeep(v, ids);
    return out;
  }
  return value;
}

/**
 * The scenario with new ids (function 32): layers and objects get new UUIDs; each object's layer,
 * its simulator extension (a route's groups and events), its relations (others dropped) and the
 * sensors' platforms follow; a sensor whose platform is not in the file is dropped.
 */
export function remap(scenario: Scenario, newId: () => Uuid = uuidv7): Scenario {
  const ids = new Map<string, string>();
  for (const l of scenario.layers) ids.set(l.id, newId());
  for (const o of scenario.objects) ids.set(o.id, newId());
  const layers = scenario.layers.map((l) => ({ ...l, id: ids.get(l.id) ?? newId() }));
  const objects = scenario.objects.flatMap((o): ScenarioObject[] => {
    const layerId = ids.get(o.layerId);
    if (layerId === undefined) return [];
    const simulator = o.extensions?.['simulator'];
    const relations = (o.relations ?? []).flatMap((r: Relation): Relation[] => {
      const other = ids.get(r.objectId);
      return other === undefined ? [] : [{ kind: r.kind, objectId: other }];
    });
    return [{
      ...o,
      id: ids.get(o.id) ?? newId(),
      layerId,
      ...(o.extensions === undefined ? {} : { extensions: { ...o.extensions, ...(simulator === undefined ? {} : { simulator: remapDeep(simulator, ids) as { readonly [key: string]: JsonValue } }) } }),
      ...(o.relations === undefined ? {} : { relations }),
    }];
  });
  const sensors = scenario.simulator.sensors.flatMap((s): ScenarioSensor[] => {
    const platform = ids.get(s.platform);
    return platform === undefined ? [] : [{ platform, settings: s.settings }];
  });
  return { ...scenario, layers, objects, simulator: { outputs: scenario.simulator.outputs, sensors } };
}

export type ImportMode = 'new' | 'merge';

/** What an import did: the store's refusals, each named (function 32: locked layers, labels). */
export interface ImportResult {
  readonly created: number;
  readonly deleted: number;
  readonly refusals: readonly string[];
  /** Why the import stopped, or null when it ran to its end. */
  readonly stopped: string | null;
}

export interface Changes {
  submit(request: ChangeRequestContent): Promise<ChangeOutcome>;
}

/** Submits one request and waits for it; the applied state, or null with the refusal listed. */
async function submit(changes: Changes, request: ChangeRequestContent, what: string, refusals: string[]): Promise<MapObject | Layer | null | false> {
  try {
    const outcome = await changes.submit(request);
    if (outcome.outcome === 'applied') return outcome.event.state;
    refusals.push(`${what}: ${outcome.rejection.message}`);
  } catch (e) {
    refusals.push(`${what}: ${e instanceof Error ? e.message : 'no answer'}`);
  }
  return false;
}

function layerContent(l: ScenarioLayer): LayerContent {
  return without(l, ['id', 'locked']);
}

function objectContent(o: ScenarioObject): MapObjectContent {
  return without(o, ['id']);
}

function objectName(o: { readonly properties?: { readonly name?: string } }): string {
  return o.properties?.name ?? 'an object';
}

/**
 * Imports `scenario` (already remapped). "As new" first deletes Simulation's objects and layers
 * (A110: the caller has reset the simulation and asked); then the layers are created unlocked, the
 * objects one at a time, the locks set, and the own part posted. Each refusal is listed, and the
 * import goes on with the rest.
 */
export async function importScenario(
  changes: Changes,
  server: SimulatorServer,
  current: { readonly layers: readonly Layer[]; readonly objects: readonly MapObject[] },
  scenario: Scenario,
  mode: ImportMode,
): Promise<ImportResult> {
  const refusals: string[] = [];
  let deleted = 0;
  let created = 0;
  if (mode === 'new') {
    for (const o of current.objects) if ((await submit(changes, changeRequests.deleteObject(o), `Delete ${objectName(o)}`, refusals)) !== false) deleted++;
    for (const l of current.layers) if ((await submit(changes, changeRequests.deleteLayer(l), `Delete the layer ${l.name}`, refusals)) !== false) deleted++;
  }
  const made = new Map<Uuid, Layer | null>();
  for (const l of scenario.layers) {
    const state = await submit(changes, changeRequests.createLayer(l.id, layerContent(l)), `The layer ${l.name}`, refusals);
    if (state !== false) {
      made.set(l.id, state !== null && 'drawOrder' in state ? state : null);
      created++;
    }
  }
  // The routes come after every other object: the server part takes an id that is no track of the
  // simulation off a route's list at once (brief function 9a), so a route must find its tracks there.
  const routesLast = [...scenario.objects.filter((o) => o.dataType !== ROUTE_TYPE), ...scenario.objects.filter((o) => o.dataType === ROUTE_TYPE)];
  for (const o of routesLast) {
    if (!made.has(o.layerId)) continue;
    if ((await submit(changes, changeRequests.createObject(o.id, objectContent(o)), objectName(o), refusals)) !== false) created++;
  }
  // A locked layer is locked after its objects are in it (the store refuses objects into a locked layer).
  for (const l of scenario.layers) {
    const layer = made.get(l.id);
    if (l.locked === true && layer !== undefined && layer !== null) {
      await submit(changes, changeRequests.updateLayer(layer, { ...layerContent(l), locked: true }), `Lock the layer ${l.name}`, refusals);
    }
  }
  // Function 36 (owner, PX; Q52 B): a sensor of a type not offered (in M6 a generic sensor) is left out and listed; its platform loads as usual.
  const sensors = scenario.simulator.sensors.filter((s) => {
    if (OFFERED_KINDS.includes(kindOf(s.settings))) return true;
    const platform = scenario.objects.find((o) => o.id === s.platform);
    refusals.push(`${platform?.properties?.name ?? KIND_LABELS[kindOf(s.settings)]}: generic sensors come later; not loaded`);
    return false;
  });
  const answer = await server.post('scenario-state', { mode, outputs: scenario.simulator.outputs, sensors });
  return { created, deleted, refusals, stopped: answer.ok ? null : `The simulator's own part was not taken: ${answer.message}` };
}
