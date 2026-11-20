import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsServices } from '../../testing/fakes.ts';
import { itemFormSchema } from './items.ts';
import { PluginSettingsView } from './PluginSettingsView.tsx';
import { fieldOf } from './schema.ts';

/** Like the simulator's settings with part D's hints: a group, an advanced group, a unit, a hint, a long description. */
const SCHEMA = {
  type: 'object',
  'x-emc2': {
    groups: [
      { id: 'clock', label: 'Clock', properties: ['tick', 'speed'], description: 'How the simulation keeps time.' },
      { id: 'sensors', label: 'Sensors', properties: ['colour', 'revisit'], folded: true },
      { id: 'advanced', label: 'Advanced', properties: ['budget', 'note', 'secret'], advanced: true },
    ],
  },
  properties: {
    name: { type: 'string', title: 'Name' },
    tick: { type: 'number', title: 'Tick', minimum: 0.1, maximum: 10, default: 1, 'x-emc2': { unit: 's', hint: 'How often every simulated object moves' },
      description: 'How often every simulated object moves. Smaller is smoother and costs more: each tick moves every object and sends its update.' },
    speed: { type: 'integer', title: 'Speed factor', default: 1 },
    colour: { type: 'string', title: 'Coverage colour', 'x-emc2': { kind: 'colour' }, default: '#D03030' },
    revisit: { type: 'number', title: 'Revisit', default: 0.2 },
    budget: { type: 'integer', title: 'Budget', default: 100 },
    note: { type: 'string', title: 'Note' },
    secret: { type: 'string', title: 'Secret', 'x-emc2': { visibleWhen: { property: 'name', in: ['shown'] } } },
    origin: { type: 'object', title: 'Origin', properties: { lon: { type: 'number' }, lat: { type: 'number' } } },
  },
};

function show(values: Record<string, unknown>, ...answers: Response[]) {
  showSchema(SCHEMA, values, ...answers);
}

function showSchema(schema: object, values: Record<string, unknown>, ...answers: Response[]) {
  const doFetch = vi.fn<typeof fetch>((_input, init) => {
    if ((init?.method ?? 'GET') === 'GET') return Promise.resolve(Response.json({ schema, values }));
    const next = answers.shift();
    return Promise.resolve(next ?? Response.json({ values: JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as unknown }));
  });
  render(<PluginSettingsView pluginId="simulator" services={settingsServices(doFetch)} />);
}

const group = (label: string) => screen.getByText(label, { selector: '.field-section-label' }).closest('details') as HTMLDetailsElement;
const cellOf = (label: string) => screen.getByLabelText(label).closest('.field-cell') as HTMLElement;

describe('the fields of a generated form (T-203 part E)', () => {
  it('carry the SDK\'s hint, longer text, width and unit', () => {
    const tick = fieldOf(SCHEMA.properties.tick, 'tick');
    expect([tick.hint, tick.more, tick.width, tick.unit]).toEqual(['How often every simulated object moves', SCHEMA.properties.tick.description, 'short', 's']);
    const name = fieldOf(SCHEMA.properties.name, 'name');
    expect([name.hint, name.more, name.width, name.unit]).toEqual([null, null, 'full', undefined]);
    const root = fieldOf(SCHEMA, 'Settings');
    expect(root.kind === 'object' ? root.sections.map((s) => s.id) : null).toEqual([null, 'clock', 'sensors', 'origin', 'advanced']);
  });

  it('leave a list item\'s id out of its groups too (CR-0047 F3)', () => {
    const list = {
      type: 'array', 'x-emc2': { item: { name: 'name', noun: 'link', id: 'id' } },
      items: { type: 'object', 'x-emc2': { groups: [{ id: 'g', label: 'G', properties: ['id', 'name'] }] },
        properties: { id: { type: 'string' }, name: { type: 'string' } } },
    } as const;
    const field = fieldOf(itemFormSchema(list), 'Links');
    expect(field.kind === 'object' ? field.sections.map((s) => s.properties) : null).toEqual([['name']]);
  });
});

