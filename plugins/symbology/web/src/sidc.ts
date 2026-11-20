import { canonicalSidc, type SidcParts } from '@emc2/plugin-sdk';
import { checkPattern } from './validate.ts';

/** The version digits compose writes: the first version milsymbol 3.0.4 maps to each standard. */
const VERSION: Readonly<Record<SidcParts['standard'], string>> = { 'APP-6D': '10', 'APP-6E': '13' };

/** Each part: its digits in the SIDC (0-based, end exclusive) and its form. */
const LAYOUT = {
  standardIdentity: [3, 4, /^\d$/],
  symbolSet: [4, 6, /^\d{2}$/],
  status: [6, 7, /^\d$/],
  hqTaskForceDummy: [7, 8, /^\d$/],
  echelonMobility: [8, 10, /^\d{2}$/],
  entity: [10, 16, /^\d{6}$/],
} as const satisfies Record<Exclude<keyof SidcParts, 'standard'>, readonly [number, number, RegExp]>;

const PART_NAMES = Object.keys(LAYOUT) as (keyof typeof LAYOUT)[];

/**
 * Builds the canonical SIDC (always 20 digits) from its parts: context 0 (reality), and the sector 1
 * and 2 modifiers 00. Throws a RangeError naming a part that is not well formed.
 */
export function compose(parts: SidcParts): string {
  const version = VERSION[parts.standard] as string | undefined;
  if (version === undefined) throw new RangeError(`compose: unknown standard "${parts.standard}" (APP-6D or APP-6E)`);
  let sidc = `${version}0`;
  for (const name of PART_NAMES) {
    const value = parts[name];
    if (typeof value !== 'string' || !LAYOUT[name][2].test(value)) {
      throw new RangeError(`compose: ${name} must have ${String(LAYOUT[name][1] - LAYOUT[name][0])} digit(s), not "${value}"`);
    }
    sidc += value;
  }
  return canonicalSidc(parts.standard, `${sidc}0000`);
}

/**
 * Splits a SIDC into its parts. The version, the context, the sector modifiers (digits 17-20) and
 * digits 21-30 are not parts and are not returned. Throws a RangeError for a SIDC that does not match
 * the model's pattern for its standard.
 */
export function describe(standard: SidcParts['standard'], sidc: string): SidcParts {
  if ((VERSION[standard] as string | undefined) === undefined) {
    throw new RangeError(`describe: only APP-6D and APP-6E SIDCs have parts, not "${standard}"`);
  }
  const canonical = canonicalSidc(standard, sidc);
  const pattern = checkPattern(standard, canonical);
  if (!pattern.valid) throw new RangeError(`describe: ${pattern.problem ?? 'not a valid SIDC'}`);
  const part = (name: keyof typeof LAYOUT) => canonical.slice(LAYOUT[name][0], LAYOUT[name][1]);
  return {
    standard,
    standardIdentity: part('standardIdentity'),
    symbolSet: part('symbolSet'),
    status: part('status'),
    hqTaskForceDummy: part('hqTaskForceDummy'),
    echelonMobility: part('echelonMobility'),
    entity: part('entity'),
  };
}
