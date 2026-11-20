// A point's events and the Event panel (brief functions 13 and 22; Q14, A44; criterion 10 as far
// as the web part writes the events): "hide", and "change fields" with core fields and another
// plugin's declared fields.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeclaredField } from '@emc2/plugin-sdk';
import { createFakeSymbolService } from '@emc2/plugin-sdk/testing';
import { EMPTY_FORM, eventOf, formOf, formProblems, summary } from '../src/events.ts';
import { EDIT_HINT } from '../src/permissions.ts';
import { activated, feedPicture, groups, lastExtension, panel, route, ROUTE_A, routeInfo, settled, SIM_LAYER, symbol, TRACK_1, TRACK_2, VIEW } from './harness.tsx';
import type { Rig } from './harness.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TEAM: DeclaredField = {
  plugin: 'cot', name: 'team', type: 'choice', label: 'Team', editableByOthers: true,
  choices: [{ value: 'Cyan', label: 'Cyan' }, { value: 'Red', label: 'Red' }],
};

const SET = { kind: 'set', objects: [TRACK_2], core: { name: 'Bravo', description: null, texts: { uniqueDesignation: 'B1', staffComments: null } }, fields: [{ plugin: 'cot', name: 'team', value: 'Red' }] };

/** The editor open on route A with two tracks; `events` at point 1. */
async function editing(events: readonly unknown[] = [], options: { readonly permissions?: readonly string[] } = {}): Promise<Rig> {
  const rig = await activated({ declaredFields: [TEAM], fieldSets: [{ id: 'cot.unit', plugin: 'cot', name: 'unit', label: 'CoT unit', fields: ['team'] }], symbols: true, ...(options.permissions === undefined ? {} : { permissions: options.permissions }) });
  const routeA = route(ROUTE_A, 'Alpha', { groups: groups(TRACK_1, TRACK_2), points: [{ speed: 8.33, events: events as never }, { speed: 8.33 }] });
  feedPicture(rig.ctx, [routeA, symbol(TRACK_1, SIM_LAYER), symbol(TRACK_2, SIM_LAYER)]);
  rig.server.on('GET', `routes/${ROUTE_A}`, { status: 200, body: routeInfo(ROUTE_A, 'Alpha') });
  await rig.ctx.runObjectAction('edit-route', [ROUTE_A]);
  const Editor = panel(rig.ctx, 'route-editor');
  render(<Editor />);
  await screen.findByRole('region', { name: 'Point 1' });
  return rig;
}

function openEventPanel(rig: Rig): HTMLElement {
  const Event = panel(rig.ctx, 'event');
  const { container } = render(<Event />);
  return container;
}

describe('the event format (README, "Events")', () => {
  it('reads an event into the form and writes it back unchanged', () => {
    expect(eventOf(formOf(SET))).toEqual(SET);
    expect(eventOf(formOf({ kind: 'hide' }))).toEqual({ kind: 'hide' });
  });

  it('summarises an event for its point', () => {
    expect(summary({ kind: 'hide' }, [])).toBe('Hide · all');
    expect(summary(SET, [TEAM])).toBe('Change name, description, unique designation, staff comments, Team (cot) · 1 object');
  });

  it('refuses an event that changes nothing, or a value that does not fit', () => {
    expect(formProblems(EMPTY_FORM, [], null)).toEqual({ form: 'Choose at least one change' });
    const form = { ...EMPTY_FORM, name: { mode: 'set' as const, text: ' ' }, texts: [{ name: 'type' as const, mode: 'set' as const, text: 'x' }, { name: 'type' as const, mode: 'clear' as const, text: '' }] };
    expect(formProblems(form, [], null)).toEqual({ name: 'Type a value, or choose "Clear it"', 'texts.1': 'Type is listed twice' });
    expect(formProblems({ ...EMPTY_FORM, fields: [{ plugin: 'cot', name: 'team', value: 'Green' }] }, [TEAM], null)).toEqual({ 'fields.cot.team': 'Team has no choice Green' });
  });

  it('checks a SIDC with the symbol service when it is there (A44)', () => {
    const form = { ...EMPTY_FORM, sidc: { mode: 'set' as const, text: '10031000001211009999' } };
    expect(formProblems(form, [], null)).toEqual({});
    expect(formProblems({ ...form, sidc: { mode: 'set', text: 'nonsense' } }, [], createFakeSymbolService())).toEqual({ sidc: 'not a valid APP-6D SIDC' });
  });
});

