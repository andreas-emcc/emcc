import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsServices } from '../../testing/fakes.ts';
import type { ViewServices } from '../services.ts';
import { unsavedCount, type SettingsEntry } from './entries.ts';
import { cellText, itemLists } from './items.ts';
import { PluginSettingsView } from './PluginSettingsView.tsx';

/** Like gmti's settings: links with their name, two columns and an On or Off state, beside a plain field. */
const SCHEMA = {
  type: 'object',
  properties: {
    colour: { type: 'string', title: 'Colour' },
    links: {
      type: 'array', title: 'Links',
      'x-emc2': { item: { name: 'name', noun: 'link', state: 'enabled', columns: ['mode', 'port'] } },
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', title: 'Name' },
          enabled: { type: 'boolean', title: 'Enabled' },
          mode: { enum: ['tcp-client', 'udp'], title: 'Mode' },
          port: { type: 'integer', title: 'Port' },
        },
        required: ['name'],
      },
    },
  },
};
const NORTH = { name: 'north', enabled: true, mode: 'tcp-client', port: 4607 };
const SOUTH = { name: 'south', enabled: false, mode: 'udp' };
const VALUES = { colour: '#ff0000', links: [NORTH, SOUTH] };

interface Call { readonly method: string; readonly body: unknown }

/** A server with gmti's settings; `answers` are given out first, one per PUT; a saved PUT tells the page, as the live picture does. */
function server(values: unknown = VALUES, ...answers: Response[]) {
  return serverWith(SCHEMA, values, ...answers);
}

/** As {@link server}, with another schema. */
function serverWith(schema: unknown, values: unknown, ...answers: Response[]) {
  const calls: Call[] = [];
  let stored = values;
  let services: ViewServices | null = null;
  const doFetch = vi.fn<typeof fetch>((_input, init) => {
    const method = init?.method ?? 'GET';
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, body });
    if (method === 'GET') return Promise.resolve(Response.json({ schema, values: stored }));
    const next = answers.shift();
    if (next !== undefined) return Promise.resolve(next);
    stored = body;
    services?.shared.settingsChanged('gmti', stored as Record<string, never>);
    return Promise.resolve(Response.json({ values: stored }));
  });
  services = settingsServices(doFetch);
  return { calls, services, puts: () => calls.filter((c) => c.method === 'PUT') };
}

function show(services: ViewServices) {
  render(<PluginSettingsView pluginId="gmti" services={services} />);
}

const form = (name: string) => within(screen.getByRole('complementary', { name }));
const rowOf = (name: string) => screen.getByRole('button', { name }).closest('tr') as HTMLElement;

describe('the rules of a list shown as a table (T-203 part D)', () => {
  it('takes the top-level lists of objects, not values, layer picks or lists without properties', () => {
    expect(itemLists({
      type: 'object',
      properties: {
        links: SCHEMA.properties.links,
        hosts: { type: 'array', items: { type: 'string' } },
        layers: { type: 'array', items: { type: 'object', 'x-emc2': { kind: 'layer' }, properties: { name: { type: 'string' } } } },
        loose: { type: 'array', items: { type: 'object' } },
      },
    })).toEqual(['links']);
  });

  it('shows a value as text, a boolean as Yes or No, a layer by its name and nothing as an en dash', () => {
    expect([cellText('a'), cellText(3), cellText(true), cellText(false), cellText({ name: 'GMTI north' }), cellText(''), cellText(undefined), cellText(null)])
      .toEqual(['a', '3', 'Yes', 'No', 'GMTI north', '–', '–', '–']);
  });

  it('counts a list item\'s draft for its plugin\'s entry', () => {
    const entry = { id: 'plugin/gmti' } as SettingsEntry;
    const counts: Record<string, number> = { 'plugin/gmti': 1, 'plugin/gmti#/links/@0': 2, 'plugin/gmtix': 5 };
    expect(unsavedCount(entry, Object.keys(counts), (k) => counts[k] ?? 0)).toBe(3);
  });
});

