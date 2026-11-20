/**
 * Settings › Layers' change (ADR-0031 point 3; owner, 2026-10-17): a layer's classification, and on
 * the admin's choice the objects of the layer whose classification is lower, raised to it. Only the
 * classification changes; the rest of each label stays.
 *
 * First the layer, as an ordinary update. Then, for a raise, the layer's objects page by page from
 * the server (`queryLayer`, in the order of creation, which a raise does not change), and for each
 * object under the layer's policy whose classification is lower in its order an ordinary update as
 * `core-shell`: the whole object as the shell received it, with only the classification changed
 * (last write wins; ECore keeps the other plugins' extensions). Objects of another policy, or with a
 * classification outside the order, are left alone and counted (owner, 2026-10-14). The updates go in
 * the shell's batches (`batch.ts`), with a notice like the Delete's; one change runs at a time.
 *
 * Emptying a layer (T-175; owner, QE and QF A, 2026-11-11): "Delete all objects" asks first with the
 * layer's number of objects, then reads all its pages and deletes those objects as `core-shell`, one
 * change request each, in the same batches as the shared Delete. The server checks the user's rights
 * on every object; an object gone meanwhile counts as deleted, and objects added while it runs stay
 * (a data link's live tracks come back with their next report). It runs as one of the layer changes:
 * one at a time with the others.
 */
import {
  changeRequests, MAX_PAGE_SIZE, PERMISSIONS, VIEW_WORKSPACE, type Layer, type LayerPage, type MapObject, type Unsubscribe, type User, type Uuid,
  type WorkspaceInfo,
} from '@emc2/plugin-sdk';
import { count, describe, failureList, inBatches, nameOf, objects, RETRIES, RETRY_DELAY_MS, send, type Failure, type Submitter } from '../actions/batch.ts';
import type { ShellStore } from '../ui/store.ts';
import { compare, orderOf, withClassification, type ClassificationOrders } from './classification.ts';

/** A change the admin has asked for. */
export interface LayerChange {
  readonly layer: Layer;
  /** The new classification, in the layer's policy's order. */
  readonly to: string;
  /** Also raise the layer's objects whose classification is lower. */
  readonly raise: boolean;
}

export interface LayerChangeState {
  /** The change the question is about; null when no question is open. */
  readonly asking: LayerChange | null;
  /** The layer whose emptying the question is about; null when no such question is open. */
  readonly emptying: Layer | null;
  readonly running: boolean;
}

export interface LayerChangerOptions {
  readonly store: ShellStore;
  /** The logged-in user, once the configuration has arrived. */
  readonly user: () => User;
  /** The orders of classifications, once the configuration has arrived. */
  readonly orders: () => ClassificationOrders;
  /** The workspaces the user may see (`ctx.workspaces`), for their edit permissions. */
  readonly workspaces: () => readonly WorkspaceInfo[];
  /** The layer as the shell knows it now, or null when it is gone (`KnownLayers.layer`). */
  readonly current: (layerId: Uuid) => Layer | null;
  readonly connection: Submitter & {
    queryLayer(layerId: Uuid, page: number, pageSize: number): Promise<LayerPage>;
  };
  readonly console?: Pick<Console, 'warn' | 'error'>;
}

/** The fields the store keeps itself, not part of a change request's content. */
const STORE_FIELDS: ReadonlySet<string> = new Set(['id', 'version', 'meta']);

/** An entity's content: everything as received but its id, version and meta. */
function contentOf<E extends { readonly id: Uuid; readonly version: number; readonly meta: unknown }>(entity: E): Omit<E, 'id' | 'version' | 'meta'> {
  return Object.fromEntries(Object.entries(entity).filter(([key]) => !STORE_FIELDS.has(key))) as Omit<E, 'id' | 'version' | 'meta'>;
}

const wait = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

export class LayerChanger {
  private state: LayerChangeState = { asking: null, emptying: null, running: false };
  private readonly listeners = new Set<() => void>();
  private readonly out: Pick<Console, 'warn' | 'error'>;

  constructor(private readonly options: LayerChangerOptions) {
    this.out = options.console ?? console;
  }

  readonly subscribe = (listener: () => void): Unsubscribe => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  readonly getState = (): LayerChangeState => this.state;

  /** May the user change View's layers (`layers.edit`; the server checks each request anyway). */
  get mayChangeLayers(): boolean {
    return this.mayChangeLayersIn(VIEW_WORKSPACE);
  }

  /** May the user raise View's objects (`objects.edit`). */
  get mayRaise(): boolean {
    return this.mayRaiseIn(VIEW_WORKSPACE);
  }

  /** May the user change the layers of `workspace`: `layers.edit` in View, its edit permission in another (ADR-0039 point 7). */
  mayChangeLayersIn(workspace: string): boolean {
    return this.options.user().has(this.permissionIn(workspace, PERMISSIONS.layersEdit));
  }

