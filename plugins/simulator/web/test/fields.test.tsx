// The fields list in the Event panel (brief function 35, criterion 51; replaces function 26's groups
// and criterion 34; the owner, 2026-10-31, A87 to A90): SDK 1.5.0's field-set editor shows one set
// at a time, in a drop-down of every declared set, all of which an event may set (the owner,
// 2026-11-06), opening on the first set of the data type the event's objects share; no "+"; and only
// what the user changed in the event.
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { DeclaredField, FieldSet, MapObject } from '@emc2/plugin-sdk';
import { summary } from '../src/events.ts';
import { activated, feedPicture, groups, lastExtension, panel, route, ROUTE_A, routeInfo, settled, SIM_LAYER, symbol, TRACK_1, TRACK_2, VIEW } from './harness.tsx';
import type { Rig } from './harness.tsx';

afterEach(() => {
  cleanup();
});

const TEAM: DeclaredField = {
  plugin: 'cot', name: 'team', type: 'choice', label: 'Team', editableByOthers: true,
  choices: [{ value: 'Cyan', label: 'Cyan' }, { value: 'Red', label: 'Red' }],
};
const ROLE: DeclaredField = { plugin: 'cot', name: 'role', type: 'text', label: 'Role', editableByOthers: true };
const RANGE: DeclaredField = { plugin: 'radar', name: 'range', type: 'number', label: 'Range', unit: 'km', editableByOthers: true };
/** In no field set: the field-set editor does not show it. */
const STALE: DeclaredField = { plugin: 'cot', name: 'staleSeconds', type: 'number', label: 'Stale time', unit: 's', editableByOthers: true };
const FIELDS = [TEAM, ROLE, RANGE, STALE];
const SETS: readonly FieldSet[] = [
  { id: 'cot.unit', plugin: 'cot', name: 'unit', label: 'CoT unit', fields: ['team', 'role'] },
  { id: 'radar.sensor', plugin: 'radar', name: 'sensor', label: 'Radar', fields: ['range'] },
];
/** A fake plugin's data type whose first set is the second in the list. */
const RADAR_PLATFORM = 'radar.platform';
const DATA_TYPES = [{ id: RADAR_PLATFORM, name: 'Radar platform', declaredBy: 'radar', defaults: {}, fieldSets: ['radar.sensor'], manual: true }];

function radarTrack(id: string): MapObject {
  return { ...symbol(id, SIM_LAYER), dataType: RADAR_PLATFORM };
}

async function editing(events: readonly unknown[] = [], permissions?: readonly string[], tracks: readonly MapObject[] = [symbol(TRACK_1, SIM_LAYER)]): Promise<Rig> {
  const rig = await activated({ declaredFields: FIELDS, fieldSets: SETS, dataTypes: DATA_TYPES, ...(permissions === undefined ? {} : { permissions }) });
  feedPicture(rig.ctx, [route(ROUTE_A, 'Alpha', { groups: groups(...tracks.map((t) => t.id)), points: [{ speed: 8.33, events: events as never }, { speed: 8.33 }] }), ...tracks]);
  rig.server.on('GET', `routes/${ROUTE_A}`, { status: 200, body: routeInfo(ROUTE_A, 'Alpha') });
  await rig.ctx.runObjectAction('edit-route', [ROUTE_A]);
  const Editor = panel(rig.ctx, 'route-editor');
  render(<Editor />);
  await screen.findByRole('region', { name: 'Point 1' });
  return rig;
}

/** Opens an event with the button of that name, and shows the Event panel the first time. */
function openEvent(rig: Rig, button: string): void {
  fireEvent.click(screen.getByRole('button', { name: button }));
  if (screen.queryByRole('button', { name: 'Save' }) === null) {
    const Event = panel(rig.ctx, 'event');
    render(<Event />);
  }
}

function fieldSet(): HTMLSelectElement {
  return screen.getByLabelText<HTMLSelectElement>('Field set');
}

/** The labels of the drop-down's sets, and the one chosen. */
function sets(): { readonly listed: readonly string[]; readonly chosen: string | undefined } {
  const select = fieldSet();
  return { listed: [...select.options].map((o) => o.text), chosen: select.selectedOptions[0]?.text };
}

