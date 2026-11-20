/**
 * SDK 1.6.0 (CR-0041 part G; T-156, the M7 plan's Q1 A, the ACA's note on ADR-0010): symbol
 * palettes, sets of symbols a plugin declares in its manifest's `symbolPalettes` for
 * `draw-symbols`' Symbols panel, e.g. `cot`'s "CoT". Declared only: there is no runtime API, and
 * no plugin writes another's palette.
 *
 * @example
 * for (const palette of ctx.symbolPalettes) addChoice(palette.id, palette.name);
 */
import type { SymbolStandard } from './model.ts';

/** The most palettes one plugin declares. */
export const MAX_PALETTES_PER_PLUGIN = 8;
/** The most symbols in one palette. */
export const MAX_PALETTE_SYMBOLS = 2000;

/** One symbol of a palette. */
export interface PaletteSymbol {
  /** `APP-6B`, `APP-6D` or `APP-6E` (no vessels). */
  readonly standard: Exclude<SymbolStandard, 'vessel'>;
  /** A whole code valid for its standard, as a `core.symbol`'s `sidc`. */
  readonly code: string;
  /** Shown instead of the catalogue's name, 1 to 128 characters. */
  readonly label?: string;
}

/** A palette, as `ctx.symbolPalettes` gives it. */
export interface SymbolPalette {
  /** The declaring plugin. */
  readonly plugin: string;
  /** The full id, `<plugin-id>.<id>`, e.g. `cot.cot`. */
  readonly id: string;
  /** Shown in the Symbols panel's drop-down, e.g. `CoT`. */
  readonly name: string;
  readonly symbols: readonly PaletteSymbol[];
}
