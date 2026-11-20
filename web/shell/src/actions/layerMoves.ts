/**
 * The shared "Move to layer…" and "Copy to layer…" (ADR-0053, T-155): two object actions of the
 * shell's own, as the Delete is (ADR-0032 point 6), in each workspace the user may see, needing the
 * workspace's edit permission (`objects.edit` in View). Each asks for a layer of the workspace shown
 * that is not locked (A1), then sends one change request per object as `core-shell`, in the shell's
 * batches (`batch.ts`). No confirmation (ADR-0053 point 7): a move is undone by moving back, a copy
 * by deleting it.
 *
 * - **A move is an update** with the new `layerId` and the complete core content (point 2): the id,
 *   the relations to it and every extension stay. An object in the chosen layer already is skipped
 *   and counted (A2).
 * - **A copy is a snapshot** (point 3, owner Q2 A): a create with a new id, the original's content,
 *   data type, field sets, relations and namespaces (A5), its name too (owner, T-155 Q1); hand-made
 *   (`dataSource` `manual`), with no observation and no expiry time, and never the `externalRef`.
 *   Labels stay as they are (point 6).
 *
 * Objects in another workspace's layer are left out and named (A3). The server decides everything
 * else (point 5). A notice counts up while it runs and ends with the outcome; it stays when any
 * failed (A4). One move or copy runs at a time.
 */
import {
  changeRequests, MANUAL_DATA_SOURCE, MAX_FETCH_IDS, PERMISSIONS, uuidv7, VIEW_WORKSPACE, type FetchResult, type Layer, type MapObject,
  type MapObjectContent, type ObjectAction, type TimeAttributes, type Unsubscribe, type User, type Uuid, type WorkspaceInfo,
} from '@emc2/plugin-sdk';
import { CopyPlus, FolderInput } from 'lucide-react';
import type { ShellStore } from '../ui/store.ts';
import { count, describe, failureList, inBatches, nameOf, objects, send, type Failure, type Submitter } from './batch.ts';

export type LayerMoveKind = 'move' | 'copy';

export interface LayerMoveState {
  /** The question open: what, which objects, in which workspace; null when none is. */
  readonly asking: { readonly kind: LayerMoveKind; readonly ids: readonly Uuid[]; readonly workspace: WorkspaceInfo } | null;
  readonly running: boolean;
}

export interface LayerMoverOptions {
  readonly store: ShellStore;
  /** The logged-in user, once the configuration has arrived. */
  readonly user: () => User;
  readonly connection: Submitter & {
    getObjects(ids: readonly Uuid[]): Promise<FetchResult>;
  };
  /** The workspace shown (`ctx.workspace`). */
  readonly workspace: () => WorkspaceInfo;
  /** A layer the user may see, or null (`KnownLayers.layer`), once the layers have been read. */
  readonly layer: (layerId: Uuid) => Layer | null;
  readonly layersReady: () => Promise<void>;
  readonly console?: Pick<Console, 'warn' | 'error'>;
}

const VIEW: WorkspaceInfo = { id: VIEW_WORKSPACE, name: 'View', order: -2147483648 };

/** The permission both need in a workspace: its edit permission, `objects.edit` in View (ADR-0053 point 5). */
const permissionIn = (workspace: WorkspaceInfo): string => workspace.editPermission ?? PERMISSIONS.objectsEdit;
const workspaceOfLayer = (layer: Layer): string => layer.workspace ?? VIEW_WORKSPACE;

/** The words of each kind. */
export const WORDS = {
  move: { label: 'Move to layer…', title: 'Move to layer', verb: 'Move', doing: 'Moving', done: 'Moved', not: 'moved' },
  copy: { label: 'Copy to layer…', title: 'Copy to layer', verb: 'Copy', doing: 'Copying', done: 'Copied', not: 'copied' },
} as const;

/** What became of one object. */
export type Result = { readonly ok: true; readonly there?: true } | ({ readonly ok: false } & Failure);

