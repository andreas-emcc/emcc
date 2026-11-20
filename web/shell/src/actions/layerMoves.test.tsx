import {
  type ChangeOutcome, type ChangeRequestContent, type FetchResult, type Layer, type MapObject, type RejectionCode, type User, type Uuid,
  type WorkspaceInfo,
} from '@emc2/plugin-sdk';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KnownLayers, type LayerSource } from '../layers/known.ts';
import { ShellStore, VIEW_INFO } from '../ui/store.ts';
import { LayerMoveQuestion } from './LayerMoveQuestion.tsx';
import { copyOf, LayerMover, outcome } from './layerMoves.ts';

const SIM: WorkspaceInfo = { id: 'simulator.simulation', name: 'Simulation', order: 10, editPermission: 'plugin.simulator.edit' };

const layer = (id: string, name: string, drawOrder: number, more: Partial<Layer> = {}): Layer =>
  ({ id, name, drawOrder, visible: true, version: 1, label: { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' }, ...more }) as Layer;

const LAYERS = [
  layer('top', 'Top', 30), layer('a', 'Alpha', 20), layer('locked', 'Locked', 10, { locked: true }), layer('sim', 'Sim layer', 5, { workspace: SIM.id }),
];

const object = (id: string, layerId: string, more: Partial<MapObject> = {}): MapObject => ({
  id, version: 3, layerId, type: 'core.symbol', dataType: 'ais.vessel', dataSource: 'ais-north',
  geometry: { type: 'Point', coordinates: [17.3, 62.4] }, label: { policyIdentifier: { name: 'NATO' }, classification: 'SECRET' },
  properties: { name: `Ship ${id}` }, time: { observed: '2026-11-10T10:00:00Z', validFrom: '2026-11-10T09:00:00Z', expires: '2026-11-10T11:00:00Z' },
  extensions: { ais: { mmsi: 265123456 }, notes: { text: 'kept' } }, fieldSets: ['ais.ship'], relations: [{ kind: 'gmti.pairing', objectId: 'x' }],
  meta: { created: { at: '2026-11-10T09:00:00Z', by: { plugin: 'ais' } }, modified: { at: '2026-11-10T10:00:00Z', by: { plugin: 'ais' } },
    externalRef: { system: 'ais', id: '265123456' } },
  ...more,
});

const user: User = { id: 'u', name: 'U', permissions: new Set(), noLogin: false, has: () => true };
const rejected = (code: RejectionCode): ChangeOutcome => ({ outcome: 'rejected', rejection: { code, message: code } }) as unknown as ChangeOutcome;
const applied = { outcome: 'applied' } as unknown as ChangeOutcome;

/** A server with `objects` and `LAYERS`; `answer` decides each request (default: applied). */
function setUp(objects: readonly MapObject[], answer?: (content: ChangeRequestContent) => ChangeOutcome, workspace: WorkspaceInfo = VIEW_INFO) {
  const store = new ShellStore();
  const held = new Map(objects.map((o) => [o.id, o]));
  const sent: { readonly content: ChangeRequestContent; readonly pluginId: string }[] = [];
  const connection = {
    getObjects: vi.fn((ids: readonly Uuid[]): Promise<FetchResult> => Promise.resolve({
      found: ids.flatMap((id) => held.get(id) ?? []), missing: ids.filter((id) => !held.has(id)),
    })),
    submit: vi.fn((content: ChangeRequestContent, pluginId: string): Promise<ChangeOutcome> => {
      sent.push({ content, pluginId });
      return Promise.resolve(answer?.(content) ?? applied);
    }),
  };
  const source: LayerSource = {
    subscribe: (listener) => {
      queueMicrotask(() => { listener.snapshot({ layers: LAYERS, objects: [], sequenceNo: 1 }); });
      return () => undefined;
    },
  };
  const layers = new KnownLayers(() => source);
  const mover = new LayerMover({
    store, user: () => user, connection, workspace: () => workspace, layer: (id) => layers.layer(id), layersReady: () => layers.ready(),
    console: { warn: vi.fn(), error: vi.fn() },
  });
  return { store, mover, layers, connection, sent };
}

const notices = (store: ShellStore) => store.getView().notifications.map((n) => [n.severity, n.message]);

afterEach(() => {
  cleanup();
});

describe('Move to layer and Copy to layer (ADR-0053, T-155)', () => {
  it('are two shared object actions per workspace, with its edit permission, beside the Delete', () => {
    const { mover } = setUp([]);
    expect([mover.action('move'), mover.action('copy')].map((a) => [a.id, a.label, a.group, a.permission, a.workspaces, a.multiple]))
      .toEqual([
        ['move-to-layer', 'Move to layer…', 'layer', 'objects.edit', ['core.view'], true],
        ['copy-to-layer', 'Copy to layer…', 'layer', 'objects.edit', ['core.view'], true],
      ]);
    expect(mover.action('move', SIM)).toMatchObject({ id: 'move-to-layer-simulator.simulation', permission: 'plugin.simulator.edit', workspaces: [SIM.id] });
  });

  it('offers the workspace\'s layers that are not locked, the top one first (A1)', () => {
    const { mover } = setUp([]);
    expect(mover.choices(LAYERS, VIEW_INFO).map((l) => l.name)).toEqual(['Top', 'Alpha']);
    expect(mover.choices(LAYERS, SIM).map((l) => l.name)).toEqual(['Sim layer']);
  });

  it('moves with one update per object: the new layer and the complete core content, as core-shell (point 2)', async () => {
    const t = setUp([object('o1', 'top'), object('o2', 'a')]);
    await t.layers.ready();
    t.mover.ask('move', ['o1', 'o2']);
    await t.mover.confirm('a');

    const content = Object.fromEntries(Object.entries(object('o1', 'top')).filter(([key]) => !['id', 'version', 'meta'].includes(key)));
    expect(t.sent).toEqual([{
      content: { entityType: 'object', operation: 'update', entityId: 'o1', baseVersion: 3, data: { ...content, layerId: 'a' } }, pluginId: 'core-shell',
    }]);
    expect(notices(t.store)).toEqual([['info', 'Moved 1 object to Alpha. 1 was there already.']]);
  });

  it('copies as a hand-made snapshot with a new id: no observation, no expiry, no externalRef, everything else kept (point 3, A5)', async () => {
    const t = setUp([object('o1', 'top')]);
    await t.layers.ready();
    t.mover.ask('copy', ['o1']);
    await t.mover.confirm('top');

    expect(t.sent).toHaveLength(1);
    const request = t.sent[0]?.content;
    expect(request).toMatchObject({ entityType: 'object', operation: 'create' });
    expect(request?.entityId).not.toBe('o1');
    expect(request).not.toHaveProperty('externalRef');
    const original = object('o1', 'top');
    expect(request && 'data' in request ? request.data : null).toEqual({
      type: 'core.symbol', dataType: 'ais.vessel', dataSource: 'manual', layerId: 'top', geometry: original.geometry, label: original.label,
      properties: { name: 'Ship o1' }, time: { validFrom: '2026-11-10T09:00:00Z' }, extensions: original.extensions, fieldSets: ['ais.ship'],
      relations: original.relations,
    });
    expect(notices(t.store), 'a copy into its own layer is allowed (A2)').toEqual([['info', 'Copied 1 object to Top.']]);
    expect(copyOf(object('o2', 'a', { time: { observed: '2026-11-10T10:00:00Z' } }), 'top'), 'no time left: none').not.toHaveProperty('time');
  });

  it('leaves out objects of another workspace and reports each refusal once, staying (A3, A4, point 7)', async () => {
    const objects = [object('o1', 'top'), object('o2', 'sim'), object('o3', 'locked'), object('o4', 'top', { properties: { name: 'Banned' } })];
    const t = setUp(objects, (c) => (c.entityId === 'o3' ? rejected('LAYER_LOCKED') : c.entityId === 'o4' ? rejected('PERMISSION_DENIED') : applied));
    await t.layers.ready();
    t.mover.ask('move', ['o1', 'o2', 'o3', 'o4', 'gone']);
    await t.mover.confirm('a');

    expect(t.sent.map((s) => s.content.entityId)).toEqual(['o1', 'o3', 'o4']);
    expect(notices(t.store)).toEqual([['warning',
      'Moved 1 of 5 objects to Alpha. 4 could not be moved: gone: it no longer exists; Ship o2: not in View; Ship o3: its layer is locked; Banned: you may not change it.']]);
    expect(outcome('move', 'Alpha', 2, [{ ok: true }, { ok: false, name: 'x', reason: 'y' }]).sticky, 'it stays').toBe(true);
    expect(outcome('move', 'Alpha', 1, [{ ok: true }]).sticky, 'all went well: it goes').toBe(false);
  });

  it('names the target when a copy is refused for its lock, and runs one at a time', async () => {
    const t = setUp([object('o1', 'top')], () => rejected('LAYER_LOCKED'));
    await t.layers.ready();
    t.mover.ask('copy', ['o1']);
    const running = t.mover.confirm('a');
    t.mover.ask('move', ['o1']);
    expect(t.mover.getState().asking, 'no second question while one runs').toBeNull();
    await running;
    expect(notices(t.store).find((n) => n[0] === 'warning')).toEqual(['warning', 'Copied 0 of 1 object to Alpha. 1 could not be copied: Ship o1: Alpha is locked.']);
  });

  it('asks for the layer in a dialog with nothing chosen, and sends nothing on Cancel (A1)', async () => {
    const t = setUp([object('o1', 'top'), object('o2', 'top')]);
    render(<LayerMoveQuestion mover={t.mover} layers={t.layers} />);
    act(() => { t.mover.ask('move', ['o1', 'o2']); });
    const dialog = await screen.findByRole('dialog', { name: 'Move to layer' });
    const choice = within(dialog).getByRole('combobox', { name: 'Move 2 objects to' });
    await screen.findByRole('option', { name: 'Alpha' });
    expect(within(choice).getAllByRole('option').map((o) => o.textContent)).toEqual(['Choose a layer', 'Top', 'Alpha']);
    const go = within(dialog).getByRole('button', { name: 'Move 2 objects' });
    expect(go.hasAttribute('disabled')).toBe(true);

    fireEvent.change(choice, { target: { value: 'a' } });
    expect(go.hasAttribute('disabled')).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(t.connection.getObjects).not.toHaveBeenCalled();

    act(() => { t.mover.ask('copy', ['o1']); });
    const again = await screen.findByRole('dialog', { name: 'Copy to layer' });
    fireEvent.change(within(again).getByRole('combobox', { name: 'Copy 1 object to' }), { target: { value: 'top' } });
    await act(async () => { fireEvent.click(within(again).getByRole('button', { name: 'Copy 1 object' })); await Promise.resolve(); });
    expect(screen.queryByRole('dialog')).toBeNull();
    await vi.waitFor(() => { expect(t.sent).toHaveLength(1); });
  });
});
