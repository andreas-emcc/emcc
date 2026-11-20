// Parsing user text into a WGS84 lon/lat position. The format is recognised from the text: polar
// MGRS and UPS, then MGRS, then UTM, then latitude/longitude (DD, degrees and decimal minutes, DMS).
// Text without hemisphere letters is read latitude first, the way people write it; nothing is ever
// swapped. UTM and UPS keep to the brief's limits (UTM up to and including 84° N and 80° S, UPS
// beyond), with a small slack for rounded metres.
import { inverse as mgrsInverse } from 'mgrs';
import type { Position } from '@emc2/plugin-sdk';
import { polarSquare } from './polarMgrs.ts';
import { UPS_ORIGIN, UTM_NORTH_LIMIT, UTM_SOUTH_LIMIT, bandRange, fromUps, fromUtm, isUpsLetter, upsNorth, type UpsLetter } from './utm.ts';

export type ParseResult = { readonly position: Position } | { readonly error: string };

export const NOT_A_POSITION =
  'Not a position. Examples: 60°07\'24.4" N 015°39\'15.6" E, 60.1235 15.6543, 33V 536360 6665340, 33VWG 36360 65340, Z 2092055 1579410, ZAC 92054 79409.';
const BEYOND_UTM = 'UTM ends at 84° N and 80° S. Beyond, write UPS (e.g. Z 2092055 1579410) or polar MGRS (e.g. ZAC 92054 79409).';
const INSIDE_UTM = 'UPS starts beyond 84° N and 80° S. Closer to the equator, write UTM (e.g. 33V 536360 6665340) or MGRS.';
/** Longer text is refused before any parsing; the longest valid text is far shorter. */
export const MAX_LENGTH = 100;
/** Slack for a UTM position on the edge of its band: the metres are rounded. */
const BAND_TOLERANCE = 1e-4;

export function parsePosition(text: string): ParseResult {
  if (text.length > MAX_LENGTH) return { error: `Too long for a position (at most ${String(MAX_LENGTH)} characters).` };
  const normal = normalise(text);
  if (normal === '') return { error: 'Enter a position.' };
  return (
    parsePolarMgrs(normal) ?? parseUps(normal) ?? parseMgrs(normal) ?? parseUtm(normal) ?? parseLatLon(normal) ?? { error: NOT_A_POSITION }
  );
}

/** A UTM or MGRS result north of 84° N or south of 80° S needs UPS. */
function outsideUtm(lat: number): boolean {
  return lat > UTM_NORTH_LIMIT + BAND_TOLERANCE || lat < UTM_SOUTH_LIMIT - BAND_TOLERANCE;
}

/** A UPS result must lie beyond 84° N (Y, Z) or 80° S (A, B). */
function insideUpsArea(letter: UpsLetter, lat: number): boolean {
  return upsNorth(letter) ? lat >= UTM_NORTH_LIMIT - BAND_TOLERANCE : lat <= UTM_SOUTH_LIMIT + BAND_TOLERANCE;
}

/** UPS's west letters (A, Y) cover eastings below 2 000 000 m, the east letters (B, Z) the rest; 1 m of slack for rounding. */
function letterError(letter: UpsLetter, easting: number): ParseResult | null {
  const east = letter === 'B' || letter === 'Z';
  const fits = east ? easting >= UPS_ORIGIN - 1 : easting <= UPS_ORIGIN + 1;
  if (fits) return null;
  const right = upsNorth(letter) ? (east ? 'Y' : 'Z') : east ? 'A' : 'B';
  return { error: `UPS ${letter} is ${east ? 'east' : 'west'} of 0° and 180°: an easting of ${String(easting)} m belongs to ${right}.` };
}

/** `Z 2092055 1579410`: the UPS letter (A, B south; Y, Z north), then easting and northing in metres, as the utm format writes them. */
function parseUps(text: string): ParseResult | null {
  const m = /^([ABYZ])\s+(\d+(?:\.\d*)?)(?:\s*M)?[\s,;]+(\d+(?:\.\d*)?)(?:\s*M)?$/.exec(text);
  if (!m?.[1] || !m[2] || !m[3] || !isUpsLetter(m[1])) return null;
  const letter = m[1];
  const easting = Number(m[2]);
  const northing = Number(m[3]);
  if (!(easting >= 0 && easting <= 4_000_000) || !(northing >= 0 && northing <= 4_000_000)) {
    return { error: 'UPS easting and northing must be between 0 and 4 000 000 m.' };
  }
  const wrongLetter = letterError(letter, easting);
  if (wrongLetter) return wrongLetter;
  const position = fromUps(letter, easting, northing);
  if (!Number.isFinite(position[0]) || !Number.isFinite(position[1])) return { error: NOT_A_POSITION };
  if (!insideUpsArea(letter, position[1])) return { error: INSIDE_UTM };
  return { position };
}

