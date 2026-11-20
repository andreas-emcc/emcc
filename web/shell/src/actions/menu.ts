/**
 * The shell's menu for objects and for the map (ADR-0032 points 3 to 5, 8 and 9; `openMenu`,
 * CR-0015 item 7). It shows the object actions that apply to every object of the target, or the map
 * actions for a position, filtered by the user's permissions with the SDK's own rule. For
 * overlapping objects (`choose`) it first lists them; after a choice it sets the map's selection to
 * that object (ADR-0032 point 3) and shows its actions.
 *
 * The objects come from the server (`get-objects`, at most 1 000 ids): the shell holds no objects
 * of its own, each plugin's live channel keeps its own.
 *
 * A handler that throws or rejects is logged, shown as an error and makes its plugin DEGRADED, but
 * the plugin keeps running (owner, 2026-10-16); so does an `appliesTo.test` that throws, and its
 * action is then not offered.
 */
import {
  applicableMapActions, applicableObjectActions, MAX_FETCH_IDS, type DataType, type FetchResult, type IconComponent, type MapAction,
  type MapObject, type MapView, type MenuTarget, type ObjectAction, type Position, type ScreenPoint, type SymbolService, type Unsubscribe,
  type User, type Uuid,
} from '@emc2/plugin-sdk';
import type { ShellStore } from '../ui/store.ts';
import type { ActionRegistry, Registered } from './registry.ts';

/** One entry of the menu. */
export interface MenuEntry {
  readonly key: string;
  readonly label: string;
  readonly icon?: IconComponent | undefined;
  readonly group: string;
}

/** An object to choose from, when several overlap. */
export interface Candidate {
  readonly id: Uuid;
  /** Its name from its properties, else its data type's name (owner, 2026-10-16). */
  readonly label: string;
  /** Its layer's name, if known. */
  readonly layer: string | null;
  /** Its symbol, drawn small, if it has one and the symbol service is there. */
  readonly symbol: CanvasImageSource | null;
}

export type MenuState =
  | { readonly kind: 'closed' }
  | { readonly kind: 'loading'; readonly at: ScreenPoint; readonly n: number }
  | { readonly kind: 'actions'; readonly at: ScreenPoint; readonly n: number; readonly entries: readonly MenuEntry[]; readonly problem: string | null }
  | { readonly kind: 'choose'; readonly at: ScreenPoint; readonly n: number; readonly candidates: readonly Candidate[] };

export interface MenuOptions {
  readonly store: ShellStore;
  readonly registry: ActionRegistry;
  /** The logged-in user, once the configuration has arrived. */
  readonly user: () => User;
  readonly objects: { getObjects(ids: readonly Uuid[]): Promise<FetchResult> };
  /** The data types, for their names. */
  readonly dataTypes: () => readonly DataType[];
  /** The layers' names by id, as far as known. */
  readonly layerName: (layerId: Uuid) => string | null;
  /** Resolves when the layers' names are known (or it waited long enough). */
  readonly layersReady?: () => Promise<void>;
  /** The map view, for its selection; null when there is none. */
  readonly mapView: () => Promise<MapView | null>;
  /** The symbol service, for the symbols in the choose list; null when there is none. */
  readonly symbols: () => Promise<SymbolService | null>;
  readonly console?: Pick<Console, 'warn' | 'error'>;
}

/** The size of a symbol in the choose list, in CSS pixels. */
export const SYMBOL_SIZE = 20;

const describe = (error: unknown): string => (error instanceof Error ? error.message : String(error));

const isPosition = (value: unknown): value is Position =>
  Array.isArray(value) && value.length >= 2 && value.every((v) => typeof v === 'number' && Number.isFinite(v));

/** The menu's line when there is nothing to offer: the objects could not be read, or none of them exists any more. */
const problemOf = (asked: readonly Uuid[], objects: readonly MapObject[] | Error): string | null => {
  if (objects instanceof Error) return `The objects could not be read: ${objects.message}`;
  if (asked.length === 0) return null; // "No actions"
  return asked.length === 1 ? 'This object no longer exists.' : 'These objects no longer exist.';
};

const ids = (value: unknown): value is readonly Uuid[] => Array.isArray(value) && value.every((v) => typeof v === 'string');

