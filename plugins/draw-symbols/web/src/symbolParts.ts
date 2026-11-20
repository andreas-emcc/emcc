// Turns the picker's choices and the parts of an existing SIDC into SIDCs, always through the
// SymbolService (symbology is the only place that understands SIDCs, ADR-0010).
import { canonicalSidc, parseVesselSidc, vesselSidc } from '@emc2/plugin-sdk';
import type { MilSymbol, SidcParts, SymbolService, VesselCode } from '@emc2/plugin-sdk';

/** The parts the user chooses; the others get the defaults of a new symbol. */
export interface Choice {
  readonly standardIdentity: string;
  readonly echelon: string;
  readonly symbolSet: string;
  readonly entity: string;
}

/** The SIDC (canonical form) of a catalog choice, for APP-6D or APP-6E. */
export function composeChoice(symbols: SymbolService, standard: 'APP-6D' | 'APP-6E', choice: Choice): string {
  const sidc = symbols.compose({
    standard,
    standardIdentity: choice.standardIdentity,
    symbolSet: choice.symbolSet,
    status: '0',
    hqTaskForceDummy: '0',
    echelonMobility: choice.echelon,
    entity: choice.entity,
  });
  return canonicalSidc(standard, sidc);
}

/** The parts of a symbol's SIDC, or null if it has none the service can describe (APP-6B and vessel symbols, or a SIDC that does not match). */
export function partsOf(symbols: SymbolService, symbol: MilSymbol): SidcParts | null {
  if (symbol.standard === 'APP-6B' || symbol.standard === 'vessel') return null;
  try {
    return symbols.describe(symbol.standard, symbol.sidc);
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

/**
 * The SIDC of a symbol with some parts changed, or null if its parts cannot be told. Known limit
 * (README): `SidcParts` has no field for the version, the context, the sector modifiers and
 * digits 21–30, so compose writes the defaults for them.
 */
export function withParts(
  symbols: SymbolService,
  symbol: MilSymbol,
  change: Partial<Pick<SidcParts, 'standardIdentity' | 'echelonMobility' | 'symbolSet' | 'entity'>>,
): string | null {
  const parts = partsOf(symbols, symbol);
  if (parts === null) return null;
  return canonicalSidc(symbol.standard, symbols.compose({ ...parts, ...change }));
}

/** The standard identity of the picker (APP-6D's digit) as a vessel code's identity, 0 to 6, or null if a vessel symbol has none like it. */
export function vesselIdentityOf(code: string): VesselCode['identity'] | null {
  return /^[0-6]$/.test(code) ? (Number(code) as VesselCode['identity']) : null;
}

/** The SIDC of a vessel of a ship type, in reality, for a picker identity; null if the identity is not one a vessel has (brief, function 28). */
export function composeVessel(identityCode: string, shipType: number): string | null {
  const identity = vesselIdentityOf(identityCode);
  return identity === null ? null : vesselSidc({ context: 0, identity, shipType });
}

/** The parts of a vessel symbol's code (context, identity, ship type), or null if the symbol is not a vessel or its code does not read. */
export function vesselOf(symbol: MilSymbol): VesselCode | null {
  return symbol.standard === 'vessel' ? parseVesselSidc(symbol.sidc) : null;
}

/** The SIDC of a vessel with its identity or ship type changed, or null if the symbol is not a vessel. */
export function withVessel(symbol: MilSymbol, change: Partial<Pick<VesselCode, 'identity' | 'shipType'>>): string | null {
  const code = vesselOf(symbol);
  return code === null ? null : vesselSidc({ ...code, ...change });
}
