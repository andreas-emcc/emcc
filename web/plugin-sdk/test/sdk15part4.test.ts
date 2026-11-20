// SDK 1.5.0 part 4 (CR-0039 point 9; T-171): the classification order in the web context.
import { describe, expect, it } from 'vitest';
import { classificationOrder, NATO_CLASSIFICATIONS, type PluginContext } from '../src/index.ts';
import { createFakeContext } from '../src/testing/index.ts';

describe('SDK 1.5.0 part 4: ctx.classifications (T-171)', () => {
  it('has the NATO order, lowest first, as the Java SDK', () => {
    expect(NATO_CLASSIFICATIONS).toEqual(['UNCLASSIFIED', 'RESTRICTED', 'CONFIDENTIAL', 'SECRET', 'COSMIC TOP SECRET']);
    expect(Object.isFrozen(NATO_CLASSIFICATIONS)).toBe(true);
  });

  it('finds a policy ignoring case, classifications exactly, and none for an unknown policy', () => {
    const orders = { NATO: NATO_CLASSIFICATIONS, 'SE-national': ['ÖPPEN', 'BEGRÄNSAT HEMLIG', 'HEMLIG'] };
    expect(classificationOrder(orders, 'nato')).toBe(NATO_CLASSIFICATIONS);
    expect(classificationOrder(orders, 'NATO')).toBe(NATO_CLASSIFICATIONS);
    expect(classificationOrder(orders, 'se-NATIONAL')).toEqual(['ÖPPEN', 'BEGRÄNSAT HEMLIG', 'HEMLIG']);
    expect(classificationOrder(orders, 'EU')).toEqual([]);
    expect(classificationOrder({}, 'NATO')).toEqual([]);
  });

  it('the fake context gives the NATO order, or another order', () => {
    const ctx: PluginContext = createFakeContext();
    expect(classificationOrder(ctx.classifications, ctx.defaultLabel.policyIdentifier.name)).toEqual(NATO_CLASSIFICATIONS);
    const other = createFakeContext({ classifications: { EU: ['EU RESTRICTED', 'EU SECRET'] } });
    expect(other.classifications).toEqual({ EU: ['EU RESTRICTED', 'EU SECRET'] });
  });
});