/** `ZAC 92054 79409`, `ZAC9205479409`, down to `ZAC`: MGRS on the UPS grid. The result is the south-west corner of the square. */
function parsePolarMgrs(text: string): ParseResult | null {
  const m = /^([ABYZ])\s*([A-Z]{2})(?:\s*(\d+)(?:\s+(\d+))?)?$/.exec(text);
  if (!m?.[1] || !m[2] || !isUpsLetter(m[1])) return null;
  const letter = m[1];
  const split = splitDigits(m[3] ?? '', m[4]);
  if ('error' in split) return split;
  const square = polarSquare(letter, m[2], split.easting, split.northing);
  if (!square) return { error: `${m[2]} is not a 100 km square of polar MGRS zone ${letter}.` };
  // The square must reach beyond the limit; its south-west corner may lie just inside UTM.
  const nearestToPole: Position = fromUps(
    letter,
    Math.min(Math.max(UPS_ORIGIN, square.easting), square.easting + square.size),
    Math.min(Math.max(UPS_ORIGIN, square.northing), square.northing + square.size),
  );
  if (!insideUpsArea(letter, nearestToPole[1])) return { error: INSIDE_UTM };
  const position = fromUps(letter, square.easting, square.northing);
  if (!Number.isFinite(position[0]) || !Number.isFinite(position[1])) return { error: NOT_A_POSITION };
  return { position };
}

/** MGRS digits, written together (`3636065340`) or apart (`36360 65340`): the same number for easting and northing, at most 5 each. */
function splitDigits(first: string, second: string | undefined): { readonly easting: string; readonly northing: string } | { readonly error: string } {
  if (second !== undefined ? first.length !== second.length : first.length % 2 !== 0) {
    return { error: 'MGRS easting and northing must have the same number of digits.' };
  }
  const digits = second === undefined ? first : first + second;
  if (digits.length > 10) return { error: 'MGRS has at most 5 digits each for easting and northing.' };
  const half = digits.length / 2;
  return { easting: digits.slice(0, half), northing: digits.slice(half) };
}

