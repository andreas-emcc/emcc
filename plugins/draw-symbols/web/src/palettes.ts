// Symbol palettes in the Symbols panel (brief, function 31; SDK 1.6.0, CR-0041 part G): the symbols other plugins declare in their manifests
// (`ctx.symbolPalettes`), shown beside the catalogue. A palette symbol is a whole code with its standard and an optional label.
import type { MilSymbol, PaletteSymbol, SymbolPalette, SymbolService, UserDocuments } from '@emc2/plugin-sdk';
import { usesEchelon } from './categories.ts';
import { partsOf, withParts } from './symbolParts.ts';

/** The drop-down's first choice, the catalogue as before. */
export const GENERAL_SYMBOLS = '';
export const GENERAL_SYMBOLS_NAME = 'General symbols';

/** The echelon choice that leaves a palette symbol's own echelon alone (the other choices set it on land units, as for a catalogue entry). */
export const OWN_ECHELON = '';

/** One symbol of a palette as the panel shows it, with the panel's identity and echelon applied (P1). */
export interface PaletteEntry {
  readonly key: string;
  /** The symbol's label, else the catalogue's name for its code, else the code. */
  readonly label: string;
  readonly standard: PaletteSymbol['standard'];
  readonly sidc: string;
  /** Why the symbol service refuses the code (P3), or null. A refused code is shown with the error frame and cannot be placed. */
  readonly problem: string | null;
}

const milSymbol = (symbol: PaletteSymbol): MilSymbol => ({ standard: symbol.standard, sidc: symbol.code });

/** The catalogue's name for a code of APP-6D or APP-6E, or null if it has none (APP-6B, or a code the catalogue does not list). */
function catalogueName(symbols: SymbolService, symbol: PaletteSymbol): string | null {
  const parts = partsOf(symbols, milSymbol(symbol));
  if (parts === null) return null;
  return symbols.catalog().entities.find((e) => e.symbolSet === parts.symbolSet && e.entity === parts.entity)?.name ?? null;
}

/**
 * The code with the panel's standard identity (and, unless it is {@link OWN_ECHELON}, echelon, on land units) set. A code that already has them,
 * APP-6B, or one the service cannot describe or compose is left exactly as the palette has it: composing writes the defaults for the digits
 * `SidcParts` does not carry (README, known limits).
 */
function applied(symbols: SymbolService, symbol: PaletteSymbol, identity: string, echelon: string): string {
  const parts = partsOf(symbols, milSymbol(symbol));
  if (parts === null) return symbol.code;
  const setEchelon = echelon !== OWN_ECHELON && usesEchelon(parts.symbolSet) && echelon !== parts.echelonMobility;
  const setIdentity = identity !== '' && identity !== parts.standardIdentity;
  if (!setEchelon && !setIdentity) return symbol.code;
  try {
    return withParts(symbols, milSymbol(symbol), { ...(setIdentity ? { standardIdentity: identity } : {}), ...(setEchelon ? { echelonMobility: echelon } : {}) }) ?? symbol.code;
  } catch {
    return symbol.code;
  }
}

/** The symbols of a palette that match `search` (a part of the label, any case), in the palette's order. */
export function paletteEntries(symbols: SymbolService, palette: SymbolPalette, identity: string, echelon: string, search: string): readonly PaletteEntry[] {
  const needle = search.trim().toLowerCase();
  const entries = palette.symbols.map((symbol, index): PaletteEntry => {
    const sidc = applied(symbols, symbol, identity, echelon);
    const check = symbols.validate(symbol.standard, sidc);
    return {
      key: `${palette.id}:${String(index)}`,
      label: symbol.label ?? catalogueName(symbols, symbol) ?? symbol.code,
      standard: symbol.standard,
      sidc,
      problem: check.valid ? null : (check.problem ?? `Not a valid ${symbol.standard} code.`),
    };
  });
  return needle === '' ? entries : entries.filter((e) => e.label.toLowerCase().includes(needle));
}

/** The user's document that keeps the chosen palette (P2); one per user, in this plugin's namespace. */
const DOCUMENT = 'symbol-palette';

/**
 * The kept palette's id (empty for the general symbols), or null if none is kept or the document cannot be read. Never rejects.
 * The document is listed first and read only if it exists: reading one that does not answers 404, a console error on every page of a fresh user.
 */
export async function readKeptPalette(documents: UserDocuments): Promise<string | null> {
  try {
    if (!(await documents.list()).includes(DOCUMENT)) return null;
    const value = await documents.get(DOCUMENT);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
    const kept = (value as { readonly [key: string]: unknown })['palette'];
    return typeof kept === 'string' ? kept : null;
  } catch {
    return null;
  }
}

/** Keeps the choice; false if the document could not be written (the choice then lasts until the page is reloaded). Never rejects. */
export async function keepPalette(documents: UserDocuments, id: string): Promise<boolean> {
  try {
    await documents.put(DOCUMENT, { palette: id });
    return true;
  } catch {
    return false;
  }
}
