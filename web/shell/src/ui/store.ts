/**
 * Everything the shell shows, as one immutable view that React reads with useSyncExternalStore:
 * the plugins and their status, the panels and their layout, the top bar items, the Map Pane
 * overlays and map view, the notifications, the connection state and the clock.
 *
 * Workspaces (ADR-0039; T-080): the view holds the workspaces the user may see and the one shown.
 * Its panels and overlays are those that appear in the workspace shown (`appearsIn`), and its
 * layout is that workspace's: each workspace has a pane layout of its own.
 */
import {
  appearsIn, VIEW_WORKSPACE, type IconComponent, type Look, type MapPaneOverlay, type MapViewMount, type Notification, type Pane,
  pluginCategory, type PluginCategory, type PluginState, type PluginStatus, type SettingsPanel, type TopBarItem, type Unsubscribe, type WorkspaceInfo,
} from '@emc2/plugin-sdk';
import type { ComponentType } from 'react';
import type { LiveState } from '../live/connection.ts';
import type { PluginEntry } from '../plugins/plan.ts';
import type { TimeChoice } from '../time/choice.ts';
import * as layouts from './layout.ts';
import type { Layout, Placeable } from './layout.ts';
import { BUILT_IN_LOOK, DEFAULT_CHOICE, type LookChoice } from './theme.ts';

/** Where a plugin's web part stands in this browser. */
export type WebLoad = 'none' | 'waiting' | 'loading' | 'active' | 'failed' | 'refused';

export interface PluginRow {
  readonly id: string;
  readonly name: string;
  /** The server's effective status (`GET /api/plugins`). */
  readonly server: { readonly active: boolean; readonly state: string; readonly detail: string };
  /** SDK 1.4.0: the capabilities its manifest declares (ADR-0044). */
  readonly capabilities: readonly string[];
  readonly load: WebLoad;
  /** Why the web part failed or was refused. */
  readonly loadDetail: string;
  /** What the plugin reported with `ctx.status.set`, per browser session. */
  readonly reported: PluginStatus | null;
  /** What the shell observed, e.g. a panel that failed to render. */
  readonly observed: PluginStatus | null;
  /** What the shell notes about the plugin, e.g. a service it uses that no loaded plugin provides (CR-0011). */
  readonly notes: readonly string[];
  /** It has settings a user can change at runtime: it gets a tab in the top bar (ADR-0026). */
  readonly hasSettings: boolean;
  /** SDK 1.9.0 (ADR-0064): the compute threads its manifest declares, 0 for none: its Settings entry sets how many it may run. */
  readonly computeThreads?: number;
  /** SDK 1.6.0 (T-174): its Settings category; absent means General. */
  readonly category?: PluginCategory;
  /** SDK 1.8.0 (CR-0043 part D): its manifest's `icon` as written; null or absent: none. */
  readonly icon?: string | null;
}

/** A panel as the shell holds it: a plugin's (`addPanel`, `addControlPanel`) or the shell's own. */
export interface PanelSpec {
  readonly id: string;
  readonly title: string;
  readonly icon?: IconComponent | undefined;
  readonly order?: number | undefined;
  readonly component: ComponentType;
  /** The workspaces it appears in (SDK 1.2.0); without a list, View only. */
  readonly workspaces?: readonly string[] | undefined;
}

export interface PanelItem extends Placeable {
  /** Unique per registration, for React. */
  readonly key: string;
  readonly pluginId: string;
  readonly panel: PanelSpec;
}

export interface TopBarEntry {
  readonly key: string;
  readonly pluginId: string;
  readonly item: TopBarItem;
  readonly seq: number;
}

/**
 * SDK 1.3.0 (CR-0023, ADR-0035; T-073): a plugin's own settings panel, shown instead of the
 * generated form in its entry of the Settings list (`ui/settings/SettingsPanels.tsx`).
 */
export interface SettingsPanelEntry {
  /** New for each `setSettingsPanel`, so a replaced panel mounts afresh and an old undo does nothing. */
  readonly key: string;
  readonly pluginId: string;
  readonly panel: SettingsPanel;
  /** The panel says it holds unsaved changes (`markUnsaved`). */
  readonly unsaved: boolean;
  /** Why it failed while rendering, or null: the entry then shows the generated form (owner, 2026-10-30). */
  readonly failed: string | null;
}

/** The clock's time (ADR-0031 point 1): UTC by default, local time by the user's choice. */
export type ClockMode = 'utc' | 'local';

export interface OverlayItem {
  readonly key: string;
  readonly pluginId: string;
  readonly overlay: MapPaneOverlay;
  readonly seq: number;
}

