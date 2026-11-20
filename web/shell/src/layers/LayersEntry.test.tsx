import type { ChangeEvent, ChangeOutcome, ChangeRequestContent, Layer, LayerPage, LivePictureListener, MapObject, SecurityLabel, User, Uuid } from '@emc2/plugin-sdk';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShellStore, VIEW_INFO } from '../ui/store.ts';
import { LayerChanger } from './changer.ts';
import { KnownLayers, type LayerSource } from './known.ts';
import { LayersEntry } from './LayersEntry.tsx';

const label = (classification: string, policy = 'NATO'): SecurityLabel => ({ policyIdentifier: { name: policy }, classification });
const layer = (id: string, name: string, labelled: SecurityLabel, drawOrder: number): Layer =>
  ({ id, version: 1, name, drawOrder, visible: true, label: labelled, meta: {} }) as unknown as Layer;
const LAYERS = [
  layer('A', 'Blue forces', label('UNCLASSIFIED'), 1), layer('B', 'Liaison', label('HEMLIG', 'SWE'), 2), layer('C', 'Special', label('NATO SPECIAL'), 0),
];

const object = (id: string, name: string, labelled: SecurityLabel = label('UNCLASSIFIED')): MapObject =>
  ({ id, version: 1, layerId: 'A', type: 'core.symbol', dataType: 'core.general', dataSource: 'manual', label: labelled, properties: { name }, meta: {} }) as unknown as MapObject;

function setUp(
  permissions: readonly string[] = ['layers.edit', 'objects.edit'], submit: (content: ChangeRequestContent) => Promise<ChangeOutcome> = () => new Promise<never>(() => undefined),
  held: MapObject[] = [],
) {
  let listener: LivePictureListener | null = null;
  let failed: ((error: unknown) => void) | null = null;
  const source: LayerSource = { subscribe: (l, onError) => { listener = l; failed = onError; return () => undefined; } };
  const known = new KnownLayers(() => source);
  const store = new ShellStore();
  const user = { has: (p: string) => permissions.includes(p) } as unknown as User;
  const connection = {
    submit: vi.fn(submit),
    queryLayer: vi.fn((layerId: Uuid, page: number, pageSize: number): Promise<LayerPage> => Promise.resolve({
      layerId, page, pageSize, objects: held.slice(page * pageSize, (page + 1) * pageSize), total: held.length,
    })),
  };
  const changer = new LayerChanger({
    store, user: () => user, orders: () => ({ NATO: ['UNCLASSIFIED', 'RESTRICTED', 'SECRET'] }), current: (id) => known.layer(id), connection,
    workspaces: () => [VIEW_INFO],
  });
  render(<LayersEntry layers={known} changer={changer} />);
  const arrive = () => { act(() => { listener?.snapshot({ layers: LAYERS, objects: [], sequenceNo: 1, objectCounts: { A: 1234, B: 1 } }); }); };
  /** The server's change of a layer reaches the channel. */
  const changed = (next: Layer) => { act(() => { listener?.changes([{ entityType: 'layer', entityId: next.id, state: next } as unknown as ChangeEvent]); }); };
  const fail = (error: Error) => { act(() => { failed?.(error); }); };
  /** The server's new object counts reach the channel. */
  const counted = (counts: Record<string, number>) => { act(() => { listener?.counts?.(counts); }); };
  return { store, changer, connection, arrive, changed, fail, counted };
}

const card = (name: string) => within(screen.getByRole('article', { name }));
/** A card's buttons by name, `(off)` after a disabled one. */
const buttons = (name: string) => card(name).queryAllByRole('button').map((b) => `${b.textContent}${b.hasAttribute('disabled') ? ' (off)' : ''}`);

afterEach(() => {
  cleanup();
});

