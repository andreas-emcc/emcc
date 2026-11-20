import { UserDocumentError, type JsonValue, type SetupShare } from '@emc2/plugin-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { memoryDocuments } from '../testing/fakes.ts';
import { DEFAULT_LAYOUT, setPaneCollapsed, setPaneSize, type Layout } from '../ui/layout.ts';
import { ShellStore } from '../ui/store.ts';
import { DEFAULT_CHOICE } from '../ui/theme.ts';
import { CURRENT, currentName, FINISH_MS, KEEPALIVE_BYTES, MAX_NAMED, NAMED_PREFIX, namedPrefix, SETUP_VERSION, Setups } from './setups.ts';

/** A layout the user changed: the left pane wider, the bottom pane collapsed, a panel moved. */
const USER_LAYOUT: Layout = {
  ...setPaneCollapsed(setPaneSize(DEFAULT_LAYOUT, 'left', 400, { width: 1600, height: 900, shown: { left: true, right: true, bottom: true } }), 'bottom', true),
  placed: { 'layer-panel/layers': 'right' },
  sequence: { left: [], right: ['layer-panel/layers'], bottom: [] },
};

const setupDocument = (fields: { layout?: Layout; clock?: string; plugins?: Record<string, JsonValue>; name?: string; version?: number } = {}): JsonValue => ({
  version: fields.version ?? SETUP_VERSION,
  shell: { layout: fields.layout ?? USER_LAYOUT, clock: fields.clock ?? 'local' } as unknown as JsonValue,
  plugins: fields.plugins ?? {},
  ...(fields.name === undefined ? {} : { name: fields.name, saved: '2026-10-16T10:00:00.000Z' }),
});

/** A plugin's share: its state is what `save` gives; `restored` records what it was given. */
function pluginShare(state: JsonValue) {
  const plugin = { state, restored: [] as JsonValue[] };
  const share: SetupShare = {
    save: () => plugin.state,
    restore: (value) => { plugin.restored.push(value); plugin.state = value; },
  };
  return { plugin, share };
}

function setUp(initial: Record<string, JsonValue> = {}) {
  const store = new ShellStore();
  const docs = memoryDocuments(initial);
  const closing = memoryDocuments();
  const out = { warn: vi.fn(), error: vi.fn() };
  const setups = new Setups({ store, documents: docs.documents, closingDocuments: closing.documents, console: out, now: () => new Date('2026-10-16T12:00:00Z') });
  /** The remembered setup as stored. */
  const current = () => docs.stored.get(CURRENT) as { shell: { layout: Layout; clock: string }; plugins: Record<string, JsonValue> } | undefined;
  return { store, docs, closing, out, setups, current };
}