export interface NotificationItem extends Notification {
  readonly id: number;
  /** Null for the shell's own notifications. */
  readonly pluginId: string | null;
}

/** How this browser is logged in (`GET /api/config`, ADR-0022). */
export interface LoginInfo {
  /** `oidc`: login with OpenID Connect; `none`: the no-login mode. */
  readonly mode: 'oidc' | 'none';
  /** Null when nobody is logged in. */
  readonly user: { readonly id: string; readonly name: string; readonly permissions?: readonly string[] } | null;
}

/** View, as `ctx.workspaces` gives it before the configuration has named the others. */
export const VIEW_INFO: WorkspaceInfo = Object.freeze({ id: VIEW_WORKSPACE, name: 'View', order: -2147483648 });

export interface ShellView {
  readonly plugins: readonly PluginRow[];
  /** The panels of the workspace shown. */
  readonly panels: readonly PanelItem[];
  /** The workspace shown's pane layout. */
  readonly layout: Layout;
  /** The workspaces the user may see, View first (`/api/config`; `ctx.workspaces`). */
  readonly workspaces: readonly WorkspaceInfo[];
  /** The workspace shown (`ctx.workspace`): View, or one of {@link workspaces}. */
  readonly workspace: string;
  /** The last `show()`: the View scrolls that panel into view once it is laid out. */
  readonly reveal: { readonly id: string; readonly n: number } | null;
  readonly topBarItems: readonly TopBarEntry[];
  /** The plugins' own settings panels, one per plugin at most. */
  readonly settingsPanels: readonly SettingsPanelEntry[];
  readonly clock: ClockMode;
  /**
   * The time control's state (ADR-0045; `time/choice.ts`): null until it is first opened, which is
   * now. It belongs to the page and is not part of the setups (point 2).
   */
  readonly time: TimeChoice | null;
  /** The user's look, light or dark, and density (ADR-0034), part of their setup. */
  readonly look: LookChoice;
  /** The installation's default look (`/api/config`), for a choice that keeps it. */
  readonly installationLook: Look;
  /** The overlays of the workspace shown. */
  readonly overlays: readonly OverlayItem[];
  readonly mapView: { readonly pluginId: string; readonly view: MapViewMount } | null;
  readonly notifications: readonly NotificationItem[];
  readonly live: LiveState;
  /** The application cannot run, e.g. a required plugin failed. */
  readonly fatal: string | null;
  /** Null until the server's configuration has arrived. */
  readonly login: LoginInfo | null;
  /** The view tab chosen (`ui/tabs.ts`); shown only if the user sees it, else View. */
  readonly tab: string;
  /** The Settings entry chosen (`ui/settings/entries.ts`); null or one not in the list: the first. */
  readonly settingsEntry: string | null;
  /** Why the setup is not remembered in this session (`setups/setups.ts`), or null. */
  readonly setupProblem: string | null;
}

/** Info notifications disappear after this time; warnings and errors stay until dismissed. */
export const INFO_LIFETIME_MS = 8_000;
const MAX_NOTIFICATIONS = 20;
const SEVERITY: Record<PluginState, number> = { OK: 0, DEGRADED: 1, FAILED: 2 };

/** The worse of two statuses, as for the server's effective status. */
export function worse(a: PluginStatus | null, b: PluginStatus | null): PluginStatus | null {
  if (a === null) return b;
  if (b === null) return a;
  return SEVERITY[b.state] > SEVERITY[a.state] ? b : a;
}

/** Lower `order` first (default 100), then in registration order. */
const byOrder = (a: { readonly order?: number | undefined }, aSeq: number, b: { readonly order?: number | undefined }, bSeq: number) =>
  (a.order ?? 100) - (b.order ?? 100) || aSeq - bSeq;

export class ShellStore {
  private view: ShellView = {
    plugins: [], panels: [], layout: layouts.DEFAULT_LAYOUT, workspaces: [VIEW_INFO], workspace: VIEW_WORKSPACE, reveal: null,
    topBarItems: [], settingsPanels: [], clock: 'utc', time: null, look: DEFAULT_CHOICE, installationLook: BUILT_IN_LOOK, overlays: [], mapView: null,
    notifications: [], live: 'closed', fatal: null, login: null, tab: 'view', settingsEntry: null, setupProblem: null,
  };
  /** Every panel and overlay registered, of every workspace; the view holds the shown workspace's. */
  private allPanels: readonly PanelItem[] = [];
  private allOverlays: readonly OverlayItem[] = [];
  /** The pane layouts of the workspaces not shown. */
  private readonly layouts = new Map<string, Layout>();
  /** The element the map view is mounted into, for the switch's moment (`workspaces/switch.ts`). */
  private mapPaneElement: HTMLElement | null = null;
  private readonly listeners = new Set<() => void>();
  private seq = 0;
  /** Notifications that stay until dismissed or updated, also as info. */
  private readonly sticky = new Set<number>();

