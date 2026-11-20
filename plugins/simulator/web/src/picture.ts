// The web part's live picture: the whole Simulation workspace, whichever workspace is shown (brief
// function 22, CR-0025 part 5; the owner's Q11, 2026-10-27). It is small by design (the target is
// 1 000 tracks), and the fade list and the object actions need every track and route in it.
import { workspaceOf } from '@emc2/plugin-sdk';
import type { ChangeEvent, JsonValue, Layer, LivePicture, MapObject, Snapshot, Unsubscribe, Uuid } from '@emc2/plugin-sdk';

export const SIMULATION = 'simulator.simulation';
export const ROUTE_TYPE = 'simulator.route';
export const PLUGIN_ID = 'simulator';

/** What the routes panel needs from a route object that `GET /routes` does not serve. */
export interface RouteObject {
  readonly object: MapObject;
  readonly name: string;
  /** The end behaviour (brief function 14); `stop` when absent or unknown. */
  readonly end: 'stop' | 'restart';
  /** The ids on its list, in list order. */
  readonly objects: readonly Uuid[];
}

export class SimulationPicture {
  private readonly layers = new Map<Uuid, Layer>();
  private readonly objects = new Map<Uuid, MapObject>();
  private readonly listeners = new Set<() => void>();
  private derived: { readonly routes: readonly RouteObject[]; readonly routeOf: ReadonlyMap<Uuid, Uuid>; readonly hidden: readonly Uuid[] } | null = null;
  private received = false;
  private count = 0;
  private readonly unsubscribe: Unsubscribe;

  constructor(live: LivePicture) {
    this.unsubscribe = live.subscribe(
      {
        snapshot: (snapshot) => {
          this.snapshot(snapshot);
        },
        changes: (batch) => {
          this.changes(batch);
        },
      },
      { workspaces: [SIMULATION] },
    );
  }

  dispose(): void {
    this.unsubscribe();
    this.listeners.clear();
  }

  /** Arrow functions, for React's `useSyncExternalStore`. */
  readonly onChange = (listener: () => void): Unsubscribe => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Raised by every snapshot and batch. */
  readonly revision = (): number => this.count;

  /** Whether the first snapshot has arrived. */
  get ready(): boolean {
    return this.received;
  }

  object(id: Uuid): MapObject | undefined {
    const o = this.objects.get(id);
    return o !== undefined && this.inSimulation(o) ? o : undefined;
  }

  /** Whether `layerId` is a layer of Simulation. The server sends only those; a server before T-080 may not, so the web part checks too. */
  isSimulationLayer(layerId: Uuid): boolean {
    const layer = this.layers.get(layerId);
    return layer !== undefined && workspaceOf(layer) === SIMULATION;
  }

  /** The layer if it is locked (SDK 1.3.0, ADR-0042; brief function 25), else null. Followed live with the layers' changes. */
  lockedLayer(layerId: Uuid): Layer | null {
    const layer = this.layers.get(layerId);
    return layer?.locked === true ? layer : null;
  }

  /** Simulation's layers, by draw order (function 32: a scenario's layers). */
  simulationLayers(): readonly Layer[] {
    return [...this.layers.values()].filter((l) => workspaceOf(l) === SIMULATION).sort((a, b) => a.drawOrder - b.drawOrder);
  }

  /** Every object in Simulation's layers (function 32). */
  simulationObjects(): readonly MapObject[] {
    return [...this.objects.values()].filter((o) => this.inSimulation(o));
  }

  /** The tracks of the simulation: the symbols in its layers (brief function 3). */
  isTrack(object: MapObject): boolean {
    return object.type === 'core.symbol' && this.isSimulationLayer(object.layerId);
  }

  /** The route objects, by name. */
  routes(): readonly RouteObject[] {
    return this.derive().routes;
  }

  /** The route whose list names `id`, or null. An object on two lists counts on the first, by name. */
  routeOf(id: Uuid): Uuid | null {
    return this.derive().routeOf.get(id) ?? null;
  }

  /** The tracks marked hidden by an event (brief function 13), for the fade list. Sorted. */
  hidden(): readonly Uuid[] {
    return this.derive().hidden;
  }

  private inSimulation(object: MapObject): boolean {
    return this.isSimulationLayer(object.layerId);
  }

  private snapshot(snapshot: Snapshot): void {
    this.layers.clear();
    this.objects.clear();
    for (const layer of snapshot.layers) this.layers.set(layer.id, layer);
    for (const object of snapshot.objects) this.objects.set(object.id, object);
    this.received = true;
    this.changed();
  }

  private changes(batch: readonly ChangeEvent[]): void {
    for (const event of batch) {
      const map: Map<Uuid, Layer | MapObject> = event.entityType === 'layer' ? this.layers : this.objects;
      if (event.state === null) map.delete(event.entityId);
      else map.set(event.entityId, event.state);
    }
    this.changed();
  }

  private changed(): void {
    this.derived = null;
    this.count++;
    for (const listener of [...this.listeners]) listener();
  }

  private derive(): NonNullable<SimulationPicture['derived']> {
    if (this.derived !== null) return this.derived;
    const routes: RouteObject[] = [];
    const hidden: Uuid[] = [];
    for (const object of this.objects.values()) {
      if (!this.inSimulation(object)) continue;
      if (object.dataType === ROUTE_TYPE && object.type === 'core.shape') routes.push(routeObject(object));
      else if (object.type === 'core.symbol' && object.extensions?.[PLUGIN_ID]?.['hidden'] === true) hidden.push(object.id);
    }
    routes.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }) || a.object.id.localeCompare(b.object.id));
    const routeOf = new Map<Uuid, Uuid>();
    for (const route of routes) {
      for (const id of route.objects) if (!routeOf.has(id)) routeOf.set(id, route.object.id);
    }
    hidden.sort();
    this.derived = { routes, routeOf, hidden };
    return this.derived;
  }
}

/** A route's name: its own, else "Unnamed route". */
export function routeName(object: MapObject): string {
  const name = object.properties?.name?.trim() ?? '';
  return name === '' ? 'Unnamed route' : name;
}

function routeObject(object: MapObject): RouteObject {
  const ext = object.extensions?.[PLUGIN_ID] ?? {};
  return { object, name: routeName(object), end: ext['end'] === 'restart' ? 'restart' : 'stop', objects: listed(ext['groups']) };
}

/** The ids in a route's `groups`, read leniently: users write the extension, and the server part checks it. */
function listed(groups: JsonValue | undefined): Uuid[] {
  if (!Array.isArray(groups)) return [];
  const ids: Uuid[] = [];
  for (const group of groups as readonly JsonValue[]) {
    const objects = typeof group === 'object' && group !== null && !Array.isArray(group) ? (group as { readonly [k: string]: JsonValue })['objects'] : undefined;
    if (!Array.isArray(objects)) continue;
    for (const o of objects as readonly JsonValue[]) {
      const id = typeof o === 'object' && o !== null && !Array.isArray(o) ? (o as { readonly [k: string]: JsonValue })['id'] : undefined;
      if (typeof id === 'string') ids.push(id.toLowerCase());
    }
  }
  return ids;
}
