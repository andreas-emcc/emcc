import {
  OutcomeUnknownError, type ChangeOutcome, type ChangeRequestContent, type FetchResult, type MapObject, type RejectionCode, type User, type Uuid,
} from '@emc2/plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShellStore, VIEW_INFO } from '../ui/store.ts';
import { Deleter, MAX_WAITING } from './deletion.ts';
import { isTextField, listenForDeleteKey } from './deleteKey.ts';
import type { ActionMenu } from './menu.ts';

const object = (id: string, name?: string): MapObject =>
  ({ id, version: 3, layerId: 'L', type: 'core.symbol', dataType: 'core.general', ...(name === undefined ? {} : { properties: { name } }) }) as MapObject;

const user = (edit: boolean): User => ({ id: 'u', name: 'U', permissions: new Set(), noLogin: false, has: (p: string) => edit && p === 'objects.edit' });

const rejected = (code: RejectionCode, message: string = code): ChangeOutcome =>
  ({ outcome: 'rejected', rejection: { code, message } }) as unknown as ChangeOutcome;
const applied = { outcome: 'applied' } as unknown as ChangeOutcome;

/** A server holding `objects`; `answer` decides each delete's outcome (default: applied, and the object is gone). */
function setUp(objects: readonly MapObject[], answer?: (id: Uuid, attempt: number) => ChangeOutcome | Error | Promise<ChangeOutcome>, edit = true) {
  const store = new ShellStore();
  const held = new Map(objects.map((o) => [o.id, o]));
  const attempts = new Map<Uuid, number>();
  let waiting = 0;
  let mostWaiting = 0;
  const sent: { readonly content: ChangeRequestContent; readonly pluginId: string }[] = [];
  const connection = {
    getObjects: vi.fn((ids: readonly Uuid[]): Promise<FetchResult> => Promise.resolve({
      found: ids.flatMap((id) => held.get(id) ?? []), missing: ids.filter((id) => !held.has(id)),
    })),
    submit: vi.fn(async (content: ChangeRequestContent, pluginId: string): Promise<ChangeOutcome> => {
      sent.push({ content, pluginId });
      const id = content.entityId;
      const attempt = (attempts.get(id) ?? 0) + 1;
      attempts.set(id, attempt);
      waiting++;
      mostWaiting = Math.max(mostWaiting, waiting);
      try {
        await Promise.resolve();
        const outcome = answer === undefined ? applied : await answer(id, attempt);
        if (outcome instanceof Error) throw outcome;
        if (outcome.outcome === 'applied') held.delete(id);
        return outcome;
      } finally {
        waiting--;
      }
    }),
  };
  const deleter = new Deleter({ store, user: () => user(edit), connection, workspace: () => VIEW_INFO, console: { warn: vi.fn(), error: vi.fn() } });
  return { store, deleter, connection, sent, held, mostWaiting: () => mostWaiting };
}