function choose(label: string): void {
  const option = [...fieldSet().options].find((o) => o.text === label);
  fireEvent.change(fieldSet(), { target: { value: option?.value } });
}

async function save(rig: Rig): Promise<unknown> {
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await settled();
  });
  return (lastExtension(rig.ctx)['points'] as { events?: { fields?: unknown }[] }[])[0]?.events?.at(-1)?.fields;
}

describe('the fields list, one set at a time (criterion 51; SDK 1.5.0 part 1)', () => {
  it("shows a drop-down of both sets with no \"+\", opens on the list's first set for core.general, and shows only the chosen set's fields", async () => {
    const rig = await editing();
    openEvent(rig, 'Add event at point 1');
    expect(sets()).toEqual({ listed: ['CoT unit', 'Radar'], chosen: 'CoT unit' });
    expect(screen.queryByRole('button', { name: 'Add a field set' })).toBeNull();
    const team = screen.getByLabelText('Team');
    expect(team.compareDocumentPosition(screen.getByLabelText('Role')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByLabelText(/^Range/)).toBeNull();
    choose('Radar');
    expect(screen.getByLabelText(/^Range/)).toBeDefined();
    expect(screen.queryByLabelText('Team')).toBeNull();
    expect(screen.queryByLabelText(/^Stale time/)).toBeNull();
  });

  it("opens on the first set of the data type the objects share, and on core.general's when they share none", async () => {
    const rig = await editing([], undefined, [radarTrack(TRACK_1)]);
    openEvent(rig, 'Add event at point 1');
    expect(sets().chosen).toBe('Radar');
    cleanup();
    const mixed = await editing([], undefined, [radarTrack(TRACK_1), symbol(TRACK_2, SIM_LAYER)]);
    openEvent(mixed, 'Add event at point 1');
    expect(sets().chosen).toBe('CoT unit');
    // Choosing only the radar platform: the type they share is radar.platform.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Track 1' }));
    expect(sets().chosen).toBe('Radar');
  });

  it("names only cot's team when the event sets it, and nothing for a field emptied that it did not have", async () => {
    const rig = await editing();
    openEvent(rig, 'Add event at point 1');
    fireEvent.change(screen.getByLabelText('Team'), { target: { value: 'Cyan' } });
    choose('Radar');
    const range = screen.getByLabelText(/^Range/);
    fireEvent.change(range, { target: { value: '12' } });
    fireEvent.change(range, { target: { value: '' } });
    expect(await save(rig)).toEqual([{ plugin: 'cot', name: 'team', value: 'Cyan' }]);
  });

  it('shows a field the event had, and keeps it when emptied as a clear', async () => {
    const rig = await editing([{ kind: 'set', fields: [{ plugin: 'cot', name: 'role', value: 'Medic' }] }]);
    openEvent(rig, 'Edit event 1 at point 1');
    const role = screen.getByLabelText<HTMLInputElement>('Role');
    expect(role.value).toBe('Medic');
    fireEvent.change(role, { target: { value: '' } });
    const fields = await save(rig);
    expect(fields).toEqual([{ plugin: 'cot', name: 'role', value: null }]);
    expect(summary({ kind: 'set', fields: fields as never }, FIELDS)).toBe('Change clear Role (cot) · all');
  });

  it('starts afresh for each event it opens (A87), and is read only without the edit right', async () => {
    const rig = await editing([{ kind: 'set', fields: [{ plugin: 'cot', name: 'role', value: 'Medic' }] }]);
    openEvent(rig, 'Edit event 1 at point 1');
    expect(screen.getByLabelText<HTMLInputElement>('Role').value).toBe('Medic');
    openEvent(rig, 'Add event at point 1');
    expect(screen.getByLabelText<HTMLInputElement>('Role').value).toBe('');
    cleanup();
    const reader = await editing([{ kind: 'set', fields: [{ plugin: 'cot', name: 'role', value: 'Medic' }] }], [VIEW]);
    openEvent(reader, 'Open event 1 at point 1');
    expect(screen.getByLabelText('Role')).toHaveProperty('disabled', true);
  });
});
