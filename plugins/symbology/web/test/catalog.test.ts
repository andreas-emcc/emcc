import { describe, expect, it } from 'vitest';
import { CATALOG, SYMBOL_SETS } from '../src/catalog.ts';
import { createSymbolService } from '../src/service.ts';
import { drawnModifiers, MODIFIER_NAMES, speedText, wholeDegrees } from '../src/modifiers.ts';
import { modelModifierNames } from './examples.ts';
// For its side effect: jsdom has no canvas, so this gives every canvas a recording 2D context.
import { isDrawn } from './canvas.ts';

describe('catalog', () => {
  it('keeps the about 30 land unit entities of M0', () => {
    const landUnits = CATALOG.entities.filter((e) => e.symbolSet === '10');
    expect(landUnits.length).toBeGreaterThanOrEqual(25);
    expect(landUnits.length).toBeLessThanOrEqual(40);
  });

  it('has unique codes and names within each symbol set', () => {
    for (const { code } of SYMBOL_SETS) {
      const entries = CATALOG.entities.filter((e) => e.symbolSet === code);
      expect(new Set(entries.map((e) => e.entity)).size, code).toBe(entries.length);
      expect(new Set(entries.map((e) => e.name)).size, code).toBe(entries.length);
      for (const entry of entries) {
        expect(entry.entity).toMatch(/^\d{6}$/);
        expect(entry.name.trim()).not.toBe('');
      }
    }
  });

  it('includes the entities the brief names', () => {
    const names = (symbolSet: string) => CATALOG.entities.filter((e) => e.symbolSet === symbolSet).map((e) => e.name);
    for (const name of ['Infantry', 'Armour', 'Field artillery', 'Reconnaissance', 'Engineer', 'Signal', 'Medical', 'Supply', 'Command and control']) {
      expect(names('10')).toContain(name);
    }
    for (const name of ['Fixed wing', 'Rotary wing', 'Fighter', 'Bomber', 'Cargo', 'Tanker', 'Unmanned aerial vehicle']) {
      expect(names('01')).toContain(name);
    }
  });

  it('lists the standard identities 0-6 and the land echelons', () => {
    expect(CATALOG.standardIdentities.map((i) => i.code)).toEqual(['0', '1', '2', '3', '4', '5', '6']);
    expect(CATALOG.echelons.map((e) => e.code)).toEqual(['00', '11', '12', '13', '14', '15', '16', '17', '18', '21', '22', '23', '24', '25', '26']);
  });

  it('is the same frozen object on every call', () => {
    const symbols = createSymbolService({ cacheSize: 10 }).service;
    expect(symbols.catalog()).toBe(symbols.catalog());
    expect(Object.isFrozen(symbols.catalog().entities)).toBe(true);
  });
});

describe('AC7: symbols per symbol set (M4)', () => {
  /** Sets where milsymbol 3.0.4 has fewer than 10 entities: the catalog has all of them (brief function 6). */
  const ALL_MILSYMBOL_HAS: Record<string, number> = { '02': 1, '50': 3, '51': 3, '52': 3, '53': 3, '54': 3 };

  it('covers the 14 symbol sets of the brief, in its order', () => {
    expect(SYMBOL_SETS.map((s) => s.code)).toEqual(['10', '15', '20', '01', '02', '05', '30', '35', '36', '50', '51', '52', '53', '54']);
    expect([...new Set(CATALOG.entities.map((e) => e.symbolSet))]).toEqual(SYMBOL_SETS.map((s) => s.code));
  });

  it.each(SYMBOL_SETS.map((s) => [s.code, s.name] as const))('has at least 10 entries in symbol set %s (%s), or all milsymbol has', (code) => {
    const count = CATALOG.entities.filter((e) => e.symbolSet === code).length;
    const all = ALL_MILSYMBOL_HAS[code];
    if (all === undefined) {
      expect(count).toBeGreaterThanOrEqual(10);
      if (code !== '10') expect(count).toBeLessThanOrEqual(20);
    } else {
      expect(count).toBe(all);
    }
  });

  it('renders every entry with each standard identity as a symbol milsymbol reports valid', () => {
    const symbols = createSymbolService({ cacheSize: 10 }).service;
    let checked = 0;
    for (const standard of ['APP-6D', 'APP-6E'] as const) {
      for (const entry of CATALOG.entities) {
        for (const identity of CATALOG.standardIdentities) {
          const sidc = symbols.compose({ standard, standardIdentity: identity.code, symbolSet: entry.symbolSet, status: '0', hqTaskForceDummy: '0', echelonMobility: '00', entity: entry.entity });
          expect(symbols.validate(standard, sidc), `${entry.name} (${entry.symbolSet}), ${identity.name}: ${sidc}`).toEqual({ valid: true });
          const image = symbols.render({ standard, sidc, size: 30 });
          expect(isDrawn(image.image), `${entry.name} (${entry.symbolSet}), ${identity.name}`).toBe(true);
          checked++;
        }
      }
    }
    expect(checked).toBe(2 * CATALOG.entities.length * CATALOG.standardIdentities.length);
  });
});

