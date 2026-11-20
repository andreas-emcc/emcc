import { describe, expect, it } from 'vitest';
import {
  colorOf, DEFAULT_FORMAT, labelParts, labelText, makeLabel, premadeOf, renamed, sameAs, sections, sectionsOf, shownPolicies, UNDEFINED_COLOR,
  usedBy, valueProblem, withPolicy,
} from './model.ts';

const LIST = ['SWE', 'NOR', 'FIN', 'Exercise Northern Coast'];
const NATO_SET = { id: 'nato', name: 'NATO', classifications: [
  { name: 'COSMIC TOP SECRET', color: '#c7702a' }, { name: 'SECRET', color: '#b8423a' }, { name: 'CONFIDENTIAL', color: '#3d6fb6' },
  { name: 'RESTRICTED', color: '#8a7a3a' }, { name: 'UNCLASSIFIED', color: '#3f9a5c' },
] };
const SWE_SET = { id: 'swe', name: 'Swedish national', classifications: [
  { name: 'KVALIFICERAT HEMLIG', color: '#c7702a' }, { name: 'HEMLIG', color: '#b8423a' }, { name: 'EJ SEKRETESS', color: '#3f9a5c' },
] };
const DEFINITIONS = { classificationSets: [NATO_SET, SWE_SET], policies: [
  { name: 'NATO', classificationSets: ['nato'] }, { name: 'SWE', classificationSets: ['swe', 'nato'] },
] };

