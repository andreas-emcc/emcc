/**
 * The shell's lists of object actions and map actions (ADR-0032 points 2 and 5; `ctx.actions`,
 * CR-0015 items 5 and 6). Plugins add to them through their context; the shell's own Delete is
 * one of them, under `core-shell`. The menu (`menu.ts`) picks what applies with the SDK's own rule
 * (`applicableObjectActions`, `applicableMapActions`), from the actions of the workspace shown
 * (SDK 1.2.0 `workspaces`, ADR-0039 point 4; an action that names no workspaces is View's).
 */
import { appearsIn, VIEW_WORKSPACE, type MapAction, type ObjectAction, type Unsubscribe } from '@emc2/plugin-sdk';

/** An action with the plugin that added it, which a failing handler is reported against. */
export interface Registered<A> {
  readonly pluginId: string;
  readonly action: A;
}

/** Plugins are plain JavaScript at runtime: what they pass is checked as it comes. */
const text = (value: unknown): string => String(value);

function checkCommon(kind: string, action: {
  readonly id: unknown; readonly label: unknown; readonly run: unknown; readonly group?: unknown; readonly order?: unknown; readonly permission?: unknown;
  readonly workspaces?: unknown;
}): void {
  if (typeof action.id !== 'string' || action.id === '') throw new TypeError(`${kind} needs a non-empty id`);
  if (typeof action.label !== 'string' || action.label === '') throw new TypeError(`${kind} ${action.id} needs a label`);
  if (typeof action.run !== 'function') throw new TypeError(`${kind} ${action.id} needs a run function`);
  if (action.group !== undefined && typeof action.group !== 'string') throw new TypeError(`${kind} ${action.id} has a group that is not a string: ${text(action.group)}`);
  if (action.order !== undefined && (typeof action.order !== 'number' || !Number.isFinite(action.order))) {
    throw new TypeError(`${kind} ${action.id} has an order that is not a number: ${text(action.order)}`);
  }
  if (action.permission !== undefined && typeof action.permission !== 'string') {
    throw new TypeError(`${kind} ${action.id} has a permission that is not a string: ${text(action.permission)}`);
  }
  if (action.workspaces !== undefined && !(Array.isArray(action.workspaces) && action.workspaces.every((w) => typeof w === 'string'))) {
    throw new TypeError(`${kind} ${action.id} has workspaces that are not a list of strings`);
  }
}

function checkObjectAction(action: ObjectAction): void {
  checkCommon('an object action', action);
  const scope = action.appliesTo as ObjectAction['appliesTo'] | null | undefined;
  if (typeof scope !== 'object' || scope === null) throw new TypeError(`the object action ${action.id} needs appliesTo (an empty one for every object)`);
  for (const key of ['types', 'dataTypes'] as const) {
    const list: unknown = scope[key];
    if (list !== undefined && !(Array.isArray(list) && list.every((v) => typeof v === 'string'))) {
      throw new TypeError(`the object action ${action.id} has appliesTo.${key} that is not a list of strings`);
    }
  }
  if (scope.test !== undefined && typeof scope.test !== 'function') throw new TypeError(`the object action ${action.id} has appliesTo.test that is not a function`);
  if (typeof action.multiple !== 'boolean') throw new TypeError(`the object action ${action.id} needs multiple: true or false`);
}

export class ActionRegistry {
  private objectActions: readonly Registered<ObjectAction>[] = [];
  private mapActions: readonly Registered<MapAction>[] = [];

  /** @param workspace the workspace shown, whose actions {@link objects} and {@link maps} give */
  constructor(private readonly workspace: () => string = () => VIEW_WORKSPACE) {}

  /** Adds an object action; its id must be unique within the plugin while registered. */
  addObjectAction(pluginId: string, action: ObjectAction): Unsubscribe {
    checkObjectAction(action);
    if (this.objectActions.some((r) => r.pluginId === pluginId && r.action.id === action.id)) {
      throw new TypeError(`${pluginId} has an object action ${action.id} already; ids are unique within a plugin`);
    }
    const entry: Registered<ObjectAction> = { pluginId, action };
    this.objectActions = [...this.objectActions, entry];
    return () => { this.objectActions = this.objectActions.filter((r) => r !== entry); };
  }

  addMapAction(pluginId: string, action: MapAction): Unsubscribe {
    checkCommon('a map action', action);
    if (this.mapActions.some((r) => r.pluginId === pluginId && r.action.id === action.id)) {
      throw new TypeError(`${pluginId} has a map action ${action.id} already; ids are unique within a plugin`);
    }
    const entry: Registered<MapAction> = { pluginId, action };
    this.mapActions = [...this.mapActions, entry];
    return () => { this.mapActions = this.mapActions.filter((r) => r !== entry); };
  }

  /** The object actions of the workspace shown. */
  get objects(): readonly Registered<ObjectAction>[] {
    const shown = this.workspace();
    return this.objectActions.filter((r) => appearsIn(r.action, shown));
  }

  /** The map actions of the workspace shown. */
  get maps(): readonly Registered<MapAction>[] {
    const shown = this.workspace();
    return this.mapActions.filter((r) => appearsIn(r.action, shown));
  }
}
