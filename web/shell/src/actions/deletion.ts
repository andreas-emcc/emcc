/**
 * The shared Delete (ADR-0032 point 6 and consequences; CR-0015 item 10): one object action of the
 * shell's own for any object the user may change (`objects.edit`), and the Delete key on the map's
 * selection. It always asks first, stating the number of objects, because there is no undo.
 *
 * It sends one change request per object as `core-shell`, in the shell's batches (`batch.ts`: at
 * most 50 waiting, sent again when the queue was full). A notice counts up while it runs and ends
 * with how many were deleted and which were not, and why; it stays when any failed (owner,
 * 2026-10-16). An object already gone counts as deleted. One Delete runs at a time.
 *
 * Per workspace (ADR-0039 point 7; T-080, owner 2026-10-27): one action for each workspace the user
 * may see, appearing only there, needing `objects.edit` in View and the workspace's edit permission
 * in another. It deletes only objects in a layer of the workspace it was asked in, in View too, and
 * names the others as not in that workspace: whoever filled the selection, a Delete never reaches
 * another workspace (the ACA's review of the reused briefs, U4).
 */
import {
  changeRequests, MAX_FETCH_IDS, PERMISSIONS, VIEW_WORKSPACE, type FetchResult, type MapObject, type ObjectAction, type Unsubscribe,
  type User, type Uuid, type WorkspaceInfo,
} from '@emc2/plugin-sdk';
import { Trash2 } from 'lucide-react';
import type { ShellStore } from '../ui/store.ts';
import { count, describe, failureList, inBatches, nameOf, objects, send, type Failure, type Submitter } from './batch.ts';

export { MAX_WAITING } from './batch.ts';

export interface DeleteState {
  /** The objects the question is about; null when no question is open. */
  readonly asking: readonly Uuid[] | null;
  /** The workspace the question was asked in. */
  readonly workspace: WorkspaceInfo | null;
  readonly running: boolean;
}

export interface DeleterOptions {
  readonly store: ShellStore;
  /** The logged-in user, once the configuration has arrived. */
  readonly user: () => User;
  readonly connection: Submitter & {
    getObjects(ids: readonly Uuid[]): Promise<FetchResult>;
  };
  /** The workspace shown (`ctx.workspace`). */
  readonly workspace: () => WorkspaceInfo;
  /** The workspace of a layer the user may see, or null (`KnownLayers.workspaceOf`), once the layers have been read. */
  readonly layerWorkspace?: (layerId: Uuid) => string | null;
  readonly layersReady?: () => Promise<void>;
  readonly console?: Pick<Console, 'warn' | 'error'>;
}

const VIEW: WorkspaceInfo = { id: VIEW_WORKSPACE, name: 'View', order: -2147483648 };

/** The permission a Delete needs in a workspace: its edit permission, `objects.edit` in View. */
const permissionIn = (workspace: WorkspaceInfo): string => workspace.editPermission ?? PERMISSIONS.objectsEdit;

/** What became of one object. */
type Result = { readonly deleted: true } | ({ readonly deleted: false } & Failure);

export class Deleter {
  private state: DeleteState = { asking: null, workspace: null, running: false };
  private readonly listeners = new Set<() => void>();
  private readonly out: Pick<Console, 'warn' | 'error'>;

  constructor(private readonly options: DeleterOptions) {
    this.out = options.console ?? console;
  }

  readonly subscribe = (listener: () => void): Unsubscribe => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  readonly getState = (): DeleteState => this.state;

  /** The shell's Delete in the object actions' list, for one workspace: `delete` in View, `delete-<id>` in another. */
  action(workspace: WorkspaceInfo = VIEW): ObjectAction {
    return {
      id: workspace.id === VIEW_WORKSPACE ? 'delete' : `delete-${workspace.id}`, label: 'Delete', icon: Trash2, group: 'delete', appliesTo: {},
      multiple: true, permission: permissionIn(workspace), workspaces: [workspace.id],
      run: (ids) => { this.ask(ids); },
    };
  }

