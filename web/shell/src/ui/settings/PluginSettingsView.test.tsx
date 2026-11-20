import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsServices } from '../../testing/fakes.ts';
import { PluginSettingsView } from './PluginSettingsView.tsx';

/** A label's text, with or without the required mark after it (the UXA's `*`, aria-hidden). */
const marked = (label: string) => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*?$`);
import type { ViewServices } from '../services.ts';

/** Like coordinates' settings. */
const SCHEMA = {
  type: 'object',
  properties: {
    defaultFormat: { description: 'The display format.', enum: ['dd', 'dms', 'utm'], default: 'dms' },
    mgrsPrecision: { type: 'integer', minimum: 1, maximum: 5, default: 5 },
    showGrid: { type: 'boolean', default: true },
    note: { type: 'string', maxLength: 20 },
  },
};
const VALUES = { defaultFormat: 'dms', mgrsPrecision: 5, showGrid: true };

interface Call { readonly method: string; readonly path: string; readonly body: unknown }

/** A server with one plugin's settings; `answers` are given out first, one per call. */
function server(schema: unknown = SCHEMA, values: unknown = VALUES, ...answers: Response[]) {
  const calls: Call[] = [];
  let stored = values;
  const doFetch = vi.fn<typeof fetch>((input, init) => {
    const method = init?.method ?? 'GET';
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: pathOf(input), body });
    const next = answers.shift();
    if (next !== undefined) return Promise.resolve(next);
    if (method === 'GET') return Promise.resolve(Response.json({ schema, values: stored }));
    stored = body;
    return Promise.resolve(Response.json({ values: stored }));
  });
  return { calls, services: settingsServices(doFetch) };
}

function show(services: ViewServices, pluginId = 'coordinates') {
  return render(<PluginSettingsView pluginId={pluginId} services={services} />);
}

describe('a plugin\'s declared fields (SDK 1.2.0, ADR-0038)', () => {
  afterEach(cleanup);

  it('are listed read-only under its settings, each with what it holds and who may set it', async () => {
    const { services } = server(null, {});
    services.shared.initialDataTypes([
      { id: 'cot.track', name: 'CoT track', declaredBy: 'cot', defaults: {}, behaviour: {}, fieldSets: ['cot.unit'], manual: true },
      { id: 'cot.alert', name: 'CoT alert', declaredBy: 'cot', defaults: {}, behaviour: {}, fieldSets: [], manual: true },
    ]);
    services.shared.initialSetsAndKinds([
      { id: 'cot.unit', plugin: 'cot', name: 'unit', label: 'Unit', fields: ['callsign', 'role'] },
      { id: 'cot.motion', plugin: 'cot', name: 'motion', label: 'Motion', fields: ['callsign'] },
      { id: 'draw-symbols.unit', plugin: 'draw-symbols', name: 'unit', label: 'Other', fields: ['speed'] },
    ], []);
    services.shared.initialDeclaredFields([
      { plugin: 'cot', name: 'callsign', type: 'text', label: 'Callsign', maxLength: 64, editableByOthers: true },
      { plugin: 'cot', name: 'role', type: 'choice', label: 'Role', description: 'Its role in the team.', required: true,
        choices: [{ value: 'hq', label: 'HQ' }, { value: 'team-member', label: 'Team member' }] },
      { plugin: 'cot', name: 'speed', type: 'number', label: 'Speed', unit: 'm/s', minimum: 0, maximum: 340.5 },
      { plugin: 'cot', name: 'team', type: 'integer', label: 'Team', minimum: 1 },
      { plugin: 'cot', name: 'emergency', type: 'boolean', label: 'Emergency' },
      { plugin: 'draw-symbols', name: 'note', type: 'text', label: 'Note' },
    ]);

    show(services, 'cot');

    await screen.findByText('This plugin has no settings.');
    const list = within(screen.getByRole('region', { name: 'Declared fields' }));
    expect(list.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      'Callsign callsignText, at most 64 characters. Others may set it. In Unit, Motion, brought by CoT track.',
      'Role roleIts role in the team.One of: HQ, Team member. Required. Only this plugin sets it. In Unit, brought by CoT track.',
      'Speed speedNumber, in m/s, from 0 to 340.5. Only this plugin sets it.',
      'Team teamWhole number, at least 1. Only this plugin sets it.',
      'Emergency emergencyYes or no. Only this plugin sets it.',
    ]);
  });

  it('are not shown for a plugin that declares none', async () => {
    const { services } = server();
    services.shared.initialDeclaredFields([{ plugin: 'cot', name: 'callsign', type: 'text', label: 'Callsign' }]);

    show(services);

    await screen.findByLabelText('Default format');
    expect(screen.queryByRole('region', { name: 'Declared fields' })).toBeNull();
  });
});

/**
 * Shows the view and waits until its form takes input. The form comes with the server's answer,
 * outside `act`, and React subscribes it to the drafts in an effect that may run a moment after
 * the render `findBy…` sees: an edit in between (a test under load) showed only later, and the
 * check right after it failed (MCA, 2026-10-16).
 */
async function showForm(services: ViewServices, pluginId = 'coordinates') {
  const subscribe = vi.spyOn(services.drafts, 'subscribe');
  const before = subscribe.mock.calls.length;
  const view = show(services, pluginId);
  await waitFor(() => { expect(subscribe.mock.calls.length).toBeGreaterThan(before); });
  return view;
}

const input = (label: string) => screen.getByLabelText(marked(label));
const value = (label: string) => (input(label) as HTMLInputElement).value;
const save = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Save' });
const described = (element: HTMLElement) => (element.getAttribute('aria-describedby') ?? '').split(' ')
  .map((id) => document.getElementById(id)?.textContent ?? '').join(' ');

const pathOf = (input: RequestInfo | URL): string => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

afterEach(() => {
  cleanup();
});

describe('a plugin\'s settings tab', () => {
  it('shows the settings as a form and saves the complete values', async () => {
    const { calls, services } = server();
    await showForm(services);
    expect(await screen.findByLabelText(/^Mgrs precision\*?$/)).toBeTruthy();
    expect(value('Mgrs precision')).toBe('5');
    expect(described(input('Default format'))).toBe('The display format. Default: dms.');
    expect(described(input('Mgrs precision'))).toBe('A whole number from 1 to 5. Default: 5.');
    expect(described(input('Note'))).toBe('At most 20 characters.'); // part E: no "Optional." words
    expect(save().disabled).toBe(true);

    fireEvent.change(input('Mgrs precision'), { target: { value: '3' } });
    fireEvent.change(input('Default format'), { target: { value: '2' } }); // utm
    fireEvent.click(input('Show grid'));
    fireEvent.change(input('Note'), { target: { value: 'hello' } });
    expect(screen.getByText(/unsaved changes?$/)).toBeTruthy();
    fireEvent.click(save());

    await screen.findByText('Saved.');
    expect(document.querySelector('.settings-saved')?.textContent).toBe('Saved.');
    expect(calls.at(-1)).toEqual({
      method: 'PUT', path: '/api/settings/plugins/coordinates',
      body: { defaultFormat: 'utm', mgrsPrecision: 3, showGrid: false, note: 'hello' },
    });
    expect(value('Mgrs precision')).toBe('3');
    expect(save().disabled).toBe(true);
    expect(services.drafts.any()).toBe(false);
  });

  it('leaves an emptied optional value out', async () => {
    const { calls, services } = server(SCHEMA, { ...VALUES, note: 'x' });
    await showForm(services);
    fireEvent.change(await screen.findByLabelText('Note'), { target: { value: '' } });
    fireEvent.click(save());
    await screen.findByText('Saved.');
    expect(calls.at(-1)?.body).toEqual(VALUES);
  });

  it('shows the server\'s refusal at the inputs it concerns, and keeps the edits', async () => {
    const refusal = Response.json({ problems: [{ path: '/mgrsPrecision', problem: 'must be at most 5' }, { path: '', problem: 'one more thing' }] }, { status: 400 });
    const { services } = server(SCHEMA, VALUES, Response.json({ schema: SCHEMA, values: VALUES }), refusal);
    await showForm(services);
    fireEvent.change(await screen.findByLabelText(/^Mgrs precision\*?$/), { target: { value: '9' } });
    fireEvent.click(save());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('The server refused the values; nothing was changed./mgrsPrecision: must be at most 5one more thing');
    expect(input('Mgrs precision').getAttribute('aria-invalid')).toBe('true');
    expect(described(input('Mgrs precision'))).toContain('must be at most 5');
    expect(value('Mgrs precision')).toBe('9');
    expect(save().disabled).toBe(false);
  });

  it('drops a server problem once its value is changed, at the input and in the list', async () => {
    const refusal = Response.json({ problems: [{ path: '/mgrsPrecision', problem: 'must be at most 5' }, { path: '/note', problem: 'not a good note' }] }, { status: 400 });
    const { services } = server(SCHEMA, VALUES, Response.json({ schema: SCHEMA, values: VALUES }), refusal);
    await showForm(services);
    fireEvent.change(await screen.findByLabelText(/^Mgrs precision\*?$/), { target: { value: '9' } });
    fireEvent.change(input('Note'), { target: { value: 'odd' } });
    fireEvent.click(save());
    expect((await screen.findByRole('alert')).textContent).toContain('must be at most 5');

    // Text that is not a number: the input's own word replaces the server's, there and in the list.
    fireEvent.change(input('Mgrs precision'), { target: { value: 'abc' } });
    expect(described(input('Mgrs precision'))).toContain('Not a number.');
    expect(described(input('Mgrs precision'))).not.toContain('must be at most 5');
    expect(screen.getByRole('alert').textContent).not.toContain('must be at most 5');
    expect(described(input('Note'))).toContain('not a good note'); // its value is unchanged

    fireEvent.change(input('Mgrs precision'), { target: { value: '3' } });
    expect(input('Mgrs precision').hasAttribute('aria-invalid')).toBe(false);
    fireEvent.change(input('Note'), { target: { value: 'better' } });
    expect(input('Note').hasAttribute('aria-invalid')).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull(); // nothing left of the refusal
  });

  it('keeps a problem about the whole form until the next save', async () => {
    const refusal = Response.json({ problems: [{ path: '', problem: 'one more thing' }] }, { status: 400 });
    const { services } = server(SCHEMA, VALUES, Response.json({ schema: SCHEMA, values: VALUES }), refusal);
    await showForm(services);
    fireEvent.change(await screen.findByLabelText(/^Mgrs precision\*?$/), { target: { value: '4' } });
    fireEvent.click(save());
    expect((await screen.findByRole('alert')).textContent).toContain('one more thing');
    fireEvent.change(input('Mgrs precision'), { target: { value: '3' } });
    expect(screen.getByRole('alert').textContent).toContain('one more thing');
    fireEvent.click(save());
    await screen.findByText('Saved.');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('does not save a required value left empty, and says so at the input', async () => {
    const schema = { ...SCHEMA, required: ['mgrsPrecision', 'defaultFormat'] };
    const { calls, services } = server({ ...schema, properties: { ...SCHEMA.properties, defaultFormat: { enum: ['dd', 'dms'] } } }, { mgrsPrecision: 5, showGrid: true });
    await showForm(services);
    const precision = await screen.findByLabelText(/^Mgrs precision\*?$/);
    // A required choice the stored values lack.
    expect(input('Default format').getAttribute('aria-invalid')).toBe('true');
    expect(described(input('Default format'))).toContain('Required: choose one.');
    fireEvent.change(input('Default format'), { target: { value: '0' } }); // dd
    expect(input('Default format').hasAttribute('aria-invalid')).toBe(false);
    expect(save().disabled).toBe(false);

    fireEvent.change(precision, { target: { value: '' } });
    expect(precision.getAttribute('aria-invalid')).toBe('true');
    expect(described(precision)).toContain('Required: enter a value.');
    expect(save().disabled).toBe(true);
    fireEvent.change(precision, { target: { value: '2' } });
    expect(save().disabled).toBe(false);
    fireEvent.click(save());
    await screen.findByText('Saved.');
    expect(calls.at(-1)?.body).toEqual({ mgrsPrecision: 2, showGrid: true, defaultFormat: 'dd' });
  });

  it('keeps unsaved edits when the tab is left and opened again; Discard drops them', async () => {
    const { services } = server();
    const first = await showForm(services);
    fireEvent.change(await screen.findByLabelText(/^Mgrs precision\*?$/), { target: { value: '2' } });
    first.unmount();

    await showForm(services);
    await screen.findByLabelText(/^Mgrs precision\*?$/);
    expect(value('Mgrs precision')).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(value('Mgrs precision')).toBe('5');
    expect(services.drafts.any()).toBe(false);
  });

  it('follows values saved elsewhere; with edits open it keeps them and says so', async () => {
    const { services } = server();
    await showForm(services);
    await screen.findByLabelText(/^Mgrs precision\*?$/);
    act(() => { services.shared.settingsChanged('coordinates', { ...VALUES, mgrsPrecision: 2 }); });
    expect(value('Mgrs precision')).toBe('2');
    expect(screen.queryByRole('alert')).toBeNull();

    fireEvent.change(input('Mgrs precision'), { target: { value: '4' } });
    act(() => { services.shared.settingsChanged('coordinates', { ...VALUES, mgrsPrecision: 1 }); });
    expect(screen.getByRole('alert').textContent).toContain('Someone else saved these settings while you were editing.');
    expect(value('Mgrs precision')).toBe('4');

    fireEvent.click(screen.getByRole('button', { name: 'Take their values' }));
    expect(value('Mgrs precision')).toBe('1');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('takes values that arrive while the form is loading over the older answer', async () => {
    let answer: (r: Response) => void = () => undefined;
    const services = settingsServices(() => new Promise<Response>((resolve) => { answer = resolve; }));
    show(services);
    act(() => { services.shared.settingsChanged('coordinates', { ...VALUES, mgrsPrecision: 4 }); });
    answer(Response.json({ schema: SCHEMA, values: VALUES }));
    await waitFor(() => { expect(value('Mgrs precision')).toBe('4'); });
  });

  it('edits lists of objects: entries are added, named, moved and removed', async () => {
    const schema = {
      type: 'object',
      // T-203 part D: a top-level list of objects is a table; the list editor serves the lists below it
      properties: { group: { type: 'object', properties: {
        streams: {
          type: 'array', maxItems: 2,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              port: { type: 'integer', minimum: 1 },
              label: { type: 'object', properties: { policy: { type: 'string' } }, required: ['policy'] },
            },
            required: ['name', 'port'],
          },
        },
      } } },
    };
    const { calls, services } = server(schema, { group: { streams: [] } });
    await showForm(services, 'cot');
    fireEvent.click(await screen.findByRole('button', { name: 'Add to Streams' }));
    const first = screen.getByRole('group', { name: 'Streams 1' });
    fireEvent.change(within(first).getByLabelText(/^Name\*?$/), { target: { value: 'north' } });
    expect(screen.getByRole('group', { name: 'Streams 1: north' })).toBe(first);
    fireEvent.click(within(first).getByRole('button', { name: 'Set Label' }));
    fireEvent.change(within(first).getByLabelText(marked('Policy')), { target: { value: 'NATO' } });

    fireEvent.click(screen.getByRole('button', { name: 'Add to Streams' }));
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Add to Streams' }).disabled).toBe(true); // at most 2
    fireEvent.change(within(screen.getByRole('group', { name: 'Streams 2' })).getByLabelText(/^Name\*?$/), { target: { value: 'south' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move Streams 2 up' }));
    expect(screen.getByRole('group', { name: 'Streams 1: south' })).toBeTruthy();
    fireEvent.click(save());
    await screen.findByText('Saved.');
    expect(calls.at(-1)?.body).toEqual({ group: { streams: [{ name: 'south', port: 1 }, { name: 'north', port: 1, label: { policy: 'NATO' } }] } });

    fireEvent.click(screen.getByRole('button', { name: 'Remove Streams 1' }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Streams 1: north' })).getByRole('button', { name: 'Use the default for Label' }));
    fireEvent.click(save());
    await waitFor(() => { expect(calls.at(-1)?.body).toEqual({ group: { streams: [{ name: 'north', port: 1 }] } }); });
  });

  it('marks required values, and keeps focus on the list when entries are added, moved and removed', async () => {
    const schema = {
      type: 'object',
      // T-203 part D: a top-level list of objects is a table; the list editor serves the lists below it
      properties: { group: { type: 'object', properties: {
        streams: {
          type: 'array',
          items: { type: 'object', properties: { name: { type: 'string' }, note: { type: 'string' } }, required: ['name'] },
        },
      } } },
    };
    const { services } = server(schema, { group: { streams: [{ name: 'north' }] } });
    await showForm(services, 'cot');
    fireEvent.click(await screen.findByRole('button', { name: 'Streams 1: north', expanded: false })); // saved: collapsed (T-161)
    const north = within(screen.getByRole('group', { name: 'Streams 1: north' }));
    expect(north.getByLabelText(/^Name\*?$/).getAttribute('aria-required')).toBe('true');
    expect(north.getByText(/^Name\*?$/).classList.contains('field-required'), 'part E: the label is marked, no words').toBe(true);
    expect(north.getByLabelText('Note').hasAttribute('aria-required')).toBe(false);
    expect(north.getByText('Note').classList.contains('field-required')).toBe(false);
    expect(document.querySelector('.settings-saved')?.textContent).toBe(''); // there before anything is said

    fireEvent.click(screen.getByRole('button', { name: 'Add to Streams' }));
    expect(document.activeElement).toBe(within(screen.getByRole('group', { name: 'Streams 2' })).getByLabelText(/^Name\*?$/));
    fireEvent.change(document.activeElement as HTMLInputElement, { target: { value: 'south' } });

    fireEvent.click(screen.getByRole('button', { name: 'Move Streams 2 up' }));
    // At the top "Up" is off: focus stays with the moved entry, on its other move button.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move Streams 1 down' }));
    expect(screen.getByRole('group', { name: 'Streams 1: south' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Move Streams 1 down' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move Streams 2 up' }));
    expect(screen.getByRole('group', { name: 'Streams 2: south' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Streams 1' }));
    expect(screen.getByRole('group', { name: 'Streams 1: south' }).contains(document.activeElement)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Streams 1' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Add to Streams' }));
  });

  it('keeps text that is not a number, says so and does not save it', async () => {
    const { services } = server();
    await showForm(services);
    const precision = await screen.findByLabelText(/^Mgrs precision\*?$/);
    fireEvent.change(precision, { target: { value: '3x' } });
    expect(value('Mgrs precision')).toBe('3x');
    expect(precision.getAttribute('aria-invalid')).toBe('true');
    expect(described(precision)).toContain('Not a number.');
    expect(save().disabled).toBe(true);
    fireEvent.change(precision, { target: { value: '2.5' } });
    expect(described(precision)).toContain('Not a whole number.');
    expect(save().disabled).toBe(true);
    fireEvent.change(precision, { target: { value: '3' } });
    expect(precision.hasAttribute('aria-invalid')).toBe(false);
    expect(save().disabled).toBe(false);

    fireEvent.change(precision, { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(value('Mgrs precision')).toBe('5');
    expect(precision.hasAttribute('aria-invalid')).toBe(false);
  });

  it('shows a list of numbers of fixed length as a row of inputs', async () => {
    const schema = { type: 'object', properties: { initialCenter: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 } } };
    const { calls, services } = server(schema, { initialCenter: [15, 62] });
    await showForm(services, 'map-view-2d');
    fireEvent.change(await screen.findByLabelText('Initial center 2'), { target: { value: '59.5' } });
    expect(screen.queryByRole('button', { name: 'Add to Initial center' })).toBeNull();
    fireEvent.click(save());
    await screen.findByText('Saved.');
    expect(calls.at(-1)?.body).toEqual({ initialCenter: [15, 59.5] });
  });

  it('keeps an emptied list entry in its input, which says it is required', async () => {
    const schema = {
      type: 'object',
      properties: {
        initialCenter: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 },
        zooms: { type: 'array', items: { type: 'integer' } },
      },
    };
    const { calls, services } = server(schema, { initialCenter: [15, 62], zooms: [3] });
    await showForm(services, 'map-view-2d');
    for (const label of ['Initial center 1', 'Zooms 1']) {
      const entry = await screen.findByLabelText(marked(label));
      fireEvent.change(entry, { target: { value: '' } });
      expect(screen.getByLabelText(marked(label))).toBe(entry); // the same input, not a JSON text box
      expect(entry.getAttribute('aria-invalid'), label).toBe('true');
      expect(described(entry)).toContain('Required: enter a value.');
      expect(save().disabled).toBe(true);
      fireEvent.change(entry, { target: { value: '7' } });
    }
    expect(save().disabled).toBe(false);
    fireEvent.click(save());
    await screen.findByText('Saved.');
    expect(calls.at(-1)?.body).toEqual({ initialCenter: [7, 62], zooms: [7] });
  });

  it('collapses each entry of a list of sections under a header naming it; added ones and ones with a problem open (T-161)', async () => {
    const schema = {
      type: 'object',
      // T-203 part D: a top-level list of objects is a table; the list editor serves the lists below it
      properties: { group: { type: 'object', properties: {
        links: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, port: { type: 'integer' } } } },
        hosts: { type: 'array', items: { type: 'string' } },
      } } },
    };
    const refusal = Response.json({ problems: [{ path: '/group/links/1/port', problem: 'port in use' }] }, { status: 400 });
    const saved = { group: { links: [{ name: 'north', port: 1 }, { name: 'south', port: 2 }], hosts: ['a'] } };
    const { services } = server(schema, saved, Response.json({ schema, values: saved }), refusal);
    await showForm(services, 'cot');
    const north = await screen.findByRole('button', { name: 'Links 1: north', expanded: false });
    expect(screen.getByRole('button', { name: 'Links 2: south', expanded: false })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'Links 1: north' }), 'hidden while collapsed').toBeNull();
    expect(screen.getByRole('button', { name: 'Move Links 1 down' }), 'the entry keeps its buttons').toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Hosts 1' }), 'a list of values has no sections').toBeTruthy();

    fireEvent.click(north);
    expect(north.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Move Links 1 down' }));
    expect(screen.getByRole('button', { name: 'Links 2: north', expanded: true }), 'its state moves with it').toBeTruthy();
    expect(screen.getByRole('button', { name: 'Links 1: south', expanded: false })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Move Links 2 up' }));

    fireEvent.click(screen.getByRole('button', { name: 'Add to Links' }));
    expect(screen.getByRole('button', { name: 'Links 3', expanded: true })).toBeTruthy();
    expect(document.activeElement).toBe(within(screen.getByRole('group', { name: 'Links 3' })).getByLabelText(/^Name\*?$/));
    fireEvent.click(screen.getByRole('button', { name: 'Remove Links 3' }));

    fireEvent.change(screen.getByRole('textbox', { name: 'Hosts 1' }), { target: { value: 'b' } });
    fireEvent.click(save());
    expect((await screen.findByRole('alert')).textContent).toContain('/group/links/1/port: port in use');
    const south = screen.getByRole('button', { name: 'Links 2: south', expanded: true });
    fireEvent.change(within(screen.getByRole('group', { name: 'Links 2: south' })).getByLabelText('Port'), { target: { value: '3' } });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(south.getAttribute('aria-expanded'), 'still open once the problem is gone').toBe('true');
  });

  it('drops a problem in a list entry once its value is changed', async () => {
    const schema = {
      type: 'object',
      // T-203 part D: a top-level list of objects is a table; the list editor serves the lists below it
      properties: { group: { type: 'object', properties: { streams: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' } } } } } } },
    };
    const refusal = Response.json({ problems: [{ path: '/group/streams/0/name', problem: 'name taken' }] }, { status: 400 });
    const values = { group: { streams: [{ name: 'north' }] } };
    const { services } = server(schema, values, Response.json({ schema, values }), refusal);
    await showForm(services, 'cot');
    fireEvent.click(await screen.findByRole('button', { name: 'Streams 1: north', expanded: false })); // saved: collapsed (T-161)
    const name = within(screen.getByRole('group', { name: 'Streams 1: north' })).getByLabelText(/^Name\*?$/);
    fireEvent.change(name, { target: { value: 'south' } });
    fireEvent.click(save());
    expect((await screen.findByRole('alert')).textContent).toContain('/group/streams/0/name: name taken');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(name, { target: { value: 'west' } });
    expect(name.hasAttribute('aria-invalid')).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers a JSON text box for what it cannot show as inputs, and saves only JSON', async () => {
    const schema = { type: 'object', properties: { size: { oneOf: [{ type: 'integer' }, { type: 'array' }] } } };
    const { calls, services } = server(schema, { size: 1 });
    await showForm(services, 'odd');
    const box = await screen.findByLabelText('Size');
    expect((box as HTMLTextAreaElement).value).toBe('1');
    fireEvent.change(box, { target: { value: '[1,' } });
    expect(save().disabled).toBe(true);
    expect(described(box)).toContain('Not valid JSON');
    fireEvent.change(box, { target: { value: '[1, 2]' } });
    expect(save().disabled).toBe(false);
    fireEvent.click(save());
    await screen.findByText('Saved.');
    expect(calls.at(-1)?.body).toEqual({ size: [1, 2] });
  });

  it('says when the plugin has no settings, or the server will not show them', async () => {
    show(server(null, {}).services);
    expect(await screen.findByText('This plugin has no settings.')).toBeTruthy();
    cleanup();
    show(server(SCHEMA, VALUES, new Response('', { status: 403 })).services);
    expect((await screen.findByRole('alert')).textContent).toBe('This needs the settings.admin permission.');
  });
});