const notices = (store: ShellStore) => store.getView().notifications.map((n) => [n.severity, n.message]);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the shared Delete', () => {
  it('asks first, and on yes deletes each object with its own change request as core-shell', async () => {
    const t = setUp([object('a'), object('b')]);
    t.deleter.ask(['a', 'b']);
    expect(t.deleter.getState()).toEqual({ asking: ['a', 'b'], workspace: { id: 'core.view', name: 'View', order: -2147483648 }, running: false });
    expect(t.connection.submit).not.toHaveBeenCalled();

    await t.deleter.confirm();
    expect(t.sent).toEqual([
      { content: { entityType: 'object', operation: 'delete', entityId: 'a', baseVersion: 3 }, pluginId: 'core-shell' },
      { content: { entityType: 'object', operation: 'delete', entityId: 'b', baseVersion: 3 }, pluginId: 'core-shell' },
    ]);
    expect(t.deleter.getState()).toEqual({ asking: null, workspace: null, running: false });
    expect(notices(t.store)).toEqual([['info', 'Deleted 2 objects.']]);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(notices(t.store)).toEqual([]); // info goes away when all went well
  });

  it('No is no', () => {
    const t = setUp([object('a')]);
    t.deleter.ask(['a']);
    t.deleter.cancel();
    expect(t.deleter.getState().asking).toBeNull();
    expect(t.connection.getObjects).not.toHaveBeenCalled();
  });

  it(`keeps at most ${String(MAX_WAITING)} waiting, and counts up while it runs`, async () => {
    const ids = Array.from({ length: 1000 }, (_, i) => `o${String(i).padStart(4, '0')}`);
    const t = setUp(ids.map((id) => object(id)), () => new Promise((resolve) => { setTimeout(() => { resolve(applied); }, 10); }));
    t.deleter.ask(ids);
    const running = t.deleter.confirm();
    await vi.advanceTimersByTimeAsync(15);
    expect(t.deleter.getState().running).toBe(true);
    expect(notices(t.store)).toEqual([['info', 'Deleting objects: 50 of 1,000']]);
    await vi.advanceTimersByTimeAsync(1_000);
    await running;
    expect(t.mostWaiting()).toBe(MAX_WAITING);
    expect(t.held.size).toBe(0);
    expect(notices(t.store)).toEqual([['info', 'Deleted 1,000 objects.']]);
  });

  it('counts an object already gone as deleted, sends a request again when the queue was full, and says which could not be deleted and why', async () => {
    const t = setUp([object('a', 'Alpha'), object('b'), object('c'), object('d', 'Delta'), object('e')], (id, attempt) => {
      if (id === 'b') return rejected('ENTITY_NOT_FOUND', 'no object with id b');
      if (id === 'c') return attempt < 3 ? rejected('INTERNAL_ERROR', 'send it again later') : applied;
      if (id === 'd') return rejected('PERMISSION_DENIED', 'objects.edit');
      if (id === 'e') return new OutcomeUnknownError('no answer from the server within 10 s');
      return applied;
    });
    t.deleter.ask(['a', 'b', 'c', 'd', 'e', 'gone']);
    const running = t.deleter.confirm();
    await vi.advanceTimersByTimeAsync(3_000);
    await running;
    expect(t.sent.filter((s) => s.content.entityId === 'c')).toHaveLength(3);
    expect(notices(t.store)).toEqual([[
      'warning',
      'Deleted 4 of 6 objects. 2 could not be deleted: Delta: you may not change it; e: no answer from the server (it may have been deleted): no answer from the server within 10 s.',
    ]]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(notices(t.store)).toHaveLength(1); // it stays when any failed
  });

  it('names the objects in a locked layer as refused, "its layer is locked" (ADR-0042, T-098)', async () => {
    const t = setUp([object('a', 'Alpha'), object('b', 'Bravo')], (id) =>
      id === 'b' ? rejected('LAYER_LOCKED', 'the layer Reference is locked (ADR-0042)') : applied);
    t.deleter.ask(['a', 'b']);
    await t.deleter.confirm();
    expect(t.sent).toHaveLength(2); // the server decides: the shell sends each one
    expect(notices(t.store)).toEqual([['warning', 'Deleted 1 of 2 objects. 1 could not be deleted: Bravo: its layer is locked.']]);
  });

  it('names at most five that failed, and counts the rest', async () => {
    const ids = Array.from({ length: 8 }, (_, i) => `x${String(i)}`);
    const t = setUp(ids.map((id) => object(id)), () => rejected('VALIDATION_FAILED', 'no'));
    t.deleter.ask(ids);
    await t.deleter.confirm();
    expect(notices(t.store)[0]?.[1]).toBe('Deleted 0 of 8 objects. 8 could not be deleted: x0: no; x1: no; x2: no; x3: no; x4: no; and 3 more.');
  });

  it('runs one at a time: asking again while one runs says so', async () => {
    const t = setUp([object('a')], () => new Promise(() => undefined));
    t.deleter.ask(['a']);
    void t.deleter.confirm();
    await vi.advanceTimersByTimeAsync(0);
    t.deleter.ask(['a']);
    expect(t.deleter.getState().asking).toBeNull();
    expect(notices(t.store).at(-1)).toEqual(['info', 'A delete is still running; try again when it has finished.']);
  });

  it('says so when the objects cannot be read', async () => {
    const t = setUp([object('a')]);
    t.connection.getObjects.mockRejectedValueOnce(new Error('not connected to the server'));
    t.deleter.ask(['a']);
    await t.deleter.confirm();
    expect(notices(t.store)).toEqual([['error', 'The delete stopped: not connected to the server. Deleted 0 of 1 object before that.']]);
    expect(t.deleter.getState().running).toBe(false);
  });

  it('is the shell\'s object action for any object and several, in the delete group, for objects.edit', () => {
    const t = setUp([]);
    const action = t.deleter.action();
    expect({ ...action, run: undefined, icon: undefined }).toEqual({
      id: 'delete', label: 'Delete', group: 'delete', appliesTo: {}, multiple: true, permission: 'objects.edit', workspaces: ['core.view'],
      run: undefined, icon: undefined,
    });
    void action.run(['a']);
    expect(t.deleter.getState().asking).toEqual(['a']);
  });
});

