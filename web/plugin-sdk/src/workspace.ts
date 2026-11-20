/**
 * The workspace of SDK 1.1.0 (ADR-0031, CR-0015 items 1 to 4): panels with a default pane, small
 * controls in the top bar, and each plugin's share of the user's setup.
 *
 * @example
 * const panel = ctx.ui.addPanel({ id: 'objects', title: 'Objects', defaultPane: 'bottom', component: ObjectsPanel });
 * panel.show();   // e.g. when another plugin opens the list
 */
import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { Unsubscribe } from './events.ts';
import type { JsonValue } from './model.ts';

/** The panes of the View tab (ADR-0031 point 4). The Map Pane is the map view's. */
export type Pane = 'left' | 'right' | 'bottom';

/** An icon from the shared Lucide set (ADR-0034), e.g. `import { Layers } from 'lucide-react'`. */
export type IconComponent = LucideIcon;

/**
 * A panel in the View tab. The user may move it to another pane; the shell keeps where it is in the
 * user's setup. **It must work in every pane**, narrow and tall as well as wide and low.
 */
export interface Panel {
  /** Unique within the plugin. */
  readonly id: string;
  /** Shown once, in the shell's head (SDK 1.8.0, CR-0043 part C: no inner heading repeats it). */
  readonly title: string;
  /**
   * The panel's icon. **From SDK 1.8.0 every panel gives one** (CR-0043 part C, "name once, icon
   * always"): the type keeps it optional, so a plugin built for 1.7.0 or earlier still loads and gets
   * the shell's neutral icon; a plugin that declares `^1.8.0` gives one, as the conformance review checks.
   */
  readonly icon?: IconComponent;
  /** Where the panel starts for a user who has not moved it. */
  readonly defaultPane: Pane;
  /** Lower comes first within its pane; default 100. */
  readonly order?: number;
  readonly component: ComponentType;
  /**
   * SDK 1.2.0: the workspaces it appears in (ADR-0039 point 4); `'*'` for every workspace.
   * Default `['core.view']`, so what a plugin built before 1.2.0 adds appears in View only.
   */
  readonly workspaces?: readonly string[];
}

/** What `addPanel` returns. */
export interface PanelHandle {
  /** Expands the panel and brings it to the front of its pane (for Edit from the menu, or a list opened by another plugin). */
  show(): void;
  /** Removes the panel, as the `Unsubscribe` of `addControlPanel` does. */
  remove(): void;
}

/** A small control on the right of the top bar (ADR-0031 points 1 and 6), e.g. the bookmarks control. The shell caps its width. */
export interface TopBarItem {
  /** Unique within the plugin. */
  readonly id: string;
  /** Lower comes first (further left); default 100. */
  readonly order?: number;
  readonly component: ComponentType;
  /**
   * SDK 1.6.0 (CR-0041 part F; T-152): the workspaces it appears in, as a panel's (ADR-0039 point 4);
   * `'*'` for every workspace. **Absent means every workspace**, unlike a panel, so the items built
   * before 1.6.0 (the bookmarks, the setups) stay where they are. See {@link topBarItemAppearsIn}.
   *
   * @example
   * ctx.ui.addTopBarItem({ id: 'scenario', order: 20, workspaces: ['simulator.simulation'], component: ScenarioMenu });
   */
  readonly workspaces?: readonly string[];
}

/** SDK 1.6.0: whether a top-bar item appears in `workspaceId`; without a list, in every workspace. */
export function topBarItemAppearsIn(item: TopBarItem, workspaceId: string): boolean {
  return appearsIn({ workspaces: item.workspaces ?? [EVERY_WORKSPACE] }, workspaceId);
}

/** SDK 1.2.0: View's id, the workspace of every layer without a `workspace` (ADR-0039). */
export const VIEW_WORKSPACE = 'core.view';

/** SDK 1.2.0: in a `workspaces` list, every workspace. */
export const EVERY_WORKSPACE = '*';