  readonly subscribe = (listener: () => void): Unsubscribe => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  readonly getView = (): ShellView => this.view;

  setPlugins(entries: readonly PluginEntry[]): void {
    this.update({
      plugins: entries.map((e) => ({
        id: e.id,
        name: e.name ?? e.id,
        server: { active: e.active, state: e.status.state, detail: e.status.detail },
        capabilities: e.capabilities ?? [],
        load: e.active && e.web !== null ? 'waiting' : 'none',
        loadDetail: '',
        reported: null,
        observed: null,
        notes: [],
        hasSettings: e.hasSettings === true,
        computeThreads: e.computeThreads ?? 0,
        category: pluginCategory(e.category),
        icon: e.icon ?? null,
      })),
    });
  }

  setLoad(pluginId: string, load: WebLoad, detail = ''): void {
    this.updatePlugin(pluginId, (p) => ({
      ...p, load, loadDetail: detail,
      observed: load === 'failed' || load === 'refused' ? { state: 'FAILED', detail } : p.observed,
    }));
  }

  /** Something the Control Pane shows about the plugin that is no failure. */
  note(pluginId: string, note: string): void {
    this.updatePlugin(pluginId, (p) => ({ ...p, notes: [...p.notes, note] }));
  }

  /** `ctx.status.set` of a plugin. */
  report(pluginId: string, status: PluginStatus): void {
    this.updatePlugin(pluginId, (p) => ({ ...p, reported: status }));
  }

  /** Something the shell saw go wrong in a running plugin; never makes a status better. */
  observe(pluginId: string, status: PluginStatus): void {
    this.updatePlugin(pluginId, (p) => ({ ...p, observed: worse(p.observed, status) }));
  }

  /** A panel in its default pane (`addControlPanel`: the right pane); the user may move it. */
  addPanel(pluginId: string, panel: PanelSpec, defaultPane: Pane = 'right'): Unsubscribe {
    const seq = ++this.seq;
    const key = `${pluginId}/${panel.id}/${String(seq)}`;
    const item: PanelItem = { key, id: `${pluginId}/${panel.id}`, pluginId, panel, defaultPane, order: panel.order ?? 100, seq };
    this.allPanels = [...this.allPanels, item];
    this.update({ panels: this.shownPanels() });
    return () => {
      this.allPanels = this.allPanels.filter((p) => p.key !== key);
      this.update({ panels: this.shownPanels() });
    };
  }

  /** The workspaces the user may see, View first (`/api/config`); the one shown stays if it is among them, else View. */
  setWorkspaces(workspaces: readonly WorkspaceInfo[]): void {
    const given = workspaces.some((w) => w.id === VIEW_WORKSPACE) ? workspaces : [VIEW_INFO, ...workspaces];
    // Frozen: `ctx.workspaces` gives it to plugins, which are plain JavaScript (review, 9).
    const list: readonly WorkspaceInfo[] = Object.freeze(given.map((w) => Object.freeze({ ...w })));
    this.update({ workspaces: list });
    if (!list.some((w) => w.id === this.view.workspace)) this.setWorkspace(VIEW_WORKSPACE);
  }

  /**
   * Shows another workspace: its panels, overlays and pane layout (the switch's first step, SDK
   * `CurrentWorkspace`; the rest is `workspaces/switch.ts`). The layout of the one left is kept.
   */
  setWorkspace(id: string): void {
    if (id === this.view.workspace || !this.view.workspaces.some((w) => w.id === id)) return;
    this.layouts.set(this.view.workspace, this.view.layout);
    const layout = this.layouts.get(id) ?? layouts.DEFAULT_LAYOUT;
    this.layouts.delete(id);
    this.view = { ...this.view, workspace: id }; // the panels and overlays below are those of `id`
    this.update({ workspace: id, layout, reveal: null, panels: this.shownPanels(), overlays: this.shownOverlays() });
  }

  /** A workspace's pane layout, also of one not shown (its setup is saved). */
  layoutOf(workspace: string): Layout {
    return workspace === this.view.workspace ? this.view.layout : this.layouts.get(workspace) ?? layouts.DEFAULT_LAYOUT;
  }

  /** The Map Pane's element while the map view is mounted in it; null otherwise. */
  get mapPane(): HTMLElement | null {
    return this.mapPaneElement;
  }

  setMapPane(element: HTMLElement | null): void {
    this.mapPaneElement = element;
  }