describe('modifier names', () => {
  it("are exactly the data model's modifiers (camelCase, as in model/)", () => {
    expect([...MODIFIER_NAMES]).toEqual(modelModifierNames());
    expect(createSymbolService({ cacheSize: 10 }).service.modifierNames).toBe(MODIFIER_NAMES);
  });

  it('map to milsymbol options of the same name, text only when requested', () => {
    const modifiers = { uniqueDesignation: '1', higherFormation: '2 BDE', direction: 45, speed: 10 };
    expect(drawnModifiers(modifiers, false).options).toEqual({ direction: 45 });
    expect(drawnModifiers(modifiers, true).options).toEqual({ uniqueDesignation: '1', higherFormation: '2 BDE', direction: 45, speed: '36 km/h' });
    expect(drawnModifiers(undefined, true).options).toEqual({});
    expect(drawnModifiers({ uniqueDesignation: '1' }, false).options).toEqual({});
  });

  it("ignore the tactical graphics' amplifiers: the same drawing and key as without them", () => {
    const graphic = { dtg1: '051200Z NOV 26', targetNumber: 'AB1234', uniqueDesignation1: 'PL A', uniqueDesignation2: 'PL B', distances: [500], azimuths: [10, 80] };
    const plain = { uniqueDesignation: '1', direction: 45 };
    for (const withText of [false, true]) {
      expect(drawnModifiers({ ...plain, ...graphic }, withText)).toEqual(drawnModifiers(plain, withText));
      expect(drawnModifiers(graphic, withText).key).toBe('');
    }
  });

  it('show speed (metres per second) in whole km/h', () => {
    expect(speedText(0)).toBe('0 km/h');
    expect(speedText(10)).toBe('36 km/h');
    expect(speedText(13.9)).toBe('50 km/h');
  });

  it('round the direction to whole degrees from 0 to 359', () => {
    expect(wholeDegrees(359.6)).toBe(0);
    expect(wholeDegrees(44.5)).toBe(45);
    expect(wholeDegrees(0)).toBe(0);
  });

  it('give equal keys for equal drawings and different keys otherwise', () => {
    const key = (modifiers: Parameters<typeof drawnModifiers>[0], withText = true) => drawnModifiers(modifiers, withText).key;
    expect(key(undefined)).toBe('');
    expect(key({})).toBe('');
    expect(key({ uniqueDesignation: 'a' }, false)).toBe('');
    expect(key({ direction: 0 })).not.toBe(key({}));
    expect(key({ direction: 10.2 })).toBe(key({ direction: 9.8 }));
    expect(key({ uniqueDesignation: 'a' })).toBe(key({ uniqueDesignation: 'a' }));
    expect(key({ uniqueDesignation: 'a' })).not.toBe(key({ higherFormation: 'a' }));
    expect(key({ uniqueDesignation: 'a","higherFormation","b' })).not.toBe(key({ uniqueDesignation: 'a', higherFormation: 'b' }));
    expect(key({ speed: 1 })).not.toBe(key({}));
    expect(key({ direction: 1, uniqueDesignation: '1' })).not.toBe(key({ direction: 11 }));
  });
});