describe('Settings › Labeling: premade labels (T-170)', () => {
  it('writes a label as the owner showed it, in the configured form', () => {
    const label = makeLabel('NATO', 'SECRET', new Set(['FIN', 'SWE', 'NOR']), LIST);
    expect(label).toEqual({
      policyIdentifier: { name: 'NATO' }, classification: 'SECRET',
      categories: [{ tagName: 'Releasable To', type: 'permissive', values: ['SWE', 'NOR', 'FIN'] }],
    });
    expect(labelText(label, DEFAULT_FORMAT), 'the values in the list order').toBe('NATO SECRET · REL TO SWE, NOR, FIN');
    expect(labelText(label, { fieldSeparator: ' // ', releasableToSeparator: '/', releasableToPrefix: 'RELEASABLE TO' }))
      .toBe('NATO SECRET // RELEASABLE TO SWE/NOR/FIN');
    const none = makeLabel('NATO', 'UNCLASSIFIED', new Set(), LIST);
    expect(none, 'no category without values').toEqual({ policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' });
    expect(labelText(none, DEFAULT_FORMAT)).toBe('NATO UNCLASSIFIED');
    expect(labelParts(label, DEFAULT_FORMAT), 'the band and the rest').toEqual({ classification: 'NATO SECRET', releasable: 'REL TO SWE, NOR, FIN' });
    expect(labelText(makeLabel('SWE', 'SECRET', new Set(), LIST), DEFAULT_FORMAT), 'the policy\'s name, also from its NATO section (3b Q2)')
      .toBe('SWE SECRET');
  });

  it('finds the same label whatever the order of its values, ignoring case', () => {
    const labels = [makeLabel('NATO', 'SECRET', new Set(['SWE', 'NOR']), LIST), makeLabel('NATO', 'SECRET', new Set(), LIST)];
    expect(sameAs(labels, makeLabel('NATO', 'SECRET', new Set(['NOR', 'SWE']), ['NOR', 'SWE']))).toBe(0);
    expect(sameAs(labels, makeLabel('NATO', 'SECRET', new Set(['nor', 'swe']), ['nor', 'swe']))).toBe(0);
    expect(sameAs(labels, makeLabel('NATO', 'SECRET', new Set(), LIST))).toBe(1);
    expect(sameAs(labels, makeLabel('NATO', 'SECRET', new Set(), LIST), 1), 'itself while edited').toBe(-1);
    expect(sameAs(labels, makeLabel('NATO', 'RESTRICTED', new Set(['SWE', 'NOR']), LIST))).toBe(-1);
  });

  it('refuses an empty, overlong or listed value, ignoring case', () => {
    expect(valueProblem(LIST, 'DNK')).toBeNull();
    expect(valueProblem(LIST, '  ')).toMatch(/^Write a value/);
    expect(valueProblem(LIST, 'x'.repeat(129))).toBe('A value has at most 128 characters.');
    expect(valueProblem(LIST, ' swe ')).toBe('swe is in the list already.');
    expect(valueProblem(LIST, 'Swe', 'SWE'), 'renaming a value to itself').toBeNull();
  });

  it('groups the labels by section, then by classification, highest first, then the ones the definitions no longer have (A3, A4)', () => {
    const sets = sectionsOf(DEFINITIONS, 'SWE');
    expect(sets.map((s) => s.name), 'national, then NATO (owner OY)').toEqual(['Swedish national', 'NATO']);
    const labels = [
      makeLabel('SWE', 'RESTRICTED', new Set(), LIST), makeLabel('SWE', 'HEMLIG', new Set(['SWE']), LIST),
      makeLabel('SWE', 'SECRET+', new Set(), LIST), makeLabel('SWE', 'SECRET', new Set(), LIST), makeLabel('SWE', 'KVALIFICERAT HEMLIG', new Set(), LIST),
    ];
    expect(sections(labels, sets).map((s) => [s.set?.id ?? null, s.groups.map((g) => [g.classification, g.labels.map((l) => l.index)])])).toEqual([
      ['swe', [['KVALIFICERAT HEMLIG', [4]], ['HEMLIG', [1]]]],
      ['nato', [['SECRET', [3]], ['RESTRICTED', [0]]]],
      [null, [[null, [2]]]],
    ]);
    expect(sections([], sets)).toEqual([]);
    expect(sectionsOf(DEFINITIONS, 'OLD')).toEqual([]);
  });

  it('gives each classification its colour, and grey to one no longer defined', () => {
    const sets = sectionsOf(DEFINITIONS, 'SWE');
    expect(colorOf(sets, 'HEMLIG')).toBe('#b8423a');
    expect(colorOf(sets, 'CONFIDENTIAL')).toBe('#3d6fb6');
    expect(colorOf(sets, 'OGRADERAD')).toBe(UNDEFINED_COLOR);
  });

  it('renames a value in the list and in every label, and counts the labels that use it', () => {
    const part = { releasableTo: ['SWE', 'NOR'], labels: [makeLabel('NATO', 'SECRET', new Set(['SWE', 'NOR']), ['SWE', 'NOR']), makeLabel('NATO', 'SECRET', new Set(), [])] };
    expect(usedBy(part.labels, 'NOR')).toBe(1);
    const changed = renamed(part, 'NOR', 'NORWAY');
    expect(changed.releasableTo).toEqual(['SWE', 'NORWAY']);
    expect(changed.labels.map((l) => labelText(l, DEFAULT_FORMAT))).toEqual(['NATO SECRET · REL TO SWE, NORWAY', 'NATO SECRET']);
  });

  it('keeps a policy in its place, drops an emptied one, and shows the configured policies first', () => {
    const premade = { policies: { NATO: { releasableTo: ['SWE'], labels: [] }, OLD: { releasableTo: ['X'], labels: [] } } };
    expect(Object.keys(withPolicy(premade, 'NATO', { releasableTo: ['NOR'], labels: [] }).policies)).toEqual(['NATO', 'OLD']);
    expect(Object.keys(withPolicy(premade, 'NATO', { releasableTo: [], labels: [] }).policies)).toEqual(['OLD']);
    expect(Object.keys(withPolicy(premade, 'SWE', { releasableTo: ['NOR'], labels: [] }).policies)).toEqual(['NATO', 'OLD', 'SWE']);
    expect(shownPolicies(premade, { ...DEFINITIONS, policies: [...DEFINITIONS.policies].reverse() })).toEqual(['SWE', 'NATO', 'OLD']);
  });

  it('reads the server\'s answer, and none from one of another form', () => {
    expect(premadeOf({ policies: { NATO: { releasableTo: ['SWE'] } } })).toEqual({ policies: { NATO: { releasableTo: ['SWE'], labels: [] } } });
    expect(premadeOf([])).toEqual({ policies: {} });
    expect(premadeOf({ policies: [] })).toEqual({ policies: {} });
  });
});
