import { describe, expect, it } from 'vitest';
import type { SidcParts } from '@emc2/plugin-sdk';
import { CATALOG } from '../src/catalog.ts';
import { compose, describe as describeSidc } from '../src/sidc.ts';
import { validate } from '../src/validate.ts';

const STANDARDS = ['APP-6D', 'APP-6E'] as const;

describe('AC4: compose and describe', () => {
  it('compose followed by describe returns the original parts, for every catalog entry with every standard identity and echelon', () => {
    let checked = 0;
    for (const standard of STANDARDS) {
      for (const entry of CATALOG.entities) {
        for (const identity of CATALOG.standardIdentities) {
          for (const echelon of CATALOG.echelons) {
            const parts: SidcParts = {
              standard, standardIdentity: identity.code, symbolSet: entry.symbolSet, status: '0', hqTaskForceDummy: '0',
              echelonMobility: echelon.code, entity: entry.entity,
            };
            const sidc = compose(parts);
            expect(describeSidc(standard, sidc)).toEqual(parts);
            // Every combination is also a symbol milsymbol knows.
            expect(validate(standard, sidc), `${entry.name}, ${identity.name}, ${echelon.name}: ${sidc}`).toEqual({ valid: true });
            checked++;
          }
        }
      }
    }
    expect(checked).toBe(2 * CATALOG.entities.length * CATALOG.standardIdentities.length * CATALOG.echelons.length);
  });

  it('round-trips the status and HQ/task force/dummy digits too', () => {
    const parts: SidcParts = {
      standard: 'APP-6D', standardIdentity: '6', symbolSet: '10', status: '1', hqTaskForceDummy: '2', echelonMobility: '16', entity: '120500',
    };
    expect(compose(parts)).toBe('10061012161205000000');
    expect(describeSidc('APP-6D', compose(parts))).toEqual(parts);
  });

  it('composes the canonical form: an APP-6E SIDC has 20 digits', () => {
    const sidc = compose({
      standard: 'APP-6E', standardIdentity: '3', symbolSet: '10', status: '0', hqTaskForceDummy: '0', echelonMobility: '00', entity: '121100',
    });
    expect(sidc).toBe('13031000001211000000');
  });

  it('describes a 30-digit APP-6E SIDC like its 20-digit form', () => {
    expect(describeSidc('APP-6E', '130310000012110000000000000000')).toEqual(describeSidc('APP-6E', '13031000001211000000'));
  });

  it('describes the parts at the right digits', () => {
    expect(describeSidc('APP-6D', '10061012161205001234')).toEqual({
      standard: 'APP-6D', standardIdentity: '6', symbolSet: '10', status: '1', hqTaskForceDummy: '2', echelonMobility: '16', entity: '120500',
    });
  });

  it.each([
    ['APP-6D', '13031000001211000000'],
    ['APP-6D', 'SFGPUCI--------'],
    ['APP-6E', '1303100000121100000'],
    ['APP-6B', 'SFGPUCI--------'],
  ] as const)('refuses to describe %s %s', (standard, sidc) => {
    expect(() => describeSidc(standard as SidcParts['standard'], sidc)).toThrow(RangeError);
  });

  it.each([
    ['standardIdentity', '33'],
    ['symbolSet', '1'],
    ['status', 'x'],
    ['hqTaskForceDummy', ''],
    ['echelonMobility', '123'],
    ['entity', '12110'],
  ] as const)('refuses to compose with %s "%s"', (part, value) => {
    const parts: SidcParts = {
      standard: 'APP-6D', standardIdentity: '3', symbolSet: '10', status: '0', hqTaskForceDummy: '0', echelonMobility: '00', entity: '121100',
    };
    expect(() => compose({ ...parts, [part]: value })).toThrow(new RegExp(part));
  });

  it('refuses to compose for APP-6B', () => {
    const parts = { standard: 'APP-6B', standardIdentity: '3', symbolSet: '10', status: '0', hqTaskForceDummy: '0', echelonMobility: '00', entity: '121100' };
    expect(() => compose(parts as unknown as SidcParts)).toThrow(RangeError);
  });
});