  /** May the user raise the objects of `workspace`: `objects.edit` in View, its edit permission in another. */
  mayRaiseIn(workspace: string): boolean {
    return this.options.user().has(this.permissionIn(workspace, PERMISSIONS.objectsEdit));
  }

  /** May the user empty the layers of `workspace`: the shared Delete's right, `objects.edit` in View, its edit permission in another. */
  mayEmptyIn(workspace: string): boolean {
    return this.mayRaiseIn(workspace);
  }

  private permissionIn(workspace: string, inView: string): string {
    if (workspace === VIEW_WORKSPACE) return inView;
    return this.options.workspaces().find((w) => w.id === workspace)?.editPermission ?? inView;
  }

  /** The classifications the layer may get: its policy's order, or null when it has none (read only). */
  choicesFor(layer: Layer): readonly string[] | null {
    return orderOf(this.options.orders(), layer.label);
  }

  /** Asks the question for this change; while one runs, says so instead. */
  ask(change: LayerChange): void {
    if (!this.mayAsk()) return;
    this.set({ asking: change });
  }

  /** Asks whether to delete all the layer's objects; while a change runs, says so instead. */
  askEmpty(layer: Layer): void {
    if (!this.mayAsk()) return;
    this.set({ emptying: layer });
  }

  private mayAsk(): boolean {
    if (this.state.asking !== null || this.state.emptying !== null) return false;
    if (this.state.running) {
      this.options.store.notify(null, { severity: 'info', message: 'A layer change is still running; try again when it has finished.' });
      return false;
    }
    return true;
  }

  cancel(): void {
    this.set({ asking: null, emptying: null });
  }

  /**
   * The user said yes to emptying. When the layer is gone or has been locked meanwhile, nothing is
   * sent (the server would refuse every delete of a locked layer's objects).
   */
  async confirmEmpty(): Promise<void> {
    const asked = this.state.emptying;
    if (asked === null || this.state.running) return;
    const now = this.options.current(asked.id);
    if (now === null || now.locked === true) {
      this.set({ emptying: null });
      const why = now === null ? 'is gone' : 'is locked now';
      this.options.store.notify(null, { severity: 'info', message: `The layer ${asked.name} ${why}, so nothing was deleted.` });
      return;
    }
    this.set({ emptying: null, running: true });
    try {
      await this.empty(now);
    } finally {
      this.set({ running: false });
    }
  }

  /** One page of the layer's objects for the list, asked again when the server was busy or did not answer. */
  readPage(layerId: Uuid, page: number, pageSize: number): Promise<LayerPage> {
    return this.page(layerId, page, pageSize);
  }

  private async empty(layer: Layer): Promise<void> {
    const store = this.options.store;
    const notice = store.notify(null, { severity: 'info', message: `Deleting all objects in ${layer.name}…` }, { sticky: true });
    const found = new Map<Uuid, MapObject>();
    /** The layer's number of objects at each page. */
    const totals: number[] = [];
    let deleted = 0;
    const failed: Failure[] = [];
    try {
      for (let page = 0; ; page++) {
        const result = await this.page(layer.id, page);
        totals.push(result.total);
        for (const object of result.objects) found.set(object.id, object);
        store.updateNotification(notice, {
          severity: 'info', message: `Reading the objects of ${layer.name}: ${count(found.size)} of ${count(result.total)}`,
        }, { sticky: true });
        if (result.objects.length < MAX_PAGE_SIZE) break;
      }
      const all = [...found.values()];
      const progress = () => {
        store.updateNotification(notice, {
          severity: 'info', message: `Deleting the objects of ${layer.name}: ${count(deleted + failed.length)} of ${count(all.length)}`,
        }, { sticky: true });
      };
      progress();
      await inBatches(all, async (object) => {
        const sent = await send(this.options.connection, changeRequests.deleteObject(object), 'it may have been deleted');
        if (sent.ok || sent.code === 'ENTITY_NOT_FOUND') deleted++; // gone already: deleted (owner, 2026-10-16)
        else failed.push({ name: nameOf(object), reason: sent.reason });
        progress();
      });
    } catch (error) {
      this.out.error('[core-shell] emptying a layer stopped', error);
      store.updateNotification(notice, {
        severity: 'error', message: `Deleting all objects in ${layer.name} stopped: ${describe(error)}. Deleted ${objects(deleted)} before that.`,
      });
      return;
    }
    // Objects added or deleted while it ran move the pages: some may have been missed.
    const moved = totals.some((n) => n !== totals[0]) ? " The layer's objects changed while it ran, so some may be left." : '';
    if (failed.length === 0) {
      const message = found.size === 0 ? `The layer ${layer.name} had no objects.` : `Deleted ${objects(deleted)} in ${layer.name}.`;
      store.updateNotification(notice, { severity: 'info', message: `${message}${moved}` });
    } else {
      store.updateNotification(notice, {
        severity: 'warning',
        message: `Deleted ${count(deleted)} of ${objects(found.size)} in ${layer.name}. ${count(failed.length)} could not be deleted: ${failureList(failed)}.${moved}`,
      }, { sticky: true });
    }
  }

