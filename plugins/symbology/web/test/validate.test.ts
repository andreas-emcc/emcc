import { describe, expect, it } from 'vitest';
import type { SymbolStandard } from '@emc2/plugin-sdk';
import { checkPattern, validate } from '../src/validate.ts';
import { exampleCoreSymbols, exampleSymbols } from './examples.ts';

describe('AC3: validate', () => {
  const valid = exampleCoreSymbols('valid');

  it('finds APP-6B, APP-6D, 20- and 30-digit APP-6E SIDCs and a vessel code in the core.symbol examples of model/examples/valid', () => {
    const sidcs = valid.map((e) => `${e.symbol.standard} ${String(e.symbol.sidc.length)}`);
    expect(new Set(sidcs)).toEqual(new Set(['APP-6B 15', 'APP-6D 20', 'APP-6E 20', 'APP-6E 30', 'vessel 4']));
  });

  it.each(valid.map((e) => [e.file, e.symbol.standard, e.symbol.sidc] as const))('accepts the core.symbol example %s (%s %s)', (_file, standard, sidc) => {
    expect(validate(standard, sidc)).toEqual({ valid: true });
  });

  it.each([
    ['object-app6d-sidc-wrong-length.json', 'has 20 digits, not 15 characters'],
    ['object-app6d-with-app6e-version.json', 'version (digits 1-2) of an APP-6D SIDC is 10, 11 or 12, not 13'],
    ['object-vessel-bad-code.json', 'context (digit 1) of a vessel code is 0, 1 or 2, not 3'],
  ])('rejects the SIDC of %s', (file, problem) => {
    const example = exampleSymbols('invalid').find((e) => e.file === file);
    if (!example) throw new Error(`${file} has no symbol`);
    const result = validate(example.symbol.standard, example.symbol.sidc);
    expect(result.valid).toBe(false);
    expect(result.problem).toContain(problem);
  });

  it.each<[SymbolStandard, string, string]>([
    ['APP-6D', '1003100000121100000', 'has 20 digits, not 19'],
    ['APP-6D', '100310000012110000000', 'has 20 digits, not 21'],
    ['APP-6D', '130310000012110000000000000000', 'has 20 digits, not 30'],
    ['APP-6E', '1303100000121100000000000', 'has 20 or 30 digits, not 25'],
    ['APP-6D', '1003100000121100000A', 'digits only'],
    ['APP-6E', 'SFGPUCI--------', 'has 20 or 30 digits, not 15 characters'],
    ['APP-6E', '1303100000121100000A', 'digits only'],
    ['APP-6E', '1303100000121100000000000000a0', 'digits only'],
    ['APP-6E', '10031000001211000000', 'version (digits 1-2) of an APP-6E SIDC is 13 or 14, not 10'],
    ['APP-6D', '09031000001211000000', 'version (digits 1-2) of an APP-6D SIDC is 10, 11 or 12, not 09'],
    ['APP-6B', 'SFGPUCI-------', '15 characters'],
    ['APP-6B', 'sfgpuci--------', '15 characters'],
  ])('rejects %s %s: %s', (standard, sidc, problem) => {
    const result = validate(standard, sidc);
    expect(result.valid).toBe(false);
    expect(result.problem).toContain(problem);
  });

  it("uses milsymbol's own check after the pattern: an unknown entity is invalid", () => {
    const result = validate('APP-6D', '10031000001299000000');
    expect(result.valid).toBe(false);
    expect(result.problem).toContain('milsymbol');
  });

  it('accepts the version digits milsymbol maps to each standard', () => {
    for (const version of ['10', '11', '12']) expect(validate('APP-6D', `${version}031000001211000000`).valid).toBe(true);
    for (const version of ['13', '14']) expect(validate('APP-6E', `${version}031000001211000000`).valid).toBe(true);
  });

  it('passes the multipoint graphics in model/examples/valid on the pattern, but milsymbol has no point symbol for them (multipoint graphics are outside criteria 1 and 3, owner 2026-10-08)', () => {
    const multipoint = exampleSymbols('valid').filter((e) => e.objectType === 'core.multipoint');
    expect(multipoint.map((e) => e.file)).toContain('object-multipoint-boundary.json');
    for (const { symbol } of multipoint) {
      expect(checkPattern(symbol.standard, symbol.sidc)).toEqual({ valid: true });
      expect(validate(symbol.standard, symbol.sidc).problem).toContain('milsymbol');
    }
  });

  it.each(['0470', '2607', '0000', '1399'])('criterion 18: accepts the vessel code %s', (sidc) => {
    expect(validate('vessel', sidc)).toEqual({ valid: true });
  });

  it.each([
    ['3470', 'context (digit 1) of a vessel code is 0, 1 or 2, not 3'],
    ['0770', 'standard identity (digit 2) of a vessel code is 0 to 6, not 7'],
    ['470', 'has 4 digits, not 3 characters'],
    ['04700', 'has 4 digits, not 5 characters'],
    ['04a0', 'digits only'],
    ['10031000001211000000', 'has 4 digits, not 20 characters'],
  ])('criterion 18: rejects the vessel code %s: %s', (sidc, problem) => {
    const result = validate('vessel', sidc);
    expect(result.valid).toBe(false);
    expect(result.problem).toContain(problem);
  });

  it('rejects an unknown standard', () => {
    expect(validate('APP-6C' as SymbolStandard, '10031000001211000000').problem).toContain('unknown standard');
  });
});
