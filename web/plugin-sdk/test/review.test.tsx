// Tests for the conformance review's points on SDK 1.1.0 (F2 to F6): behaviour through the components'
// handlers, and the fakes a PCA needs. DOM render tests need Testing Library and jsdom as SDK dev
// dependencies, which wait for the lock file on the integration branch.
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { Button, Checkbox, ObjectQueryError, OBJECT_LIST, Select, Tabs } from '../src/index.ts';
import { createFakeContext, createFakeMapView, createFakeObjectListService } from '../src/testing/index.ts';

type Props = { readonly [key: string]: unknown; readonly children?: ReactNode };
const el = (node: ReactNode): ReactElement<Props> => {
  if (!isValidElement<Props>(node)) throw new Error('not an element');
  return node;
};
const kids = (node: ReactNode): ReactElement<Props>[] => {
  const c = el(node).props.children;
  return (Array.isArray(c) ? c.flat(Infinity) : [c]).filter((x): x is ReactElement<Props> => isValidElement(x));
};
const id = (n: number) => `0192a5c4-3b1e-7c2d-9f00-${n.toString(16).padStart(12, '0')}`;

describe('form fields (F6)', () => {
  // The text field's F6 test is a DOM test since SDK 1.2.0 (it uses a hook): test/part1.test.tsx.
  it('a select reports the chosen value, a checkbox its state', () => {
    const chosen: string[] = [];
    const select = kids(el(Select({ label: 'Data type', value: 'core.general', options: [{ value: 'core.general', label: 'General' }, { value: 'cot.cot', label: 'CoT' }], onChange: (v) => void chosen.push(v) })));
    (select[1]?.props['onChange'] as (e: { currentTarget: { value: string } }) => void)({ currentTarget: { value: 'cot.cot' } });
    expect(chosen).toEqual(['cot.cot']);
    const states: boolean[] = [];
    const box = kids(el(Checkbox({ label: 'Hatched', checked: false, onChange: (v) => void states.push(v) })));
    (box[0]?.props['onChange'] as (e: { currentTarget: { checked: boolean } }) => void)({ currentTarget: { checked: true } });
    expect(states).toEqual([true]);
  });
});

describe('keyboard and focus (F2, F4)', () => {
  it('reaches every tab with Tab, and moves the choice with the arrows, Home and End', () => {
    const chosen: string[] = [];
    const tabs = [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }, { value: 'c', label: 'C' }];
    const list = el(Tabs({ label: 'Views', tabs, value: 'b', onChange: (v) => void chosen.push(v) }));
    expect(kids(list).map((t) => t.props['tabIndex'])).toEqual([undefined, undefined, undefined]);
    const key = list.props['onKeyDown'] as (e: { key: string }) => void;
    for (const k of ['ArrowRight', 'ArrowLeft', 'Home', 'End', 'x']) key({ key: k });
    expect(chosen).toEqual(['c', 'a', 'a', 'c']);
    const atEnd = el(Tabs({ label: 'Views', tabs, value: 'c', onChange: (v) => void chosen.push(v) }));
    (atEnd.props['onKeyDown'] as (e: { key: string }) => void)({ key: 'ArrowRight' });
    expect(chosen).toHaveLength(4);
  });

  it('lets a button take the focus when shown (the dialog\'s focus and keys: overlay.test.tsx)', () => {
    expect(el(Button({ children: 'Go', autoFocus: true })).props['autoFocus']).toBe(true);
  });
});

describe('test kit fakes (F3)', () => {
  it('fakes the object-list service', async () => {
    const ctx = createFakeContext({ pluginId: 'layer-panel', uses: [OBJECT_LIST.id] });
    const list = createFakeObjectListService();
    ctx.provideAs(OBJECT_LIST, list);
    (await ctx.services.get(OBJECT_LIST)).open(id(1));
    expect(list.opened).toEqual([id(1)]);
  });

  it('records what draw and edit were called with', () => {
    const map = createFakeMapView();
    void map.draw('rectangle', { style: { fillPattern: 'hatch' } });
    void map.edit(id(2));
    expect(map.drawCalls).toEqual([{ kind: 'rectangle', style: { fillPattern: 'hatch' } }]);
    expect(map.editCalls).toEqual([{ id: id(2) }]);
  });

  it('centres on known positions and reports the others missing (latitude ≠ longitude)', async () => {
    const map = createFakeMapView();
    map.setObjectPositions({ [id(1)]: [18.0, 59.0], [id(2)]: [20.0, 61.0] });
    expect(await map.centreOn([id(1), id(2), id(3)])).toEqual({ missing: [id(3)] });
    expect(map.viewport.center).toEqual([19.0, 60.0]);
    await map.zoomTo([id(1)]);
    expect([map.viewport.center, map.viewport.resolution]).toEqual([[18.0, 59.0], 10]);
  });

  it('rejects a layer query for a layer the server does not know, once layers are set', async () => {
    const ctx = createFakeContext();
    await expect(ctx.objects.queryLayer(id(9))).resolves.toMatchObject({ total: 0 });
    ctx.setServerLayers([id(1)]);
    await expect(ctx.objects.queryLayer(id(9))).rejects.toBeInstanceOf(ObjectQueryError);
  });

  it('answers each id once, and refuses a bad document name when reading too', async () => {
    const ctx = createFakeContext();
    expect(await ctx.objects.get([id(1), id(1)])).toEqual({ found: [], missing: [id(1)] });
    await expect(ctx.userDocuments.get('Bad Name')).rejects.toMatchObject({ problem: 'bad-name' });
  });
});