describe('the Event panel (Q14, A44; criterion 10)', () => {
  it('is brought to the front when it opens (part D)', async () => {
    const rig = await editing();
    fireEvent.click(screen.getByRole('button', { name: 'Add event at point 1' }));
    expect(rig.ctx.addedPanels.find((p) => p.panel.id === 'event')?.shown).toBe(1);
  });

  it('adds a "hide" event for one object at a point', async () => {
    const rig = await editing();
    fireEvent.click(screen.getByRole('button', { name: 'Add event at point 1' }));
    openEventPanel(rig);
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'hide' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Track 1' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await settled();
    });
    expect((lastExtension(rig.ctx)['points'] as { events?: unknown }[])[0]?.events).toEqual([{ kind: 'hide', objects: [TRACK_1] }]);
    expect(rig.ctx.addedPanels.some((p) => p.panel.id === 'event')).toBe(false);
  });

  it("adds a change of the name, a text modifier and another plugin's declared field, for every object", async () => {
    const rig = await editing();
    fireEvent.click(screen.getByRole('button', { name: 'Add event at point 1' }));
    const event = within(openEventPanel(rig));
    fireEvent.change(event.getByLabelText('Name'), { target: { value: 'set' } });
    fireEvent.change(event.getByLabelText('New name'), { target: { value: 'Ghost' } });
    fireEvent.click(event.getByRole('button', { name: 'Add text modifier' }));
    fireEvent.change(event.getByLabelText('Modifier'), { target: { value: 'uniqueDesignation' } });
    fireEvent.change(event.getByLabelText('Change'), { target: { value: 'clear' } });
    fireEvent.change(event.getByLabelText('Team'), { target: { value: 'Cyan' } });
    await act(async () => {
      fireEvent.click(event.getByRole('button', { name: 'Save' }));
      await settled();
    });
    expect((lastExtension(rig.ctx)['points'] as { events?: unknown }[])[0]?.events).toEqual([
      { kind: 'set', core: { name: 'Ghost', texts: { uniqueDesignation: null } }, fields: [{ plugin: 'cot', name: 'team', value: 'Cyan' }] },
    ]);
  });

  it('will not save an event that changes nothing', async () => {
    const rig = await editing();
    fireEvent.click(screen.getByRole('button', { name: 'Add event at point 1' }));
    openEventPanel(rig);
    expect(screen.getByText('Choose at least one change')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
  });

  it('edits an existing event in its place, and removes one', async () => {
    const rig = await editing([{ kind: 'hide' }, SET]);
    const list = screen.getByRole('list', { name: 'Events at point 1' });
    expect(within(list).getByText('Hide · all')).toBeDefined();
    fireEvent.click(within(list).getByRole('button', { name: 'Edit event 2 at point 1' }));
    openEventPanel(rig);
    expect(screen.getByLabelText<HTMLInputElement>('New name').value).toBe('Bravo');
    expect(screen.getByRole('checkbox', { name: 'Track 2' })).toHaveProperty('checked', true);
    fireEvent.change(screen.getByLabelText('New name'), { target: { value: 'Charlie' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Save' }));
      await settled();
    });
    const events = (lastExtension(rig.ctx)['points'] as { events?: unknown[] }[])[0]?.events;
    expect(events?.[0]).toEqual({ kind: 'hide' });
    expect(events?.[1]).toMatchObject({ core: { name: 'Charlie' } });
    await act(async () => {
      fireEvent.click(within(list).getByRole('button', { name: 'Remove event 1 at point 1' }));
      await settled();
    });
    // Built from the edit before it, not from the stale picture.
    expect((lastExtension(rig.ctx)['points'] as { events?: unknown[] }[])[0]?.events).toEqual([{ ...SET, core: { ...SET.core, name: 'Charlie' } }]);
  });

  it('shows a rejected save, and keeps the panel open', async () => {
    const rig = await editing();
    rig.ctx.answerWith((request) => ({
      outcome: 'rejected',
      rejection: { requestId: request.requestId, entityType: 'object', operation: 'update', entityId: request.entityId, code: 'VALIDATION_FAILED', message: 'too big', at: '2026-10-27T08:00:00.000Z' },
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Add event at point 1' }));
    openEventPanel(rig);
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'hide' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect((await screen.findAllByRole('alert')).some((a) => a.textContent.includes('too big'))).toBe(true);
    expect(rig.ctx.addedPanels.some((p) => p.panel.id === 'event')).toBe(true);
  });

  it('lists an object the event names that is no longer on the route, so it can be unchosen', async () => {
    const rig = await editing([{ kind: 'hide', objects: [TRACK_1, '0192f000-0000-7000-8000-00000000000f'] }]);
    fireEvent.click(screen.getByRole('button', { name: 'Edit event 1 at point 1' }));
    const event = within(openEventPanel(rig));
    const gone = event.getByRole('checkbox', { name: 'Object 0192f000 (not on the route)' });
    expect(gone).toHaveProperty('checked', true);
    fireEvent.click(gone);
    await act(async () => {
      fireEvent.click(event.getByRole('button', { name: 'Save' }));
      await settled();
    });
    expect((lastExtension(rig.ctx)['points'] as { events?: unknown }[])[0]?.events).toEqual([{ kind: 'hide', objects: [TRACK_1] }]);
  });

  it('refuses a cleared SIDC, which the server refuses too', () => {
    expect(formProblems({ ...EMPTY_FORM, sidc: { mode: 'clear', text: '' } }, [], null)).toEqual({ sidc: 'The SIDC cannot be cleared' });
  });

  it('closes with the route editor', async () => {
    const rig = await editing();
    fireEvent.click(screen.getByRole('button', { name: 'Add event at point 1' }));
    expect(rig.ctx.addedPanels.some((p) => p.panel.id === 'event')).toBe(true);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Close the route editor' }));
    });
    expect(rig.ctx.addedPanels.some((p) => p.panel.id === 'event')).toBe(false);
  });

  it('is read-only without plugin.simulator.edit (criterion 22)', async () => {
    const rig = await editing([SET], { permissions: [VIEW] });
    fireEvent.click(screen.getByRole('button', { name: 'Open event 1 at point 1' }));
    openEventPanel(rig);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
    expect(screen.getByLabelText('Kind')).toHaveProperty('disabled', true);
    expect(screen.getAllByText(EDIT_HINT).length).toBeGreaterThan(0);
  });
});