export class ActionMenu {
  private state: MenuState = { kind: 'closed' };
  private readonly listeners = new Set<() => void>();
  /** Counts menus, so that a late answer for an earlier one is dropped. */
  private n = 0;
  /** What the open menu's entries run. */
  private runs = new Map<string, () => void>();
  private readonly out: Pick<Console, 'warn' | 'error'>;

  constructor(private readonly options: MenuOptions) {
    this.out = options.console ?? console;
  }

  readonly subscribe = (listener: () => void): Unsubscribe => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  readonly getState = (): MenuState => this.state;

  get isOpen(): boolean {
    return this.state.kind !== 'closed';
  }

  /** `ctx.actions.openMenu`: checks what a plugin passes, then opens the menu at `at`. */
  open(at: ScreenPoint, target: MenuTarget): void {
    if (!isPosition(at)) throw new TypeError('openMenu needs the point as [x, y] in CSS pixels');
    const t = target as { readonly objects?: unknown; readonly position?: unknown; readonly choose?: unknown } | null;
    if (t !== null && 'position' in t) {
      if (!isPosition(t.position)) throw new TypeError('openMenu needs a position as [lon, lat]');
      this.showMapActions(at, t.position);
    } else if (t !== null && 'objects' in t && ids(t.objects)) {
      void this.showObjectActions(at, this.capped(t.objects));
    } else if (t !== null && 'choose' in t && ids(t.choose)) {
      void this.showChoice(at, this.capped(t.choose));
    } else {
      throw new TypeError('openMenu needs a target: { objects }, { position } or { choose }');
    }
  }

  close(): void {
    this.n++;
    this.runs = new Map();
    this.set({ kind: 'closed' });
  }

  /** Runs an entry of the open menu; the menu closes first. */
  run(key: string): void {
    const run = this.runs.get(key);
    this.close();
    run?.();
  }

  /** A candidate was chosen: it becomes the map's selection, and its actions are shown. */
  async choose(id: Uuid): Promise<void> {
    if (this.state.kind === 'choose') await this.chooseAt(this.state.at, id);
  }

  private capped(list: readonly Uuid[]): readonly Uuid[] {
    if (list.length <= MAX_FETCH_IDS) return list;
    this.out.warn(`[core-shell] a menu for ${String(list.length)} objects: only the first ${String(MAX_FETCH_IDS)} are used`);
    return list.slice(0, MAX_FETCH_IDS);
  }

  private showMapActions(at: ScreenPoint, position: Position): void {
    const n = ++this.n;
    const owners = this.ownersOf(this.options.registry.maps);
    const actions = applicableMapActions([...owners.keys()], (p) => this.options.user().has(p));
    this.show(at, n, actions, owners, (action) => () => action.run(position), null);
  }

  private async showObjectActions(at: ScreenPoint, list: readonly Uuid[]): Promise<void> {
    const n = ++this.n;
    this.set({ kind: 'loading', at, n });
    const objects = await this.fetch(list);
    if (n !== this.n) return; // another menu, or closed
    if (objects instanceof Error || objects.length === 0) {
      this.show(at, n, [], new Map(), () => () => undefined, problemOf(list, objects));
      return;
    }
    const owners = this.ownersOf(this.options.registry.objects);
    const actions = applicableObjectActions([...owners.keys()], objects, (p) => this.options.user().has(p));
    const found = objects.map((o) => o.id);
    this.show(at, n, actions, owners, (action) => () => action.run(found), null);
  }

  private async showChoice(at: ScreenPoint, list: readonly Uuid[]): Promise<void> {
    const n = ++this.n;
    this.set({ kind: 'loading', at, n });
    const objects = await this.fetch(list);
    if (n !== this.n) return;
    if (objects instanceof Error || objects.length === 0) {
      this.show(at, n, [], new Map(), () => () => undefined, problemOf(list, objects));
      return;
    }
    if (objects.length === 1 && objects[0] !== undefined) {
      await this.chooseAt(at, objects[0].id);
      return;
    }
    const [symbols] = await Promise.all([this.options.symbols().catch(() => null), this.options.layersReady?.()]);
    if (n !== this.n) return;
    const names = new Map(this.options.dataTypes().map((d) => [d.id, d.name]));
    const candidates = objects.map((o): Candidate => ({
      id: o.id,
      label: o.properties?.name?.trim() || names.get(o.dataType) || o.dataType,
      layer: this.options.layerName(o.layerId),
      symbol: symbols === null ? null : this.symbolOf(symbols, o),
    }));
    this.set({ kind: 'choose', at, n, candidates });
  }