/**
 * SDK 1.2.0: a workspace the user may see (ADR-0039): View, or one a plugin declares, shown as a
 * tab next to View. A change to its layers or their objects needs its `editPermission` instead
 * of `objects.edit` and `layers.edit`, which stay View's; the server rejects one without it
 * (`PERMISSION_DENIED`).
 */
export interface WorkspaceInfo {
  readonly id: string;
  readonly name: string;
  /** Absent for View, which everyone sees. */
  readonly viewPermission?: string;
  /** Absent for View, where `objects.edit` and `layers.edit` apply. */
  readonly editPermission?: string;
  /** Lower comes first after View. */
  readonly order: number;
}

/**
 * SDK 1.2.0: the workspace shown (`ctx.workspace`). On a switch (ADR-0039 point 3), in this order:
 *
 * 1. the shell unmounts the old workspace's panels and overlays and mounts the new one's;
 * 2. the map view's moment: it ends running map interactions (they resolve with `null`), clears
 *    every fade list and clears the selection. The shell gives the map view this moment, before
 *    anything below; how is between the shell and `map-view-2d` (T-080), with no SDK member;
 * 3. each subscription that follows the workspace shown gets a fresh snapshot;
 * 4. each plugin's setup share for that workspace is restored (`SetupShare.restore`);
 * 5. `onChange` is called.
 *
 * So a fade list set again from the fresh snapshot or from `onChange`, and an interaction started
 * from `onChange`, stay. The order in which plugins' `onChange` listeners run is not set.
 */
export interface CurrentWorkspace {
  readonly current: WorkspaceInfo;
  onChange(listener: (workspace: WorkspaceInfo) => void): Unsubscribe;
}

/** SDK 1.2.0: whether something with `workspaces` (a panel, an overlay, an action) appears in `workspaceId`; without a list, in View only. */
export function appearsIn(item: { readonly workspaces?: readonly string[] }, workspaceId: string): boolean {
  const list = item.workspaces ?? [VIEW_WORKSPACE];
  return list.includes(EVERY_WORKSPACE) || list.includes(workspaceId);
}

/** SDK 1.2.0: the workspace of a layer: its `workspace`, or View. */
export function workspaceOf(layer: { readonly workspace?: string }): string {
  return layer.workspace ?? VIEW_WORKSPACE;
}

/** The most bytes a plugin's share of a setup may take, as JSON in UTF-8 (CR-0015 item 4). */
export const MAX_SETUP_SHARE_BYTES = 64 * 1024;

/**
 * A plugin's share of the user's setup (ADR-0031 point 5): what it needs to restore its part of the
 * workspace, e.g. the map view's map type, centre, zoom, dim level and layer visibility.
 */
export interface SetupShare {
  /** The current share, as JSON. Called by the shell whenever it saves the setup. */
  save(): JsonValue;
  /**
   * Applies a saved share: at start, and when the user picks a named setup. A share the plugin
   * cannot read must be ignored (keep the current state, warn in the status), never thrown.
   */
  restore(share: JsonValue): void;
}

/**
 * The setups (ADR-0031 point 5). The shell keeps them, remembered and named, as the user's
 * documents under `core` (ADR-0027); each plugin only saves and restores its own share.
 *
 * @example
 * ctx.setup.register({ save: () => ({ dim: dimLevel }), restore: (s) => { if (isShare(s)) applyDim(s.dim); } });
 * onDimChange(() => ctx.setup.changed());
 */
export interface Setup {
  /** One registration per plugin; a second replaces the first. A share over {@link MAX_SETUP_SHARE_BYTES} is not saved, and the shell logs it. */
  register(share: SetupShare): Unsubscribe;
  /** Tells the shell that the share changed, so the remembered setup follows. Cheap: the shell saves at most about once per second. */
  changed(): void;
}

/** The size of `value` as JSON in UTF-8, as the shell measures a setup share. */
export function jsonBytes(value: JsonValue): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}