  private shownPanels(): readonly PanelItem[] {
    return this.allPanels.filter((p) => appearsIn(p.panel.workspaces === undefined ? {} : { workspaces: p.panel.workspaces }, this.view.workspace));
  }

  private shownOverlays(): readonly OverlayItem[] {
    return this.allOverlays.filter((o) => appearsIn(o.overlay, this.view.workspace));
  }

  movePanel(id: string, to: Pane): void {
    this.setLayout(layouts.movePanel(this.view.layout, this.view.panels, id, to));
  }

  shiftPanel(id: string, by: -1 | 1): void {
    this.setLayout(layouts.shiftPanel(this.view.layout, this.view.panels, id, by));
  }

  setPanelCollapsed(id: string, collapsed: boolean): void {
    this.setLayout(layouts.setPanelCollapsed(this.view.layout, id, collapsed));
  }

  setPaneCollapsed(pane: Pane, collapsed: boolean): void {
    this.setLayout(layouts.setPaneCollapsed(this.view.layout, pane, collapsed));
  }

  /** Sets a pane's size, within what this room allows (`layout.maxSize`). */
  setPaneSize(pane: Pane, size: number, room: layouts.Room): void {
    this.setLayout(layouts.setPaneSize(this.view.layout, pane, size, room));
  }

  selectBottomTab(id: string): void {
    this.setLayout(layouts.selectBottomTab(this.view.layout, id));
  }

  /** `PanelHandle.show()`: expands its pane and itself, chooses its tab, and asks the View to scroll it into view. */
  showPanel(id: string): void {
    if (!this.view.panels.some((p) => p.id === id)) return;
    this.update({ layout: layouts.showPanel(this.view.layout, this.view.panels, id), reveal: { id, n: (this.view.reveal?.n ?? 0) + 1 } });
  }

  /**
   * A layout from a setup, as it was saved; the panels it names that are not registered find their
   * place when they are. For another workspace than the one shown, it is kept for when it is shown.
   */
  restoreLayout(layout: Layout, workspace: string = this.view.workspace): void {
    if (workspace === this.view.workspace) this.setLayout(layout);
    else this.layouts.set(workspace, layout);
  }

  addTopBarItem(pluginId: string, item: TopBarItem): Unsubscribe {
    const seq = ++this.seq;
    const key = `${pluginId}/${item.id}/${String(seq)}`;
    this.update({ topBarItems: [...this.view.topBarItems, { key, pluginId, item, seq }].sort((a, b) => byOrder(a.item, a.seq, b.item, b.seq)) });
    return () => { this.update({ topBarItems: this.view.topBarItems.filter((t) => t.key !== key) }); };
  }

  /** A plugin's own settings panel; a second one replaces the first. The undo brings the generated form back. */
  setSettingsPanel(pluginId: string, panel: SettingsPanel): Unsubscribe {
    const key = `${pluginId}/settings/${String(++this.seq)}`;
    const others = this.view.settingsPanels.filter((p) => p.pluginId !== pluginId);
    this.update({ settingsPanels: [...others, { key, pluginId, panel, unsaved: false, failed: null }] });
    return () => {
      if (this.view.settingsPanels.some((p) => p.key === key)) this.update({ settingsPanels: this.view.settingsPanels.filter((p) => p.key !== key) });
    };
  }

  /** The panel `key` says whether it holds unsaved changes. */
  markSettingsPanelUnsaved(key: string, unsaved: boolean): void {
    this.changeSettingsPanel(key, (p) => (p.unsaved === unsaved ? p : { ...p, unsaved }));
  }

  /** The panel `key` failed while rendering: its entry shows the generated form, and it holds nothing unsaved. */
  settingsPanelFailed(key: string, message: string): void {
    this.changeSettingsPanel(key, (p) => (p.failed !== null ? p : { ...p, failed: message, unsaved: false }));
  }

  private changeSettingsPanel(key: string, change: (panel: SettingsPanelEntry) => SettingsPanelEntry): void {
    const panels = this.view.settingsPanels;
    const at = panels.findIndex((p) => p.key === key);
    const before = panels[at];
    if (before === undefined) return;
    const after = change(before);
    if (after !== before) this.update({ settingsPanels: panels.map((p) => (p === before ? after : p)) });
  }

  /** The time control's new state (ADR-0045), at a release, Now, the toggle or a picker. */
  setTime(time: TimeChoice): void {
    this.update({ time });
  }

  setClock(clock: ClockMode): void {
    if (clock !== this.view.clock) this.update({ clock });
  }

