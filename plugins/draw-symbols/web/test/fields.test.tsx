// T-085, part 2 (brief, function 20, criteria 26 to 28, 30 and 31): the declared fields of the selected symbol, with the web SDK's shared
// `DeclaredFields` editor. The store of the tests checks a request's `fields` against the declarations as the object store does.
import { act, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeUser } from '@emc2/plugin-sdk/testing';
import type { DeclaredField, FieldSet, MapObject } from '@emc2/plugin-sdk';
import { coreOf } from '../src/content.ts';
import { FakeServer, layer, symbolObject } from './fakeServer.ts';
import { isolateDocumentListeners, openBrowser, settle, showPanels } from './harness.tsx';
import { commit, select } from './scene.tsx';

isolateDocumentListeners();

// SDK 1.5.0 shows a symbol's fields through its field sets, one set at a time: the test symbols carry `cot.unit`, which has these fields.
const UNIT: FieldSet = { id: 'cot.unit', plugin: 'cot', name: 'unit', label: 'CoT unit', fields: ['callsign', 'team', 'role', 'staleSeconds', 'armed', 'secret'] };
const FIELD_SETS: readonly FieldSet[] = [UNIT];
const FIELDS: readonly DeclaredField[] = [
  { plugin: 'cot', name: 'callsign', type: 'text', label: 'Callsign', editableByOthers: true, maxLength: 12 },
  { plugin: 'cot', name: 'team', type: 'choice', label: 'Team', editableByOthers: true, choices: [{ value: 'blue', label: 'Blue' }, { value: 'red', label: 'Red' }] },
  { plugin: 'cot', name: 'role', type: 'text', label: 'Role', editableByOthers: true },
  { plugin: 'cot', name: 'staleSeconds', type: 'integer', label: 'Stale after', unit: 's', minimum: 1, maximum: 3600, editableByOthers: true },
  { plugin: 'cot', name: 'armed', type: 'boolean', label: 'Armed', editableByOthers: true },
  // not editable by others: shown read only
  { plugin: 'cot', name: 'secret', type: 'text', label: 'Secret', editableByOthers: false },
  // in no field set: never shown
  { plugin: 'cot', name: 'note', type: 'text', label: 'Note', editableByOthers: true },
];

async function scene(options: { readonly user?: ReturnType<typeof createFakeUser>; readonly fields?: readonly DeclaredField[] | undefined; extensions?: MapObject['extensions']; readonly overrides?: Partial<MapObject> } = {}) {
  const lay = layer('Default', 0);
  const server = new FakeServer([lay]);
  server.declaredFields = FIELDS;
  const symbol = server.seed(symbolObject(lay.id, { fieldSets: ['cot.unit'], ...(options.extensions === undefined ? {} : { extensions: options.extensions }), ...options.overrides }));
  const declared = 'fields' in options ? options.fields : FIELDS;
  const one = await openBrowser(server, { fieldSets: FIELD_SETS, ...(declared === undefined ? {} : { declaredFields: declared }), ...(options.user === undefined ? {} : { user: options.user }) });
  const panels = showPanels(one);
  await select(one, symbol.id);
  return { server, lay, symbol, one, panels };
}

const lastUpdate = (server: FakeServer) => server.requests.at(-1) as { fields?: unknown; data: unknown; baseVersion?: number; operation: string };