describe('the Delete key', () => {
  function listen(fields: { edit?: boolean; mac?: boolean; inView?: boolean; menuOpen?: boolean; selection?: readonly Uuid[] } = {}) {
    const t = setUp([object('a')], undefined, fields.edit ?? true);
    const mapView = { selection: { value: fields.selection ?? ['a'] } };
    const stop = listenForDeleteKey({
      deleter: t.deleter, menu: { isOpen: fields.menuOpen ?? false } as ActionMenu, mapView: () => Promise.resolve(mapView as never),
      inView: () => fields.inView ?? true, mac: fields.mac ?? false,
    });
    return { ...t, stop };
  }
  const press = async (key: string, target: EventTarget = document.body, init: KeyboardEventInit = {}) => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
    await vi.advanceTimersByTimeAsync(0);
  };

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it("asks to delete the map's selection", async () => {
    const t = listen();
    await press('Delete');
    expect(t.deleter.getState().asking).toEqual(['a']);
    t.stop();
  });

  it('on a Mac Backspace does too; elsewhere it does not', async () => {
    const mac = listen({ mac: true });
    await press('Backspace');
    expect(mac.deleter.getState().asking).toEqual(['a']);
    mac.stop();
    const pc = listen({ mac: false });
    await press('Backspace');
    expect(pc.deleter.getState().asking).toBeNull();
    pc.stop();
  });

  it('does nothing in a text field, with a modifier, outside the View tab, with a menu or dialog open, without the permission or an empty selection', async () => {
    const field = document.body.appendChild(document.createElement('input'));
    const cases: [string, ReturnType<typeof listen>, () => Promise<void>][] = [
      ['text field', listen(), () => press('Delete', field)],
      ['Ctrl', listen(), () => press('Delete', document.body, { ctrlKey: true })],
      ['repeat', listen(), () => press('Delete', document.body, { repeat: true })],
      ['not View', listen({ inView: false }), () => press('Delete')],
      ['menu', listen({ menuOpen: true }), () => press('Delete')],
      ['no permission', listen({ edit: false }), () => press('Delete')],
      ['empty selection', listen({ selection: [] }), () => press('Delete')],
    ];
    for (const [what, t, act] of cases) {
      await act();
      expect(t.deleter.getState().asking, what).toBeNull();
      t.stop();
    }
    const dialog = document.body.appendChild(document.createElement('div'));
    dialog.setAttribute('role', 'dialog');
    const t = listen();
    await press('Delete');
    expect(t.deleter.getState().asking, 'dialog').toBeNull();
    t.stop();
  });

  it('leaves a key that a listener on the document took: a Mac\'s Backspace while drawing removes the last point only (review F3)', async () => {
    const drawing = (event: KeyboardEvent) => { if (event.key === 'Backspace') event.preventDefault(); };
    const t = listen({ mac: true }); // the shell listens from its start, map-view-2d later
    document.addEventListener('keydown', drawing);
    await press('Backspace');
    expect(t.deleter.getState().asking).toBeNull();
    t.stop();
    document.removeEventListener('keydown', drawing);
  });

  it("is ahead of a plugin's own Delete on the document, so one that leaves a taken key alone steps back", async () => {
    const t = listen();
    let pluginSawFree = false;
    const plugin = (event: KeyboardEvent) => { if (event.key === 'Delete' && !event.defaultPrevented) pluginSawFree = true; };
    document.addEventListener('keydown', plugin); // a plugin starts after the shell
    await press('Delete');
    expect(t.deleter.getState().asking).toEqual(['a']);
    expect(pluginSawFree).toBe(false);
    t.stop();
    document.removeEventListener('keydown', plugin);
  });

  it('knows a text field from other controls', () => {
    const input = (type: string) => Object.assign(document.createElement('input'), { type });
    expect(isTextField(input('text'))).toBe(true);
    expect(isTextField(input('search'))).toBe(true);
    expect(isTextField(input('checkbox'))).toBe(false);
    expect(isTextField(document.createElement('textarea'))).toBe(true);
    expect(isTextField(document.createElement('select'))).toBe(true);
    expect(isTextField(document.createElement('button'))).toBe(false);
    expect(isTextField(null)).toBe(false);
  });
});

