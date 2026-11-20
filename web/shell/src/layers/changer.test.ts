import { changeRequests, type ChangeOutcome, type ChangeRequestContent, type Layer, type LayerPage, type MapObject, type SecurityLabel, type User, type Uuid } from '@emc2/plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inBatches, MAX_WAITING } from '../actions/batch.ts';
import { ShellStore, VIEW_INFO } from '../ui/store.ts';
import { LayerChanger } from './changer.ts';
import { compare, orderOf, withClassification, type ClassificationOrders } from './classification.ts';

const ORDERS: ClassificationOrders = { NATO: ['UNCLASSIFIED', 'RESTRICTED', 'CONFIDENTIAL', 'SECRET', 'COSMIC TOP SECRET'] };
const releasable = [{ tagName: 'Releasable to', type: 'permissive' as const, values: ['SWE'] }];
const label = (classification: string, policy = 'NATO'): SecurityLabel => ({ policyIdentifier: { name: policy }, classification, categories: releasable });

const layer: Layer = {
  id: 'L', version: 4, name: 'Blue forces', drawOrder: 1, visible: true, label: label('UNCLASSIFIED'),
  extensions: { cot: { team: 'cyan' } }, meta: { created: { at: '2026-10-17T10:00:00Z', by: { plugin: 'core' } } },
} as unknown as Layer;

const object = (id: string, labelled: SecurityLabel, name?: string): MapObject => ({
  id, version: 2, layerId: 'L', type: 'core.symbol', dataType: 'core.general', label: labelled,
  geometry: { type: 'Point', coordinates: [18.07, 59.33] }, extensions: { cot: { uid: id } },
  meta: { created: { at: '2026-10-17T10:00:00Z', by: { plugin: 'cot' } } }, ...(name === undefined ? {} : { properties: { name } }),
}) as unknown as MapObject;

const user = (permissions: readonly string[]): User => ({ id: 'u', name: 'U', permissions: new Set(permissions), noLogin: false, has: (p: string) => permissions.includes(p) });
const rejected = (code: string, message: string = code): ChangeOutcome => ({ outcome: 'rejected', rejection: { code, message } }) as unknown as ChangeOutcome;
const applied = { outcome: 'applied' } as unknown as ChangeOutcome;

/** A server holding the layer's objects; `answer` decides each request (default: applied). */
function setUp(held: MapObject[], answer?: (content: ChangeRequestContent) => ChangeOutcome | Promise<ChangeOutcome>, permissions = ['layers.edit', 'objects.edit']) {
  const store = new ShellStore();
  /** The layers as the shell knows them now (`KnownLayers.layer`). */
  const known = new Map<Uuid, Layer>([[layer.id, layer]]);
  const sent: { readonly content: ChangeRequestContent; readonly pluginId: string }[] = [];
  let waiting = 0;
  let mostWaiting = 0;
  const connection = {
    submit: vi.fn(async (content: ChangeRequestContent, pluginId: string): Promise<ChangeOutcome> => {
      sent.push({ content, pluginId });
      waiting++;
      mostWaiting = Math.max(mostWaiting, waiting);
      try {
        await Promise.resolve();
        return answer === undefined ? applied : await answer(content);
      } finally {
        waiting--;
      }
    }),
    queryLayer: vi.fn((layerId: Uuid, page: number, pageSize: number): Promise<LayerPage> => Promise.resolve({
      layerId, page, pageSize, objects: held.slice(page * pageSize, (page + 1) * pageSize), total: held.length,
    })),
  };
  const out = { warn: vi.fn(), error: vi.fn() };
  const changer = new LayerChanger({ store, user: () => user(permissions), orders: () => ORDERS, current: (id) => known.get(id) ?? null, connection, console: out, workspaces: () => [VIEW_INFO] });
  return { store, changer, connection, sent, out, known, held, mostWaiting: () => mostWaiting };
}

