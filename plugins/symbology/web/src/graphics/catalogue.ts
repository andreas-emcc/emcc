import type { GraphicCatalogEntry, ModifierName } from '@emc2/plugin-sdk';
import { DRAW_RULES } from './drawRules.ts';

/** The standards with tactical graphics, and the version of mil-sym-ts that draws each (ADR-0043 point 5). */
export const RENDERER_VERSIONS = { 'APP-6D': 10, 'APP-6E': 16 } as const;
export type GraphicStandard = keyof typeof RENDERER_VERSIONS;

/** One graphic of mil-sym-ts's `MSLookup`, as the catalogue reads it. */
export interface LookupEntry {
  /** The 8-digit basic code: symbol set and entity. */
  readonly basicId: string;
  readonly name: string;
  /** Parts separated by slashes, e.g. `Control Measure / Maneuver Areas / `. */
  readonly path: string;
  /** `point`, `Line` or `Area` (and others mil-sym-ts may add). */
  readonly geometry: string;
  /** The name of its draw rule in mil-sym-ts's `DrawRules`. */
  readonly drawRule: string;
  readonly minPoints: number;
  /** mil-sym-ts gives `Number.MAX_VALUE` for no limit. */
  readonly maxPoints: number;
  /** mil-sym-ts's amplifier keys, e.g. `T_UNIQUE_DESIGNATION_1`. */
  readonly modifiers: readonly string[];
}

/**
 * The amplifiers of the graphics, mil-sym-ts's keys to the model's names, by their APP-6 letters:
 * T, T1, T2, H, N, V, W, W1, X, Y, AS, AP, AM, AN. B (the echelon) is part of the SIDC, not a modifier.
 */
export const AMPLIFIERS: Readonly<Record<string, ModifierName>> = {
  T_UNIQUE_DESIGNATION_1: 'uniqueDesignation',
  T1_UNIQUE_DESIGNATION_2: 'uniqueDesignation1',
  T2_UNIQUE_DESIGNATION_3: 'uniqueDesignation2',
  H_ADDITIONAL_INFO_1: 'additionalInformation',
  N_HOSTILE: 'hostile',
  V_EQUIP_TYPE: 'type',
  W_DTG_1: 'dtg',
  W1_DTG_2: 'dtg1',
  X_ALTITUDE_DEPTH: 'altitudeDepth',
  Y_LOCATION: 'location',
  AS_COUNTRY: 'country',
  AP_TARGET_NUMBER: 'targetNumber',
  AM_DISTANCE: 'distances',
  AN_AZIMUTH: 'azimuths',
};

const ECHELON = 'B_ECHELON';

/**
 * Graphics mil-sym-ts 2.10.9 lists but draws nothing for, from any points and amplifiers: left out
 * of the catalogue. A test checks that each still draws nothing, so that a newer renderer shows up.
 */
export const DRAWS_NOTHING: Readonly<Record<GraphicStandard, readonly string[]>> = {
  'APP-6D': [],
  'APP-6E': ['25242703'],
};

/** True for the graphics the catalogue lists: drawn from points, with a known draw rule. */
export function isGraphic(standard: GraphicStandard, entry: LookupEntry): boolean {
  return /^(line|area)$/i.test(entry.geometry) && DRAW_RULES[entry.drawRule] !== undefined && !DRAWS_NOTHING[standard].includes(entry.basicId);
}

/** A catalogue entry from a lookup entry of a graphic (`isGraphic`), by the brief's function 8. */
export function catalogueEntry(standard: GraphicStandard, entry: LookupEntry): GraphicCatalogEntry {
  const rule = DRAW_RULES[entry.drawRule];
  if (rule === undefined) throw new RangeError(`no draw rule ${entry.drawRule} for ${entry.basicId}`);
  const area = /^area$/i.test(entry.geometry);
  const onePoint = entry.maxPoints === 1;
  const kind = rule.arrow === true ? 'arrow' : onePoint ? 'points' : area ? 'area' : 'line';
  const geometry = kind === 'points' ? 'MultiPoint' : kind === 'area' && rule.roles !== true ? 'Polygon' : 'LineString';
  const allowed = entry.modifiers.flatMap((key) => (AMPLIFIERS[key] === undefined ? [] : [AMPLIFIERS[key]]));
  // A required amplifier the lookup does not list is still allowed: the graphic cannot draw without it.
  const required = rule.required ?? [];
  const allowedModifiers = [...allowed, ...required.filter((name) => !allowed.includes(name))];
  return {
    standard,
    symbolSet: entry.basicId.slice(0, 2),
    entity: entry.basicId.slice(2),
    name: entry.name,
    path: entry.path.split('/').map((part) => part.trim()).filter((part) => part !== ''),
    kind,
    geometry,
    minPoints: entry.minPoints,
    maxPoints: entry.maxPoints >= Number.MAX_SAFE_INTEGER ? null : entry.maxPoints,
    points: rule.points,
    requiredModifiers: required,
    allowedModifiers,
    echelon: entry.modifiers.includes(ECHELON),
  };
}

/** The catalogue of one standard, in the lookup's order. */
export function buildCatalogue(standard: GraphicStandard, lookup: Iterable<LookupEntry>): GraphicCatalogEntry[] {
  const entries: GraphicCatalogEntry[] = [];
  for (const entry of lookup) if (isGraphic(standard, entry)) entries.push(catalogueEntry(standard, entry));
  return entries;
}