describe('Settings › Layers', () => {
  it('lists the layers, the top one first, with their label and number of objects; one without an order is read only', () => {
    const t = setUp();
    expect(screen.getByText('Reading the layers…')).toBeTruthy();
    t.arrive();
    expect(screen.getAllByRole('article').map((a) => a.querySelector('h3')?.textContent)).toEqual(['Liaison', 'Blue forces', 'Special']);
    expect(card('Blue forces').getByText('NATO UNCLASSIFIED · 1,234 objects')).toBeTruthy();
    expect(card('Liaison').getByText(/No order of classifications is configured for SWE HEMLIG/)).toBeTruthy();
    expect(card('Liaison').queryByRole('combobox')).toBeNull();
    expect(card('Special').getByText(/No order of classifications is configured for NATO NATO SPECIAL/)).toBeTruthy(); // outside the order
    expect(buttons('Special')).toEqual(['Show objects', 'Delete all objects (off)']); // no objects
  });

  it('says so when the layers cannot be read', () => {
    const t = setUp();
    t.fail(new Error('the live picture is not connected'));
    expect(screen.getByText('The layers could not be read: the live picture is not connected')).toBeTruthy();
    expect(screen.queryByText('Reading the layers…')).toBeNull();
  });

  it('keeps the card when the change is done, starts its form afresh, and puts the focus on its heading (review F2)', async () => {
    const t = setUp(undefined, () => Promise.resolve({ outcome: 'applied' } as unknown as ChangeOutcome));
    t.arrive();
    const blue = card('Blue forces');
    const article = screen.getByRole('article', { name: 'Blue forces' });
    fireEvent.change(blue.getByRole('combobox', { name: 'Classification' }), { target: { value: 'SECRET' } });
    fireEvent.click(blue.getByRole('button', { name: 'Apply' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Change layer' }));
    t.changed({ ...(LAYERS[0] as Layer), version: 2, label: label('SECRET') });
    await act(async () => { await vi.waitFor(() => { expect(t.changer.getState().running).toBe(false); }); });
    expect(screen.getByRole('article', { name: 'Blue forces' })).toBe(article); // the same card
    expect(card('Blue forces').getByText('NATO SECRET · 1,234 objects')).toBeTruthy();
    expect(card('Blue forces').getByRole<HTMLSelectElement>('combobox', { name: 'Classification' }).value).toBe('SECRET');
    expect(document.activeElement).toBe(article.querySelector('h3'));
  });

  it('asks once, saying what happens, and changes on yes', () => {
    const t = setUp();
    t.arrive();
    const blue = card('Blue forces');
    const apply = blue.getByRole('button', { name: 'Apply' });
    expect(apply.hasAttribute('disabled')).toBe(true); // nothing to do yet
    fireEvent.change(blue.getByRole('combobox', { name: 'Classification' }), { target: { value: 'SECRET' } });
    fireEvent.click(apply);
    let question = screen.getByRole('alertdialog', { name: 'Change layer classification' });
    expect(question.textContent).toContain('Change the layer Blue forces from UNCLASSIFIED to SECRET? Its objects keep their classifications.');
    fireEvent.click(within(question).getByRole('button', { name: 'Cancel' }));

    fireEvent.click(blue.getByRole('checkbox', { name: 'Also raise objects below it' }));
    fireEvent.click(apply);
    question = screen.getByRole('alertdialog');
    expect(question.textContent).toContain('Change the layer Blue forces from UNCLASSIFIED to SECRET, and raise its objects? The layer has 1,234 objects;'
      + ' those of policy NATO below SECRET are raised to SECRET, others are left alone. This cannot be undone.');
    fireEvent.click(within(question).getByRole('button', { name: 'Change and raise' }));
    expect(t.connection.submit).toHaveBeenCalledOnce();
    expect(t.changer.getState().running).toBe(true);
    expect(blue.getByRole('button', { name: 'Apply' }).hasAttribute('disabled')).toBe(true); // while it runs
  });

  it('shows a locked layer as locked and offers no change, until it is unlocked (ADR-0042; owner, 2026-10-30)', () => {
    const t = setUp();
    t.arrive();
    const blue = LAYERS[0] as Layer;
    t.changed({ ...blue, version: 2, locked: true });
    expect(card('Blue forces').getByText('This layer is locked. Unlock it in the Layers panel to change its classification or raise or delete its objects.'))
      .toBeTruthy();
    expect(card('Blue forces').queryByRole('combobox')).toBeNull();
    expect(buttons('Blue forces')).toEqual(['Show objects', 'Delete all objects (off)']);
    expect(card('Blue forces').queryByText(/live tracks/)).toBeNull();

    t.changed({ ...blue, version: 3 }); // unlocked: the store keeps false as absent
    expect(card('Blue forces').queryByText(/This layer is locked/)).toBeNull();
    expect(card('Blue forces').getByRole('button', { name: 'Apply' })).toBeTruthy();
  });

  it('says the layer is locked when a lock came first on the server', async () => {
    const t = setUp(undefined, () => Promise.resolve({ outcome: 'rejected', rejection: { code: 'LAYER_LOCKED', message: 'the layer Blue forces is locked (ADR-0042)' } } as unknown as ChangeOutcome));
    t.arrive();
    const blue = card('Blue forces');
    fireEvent.change(blue.getByRole('combobox', { name: 'Classification' }), { target: { value: 'SECRET' } });
    fireEvent.click(blue.getByRole('button', { name: 'Apply' }));
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Change layer' }));
    await vi.waitFor(() => { expect(t.changer.getState().running).toBe(false); });
    expect(t.store.getView().notifications.map((n) => n.message)).toEqual(['The layer Blue forces was not changed: it is locked.']);
  });

  it('offers only what the user may do; with objects.edit alone, raising the objects below the layer (owner, 2026-10-17)', () => {
    const raiser = setUp(['objects.edit']);
    raiser.arrive();
    expect(screen.getByText("You may not change layers (layers.edit); you may raise their objects to a layer's classification.")).toBeTruthy();
    expect(screen.queryByRole('combobox')).toBeNull();
    fireEvent.click(card('Blue forces').getByRole('button', { name: 'Raise objects below UNCLASSIFIED' }));
    const question = screen.getByRole('alertdialog');
    expect(question.textContent).toContain('Raise the objects of the layer Blue forces? The layer has 1,234 objects; those of policy NATO below UNCLASSIFIED'
      + ' are raised to UNCLASSIFIED, others are left alone. This cannot be undone.');
    expect(within(question).getByRole('button', { name: 'Raise objects' })).toBeTruthy();
    cleanup();

    const viewer = setUp([]);
    viewer.arrive();
    expect(screen.getByText('You may not change layers or objects (layers.edit, objects.edit).')).toBeTruthy();
    expect(new Set(screen.getAllByRole('button').map((b) => b.textContent))).toEqual(new Set(['Show objects'])); // only the list
    cleanup();

    const layersOnly = setUp(['layers.edit']);
    layersOnly.arrive();
    const raise = card('Blue forces').getByRole('checkbox', { name: 'Also raise objects below it (you may not change objects)' });
    expect(raise.hasAttribute('disabled')).toBe(true);
  });
});

describe("Settings › Layers: a layer's objects (T-175)", () => {
  const HELD = Array.from({ length: 120 }, (_, i) => object(`o${String(i).padStart(3, '0')}`, `Track ${String(i + 1)}`));
  const rows = () => within(screen.getByRole('table', { name: 'Objects of Blue forces' })).getAllByRole('row').slice(1)
    .map((r) => [...r.querySelectorAll('th, td')].map((c) => c.textContent));

  it("lists them 50 at a time when asked: name, data type, source and classification, with the policy when it is not the layer's", async () => {
    const held = [...HELD];
    held[1] = object('o001', 'Liaison', label('HEMLIG', 'SWE'));
    held[2] = { ...object('o002', 'x'), properties: {} }; // no name: its id
    const t = setUp(undefined, undefined, held);
    t.arrive();
    const show = card('Blue forces').getByRole('button', { name: 'Show objects' });
    expect(show.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(show);
    expect(card('Blue forces').getByText('Reading the objects…')).toBeTruthy();
    await screen.findByRole('table');
    expect(card('Blue forces').getByRole('button', { name: 'Hide objects' }).getAttribute('aria-expanded')).toBe('true');
    expect(rows().slice(0, 3)).toEqual([
      ['Track 1', 'core.general', 'manual', 'UNCLASSIFIED'], ['Liaison', 'core.general', 'manual', 'SWE HEMLIG'], ['o002', 'core.general', 'manual', 'UNCLASSIFIED'],
    ]);
    expect(rows()).toHaveLength(50);
    expect(card('Blue forces').getByText('Objects 1–50 of 120')).toBeTruthy();
    expect(t.connection.queryLayer).toHaveBeenLastCalledWith('A', 0, 50);
    expect(card('Blue forces').getByRole('button', { name: 'Previous' }).hasAttribute('disabled')).toBe(true);

    fireEvent.click(card('Blue forces').getByRole('button', { name: 'Next' }));
    await card('Blue forces').findByText('Objects 51–100 of 120');
    fireEvent.click(card('Blue forces').getByRole('button', { name: 'Next' }));
    await card('Blue forces').findByText('Objects 101–120 of 120');
    expect(rows()[0]?.[0]).toBe('Track 101');
    expect(card('Blue forces').getByRole('button', { name: 'Next' }).hasAttribute('disabled')).toBe(true);

    held.splice(0, 100); // deleted elsewhere: Refresh goes back to the last page there is
    fireEvent.click(card('Blue forces').getByRole('button', { name: 'Refresh' }));
    await card('Blue forces').findByText('Objects 1–20 of 20');

    fireEvent.click(card('Blue forces').getByRole('button', { name: 'Hide objects' }));
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('says so when the layer has none, and when they cannot be read', async () => {
    const t = setUp();
    t.arrive();
    fireEvent.click(card('Special').getByRole('button', { name: 'Show objects' }));
    await card('Special').findByText('The layer has no objects.');
    t.connection.queryLayer.mockRejectedValue(new Error('the server did not answer'));
    fireEvent.click(card('Special').getByRole('button', { name: 'Refresh' }));
    await card('Special').findByText('The objects could not be read: the server did not answer', undefined, { timeout: 4_000 }); // after the retries
  });

  it('empties a layer after asking with the count, and reads the open list again when done', async () => {
    const held = [...HELD];
    const t = setUp(undefined, (content) => {
      held.splice(held.findIndex((o) => o.id === content.entityId), 1); // the server deletes it
      return Promise.resolve({ outcome: 'applied' } as unknown as ChangeOutcome);
    }, held);
    t.arrive();
    t.counted({ A: 120, B: 1 });
    expect(card('Blue forces').getByText("Deleting all objects also deletes a data link's live tracks; they come back with their next report.")).toBeTruthy();
    fireEvent.click(card('Blue forces').getByRole('button', { name: 'Show objects' }));
    await card('Blue forces').findByText('Objects 1–50 of 120');
    fireEvent.click(card('Blue forces').getByRole('button', { name: 'Delete all objects' }));
    const question = screen.getByRole('alertdialog', { name: 'Delete all objects' });
    expect(question.textContent).toContain('Delete all 120 objects in Blue forces? This cannot be undone.');
    fireEvent.click(within(question).getByRole('button', { name: 'Delete all objects' }));
    expect(card('Blue forces').getByRole('button', { name: 'Delete all objects' }).hasAttribute('disabled')).toBe(true); // while it runs
    await vi.waitFor(() => { expect(t.changer.getState().running).toBe(false); });
    expect(t.connection.submit).toHaveBeenCalledTimes(120);
    expect(t.store.getView().notifications.map((n) => n.message)).toEqual(['Deleted 120 objects in Blue forces.']);
    t.counted({ A: 0, B: 1 });
    await card('Blue forces').findByText('The layer has no objects.');
    expect(buttons('Blue forces')).toEqual(['Apply (off)', 'Hide objects', 'Delete all objects (off)', 'Previous (off)', 'Next (off)', 'Refresh']);

    fireEvent.click(card('Liaison').getByRole('button', { name: 'Delete all objects' }));
    expect(screen.getByRole('alertdialog').textContent).toContain('Delete all 1 object in Liaison? This cannot be undone.');
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it("needs the shared Delete's right: objects.edit in View", () => {
    const t = setUp(['layers.edit']);
    t.arrive();
    expect(screen.queryByRole('button', { name: 'Delete all objects' })).toBeNull();
    expect(screen.queryByText(/live tracks/)).toBeNull();
  });
});

describe('Settings › Layers by workspace (ADR-0039; T-080)', () => {
  const VIEW_INFO = { id: 'core.view', name: 'View', order: -2147483648 };
  const SIM = { id: 'simulator.simulation', name: 'Simulation', viewPermission: 'plugin.simulator.view', editPermission: 'plugin.simulator.edit', order: 10 };
  const simLayer = { ...layer('S', 'Exercise', label('UNCLASSIFIED'), 5), workspace: SIM.id } as Layer;

  function setUpGrouped(permissions: readonly string[]) {
    let listener: LivePictureListener | null = null;
    const source: LayerSource = { subscribe: (l) => { listener = l; return () => undefined; } };
    const known = new KnownLayers(() => source);
    const user = { has: (p: string) => permissions.includes(p) } as unknown as User;
    const changer = new LayerChanger({
      store: new ShellStore(), user: () => user, orders: () => ({ NATO: ['UNCLASSIFIED', 'RESTRICTED', 'SECRET'] }), current: (id) => known.layer(id),
      connection: { submit: vi.fn(), queryLayer: vi.fn() }, workspaces: () => [VIEW_INFO, SIM],
    });
    render(<LayersEntry layers={known} changer={changer} workspaces={[VIEW_INFO, SIM]} />);
    act(() => { listener?.snapshot({ layers: [...LAYERS, simLayer], objects: [], sequenceNo: 1, objectCounts: {} }); });
    return { known };
  }

  it('groups the layers by workspace, View first, each under its name', () => {
    const t = setUpGrouped(['layers.edit', 'objects.edit', 'plugin.simulator.edit']);

    const groups = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(groups.slice(0, 1)).toEqual(['View']);
    expect(within(screen.getByRole('region', { name: 'Simulation' })).getAllByRole('article').map((a) => a.querySelector('h3')?.textContent))
      .toEqual(['Exercise']);
    expect(within(screen.getByRole('region', { name: 'View' })).getAllByRole('article')).toHaveLength(3);
    expect(t.known.workspaceOf('S')).toBe(SIM.id);
    expect(t.known.workspaceOf('A')).toBe('core.view');
    expect(t.known.workspaceOf('gone')).toBeNull();
  });

  it('needs the workspace\'s edit permission in a declared workspace, layers.edit and objects.edit in View', () => {
    setUpGrouped(['layers.edit', 'objects.edit']);

    expect(card('Blue forces').getByRole('combobox')).toBeTruthy();
    expect(card('Exercise').queryByRole('combobox')).toBeNull();
    expect(buttons('Exercise')).toEqual(['Show objects']);
    expect(within(screen.getByRole('region', { name: 'Simulation' })).getByText('You may not change these layers or their objects (plugin.simulator.edit).'))
      .toBeTruthy();
  });

  it('a user with only the workspace\'s edit permission changes its layers and not View\'s', () => {
    setUpGrouped(['plugin.simulator.edit']);

    expect(card('Exercise').getByRole('combobox')).toBeTruthy();
    expect(card('Blue forces').queryByRole('combobox')).toBeNull();
  });
});
