import ms from 'milsymbol';
import type { SymbolStandard } from '@emc2/plugin-sdk';

/** The model's SIDC patterns (`model/schemas/map-object.schema.json`, model README "Conventions"). */
const PATTERNS: Readonly<Record<SymbolStandard, RegExp>> = {
  'APP-6B': /^[A-Z0-9*-]{15}$/,
  'APP-6D': /^1[0-2]\d{18}$/,
  'APP-6E': /^1[34]\d{18}(\d{10})?$/,
  // Data model 1.4.0 (ADR-0047): context 0 to 2, standard identity 0 to 6, AIS ship type 00 to 99.
  vessel: /^[0-2][0-6]\d{2}$/,
};

/** The problem of a vessel code that fails its pattern. */
function vesselProblem(sidc: string): string {
  if (sidc.length !== 4) return `a vessel code has 4 digits, not ${String(sidc.length)} characters`;
  if (!/^\d{4}$/.test(sidc)) return 'a vessel code has digits only';
  if (!/^[0-2]/.test(sidc)) return `the context (digit 1) of a vessel code is 0, 1 or 2, not ${sidc.slice(0, 1)}`;
  return `the standard identity (digit 2) of a vessel code is 0 to 6, not ${sidc.slice(1, 2)}`;
}

const VERSIONS: Readonly<Record<'APP-6D' | 'APP-6E', string>> = { 'APP-6D': '10, 11 or 12', 'APP-6E': '13 or 14' };

export interface Validity {
  readonly valid: boolean;
  readonly problem?: string;
}

/** Checks a SIDC against the model's pattern for its standard only, with a reason when it fails. */
export function checkPattern(standard: SymbolStandard, sidc: string): Validity {
  const pattern = (PATTERNS as Readonly<Record<string, RegExp | undefined>>)[standard];
  if (pattern === undefined) return { valid: false, problem: `unknown standard "${standard}"` };
  if (pattern.test(sidc)) return { valid: true };
  if (standard === 'vessel') return { valid: false, problem: vesselProblem(sidc) };
  if (standard === 'APP-6B') return { valid: false, problem: 'an APP-6B SIDC has 15 characters: A-Z, 0-9, "*" or "-"' };
  const lengths = standard === 'APP-6D' ? '20 digits' : '20 or 30 digits';
  if (standard === 'APP-6D' ? sidc.length !== 20 : sidc.length !== 20 && sidc.length !== 30) {
    return { valid: false, problem: `an ${standard} SIDC has ${lengths}, not ${String(sidc.length)} characters` };
  }
  if (!/^\d+$/.test(sidc)) return { valid: false, problem: `an ${standard} SIDC has digits only` };
  return { valid: false, problem: `the version (digits 1-2) of an ${standard} SIDC is ${VERSIONS[standard]}, not ${sidc.slice(0, 2)}` };
}

/** The model's pattern first, then, for APP-6, milsymbol's own check (known standard identity, symbol set and entity). */
export function validate(standard: SymbolStandard, sidc: string): Validity {
  const pattern = checkPattern(standard, sidc);
  if (!pattern.valid || standard === 'vessel') return pattern;
  if (new ms.Symbol(sidc, { standard: 'APP6' }).isValid() !== true) {
    return { valid: false, problem: `milsymbol does not know this ${standard} symbol (standard identity, symbol set, entity or modifiers)` };
  }
  return { valid: true };
}
