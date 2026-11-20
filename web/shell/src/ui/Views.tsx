import { MonitorView } from './monitor/MonitorView.tsx';
import type { ViewServices } from './services.ts';
import { SettingsTab } from './settings/SettingsTab.tsx';
import type { ShellStore, ShellView } from './store.ts';
import { MONITOR, panelId, SETTINGS, tabId, tabLabel, type Tab } from './tabs.ts';

/**
 * The views besides View (ADR-0031 point 1): Settings (the list of the general settings and every
 * plugin's settings, `SettingsTab`) and Monitor (the live health of the core and the plugins).
 */
export function OtherView({ tab, view, store, services }: {
  readonly tab: Tab; readonly view: ShellView; readonly store: ShellStore; readonly services: ViewServices;
}) {
  let content;
  if (tab === SETTINGS) content = <SettingsTab view={view} store={store} services={services} />;
  else if (tab === MONITOR) content = <MonitorView services={services} plugins={view.plugins} />;
  return (
    <section className="other-view" role="tabpanel" id={panelId(tab)} aria-labelledby={tabId(tab)}>
      <h1>{tabLabel(tab)}</h1>
      {content}
    </section>
  );
}
