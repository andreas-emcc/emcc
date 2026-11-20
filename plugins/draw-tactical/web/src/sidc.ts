// The SIDC of a graphic from the user's choices, and the choices of an existing SIDC, always through
// the SymbolService (symbology is the only place that understands SIDCs, ADR-0010; brief, function 3).
import { canonicalSidc } from '@emc2/plugin-sdk';
import type { GraphicCatalogEntry, SidcParts, SymbolService } from '@emc2/plugin-sdk';
import type { GraphicStandard } from './graphics.ts';

/** The four standard identities the plugin offers (brief, function 1), by the names the setting uses. */
export const IDENTITY_NAMES = ['Friend', 'Hostile', 'Neutral', 'Unknown'] as const;
export type IdentityName = (typeof IDENTITY_NAMES)[number];

/** The SIDC code of each: friend 3, hostile 6, neutral 4, unknown 1. */
export const IDENTITY_CODES: Readonly<Record<IdentityName, string>> = { Friend: '3', Hostile: '6', Neutral: '4', Unknown: '1' };

/** The status of a graphic: present is drawn solid, planned dashed (APP-6). */
export const STATUSES = [
  { code: '0', label: 'Present' },
  { code: '1', label: 'Planned' },
] as const;
export const PRESENT = '0';

/** No echelon: SIDC positions 9 and 10 of a graphic without one. */
export const NO_ECHELON = '00';

/** What the user chooses besides the graphic itself; they go into the SIDC. */
export interface SidcChoice {
  readonly standard: GraphicStandard;
  readonly standardIdentity: string;
  readonly status: string;
  readonly echelon: string;
}

/** The SIDC (canonical form) of a graphic with a choice; the echelon counts only for a graphic that shows one. */
export function composeSidc(symbols: SymbolService, entry: GraphicCatalogEntry, choice: SidcChoice): string {
  const sidc = symbols.compose({
    standard: choice.standard,
    standardIdentity: choice.standardIdentity,
    symbolSet: entry.symbolSet,
    status: choice.status,
    hqTaskForceDummy: '0',
    echelonMobility: entry.echelon ? choice.echelon : NO_ECHELON,
    entity: entry.entity,
  });
  return canonicalSidc(choice.standard, sidc);
}

/** The parts of a graphic's SIDC, or null if the service cannot describe it. */
export function partsOfSidc(symbols: SymbolService, standard: GraphicStandard, sidc: string): SidcParts | null {
  try {
    return symbols.describe(standard, sidc);
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

/** The SIDC with some parts changed (the identity, the status or the echelon), or null if its parts cannot be told. */
export function withParts(
  symbols: SymbolService,
  standard: GraphicStandard,
  sidc: string,
  change: Partial<Pick<SidcParts, 'standardIdentity' | 'status' | 'echelonMobility'>>,
): string | null {
  const parts = partsOfSidc(symbols, standard, sidc);
  return parts === null ? null : canonicalSidc(standard, symbols.compose({ ...parts, ...change }));
}

/** The identities of the service's catalogue that the plugin offers, with the service's names, and `current` if it is another one. */
export function identityOptions(symbols: SymbolService, current?: string): readonly { readonly code: string; readonly name: string }[] {
  const all = symbols.catalog().standardIdentities;
  const offered = new Set<string>(Object.values(IDENTITY_CODES));
  const options = all.filter((i) => offered.has(i.code) || i.code === current);
  return options.length > 0 ? options : all;
}

/** The code of an identity name from the setting; friend if the service has none by that name. */
export function identityCodeOf(name: string): string {
  return (IDENTITY_NAMES as readonly string[]).includes(name) ? IDENTITY_CODES[name as IdentityName] : IDENTITY_CODES.Friend;
}
