/**
 * The plugins' own settings panels (SDK 1.3.0, CR-0023, ADR-0035; T-073), shown instead of the
 * generated form in the plugin's entry of the Settings list.
 *
 * The SDK keeps a panel mounted as long as the page lives, so that its unsaved values survive
 * switching entries and tabs, as the form's drafts do. The Settings tab is unmounted while another
 * tab is shown, so the panels do not live there: {@link SettingsPanelHost}, always mounted beside the
 * views, renders each one into an element of its own (a portal), and the entry shows that element
 * ({@link SettingsPanelSlot}) while it is chosen. Only for a user with `settings.admin`: for anyone
 * else no panel is mounted at all.
 *
 * A panel that fails while rendering makes its plugin DEGRADED, and its entry shows the generated
 * form instead (owner, 2026-10-30).
 */
import type { Settings, SettingsPanelProps, SettingsSaveResult } from '@emc2/plugin-sdk';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { ErrorBoundary } from '../ErrorBoundary.tsx';
import type { ViewServices } from '../services.ts';
import type { SettingsPanelEntry, ShellStore, ShellView } from '../store.ts';
import { isAdmin } from '../tabs.ts';

/** Each store's panel elements, by the panel's key: the host renders into them, the entry shows them. */
const elements = new WeakMap<ShellStore, Map<string, HTMLElement>>();

function elementFor(store: ShellStore, key: string): HTMLElement {
  const known = elements.get(store) ?? new Map<string, HTMLElement>();
  elements.set(store, known);
  let element = known.get(key);
  if (element === undefined) {
    element = document.createElement('div');
    element.className = 'settings-panel';
    known.set(key, element);
  }
  return element;
}

/** Renders every plugin's settings panel, each into its own element; mounted for the page's life. */
export function SettingsPanelHost({ view, store, services }: { readonly view: ShellView; readonly store: ShellStore; readonly services: ViewServices }) {
  const admin = isAdmin(view.login);
  // The elements of panels gone (replaced, undone, their plugin fenced) are dropped.
  const keys = view.settingsPanels.map((p) => p.key).join('\n');
  useEffect(() => {
    const known = elements.get(store);
    const live = new Set(keys.split('\n'));
    for (const key of [...(known?.keys() ?? [])]) if (!live.has(key)) known?.delete(key);
  }, [store, keys]);
  if (!admin) return null;
  return (
    <>
      {view.settingsPanels.filter((p) => p.failed === null).map((entry) => createPortal(
        <ErrorBoundary
          name={`The settings panel of ${entry.pluginId}`}
          onError={(error) => {
            store.observe(entry.pluginId, { state: 'DEGRADED', detail: `settings panel failed: ${error.message}` });
            store.settingsPanelFailed(entry.key, error.message);
          }}
        >
          <PanelRunner entry={entry} store={store} services={services} />
        </ErrorBoundary>,
        elementFor(store, entry.key),
        entry.key,
      ))}
    </>
  );
}

/** One panel with its props: the saved values as `ctx.settings` has them, save, and the unsaved mark. */
function PanelRunner({ entry, store, services }: { readonly entry: SettingsPanelEntry; readonly store: ShellStore; readonly services: ViewServices }) {
  const { pluginId, key } = entry;
  const subscribe = useCallback((changed: () => void) => services.shared.onSettings(pluginId, changed), [pluginId, services]);
  const values = useSyncExternalStore(subscribe, () => services.shared.settingsOf(pluginId));
  const props = useMemo((): Omit<SettingsPanelProps, 'values'> => ({
    async save(next: Settings): Promise<SettingsSaveResult> {
      const answer = await services.api.savePlugin(pluginId, next);
      if (answer.ok) return { ok: true, values: answer.value };
      // The server checked the values: its problems. Anything else (no answer, a refused permission) rejects.
      if (answer.invalid === true) return { ok: false, problems: answer.problems };
      throw new Error(answer.message);
    },
    markUnsaved(unsaved: boolean) {
      store.markSettingsPanelUnsaved(key, unsaved);
    },
  }), [pluginId, key, services, store]);
  const Panel = entry.panel.component;
  return <Panel values={values} {...props} />;
}

/** The chosen entry's place for its plugin's panel: the panel's element, moved in while it is shown. */
export function SettingsPanelSlot({ entry, store }: { readonly entry: SettingsPanelEntry; readonly store: ShellStore }) {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = elementFor(store, entry.key);
    slot.current?.appendChild(element);
    return () => { element.remove(); };
  }, [store, entry.key]);
  return <div ref={slot} className="settings-panel-slot" />;
}
