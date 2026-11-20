import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { settingsServices } from '../../testing/fakes.ts';
import { PluginSettingsView } from './PluginSettingsView.tsx';
import { fieldOf, isVisible, type Field, type JsonObject, type Property } from './schema.ts';

const PORT = { type: 'integer', minimum: 1, maximum: 65535 };
/**
 * SDK 1.5.0 part 4 (CR-0039 point 8; T-160): the settings of `model/examples/valid/
 * manifest-settings-visible-when.json`, gmti's links by mode (the owner's Q45 A), without descriptions.
 */
const SCHEMA = {
  type: 'object',
  properties: {
    links: {
      type: 'array',
      default: [],
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', pattern: '^[a-z][a-z0-9]*(-[a-z0-9]+)*$', maxLength: 64 },
          mode: { enum: ['tcp-client', 'tcp-server', 'udp'], default: 'tcp-client' },
          direction: { enum: ['in', 'out'], default: 'in' },
          host: { type: 'string', minLength: 1, maxLength: 253, 'x-emc2': { visibleWhen: { property: 'mode', in: ['tcp-client', 'udp'] } } },
          port: { ...PORT, 'x-emc2': { visibleWhen: { property: 'mode', in: ['tcp-client', 'udp'] } } },
          listen: {
            type: 'object',
            'x-emc2': { visibleWhen: { property: 'mode', in: ['tcp-server', 'udp'] } },
            properties: { address: { type: 'string', default: '127.0.0.1' }, port: PORT },
            required: ['port'],
            additionalProperties: false,
          },
          multicastInterface: {
            type: 'string',
            'x-emc2': { visibleWhen: { property: 'mode', in: ['udp'] }, enabledWhen: { property: 'direction', in: ['in'] } },
          },
          targetLayer: {
            type: 'object',
            'x-emc2': { kind: 'layer', visibleWhen: { property: 'direction', in: ['in'] } },
            properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string', minLength: 1, maxLength: 256 } },
            required: ['name'],
          },
        },
        required: ['name'],
        allOf: [
          { if: { properties: { mode: { const: 'tcp-server' } }, required: ['mode'] }, then: { required: ['listen'] } },
          { if: { properties: { mode: { const: 'udp' }, direction: { const: 'in' } }, required: ['mode'] }, then: { required: ['listen'] } },
          { if: { properties: { mode: { const: 'udp' }, direction: { const: 'out' } }, required: ['mode', 'direction'] }, then: { required: ['host', 'port'] } },
          { if: { properties: { mode: { const: 'tcp-client' } } }, then: { required: ['host', 'port'] } },
        ],
      },
    },
  },
};

const propertiesOf = (field: Field): readonly Property[] => (field.kind === 'object' ? field.properties : field.kind === 'list' ? propertiesOf(field.item) : []);
const items = () => {
  const links = propertiesOf(fieldOf(SCHEMA, 'Settings')).find((p) => p.name === 'links');
  if (links === undefined) throw new Error('no links');
  return propertiesOf(links.field);
};
const property = (name: string) => {
  const found = items().find((p) => p.name === name);
  if (found === undefined) throw new Error(`no ${name}`);
  return found;
};

describe('visibleWhen in the form model (SDK 1.5.0 part 4)', () => {
  it('gives a link item its fields although it has an allOf of if/then (A1); other allOf and oneOf stay JSON boxes', () => {
    expect(items().map((p) => [p.name, p.field.kind])).toEqual([
      ['name', 'text'], ['mode', 'choice'], ['direction', 'choice'], ['host', 'text'], ['port', 'number'],
      ['listen', 'object'], ['multicastInterface', 'text'], ['targetLayer', 'layer'],
    ]);
    const object = (extra: Record<string, unknown>) => fieldOf({ type: 'object', properties: { a: { type: 'string' } }, ...extra }, 'X').kind;
    expect(object({ if: { required: ['a'] }, then: { required: ['a'] }, else: {} })).toBe('object');
    expect(object({ allOf: [{ required: ['a'] }] }), 'not only conditions').toBe('json');
    expect(object({ allOf: [] })).toBe('json');
    expect(object({ oneOf: [{}] })).toBe('json');
    expect(fieldOf({ type: 'string', if: { minLength: 1 }, then: {} }, 'X').kind, 'only an object\'s').toBe('json');
  });

  it('shows the field while the sibling\'s value is in "in"; an absent sibling counts as its default; with both it keeps enabledWhen', () => {
    const host = property('host');
    expect(host.visibleWhen).toEqual({ property: 'mode', label: 'Mode', default: 'tcp-client', in: ['tcp-client', 'udp'] });
    expect(isVisible(host, {})).toBe(true); // the default, tcp-client
    expect(isVisible(host, { mode: 'tcp-server' })).toBe(false);
    expect(isVisible(property('listen'), { mode: 'udp' })).toBe(true);
    expect(property('multicastInterface').enabledWhen?.property).toBe('direction');
    expect(property('targetLayer').visibleWhen?.property, 'with kind').toBe('direction');
  });

  it('reports one it cannot use, and shows that field', () => {
    const told: [string, string][] = [];
    const field = fieldOf({ type: 'object', properties: { mode: { enum: ['a'] }, f: { type: 'string', 'x-emc2': { visibleWhen: { property: 'mod', in: ['a'] } } } } },
      'S', (path, problem) => { told.push([path, problem]); });
    expect(told).toEqual([['/properties/f/x-emc2/visibleWhen', 'there is no field "mod" beside it']]);
    expect(propertiesOf(field).find((p) => p.name === 'f')?.visibleWhen).toBeUndefined();
  });
});