describe('T-085: the fields shown (criterion 26)', () => {
  it('shows the fields of the set of the symbol, the one set at a time, and not a field that is in no set', async () => {
    const { panels } = await scene();
    expect((panels.properties.getByLabelText('Field set') as HTMLSelectElement).value).toBe('cot.unit');
    for (const label of ['Callsign', 'Team', 'Role', 'Stale after (s)', 'Armed']) expect((panels.properties.getByLabelText(label) as HTMLInputElement).disabled).toBe(false);
    expect((panels.properties.getByLabelText('Secret') as HTMLInputElement).disabled).toBe(true); // others may not edit it: shown read only
    expect(panels.properties.queryByLabelText('Note')).toBeNull(); // in no set
    expect(panels.properties.queryByRole('button', { name: /^Add / })).toBeNull(); // no set left to add
    expect(panels.properties.queryByRole('button', { name: /^Other fields/ })).toBeNull(); // no group (SDK 1.4.0)
  });

  it('a field that is in no set is not shown even when the symbol has a value for it', async () => {
    const { panels } = await scene({ extensions: { cot: { note: 'x' } } });
    expect(panels.properties.queryByLabelText('Note')).toBeNull();
  });

  it('starts afresh for the next symbol selected', async () => {
    const { server, lay, one, panels } = await scene({ extensions: { cot: { role: 'lead' } } });
    expect((panels.properties.getByLabelText('Role') as HTMLInputElement).value).toBe('lead');
    const second = server.seed(symbolObject(lay.id, { fieldSets: ['cot.unit'] }));
    one.map.selection.set([second.id]);
    await settle();
    expect((panels.properties.getByLabelText('Role') as HTMLInputElement).value).toBe('');
  });

  it('shows a field the symbol has a value for', async () => {
    const { panels } = await scene({ extensions: { cot: { role: 'lead' } } });
    expect((panels.properties.getByLabelText('Role') as HTMLInputElement).value).toBe('lead');
  });

  it('shows a field others may not edit with its value, read only', async () => {
    const { panels } = await scene({ extensions: { cot: { secret: 'x' } } });
    const secret = panels.properties.getByLabelText('Secret') as HTMLInputElement;
    expect(secret.value).toBe('x');
    expect(secret.disabled).toBe(true);
  });

  it('does not show a field of a plugin that is gone, and keeps its value on the object', async () => {
    const { server, symbol, one, panels } = await scene({ extensions: { gone: { note: 'x' } } });
    expect(panels.properties.queryByText(/note/i)).toBeNull();
    await commit(panels.properties.getByLabelText('Name') as HTMLInputElement, 'Alpha');
    expect(server.objects.get(symbol.id)?.extensions).toEqual({ gone: { note: 'x' } });
    expect(one.ctx.notifications).toEqual([]);
  });
});