  /**
   * The admin said yes. When the layer changed while the question was open (renamed, reordered,
   * its label changed, or deleted), nothing is sent: the question was about the layer as it was
   * (review F1).
   */
  async confirm(): Promise<void> {
    const change = this.state.asking;
    if (change === null || this.state.running) return;
    const now = this.options.current(change.layer.id);
    if (now?.version !== change.layer.version) {
      this.set({ asking: null });
      this.options.store.notify(null, {
        severity: 'info', message: `The layer ${change.layer.name} changed meanwhile, so nothing was changed. Check it and apply again.`,
      });
      return;
    }
    this.set({ asking: null, running: true });
    try {
      await this.run(change);
    } finally {
      this.set({ running: false });
    }
  }

  private async run({ layer, to, raise }: LayerChange): Promise<void> {
    const store = this.options.store;
    const notice = store.notify(null, { severity: 'info', message: `Changing the layer ${layer.name} to ${to}…` }, { sticky: true });
    // Only the objects, when the layer has that classification already.
    const changed = layer.label.classification === to ? { ok: true as const } : await send(
      this.options.connection, changeRequests.updateLayer(layer, { ...contentOf(layer), label: withClassification(layer.label, to) }),
      'it may have been changed',
    );
    if (!changed.ok) {
      store.updateNotification(notice, { severity: 'error', message: `The layer ${layer.name} was not changed: ${changed.reason}.` });
      return;
    }
    if (!raise) {
      store.updateNotification(notice, { severity: 'info', message: `The layer ${layer.name} is now ${to}.` });
      return;
    }

    const orders = this.options.orders();
    const policy = layer.label.policyIdentifier.name;
    let checked = 0;
    let total = 0;
    /** The layer's number of objects at each page. */
    const totals: number[] = [];
    let raised = 0;
    let unchanged = 0;
    let leftAlone = 0;
    const failed: Failure[] = [];
    const progress = () => {
      store.updateNotification(notice, { severity: 'info', message: `Raising the objects of ${layer.name} to ${to}: ${count(checked)} of ${count(total)} checked` }, { sticky: true });
    };
    try {
      for (let page = 0; ; page++) {
        const result = await this.page(layer.id, page);
        total = result.total;
        totals.push(result.total);
        const lower: MapObject[] = [];
        for (const object of result.objects) {
          const where = compare(orders, object.label, policy, to);
          if (where === 'lower') lower.push(object);
          else if (where === 'outside') leftAlone++;
          else unchanged++;
        }
        checked += result.objects.length - lower.length;
        progress();
        await inBatches(lower, async (object) => {
          const sent = await send(
            this.options.connection, changeRequests.updateObject(object, { ...contentOf(object), label: withClassification(object.label, to) }),
            'it may have been raised',
          );
          if (sent.ok) raised++;
          else if (sent.code !== 'ENTITY_NOT_FOUND') failed.push({ name: nameOf(object), reason: sent.reason }); // gone meanwhile: nothing to raise
          checked++;
          progress();
        });
        if (result.objects.length < MAX_PAGE_SIZE) break;
      }
    } catch (error) {
      this.out.error('[core-shell] a raise stopped', error);
      store.updateNotification(notice, {
        severity: 'error',
        message: `The layer ${layer.name} is now ${to}, but raising its objects stopped: ${describe(error)}. Raised ${objects(raised)} before that.`
          + ` To go on, choose ${to} again with "Also raise objects below it".`,
      });
      return;
    }
    const parts = [`The layer ${layer.name} is now ${to}. Raised ${objects(raised)}`];
    if (unchanged > 0) parts.push(`${count(unchanged)} already ${to} or higher`);
    if (leftAlone > 0) parts.push(`${count(leftAlone)} left alone (another policy, or a classification outside the order)`);
    // Objects added or deleted while it ran move the pages: some may have been missed (review F7).
    const moved = totals.some((n) => n !== totals[0]) ? ' The layer\'s objects changed while it ran; run it again to be sure none was missed.' : '';
    const summary = `${parts.join('; ')}.${moved}`;
    if (failed.length === 0) {
      store.updateNotification(notice, { severity: 'info', message: summary }, leftAlone > 0 ? { sticky: true } : {});
    } else {
      store.updateNotification(notice, {
        severity: 'warning', message: `${summary} ${count(failed.length)} could not be raised: ${failureList(failed)}.`,
      }, { sticky: true });
    }
  }

  /** One page of the layer's objects, asked again when the server was busy or did not answer (review F6). */
  private async page(layerId: Uuid, page: number, pageSize = MAX_PAGE_SIZE): Promise<LayerPage> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.options.connection.queryLayer(layerId, page, pageSize);
      } catch (error) {
        if (attempt >= RETRIES) throw error;
        await wait(RETRY_DELAY_MS);
      }
    }
  }

  private set(change: Partial<LayerChangeState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of [...this.listeners]) listener();
  }
}