describe('a field shown by another field\'s value in the form', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  function show(values: JsonObject, ...answers: Response[]) {
    const calls: { readonly method: string; readonly body: unknown }[] = [];
    let stored: unknown = values;
    const doFetch = vi.fn<typeof fetch>((_input, init) => {
      const method = init?.method ?? 'GET';
      const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      calls.push({ method, body });
      if (method === 'GET') return Promise.resolve(Response.json({ schema: SCHEMA, values: stored }));
      const next = answers.shift();
      if (next !== undefined) return Promise.resolve(next);
      stored = body;
      return Promise.resolve(Response.json({ values: stored }));
    });
    render(<PluginSettingsView pluginId="gmti" services={settingsServices(doFetch)} />);
    return calls;
  }

  /** T-203 part D: the first link's side form, chosen in the table. */
  async function openLink() {
    fireEvent.click(await screen.findByRole('button', { name: 'Item 1' }));
    return within(screen.getByRole('complementary', { name: 'Item 1' }));
  }

  it('hides it while the condition does not hold, keeps and saves its value, and follows changes at once; a field with both is hidden, then greyed', async () => {
    const calls = show({ links: [{ name: 'north', mode: 'tcp-server', direction: 'out', host: 'kept.example', port: 4607, listen: { port: 4608 } }] });
    const link = await openLink();
    expect(link.queryByRole('textbox', { name: 'Host' }), 'hidden').toBeNull();
    expect(link.getByRole('group', { name: 'Listen' })).toBeTruthy();
    expect(link.queryByRole('textbox', { name: 'Multicast interface' }), 'udp only').toBeNull();

    fireEvent.change(link.getByRole('combobox', { name: 'Mode' }), { target: { value: '2' } }); // udp
    await waitFor(() => { expect(link.getByRole('textbox', { name: 'Host' })).toHaveProperty('value', 'kept.example'); });
    const multicast = link.getByRole('textbox', { name: 'Multicast interface' });
    expect(multicast.closest('fieldset')?.disabled, 'shown, and greyed for an out link').toBe(true);

    fireEvent.change(link.getByRole('combobox', { name: 'Mode' }), { target: { value: '1' } }); // tcp-server
    await waitFor(() => { expect(link.queryByRole('textbox', { name: 'Host' })).toBeNull(); });
    fireEvent.change(link.getByRole('textbox', { name: 'Name' }), { target: { value: 'north2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save item' }));
    await screen.findByText('Saved.');
    expect(calls.at(-1)?.body, 'the hidden host and port are saved as they are').toEqual({
      links: [{ name: 'north2', mode: 'tcp-server', direction: 'out', host: 'kept.example', port: 4607, listen: { port: 4608 } }],
    });
  });

  it('shows the server\'s problem in a hidden field after the field that hides it, and an if/then\'s at the item (CR-0039 point 8, A2)', async () => {
    const refusal = Response.json({ problems: [
      { path: '/links/0/port', problem: 'must be at most 65535' },
      { path: '/links/0', problem: 'required property \'listen\' not found' },
    ] }, { status: 400 });
    show({ links: [{ name: 'north', mode: 'tcp-server', direction: 'in', port: 70000 }] }, refusal);
    const link = await openLink();
    fireEvent.change(link.getByRole('textbox', { name: 'Name' }), { target: { value: 'north2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save item' }));

    const note = await link.findByText('Port (shown when Mode is tcp-client or udp): must be at most 65535');
    const mode = link.getByRole('combobox', { name: 'Mode' });
    expect(mode.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING, 'after Mode').toBeTruthy();
    expect(link.getByText('required property \'listen\' not found'), 'at the item').toBeTruthy();
  });
});
