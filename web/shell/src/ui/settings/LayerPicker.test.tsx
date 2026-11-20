import type { ChangeEvent, ChangeOutcome, ChangeRequestContent, Layer, LivePictureListener, SecurityLabel, Snapshot, User } from '@emc2/plugin-sdk';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LayerChanger } from '../../layers/changer.ts';
import { LayerCreator } from '../../layers/creator.ts';
import { KnownLayers, type LayerSource } from '../../layers/known.ts';
import { settingsServices } from '../../testing/fakes.ts';
import type { ViewServices } from '../services.ts';
import { PluginSettingsView } from './PluginSettingsView.tsx';

/** A label's text, with or without the required mark after it (the UXA's `*`, aria-hidden). */
const marked = (label: string) => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\*?$`);

/** An optional single pick, a pick of existing layers only, and a set of picks (SDK 1.2.0, ADR-0037 point 2). */
const PICK = { type: 'object', 'x-emc2': { kind: 'layer' }, properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' } }, required: ['name'] };
const SCHEMA = {
  type: 'object',
  properties: {
    target: { ...PICK, description: 'Where received objects go.' },
    existing: { ...PICK, 'x-emc2': { kind: 'layer', allowNew: false } },
    sources: { type: 'array', default: [], items: { ...PICK, 'x-emc2': { kind: 'layer', allowNew: false } } },
    extra: { type: 'array', items: PICK },
  },
};

type Shown = Pick<Layer, 'id' | 'name' | 'drawOrder'> & { readonly workspace?: string };

const BLUE: Shown = { id: 'L1', name: 'Blue', drawOrder: 2 };
const RED: Shown = { id: 'L2', name: 'Red', drawOrder: 1 };
const EXERCISE: Shown = { id: 'L3', name: 'Exercise', drawOrder: 3, workspace: 'simulator.simulation' };

/** The layers-and-counts channel, scripted. */
function layerSource() {
  let listener: LivePictureListener | null = null;
  const source: LayerSource = { subscribe: (l) => { listener = l; return () => undefined; } };
  return {
    source,
    snapshot: (layers: readonly Shown[]) => { act(() => { listener?.snapshot({ layers, objectCounts: {} } as unknown as Snapshot); }); },
    changes: (events: readonly Partial<ChangeEvent>[]) => { act(() => { listener?.changes(events as readonly ChangeEvent[]); }); },
  };
}

interface Call { readonly method: string; readonly body: unknown }

const LABEL: SecurityLabel = { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' };

/** The live connection the "+" creates layers through (SDK 1.4.0, T-133): applied unless `refuse` says otherwise. */
function connection(refuse?: ChangeOutcome) {
  const sent: { readonly content: ChangeRequestContent; readonly pluginId: string }[] = [];
  return {
    sent,
    submit: vi.fn((content: ChangeRequestContent, pluginId: string): Promise<ChangeOutcome> => {
      sent.push({ content, pluginId });
      return Promise.resolve(refuse ?? ({ outcome: 'applied' } as unknown as ChangeOutcome));
    }),
  };
}

function server(values: unknown, withLayers = true, schema: unknown = SCHEMA, ...answers: Response[]) {
  return serverWith({ values, withLayers, schema, answers });
}

function serverWith({ values, withLayers = true, schema = SCHEMA, answers = [], permissions = ['layers.edit'], refuse, label = LABEL, orders }: {
  readonly values: unknown; readonly withLayers?: boolean; readonly schema?: unknown; readonly answers?: Response[];
  readonly permissions?: readonly string[]; readonly refuse?: ChangeOutcome;
  readonly label?: SecurityLabel; readonly orders?: Readonly<Record<string, readonly string[]>>;
}) {
  const calls: Call[] = [];
  let stored = values;
  const doFetch = vi.fn<typeof fetch>((_input, init) => {
    const method = init?.method ?? 'GET';
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ method, body });
    if (method === 'GET') return Promise.resolve(Response.json({ schema, values: stored }));
    const next = answers.shift();
    if (next !== undefined) return Promise.resolve(next);
    stored = body;
    return Promise.resolve(Response.json({ values: stored }));
  });
  const layers = layerSource();
  const base = settingsServices(doFetch);
  const known = new KnownLayers(() => layers.source);
  const live = connection(refuse);
  const user = { has: (permission: string) => permissions.includes(permission) } as unknown as User;
  const creator = new LayerCreator({ user: () => user, layers: known, label: () => label, ...(orders === undefined ? {} : { orders: () => orders }), connection: live });
  const services: ViewServices = withLayers ? { ...base, layers: { known, changer: {} as LayerChanger, creator } } : base;
  return { calls, services, layers, live };
}

const plus = (field: string) => screen.queryByRole<HTMLButtonElement>('button', { name: `New layer for ${field}` });

/** Opens a picker's "+", types the name, and presses Create. */
async function createLayer(field: string, name: string) {
  fireEvent.click(plus(field) as HTMLButtonElement);
  const popover = await screen.findByRole('dialog', { name: `New layer for ${field}` });
  fireEvent.change(within(popover).getByLabelText('Name of the new layer'), { target: { value: name } });
  fireEvent.click(within(popover).getByRole('button', { name: 'Create' }));
  return popover;
}

/** Shows the form and waits until it takes input: subscribed to the drafts, as PluginSettingsView.test.tsx's showForm explains. */
async function show(services: ViewServices, first = 'Target') {
  const subscribe = vi.spyOn(services.drafts, 'subscribe');
  const before = subscribe.mock.calls.length;
  render(<PluginSettingsView pluginId="cot" services={services} />);
  await screen.findByLabelText(marked(first));
  await waitFor(() => { expect(subscribe.mock.calls.length).toBeGreaterThan(before); });
}

const select = (label: string) => screen.getByLabelText<HTMLSelectElement>(marked(label));
const options = (label: string) => [...select(label).options].map((o) => o.textContent);
const chosen = (label: string) => select(label).selectedOptions[0]?.textContent;
const save = () => screen.getByRole<HTMLButtonElement>('button', { name: 'Save' });
const described = (element: HTMLElement) => (element.getAttribute('aria-describedby') ?? '').split(' ')
  .map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
const optionValue = (label: string, text: string) => [...select(label).options].find((o) => o.textContent === text)?.value ?? '';

async function saved(calls: readonly Call[]) {
  fireEvent.click(save());
  await screen.findByText('Saved.');
  return calls.at(-1)?.body;
}

afterEach(() => {
  cleanup();
});

describe('the layer picker in a settings form', () => {
  it('offers View\'s layers, the top one first, and "None", and saves a pick with its id and name', async () => {
    const { calls, services, layers } = server({ sources: [] });
    await show(services);
    layers.snapshot([RED, EXERCISE, BLUE]);

    expect(options('Target')).toEqual(['None', 'Blue', 'Red']);
    expect(chosen('Target')).toBe('None');
    expect(described(select('Target'))).toBe('Where received objects go.');
    fireEvent.change(select('Target'), { target: { value: optionValue('Target', 'Red') } });

    expect(await saved(calls)).toEqual({ sources: [], target: { id: 'L2', name: 'Red' } });
    expect(chosen('Target')).toBe('Red');
  });

  it('creates a layer with "+" at once, on top of View, as core-shell, and picks it with its id (SDK 1.4.0, T-133)', async () => {
    const { calls, services, layers, live } = server({ sources: [] });
    await show(services);
    layers.snapshot([RED, EXERCISE, BLUE]);

    const popover = await createLayer('Target', '  TAK North tracks ');
    await waitFor(() => { expect(chosen('Target')).toBe('TAK North tracks'); });
    expect(popover.isConnected, 'closed').toBe(false);
    expect(live.sent).toHaveLength(1);
    const { content, pluginId } = live.sent[0] as { content: ChangeRequestContent & { data: Record<string, unknown> }; pluginId: string };
    expect(pluginId).toBe('core-shell');
    expect(content).toMatchObject({ entityType: 'layer', operation: 'create' });
    expect(content.data).toEqual({ name: 'TAK North tracks', drawOrder: 3, visible: true, label: LABEL, extensions: {} }); // above Blue (2); Exercise is not View's

    expect(calls.filter((c) => c.method === 'PUT'), 'creating saves no settings: Save does').toEqual([]);
    expect(await saved(calls)).toEqual({ sources: [], target: { id: content.entityId, name: 'TAK North tracks' } });
    layers.changes([{ entityType: 'layer', entityId: content.entityId, state: { id: content.entityId, name: 'TAK North tracks', drawOrder: 3 } as unknown as Layer }]);
    expect(options('Target')).toEqual(['None', 'TAK North tracks', 'Blue', 'Red']);
  });

  it('offers the default policy\'s classifications in "+", the default chosen, and creates the layer with the one chosen (SDK 1.5.0 part 4, A4)', async () => {
    const label: SecurityLabel = { policyIdentifier: { name: 'NATO' }, classification: 'RESTRICTED', categories: [{ tagName: 'Releasable To', type: 'permissive', values: ['SWE'] }] };
    const orders = { nato: ['UNCLASSIFIED', 'RESTRICTED', 'SECRET'] }; // the policy's name ignoring case
    const { services, layers, live } = serverWith({ values: { sources: [] }, label, orders });
    await show(services);
    layers.snapshot([BLUE]);

    fireEvent.click(plus('Target') as HTMLButtonElement);
    const popover = within(await screen.findByRole('dialog', { name: 'New layer for Target' }));
    const classification = popover.getByLabelText<HTMLSelectElement>('Classification');
    expect([...classification.options].map((o) => o.textContent), 'lowest first').toEqual(['UNCLASSIFIED', 'RESTRICTED', 'SECRET']);
    expect(classification.value, 'the default\'s').toBe('RESTRICTED');
    fireEvent.change(classification, { target: { value: 'SECRET' } });
    fireEvent.change(popover.getByLabelText('Name of the new layer'), { target: { value: 'Secret tracks' } });
    fireEvent.click(popover.getByRole('button', { name: 'Create' }));

    await waitFor(() => { expect(live.sent).toHaveLength(1); });
    const { content } = live.sent[0] as unknown as { content: ChangeRequestContent & { data: Record<string, unknown> } };
    expect(content.data.label, 'the default label with the chosen classification').toEqual({ ...label, classification: 'SECRET' });

    fireEvent.click(plus('Target') as HTMLButtonElement);
    const again = within(await screen.findByRole('dialog', { name: 'New layer for Target' }));
    expect(again.getByLabelText<HTMLSelectElement>('Classification').value, 'the default again at the next opening').toBe('RESTRICTED');
  });

  it('has no classification in "+" without an order, or with the default\'s classification outside it, and uses the default label', async () => {
    for (const orders of [undefined, { NATO: ['UNCLASSIFIED', 'SECRET'] }, { SWE: ['HEMLIG'] }]) {
      const { services, layers, live } = serverWith({ values: { sources: [] }, label: { ...LABEL, classification: 'RESTRICTED' }, ...(orders === undefined ? {} : { orders }) });
      await show(services);
      layers.snapshot([BLUE]);
      const popover = await createLayer('Target', 'Plain');
      expect(within(popover).queryByLabelText('Classification'), JSON.stringify(orders)).toBeNull();
      await waitFor(() => { expect(live.sent).toHaveLength(1); });
      expect((live.sent[0]?.content as { data: { label: unknown } }).data.label).toEqual({ ...LABEL, classification: 'RESTRICTED' });
      cleanup();
    }
  });

  it('says why a layer was not created, in the popover, and leaves the pick alone; Escape closes it', async () => {
    const refused = { outcome: 'rejected', rejection: { code: 'PERMISSION_DENIED', message: 'changing a layer needs the permission layers.edit' } } as unknown as ChangeOutcome;
    const { calls, services, layers } = serverWith({ values: { sources: [] }, refuse: refused });
    await show(services);
    layers.snapshot([BLUE]);

    const popover = await createLayer('Target', 'Contacts');
    await within(popover).findByText('The layer was not created: you may not change it.');
    expect(chosen('Target')).toBe('None');
    expect(calls.filter((c) => c.method === 'PUT'), 'the settings are not saved').toEqual([]);
    fireEvent.change(within(popover).getByLabelText('Name of the new layer'), { target: { value: '   ' } });
    fireEvent.keyDown(within(popover).getByLabelText('Name of the new layer'), { key: 'Enter' }); // Enter creates too
    await within(popover).findByText('Name the new layer.');
    fireEvent.keyDown(within(popover).getByLabelText('Name of the new layer'), { key: 'Escape' });
    await waitFor(() => { expect(screen.queryByRole('dialog', { name: 'New layer for Target' })).toBeNull(); });
  });

  it('offers no "+" without layers.edit (the ACA\'s R6), nor where the schema allows existing layers only', async () => {
    const { services, layers } = serverWith({ values: { sources: [] }, permissions: ['objects.edit'] });
    await show(services);
    layers.snapshot([BLUE]);
    expect(plus('Target')).toBeNull();
    expect(plus('Extra')).toBeNull();
    cleanup();

    const admin = server({ sources: [] });
    await show(admin.services);
    admin.layers.snapshot([BLUE]);
    expect(plus('Target')).not.toBeNull();
    expect(plus('Existing'), 'allowNew: false').toBeNull();
    expect(plus('Sources'), 'allowNew: false').toBeNull();
  });

  it('keeps a saved layer that no longer exists, marked, until it is changed', async () => {
    const { calls, services, layers } = server({ target: { id: 'L9', name: 'Old tracks' }, existing: { id: 'L3', name: 'Exercise' }, sources: [] });
    await show(services);
    expect(chosen('Target'), 'before the layers arrive: as saved').toBe('Old tracks');
    layers.snapshot([BLUE, EXERCISE]);

    expect(chosen('Target')).toBe('Old tracks (no longer exists)');
    expect(chosen('Existing')).toBe('Exercise (not in View)');
    fireEvent.change(select('Existing'), { target: { value: optionValue('Existing', 'Blue') } });
    expect(await saved(calls)).toEqual({ target: { id: 'L9', name: 'Old tracks' }, existing: { id: 'L1', name: 'Blue' }, sources: [] });
  });

  it('offers existing layers only where the schema says so', async () => {
    const { services, layers } = server({ sources: [] });
    await show(services);
    layers.snapshot([BLUE, RED]);

    expect(options('Existing')).toEqual(['None', 'Blue', 'Red']);
    expect(described(select('Existing'))).toBe('Existing layers only.');
  });

  it('follows layers as they come and go', async () => {
    const { services, layers } = server({ sources: [] });
    await show(services);
    layers.snapshot([BLUE]);
    layers.changes([{ entityType: 'layer', entityId: 'L2', state: { ...RED } as unknown as Layer }]);

    expect(options('Target')).toEqual(['None', 'Blue', 'Red']);
    layers.changes([{ entityType: 'layer', entityId: 'L1', state: null }]);
    expect(options('Target')).toEqual(['None', 'Red']);
  });

  it('shows a set of picks as checkboxes, saved in the layers\' order, and keeps a gone one until it is unchecked', async () => {
    const { calls, services, layers } = server({ sources: [{ id: 'L2', name: 'Red' }, { id: 'L9', name: 'Gone' }] });
    await show(services);
    layers.snapshot([RED, BLUE]);
    const sources = within(screen.getByRole('group', { name: 'Sources' }));

    expect(sources.getAllByRole('checkbox').map((c) => [c.closest('.field')?.textContent, (c as HTMLInputElement).checked])).toEqual([
      ['Blue', false], ['Red', true], ['Gone (no longer exists)', true],
    ]);
    expect(sources.queryByRole('button', { name: /New layer/ }), 'existing layers only').toBeNull();
    fireEvent.click(sources.getByLabelText('Blue'));
    expect(await saved(calls)).toEqual({ sources: [{ id: 'L1', name: 'Blue' }, { id: 'L2', name: 'Red' }, { id: 'L9', name: 'Gone' }] });

    fireEvent.click(sources.getByLabelText('Gone (no longer exists)'));
    expect(await saved(calls)).toEqual({ sources: [{ id: 'L1', name: 'Blue' }, { id: 'L2', name: 'Red' }] });
    expect(sources.queryByLabelText('Gone (no longer exists)')).toBeNull();
  });

  it('creates a layer with a set\'s "+" and checks it, saved with its id (owner, 2026-11-05)', async () => {
    const { calls, services, layers, live } = server({ sources: [] });
    await show(services);
    layers.snapshot([BLUE]);
    const extra = within(screen.getByRole('group', { name: 'Extra' }));
    fireEvent.click(extra.getByLabelText('Blue'));

    await createLayer('Extra', 'Contacts');
    const id = (live.sent[0]?.content as ChangeRequestContent).entityId;
    await waitFor(() => { expect(extra.getByLabelText<HTMLInputElement>('Contacts').checked).toBe(true); });
    expect(await saved(calls)).toEqual({ sources: [], extra: [{ id: 'L1', name: 'Blue' }, { id, name: 'Contacts' }] });
    expect(extra.queryByRole('textbox'), 'no name fields any more').toBeNull();
  });

  it('will not save a required pick left unchosen, and says why', async () => {
    const schema = { type: 'object', properties: { target: PICK, note: { type: 'string' } }, required: ['target'] };
    const { calls, services, layers } = server({}, true, schema);
    await show(services);
    layers.snapshot([BLUE]);

    expect(options('Target')).toEqual(['Choose a layer', 'Blue']);
    expect(select('Target').getAttribute('aria-required')).toBe('true');
    expect(described(select('Target'))).toContain('Required: choose a layer.');
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'x' } });
    expect(save().disabled).toBe(true);
    fireEvent.change(select('Target'), { target: { value: optionValue('Target', 'Blue') } });

    expect(options('Target'), 'no way back to none').toEqual(['Blue']);
    expect(await saved(calls)).toEqual({ target: { id: 'L1', name: 'Blue' }, note: 'x' });
  });

  it('says when the layers are loading, could not be read, or View has none', async () => {
    const { services, layers } = server({ sources: [] });
    await show(services);
    expect(described(select('Target'))).toContain('Loading the layers…');
    layers.snapshot([EXERCISE]);

    expect(described(select('Target'))).toContain('View has no layers.');
    expect(described(screen.getByRole('group', { name: 'Sources' }))).toContain('View has no layers.');
    expect(options('Existing')).toEqual(['None']);

    const failing = server({ sources: [] });
    cleanup();
    const source: LayerSource = { subscribe: (_l, onError) => { onError(new Error('the live picture is closed')); return () => undefined; } };
    await show({ ...failing.services, layers: { known: new KnownLayers(() => source), changer: {} as LayerChanger } });
    await waitFor(() => { expect(described(select('Target'))).toContain('The layers could not be read: the live picture is closed'); });
  });

  it('keeps a set within its most, and a value saved without an id before SDK 1.4.0', async () => {
    const schema = {
      type: 'object',
      properties: {
        existing: { ...PICK, 'x-emc2': { kind: 'layer', allowNew: false } },
        sources: { type: 'array', maxItems: 1, items: PICK },
      },
    };
    const { calls, services, layers } = server({ existing: { name: 'Made by hand' }, sources: [{ id: 'L1', name: 'Blue' }] }, true, schema);
    await show(services, 'Existing');
    layers.snapshot([BLUE, RED]);
    const sources = within(screen.getByRole('group', { name: 'Sources' }));

    expect(chosen('Existing')).toBe('New layer…');
    expect(screen.getByLabelText<HTMLInputElement>('Existing: Name of the new layer').value).toBe('Made by hand');
    expect(described(screen.getByRole('group', { name: 'Sources' }))).toContain('At most 1 layers.');
    expect(sources.getByLabelText<HTMLInputElement>('Red').disabled).toBe(true);
    expect(plus('Sources')?.disabled, 'full').toBe(true);
    fireEvent.click(sources.getByLabelText('Blue'));
    expect(sources.getByLabelText<HTMLInputElement>('Red').disabled).toBe(false);
    expect(await saved(calls)).toEqual({ existing: { name: 'Made by hand' }, sources: [] });
  });

  it('shows the server\'s problem with the name of a layer saved without an id at that input', async () => {
    const refusal = Response.json({ problems: [{ path: '/target/name', problem: 'must be at most 256 characters' }] }, { status: 400 });
    const { services, layers } = server({ target: { name: 'Track' }, sources: [] }, true, SCHEMA, refusal); // saved before SDK 1.4.0
    await show(services);
    layers.snapshot([BLUE]);
    fireEvent.change(screen.getByLabelText('Target: Name of the new layer'), { target: { value: 'Tracks' } });
    fireEvent.click(save());

    await screen.findByRole('alert');
    const name = screen.getByLabelText('Target: Name of the new layer');
    expect(name.getAttribute('aria-invalid')).toBe('true');
    expect(described(name)).toContain('must be at most 256 characters');
  });

  it('says so where the layers are not known, and keeps what is saved', async () => {
    const { calls, services } = server({ target: { id: 'L1', name: 'Blue' }, sources: [] }, false);
    await show(services);

    expect(chosen('Target')).toBe('Blue');
    expect(described(select('Target'))).toContain('The layers are not known here.');
    fireEvent.change(select('Existing'), { target: { value: '' } }); // no change: nothing to save
    expect(save().disabled).toBe(true);
    expect(calls.filter((c) => c.method === 'PUT')).toEqual([]);
  });
});