const puts = (calls: readonly string[]) => calls.filter((c) => c.startsWith('put '));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the remembered setup', () => {
  it("is restored at start: the shell's share at once, a plugin's share once the plugin has started", async () => {
    const t = setUp({ [CURRENT]: setupDocument({ plugins: { 'map-view-2d': { zoom: 5 }, early: { on: true } } }) });
    const map = pluginShare({ zoom: 3 });
    const early = pluginShare({ on: false });
    t.setups.register('map-view-2d', map.share);
    t.setups.register('early', early.share);
    t.setups.pluginActive('early'); // started before the setup was read

    await t.setups.start();

    expect(t.store.getView().layout).toEqual(USER_LAYOUT);
    expect(t.store.getView().clock).toBe('local');
    expect(early.plugin.restored).toEqual([{ on: true }]);
    expect(map.plugin.restored).toEqual([]); // still starting
    t.setups.pluginActive('map-view-2d');
    expect(map.plugin.restored).toEqual([{ zoom: 5 }]);
    t.setups.pluginActive('map-view-2d');
    expect(map.plugin.restored).toEqual([{ zoom: 5 }]); // once
  });

  it('is saved as the user works, at most once a second, with the shares of plugins that do not run in this session', async () => {
    const t = setUp({ [CURRENT]: setupDocument({ plugins: { 'map-view-2d': { zoom: 5 }, disabled: { kept: 1 } } }) });
    const map = pluginShare({ zoom: 3 });
    t.setups.register('map-view-2d', map.share);
    await t.setups.start();
    t.setups.pluginActive('map-view-2d');
    t.docs.calls.length = 0;

    map.plugin.state = { zoom: 6 };
    t.setups.changed();
    t.store.setClock('utc');
    t.setups.changed();
    await vi.advanceTimersByTimeAsync(999);
    expect(puts(t.docs.calls)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(puts(t.docs.calls)).toEqual([`put ${CURRENT}`]);
    expect(t.current()?.shell.clock).toBe('utc');
    expect(t.current()?.plugins).toEqual({ 'map-view-2d': { zoom: 6 }, disabled: { kept: 1 } });

    // Nothing changed since: nothing is written.
    t.setups.changed();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(puts(t.docs.calls)).toHaveLength(1);

    // The shell's own share follows the store.
    t.store.setPaneCollapsed('left', true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(puts(t.docs.calls)).toHaveLength(2);
    expect(t.current()?.shell.layout.panes.left.collapsed).toBe(true);
  });

  it("never saves a plugin's defaults in place of its remembered share before it got it", async () => {
    const t = setUp({ [CURRENT]: setupDocument({ plugins: { 'map-view-2d': { zoom: 5 } } }) });
    const map = pluginShare({ zoom: 0 });
    t.setups.register('map-view-2d', map.share); // registered in activate, which has not finished
    await t.setups.start();
    t.store.setClock('utc');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.current()?.plugins).toEqual({ 'map-view-2d': { zoom: 5 } });
  });

  it('starts from the default setup when there is none, and remembers it from then on', async () => {
    const t = setUp();
    await t.setups.start();
    expect(t.docs.calls).toEqual(['list']); // no read of a setup that is not there: its 404 would be a console error
    expect(t.store.getView().layout).toBe(DEFAULT_LAYOUT);
    t.store.setClock('local');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.current()).toEqual({ version: SETUP_VERSION, shell: { layout: DEFAULT_LAYOUT, clock: 'local', look: DEFAULT_CHOICE }, plugins: {} });
  });

  it("remembers the user's look with the setup, and brings it back (ADR-0034)", async () => {
    const t = setUp();
    await t.setups.start();
    t.store.setLook({ look: 'signal', scheme: 'dark', density: 'comfortable' });
    await vi.advanceTimersByTimeAsync(1_000);
    expect((t.current()?.shell as unknown as { look: unknown }).look).toEqual({ look: 'signal', scheme: 'dark', density: 'comfortable' });

    const again = setUp({ [CURRENT]: t.docs.stored.get(CURRENT) as JsonValue });
    await again.setups.start();
    expect(again.store.getView().look).toEqual({ look: 'signal', scheme: 'dark', density: 'comfortable' });
    const older = setUp({ [CURRENT]: { version: SETUP_VERSION, shell: { layout: DEFAULT_LAYOUT as unknown as JsonValue, clock: 'utc' }, plugins: {} } });
    await older.setups.start();
    expect(older.store.getView().look).toEqual(DEFAULT_CHOICE); // a setup from before the looks keeps the defaults
  });

  it('remembers nothing in a session whose remembered setup could not be read, and the status says so', async () => {
    const t = setUp({ [CURRENT]: setupDocument() });
    t.docs.fail(new UserDocumentError('unavailable', 'no answer from the server'));
    await t.setups.start();
    t.docs.fail(null);

    expect(t.store.getView().setupProblem).toBe('not remembered in this session: it could not be read from the server (no answer from the server)');
    expect(t.store.getView().notifications.map((n) => n.severity)).toEqual(['warning']);
    t.store.setClock('local');
    t.setups.changed();
    t.setups.flush();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(puts(t.docs.calls)).toEqual([]);
    expect(t.closing.calls).toEqual([]);
    expect(t.current()).toEqual(setupDocument()); // the good one stays
  });

  it('leaves a setup of a newer version alone, and one that is damaged is replaced', async () => {
    const newer = setUp({ [CURRENT]: setupDocument({ version: SETUP_VERSION + 1 }) });
    await newer.setups.start();
    expect(newer.store.getView().setupProblem).toMatch(/newer version of emcc/); // the product name users see (T-134)
    newer.store.setClock('local');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(puts(newer.docs.calls)).toEqual([]);

    const damaged = setUp({ [CURRENT]: 'not a setup' });
    await damaged.setups.start();
    expect(damaged.store.getView().setupProblem).toBeNull();
    expect(damaged.out.warn).toHaveBeenCalledWith('[core-shell] the remembered setup cannot be read; starting from the default one');
    damaged.store.setClock('local');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(damaged.current()?.shell.clock).toBe('local');
  });

  it("keeps the parts it can read: a layout it cannot read leaves the layout as it is, the rest applies", async () => {
    const t = setUp({ [CURRENT]: { version: 1, shell: { layout: { panes: 'wide' }, clock: 'local' }, plugins: { a: 1 } } });
    const a = pluginShare(0);
    t.setups.register('a', a.share);
    t.setups.pluginActive('a');
    await t.setups.start();
    expect(t.store.getView().layout).toBe(DEFAULT_LAYOUT);
    expect(t.store.getView().clock).toBe('local');
    expect(a.plugin.restored).toEqual([1]);
  });

  it("a plugin's share that fails, is no JSON or is too large is not saved, the last one is kept, and its status says so", async () => {
    const t = setUp({ [CURRENT]: setupDocument({ plugins: { failing: 'old', cyclic: 'old', large: 'old' } }) });
    const throwing: SetupShare = { save: () => { throw new Error('no state'); }, restore: () => { throw new Error('cannot apply'); } };
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    t.setups.register('failing', throwing);
    t.setups.register('cyclic', { save: () => cycle as JsonValue, restore: () => undefined });
    t.setups.register('large', { save: () => 'x'.repeat(64 * 1024), restore: () => undefined });
    const observe = vi.spyOn(t.store, 'observe');
    const note = vi.spyOn(t.store, 'note');
    await t.setups.start();
    for (const id of ['failing', 'cyclic', 'large']) t.setups.pluginActive(id);

    expect(observe).toHaveBeenCalledWith('failing', { state: 'DEGRADED', detail: 'restoring its share of the setup failed: cannot apply' });
    t.setups.changed();
    await vi.advanceTimersByTimeAsync(1_000);
    t.store.setClock('local');
    await vi.advanceTimersByTimeAsync(1_000); // a second save reports nothing again

    expect(t.current()?.plugins).toEqual({ failing: 'old', cyclic: 'old', large: 'old' });
    expect(observe.mock.calls).toEqual([
      ['failing', { state: 'DEGRADED', detail: 'restoring its share of the setup failed: cannot apply' }],
      ['failing', { state: 'DEGRADED', detail: 'saving its share of the setup failed: no state' }],
      ['cyclic', { state: 'DEGRADED', detail: 'its share of the setup is not JSON and is not saved' }],
    ]);
    expect(note.mock.calls).toEqual([['large', 'its share of the setup (65 KiB) is over 64 KiB and is not saved']]);
  });

  it('a share registered again replaces the first, and one unregistered keeps its last saved share', async () => {
    const t = setUp();
    await t.setups.start();
    const first = pluginShare('first');
    const second = pluginShare('second');
    const removeFirst = t.setups.register('p', first.share);
    t.setups.pluginActive('p');
    const removeSecond = t.setups.register('p', second.share);
    removeFirst(); // the replaced one: no effect
    t.setups.changed();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.current()?.plugins).toEqual({ p: 'second' });
    removeSecond();
    t.store.setClock('local');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.current()?.plugins).toEqual({ p: 'second' });
  });

  it('a save that fails is reported once, and the next change tries again', async () => {
    const t = setUp();
    await t.setups.start();
    t.docs.fail(new UserDocumentError('user-full', 'the user has 4 MiB of documents'));
    t.store.setClock('local');
    await vi.advanceTimersByTimeAsync(1_000);
    t.store.setClock('utc');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.store.getView().notifications.map((n) => n.message)).toEqual(['Your setup could not be saved on the server: the user has 4 MiB of documents']);
    t.docs.fail(null);
    t.store.setClock('local');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.current()?.shell.clock).toBe('local');
  });

  it('when the page closes, a change not yet saved goes with a call that outlives the page', async () => {
    const t = setUp();
    await t.setups.start();
    t.setups.flush();
    expect(t.closing.calls).toEqual([]); // nothing to save
    t.store.setClock('local');
    t.setups.flush();
    expect(t.closing.calls).toEqual([`put ${CURRENT}`]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(puts(t.docs.calls)).toEqual([]); // not again
  });

  it('a last save that fails is saved again if the page lives on, and a large one goes as a plain call (review F3)', async () => {
    const t = setUp();
    await t.setups.start();
    t.closing.fail(new UserDocumentError('unavailable', 'no answer from the server'));
    t.store.setClock('local');
    t.setups.flush(); // the page is only hidden
    await vi.advanceTimersByTimeAsync(1_000);
    expect(puts(t.closing.calls)).toEqual([`put ${CURRENT}`]);
    expect(puts(t.docs.calls)).toEqual([`put ${CURRENT}`]); // again, as a plain call
    expect(t.current()?.shell.clock).toBe('local');

    const large = pluginShare('x'.repeat(KEEPALIVE_BYTES));
    t.setups.register('large', large.share);
    t.setups.pluginActive('large');
    t.setups.changed();
    t.setups.flush();
    await vi.advanceTimersByTimeAsync(0);
    expect(puts(t.closing.calls)).toHaveLength(1); // over what keepalive takes
    expect(puts(t.docs.calls)).toHaveLength(2);
  });

  it('what was read at start is not written back unchanged (review F8)', async () => {
    const t = setUp({ [CURRENT]: setupDocument({ plugins: { map: { zoom: 5 } } }) });
    const map = pluginShare({ zoom: 0 });
    t.setups.register('map', map.share);
    await t.setups.start();
    t.setups.pluginActive('map');
    t.setups.changed();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(puts(t.docs.calls)).toEqual([]);
  });

  it('a restore that throws makes its plugin DEGRADED; the others still get theirs', async () => {
    const t = setUp({ [CURRENT]: setupDocument({ plugins: { failing: 1, fine: 2 } }) });
    const fine = pluginShare(0);
    t.setups.register('failing', { save: () => 0, restore: () => { throw new Error('cannot apply'); } });
    t.setups.register('fine', fine.share);
    t.setups.pluginActive('failing');
    t.setups.pluginActive('fine');
    const observe = vi.spyOn(t.store, 'observe');
    await t.setups.start();
    expect(observe.mock.calls).toEqual([['failing', { state: 'DEGRADED', detail: 'restoring its share of the setup failed: cannot apply' }]]);
    expect(fine.plugin.restored).toEqual([2]);
    expect(t.out.error).toHaveBeenCalledWith('[failing] its setup share could not be restored', new Error('cannot apply'));
  });

  it('a plugin gets its own copy of a share: changing it changes nothing the shell keeps (review F4)', async () => {
    const t = setUp({ [CURRENT]: setupDocument({ plugins: { p: { zoom: 5 } } }), [`${NAMED_PREFIX}a`]: setupDocument({ name: 'A', plugins: { p: { zoom: 7 } } }) });
    const restored: JsonValue[] = [];
    t.setups.register('p', {
      save: () => ({ zoom: 1 }),
      restore: (share) => {
        restored.push(JSON.parse(JSON.stringify(share)) as JsonValue);
        (share as { zoom: number }).zoom = 99;
      },
    });
    await t.setups.start();
    t.setups.pluginActive('p');
    await t.setups.restoreNamed(`${NAMED_PREFIX}a`);
    await t.setups.restoreNamed(`${NAMED_PREFIX}a`);
    expect(restored).toEqual([{ zoom: 5 }, { zoom: 7 }, { zoom: 7 }]);
  });
});

