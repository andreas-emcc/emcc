import { TextField } from '@emc2/plugin-sdk';
import { useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { LayersEntry } from '../../layers/LayersEntry.tsx';
import type { ViewServices } from '../services.ts';
import type { ShellStore, ShellView } from '../store.ts';
import { hashOf, SETTINGS } from '../tabs.ts';
import { DisplayEntry } from './DisplayEntry.tsx';
import {
  DISPLAY, GENERAL, LABELING, LAYERS, settingsEntries, settingsGroups, shownEntry, unsavedCount, unsavedText, type SettingsEntry,
} from './entries.ts';
import { GeneralEntry } from './GeneralEntry.tsx';
import { LabelingEntry } from './labeling/LabelingEntry.tsx';
import { PluginSettingsView } from './PluginSettingsView.tsx';
import { SettingsView } from './SettingsView.tsx';

const entryTabId = (entry: SettingsEntry) => `settings-entry-${entry.id.replace(/[^A-Za-z0-9-]/g, '-')}`;
const ENTRY_PANEL = 'settings-entry';

/**
 * The Settings tab (ADR-0031 point 2): the list of entries on the left, the chosen one on the right.
 * The list is a vertical tab list (WAI-ARIA tabs pattern: one tab stop, Up and Down, Home and End,
 * each choosing its entry at once), and marks every entry with unsaved edits. The entry is kept in
 * the address (`#settings/<entry>`); unsaved edits stay with their entry while another is shown.
 *
 * SDK 1.6.0 (T-174): the entries stand under their category's heading. The headings are not tabs:
 * the keys move over the entries only, and each tab is described by its heading.
 */
export function SettingsTab({ view, store, services }: { readonly view: ShellView; readonly store: ShellStore; readonly services: ViewServices }) {
  const declared = useSyncExternalStore(services.shared.onDeclaredFields, () => services.shared.declaredFields);
  const entries = settingsEntries(view.plugins, new Set(declared.map((f) => f.plugin)));
  const shown = shownEntry(view.settingsEntry, entries);
  const drafts = services.drafts;
  const draftKeys = useSyncExternalStore(drafts.subscribe, () => drafts.keys());
  const list = useRef<HTMLDivElement>(null);
  // T-203 part C (findings S5): a filter over the entries' names; the keys move over what is shown
  const [filter, setFilter] = useState('');
  const words = filter.trim().toLowerCase();
  const listed = entries.filter((e) => words === '' || e.label.toLowerCase().includes(words));
  const choose = (entry: SettingsEntry) => {
    store.setSettingsEntry(entry.id);
    const hash = hashOf({ tab: SETTINGS, entry: entry.id });
    if (window.location.hash !== hash) window.history.replaceState(null, '', hash);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (listed.length === 0) return;
    const at = listed.indexOf(shown);
    const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: listed.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const entry = listed[(next + listed.length) % listed.length] ?? shown;
    choose(entry);
    list.current?.querySelector<HTMLElement>(`#${entryTabId(entry)}`)?.focus();
  };
  return (
    <div className="settings-layout">
      <div className="settings-list-card">
      <TextField label="Filter" value={filter} onChange={setFilter} placeholder="Find a setting" />
      <div ref={list} role="tablist" aria-label="Settings" aria-orientation="vertical" className="settings-list">
        {listed.length === 0 && <p className="muted">No setting matches.</p>}
        {settingsGroups(listed).map((group) => [
          <div key={`heading-${group.category}`} id={`settings-category-${group.category}`} role="presentation" className="settings-list-heading">
            {group.label}
          </div>,
          ...group.entries.map((entry) => {
          const count = unsavedCount(entry, draftKeys, (key) => drafts.count(key));
          const panelUnsaved = entry.pluginId !== null && view.settingsPanels.some((p) => p.pluginId === entry.pluginId && p.unsaved);
          const Icon = entry.icon;
          // A tab that is filtered out while chosen: the first shown one is the tab stop
          const stop = listed.includes(shown) ? entry === shown : entry === listed[0];
          return (
            <button
              aria-describedby={`settings-category-${group.category}`}
              key={entry.id}
              id={entryTabId(entry)}
              type="button"
              role="tab"
              aria-selected={entry === shown}
              aria-controls={entry === shown ? ENTRY_PANEL : undefined}
              tabIndex={stop ? 0 : -1}
              className={entry === shown ? 'settings-list-entry selected' : 'settings-list-entry'}
              onClick={() => { choose(entry); }}
              onKeyDown={onKeyDown}
            >
              <Icon className="emc2-icon settings-list-icon" aria-hidden="true" />
              <span className="settings-list-label" title={entry.label}>{entry.label}</span>
              {/* T-203 part C: the count of unsaved changes, not a bare dot; a plugin's own panel only says it has some */}
              {(count > 0 || panelUnsaved) && (
                <>
                  <span className="unsaved-count" aria-hidden="true">{count > 0 ? count : 'edited'}</span>
                  <span className="visually-hidden">, {count > 0 ? unsavedText(count) : 'unsaved changes'}</span>
                </>
              )}
            </button>
          );
          }),
        ])}
      </div>
      </div>
      <section id={ENTRY_PANEL} role="tabpanel" aria-labelledby={entryTabId(shown)} className="settings-entry settings-entry-card">
        {shown.id === GENERAL && <GeneralEntry store={store} services={services} installationLook={view.installationLook} />}
        {shown.id === DISPLAY && <DisplayEntry api={services.api} display={services.display?.() ?? null} />}
      {shown.id === LAYERS && (services.layers === undefined
          ? <p className="muted">The layers are not available here.</p>
          : <LayersEntry layers={services.layers.known} changer={services.layers.changer} retry={view.plugins} workspaces={view.workspaces} />)}
        {shown.id === LABELING && (services.labeling === undefined
          ? <p className="muted">The labeling settings are not available here.</p>
          : <LabelingEntry api={services.api} drafts={services.drafts} source={services.labeling} />)}
        {shown.id !== LAYERS && shown.id !== GENERAL && shown.id !== DISPLAY && shown.id !== LABELING && (shown.pluginId === null
          ? <SettingsView services={services} plugins={view.plugins} />
          : (
            <>
              <h2>{shown.label}</h2>
              <PluginSettingsView
                key={shown.pluginId} pluginId={shown.pluginId} services={services} store={store}
                computeThreads={view.plugins.find((p) => p.id === shown.pluginId)?.computeThreads ?? 0}
                hasSettings={view.plugins.find((p) => p.id === shown.pluginId)?.hasSettings ?? true}
                panel={view.settingsPanels.find((p) => p.pluginId === shown.pluginId)}
              />
            </>
          ))}
      </section>
    </div>
  );
}