const notices = (store: ShellStore) => store.getView().notifications.map((n) => [n.severity, n.message]);
const objectUpdates = (sent: readonly { readonly content: ChangeRequestContent }[]) => sent.filter((s) => s.content.entityType === 'object');

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the order of classifications', () => {
  it("places a label in its own policy's order, and nowhere when the policy or the classification is not configured", () => {
    expect(orderOf(ORDERS, label('SECRET'))).toBe(ORDERS['NATO']);
    expect(orderOf(ORDERS, label('SECRET', 'SWE'))).toBeNull();
    expect(orderOf(ORDERS, label('NATO SECRET'))).toBeNull();
    expect(orderOf(ORDERS, label('constructor', 'toString'))).toBeNull(); // not an inherited property
    expect(compare(ORDERS, label('RESTRICTED'), 'NATO', 'SECRET')).toBe('lower');
    expect(compare(ORDERS, label('SECRET'), 'NATO', 'SECRET')).toBe('same-or-higher');
    expect(compare(ORDERS, label('COSMIC TOP SECRET'), 'NATO', 'SECRET')).toBe('same-or-higher');
    expect(compare(ORDERS, label('UNCLASSIFIED', 'SWE'), 'NATO', 'SECRET')).toBe('outside');
    expect(compare(ORDERS, label('SPECIAL'), 'NATO', 'SECRET')).toBe('outside');
  });

  it('changes only the classification of a label', () => {
    expect(withClassification(label('UNCLASSIFIED'), 'SECRET')).toEqual({ policyIdentifier: { name: 'NATO' }, classification: 'SECRET', categories: releasable });
  });
});

