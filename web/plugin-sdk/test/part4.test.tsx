// @vitest-environment jsdom
// SDK 1.2.0 part 4 (CR-0025, ADR-0038): declared fields: the value checks, the helpers for an
// editor, changeRequests.withFields, the fake's check and application of fields, and the shared
// DeclaredFields editor (SDK 1.4.0: the field-set editor, CR-0030 part 3).
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  changedFields, changeRequests, declaredFieldProblem, DeclaredFields, fieldBelongsTo, fieldEditableBy, fieldProblems, fieldValuesOf, parseFieldNumber,
  type DeclaredField, type FieldSet, type FieldValue, type MapObject, type MapObjectContent,
} from '../src/index.ts';
import { createFakeContext } from '../src/testing/index.ts';

afterEach(cleanup);

const CALLSIGN: DeclaredField = { plugin: 'cot', name: 'callsign', type: 'text', label: 'Callsign', maxLength: 5, editableByOthers: true };
const ROLE: DeclaredField = {
  plugin: 'cot', name: 'role', type: 'choice', label: 'Role', required: true, editableByOthers: true, dataTypes: ['core.general'],
  choices: [{ value: 'team-member', label: 'Team member' }, { value: 'hq', label: 'HQ' }],
};
const STALE: DeclaredField = { plugin: 'cot', name: 'staleAfter', type: 'integer', label: 'Stale after', unit: 's', minimum: 1 };
const SPEED: DeclaredField = { plugin: 'simulator', name: 'cruiseSpeed', type: 'number', label: 'Cruise speed', unit: 'm/s', minimum: 0, maximum: 340, editableByOthers: true };
const HIDE: DeclaredField = { plugin: 'simulator', name: 'hidden', type: 'boolean', label: 'Hidden', editableByOthers: true };
const FIELDS = [CALLSIGN, ROLE, STALE, SPEED, HIDE];