  private async chooseAt(at: ScreenPoint, id: Uuid): Promise<void> {
    const mapView = await this.options.mapView();
    mapView?.selection.set([id]);
    await this.showObjectActions(at, [id]);
  }

  private symbolOf(symbols: SymbolService, object: MapObject): CanvasImageSource | null {
    if (object.symbol === undefined) return null;
    try {
      return symbols.render({ standard: object.symbol.standard, sidc: object.symbol.sidc, size: SYMBOL_SIZE }).image;
    } catch {
      return null; // the list stays usable without it
    }
  }

  /** The objects that still exist, in the order asked; an Error when the server could not say. */
  private async fetch(list: readonly Uuid[]): Promise<readonly MapObject[] | Error> {
    if (list.length === 0) return [];
    try {
      const result = await this.options.objects.getObjects(list);
      const byId = new Map(result.found.map((o) => [o.id, o]));
      return list.flatMap((id) => byId.get(id) ?? []);
    } catch (error) {
      return error instanceof Error ? error : new Error(String(error));
    }
  }

  /**
   * Each registration as a stand-in of its own, to its registration: the SDK's filter gets the
   * stand-ins, so two plugins that register the same action object stay apart (review F11), and a
   * `test` that throws is its plugin's failure, once per menu, and leaves its action out (review F1).
   * A stand-in reads everything else from the plugin's action.
   */
  private ownersOf<A extends ObjectAction | MapAction>(registered: readonly Registered<A>[]): Map<A, Registered<A>> {
    const owners = new Map<A, Registered<A>>();
    for (const r of registered) {
      const scope = 'appliesTo' in r.action ? r.action.appliesTo : undefined;
      const test = scope?.test;
      let failed = false;
      const checked = test === undefined ? undefined : {
        ...scope,
        test: (object: MapObject): boolean => {
          try {
            return test(object);
          } catch (error) {
            if (!failed) this.failed(r.pluginId, r.action.label, error, 'could not be checked');
            failed = true;
            return false;
          }
        },
      };
      const standIn = Object.create(r.action, checked === undefined ? {} : { appliesTo: { value: checked, enumerable: true } }) as A;
      owners.set(standIn, r);
    }
    return owners;
  }

  private show<A extends ObjectAction | MapAction>(
    at: ScreenPoint, n: number, actions: readonly A[], owners: ReadonlyMap<A, Registered<A>>, runOf: (action: A) => () => void | Promise<void>,
    problem: string | null,
  ): void {
    const runs = new Map<string, () => void>();
    const entries = actions.map((standIn, i): MenuEntry => {
      const r = owners.get(standIn);
      const pluginId = r?.pluginId ?? 'core-shell';
      const action = r?.action ?? standIn;
      const key = `${pluginId}/${action.id}/${String(i)}`;
      runs.set(key, () => { this.guarded(pluginId, action.label, runOf(action)); });
      return { key, label: action.label, icon: action.icon, group: action.group ?? 'other' };
    });
    this.runs = runs;
    this.set({ kind: 'actions', at, n, entries, problem });
  }

  /** A handler, whose failure is the plugin's: logged, shown and DEGRADED, never thrown at the shell. */
  private guarded(pluginId: string, label: string, run: () => void | Promise<void>): void {
    try {
      const result = run();
      if (result instanceof Promise) result.catch((error: unknown) => { this.failed(pluginId, label, error, 'failed'); });
    } catch (error) {
      this.failed(pluginId, label, error, 'failed');
    }
  }

  private failed(pluginId: string, label: string, error: unknown, what: 'failed' | 'could not be checked'): void {
    this.out.error(`[${pluginId}] the action ${label} ${what}`, error);
    this.options.store.notify(pluginId, { severity: 'error', message: `${label} ${what}: ${describe(error)}` });
    this.options.store.observe(pluginId, { state: 'DEGRADED', detail: `its action ${label} ${what}: ${describe(error)}` });
  }

  private set(state: MenuState): void {
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }
}