  private shown(): WorkspaceInfo {
    return this.options.workspace();
  }

  /** May the user delete in the workspace shown (the Delete key checks it; the menu filters by the action's permission). */
  get allowed(): boolean {
    return this.options.user().has(permissionIn(this.shown()));
  }

  /** Asks whether to delete these objects, in the workspace shown; while a Delete runs, says so instead. */
  ask(ids: readonly Uuid[]): void {
    if (ids.length === 0 || this.state.asking !== null) return;
    if (this.state.running) {
      this.options.store.notify(null, { severity: 'info', message: 'A delete is still running; try again when it has finished.' });
      return;
    }
    this.set({ asking: [...ids], workspace: this.shown() });
  }

  cancel(): void {
    this.set({ asking: null, workspace: null });
  }

  /** The user said yes: deletes the objects asked about that are in the workspace it was asked in. */
  async confirm(): Promise<void> {
    const ids = this.state.asking;
    const workspace = this.state.workspace ?? VIEW;
    if (ids === null || this.state.running) return;
    this.set({ asking: null, workspace: null, running: true });
    const store = this.options.store;
    const total = ids.length;
    const notice = store.notify(null, { severity: 'info', message: `Deleting ${objects(total)}…` }, { sticky: true });
    const results: Result[] = [];
    try {
      const found: MapObject[] = [];
      for (let i = 0; i < ids.length; i += MAX_FETCH_IDS) {
        const result = await this.options.connection.getObjects(ids.slice(i, i + MAX_FETCH_IDS));
        found.push(...result.found);
        results.push(...result.missing.map((): Result => ({ deleted: true }))); // gone already (owner, 2026-10-16)
      }
      await this.options.layersReady?.();
      const layerWorkspace = this.options.layerWorkspace ?? (() => VIEW_WORKSPACE);
      const elsewhere = found.filter((o) => layerWorkspace(o.layerId) !== workspace.id);
      found.splice(0, found.length, ...found.filter((o) => !elsewhere.includes(o)));
      results.push(...elsewhere.map((o): Result => ({ deleted: false, name: nameOf(o), reason: `not in ${workspace.name}` })));
      const progress = () => { store.updateNotification(notice, { severity: 'info', message: `Deleting objects: ${count(results.length)} of ${count(total)}` }, { sticky: true }); };
      progress();
      await inBatches(found, async (object) => {
        results.push(await this.deleteOne(object));
        progress();
      });
    } catch (error) {
      this.out.error('[core-shell] a delete stopped', error);
      store.updateNotification(notice, { severity: 'error', message: `The delete stopped: ${describe(error)}. Deleted ${count(results.filter((r) => r.deleted).length)} of ${objects(total)} before that.` });
      this.set({ running: false });
      return;
    }
    const failed = results.filter((r): r is Extract<Result, { deleted: false }> => !r.deleted);
    const deleted = total - failed.length;
    if (failed.length === 0) {
      store.updateNotification(notice, { severity: 'info', message: `Deleted ${objects(deleted)}.` });
    } else {
      store.updateNotification(notice, {
        severity: 'warning',
        message: `Deleted ${count(deleted)} of ${objects(total)}. ${count(failed.length)} could not be deleted: ${failureList(failed)}.`,
      }, { sticky: true });
    }
    this.set({ running: false });
  }

  /** One object's change request; an object gone meanwhile counts as deleted. */
  private async deleteOne(object: MapObject): Promise<Result> {
    const sent = await send(this.options.connection, changeRequests.deleteObject(object), 'it may have been deleted');
    if (sent.ok || sent.code === 'ENTITY_NOT_FOUND') return { deleted: true };
    return { deleted: false, name: nameOf(object), reason: sent.reason };
  }

  private set(change: Partial<DeleteState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of [...this.listeners]) listener();
  }
}
