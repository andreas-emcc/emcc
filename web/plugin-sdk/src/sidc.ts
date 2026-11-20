import type { SymbolStandard } from './model.ts';

/**
 * The canonical form of a SIDC (model README, "Conventions"): a 30-digit APP-6E SIDC whose digits
 * 21–30 are all zero is written in its 20-digit form, and the two forms compare equal. Other SIDCs
 * are unchanged. Use it when writing symbols and when comparing SIDCs.
 *
 * @example
 * canonicalSidc('APP-6E', '130310000012110000000000000000') // '13031000001211000000'
 */
export function canonicalSidc(standard: SymbolStandard, sidc: string): string {
  if (standard === 'APP-6E' && sidc.length === 30 && sidc.endsWith('0000000000')) {
    return sidc.slice(0, 20);
  }
  return sidc;
}