describe('a plugin\'s list as a table with a side form (T-203 part D)', () => {
  afterEach(cleanup);

  it('shows a row per item with its name, its columns and its state, the count and Add; nothing chosen at first', async () => {
    const { services } = server();
    show(services);
    const table = within(await screen.findByRole('table'));
    expect(table.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Name', 'Mode', 'Port', 'Enabled']);
    expect(table.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').map((c) => c.textContent))).toEqual([
      ['tcp-client', '4607', 'On'], ['udp', '–', 'Off'],
    ]);
    expect(screen.getByText('2 links')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add link' })).toBeTruthy();
    expect(screen.getByText('Select a link, or add one.')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Colour' }), 'the plain field in its own form').toBeTruthy();
  });

  it('opens the chosen item in the side form and saves only it, with the others as saved', async () => {
    const { services, puts } = server();
    show(services);
    fireEvent.click(await screen.findByRole('button', { name: 'south' }));
    expect(screen.getByRole('button', { name: 'south' }).getAttribute('aria-current')).toBe('true');
    expect(rowOf('south').hasAttribute('data-selected')).toBe(true);
    const south = form('south');
    fireEvent.change(south.getByRole('textbox', { name: 'Name' }), { target: { value: 'west' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Colour' }), { target: { value: '#00ff00' } }); // the plain form's own draft
    fireEvent.click(south.getByRole('button', { name: 'Save link' }));
    await waitFor(() => { expect(puts()).toHaveLength(1); });
    expect(puts()[0]?.body).toEqual({ colour: '#ff0000', links: [NORTH, { ...SOUTH, name: 'west' }] });
    expect(await screen.findByRole('button', { name: 'west' })).toBeTruthy();
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Colour' }).value, 'the plain draft kept').toBe('#00ff00');

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => { expect(puts()).toHaveLength(2); });
    expect(puts()[1]?.body, 'the plain form keeps the saved lists').toEqual({ colour: '#00ff00', links: [NORTH, { ...SOUTH, name: 'west' }] });
  });

  it('keeps an item\'s draft while another is chosen, and marks its row and its entry', async () => {
    const { services, puts } = server();
    show(services);
    fireEvent.click(await screen.findByRole('button', { name: 'north' }));
    fireEvent.change(form('north').getByRole('textbox', { name: 'Port' }), { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: 'south' }));
    expect(within(rowOf('north')).getByTitle('1 unsaved').textContent).toBe('1');
    expect(services.drafts.keys()).toEqual(['plugin/gmti#/links/@0']);
    fireEvent.click(screen.getByRole('button', { name: 'north' }));
    expect(form('north').getByRole<HTMLInputElement>('textbox', { name: 'Port' }).value).toBe('5000');
    fireEvent.click(form('north').getByRole('button', { name: 'Close' }));
    expect(screen.getByText('Select a link, or add one.')).toBeTruthy();
    expect(puts()).toHaveLength(0);
  });

  it('adds a new item only in its form, appends it at its first Save and keeps it chosen', async () => {
    const { services, puts } = server();
    show(services);
    fireEvent.click(await screen.findByRole('button', { name: 'Add link' }));
    expect(screen.getByRole('button', { name: 'New link' }), 'a row for it').toBeTruthy();
    const fresh = form('New link');
    fireEvent.change(fresh.getByRole('textbox', { name: 'Name' }), { target: { value: 'east' } });
    fireEvent.click(fresh.getByRole('button', { name: 'Save link' }));
    await waitFor(() => { expect(puts()).toHaveLength(1); });
    expect((puts()[0]?.body as { links: unknown[] }).links).toEqual([NORTH, SOUTH, expect.objectContaining({ name: 'east' })]);
    expect(await screen.findByRole('complementary', { name: 'east' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New link' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Add link' }));
    fireEvent.click(form('New link').getByRole('button', { name: 'Delete' }));
    expect(screen.queryByRole('button', { name: 'New link' }), 'an unsaved one goes without a question').toBeNull();
    expect(puts()).toHaveLength(1);
  });

  it('deletes an item after its question, and moves one, each saved at once; a row\'s draft moves with it', async () => {
    const { services, puts } = server();
    show(services);
    fireEvent.click(await screen.findByRole('button', { name: 'south' }));
    fireEvent.change(form('south').getByRole('textbox', { name: 'Port' }), { target: { value: '9' } });
    fireEvent.click(form('south').getByRole('button', { name: 'Move south up' }));
    await waitFor(() => { expect(puts()).toHaveLength(1); });
    expect(puts()[0]?.body).toEqual({ colour: '#ff0000', links: [SOUTH, NORTH] });
    await waitFor(() => { expect(services.drafts.keys()).toEqual(['plugin/gmti#/links/@0']); });
    expect(form('south').getByRole<HTMLInputElement>('textbox', { name: 'Port' }).value, 'still chosen, with its draft').toBe('9');

    fireEvent.click(form('south').getByRole('button', { name: 'Delete' }));
    const ask = within(screen.getByRole('alertdialog', { name: 'Delete link?' }));
    fireEvent.click(ask.getByRole('button', { name: 'Delete' }));
    await waitFor(() => { expect(puts()).toHaveLength(2); });
    expect(puts()[1]?.body).toEqual({ colour: '#ff0000', links: [NORTH] });
    await waitFor(() => { expect(screen.queryByRole('button', { name: 'south' })).toBeNull(); });
    expect(services.drafts.keys(), 'its draft gone with it').toEqual([]);
  });

  it('marks a row whose save was refused and shows the problem at its input', async () => {
    const refusal = Response.json({ problems: [{ path: '/links/1/port', problem: 'port in use' }] }, { status: 400 });
    const { services } = server(VALUES, refusal);
    show(services);
    fireEvent.click(await screen.findByRole('button', { name: 'south' }));
    const port = form('south').getByRole('textbox', { name: 'Port' });
    fireEvent.change(port, { target: { value: '4607' } });
    fireEvent.click(form('south').getByRole('button', { name: 'Save link' }));
    expect(await within(rowOf('south')).findByText('Not saved')).toBeTruthy();
    expect(port.getAttribute('aria-invalid')).toBe('true');
    expect(form('south').getByRole('alert').textContent).toContain('/links/1/port: port in use');
  });

  it('keeps the rows by their ids where the list declares them (CR-0047)', async () => {
    const withIds = {
      ...SCHEMA,
      properties: { ...SCHEMA.properties, links: { ...SCHEMA.properties.links, 'x-emc2': { item: { name: 'name', noun: 'link', id: 'id' } } } },
    };
    const values = { links: [{ id: 'a', name: 'north' }, { id: 'b', name: 'south' }] };
    const doFetch = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ schema: withIds, values })));
    const services = settingsServices(doFetch);
    show(services);
    fireEvent.click(await screen.findByRole('button', { name: 'south' }));
    fireEvent.change(form('south').getByRole('textbox', { name: 'Name' }), { target: { value: 'west' } });
    expect(services.drafts.keys()).toEqual(['plugin/gmti#/links/b']);
  });

  it('hides the id, sends it back unchanged, and gives a new item a UUID v7 (CR-0047 F3)', async () => {
    const items = SCHEMA.properties.links.items;
    const withIds = {
      ...SCHEMA,
      properties: {
        ...SCHEMA.properties,
        links: {
          ...SCHEMA.properties.links,
          'x-emc2': { item: { name: 'name', noun: 'link', id: 'id' } },
          items: { ...items, properties: { id: { type: 'string', title: 'Id', readOnly: true }, ...items.properties }, required: ['id', 'name'] },
        },
      },
    };
    const { services, puts } = serverWith(withIds, { links: [{ id: 'a', name: 'north' }] });
    show(services);
    fireEvent.click(await screen.findByRole('button', { name: 'north' }));
    expect(form('north').queryByRole('textbox', { name: 'Id' }), 'not for people').toBeNull();
    expect(form('north').getByRole('textbox', { name: 'Name' }).getAttribute('aria-required'), 'name still required').toBe('true');
    fireEvent.change(form('north').getByRole('textbox', { name: 'Name' }), { target: { value: 'west' } });
    fireEvent.click(form('north').getByRole('button', { name: 'Save link' }));
    await waitFor(() => { expect(puts()).toHaveLength(1); });
    expect(puts()[0]?.body).toEqual({ links: [{ id: 'a', name: 'west' }] });

    fireEvent.click(await screen.findByRole('button', { name: 'Add link' }));
    fireEvent.change(form('New link').getByRole('textbox', { name: 'Name' }), { target: { value: 'east' } });
    fireEvent.click(form('New link').getByRole('button', { name: 'Save link' }));
    await waitFor(() => { expect(puts()).toHaveLength(2); });
    const added = (puts()[1]?.body as { links: { id: string; name: string }[] }).links[1];
    expect(added?.name).toBe('east');
    expect(added?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(await screen.findByRole('complementary', { name: 'east' }), 'chosen by its id once saved').toBeTruthy();
  });
});