function normalise(text: string): string {
  return text
    .trim()
    .toUpperCase()
    .replace(/−/g, '-') // the Unicode minus sign
    .replace(/[º˚]/g, '°')
    .replace(/''|[″”“]/g, '"')
    .replace(/[′’‘´`]/g, "'");
}

function zoneError(zone: number): ParseResult | null {
  return zone >= 1 && zone <= 60 ? null : { error: `UTM zone ${String(zone)} does not exist: zones are 1 to 60.` };
}

function bandError(band: string): ParseResult | null {
  if ('ABYZ'.includes(band)) return { error: `${band} is a UPS letter, which takes no zone number: e.g. ${band} 2000000 2000000.` };
  return bandRange(band) ? null : { error: `${band} is not a latitude band: bands are C to X, without I and O.` };
}

/** `33VWG 36360 65340`, `33VWG3636065340`, down to `33VWG`. The result is the south-west corner of the square (NGA convention). */
function parseMgrs(text: string): ParseResult | null {
  const m = /^(\d{1,2})\s*([A-Z])\s*([A-Z]{2})(?:\s*(\d+)(?:\s+(\d+))?)?$/.exec(text);
  if (!m?.[1] || !m[2] || !m[3]) return null;
  const zone = Number(m[1]);
  const band = m[2];
  const split = splitDigits(m[4] ?? '', m[5]);
  if ('error' in split) return split;
  const digits = split.easting + split.northing;
  const invalid = zoneError(zone) ?? bandError(band);
  if (invalid) return invalid;
  let box: readonly number[];
  try {
    box = mgrsInverse(`${String(zone)}${band}${m[3]}${digits}`);
  } catch {
    return { error: `${m[3]} is not a 100 km square of zone ${String(zone)}.` };
  }
  const [west, south, , north] = box;
  const range = bandRange(band);
  if (west === undefined || south === undefined || north === undefined || !Number.isFinite(west) || !Number.isFinite(south) || !range) {
    return { error: NOT_A_POSITION };
  }
  if (outsideUtm(south)) return { error: BEYOND_UTM };
  if (south > range[1] + BAND_TOLERANCE || north < range[0] - BAND_TOLERANCE) {
    return { error: `The 100 km square ${m[3]} does not lie in latitude band ${band} of zone ${String(zone)}.` };
  }
  return { position: [west, south] };
}

/** `33V 536360 6665340`: zone and latitude band (as format writes it), then easting and northing in metres. */
function parseUtm(text: string): ParseResult | null {
  const m = /^(\d{1,2})\s*([A-Z])\s+(\d+(?:\.\d*)?)(?:\s*M)?[\s,;]+(\d+(?:\.\d*)?)(?:\s*M)?$/.exec(text);
  if (!m?.[1] || !m[2] || !m[3] || !m[4]) return null;
  const zone = Number(m[1]);
  const band = m[2];
  const easting = Number(m[3]);
  const northing = Number(m[4]);
  const invalid = zoneError(zone) ?? bandError(band);
  if (invalid) return invalid;
  if (!(easting > 0 && easting < 1_000_000)) return { error: 'The UTM easting must be between 0 and 1 000 000 m.' };
  if (!(northing >= 0 && northing <= 10_000_000)) return { error: 'The UTM northing must be between 0 and 10 000 000 m.' };
  const position = fromUtm(zone, band, easting, northing);
  const range = bandRange(band);
  const lat = position[1];
  if (!range || !Number.isFinite(position[0]) || !Number.isFinite(lat)) return { error: NOT_A_POSITION };
  if (outsideUtm(lat)) return { error: BEYOND_UTM };
  if (lat < range[0] - BAND_TOLERANCE || lat > range[1] + BAND_TOLERANCE) {
    return {
      error: `The northing does not lie in latitude band ${band}. Write the latitude band after the zone (e.g. 33V), not N or S for the hemisphere.`,
    };
  }
  return { position };
}

type Token =
  | { readonly kind: 'hemisphere'; readonly letter: 'N' | 'S' | 'E' | 'W' }
  | { readonly kind: 'number'; readonly sign: string; readonly digits: string; readonly unit: string }
  | { readonly kind: 'separator' };

type NumberToken = Extract<Token, { kind: 'number' }>;

function tokenise(text: string): Token[] | null {
  const tokens: Token[] = [];
  const pattern = /\s+|([NSEW])|([+-]?)(\d+(?:\.\d*)?|\.\d+)\s*([°'"]?)|([,;/])|(.)/gy;
  for (const m of text.matchAll(pattern)) {
    if (m[6] !== undefined) return null;
    if (m[1] !== undefined) tokens.push({ kind: 'hemisphere', letter: m[1] as 'N' | 'S' | 'E' | 'W' });
    else if (m[3] !== undefined) tokens.push({ kind: 'number', sign: m[2] ?? '', digits: m[3], unit: m[4] ?? '' });
    else if (m[5] !== undefined) tokens.push({ kind: 'separator' });
  }
  return tokens;
}

interface Part {
  readonly numbers: readonly NumberToken[];
  readonly hemisphere: 'N' | 'S' | 'E' | 'W' | null;
}

/** DD, degrees and decimal minutes, or DMS, for latitude and longitude, with hemisphere letters or signs. */
function parseLatLon(text: string): ParseResult | null {
  const tokens = tokenise(text);
  if (!tokens || !tokens.some((t) => t.kind === 'number')) return null;
  const parts = splitParts(tokens);
  if ('error' in parts) return parts;
  const [first, second] = parts;
  const latPart = first.hemisphere === 'E' || first.hemisphere === 'W' ? second : first;
  const lonPart = latPart === first ? second : first;
  if (latPart.hemisphere !== null && !(latPart.hemisphere === 'N' || latPart.hemisphere === 'S')) {
    return { error: 'Use N or S for the latitude and E or W for the longitude.' };
  }
  if (lonPart.hemisphere !== null && !(lonPart.hemisphere === 'E' || lonPart.hemisphere === 'W')) {
    return { error: 'Use N or S for the latitude and E or W for the longitude.' };
  }
  const lat = angleOf(latPart, 'latitude');
  if (typeof lat === 'object') return lat;
  const lon = angleOf(lonPart, 'longitude');
  if (typeof lon === 'object') return lon;
  if (Math.abs(lat) > 90) {
    return {
      error:
        latPart.hemisphere === null
          ? `Latitude ${String(lat)} is beyond 90°. Write the latitude first, or add hemisphere letters (N, S, E, W).`
          : 'The latitude must be between 90° S and 90° N.',
    };
  }
  if (Math.abs(lon) > 180) return { error: 'The longitude must be between 180° W and 180° E.' };
  return { position: [lon, lat] };
}

function splitParts(tokens: readonly Token[]): readonly [Part, Part] | { readonly error: string } {
  const letters = tokens.filter((t) => t.kind === 'hemisphere').length;
  if (letters === 2) return splitByLetters(tokens);
  if (letters !== 0) return { error: 'Write a hemisphere letter for both latitude and longitude, or for neither.' };
  const separators = tokens.filter((t) => t.kind === 'separator').length;
  const numbers = tokens.filter((t): t is NumberToken => t.kind === 'number');
  let groups: NumberToken[][];
  if (separators === 1) {
    const at = tokens.findIndex((t) => t.kind === 'separator');
    groups = [tokens.slice(0, at), tokens.slice(at + 1)].map((g) => g.filter((t): t is NumberToken => t.kind === 'number'));
  } else if (separators > 1) {
    return { error: NOT_A_POSITION };
  } else if (numbers.some((n) => n.unit !== '')) {
    // A degree sign starts the next angle: 60°07'24.4" 15°39'15.6"
    groups = [];
    for (const n of numbers) {
      const current = groups.at(-1);
      if (current === undefined || n.unit === '°') groups.push([n]);
      else current.push(n);
    }
  } else {
    const half = numbers.length / 2;
    groups = [numbers.slice(0, half), numbers.slice(half)];
  }
  const [lat, lon] = groups;
  if (groups.length !== 2 || !lat || !lon || lat.length === 0 || lat.length !== lon.length) {
    return { error: 'Write latitude and longitude in the same way, e.g. 60.1235 15.6543 or 60 07 24.4 15 39 15.6.' };
  }
  return [
    { numbers: lat, hemisphere: null },
    { numbers: lon, hemisphere: null },
  ];
}

function splitByLetters(tokens: readonly Token[]): readonly [Part, Part] | { readonly error: string } {
  const significant = tokens.filter((t) => t.kind !== 'separator');
  const prefix = significant[0]?.kind === 'hemisphere';
  if (!prefix && significant.at(-1)?.kind !== 'hemisphere') return { error: NOT_A_POSITION };
  const parts: Part[] = [];
  let numbers: NumberToken[] = [];
  let letter: Part['hemisphere'] = null;
  for (const t of significant) {
    if (t.kind === 'number') {
      numbers.push(t);
    } else {
      if (prefix && letter !== null) parts.push({ numbers, hemisphere: letter });
      if (prefix) {
        numbers = [];
        letter = t.letter;
      } else {
        parts.push({ numbers, hemisphere: t.letter });
        numbers = [];
      }
    }
  }
  if (prefix && letter !== null) parts.push({ numbers, hemisphere: letter });
  const [first, second] = parts;
  if (parts.length !== 2 || !first || !second || first.numbers.length === 0 || second.numbers.length === 0) {
    return { error: NOT_A_POSITION };
  }
  if (parts.some((p) => p.numbers.some((n) => n.sign !== ''))) return { error: 'Use either a sign or a hemisphere letter, not both.' };
  return [first, second];
}

/** Degrees from one part: `60.5`, `60 30.5`, `60°30'15.5"` or, with a hemisphere letter, compact `603015.5`. */
function angleOf(part: Part, name: 'latitude' | 'longitude'): number | { readonly error: string } {
  const [first] = part.numbers;
  if (!first) return { error: NOT_A_POSITION };
  if (part.numbers.slice(1).some((n) => n.sign !== '')) return { error: NOT_A_POSITION };
  let values = part.numbers.map((n) => n.digits);
  const units = part.numbers.map((n) => n.unit);
  const compact = values.length === 1 && units[0] === '' && part.hemisphere !== null && (first.digits.split('.')[0]?.length ?? 0) >= 5;
  if (compact) {
    // DDMMSS(.s) or DDDMMSS(.s)
    const [whole = '', fraction] = first.digits.split('.');
    values = [whole.slice(0, -4), whole.slice(-4, -2), whole.slice(-2) + (fraction === undefined ? '' : `.${fraction}`)];
  } else if (values.length > 3 || units.some((u, i) => u !== '' && u !== ['°', "'", '"'][i])) {
    return { error: `The ${name} must be degrees, minutes and seconds, in that order.` };
  }
  if (values.slice(0, -1).some((v) => v.includes('.'))) {
    return { error: `Only the last number of the ${name} may have decimals.` };
  }
  const [degrees = 0, minutes = 0, seconds = 0] = values.map(Number);
  if (minutes >= 60 || seconds >= 60) return { error: `Minutes and seconds of the ${name} must be below 60.` };
  const magnitude = degrees + minutes / 60 + seconds / 3600;
  const negative = first.sign === '-' || part.hemisphere === 'S' || part.hemisphere === 'W';
  return negative ? -magnitude : magnitude;
}