describe('the shared Delete per workspace (ADR-0039 point 7; T-080)', () => {
  const VIEW_INFO = { id: 'core.view', name: 'View', order: -2147483648 };
  const SIM = { id: 'simulator.simulation', name: 'Simulation', viewPermission: 'plugin.simulator.view', editPermission: 'plugin.simulator.edit', order: 10 };
  const inLayer = (id: string, layerId: string): MapObject => ({ ...object(id, id.toUpperCase()), layerId });

  function setUpIn(shown: { current: typeof VIEW_INFO | typeof SIM }, permissions: readonly string[]) {
    const store = new ShellStore();
    const held = new Map([inLayer('v', 'view-layer'), inLayer('s', 'sim-layer')].map((o) => [o.id, o]));
    const sent: string[] = [];
    const connection = {
      getObjects: vi.fn((ids: readonly Uuid[]): Promise<FetchResult> => Promise.resolve({
        found: ids.flatMap((id) => held.get(id) ?? []), missing: ids.filter((id) => !held.has(id)),
      })),
      submit: vi.fn((content: ChangeRequestContent): Promise<ChangeOutcome> => { sent.push(content.entityId); return Promise.resolve(applied); }),
    };
    const has = (p: string) => permissions.includes(p);
    const deleter = new Deleter({
      store, user: () => ({ id: 'u', name: 'U', permissions: new Set(permissions), noLogin: false, has }), connection,
      workspace: () => shown.current, layerWorkspace: (id) => (id === 'sim-layer' ? SIM.id : id === 'view-layer' ? 'core.view' : null),
      layersReady: () => Promise.resolve(), console: { warn: vi.fn(), error: vi.fn() },
    });
    return { store, deleter, sent };
  }

  it('is one action per workspace, appearing only there, with its edit permission', () => {
    const { deleter } = setUpIn({ current: VIEW_INFO }, []);

    const sim = deleter.action(SIM);

    expect({ id: sim.id, permission: sim.permission, workspaces: sim.workspaces })
      .toEqual({ id: 'delete-simulator.simulation', permission: 'plugin.simulator.edit', workspaces: ['simulator.simulation'] });
  });

  it('is allowed by the edit permission of the workspace shown', () => {
    const shown: { current: typeof VIEW_INFO | typeof SIM } = { current: VIEW_INFO };
    const { deleter } = setUpIn(shown, ['plugin.simulator.edit']);

    expect(deleter.allowed).toBe(false);
    shown.current = SIM;
    expect(deleter.allowed).toBe(true);
  });

  it('deletes only objects in a layer of the workspace it was asked in, and names the others', async () => {
    const shown: { current: typeof VIEW_INFO | typeof SIM } = { current: SIM };
    const t = setUpIn(shown, ['plugin.simulator.edit']);

    t.deleter.ask(['s', 'v']);
    shown.current = VIEW_INFO; // a switch between the question and the yes: the question's workspace counts
    await t.deleter.confirm();

    expect(t.sent).toEqual(['s']);
    expect(t.store.getView().notifications.map((n) => n.message)).toEqual(['Deleted 1 of 2 objects. 1 could not be deleted: V: not in Simulation.']);
  });

  it('in View too: an object of another workspace in the selection is not deleted', async () => {
    const t = setUpIn({ current: VIEW_INFO }, ['objects.edit']);

    t.deleter.ask(['v', 's']);
    await t.deleter.confirm();

    expect(t.sent).toEqual(['v']);
    expect(t.store.getView().notifications.at(-1)?.message).toContain('S: not in View');
  });
});