describe('the remembered setup at logout (ITA, keycloak/login.spec.ts, 2026-10-22)', () => {
  it('saves a change not yet saved at once, and nothing after, not even when the page is hidden', async () => {
    const t = setUp();
    await t.setups.start();
    t.store.setClock('local'); // would be saved within a second

    await t.setups.finish();

    expect(puts(t.docs.calls)).toEqual([`put ${CURRENT}`]);
    expect(t.current()?.shell.clock).toBe('local');
    t.store.setClock('utc');
    t.setups.flush(); // the page is hidden on its way to the IAM: after the logout, this would get 401
    await vi.advanceTimersByTimeAsync(5_000);
    expect(puts(t.docs.calls)).toHaveLength(1);
    expect(t.closing.calls).toEqual([]);
  });

  it('waits for a save under way, then saves the newer change after it', async () => {
    const t = setUp();
    await t.setups.start();
    const put = t.docs.documents.put.bind(t.docs.documents);
    let release = () => undefined as unknown;
    const spy = vi.spyOn(t.docs.documents, 'put').mockImplementationOnce((name, value) => new Promise<void>((resolve) => {
      release = () => put(name, value).then(resolve);
    }));
    t.store.setClock('local');
    await vi.advanceTimersByTimeAsync(1_000); // the save starts, and has no answer yet
    t.store.setClock('utc');

    const finished = t.setups.finish();
    await vi.advanceTimersByTimeAsync(10);
    expect(spy).toHaveBeenCalledTimes(1); // the newer change waits
    release();
    await finished;

    expect(spy).toHaveBeenCalledTimes(2);
    expect(t.current()?.shell.clock).toBe('utc'); // the newer one last
  });

  it('lets the logout go on after at most FINISH_MS when the server does not answer, and when nothing is to save', async () => {
    const t = setUp();
    await t.setups.start();
    vi.spyOn(t.docs.documents, 'put').mockImplementation(() => new Promise<void>(() => undefined));
    t.store.setClock('local');
    let done = false;
    void t.setups.finish().then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(FINISH_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);

    const unchanged = setUp();
    await unchanged.setups.start();
    await unchanged.setups.finish(); // no timer needed: nothing to save
    expect(puts(unchanged.docs.calls)).toEqual([]);
  });

  it('waits at most FINISH_MS also for a save under way when nothing else is to save (review F1)', async () => {
    const t = setUp();
    await t.setups.start();
    vi.spyOn(t.docs.documents, 'put').mockImplementation(() => new Promise<void>(() => undefined));
    t.store.setClock('local');
    await vi.advanceTimersByTimeAsync(1_000); // the timer's save starts and gets no answer
    let done = false;
    void t.setups.finish().then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(FINISH_MS - 1);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it('waits for a save made at page hide, so that it is not answered after the logout (review F2)', async () => {
    const t = setUp();
    await t.setups.start();
    let release = () => undefined as unknown;
    const put = t.closing.documents.put.bind(t.closing.documents);
    vi.spyOn(t.closing.documents, 'put').mockImplementationOnce((name, value) => new Promise<void>((resolve) => {
      release = () => put(name, value).then(resolve);
    }));
    t.store.setClock('local');
    t.setups.flush(); // hidden and shown again just before "Log out"
    let done = false;
    void t.setups.finish().then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(10);
    expect(done).toBe(false);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toBe(true);
    expect(puts(t.docs.calls)).toEqual([]); // nothing else to save
  });

  it('only logs a save that fails, saves once when called twice, and leaves no timer behind (review F3)', async () => {
    const t = setUp();
    await t.setups.start();
    t.store.setClock('local');
    t.docs.fail(new UserDocumentError('unavailable', 'no answer from the server'));
    await t.setups.finish();
    expect(t.out.warn).toHaveBeenCalledWith('[core-shell] the setup could not be saved before the logout', expect.any(UserDocumentError));
    expect(vi.getTimerCount()).toBe(0);

    const twice = setUp();
    await twice.setups.start();
    twice.store.setClock('local');
    await Promise.all([twice.setups.finish(), twice.setups.finish()]); // a double click
    expect(puts(twice.docs.calls)).toEqual([`put ${CURRENT}`]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('named setups', () => {
  it('are saved under a name, listed by name, restored at once, and then remembered', async () => {
    const t = setUp();
    await t.setups.start();
    const map = pluginShare({ zoom: 3 });
    t.setups.register('map-view-2d', map.share);
    t.setups.pluginActive('map-view-2d');

    t.store.restoreLayout(USER_LAYOUT);
    t.store.setClock('local');
    expect(await t.setups.saveNamed('  Arctic overview ')).toEqual({ saved: true });
    expect(await t.setups.saveNamed('baltic')).toEqual({ saved: true });
    const named = t.setups.getState().named ?? [];
    expect(named.map((s) => s.name)).toEqual(['Arctic overview', 'baltic']);
    const arctic = named[0];
    if (arctic === undefined) throw new Error('not saved');
    expect(arctic.id.startsWith(NAMED_PREFIX)).toBe(true);
    expect(t.docs.stored.get(arctic.id)).toMatchObject({ name: 'Arctic overview', saved: '2026-10-16T12:00:00.000Z', shell: { clock: 'local' }, plugins: { 'map-view-2d': { zoom: 3 } } });

    // Elsewhere, then back.
    t.store.restoreLayout(DEFAULT_LAYOUT);
    t.store.setClock('utc');
    map.plugin.state = { zoom: 9 };
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await t.setups.restoreNamed(arctic.id)).toBe(true);
    expect(t.store.getView().layout).toEqual(USER_LAYOUT);
    expect(t.store.getView().clock).toBe('local');
    expect(map.plugin.restored).toEqual([{ zoom: 3 }]);
    expect(t.store.getView().notifications.map((n) => n.message)).toEqual(['Restored the setup Arctic overview.']);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.current()).toMatchObject({ shell: { clock: 'local' }, plugins: { 'map-view-2d': { zoom: 3 } } });
  });

  it('a plugin still starting when a named setup is picked gets the named share, not the remembered one (review F2)', async () => {
    const t = setUp({
      [CURRENT]: setupDocument({ plugins: { map: { zoom: 5 } } }),
      [`${NAMED_PREFIX}a`]: setupDocument({ name: 'Arctic', plugins: { map: { zoom: 2 } } }),
    });
    const map = pluginShare({ zoom: 0 });
    t.setups.register('map', map.share); // in its activate, which takes its time
    await t.setups.start();
    expect(await t.setups.restoreNamed(`${NAMED_PREFIX}a`)).toBe(true);
    t.store.setClock('utc');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.current()?.plugins).toEqual({ map: { zoom: 2 } }); // not its defaults, not the old one

    t.setups.pluginActive('map');
    expect(map.plugin.restored).toEqual([{ zoom: 2 }]);
  });

  it('is not saved when the list of named setups could not be read (review F6)', async () => {
    const t = setUp();
    await t.setups.start();
    t.docs.fail(new UserDocumentError('unavailable', 'no answer from the server'));
    expect(await t.setups.saveNamed('Arctic')).toEqual({ saved: false });
    expect(t.setups.getState().error).toBe('Your named setups could not be read: no answer from the server');
    expect(puts(t.docs.calls)).toEqual([]);
  });

  it('a name that exists, in any case, is offered for replacing, and replacing keeps its document', async () => {
    const t = setUp();
    await t.setups.start();
    await t.setups.saveNamed('Arctic');
    const [arctic] = t.setups.getState().named ?? [];
    t.store.setClock('local');
    const result = await t.setups.saveNamed('ARCTIC');
    expect(result).toEqual({ saved: false, existing: arctic });
    expect(await t.setups.saveNamed('ARCTIC', true)).toEqual({ saved: true });
    expect(t.setups.getState().named?.map((s) => [s.id, s.name])).toEqual([[arctic?.id, 'ARCTIC']]);
    expect(t.docs.stored.get(arctic?.id ?? '')).toMatchObject({ name: 'ARCTIC', shell: { clock: 'local' } });
  });

  it('checks the name, and keeps to at most 50 named setups', async () => {
    const many = Object.fromEntries(Array.from({ length: MAX_NAMED }, (_, i) => [`${NAMED_PREFIX}${String(i)}`, setupDocument({ name: `Setup ${String(i)}` })]));
    const t = setUp(many);
    await t.setups.start();
    expect(await t.setups.saveNamed('   ')).toEqual({ saved: false, nameError: 'Enter a name.' });
    expect(await t.setups.saveNamed('x'.repeat(61))).toEqual({ saved: false, nameError: 'At most 60 characters.' });
    expect(await t.setups.saveNamed('One more')).toEqual({ saved: false, nameError: 'At most 50 named setups: delete one first.' });
    expect(await t.setups.saveNamed('Setup 7', true)).toEqual({ saved: true }); // replacing still works
  });

  it('are read once, skipping documents that are not named setups this version can read', async () => {
    const t = setUp({
      [CURRENT]: setupDocument(),
      [`${NAMED_PREFIX}a`]: setupDocument({ name: 'Zulu' }),
      [`${NAMED_PREFIX}b`]: setupDocument({ name: 'alpha' }),
      [`${NAMED_PREFIX}c`]: setupDocument({ name: 'Newer', version: SETUP_VERSION + 1 }),
      [`${NAMED_PREFIX}d`]: 'damaged',
      other: setupDocument({ name: 'Not a setup document' }),
    });
    await Promise.all([t.setups.loadNamed(), t.setups.loadNamed()]);
    await t.setups.loadNamed();
    expect(t.setups.getState().named?.map((s) => s.name)).toEqual(['alpha', 'Zulu']);
    expect(t.docs.calls.filter((c) => c === 'list')).toHaveLength(1);
  });

  it('a list that cannot be read is said so, and the next opening tries again', async () => {
    const t = setUp({ [`${NAMED_PREFIX}a`]: setupDocument({ name: 'Arctic' }) });
    t.docs.fail(new UserDocumentError('unavailable', 'no answer from the server'));
    await t.setups.loadNamed();
    expect(t.setups.getState()).toEqual({ named: null, busy: false, error: 'Your named setups could not be read: no answer from the server' });
    t.docs.fail(null);
    await t.setups.loadNamed();
    expect(t.setups.getState()).toEqual({ named: [{ id: `${NAMED_PREFIX}a`, name: 'Arctic', saved: '2026-10-16T10:00:00.000Z' }], busy: false, error: null });
  });

  it('are deleted; one deleted elsewhere is said to be gone', async () => {
    const t = setUp({ [`${NAMED_PREFIX}a`]: setupDocument({ name: 'Arctic' }), [`${NAMED_PREFIX}b`]: setupDocument({ name: 'Baltic' }) });
    await t.setups.loadNamed();
    expect(await t.setups.deleteNamed(`${NAMED_PREFIX}a`)).toBe(true);
    expect(t.docs.stored.has(`${NAMED_PREFIX}a`)).toBe(false);
    expect(t.setups.getState().named?.map((s) => s.name)).toEqual(['Baltic']);

    t.docs.stored.delete(`${NAMED_PREFIX}b`); // in another window
    expect(await t.setups.restoreNamed(`${NAMED_PREFIX}b`)).toBe(false);
    expect(t.setups.getState()).toEqual({ named: [], busy: false, error: 'That setup is gone: it was deleted in another window.' });
  });
});

describe('setups per workspace (ADR-0039 point 8; owner, 2026-10-27)', () => {
  const SIM = { id: 'simulator.simulation', name: 'Simulation', viewPermission: 'v', editPermission: 'e', order: 10 };
  const SIM_CURRENT = currentName(SIM.id);

  function switchTo(t: ReturnType<typeof setUp>, workspace: string): void {
    t.setups.leave(t.store.getView().workspace);
    t.store.setWorkspace(workspace);
    t.setups.enter(workspace);
  }

  it('reads each workspace\'s remembered setup at start: its layout for it, the plugins\' shares from the workspace shown', async () => {
    const t = setUp({
      [CURRENT]: setupDocument({ plugins: { 'map-view-2d': { zoom: 5 } } }),
      [SIM_CURRENT]: { version: SETUP_VERSION, shell: { layout: DEFAULT_LAYOUT }, plugins: { 'map-view-2d': { zoom: 9 } } } as unknown as JsonValue,
    });
    t.store.setWorkspaces([SIM]);
    t.store.setWorkspace(SIM.id); // a page opened on Simulation's address
    const map = pluginShare({ zoom: 3 });
    t.setups.register('map-view-2d', map.share);

    await t.setups.start();
    t.setups.pluginActive('map-view-2d');

    expect(map.plugin.restored).toEqual([{ zoom: 9 }]);
    expect(t.store.getView().layout).toEqual(DEFAULT_LAYOUT);
    expect(t.store.layoutOf('core.view')).toEqual(USER_LAYOUT);
    expect(t.store.getView().clock).toBe('local'); // View's: the same in every workspace
  });

  it('a switch keeps and saves the shares of the workspace left and restores those of the new one; a first visit restores nothing', async () => {
    const t = setUp({ [CURRENT]: setupDocument({ plugins: { 'map-view-2d': { zoom: 5 } } }) });
    t.store.setWorkspaces([SIM]);
    const map = pluginShare({ zoom: 3 });
    t.setups.register('map-view-2d', map.share);
    await t.setups.start();
    t.setups.pluginActive('map-view-2d');
    map.plugin.state = { zoom: 6 };

    switchTo(t, SIM.id);
    expect(map.plugin.restored).toEqual([{ zoom: 5 }]); // only the start's: Simulation has no share yet
    map.plugin.state = { zoom: 11 };
    t.setups.changed();
    switchTo(t, 'core.view');
    await vi.advanceTimersByTimeAsync(1_000);

    expect(map.plugin.restored).toEqual([{ zoom: 5 }, { zoom: 6 }]);
    expect((t.docs.stored.get(CURRENT) as { plugins: Record<string, JsonValue> }).plugins).toEqual({ 'map-view-2d': { zoom: 6 } });
    expect(t.docs.stored.get(SIM_CURRENT)).toEqual({ version: SETUP_VERSION, shell: { layout: DEFAULT_LAYOUT }, plugins: { 'map-view-2d': { zoom: 11 } } });
    switchTo(t, SIM.id);
    expect(map.plugin.restored.at(-1)).toEqual({ zoom: 11 });
  });

  it('the clock and the look stay in View\'s setup, also when changed in another workspace', async () => {
    const t = setUp();
    t.store.setWorkspaces([SIM]);
    await t.setups.start();
    switchTo(t, SIM.id);

    t.store.setClock('local');
    t.store.setPaneCollapsed('left', true); // Simulation's own layout changes too
    await vi.advanceTimersByTimeAsync(1_000);

    expect((t.docs.stored.get(CURRENT) as { shell: { clock: string } }).shell.clock).toBe('local');
    expect(t.docs.stored.get(SIM_CURRENT)).toEqual({ version: SETUP_VERSION, shell: { layout: setPaneCollapsed(DEFAULT_LAYOUT, 'left', true) }, plugins: {} });
  });

  it('named setups belong to the workspace shown: saved and listed under its prefix', async () => {
    const t = setUp({ [`${NAMED_PREFIX}old`]: setupDocument({ name: 'Old', plugins: {} }) });
    t.store.setWorkspaces([SIM]);
    await t.setups.start();
    await t.setups.loadNamed();
    expect(t.setups.getState().named?.map((s) => s.name)).toEqual(['Old']);

    switchTo(t, SIM.id);
    expect(t.setups.getState().named).toBeNull(); // not read for Simulation yet
    await t.setups.loadNamed();
    expect(t.setups.getState().named).toEqual([]);
    expect(await t.setups.saveNamed('Exercise')).toEqual({ saved: true });

    const names = [...t.docs.stored.keys()].filter((n) => n.startsWith(namedPrefix(SIM.id)));
    expect(names).toHaveLength(1);
    expect(namedPrefix(SIM.id)).toBe('setup.w.simulator.simulation.n.');
    expect((t.docs.stored.get(names[0] ?? '') as { shell: object }).shell).toEqual({ layout: DEFAULT_LAYOUT });
    switchTo(t, 'core.view');
    expect(t.setups.getState().named?.map((s) => s.name)).toEqual(['Old']);
  });

  it('restoring a named setup of another workspace keeps the clock and the look', async () => {
    const t = setUp();
    t.store.setWorkspaces([SIM]);
    await t.setups.start();
    switchTo(t, SIM.id);
    t.docs.stored.set(`${namedPrefix(SIM.id)}x`, { version: SETUP_VERSION, shell: { layout: USER_LAYOUT }, plugins: {}, name: 'X', saved: '' } as unknown as JsonValue);

    expect(await t.setups.restoreNamed(`${namedPrefix(SIM.id)}x`)).toBe(true);

    expect(t.store.getView().layout).toEqual(USER_LAYOUT);
    expect(t.store.getView().clock).toBe('utc');
    expect(t.store.getView().look).toBe(DEFAULT_CHOICE);
  });
});

describe('setups during a switch (the conformance review of cda/workspaces-shell)', () => {
  const SIM = { id: 'simulator.simulation', name: 'Simulation', viewPermission: 'v', editPermission: 'e', order: 10 };
  const SIM_CURRENT = currentName(SIM.id);
  const simDocument = { version: SETUP_VERSION, shell: { layout: DEFAULT_LAYOUT }, plugins: { 'map-view-2d': { zoom: 9 } } } as unknown as JsonValue;

  async function started() {
    const t = setUp({ [CURRENT]: setupDocument({ plugins: { 'map-view-2d': { zoom: 5 } } }), [SIM_CURRENT]: simDocument });
    t.store.setWorkspaces([SIM]);
    const map = pluginShare({ zoom: 5 });
    t.setups.register('map-view-2d', map.share);
    await t.setups.start();
    t.setups.pluginActive('map-view-2d');
    return { ...t, map };
  }

  it('a second switch before the first one restored its shares keeps the saved setup of the workspace in between (1)', async () => {
    const t = await started();

    t.setups.leave('core.view');
    t.store.setWorkspace(SIM.id); // the switch's step 1; its step 4 has not come yet
    t.setups.changed(); // the 1-second save during the wait
    await vi.advanceTimersByTimeAsync(1_000);
    t.setups.leave(SIM.id); // the user switches back before the snapshots came
    t.store.setWorkspace('core.view');
    t.setups.enter('core.view');
    await vi.advanceTimersByTimeAsync(1_000);

    expect((t.docs.stored.get(SIM_CURRENT) as { plugins: JsonValue }).plugins).toEqual({ 'map-view-2d': { zoom: 9 } });
    expect((t.docs.stored.get(CURRENT) as { plugins: JsonValue }).plugins).toEqual({ 'map-view-2d': { zoom: 5 } });
    expect(t.map.plugin.restored.at(-1)).toEqual({ zoom: 5 });
  });

  it('restoring a named setup is stopped when the workspace changed while it was read (7)', async () => {
    const t = await started();
    t.docs.stored.set(`${NAMED_PREFIX}x`, setupDocument({ name: 'X', plugins: { 'map-view-2d': { zoom: 1 } } }));

    const restoring = t.setups.restoreNamed(`${NAMED_PREFIX}x`);
    t.setups.leave('core.view');
    t.store.setWorkspace(SIM.id);

    expect(await restoring).toBe(false);
    expect(t.setups.getState().error).toBe('The workspace changed while the setup was read; nothing was restored.');
    expect(t.map.plugin.restored).toEqual([{ zoom: 5 }]);
  });

  it('when the page closes, keepalive is used while the browser\'s budget lasts, for all workspaces together (6)', async () => {
    const t = await started();
    t.map.plugin.state = { zoom: 'x'.repeat(KEEPALIVE_BYTES / 2) };
    t.setups.leave('core.view');
    t.store.setWorkspace(SIM.id);
    t.setups.enter(SIM.id);
    t.map.plugin.state = { zoom: 'y'.repeat(KEEPALIVE_BYTES / 2) };
    t.setups.changed();

    t.setups.flush();
    await vi.advanceTimersByTimeAsync(0);

    expect(puts(t.closing.calls)).toHaveLength(1);
    expect(puts(t.docs.calls)).toHaveLength(1);
  });
});