// lon differs from lat, so a swapped order would show
const content: MapObjectContent = {
  type: 'core.symbol', dataType: 'core.general', dataSource: 'manual', layerId: '0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e01',
  geometry: { type: 'Point', coordinates: [18.0723, 59.3311] }, symbol: { standard: 'APP-6D', sidc: '10061000001211000000' },
  label: { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' },
  extensions: { cot: { callsign: 'ALPHA', other: 'kept' }, simulator: { cruiseSpeed: 12.5 } },
};
const object: MapObject = {
  ...content, id: '0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e16', version: 3,
  meta: { created: { at: '2026-01-01T00:00:00Z', by: { plugin: 'draw-symbols' } }, modified: { at: '2026-01-01T00:00:00Z', by: { plugin: 'draw-symbols' } } },
};

describe('declared field values (SDK 1.2.0)', () => {
  it('are checked as the object store checks them', () => {
    expect(declaredFieldProblem(CALLSIGN, 'ALPHA')).toBeNull();
    expect(declaredFieldProblem(CALLSIGN, 'ALPHA-1')).toContain('too long');
    expect(declaredFieldProblem(CALLSIGN, 1)).toContain('text');
    expect(declaredFieldProblem(CALLSIGN, null)).toBeNull();
    expect(declaredFieldProblem(ROLE, null)).toContain('required');
    expect(declaredFieldProblem(ROLE, 'boss')).toContain('no choice');
    expect(declaredFieldProblem(STALE, 1.5)).toContain('whole');
    expect(declaredFieldProblem(STALE, 0)).toBe('Stale after is below 1 s');
    expect(declaredFieldProblem(SPEED, 341)).toBe('Cruise speed is above 340 m/s');
    // The same value as the Java SDK's test: JSON reads it as Infinity, which is refused.
    expect(declaredFieldProblem(SPEED, JSON.parse('1e999999999') as number)).toBe('Cruise speed must be a number');
    expect(declaredFieldProblem(SPEED, JSON.parse('-1e999999999') as number)).toBe('Cruise speed must be a number');
    expect(declaredFieldProblem(STALE, parseFieldNumber('1e999999999'))).toBe('Stale after must be a number');
    expect(declaredFieldProblem(SPEED, Number.NaN)).toContain('number');
    expect(declaredFieldProblem(HIDE, 'yes')).toContain('yes or no');
  });

  it('belong to data types and are editable by others or by their own plugin', () => {
    expect(fieldBelongsTo(ROLE, 'core.general')).toBe(true);
    expect(fieldBelongsTo(ROLE, 'cot.cot')).toBe(false);
    expect(fieldBelongsTo(CALLSIGN, 'cot.cot')).toBe(true);
    expect(fieldEditableBy(STALE, 'draw-symbols')).toBe(false);
    expect(fieldEditableBy(STALE, 'cot')).toBe(true);
  });

  it('are read from an object, and only what changed goes into the request', () => {
    const start = fieldValuesOf(object, FIELDS);
    expect(start).toEqual([{ plugin: 'cot', name: 'callsign', value: 'ALPHA' }, { plugin: 'simulator', name: 'cruiseSpeed', value: 12.5 }]);
    const edited: FieldValue[] = [
      { plugin: 'cot', name: 'callsign', value: 'ALPHA' },
      { plugin: 'cot', name: 'role', value: 'hq' },
      { plugin: 'simulator', name: 'hidden', value: null },
    ];
    expect(changedFields(start, edited)).toEqual([
      { plugin: 'cot', name: 'role', value: 'hq' },
      { plugin: 'simulator', name: 'cruiseSpeed', value: null },
    ]);
  });
});

describe('changeRequests.withFields (SDK 1.2.0)', () => {
  const fields: FieldValue[] = [{ plugin: 'cot', name: 'callsign', value: 'ALPHA' }];

  it('adds the fields to an object create or update and keeps the rest', () => {
    const update = changeRequests.withFields(changeRequests.updateObject(object, content), fields);
    expect(update).toEqual({ ...changeRequests.updateObject(object, content), fields });
    const create = changeRequests.withFields(changeRequests.createObject(object.id, content, { system: 'cot', id: 'u1' }), fields);
    expect(create).toMatchObject({ operation: 'create', externalRef: { system: 'cot', id: 'u1' }, fields });
    expect(changeRequests.withFields(update, [])).not.toHaveProperty('fields');
  });

  it('refuses anything but an object create or update, and more than 64 fields', () => {
    expect(() => changeRequests.withFields(changeRequests.deleteObject(object), fields)).toThrow('declared fields');
    expect(() => changeRequests.withFields(changeRequests.createLayer(object.id, { name: 'L', drawOrder: 1, visible: true, label: content.label }), fields)).toThrow(
      'declared fields',
    );
    expect(() => changeRequests.withFields(changeRequests.updateObject(object, content), Array.from({ length: 65 }, () => fields[0]!))).toThrow('at most 64');
  });
});

describe('the fake checks and applies declared fields (SDK 1.2.0)', () => {
  it('applies valid fields after the content: a value sets, null removes', async () => {
    const ctx = createFakeContext({ pluginId: 'draw-symbols', declaredFields: FIELDS });
    expect(ctx.declaredFields).toEqual(FIELDS);
    const outcome = await ctx.changes.submit(
      changeRequests.withFields(changeRequests.updateObject(object, content), [
        { plugin: 'cot', name: 'role', value: 'hq' },
        { plugin: 'simulator', name: 'cruiseSpeed', value: null },
      ]),
    );
    expect(outcome.outcome).toBe('applied');
    const state = outcome.outcome === 'applied' ? (outcome.event.state as MapObject) : null;
    expect(state?.extensions).toEqual({ cot: { callsign: 'ALPHA', other: 'kept', role: 'hq' } });
  });

  it.each([
    [[{ plugin: 'cot', name: 'staleAfter', value: 60 }], '/fields/0', 'not editable by others'],
    [[{ plugin: 'cot', name: 'colour', value: 'red' }], '/fields/0', 'no plugin declares'],
    [[{ plugin: 'cot', name: 'callsign', value: 'A' }, { plugin: 'cot', name: 'callsign', value: 'B' }], '/fields/1', 'listed twice'],
    [[{ plugin: 'cot', name: 'role', value: null }], '/fields/0', 'required'],
  ] as const)('rejects %j at %s', async (fields, path, problem) => {
    const ctx = createFakeContext({ pluginId: 'draw-symbols', declaredFields: FIELDS });
    const outcome = await ctx.changes.submit(changeRequests.withFields(changeRequests.updateObject(object, content), fields));
    expect(outcome.outcome).toBe('rejected');
    if (outcome.outcome !== 'rejected') return;
    expect(outcome.rejection.code).toBe('VALIDATION_FAILED');
    expect(outcome.rejection.details?.[0]?.path).toBe(path);
    expect(outcome.rejection.details?.[0]?.problem).toContain(problem);
  });

  it('lets a plugin set its own fields that others may not', async () => {
    const ctx = createFakeContext({ pluginId: 'cot', declaredFields: FIELDS });
    const outcome = await ctx.changes.submit(changeRequests.withFields(changeRequests.updateObject(object, content), [{ plugin: 'cot', name: 'staleAfter', value: 60 }]));
    expect(outcome.outcome).toBe('applied');
  });
});

const UNIT: FieldSet = { id: 'cot.unit', plugin: 'cot', name: 'unit', label: 'CoT unit', fields: ['callsign', 'role', 'staleAfter'] };
const MOTION: FieldSet = { id: 'simulator.motion', plugin: 'simulator', name: 'motion', label: 'Simulator motion', fields: ['cruiseSpeed', 'hidden'] };
const SETS = [UNIT, MOTION];
const DATA_TYPES = [{ id: 'cot.cot', fieldSets: ['cot.unit'] }, { id: 'simulator.drone', fieldSets: ['simulator.motion'] }];

function Editor(props: {
  readonly start: readonly FieldValue[];
  readonly sets?: readonly string[];
  readonly readOnly?: boolean;
  readonly pluginId?: string;
  readonly seen?: FieldValue[][];
  readonly added?: string[];
  readonly noAdd?: boolean;
  readonly dataType?: string;
  readonly switchTo?: string;
}) {
  const [values, setValues] = useState(props.start);
  const [sets, setSets] = useState(props.sets ?? []);
  const [dataType, setDataType] = useState(props.dataType ?? 'core.general');
  return (
    <>
    {props.switchTo === undefined ? null : <button type="button" onClick={() => setDataType(props.switchTo!)}>Switch data type</button>}
    <DeclaredFields
      fields={FIELDS}
      fieldSets={SETS}
      objectSets={sets}
      values={values}
      dataType={dataType}
      dataTypes={DATA_TYPES}
      {...(props.pluginId === undefined ? {} : { pluginId: props.pluginId })}
      {...(props.readOnly === undefined ? {} : { readOnly: props.readOnly })}
      {...(props.noAdd === true ? {} : {
        onAddSet: (id: string) => {
          props.added?.push(id);
          setSets([...sets, id]);
        },
      })}
      onChange={(v) => {
        props.seen?.push([...v]);
        setValues(v);
      }}
    />
    </>
  );
}

describe('declared field helpers for sending (SDK 1.2.0)', () => {
  it('parse typed numbers strictly, with a point or a comma', () => {
    expect(parseFieldNumber('')).toBeNull();
    expect(parseFieldNumber(' 12.5 ')).toBe(12.5);
    expect(parseFieldNumber('12,5')).toBe(12.5);
    expect(parseFieldNumber('12.')).toBe(12);
    expect(parseFieldNumber('-1e3')).toBe(-1000);
    expect(parseFieldNumber('0x1F')).toBeNaN();
    expect(parseFieldNumber('fast')).toBeNaN();
  });

  it('list what breaks a declaration, and withFields refuses a number JSON cannot carry', () => {
    expect(fieldProblems(FIELDS, [{ plugin: 'simulator', name: 'cruiseSpeed', value: Number.NaN }, { plugin: 'cot', name: 'nope', value: 'x' }]).map((p) => p.problem)).toEqual([
      'Cruise speed must be a number', 'no plugin declares the field cot.nope',
    ]);
    expect(fieldProblems(FIELDS, [{ plugin: 'cot', name: 'callsign', value: 'ALPHA' }])).toEqual([]);
    const roleEmpty = [{ plugin: 'cot', name: 'role', value: null }];
    expect(fieldProblems(FIELDS, roleEmpty, [])).toEqual([]); // added and still empty: nothing to send
    expect(fieldProblems(FIELDS, roleEmpty, [{ plugin: 'cot', name: 'role', value: 'hq' }]).map((p) => p.problem)).toEqual(['Role is required']);
    expect(fieldProblems(FIELDS, roleEmpty).map((p) => p.problem)).toEqual(['Role is required']);
    expect(() => changeRequests.withFields(changeRequests.updateObject(object, content), [{ plugin: 'simulator', name: 'cruiseSpeed', value: Number.NaN }])).toThrow(
      'not a number',
    );
  });

  it('send null for a field the edit removed', () => {
    expect(changedFields([{ plugin: 'cot', name: 'callsign', value: 'ALPHA' }], [])).toEqual([{ plugin: 'cot', name: 'callsign', value: null }]);
    expect(changedFields([], [{ plugin: 'cot', name: 'callsign', value: null }])).toEqual([]);
  });
});

describe('DeclaredFields (SDK 1.5.0: one field set at a time, CR-0038 point 5)', () => {
  const group = (page: ReturnType<typeof render>) => page.queryAllByRole('group').map((g) => g.getAttribute('aria-label'));
  const choice = (page: ReturnType<typeof render>) => page.queryByRole('combobox', { name: 'Field set' }) as HTMLSelectElement | null;
  const listed = (page: ReturnType<typeof render>) => [...(choice(page)?.options ?? [])].map((o) => o.textContent);

  it('shows a required choice without a value as blank, a stored value outside the choices as a problem, and no Remove', () => {
    const page = render(<Editor start={[{ plugin: 'cot', name: 'role', value: 'boss' }]} sets={['cot.unit']} />);
    const role = page.getByRole('combobox', { name: 'Role' }) as HTMLSelectElement;
    expect(role.value).toBe('');
    expect((within(role).getByRole('option', { name: '—' }) as HTMLOptionElement).disabled).toBe(true);
    expect(page.getByText('Role has no choice boss')).toBeTruthy();
    expect(page.queryByRole('button', { name: /^Remove/ })).toBeNull();
    expect(page.queryByRole('button', { name: /^Other fields/ })).toBeNull();
  });

  it('shows only the chosen set, opening on the first set of the data type, and a field\'s dataTypes gives no group', () => {
    const page = render(<Editor start={[]} sets={['simulator.motion', 'cot.unit']} dataType="cot.cot" />);
    expect(listed(page)).toEqual(['Simulator motion', 'CoT unit']);
    expect(choice(page)?.value).toBe('cot.unit');
    expect(group(page)).toEqual(['CoT unit']);
    expect(page.getAllByRole('combobox', { name: 'Role' })).toHaveLength(1); // in CoT unit, not first by its deprecated dataTypes
    expect((page.getByRole('textbox', { name: 'Stale after (s)' }) as HTMLInputElement).disabled).toBe(true); // only cot sets it
    expect(page.queryByRole('textbox', { name: 'Cruise speed (m/s)' })).toBeNull();
    fireEvent.change(choice(page)!, { target: { value: 'simulator.motion' } });
    expect(group(page)).toEqual(['Simulator motion']);
    expect(page.getByRole('textbox', { name: 'Cruise speed (m/s)' })).toBeTruthy();
    expect(page.getByRole('checkbox', { name: 'Hidden' })).toBeTruthy();
    expect(page.queryByRole('textbox', { name: 'Callsign' })).toBeNull();
    cleanup();
    const general = render(<Editor start={[]} sets={['simulator.motion', 'cot.unit']} />);
    expect(choice(general)?.value).toBe('simulator.motion'); // core.general has no set: the first in the list
    cleanup();
    const own = render(<Editor start={[]} sets={['cot.unit']} pluginId="cot" />);
    expect((own.getByRole('textbox', { name: 'Stale after (s)' }) as HTMLInputElement).disabled).toBe(false);
  });

  it('chooses the new data type\'s first set when the data type changes', () => {
    const page = render(<Editor start={[]} sets={['simulator.motion', 'cot.unit']} dataType="cot.cot" switchTo="simulator.drone" />);
    fireEvent.change(choice(page)!, { target: { value: 'cot.unit' } });
    fireEvent.click(page.getByRole('button', { name: 'Switch data type' }));
    expect(choice(page)?.value).toBe('simulator.motion');
  });

  it('has no drop-down without a set, and the "+" offers the sets the object lacks, then chooses the added one', () => {
    const added: string[] = [];
    const page = render(<Editor start={[]} added={added} />);
    expect(choice(page)).toBeNull();
    expect(group(page)).toEqual([]);
    fireEvent.click(page.getByRole('button', { name: 'Add a field set' }));
    const menu = page.getByRole('menu', { name: 'Field sets to add' });
    expect(within(menu).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['CoT unit', 'Simulator motion']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Simulator motion' }));
    expect(added).toEqual(['simulator.motion']);
    expect(page.queryByRole('menu')).toBeNull();
    expect(listed(page)).toEqual(['Simulator motion']);
    expect(group(page)).toEqual(['Simulator motion']);
    fireEvent.click(page.getByRole('button', { name: 'Add a field set' }));
    expect(within(page.getByRole('menu')).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['CoT unit']);
    fireEvent.click(page.getByRole('menuitem', { name: 'CoT unit' }));
    expect(choice(page)?.value).toBe('cot.unit');
    expect(page.queryByRole('button', { name: 'Add a field set' })).toBeNull(); // nothing left to add
  });

  it('lists a set the object lacks but has values for, read only, until it is added, and hides an undeclared set', () => {
    const page = render(<Editor start={[{ plugin: 'cot', name: 'callsign', value: 'ALPHA' }]} sets={['removed.unit']} />);
    expect(listed(page)).toEqual(['CoT unit (not added)']);
    const callsign = page.getByRole('textbox', { name: 'Callsign' }) as HTMLInputElement;
    expect(callsign.value).toBe('ALPHA');
    expect(callsign.disabled).toBe(true);
    expect(page.queryByRole('combobox', { name: 'Role' })).toBeNull(); // only the fields with a value
    fireEvent.click(page.getByRole('button', { name: 'Add a field set' }));
    fireEvent.click(page.getByRole('menuitem', { name: 'CoT unit' }));
    expect(listed(page)).toEqual(['CoT unit']);
    expect((page.getByRole('textbox', { name: 'Callsign' }) as HTMLInputElement).disabled).toBe(false);
  });

  it('has no "+" when read only or without onAddSet, but still lets one choose the set to see', () => {
    const ro = render(<Editor start={[{ plugin: 'cot', name: 'callsign', value: 'ALPHA' }]} sets={['cot.unit', 'simulator.motion']} readOnly />);
    expect(ro.queryByRole('button', { name: 'Add a field set' })).toBeNull();
    expect(listed(ro)).toEqual(['CoT unit', 'Simulator motion']);
    expect((ro.getByRole('textbox', { name: 'Callsign' }) as HTMLInputElement).disabled).toBe(true);
    cleanup();
    const none = render(<Editor start={[]} noAdd />);
    expect(choice(none)).toBeNull();
    expect(none.queryByRole('button', { name: 'Add a field set' })).toBeNull();
  });

  it('takes typed numbers, clears an emptied field, and sends only what changed', () => {
    const seen: FieldValue[][] = [];
    const page = render(<Editor start={[]} sets={['simulator.motion']} seen={seen} />);
    const speed = page.getByRole('textbox', { name: 'Cruise speed (m/s)' }) as HTMLInputElement;
    fireEvent.change(speed, { target: { value: '12.' } });
    expect(speed.value).toBe('12.');
    fireEvent.change(speed, { target: { value: '12.5' } });
    expect(seen.at(-1)).toEqual([{ plugin: 'simulator', name: 'cruiseSpeed', value: 12.5 }]);
    fireEvent.change(speed, { target: { value: '400' } });
    expect(page.getByText('Cruise speed is above 340 m/s')).toBeTruthy();
    fireEvent.change(speed, { target: { value: 'fast' } });
    expect(page.getByText('Cruise speed must be a number')).toBeTruthy();
    expect(seen.at(-1)?.[0]?.value).toBeNaN(); // passed on, so that the caller's check refuses it
    fireEvent.change(speed, { target: { value: '' } });
    const emptied = seen.at(-1) ?? [];
    expect(emptied).toEqual([{ plugin: 'simulator', name: 'cruiseSpeed', value: null }]);
    expect(changedFields([], emptied)).toEqual([]); // never set: nothing is sent
    fireEvent.click(page.getByRole('checkbox', { name: 'Hidden' }));
    fireEvent.click(page.getByRole('checkbox', { name: 'Hidden' }));
    expect(changedFields([], seen.at(-1) ?? [])).toEqual([{ plugin: 'simulator', name: 'hidden', value: false }]); // set and cleared: false
  });
});
