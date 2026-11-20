/**
 * The top bar's view tabs (ADR-0031 point 1; ADR-0039 point 2): View, the workspaces the plugins
 * declare that the user may see, Settings and Monitor. Settings and Monitor need `settings.admin`
 * (the server checks it again on every settings and monitor request); in the no-login mode the
 * local user has every permission (ADR-0022). The Settings tab is a list of entries (ADR-0031
 * point 2, `settings/entries.ts`); one per plugin replaces M1's tab per plugin.
 *
 * The tab and the Settings entry are kept in the page's address, so a reload or a shared link opens
 * them again: `#workspace/<id>` (owner, 2026-10-27), `#settings`, `#settings/data-types`,
 * `#settings/plugin/<id>`, `#monitor`. An address of M1's plugin tabs (`#plugin/<id>`) opens that
 * plugin's entry. A workspace the user may not see, or that no plugin declares, opens View.
 */
import { PERMISSIONS, VIEW_WORKSPACE, type WorkspaceInfo } from '@emc2/plugin-sdk';
import type { LoginInfo } from './store.ts';

/** `view`, `workspace/<id>`, `settings` or `monitor`. */
export type Tab = string;

export const VIEW: Tab = 'view';
export const SETTINGS: Tab = 'settings';
export const MONITOR: Tab = 'monitor';

/** Where the address leads: a tab, and in Settings the entry chosen (null: the first one). */
export interface Route {
  readonly tab: Tab;
  readonly entry: string | null;
}

const PLUGIN = 'plugin/';
const OLD_PLUGIN_TAB = /^plugin\/(.+)$/;
const WORKSPACE = 'workspace/';

/** A workspace's tab: View's is {@link VIEW}, a declared one's `workspace/<id>`. */
export function workspaceTab(id: string): Tab {
  return id === VIEW_WORKSPACE ? VIEW : `${WORKSPACE}${id}`;
}

/** The workspace a tab shows, or null for Settings and Monitor. */
export function workspaceOfTab(tab: Tab): string | null {
  if (tab === VIEW) return VIEW_WORKSPACE;
  return tab.startsWith(WORKSPACE) && tab.length > WORKSPACE.length ? tab.slice(WORKSPACE.length) : null;
}

/** The plugin a Settings entry or a draft belongs to (`plugin/<id>`), or null. */
export function pluginOf(key: string): string | null {
  return key.startsWith(PLUGIN) && key.length > PLUGIN.length ? key.slice(PLUGIN.length) : null;
}

/** True if the logged-in user may use the tabs besides View. */
export function isAdmin(login: LoginInfo | null): boolean {
  if (login === null || login.user === null) return false;
  return login.mode === 'none' || (login.user.permissions ?? []).includes(PERMISSIONS.settingsAdmin);
}

/**
 * The tabs this user sees, in the top bar's order: View, the other workspaces it may see (as
 * `/api/config` gives them, by their order), then Settings and Monitor for an admin.
 */
export function tabsFor(login: LoginInfo | null, workspaces: readonly WorkspaceInfo[] = []): readonly Tab[] {
  const declared = workspaces.filter((w) => w.id !== VIEW_WORKSPACE).map((w) => workspaceTab(w.id));
  return isAdmin(login) ? [VIEW, ...declared, SETTINGS, MONITOR] : [VIEW, ...declared];
}

/** The tab shown: the chosen one if this user sees it, else View. */
export function shownTab(chosen: Tab, login: LoginInfo | null, workspaces: readonly WorkspaceInfo[] = []): Tab {
  return tabsFor(login, workspaces).includes(chosen) ? chosen : VIEW;
}

/** Where an address leads; View for an empty, unknown or malformed one. */
export function routeFromHash(hash: string): Route {
  let name: string;
  try {
    name = decodeURIComponent(hash.replace(/^#/, ''));
  } catch {
    return { tab: VIEW, entry: null }; // a malformed address (e.g. "#%") must not stop the shell
  }
  if (name === MONITOR) return { tab: MONITOR, entry: null };
  if (workspaceOfTab(name) !== null) return { tab: name, entry: null };
  if (name === SETTINGS) return { tab: SETTINGS, entry: null };
  if (name.startsWith(`${SETTINGS}/`) && name.length > SETTINGS.length + 1) return { tab: SETTINGS, entry: name.slice(SETTINGS.length + 1) };
  const old = OLD_PLUGIN_TAB.exec(name);
  if (old !== null) return { tab: SETTINGS, entry: name };
  return { tab: VIEW, entry: null };
}

/** True for an address of M1's plugin tabs, which the shell replaces with its new one. */
export function isOldPluginAddress(hash: string): boolean {
  try {
    return OLD_PLUGIN_TAB.test(decodeURIComponent(hash.replace(/^#/, '')));
  } catch {
    return false;
  }
}

/** The address of a route: empty for View; the Settings entry after `settings/`. */
export function hashOf(route: Route): string {
  if (route.tab === VIEW) return '';
  if (route.tab === SETTINGS && route.entry !== null) return `#${SETTINGS}/${route.entry}`;
  return `#${route.tab}`;
}

/** The ids that tie a tab to its view (`aria-controls`, `aria-labelledby`). */
export const tabId = (tab: Tab): string => `tab-${tab.replace(/[^A-Za-z0-9-]/g, '-')}`;
export const panelId = (tab: Tab): string => `view-${tab.replace(/[^A-Za-z0-9-]/g, '-')}`;

/** A tab's name: a workspace's as declared. */
export function tabLabel(tab: Tab, workspaces: readonly WorkspaceInfo[] = []): string {
  if (tab === SETTINGS) return 'Settings';
  if (tab === MONITOR) return 'Monitor';
  const id = workspaceOfTab(tab);
  return id === null || id === VIEW_WORKSPACE ? 'View' : workspaces.find((w) => w.id === id)?.name ?? id;
}

/**
 * The address's query without Spring Security's `continue`, which the login's return adds ("/?continue"),
 * or null when there is none to drop (CDA's Keycloak check, 2026-10-14). Other parameters stay.
 */
export function withoutLoginReturn(search: string): string | null {
  // Raw segments, so that the other parameters stay exactly as written (review F2).
  const parts = search.replace(/^\?/, '').split('&').filter((p) => p !== '');
  const kept = parts.filter((p) => p !== 'continue' && !p.startsWith('continue='));
  if (kept.length === parts.length) return null;
  return kept.length === 0 ? '' : `?${kept.join('&')}`;
}