/** What the store adds to an object; the rest is its content. */
const STORE_FIELDS = new Set(['id', 'version', 'meta']);

/** The content of `object` alone: what a change request carries (the `externalRef` is in `meta`). */
function contentOf(object: MapObject): MapObjectContent {
  return Object.fromEntries(Object.entries(object).filter(([key]) => !STORE_FIELDS.has(key))) as MapObjectContent;
}

/** A copy's time: the original's without its observation and expiry (ADR-0053 point 3; A5); absent when nothing is left. */
function copiedTime(time: TimeAttributes | undefined): TimeAttributes | undefined {
  return time?.validFrom === undefined ? undefined : { validFrom: time.validFrom };
}

/** What a copy of `object` in `layerId` carries (ADR-0053 point 3). */
export function copyOf(object: MapObject, layerId: Uuid): MapObjectContent {
  const { time, ...rest } = contentOf(object);
  const kept = copiedTime(time);
  return { ...rest, layerId, dataSource: MANUAL_DATA_SOURCE, ...(kept === undefined ? {} : { time: kept }) };
}

export class LayerMover {
  private state: LayerMoveState = { asking: null, running: false };
  private readonly listeners = new Set<() => void>();
  private readonly out: Pick<Console, 'warn' | 'error'>;

  constructor(private readonly options: LayerMoverOptions) {
    this.out = options.console ?? console;
  }

  readonly subscribe = (listener: () => void): Unsubscribe => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  readonly getState = (): LayerMoveState => this.state;

  /** The action in the object actions' list, for one workspace: `move-to-layer` in View, `move-to-layer-<id>` in another. */
  action(kind: LayerMoveKind, workspace: WorkspaceInfo = VIEW): ObjectAction {
    const base = kind === 'move' ? 'move-to-layer' : 'copy-to-layer';
    return {
      id: workspace.id === VIEW_WORKSPACE ? base : `${base}-${workspace.id}`, label: WORDS[kind].label,
      icon: kind === 'move' ? FolderInput : CopyPlus, group: 'layer', order: kind === 'move' ? 10 : 20, appliesTo: {}, multiple: true,
      permission: permissionIn(workspace), workspaces: [workspace.id],
      run: (ids) => { this.ask(kind, ids); },
    };
  }

  /** The layers the question offers: the workspace's that are not locked, the top one first (A1). */
  choices(layers: readonly Layer[], workspace: WorkspaceInfo): readonly Layer[] {
    return layers.filter((l) => workspaceOfLayer(l) === workspace.id && l.locked !== true);
  }

  /** Asks for the layer, in the workspace shown; while one runs, says so instead. */
  ask(kind: LayerMoveKind, ids: readonly Uuid[]): void {
    if (ids.length === 0 || this.state.asking !== null) return;
    if (this.state.running) {
      this.options.store.notify(null, { severity: 'info', message: 'A move or copy is still running; try again when it has finished.' });
      return;
    }
    void this.options.layersReady();
    this.set({ asking: { kind, ids: [...ids], workspace: this.options.workspace() } });
  }

  cancel(): void {
    this.set({ asking: null });
  }

