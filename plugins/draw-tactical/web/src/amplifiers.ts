// The amplifiers of a graphic (brief, function 4; data model 1.4.0): which fields a graphic shows, how
// the user's input becomes `modifiers`, and what makes it invalid. Text amplifiers are 1 to 128
// characters, `distances` (AM) are metres from 0 to 20 000 000 and `azimuths` (AN) degrees from 0 to
// 360, 1 to 64 values each, in the order the graphic's `points` text describes.
import type { GraphicCatalogEntry, ModifierName, Modifiers, TextModifierName } from '@emc2/plugin-sdk';

export const MAX_TEXT_LENGTH = 128;
export const MAX_LIST_VALUES = 64;
export const MAX_DISTANCE = 20_000_000;
export const MAX_AZIMUTH = 360;

/** The numeric amplifiers, as lists. */
export const LIST_AMPLIFIERS = ['distances', 'azimuths'] as const;
export type ListAmplifier = (typeof LIST_AMPLIFIERS)[number];

export function isListAmplifier(name: ModifierName): name is ListAmplifier {
  return name === 'distances' || name === 'azimuths';
}

/** The APP-6 letter and the name of each amplifier a graphic can show (mil-sym-ts's table), e.g. "T1 Unique designation 2". */
const LABELS: Readonly<Partial<Record<ModifierName, string>>> = {
  uniqueDesignation: 'T Unique designation 1',
  uniqueDesignation1: 'T1 Unique designation 2',
  uniqueDesignation2: 'T2 Unique designation 3',
  additionalInformation: 'H Additional information',
  hostile: 'N Hostile',
  type: 'V Type',
  dtg: 'W Date-time group 1',
  dtg1: 'W1 Date-time group 2',
  altitudeDepth: 'X Altitude/depth',
  location: 'Y Location',
  country: 'AS Country',
  targetNumber: 'AP Target number',
  distances: 'AM Distances (metres)',
  azimuths: 'AN Azimuths (degrees)',
};

export function labelOf(name: ModifierName): string {
  return LABELS[name] ?? name;
}

/** What the user has typed: a text for a text amplifier, one text per value for a list. */
export type AmplifierDrafts = { readonly [name in ModifierName]?: string | readonly string[] };

export type AmplifierProblems = { readonly [name in ModifierName]?: string };

export interface AmplifierResult {
  /** The amplifiers the input stands for: only those that are filled in and valid. */
  readonly modifiers: Modifiers;
  /** Why an amplifier is not valid, or that a required one is empty. */
  readonly problems: AmplifierProblems;
  /** True when every amplifier is valid and every required one is filled in. */
  readonly ok: boolean;
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

/** A number typed by the user (a comma is taken as the decimal mark), or null if the text is not one. */
export function parseNumber(text: string): number | null {
  const normal = text.trim().replace(',', '.');
  if (!NUMBER.test(normal)) return null;
  const value = Number(normal);
  return Number.isFinite(value) ? value : null;
}

function problemOfList(name: ListAmplifier, values: readonly number[], invalid: boolean): string | undefined {
  if (invalid) return 'Enter numbers only, one per line';
  if (values.length > MAX_LIST_VALUES) return `At most ${String(MAX_LIST_VALUES)} values`;
  const [min, max, unit] = name === 'distances' ? [0, MAX_DISTANCE, 'metres'] : [0, MAX_AZIMUTH, 'degrees'];
  return values.some((v) => v < min || v > max) ? `Each value must be from ${String(min)} to ${max.toLocaleString('en-US').replaceAll(',', ' ')} ${unit}` : undefined;
}

/** Checks the input of the amplifiers `entry` allows. Input for another amplifier is ignored. */
export function checkAmplifiers(entry: GraphicCatalogEntry, drafts: AmplifierDrafts): AmplifierResult {
  const modifiers: { -readonly [K in keyof Modifiers]?: Modifiers[K] } = {};
  const problems: { -readonly [K in ModifierName]?: string } = {};
  for (const name of entry.allowedModifiers) {
    const draft = drafts[name];
    if (isListAmplifier(name)) {
      const rows = (typeof draft === 'string' ? [draft] : (draft ?? [])).map((r) => r.trim()).filter((r) => r !== '');
      const numbers = rows.map(parseNumber);
      const invalid = numbers.some((n) => n === null);
      const values = numbers.filter((n): n is number => n !== null);
      const problem = problemOfList(name, values, invalid);
      if (problem !== undefined) problems[name] = problem;
      else if (values.length > 0) modifiers[name] = values;
    } else {
      const text = typeof draft === 'string' ? draft.trim() : '';
      if (Array.from(text).length > MAX_TEXT_LENGTH) problems[name] = `At most ${String(MAX_TEXT_LENGTH)} characters`;
      else if (text !== '') modifiers[name as TextModifierName] = text;
    }
  }
  for (const name of entry.requiredModifiers) {
    if (modifiers[name] === undefined && problems[name] === undefined) problems[name] = 'Required';
  }
  return { modifiers, problems, ok: Object.keys(problems).length === 0 };
}

/** The input that stands for the amplifiers an object has (the edit panel's fields). */
export function draftsOf(entry: GraphicCatalogEntry, modifiers: Modifiers | undefined): AmplifierDrafts {
  const drafts: { -readonly [K in ModifierName]?: string | readonly string[] } = {};
  for (const name of entry.allowedModifiers) {
    const value = modifiers?.[name];
    if (value === undefined) continue;
    drafts[name] = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : value.map(String);
  }
  return drafts;
}

/** The amplifiers an object carries that its graphic does not allow: kept, and shown read only (brief, function 4). */
export function foreignAmplifiers(entry: GraphicCatalogEntry, modifiers: Modifiers | undefined): readonly { readonly name: ModifierName; readonly text: string }[] {
  if (modifiers === undefined) return [];
  const allowed = new Set<string>(entry.allowedModifiers);
  return Object.entries(modifiers)
    .filter(([name]) => !allowed.has(name))
    .map(([name, value]) => ({ name: name as ModifierName, text: Array.isArray(value) ? value.join(', ') : String(value) }));
}

/**
 * The modifiers after the user's input: the amplifiers the graphic allows are replaced by `next` (those
 * not filled in are removed), every other amplifier the object carries stays as it is.
 */
export function mergeModifiers(entry: GraphicCatalogEntry, current: Modifiers | undefined, next: Modifiers): Modifiers | undefined {
  const allowed = new Set<string>(entry.allowedModifiers);
  const kept = Object.fromEntries(Object.entries(current ?? {}).filter(([name]) => !allowed.has(name)));
  const merged = { ...kept, ...next } as Modifiers;
  return Object.keys(merged).length === 0 ? undefined : merged;
}