  setLook(look: LookChoice): void {
    const now = this.view.look;
    if (look.look !== now.look || look.scheme !== now.scheme || look.density !== now.density) this.update({ look });
  }

  setInstallationLook(installationLook: Look): void {
    if (installationLook !== this.view.installationLook) this.update({ installationLook });
  }

  addOverlay(pluginId: string, overlay: MapPaneOverlay): Unsubscribe {
    const seq = ++this.seq;
    const key = `${pluginId}/${overlay.id}/${String(seq)}`;
    this.allOverlays = [...this.allOverlays, { key, pluginId, overlay, seq }].sort((a, b) => byOrder(a.overlay, a.seq, b.overlay, b.seq));
    this.update({ overlays: this.shownOverlays() });
    return () => {
      this.allOverlays = this.allOverlays.filter((o) => o.key !== key);
      this.update({ overlays: this.shownOverlays() });
    };
  }

  setMapView(pluginId: string, view: MapViewMount | null): void {
    this.update({ mapView: view === null ? null : { pluginId, view } });
  }

  /** Removes everything a plugin put on the screen (it failed or was disabled). */
  removeUiOf(pluginId: string): void {
    this.allPanels = this.allPanels.filter((p) => p.pluginId !== pluginId);
    this.allOverlays = this.allOverlays.filter((o) => o.pluginId !== pluginId);
    this.update({
      panels: this.shownPanels(),
      topBarItems: this.view.topBarItems.filter((t) => t.pluginId !== pluginId),
      settingsPanels: this.view.settingsPanels.filter((p) => p.pluginId !== pluginId),
      overlays: this.shownOverlays(),
      mapView: this.view.mapView?.pluginId === pluginId ? null : this.view.mapView,
    });
  }

  /**
   * Shows a notification; returns its id, for {@link updateNotification}. `sticky`: it stays until
   * dismissed or updated, also as info (e.g. a Delete's progress).
   */
  notify(pluginId: string | null, notification: Notification, options: { readonly sticky?: boolean } = {}): number {
    const item: NotificationItem = { id: ++this.seq, pluginId, severity: notification.severity, message: notification.message };
    this.update({ notifications: [...this.view.notifications, item].slice(-MAX_NOTIFICATIONS) });
    this.expireLater(item, options.sticky === true);
    return item.id;
  }

  /** Changes a notification in place; one the user dismissed meanwhile comes back, so that the end of what it reports is seen. */
  updateNotification(id: number, notification: Notification, options: { readonly sticky?: boolean } = {}): void {
    const old = this.view.notifications.find((n) => n.id === id);
    const item: NotificationItem = { id, pluginId: old?.pluginId ?? null, severity: notification.severity, message: notification.message };
    this.update({
      notifications: old === undefined
        ? [...this.view.notifications, item].slice(-MAX_NOTIFICATIONS)
        : this.view.notifications.map((n) => (n.id === id ? item : n)),
    });
    this.expireLater(item, options.sticky === true);
  }

  /** Info disappears after {@link INFO_LIFETIME_MS}, unless it is sticky by then. */
  private expireLater(item: NotificationItem, sticky: boolean): void {
    if (sticky) {
      this.sticky.add(item.id);
      return;
    }
    this.sticky.delete(item.id);
    if (item.severity === 'info') setTimeout(() => { if (!this.sticky.has(item.id)) this.dismiss(item.id); }, INFO_LIFETIME_MS);
  }

  dismiss(id: number): void {
    this.sticky.delete(id);
    if (this.view.notifications.some((n) => n.id === id)) {
      this.update({ notifications: this.view.notifications.filter((n) => n.id !== id) });
    }
  }

  setLive(live: LiveState): void {
    this.update({ live });
  }

  setLogin(login: LoginInfo): void {
    this.update({ login });
  }

  setTab(tab: string): void {
    if (tab !== this.view.tab) this.update({ tab });
  }

  setSettingsEntry(entry: string | null): void {
    if (entry !== this.view.settingsEntry) this.update({ settingsEntry: entry });
  }

  setSetupProblem(problem: string | null): void {
    if (problem !== this.view.setupProblem) this.update({ setupProblem: problem });
  }

  setFatal(message: string): void {
    this.update({ fatal: message });
  }

  private setLayout(layout: Layout): void {
    if (layout !== this.view.layout) this.update({ layout });
  }

  private updatePlugin(pluginId: string, change: (row: PluginRow) => PluginRow): void {
    this.update({ plugins: this.view.plugins.map((p) => (p.id === pluginId ? change(p) : p)) });
  }

  private update(change: Partial<ShellView>): void {
    this.view = { ...this.view, ...change };
    for (const listener of [...this.listeners]) listener();
  }
}