  /** The user chose `layerId`: moves or copies the objects asked about that are in the workspace it was asked in. */
  async confirm(layerId: Uuid): Promise<void> {
    const asking = this.state.asking;
    if (asking === null || this.state.running) return;
    this.set({ asking: null, running: true });
    const { kind, ids, workspace } = asking;
    const words = WORDS[kind];
    const store = this.options.store;
    const total = ids.length;
    const target = this.options.layer(layerId)?.name ?? 'the layer';
    const notice = store.notify(null, { severity: 'info', message: `${words.doing} ${objects(total)} to ${target}…` }, { sticky: true });
    const results: Result[] = [];
    try {
      const found: MapObject[] = [];
      for (let i = 0; i < ids.length; i += MAX_FETCH_IDS) {
        const result = await this.options.connection.getObjects(ids.slice(i, i + MAX_FETCH_IDS));
        found.push(...result.found);
        results.push(...result.missing.map((id): Result => ({ ok: false, name: id, reason: 'it no longer exists' })));
      }
      await this.options.layersReady();
      const inWorkspace = (o: MapObject) => { const l = this.options.layer(o.layerId); return l !== null && workspaceOfLayer(l) === workspace.id; };
      const elsewhere = found.filter((o) => !inWorkspace(o));
      results.push(...elsewhere.map((o): Result => ({ ok: false, name: nameOf(o), reason: `not in ${workspace.name}` })));
      const todo = found.filter(inWorkspace);
      const progress = () => {
        store.updateNotification(notice, { severity: 'info', message: `${words.doing} objects to ${target}: ${count(results.length)} of ${count(total)}` }, { sticky: true });
      };
      progress();
      await inBatches(todo, async (object) => {
        results.push(kind === 'move' ? await this.moveOne(object, layerId) : await this.copyOne(object, layerId, target));
        progress();
      });
    } catch (error) {
      this.out.error(`[core-shell] a ${kind} to a layer stopped`, error);
      const done = results.filter((r) => r.ok).length;
      store.updateNotification(notice, {
        severity: 'error', message: `The ${kind} stopped: ${describe(error)}. ${words.done} ${count(done)} of ${objects(total)} before that.`,
      });
      this.set({ running: false });
      return;
    }
    const end = outcome(kind, target, total, results);
    store.updateNotification(notice, { severity: end.severity, message: end.message }, { sticky: end.sticky });
    this.set({ running: false });
  }

  /** One object's move: an update with the new layer and the complete core content (ADR-0053 point 2). */
  private async moveOne(object: MapObject, layerId: Uuid): Promise<Result> {
    if (object.layerId === layerId) return { ok: true, there: true };
    const sent = await send(this.options.connection, changeRequests.updateObject(object, { ...contentOf(object), layerId }), 'it may have been moved');
    if (sent.ok) return { ok: true };
    return { ok: false, name: nameOf(object), reason: sent.code === 'ENTITY_NOT_FOUND' ? 'it no longer exists' : sent.reason };
  }

  /** One object's copy: a create with a new id (ADR-0053 point 3), never with the `externalRef`. */
  private async copyOne(object: MapObject, layerId: Uuid, target: string): Promise<Result> {
    const sent = await send(this.options.connection, changeRequests.createObject(uuidv7(), copyOf(object, layerId)), 'it may have been copied');
    if (sent.ok) return { ok: true };
    return { ok: false, name: nameOf(object), reason: sent.code === 'LAYER_LOCKED' ? `${target} is locked` : sent.reason };
  }

  private set(change: Partial<LayerMoveState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of [...this.listeners]) listener();
  }
}

/** The final notice: e.g. "Moved 8 of 10 objects to Alpha. 2 could not be moved: …" (ADR-0053 point 7). */
export function outcome(kind: LayerMoveKind, target: string, total: number, results: readonly Result[]): {
  readonly severity: 'info' | 'warning'; readonly message: string; readonly sticky: boolean;
} {
  const words = WORDS[kind];
  const failed = results.filter((r): r is Extract<Result, { ok: false }> => !r.ok);
  const there = results.filter((r) => r.ok && r.there === true).length;
  const done = total - failed.length - there;
  const already = there === 0 ? '' : ` ${count(there)} ${there === 1 ? 'was' : 'were'} there already.`;
  if (failed.length === 0) return { severity: 'info', message: `${words.done} ${objects(done)} to ${target}.${already}`, sticky: false };
  return {
    severity: 'warning', sticky: true,
    message: `${words.done} ${count(done)} of ${objects(total)} to ${target}.${already} ${count(failed.length)} could not be ${words.not}: ${failureList(failed)}.`,
  };
}
