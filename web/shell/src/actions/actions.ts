/**
 * The shell's actions (ADR-0032): the lists, the menu, the shared Delete and the shared Move and
 * Copy to layer (ADR-0053), made once at start (`boot.tsx`). They are the shell's own object actions
 * (`core-shell`): each in View at once, and in each other workspace the user may see once the
 * configuration names them.
 */
import {
  SHELL_SOURCE_PLUGIN, VIEW_WORKSPACE, type DataType, type MapView, type SymbolService, type Unsubscribe, type User, type WorkspaceInfo,
} from '@emc2/plugin-sdk';
import type { ShellStore } from '../ui/store.ts';
import { Deleter, type DeleterOptions } from './deletion.ts';
import { LayerMover } from './layerMoves.ts';
import { KnownLayers, type LayerSource } from '../layers/known.ts';
import { ActionMenu } from './menu.ts';
import { ActionRegistry } from './registry.ts';

export interface ShellActions {
  readonly registry: ActionRegistry;
  readonly menu: ActionMenu;
  readonly deleter: Deleter;
  /** "Move to layer…" and "Copy to layer…" (ADR-0053). */
  readonly mover: LayerMover;
  /** The layers and their counts, shared with Settings › Layers. */
  readonly layers: KnownLayers;
  /** The Delete, Move and Copy in each of these workspaces besides View, once they are known (`/api/config`). */
  deleteIn(workspaces: readonly WorkspaceInfo[]): void;
}

export interface ShellActionsOptions {
  readonly store: ShellStore;
  /** The logged-in user, once the configuration has arrived. */
  readonly user: () => User;
  readonly connection: DeleterOptions['connection'];
  readonly dataTypes: () => readonly DataType[];
  readonly mapView: () => Promise<MapView | null>;
  readonly symbols: () => Promise<SymbolService | null>;
  /** The live picture's channels, once the plugins' subscriptions exist. */
  readonly layers: () => LayerSource | null;
  /** The workspace shown (`ctx.workspace`). */
  readonly workspace: () => WorkspaceInfo;
  readonly console?: Pick<Console, 'warn' | 'error'>;
}

export function createActions(options: ShellActionsOptions): ShellActions {
  const registry = new ActionRegistry(() => options.workspace().id);
  const layers = new KnownLayers(options.layers);
  const out = options.console === undefined ? {} : { console: options.console };
  const menu = new ActionMenu({
    store: options.store, registry, user: options.user, objects: options.connection, dataTypes: options.dataTypes,
    layerName: (id) => layers.name(id), layersReady: () => layers.ready(), mapView: options.mapView, symbols: options.symbols, ...out,
  });
  const deleter = new Deleter({
    store: options.store, user: options.user, connection: options.connection, layerWorkspace: (id) => layers.workspaceOf(id),
    layersReady: () => layers.ready(), workspace: options.workspace, ...out,
  });
  const mover = new LayerMover({
    store: options.store, user: options.user, connection: options.connection, layer: (id) => layers.layer(id),
    layersReady: () => layers.ready(), workspace: options.workspace, ...out,
  });
  const actionsIn = (workspace?: WorkspaceInfo) => [deleter.action(workspace), mover.action('move', workspace), mover.action('copy', workspace)];
  actionsIn().forEach((action) => registry.addObjectAction(SHELL_SOURCE_PLUGIN, action));
  let others: Unsubscribe[] = [];
  return {
    registry, menu, deleter, mover, layers,
    deleteIn(workspaces) {
      others.forEach((remove) => { remove(); });
      others = workspaces.filter((w) => w.id !== VIEW_WORKSPACE).flatMap(actionsIn).map((a) => registry.addObjectAction(SHELL_SOURCE_PLUGIN, a));
    },
  };
}
