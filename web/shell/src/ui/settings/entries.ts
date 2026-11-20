/**
 * The entries of the Settings list (ADR-0031 point 2): General (the default look, T-052), Display
 * (the users' display defaults, ADR-0052 point 5), Data types, Layers, Labeling (the premade security labels, T-170), and one per
 * running plugin whose settings can change at runtime.
 *
 * SDK 1.6.0 (T-174; CR-0041 part F): grouped by category in `PLUGIN_CATEGORIES`' order, the plugins
 * by name within each; the shell's own entries are General, first in it in the order above (owner,
 * 2026-11-12). The list keeps that order, so the arrow keys follow it; `settingsGroups` gives the
 * headings, without the empty categories.
 *
 * An entry's id is also its address after `#settings/` and the key of its unsaved edits: `general`
 * (none), `display` (none), `data-types`
 * (the drafts `data-type/<id>`), `layers` (none: a change applies at once), `labeling` (the draft `labeling`), `plugin/<id>` (the draft
 * `plugin/<id>`, and its list items' drafts `plugin/<id>#/<list>/<row>`, T-203 part D).
 */
import { pluginIcon, type IconComponent } from '@emc2/plugin-sdk';
import { Layers, PanelTop, Settings, Shapes, SlidersHorizontal, Tag } from 'lucide-react';
import { DEFAULT_PLUGIN_CATEGORY, PLUGIN_CATEGORIES, type PluginCategory } from '@emc2/plugin-sdk';
import type { PluginRow } from '../store.ts';

export const GENERAL = 'general';
export const DISPLAY = 'display';
export const DATA_TYPES = 'data-types';
export const LAYERS = 'layers';
export const LABELING = 'labeling';

export interface SettingsEntry {
  readonly id: string;
  readonly label: string;
  /** The plugin, for a plugin's entry. */
  readonly pluginId: string | null;
  /** SDK 1.6.0: its category; the shell's own entries are General. */
  readonly category: PluginCategory;
  /** T-203 part C (findings S5): its icon; a plugin's from its manifest (`pluginIcon`), else the neutral one. */
  readonly icon: IconComponent;
}

/** A heading of the Settings list with its entries, in the list's order. */
export interface SettingsGroup {
  readonly category: PluginCategory;
  readonly label: string;
  readonly entries: readonly SettingsEntry[];
}

export function settingsEntries(plugins: readonly PluginRow[], withFields: ReadonlySet<string> = new Set()): readonly SettingsEntry[] {
  const own = plugins.filter((p) => (p.hasSettings || withFields.has(p.id) || (p.computeThreads ?? 0) > 0) && p.server.active)
    .map((p): SettingsEntry => ({
      id: `plugin/${p.id}`, label: p.name, pluginId: p.id, category: p.category ?? DEFAULT_PLUGIN_CATEGORY, icon: pluginIcon(p.icon) ?? PanelTop,
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || (a.pluginId ?? '').localeCompare(b.pluginId ?? ''));
  const shells: readonly SettingsEntry[] = ([
    [GENERAL, 'General', Settings], [DISPLAY, 'Display', SlidersHorizontal], [DATA_TYPES, 'Data types', Shapes], [LAYERS, 'Layers', Layers],
    [LABELING, 'Labeling', Tag],
  ] as const).map(([id, label, icon]) => ({ id, label, pluginId: null, category: DEFAULT_PLUGIN_CATEGORY, icon }));
  return PLUGIN_CATEGORIES.flatMap(({ id }) => [
    ...(id === DEFAULT_PLUGIN_CATEGORY ? shells : []), ...own.filter((e) => e.category === id),
  ]);
}

/** The list's headings, in the categories' order, each with its entries; an empty category is left out. */
export function settingsGroups(entries: readonly SettingsEntry[]): readonly SettingsGroup[] {
  return PLUGIN_CATEGORIES.map((c) => ({ category: c.id, label: c.label, entries: entries.filter((e) => e.category === c.id) }))
    .filter((g) => g.entries.length > 0);
}

/** The entry shown: the chosen one if it is in the list, else General. */
export function shownEntry(chosen: string | null, entries: readonly SettingsEntry[]): SettingsEntry {
  const general = entries.find((e) => e.id === GENERAL);
  if (general === undefined) throw new Error('the Settings list always has General');
  return entries.find((e) => e.id === chosen) ?? general;
}

/** T-203 part C: how many values the entry's drafts change, given the keys of all drafts and each one's count. */
export function unsavedCount(entry: SettingsEntry, draftKeys: readonly string[], count: (key: string) => number): number {
  return draftKeys.filter((k) => ofEntry(entry, k)).reduce((n, k) => n + count(k), 0);
}

/** True if the entry has unsaved edits, given the keys of all drafts. */
export function hasUnsaved(entry: SettingsEntry, draftKeys: readonly string[]): boolean {
  return draftKeys.some((k) => ofEntry(entry, k));
}

/** Whether a draft is the entry's: its own, or one of its list items' (`plugin/<id>#/links/<row>`, T-203 part D). */
function ofEntry(entry: SettingsEntry, key: string): boolean {
  return entry.id === DATA_TYPES ? key.startsWith('data-type/') : key === entry.id || key.startsWith(`${entry.id}#`);
}

/** T-203 part C: "1 unsaved change", "3 unsaved changes". */
export function unsavedText(count: number): string {
  return `${String(count)} unsaved ${count === 1 ? 'change' : 'changes'}`;
}
