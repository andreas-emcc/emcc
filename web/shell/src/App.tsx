import { useEffect, useSyncExternalStore } from 'react';
import { ActionMenuView } from './actions/ActionMenu.tsx';
import { listenForDeleteKey } from './actions/deleteKey.ts';
import { DeleteQuestion } from './actions/DeleteQuestion.tsx';
import { LayerMoveQuestion } from './actions/LayerMoveQuestion.tsx';
import { Notifications } from './ui/Notifications.tsx';
import type { ViewServices } from './ui/services.ts';
import type { ShellStore } from './ui/store.ts';
import { settingsEntries } from './ui/settings/entries.ts';
import { SettingsPanelHost } from './ui/settings/SettingsPanels.tsx';
import {
  hashOf, isOldPluginAddress, panelId, pluginOf, routeFromHash, SETTINGS, shownTab, tabId, tabLabel, tabsFor, VIEW, workspaceOfTab, workspaceTab,
} from './ui/tabs.ts';
import { TopBar } from './ui/TopBar.tsx';
import { OtherView } from './ui/Views.tsx';
import { Workspace } from './ui/Workspace.tsx';

/**
 * The shell layout (requirements, "View"; ADR-0031, ADR-0039): the top bar with its view tabs, then
 * the chosen view. View and each declared workspace show the Map Pane with the map view plugin and
 * the workspace's overlays, and the left, right and bottom panes with its panels (`Workspace`); one
 * workspace at a time, the one last chosen (`workspaces/switch.ts`). It stays in place under the
 * other views, so the map keeps its size and the plugins keep running; it is only hidden from sight
 * and focus. Leaving the page with unsaved settings asks first, also a plugin's own settings panel's
 * (`ui/settings/SettingsPanels.tsx`, mounted here for the page's life). Over everything: the shell's menu for
 * objects and the map, the shared Delete's question and Move and Copy to layer's (`actions/`).
 */
export function App({ store, services }: { readonly store: ShellStore; readonly services: ViewServices }) {
  const view = useSyncExternalStore(store.subscribe, store.getView);
  useEffect(() => {
    const follow = () => {
      const route = routeFromHash(window.location.hash);
      // M1's plugin tabs (#plugin/<id>) are entries of the Settings list now: their address too.
      if (isOldPluginAddress(window.location.hash)) window.history.replaceState(null, '', hashOf(route));
      store.setTab(route.tab);
      store.setSettingsEntry(route.entry);
    };
    follow();
    window.addEventListener('hashchange', follow);
    return () => { window.removeEventListener('hashchange', follow); };
  }, [store]);
  useEffect(() => {
    // A plugin's entry that is gone (the plugin list changed) takes its unsaved edits with it, and a
    // user who may no longer see Settings keeps none: leaving the page would ask about edits out of reach.
    if (view.login !== null && !tabsFor(view.login, view.workspaces).includes(SETTINGS)) {
      services.drafts.retain(() => false);
      return;
    }
    const entries = settingsEntries(view.plugins, new Set(services.shared.declaredFields.map((f) => f.plugin))).map((e) => e.id);
    // A list item's draft (`plugin/<id>#/links/<row>`, T-203 part D) goes with its entry
    services.drafts.retain((key) => pluginOf(key) === null || entries.includes(key.split('#')[0] ?? key));
  }, [view.login, view.workspaces, view.plugins, services]);
  useEffect(() => {
    const actions = services.actions;
    if (actions === undefined) return;
    return listenForDeleteKey({
      deleter: actions.deleter, menu: actions.menu, mapView: actions.mapView,
      inView: () => { const now = store.getView(); return workspaceOfTab(shownTab(now.tab, now.login, now.workspaces)) !== null; },
    });
  }, [services, store]);
  useEffect(() => {
    const ask = (event: BeforeUnloadEvent) => {
      if (services.drafts.any() || store.getView().settingsPanels.some((p) => p.unsaved)) event.preventDefault();
    };
    window.addEventListener('beforeunload', ask);
    return () => { window.removeEventListener('beforeunload', ask); };
  }, [services, store]);
  const tab = shownTab(view.tab, view.login, view.workspaces);
  const covered = workspaceOfTab(tab) === null;
  return (
    <div className="shell">
      <TopBar view={view} store={store} setups={services.setups} />
      <div className="views">
        <div
          className="view-map" role="tabpanel" id={panelId(VIEW)} aria-labelledby={tabId(workspaceTab(view.workspace))}
          aria-hidden={covered} inert={covered}
        >
          <h1 className="visually-hidden">{tabLabel(workspaceTab(view.workspace), view.workspaces)}</h1>
          <Workspace view={view} store={store} />
        </div>
        {covered && <OtherView tab={tab} view={view} store={store} services={services} />}
      </div>
      <Notifications view={view} store={store} />
      <SettingsPanelHost view={view} store={store} services={services} />
      {services.actions !== undefined && (
        <>
          <ActionMenuView menu={services.actions.menu} />
          <DeleteQuestion deleter={services.actions.deleter} />
          <LayerMoveQuestion mover={services.actions.mover} layers={services.actions.layers} />
        </>
      )}
    </div>
  );
}