describe('T-085: committing a field (criterion 27)', () => {
  it('a choice sends one update with the complete core content, baseVersion and only that field; clearing sends null', async () => {
    const { server, symbol, panels } = await scene();
    expect(server.requests).toHaveLength(0); // nothing to send for a field without a value
    fireEvent.change(panels.properties.getByLabelText('Team'), { target: { value: 'blue' } });
    await settle();
    expect(server.requests).toHaveLength(1);
    expect(lastUpdate(server)).toMatchObject({ operation: 'update', baseVersion: 1, fields: [{ plugin: 'cot', name: 'team', value: 'blue' }] });
    expect(lastUpdate(server).data).toEqual(coreOf(symbol));
    expect(server.objects.get(symbol.id)?.extensions).toEqual({ cot: { team: 'blue' } });
    fireEvent.change(panels.properties.getByLabelText('Team'), { target: { value: '' } });
    await settle();
    expect(server.requests).toHaveLength(2);
    expect(lastUpdate(server)).toMatchObject({ baseVersion: 2, fields: [{ plugin: 'cot', name: 'team', value: null }] });
    expect(server.objects.get(symbol.id)?.extensions).toBeUndefined();
  });

  it('a text commits on Enter and on leaving the field, not on every key', async () => {
    const { server, panels } = await scene();
    const callsign = panels.properties.getByLabelText('Callsign') as HTMLInputElement;
    fireEvent.change(callsign, { target: { value: 'Ha' } });
    fireEvent.change(callsign, { target: { value: 'Hawk' } });
    await settle();
    expect(server.requests).toHaveLength(0);
    fireEvent.keyDown(callsign, { key: 'Enter' });
    await settle();
    expect(server.requests).toHaveLength(1);
    expect(lastUpdate(server)).toMatchObject({ fields: [{ plugin: 'cot', name: 'callsign', value: 'Hawk' }] });
    fireEvent.change(callsign, { target: { value: 'Eagle' } });
    fireEvent.blur(callsign);
    await settle();
    expect(server.requests).toHaveLength(2);
    expect(lastUpdate(server)).toMatchObject({ fields: [{ plugin: 'cot', name: 'callsign', value: 'Eagle' }] });
  });

  it('Escape drops what was typed', async () => {
    const { server, panels } = await scene({ extensions: { cot: { callsign: 'Hawk' } } });
    const callsign = panels.properties.getByLabelText('Callsign') as HTMLInputElement;
    fireEvent.change(callsign, { target: { value: 'Hawkeye' } });
    fireEvent.keyDown(callsign, { key: 'Escape' });
    await settle();
    expect((panels.properties.getByLabelText('Callsign') as HTMLInputElement).value).toBe('Hawk');
    fireEvent.blur(callsign);
    await settle();
    expect(server.requests).toHaveLength(0);
  });

  it('a yes/no commits at once', async () => {
    const { server, panels } = await scene();
    expect(server.requests).toHaveLength(0);
    fireEvent.click(panels.properties.getByLabelText('Armed'));
    await settle();
    expect(lastUpdate(server)).toMatchObject({ fields: [{ plugin: 'cot', name: 'armed', value: true }] });
    fireEvent.click(panels.properties.getByLabelText('Armed'));
    await settle();
    expect(server.requests).toHaveLength(2);
    expect(lastUpdate(server)).toMatchObject({ fields: [{ plugin: 'cot', name: 'armed', value: false }] }); // set and cleared again: false
  });

  it('a number out of its limits is shown at the field and nothing is sent', async () => {
    const { server, panels } = await scene();
    const stale = panels.properties.getByLabelText('Stale after (s)') as HTMLInputElement;
    fireEvent.change(stale, { target: { value: '99999' } });
    fireEvent.keyDown(stale, { key: 'Enter' });
    await settle();
    expect(server.requests).toHaveLength(0);
    expect(panels.properties.getByText(/above 3600/)).toBeTruthy();
    fireEvent.change(stale, { target: { value: '120' } });
    fireEvent.keyDown(stale, { key: 'Enter' });
    await settle();
    expect(lastUpdate(server)).toMatchObject({ fields: [{ plugin: 'cot', name: 'staleSeconds', value: 120 }] });
  });

  it('a text over its limit is shown at the field and nothing is sent', async () => {
    const { server, panels } = await scene();
    const callsign = panels.properties.getByLabelText('Callsign') as HTMLInputElement;
    fireEvent.change(callsign, { target: { value: 'much too long a callsign' } });
    fireEvent.keyDown(callsign, { key: 'Enter' });
    await settle();
    expect(server.requests).toHaveLength(0);
    expect(panels.properties.getByText(/too long/)).toBeTruthy();
  });

  it('emptying a text field that had a value clears it (null) on Enter', async () => {
    const { server, symbol, panels } = await scene({ extensions: { cot: { role: 'lead' } } });
    await commit(panels.properties.getByLabelText('Role') as HTMLInputElement, '');
    expect(lastUpdate(server)).toMatchObject({ fields: [{ plugin: 'cot', name: 'role', value: null }] });
    expect(server.objects.get(symbol.id)?.extensions).toBeUndefined();
  });

  it('a field typed into and emptied again on a symbol that had no value sends nothing (criterion 42)', async () => {
    const { server, panels } = await scene();
    const role = panels.properties.getByLabelText('Role') as HTMLInputElement;
    fireEvent.change(role, { target: { value: 'lead' } });
    fireEvent.change(role, { target: { value: '' } });
    fireEvent.keyDown(role, { key: 'Enter' });
    fireEvent.blur(role);
    await settle();
    expect(server.requests).toHaveLength(0);
  });

  it('Enter and then leaving the field send the field once while the first request waits', async () => {
    const { server, one, panels } = await scene();
    one.connection.hold = true; // the store does not answer yet
    const callsign = panels.properties.getByLabelText('Callsign') as HTMLInputElement;
    fireEvent.change(callsign, { target: { value: 'Hawk' } });
    fireEvent.keyDown(callsign, { key: 'Enter' });
    fireEvent.blur(callsign);
    await settle();
    expect(server.requests).toHaveLength(1);
    act(() => {
      one.connection.release();
    });
    for (let i = 0; i < 5; i++) await settle(); // the second request, if there were one, waits for the first
    expect(server.requests).toHaveLength(1);
    expect(server.objects.values().next().value?.extensions).toEqual({ cot: { callsign: 'Hawk' } });
  });

  // T-127: a change made while the store has not answered the one before must not be lost.
  it('Team set to Red and at once back to "—" before the store answers: both are sent and the field ends empty', async () => {
    const { server, symbol, one, panels } = await scene();
    one.connection.hold = true;
    fireEvent.change(panels.properties.getByLabelText('Team'), { target: { value: 'red' } });
    fireEvent.change(panels.properties.getByLabelText('Team'), { target: { value: '' } });
    await settle();
    act(() => {
      one.connection.release();
    });
    for (let i = 0; i < 6; i++) await settle();
    expect(server.requests.map((r) => (r as { fields?: unknown }).fields)).toEqual([
      [{ plugin: 'cot', name: 'team', value: 'red' }],
      [{ plugin: 'cot', name: 'team', value: null }],
    ]);
    expect(server.objects.get(symbol.id)?.extensions).toBeUndefined();
    expect((panels.properties.getByLabelText('Team') as HTMLSelectElement).value).toBe('');
  });

  it('Team set to Red, then Blue, before the store answers: the field ends Blue', async () => {
    const { server, symbol, one, panels } = await scene();
    one.connection.hold = true;
    fireEvent.change(panels.properties.getByLabelText('Team'), { target: { value: 'red' } });
    fireEvent.change(panels.properties.getByLabelText('Team'), { target: { value: 'blue' } });
    await settle();
    act(() => {
      one.connection.release();
    });
    for (let i = 0; i < 6; i++) await settle();
    expect(server.objects.get(symbol.id)?.extensions).toEqual({ cot: { team: 'blue' } });
    expect((panels.properties.getByLabelText('Team') as HTMLSelectElement).value).toBe('blue');
  });

  it('a text emptied with Enter before the store has answered its first value is cleared too', async () => {
    const { server, symbol, one, panels } = await scene();
    one.connection.hold = true;
    const callsign = panels.properties.getByLabelText('Callsign') as HTMLInputElement;
    fireEvent.change(callsign, { target: { value: 'Hawk' } });
    fireEvent.keyDown(callsign, { key: 'Enter' });
    fireEvent.change(callsign, { target: { value: '' } });
    fireEvent.keyDown(callsign, { key: 'Enter' });
    await settle();
    act(() => {
      one.connection.release();
    });
    for (let i = 0; i < 6; i++) await settle();
    expect(server.objects.get(symbol.id)?.extensions).toBeUndefined();
    expect(callsign.value).toBe('');
  });

  it('while the second change waits for its answer, the field shows it, not what the first answer set, and a blur does not send it again', async () => {
    const { server, symbol, one, panels } = await scene();
    one.connection.hold = true;
    const callsign = panels.properties.getByLabelText('Callsign') as HTMLInputElement;
    fireEvent.change(callsign, { target: { value: 'Hawk' } });
    fireEvent.keyDown(callsign, { key: 'Enter' });
    fireEvent.change(callsign, { target: { value: '' } });
    fireEvent.keyDown(callsign, { key: 'Enter' });
    await settle();
    act(() => {
      one.connection.release(); // the first answer: the store holds Hawk ...
      one.connection.hold = true; // ... and the second request waits
    });
    for (let i = 0; i < 4; i++) await settle();
    expect(server.requests).toHaveLength(2);
    expect(server.objects.get(symbol.id)?.extensions).toEqual({ cot: { callsign: 'Hawk' } });
    expect((panels.properties.getByLabelText('Callsign') as HTMLInputElement).value).toBe(''); // the newer value stays shown
    fireEvent.blur(callsign);
    await settle();
    expect(server.requests).toHaveLength(2); // not sent a third time
    act(() => {
      one.connection.release();
    });
    for (let i = 0; i < 6; i++) await settle();
    expect(server.requests).toHaveLength(2);
    expect(server.objects.get(symbol.id)?.extensions).toBeUndefined();
  });

  it('a rejection of the store is shown as a notification', async () => {
    const { one, panels } = await scene();
    one.connection.rejectNext.push('VALIDATION_FAILED');
    const callsign = panels.properties.getByLabelText('Callsign') as HTMLInputElement;
    fireEvent.change(callsign, { target: { value: 'Hawk' } });
    fireEvent.keyDown(callsign, { key: 'Enter' });
    await settle();
    expect(one.ctx.notifications.some((n) => n.severity === 'error' && n.message.includes('VALIDATION_FAILED'))).toBe(true);
  });
});