describe("Settings › Layers' change", () => {
  it('changes only the layer, as core-shell, with only the classification of its label changed', async () => {
    const t = setUp([object('a', label('UNCLASSIFIED'))]);
    t.changer.ask({ layer, to: 'SECRET', raise: false });
    expect(t.changer.getState().asking).toEqual({ layer, to: 'SECRET', raise: false });
    await t.changer.confirm();
    expect(t.sent).toEqual([{
      content: {
        entityType: 'layer', operation: 'update', entityId: 'L', baseVersion: 4,
        data: { name: 'Blue forces', drawOrder: 1, visible: true, label: label('SECRET'), extensions: { cot: { team: 'cyan' } } },
      },
      pluginId: 'core-shell',
    }]);
    expect(t.connection.queryLayer).not.toHaveBeenCalled();
    expect(notices(t.store)).toEqual([['info', 'The layer Blue forces is now SECRET.']]);
    expect(t.changer.getState()).toEqual({ asking: null, emptying: null, running: false });
  });

  it('raises the objects below it page by page, changing nothing else, and counts those left alone', async () => {
    const held: MapObject[] = [];
    for (let i = 0; i < 1_100; i++) held.push(object(`o${String(i).padStart(4, '0')}`, label(i % 2 === 0 ? 'UNCLASSIFIED' : 'RESTRICTED')));
    held.push(object('same', label('SECRET')), object('higher', label('COSMIC TOP SECRET')));
    held.push(object('swedish', label('BEGRÄNSAT HEMLIG', 'SWE')), object('odd', label('NATO SECRET')));
    const t = setUp(held);
    t.changer.ask({ layer, to: 'SECRET', raise: true });
    await t.changer.confirm();

    expect(t.connection.queryLayer.mock.calls.map((c) => c.slice(1))).toEqual([[0, 500], [1, 500], [2, 500]]);
    const updates = objectUpdates(t.sent);
    expect(updates).toHaveLength(1_100);
    const first = held[0] as MapObject;
    expect(updates[0]).toEqual({
      content: {
        entityType: 'object', operation: 'update', entityId: first.id, baseVersion: 2,
        data: {
          layerId: 'L', type: 'core.symbol', dataType: 'core.general', label: label('SECRET'),
          geometry: { type: 'Point', coordinates: [18.07, 59.33] }, extensions: { cot: { uid: first.id } },
        },
      },
      pluginId: 'core-shell',
    });
    expect(t.mostWaiting()).toBeLessThanOrEqual(MAX_WAITING);
    expect(notices(t.store)).toEqual([[
      'info',
      'The layer Blue forces is now SECRET. Raised 1,100 objects; 2 already SECRET or higher; 2 left alone (another policy, or a classification outside the order).',
    ]]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(notices(t.store)).toHaveLength(1); // it stays, so the ones left alone are seen
  });

  it('raises only the objects when the layer has that classification already', async () => {
    const t = setUp([object('a', label('UNCLASSIFIED')), object('b', label('UNCLASSIFIED'))]);
    t.changer.ask({ layer, to: 'UNCLASSIFIED', raise: true });
    await t.changer.confirm();
    expect(t.sent).toEqual([]); // nothing below UNCLASSIFIED, and the layer is UNCLASSIFIED
    const u = setUp([object('a', label('UNCLASSIFIED'))]);
    const restricted = { ...layer, label: label('RESTRICTED') };
    u.known.set(layer.id, restricted);
    u.changer.ask({ layer: restricted, to: 'RESTRICTED', raise: true });
    await u.changer.confirm();
    expect(u.sent.map((s) => s.content.entityType)).toEqual(['object']);
  });

  it('does not raise when the layer was not changed', async () => {
    const t = setUp([object('a', label('UNCLASSIFIED'))], (content) => (content.entityType === 'layer' ? rejected('PERMISSION_DENIED') : applied));
    t.changer.ask({ layer, to: 'SECRET', raise: true });
    await t.changer.confirm();
    expect(objectUpdates(t.sent)).toEqual([]);
    expect(notices(t.store)).toEqual([['error', 'The layer Blue forces was not changed: you may not change it.']]);
  });

  it('sends a request again when the queue was full, skips objects gone meanwhile, and names those that could not be raised', async () => {
    const tries = new Map<string, number>();
    const t = setUp([object('busy', label('UNCLASSIFIED')), object('gone', label('UNCLASSIFIED')), object('bad', label('UNCLASSIFIED'), 'Bravo')], (content) => {
      const id = content.entityId;
      tries.set(id, (tries.get(id) ?? 0) + 1);
      if (id === 'busy') return (tries.get(id) ?? 0) < 3 ? rejected('INTERNAL_ERROR') : applied;
      if (id === 'gone') return rejected('ENTITY_NOT_FOUND');
      if (id === 'bad') return rejected('VALIDATION_FAILED', 'the symbol is not valid');
      return applied;
    });
    t.changer.ask({ layer, to: 'SECRET', raise: true });
    const running = t.changer.confirm();
    await vi.advanceTimersByTimeAsync(3_000);
    await running;
    expect(tries.get('busy')).toBe(3);
    expect(notices(t.store)).toEqual([[
      'warning', 'The layer Blue forces is now SECRET. Raised 1 object. 1 could not be raised: Bravo: the symbol is not valid.',
    ]]);
  });

  it('asks for a page again when the server was busy, and says how far it got and how to go on when it cannot', async () => {
    const busy = setUp([object('a', label('UNCLASSIFIED'))]);
    busy.connection.queryLayer.mockRejectedValueOnce(new Error('busy')).mockRejectedValueOnce(new Error('busy'));
    busy.changer.ask({ layer, to: 'SECRET', raise: true });
    const running = busy.changer.confirm();
    await vi.advanceTimersByTimeAsync(2_000);
    await running;
    expect(notices(busy.store)).toEqual([['info', 'The layer Blue forces is now SECRET. Raised 1 object.']]);

    const t = setUp([object('a', label('UNCLASSIFIED'))]);
    t.connection.queryLayer.mockRejectedValue(new Error('no answer from the server within 15 s'));
    t.changer.ask({ layer, to: 'SECRET', raise: true });
    const stopping = t.changer.confirm();
    await vi.advanceTimersByTimeAsync(2_000);
    await stopping;
    expect(t.connection.queryLayer).toHaveBeenCalledTimes(3);
    expect(notices(t.store)).toEqual([[
      'error', 'The layer Blue forces is now SECRET, but raising its objects stopped: no answer from the server within 15 s. Raised 0 objects before that.'
        + ' To go on, choose SECRET again with "Also raise objects below it".',
    ]]);
    expect(t.out.error).toHaveBeenCalledOnce();
    expect(t.changer.getState().running).toBe(false);
  });

  it('sends nothing when the layer changed while the question was open (review F1)', async () => {
    const t = setUp([object('a', label('UNCLASSIFIED'))]);
    t.changer.ask({ layer, to: 'SECRET', raise: true });
    t.known.set(layer.id, { ...layer, version: 5, name: 'Blue forces (north)' }); // renamed meanwhile
    await t.changer.confirm();
    expect(t.sent).toEqual([]);
    expect(t.changer.getState()).toEqual({ asking: null, emptying: null, running: false });
    expect(notices(t.store)).toEqual([['info', 'The layer Blue forces changed meanwhile, so nothing was changed. Check it and apply again.']]);
    t.known.delete(layer.id); // deleted meanwhile
    t.changer.ask({ layer, to: 'SECRET', raise: false });
    await t.changer.confirm();
    expect(t.sent).toEqual([]);
  });

  it('reads pages until one is not full: an empty layer, exactly one page, exactly two (review F11)', async () => {
    for (const [n, pages] of [[0, [0]], [500, [0, 1]], [1_000, [0, 1, 2]]] as const) {
      const t = setUp(Array.from({ length: n }, (_, i) => object(`o${String(i)}`, label('UNCLASSIFIED'))));
      t.changer.ask({ layer, to: 'SECRET', raise: true });
      await t.changer.confirm();
      expect(t.connection.queryLayer.mock.calls.map((c) => c[1]), `${String(n)} objects`).toEqual(pages);
      expect(objectUpdates(t.sent)).toHaveLength(n);
    }
  });

  it("says to run it again when the layer's objects changed while it ran (review F7)", async () => {
    const held = Array.from({ length: 600 }, (_, i) => object(`o${String(i)}`, label('UNCLASSIFIED')));
    const t = setUp(held);
    const first = t.connection.queryLayer.getMockImplementation();
    t.connection.queryLayer.mockImplementation((layerId: Uuid, page: number, pageSize: number) => {
      if (page === 1) held.splice(0, 50); // deleted by someone else after the first page
      return first === undefined ? Promise.reject(new Error('no fake')) : first(layerId, page, pageSize);
    });
    t.changer.ask({ layer, to: 'SECRET', raise: true });
    await t.changer.confirm();
    expect(notices(t.store)[0]?.[1]).toBe(
      "The layer Blue forces is now SECRET. Raised 550 objects. The layer's objects changed while it ran; run it again to be sure none was missed.",
    );
  });

  it('runs one change at a time, and offers what the user may do', async () => {
    const t = setUp([], () => new Promise(() => undefined));
    t.changer.ask({ layer, to: 'SECRET', raise: false });
    void t.changer.confirm();
    await vi.advanceTimersByTimeAsync(0);
    t.changer.ask({ layer, to: 'RESTRICTED', raise: false });
    expect(t.changer.getState().asking).toBeNull();
    expect(notices(t.store).at(-1)).toEqual(['info', 'A layer change is still running; try again when it has finished.']);

    expect([t.changer.mayChangeLayers, t.changer.mayRaise]).toEqual([true, true]);
    const viewer = setUp([], undefined, ['objects.edit']);
    expect([viewer.changer.mayChangeLayers, viewer.changer.mayRaise]).toEqual([false, true]);
    expect(viewer.changer.choicesFor(layer)).toBe(ORDERS['NATO']);
    expect(viewer.changer.choicesFor({ ...layer, label: label('HEMLIG', 'SWE') })).toBeNull();
  });
});

describe('emptying a layer (T-175)', () => {
  const deletes = (sent: readonly { readonly content: ChangeRequestContent; readonly pluginId: string }[]) =>
    sent.filter((s) => s.content.operation === 'delete');

  it('reads all its pages, then deletes every object as core-shell in the shared batches', async () => {
    const held = Array.from({ length: 1_100 }, (_, i) => object(`o${String(i).padStart(4, '0')}`, label('UNCLASSIFIED')));
    const t = setUp(held, undefined, ['objects.edit']);
    t.changer.askEmpty(layer);
    expect(t.changer.getState().emptying).toBe(layer);
    await t.changer.confirmEmpty();

    expect(t.connection.queryLayer.mock.calls.map((c) => c.slice(1))).toEqual([[0, 500], [1, 500], [2, 500]]);
    expect(deletes(t.sent)).toHaveLength(1_100);
    expect(t.sent).toHaveLength(1_100); // the layer itself is not changed
    expect(t.sent[0]).toEqual({ content: changeRequests.deleteObject(held[0] as MapObject), pluginId: 'core-shell' });
    expect(new Set(t.sent.map((s) => s.content.entityId)).size).toBe(1_100);
    expect(t.mostWaiting()).toBeLessThanOrEqual(MAX_WAITING);
    expect(notices(t.store)).toEqual([['info', 'Deleted 1,100 objects in Blue forces.']]);
    expect(t.changer.getState()).toEqual({ asking: null, emptying: null, running: false });
  });

  it('counts an object gone already as deleted, and names those the server refused, with why', async () => {
    const held = [object('a', label('UNCLASSIFIED'), 'Alpha'), object('b', label('UNCLASSIFIED'), 'Bravo'), object('c', label('UNCLASSIFIED'))];
    const t = setUp(held, (content) => {
      if (content.entityId === 'a') return rejected('ENTITY_NOT_FOUND');
      if (content.entityId === 'b') return rejected('PERMISSION_DENIED');
      return rejected('LAYER_LOCKED');
    });
    t.changer.askEmpty(layer);
    await t.changer.confirmEmpty();
    expect(notices(t.store)).toEqual([[
      'warning', 'Deleted 1 of 3 objects in Blue forces. 2 could not be deleted: Bravo: you may not change it; c: its layer is locked.',
    ]]);
  });

  it('sends nothing when the layer was locked or deleted while the question was open', async () => {
    const t = setUp([object('a', label('UNCLASSIFIED'))]);
    t.changer.askEmpty(layer);
    t.known.set(layer.id, { ...layer, version: 5, locked: true });
    await t.changer.confirmEmpty();
    t.changer.askEmpty(layer);
    t.known.delete(layer.id);
    await t.changer.confirmEmpty();
    expect(t.sent).toEqual([]);
    expect(t.connection.queryLayer).not.toHaveBeenCalled();
    expect(notices(t.store)).toEqual([
      ['info', 'The layer Blue forces is locked now, so nothing was deleted.'],
      ['info', 'The layer Blue forces is gone, so nothing was deleted.'],
    ]);
  });

  it('says so when the layer had no objects, when its objects changed meanwhile, and when reading stopped', async () => {
    const empty = setUp([]);
    empty.changer.askEmpty(layer);
    await empty.changer.confirmEmpty();
    expect(notices(empty.store)).toEqual([['info', 'The layer Blue forces had no objects.']]);

    const held = Array.from({ length: 600 }, (_, i) => object(`o${String(i).padStart(4, '0')}`, label('UNCLASSIFIED')));
    const moving = setUp(held);
    moving.connection.queryLayer.mockImplementation((layerId: Uuid, page: number, pageSize: number) => Promise.resolve({
      layerId, page, pageSize, objects: held.slice(page * pageSize, (page + 1) * pageSize), total: held.length + page, // one more each page
    }));
    moving.changer.askEmpty(layer);
    await moving.changer.confirmEmpty();
    expect(notices(moving.store)).toEqual([['info', "Deleted 600 objects in Blue forces. The layer's objects changed while it ran, so some may be left."]]);

    const stopped = setUp(held);
    stopped.connection.queryLayer.mockImplementation(() => Promise.reject(new Error('the server did not answer')));
    stopped.changer.askEmpty(layer);
    const done = stopped.changer.confirmEmpty();
    await vi.advanceTimersByTimeAsync(5_000); // the retries
    await done;
    expect(stopped.sent).toEqual([]);
    expect(notices(stopped.store)).toEqual([['error', 'Deleting all objects in Blue forces stopped: the server did not answer. Deleted 0 objects before that.']]);
    expect(stopped.out.error).toHaveBeenCalledOnce();
  });

  it("runs one at a time with the layer changes, and needs the shared Delete's right", async () => {
    let answer: (outcome: ChangeOutcome) => void = () => undefined;
    const t = setUp([object('a', label('UNCLASSIFIED'))], () => new Promise((resolve) => { answer = resolve; }));
    t.changer.askEmpty(layer);
    t.changer.ask({ layer, to: 'SECRET', raise: false }); // a question is open already
    expect(t.changer.getState().asking).toBeNull();
    const running = t.changer.confirmEmpty();
    await vi.advanceTimersByTimeAsync(0);
    t.changer.askEmpty(layer);
    expect(t.changer.getState().emptying).toBeNull();
    expect(notices(t.store).at(-1)).toEqual(['info', 'A layer change is still running; try again when it has finished.']);
    answer(applied); // frees its place in the shared batches
    await running;
    expect(t.changer.getState().running).toBe(false);

    expect(setUp([], undefined, ['objects.edit']).changer.mayEmptyIn(VIEW_INFO.id)).toBe(true);
    expect(setUp([], undefined, ['layers.edit']).changer.mayEmptyIn(VIEW_INFO.id)).toBe(false);
  });

  it('reads one page of the list, asked again when the server was busy', async () => {
    const t = setUp(Array.from({ length: 120 }, (_, i) => object(`o${String(i)}`, label('UNCLASSIFIED'))));
    t.connection.queryLayer.mockRejectedValueOnce(new Error('busy'));
    const read = t.changer.readPage('L', 2, 50);
    await vi.advanceTimersByTimeAsync(2_000);
    expect((await read).objects.map((o) => o.id)).toEqual(Array.from({ length: 20 }, (_, i) => `o${String(100 + i)}`));
    expect(t.connection.queryLayer.mock.calls.map((c) => c.slice(1))).toEqual([[2, 50], [2, 50]]);
  });
});

describe("the shell's batches", () => {
  it(`keep at most ${String(MAX_WAITING)} waiting over all of them together: a Delete and a raise at once share it (review F3)`, async () => {
    let waiting = 0;
    let most = 0;
    const task = async () => {
      waiting++;
      most = Math.max(most, waiting);
      await new Promise<void>((resolve) => { setTimeout(resolve, 10); });
      waiting--;
    };
    const both = Promise.all([inBatches(Array.from({ length: 80 }, (_, i) => i), task), inBatches(Array.from({ length: 80 }, (_, i) => i), task)]);
    await vi.advanceTimersByTimeAsync(1_000);
    await both;
    expect(most).toBe(MAX_WAITING);
  });
});
