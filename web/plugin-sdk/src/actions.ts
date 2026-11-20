/**
 * Object actions and map actions (ADR-0032, CR-0015 items 5 to 7 and 10). The shell keeps both
 * lists, filters them by the user's permissions, shows them in its menu and calls the handlers.
 * Every action changes objects only through change requests; the menu only starts them.
 *
 * @example
 * ctx.actions.addObjectAction({
 *   id: 'edit', label: 'Edit', icon: Pencil, group: 'edit', appliesTo: { types: ['core.symbol'] },
 *   multiple: false, permission: PERMISSIONS.objectsEdit,
 *   run: ([id]) => openEditor(id),
 * });
 */
import type { Unsubscribe } from './events.ts';
import type { MapObject, Position, Uuid } from './model.ts';
import type { IconComponent } from './workspace.ts';

/** Which objects an action applies to. Every given criterion must hold; with none, every object. */
export interface ActionScope {
  /** Object types, e.g. `['core.symbol']`. */
  readonly types?: readonly string[];
  /** Data types (ADR-0023), e.g. `['cot.cot']`. */
  readonly dataTypes?: readonly string[];
  /** A last test on the object itself; keep it cheap, the shell calls it for every object of the selection. */
  readonly test?: (object: MapObject) => boolean;
}

/** An action on objects, for the right-click menu on the map and on `object-list`'s rows (ADR-0032 point 2). */
export interface ObjectAction {
  /** Unique within the plugin. */
  readonly id: string;
  readonly label: string;
  readonly icon?: IconComponent;
  /** Actions of one group stand together in the menu, groups apart by a separator: `view`, `edit`, any other, `delete` last ({@link ACTION_GROUPS}). Default `other`. */
  readonly group?: string;
  /** Lower comes first within its group; default 100. */
  readonly order?: number;
  readonly appliesTo: ActionScope;
  /** False: offered only for exactly one object, never for a selection of several (e.g. Edit, ADR-0032 point 3). */
  readonly multiple: boolean;
  /** Offered only to users with this permission (ADR-0032 point 8); the server checks the change requests anyway. */
  readonly permission?: string;
  /** Receives the ids of the chosen objects. A handler that throws or rejects is logged and shown as an error (ADR-0032 point 9). */
  run(ids: readonly Uuid[]): void | Promise<void>;
  /**
   * SDK 1.2.0: the workspaces it appears in (ADR-0039 point 4); `'*'` for every workspace.
   * Default `['core.view']`, so what a plugin built before 1.2.0 adds appears in View only.
   */
  readonly workspaces?: readonly string[];
}

/** An action on empty map, e.g. Centre map (ADR-0032 point 5). */
export interface MapAction {
  /** Unique within the plugin. */
  readonly id: string;
  readonly label: string;
  readonly icon?: IconComponent;
  readonly group?: string;
  readonly order?: number;
  readonly permission?: string;
  /** Receives the position that was right-clicked, in lon/lat. */
  run(position: Position): void | Promise<void>;
  /**
   * SDK 1.2.0: the workspaces it appears in (ADR-0039 point 4); `'*'` for every workspace.
   * Default `['core.view']`, so what a plugin built before 1.2.0 adds appears in View only.
   */
  readonly workspaces?: readonly string[];
}

/** A point on the page in CSS pixels (`clientX`, `clientY`), where the menu opens. */
export type ScreenPoint = readonly [x: number, y: number];

/**
 * What a menu is for.
 * - `objects`: the object actions for these objects, e.g. the whole selection.
 * - `position`: the map actions for a position on empty map (or on a cluster).
 * - `choose`: several objects overlap; the menu first lets the user choose one. **The shell then
 *   sets the selection** to the chosen object (ADR-0032 point 3) and shows its object actions, so
 *   the caller does not need to know which one was chosen.
 */
export type MenuTarget =
  | { readonly objects: readonly Uuid[] }
  | { readonly position: Position }
  | { readonly choose: readonly Uuid[] };

/** The shell's lists of actions and its menu. */
export interface Actions {
  addObjectAction(action: ObjectAction): Unsubscribe;
  addMapAction(action: MapAction): Unsubscribe;
  /** Opens the shell's menu at `at`. The map view and `object-list` call it on a right click. */
  openMenu(at: ScreenPoint, target: MenuTarget): void;
}

/**
 * The object actions to offer for `objects`, in menu order: those whose scope matches every object,
 * that the user may use, and, for several objects, only those that take several. The shell and the
 * test kit use this same rule.
 *
 * @example
 * applicableObjectActions(actions, selectedObjects, (p) => ctx.user.has(p)).map((a) => a.label)
 */
export function applicableObjectActions<A extends ObjectAction>(actions: readonly A[], objects: readonly MapObject[], may: (permission: string) => boolean): A[] {
  if (objects.length === 0) return [];
  return actions
    .filter((a) => (objects.length === 1 || a.multiple) && (a.permission === undefined || may(a.permission)) && objects.every((o) => inScope(a.appliesTo, o)))
    .sort(byMenuOrder);
}

/** The map actions to offer, in menu order: those the user may use. */
export function applicableMapActions<A extends MapAction>(actions: readonly A[], may: (permission: string) => boolean): A[] {
  return actions.filter((a) => a.permission === undefined || may(a.permission)).sort(byMenuOrder);
}

function inScope(scope: ActionScope, object: MapObject): boolean {
  return (scope.types === undefined || scope.types.includes(object.type))
    && (scope.dataTypes === undefined || scope.dataTypes.includes(object.dataType))
    && (scope.test === undefined || scope.test(object));
}

/** The known groups, in menu order: `view` (Centre on, Zoom to), `edit`, then any other group by name, and `delete` last. */
export const ACTION_GROUPS = ['view', 'edit', 'delete'] as const;

function groupRank(group: string): [number, string] {
  if (group === 'view') return [0, ''];
  if (group === 'edit') return [1, ''];
  if (group === 'delete') return [3, ''];
  return [2, group];
}

function byMenuOrder(a: { readonly group?: string; readonly order?: number }, b: { readonly group?: string; readonly order?: number }): number {
  const [ra, na] = groupRank(a.group ?? 'other');
  const [rb, nb] = groupRank(b.group ?? 'other');
  if (ra !== rb) return ra - rb;
  if (na !== nb) return na < nb ? -1 : 1;
  return (a.order ?? 100) - (b.order ?? 100);
}

/**
 * The `source.plugin` of the shell's own change requests (CR-0015 item 10; ADR-0032): the shared
 * Delete and the Layers entry's raise. It is not `core`, which browsers may not use, and never the
 * id of the plugin that created the object, because on an update ECore applies the requesting
 * plugin's extension from the request (model rule 5, ADR-0018).
 */
export const SHELL_SOURCE_PLUGIN = 'core-shell';

/** Whether a plugin id is reserved for ECore and the shell: `core`, and every id that starts with `core-`. ECore refuses a plugin with such an id. */
export function isReservedPluginId(id: string): boolean {
  return id === 'core' || id.startsWith('core-');
}