describe('T-085: others\' newer values survive (criterion 28)', () => {
  it('an edit of the name after a second browser set a field leaves that field as it was set', async () => {
    const { server, symbol, panels } = await scene();
    act(() => {
      server.changeElsewhere({ entityType: 'object', operation: 'update', entityId: symbol.id, baseVersion: 1, data: coreOf(symbol), fields: [{ plugin: 'cot', name: 'role', value: 'lead' }] } as never);
    });
    await settle();
    await commit(panels.properties.getByLabelText('Name') as HTMLInputElement, 'Alpha');
    expect(lastUpdate(server)).not.toHaveProperty('fields'); // the request names no field it did not change
    expect(server.objects.get(symbol.id)?.extensions).toEqual({ cot: { role: 'lead' } });
    expect(server.objects.get(symbol.id)?.properties?.name).toBe('Alpha');
  });

  it('a commit of one field names that field only, so another field set meanwhile stays', async () => {
    const { server, symbol, panels } = await scene();
    const callsign = panels.properties.getByLabelText('Callsign') as HTMLInputElement;
    act(() => {
      server.changeElsewhere({ entityType: 'object', operation: 'update', entityId: symbol.id, baseVersion: 1, data: coreOf(symbol), fields: [{ plugin: 'cot', name: 'role', value: 'lead' }] } as never);
    });
    await settle();
    fireEvent.change(callsign, { target: { value: 'Hawk' } });
    fireEvent.keyDown(callsign, { key: 'Enter' });
    await settle();
    expect(lastUpdate(server)).toMatchObject({ fields: [{ plugin: 'cot', name: 'callsign', value: 'Hawk' }] });
    expect(server.objects.get(symbol.id)?.extensions).toEqual({ cot: { role: 'lead', callsign: 'Hawk' } });
  });

  it('a value set elsewhere shows at once, except in the field being typed in', async () => {
    const { server, symbol, panels } = await scene({ extensions: { cot: { role: 'lead' } } });
    const callsign = panels.properties.getByLabelText('Callsign') as HTMLInputElement;
    fireEvent.change(callsign, { target: { value: 'Ha' } }); // typing, not committed
    act(() => {
      server.changeElsewhere({
        entityType: 'object', operation: 'update', entityId: symbol.id, baseVersion: 1, data: coreOf(symbol),
        fields: [{ plugin: 'cot', name: 'role', value: 'scout' }, { plugin: 'cot', name: 'callsign', value: 'Other' }],
      } as never);
    });
    await settle();
    expect((panels.properties.getByLabelText('Role') as HTMLInputElement).value).toBe('scout'); // shown at once
    expect((panels.properties.getByLabelText('Callsign') as HTMLInputElement).value).toBe('Ha'); // being typed in
  });
});

