// The picker shows the catalog one category at a time (brief, function 1, M4). A category is a symbol set
// of the catalog (`CatalogEntry.symbolSet`); the catalog has no names for them, so this plugin keeps the names.
import type { CatalogEntry } from '@emc2/plugin-sdk';

/** The names of the symbol sets in the catalog (APP-6D and APP-6E, symbol set codes). */
const NAMES = new Map<string, string>([
  ['10', 'Land unit'],
  ['15', 'Land equipment'],
  ['20', 'Land installation'],
  ['01', 'Air'],
  ['02', 'Air missile'],
  ['05', 'Space'],
  ['30', 'Sea surface'],
  ['35', 'Sea subsurface'],
  ['36', 'Mine warfare'],
  ['50', 'Signals intelligence, space'],
  ['51', 'Signals intelligence, air'],
  ['52', 'Signals intelligence, land'],
  ['53', 'Signals intelligence, sea surface'],
  ['54', 'Signals intelligence, subsurface'],
]);

/** The category of vessel symbols (SDK 1.4.0, brief function 28): after the symbol sets, there when the symbol service has `vesselGroups()`. */
export const VESSELS = 'vessels';
export const VESSELS_NAME = 'Vessels';

/** The category's name; a symbol set without one is listed by its code. */
export const categoryName = (symbolSet: string): string => NAMES.get(symbolSet) ?? symbolSet;

export interface Category {
  readonly code: string;
  readonly name: string;
  readonly entries: readonly CatalogEntry[];
}

/** The categories of a catalog, in the order the catalog first mentions their symbol sets. */
export function categoriesOf(entities: readonly CatalogEntry[]): readonly Category[] {
  const sets = new Map<string, CatalogEntry[]>();
  for (const entry of entities) {
    const entries = sets.get(entry.symbolSet);
    if (entries === undefined) sets.set(entry.symbolSet, [entry]);
    else entries.push(entry);
  }
  return [...sets].map(([code, entries]) => ({ code, name: categoryName(code), entries }));
}

/** Land units, the only symbol set whose digits 9 and 10 are the echelon (the other sets use them for other things). */
const ECHELON_SET = '10';

/** The echelon digits of a symbol without an echelon. */
export const NO_ECHELON = '00';

/** Whether the echelon applies to symbols of this symbol set. */
export const usesEchelon = (symbolSet: string): boolean => symbolSet === ECHELON_SET;
