// MGRS in the polar areas (north of 84° N, south of 80° S), on the UPS grid. The mgrs library does
// not cover them, so the 100 km square letters are implemented here from NGA's definition of the
// polar MGRS (the UPS lettering of DMA TM 8358.1), in the form GeographicLib uses. The tests check
// the polar reference points and edge cases against GeographicLib GeoConvert, and that every square
// of the tables formats and parses back to itself.
import type { Position } from '@emc2/plugin-sdk';
import { type UpsLetter, toUps } from './utm.ts';

const SQUARE = 100_000;

/**
 * Per zone letter: the column letters (from the easting), the row letters (from the northing), and
 * the 100 km square, counted from the grid's origin, where each starts. I and O are never used.
 */
const LETTERS: Readonly<Record<UpsLetter, { readonly columns: string; readonly rows: string; readonly firstColumn: number; readonly firstRow: number }>> = {
  A: { columns: 'JKLPQRSTUXYZ', rows: 'ABCDEFGHJKLMNPQRSTUVWXYZ', firstColumn: 8, firstRow: 8 },
  B: { columns: 'ABCFGHJKLPQR', rows: 'ABCDEFGHJKLMNPQRSTUVWXYZ', firstColumn: 20, firstRow: 8 },
  Y: { columns: 'RSTUXYZ', rows: 'ABCDEFGHJKLMNP', firstColumn: 13, firstRow: 13 },
  Z: { columns: 'ABCFGHJ', rows: 'ABCDEFGHJKLMNP', firstColumn: 20, firstRow: 13 },
};

/**
 * Removes the rounding noise of the projection at exact metres: the pole and the meridians 0° and
 * ±180° give 2 000 000 m give or take 1e-10 m, which must not fall into the square below.
 */
function snap(metres: number): number {
  const nearest = Math.round(metres);
  return Math.abs(metres - nearest) < 1e-6 ? nearest : metres;
}

/**
 * `ZAH 06749 11929`: zone letter, 100 km square, then easting and northing in the square, truncated
 * to `digits` (1–5) per axis, as MGRS does. For a position outside UTM (check first). Null if the
 * position has no square, which does not happen beyond 84° N and 80° S: a guard against wrong values.
 */
export function formatPolarMgrs(position: Position, digits: number): string | null {
  const ups = toUps(position);
  const easting = snap(ups.easting);
  const northing = snap(ups.northing);
  const letters = LETTERS[ups.letter];
  const column = letters.columns.charAt(Math.floor(easting / SQUARE) - letters.firstColumn);
  const row = letters.rows.charAt(Math.floor(northing / SQUARE) - letters.firstRow);
  if (column === '' || row === '') return null;
  const inSquare = (metres: number) => String(Math.floor(metres) % SQUARE).padStart(5, '0').slice(0, digits);
  return `${ups.letter}${column}${row} ${inSquare(easting)} ${inSquare(northing)}`;
}

/** A polar MGRS reference on the UPS grid: the south-west corner of its square, and the square's size. */
export interface PolarSquare {
  readonly easting: number;
  readonly northing: number;
  /** Metres: 1 for 5 digits per axis, up to 100 000 for none. */
  readonly size: number;
}

/**
 * The UPS easting and northing of a polar MGRS reference, or null if the zone letter has no such
 * column or row letter. `digits` is the easting's and then the northing's digits, 0 to 5 each.
 */
export function polarSquare(letter: UpsLetter, square: string, eastingDigits: string, northingDigits: string): PolarSquare | null {
  const letters = LETTERS[letter];
  const column = letters.columns.indexOf(square.charAt(0));
  const row = letters.rows.indexOf(square.charAt(1));
  if (column < 0 || row < 0 || square.length !== 2) return null;
  const size = 10 ** (5 - eastingDigits.length);
  const inSquare = (digits: string) => (digits === '' ? 0 : Number(digits) * size);
  return {
    easting: (letters.firstColumn + column) * SQUARE + inSquare(eastingDigits),
    northing: (letters.firstRow + row) * SQUARE + inSquare(northingDigits),
    size,
  };
}