describe('T-085: read only and without declared fields (criteria 30 and 31)', () => {
  it('without the edit permission the fields of the set are shown read only, with their values, and there is no "+"', async () => {
    const user = createFakeUser({ permissions: [] });
    const { panels } = await scene({ user, extensions: { cot: { callsign: 'Hawk' } } });
    const callsign = panels.properties.getByLabelText('Callsign') as HTMLInputElement;
    expect(callsign.value).toBe('Hawk');
    expect(callsign.disabled).toBe(true);
    expect((panels.properties.getByLabelText('Team') as HTMLSelectElement).disabled).toBe(true);
    expect(panels.properties.queryByRole('button', { name: /^Add / })).toBeNull();
  });

  it('without the edit permission a value in a set the symbol lacks is listed in that set, read only', async () => {
    const user = createFakeUser({ permissions: [] });
    const { panels } = await scene({ user, overrides: { fieldSets: [], extensions: { cot: { role: 'lead' } } } });
    const role = panels.properties.getByLabelText('Role') as HTMLInputElement;
    expect(role.value).toBe('lead');
    expect(role.disabled).toBe(true);
    expect(panels.properties.queryByLabelText('Team')).toBeNull(); // only the fields with a value of a set that is not added
  });

  it('with no declared fields the panel shows no field', async () => {
    const { server, panels } = await scene({ fields: [] });
    expect(panels.properties.queryByLabelText('Callsign')).toBeNull();
    await commit(panels.properties.getByLabelText('Name') as HTMLInputElement, 'Alpha');
    expect(server.requests).toHaveLength(1);
    expect(lastUpdate(server)).not.toHaveProperty('fields');
  });
});