describe('a generated form in sections (T-203 part E)', () => {
  afterEach(cleanup);

  it('puts short fields side by side and full ones across, in the SDK\'s order of sections', async () => {
    show({ name: 'a' });
    await screen.findByLabelText('Name');
    expect(cellOf('Name').className).toBe('field-cell field-cell-full');
    expect(cellOf('Tick').className).toBe('field-cell field-cell-short');
    expect(screen.getByRole('group', { name: 'Origin' }).closest('.field-cell')?.className).toBe('field-cell field-cell-full');
    const heads = [...document.querySelectorAll('.field-section-label')].map((h) => h.textContent);
    expect(heads).toEqual(['Clock', 'Sensors', 'Advanced']);
    expect(group('Clock').open).toBe(true);
  });

  it('folds a folded group and the advanced one, saying how many settings they hold and how many changed', async () => {
    show({ name: 'a', budget: 200, note: 'x' });
    await screen.findByLabelText('Name');
    expect(group('Sensors').open).toBe(false);
    expect(within(group('Sensors')).getByText('2 settings, all default')).toBeTruthy();
    expect(within(group('Advanced')).getByText('2 settings, 2 changed'), 'the shown ones: Secret is hidden').toBeTruthy();
    fireEvent.click(within(group('Advanced')).getByText('Advanced'));
    await waitFor(() => { expect(group('Advanced').open).toBe(true); });
    expect(within(group('Advanced')).queryByText('2 settings, 2 changed'), 'an open group says only its name').toBeNull();
  });

  it('says a group\'s description under its heading (SDK 1.9.0, CR-0048 point 1.2)', async () => {
    show({ name: 'a' });
    await screen.findByLabelText('Name');
    expect(within(group('Clock')).getByText('How the simulation keeps time.').className).toBe('field-help');
    expect(within(group('Sensors')).queryByText(/keeps time/), 'a group without one says nothing').toBeNull();
  });

  const CREDENTIALS = {
    type: 'object',
    properties: {
      credential: { type: 'string', title: 'TLS credential', 'x-emc2': { kind: 'tls-credential' } },
      named: { type: 'string', title: 'Other credential', 'x-emc2': { kind: 'tls-credential', hint: 'The partner\'s credential' } },
    },
  };

  const urlOf = (input: RequestInfo | URL): string => (typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);

  /** The plugin's settings, and the server's TLS credentials' names as `names` answers. */
  function showCredentials(values: Record<string, unknown>, names: Response) {
    const sent: unknown[] = [];
    const doFetch = vi.fn<typeof fetch>((input, init) => {
      if (urlOf(input).endsWith('/api/settings/tls-credentials')) return Promise.resolve(names);
      if ((init?.method ?? 'GET') === 'GET') return Promise.resolve(Response.json({ schema: CREDENTIALS, values }));
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as unknown;
      sent.push(body);
      return Promise.resolve(Response.json({ values: body }));
    });
    render(<PluginSettingsView pluginId="cot" services={settingsServices(doFetch)} />);
    return { doFetch, sent };
  }

  it('picks a TLS credential from the server\'s names, empty for the link\'s name, and keeps a missing one (ADR-0062, M9 C3)', async () => {
    const { doFetch, sent } = showCredentials({ named: 'partner' }, Response.json({ names: ['north', 'tak'] }));
    const select = await screen.findByRole<HTMLSelectElement>('combobox', { name: 'TLS credential' });
    expect([...select.options].map((o) => o.textContent)).toEqual(['(the link\'s name)', 'north', 'tak']);
    expect(select.value).toBe('');
    expect(screen.getAllByText(/A TLS credential on the server; "\(the link's name\)" uses the one named as the link\./)).toHaveLength(1);

    const other = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Other credential' });
    expect([...other.options].map((o) => o.textContent)).toEqual(['(the link\'s name)', 'partner (missing)', 'north', 'tak']);
    expect(other.value).toBe('partner');
    expect(screen.getByText(/The partner's credential/), 'its own hint wins').toBeTruthy();
    expect(screen.getByText('The server has no TLS credential named partner: the link fails until one is picked or added.')).toBeTruthy();
    expect(doFetch.mock.calls.filter(([input]) => urlOf(input).endsWith('/tls-credentials')), 'asked once for both fields').toHaveLength(1);

    fireEvent.change(select, { target: { value: 'tak' } });
    fireEvent.change(other, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(sent).toEqual([{ credential: 'tak' }]); });
  });

  it('draws a TLS credential field as text with a note when the names cannot be had', async () => {
    showCredentials({ named: 'partner' }, Response.json({ problem: 'no' }, { status: 403 }));
    await waitFor(() => { expect(screen.getAllByText(/^The TLS credentials could not be read: /)).toHaveLength(2); });
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'TLS credential' });
    expect(input.value).toBe('');
    expect(input.getAttribute('placeholder')).toBe('(the link\'s name)');
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Other credential' }).value).toBe('partner');
  });

  it('opens a folded group for a problem inside it', async () => {
    const refusal = Response.json({ problems: [{ path: '/revisit', problem: 'must be at most 10' }] }, { status: 400 });
    show({ name: 'a' }, refusal);
    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(group('Sensors').open).toBe(true); });
    expect(within(group('Sensors')).getByText('must be at most 10')).toBeTruthy();
  });

  it('says the hint and the limits under a field, the longer text behind its info button, and the unit after a number', async () => {
    show({ name: 'a' });
    const tick = await screen.findByLabelText('Tick');
    const help = document.getElementById(`${tick.id}-help`);
    expect(help?.textContent).toBe('How often every simulated object moves. A number from 0.1 to 10. Default: 1 s.');
    const more = document.getElementById(`${tick.id}-more`) as HTMLElement;
    expect(more.hidden).toBe(true);
    const button = screen.getByRole('button', { name: 'More about Tick' });
    fireEvent.click(button);
    expect(more.hidden).toBe(false);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(more.textContent).toBe(SCHEMA.properties.tick.description);
    expect(document.getElementById(`${tick.id}-unit`)?.textContent).toBe('s');
    expect(tick.getAttribute('aria-describedby')).toBe(`${tick.id}-help ${tick.id}-unit`);
  });

  it('says no default for an empty text default (PCA-cot K1)', async () => {
    const schema = { type: 'object', properties: {
      host: { type: 'string', title: 'Host', description: 'Where to send', default: '' },
      port: { type: 'integer', title: 'Port', default: 8087 },
    } };
    showSchema(schema, {});
    const host = await screen.findByLabelText('Host');
    expect(document.getElementById(`${host.id}-help`)?.textContent ?? '').not.toContain('Default');
    const port = screen.getByLabelText('Port');
    expect(document.getElementById(`${port.id}-help`)?.textContent).toContain('Default: 8087.');
  });

  it('keeps a group of hidden fields for a problem whose note is drawn in it, opened (review R1)', async () => {
    // Secret is shown when Name is "shown"; Name, in the same group here, is hidden by Mode: the note stays in Secret's cell
    const schema = {
      type: 'object',
      'x-emc2': { groups: [{ id: 'h', label: 'Hidden', properties: ['name', 'secret'], folded: true }] },
      properties: {
        mode: { enum: ['a', 'b'], title: 'Mode', default: 'a' },
        other: { type: 'string', title: 'Other' },
        name: { type: 'string', title: 'Name', 'x-emc2': { visibleWhen: { property: 'mode', in: ['b'] } } },
        secret: { type: 'string', title: 'Secret', 'x-emc2': { visibleWhen: { property: 'name', in: ['shown'] } } },
      },
    };
    const refusal = Response.json({ problems: [{ path: '/secret', problem: 'too short' }] }, { status: 400 });
    const answers = [refusal];
    const doFetch = vi.fn<typeof fetch>((_input, init) => Promise.resolve((init?.method ?? 'GET') === 'GET'
      ? Response.json({ schema, values: { mode: 'a', name: 'x', secret: 'x' } }) : (answers.shift() ?? Response.json({}))));
    render(<PluginSettingsView pluginId="simulator" services={settingsServices(doFetch)} />);
    expect(await screen.findByLabelText('Mode')).toBeTruthy();
    expect(document.querySelector('.field-section-label'), 'all hidden, no problem: left out').toBeNull();
    fireEvent.change(screen.getByLabelText('Other'), { target: { value: 'y' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText(/Secret \(shown when Name is shown\): too short/)).toBeTruthy();
    expect(group('Hidden').open).toBe(true);
  });

  // Under load (the MCA's run on d1de0fc9, owner ZW A) the default 1 s waits and 5 s test ran out: longer ones here,
  // no fixed delays, so a fast machine still finishes at once
  it('opens a group once for a problem, then leaves it to the user (review R2)', { timeout: 30_000 }, async () => {
    const slow = { timeout: 10_000 };
    const refusal = Response.json({ problems: [{ path: '/revisit', problem: 'must be at most 10' }] }, { status: 400 });
    show({ name: 'a' }, refusal);
    fireEvent.change(await screen.findByLabelText('Name', {}, slow), { target: { value: 'b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(group('Sensors').open).toBe(true); }, slow);
    fireEvent.click(within(group('Sensors')).getByText('Sensors'));
    await waitFor(() => { expect(group('Sensors').open, 'closed by the user although the problem is there').toBe(false); }, slow);
    expect(within(group('Sensors')).getByText(/2 settings/)).toBeTruthy();
  });

  it('never shows a pattern, and words a pattern problem plainly (the MCA\'s fix 1)', async () => {
    const schema = {
      type: 'object',
      properties: {
        colour: { type: 'string', title: 'Colour', pattern: '^#[0-9A-Fa-f]{6}$', 'x-emc2': { kind: 'colour' } },
        code: { type: 'string', title: 'Code', pattern: '^[A-Z]{2}$', examples: ['XN'] },
      },
    };
    const refusal = Response.json({ problems: [
      { path: '/colour', problem: 'does not match the regex pattern ^#[0-9A-Fa-f]{6}$' },
      { path: '/code', problem: 'does not match the regex pattern ^[A-Z]{2}$' },
    ] }, { status: 400 });
    const answers = [refusal];
    const doFetch = vi.fn<typeof fetch>((_input, init) => Promise.resolve((init?.method ?? 'GET') === 'GET'
      ? Response.json({ schema, values: { colour: '#FF0000', code: 'XN' } }) : (answers.shift() ?? Response.json({}))));
    render(<PluginSettingsView pluginId="gmti" services={settingsServices(doFetch)} />);
    const code = await screen.findByRole('textbox', { name: 'Code' });
    expect(document.body.textContent).not.toContain('Must match');
    fireEvent.change(code, { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Not in the expected form, for example XN.')).toBeTruthy();
    expect(screen.getByText('Not a colour: write # and six hexadecimal digits, for example #FF0000.')).toBeTruthy();
    expect(document.body.textContent, 'not even in the list of the refusal').not.toMatch(/regex|\^\[/);
    expect(screen.getByText('/code: is not in the expected form')).toBeTruthy();
  });

  it('says an optional object not set is the plugin\'s default, with "Set" and "Use the default" (the MCA\'s fix 2)', async () => {
    show({ name: 'a' });
    await screen.findByLabelText('Name');
    expect(screen.getByText('Origin: the plugin\'s default.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Set Origin' }));
    const back = screen.getByRole('button', { name: 'Use the default for Origin' });
    expect(back.className).toBe('emc2-button');
    fireEvent.click(back);
    expect(screen.getByRole('button', { name: 'Set Origin' })).toBeTruthy();
  });

  it('leaves out a group whose fields are all hidden, and keeps one with a shown field', async () => {
    const hiddenOnly = { ...SCHEMA, 'x-emc2': { groups: [{ id: 'h', label: 'Hidden', properties: ['secret'] }] } };
    const doFetch = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ schema: hiddenOnly, values: { name: 'a' } })));
    render(<PluginSettingsView pluginId="simulator" services={settingsServices(doFetch)} />);
    await screen.findByLabelText('Name');
    expect(document.querySelector('.field-section-label')).toBeNull();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'shown' } });
    expect(screen.getByText('Hidden', { selector: '.field-section-label' })).toBeTruthy();
  });
});
