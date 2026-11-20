import type { RelationKind } from '@emc2/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import { DisplayState, type StoredDisplay } from './state.ts';

const GMTI: RelationKind = {
  id: 'gmti.pairing', label: 'GMTI Pairing', defaultOn: true,
  line: { strokeColor: '#336699', strokeWidth: 1, strokeDash: 'solid', arrowhead: 'none' },
};

/** A server whose reads wait until `answer` and whose writes answer at once. */
function server(writeStatus = 204, problem?: string) {
  const reads: ((stored: StoredDisplay | Response) => void)[] = [];
  const writes: { readonly path: string; readonly body: unknown }[] = [];
  const doFetch = vi.fn<typeof fetch>((input, init) => {
    if (init?.method === 'PUT') {
      writes.push({ path: input as string, body: JSON.parse(init.body as string) });
      return Promise.resolve(writeStatus === 204 ? new Response(null, { status: 204 }) : Response.json({ problem }, { status: writeStatus }));
    }
    return new Promise((resolve) => {
      reads.push((stored) => { resolve(stored instanceof Response ? stored : Response.json(stored)); });
    });
  });
  const answer = async (stored: StoredDisplay | Response) => {
    const next = reads.shift();
    if (next === undefined) throw new Error('no read waiting');
    next(stored);
    await vi.waitFor(() => undefined);
    await new Promise((r) => setTimeout(r, 0));
  };
  return { doFetch, reads, writes, answer };
}

describe('the user\'s display settings in the page (SDK 1.4.0 part 5; owner, 2026-11-07)', () => {
  it('resolves what the server keeps with the loaded kinds, keeping a switch of a kind not loaded', async () => {
    const s = server();
    const display = new DisplayState({ relationKinds: [GMTI], fetch: s.doFetch });
    const told = vi.fn();
    display.onChange(told);
    expect(display.value.symbolSize, 'the SDK\'s until the first read').toBe(30);

    const load = display.load();
    await s.answer({ choices: { symbolSize: 40, relations: { 'gone.kind': true } }, defaults: { speedVectorMinutes: 5, relations: { 'gmti.pairing': false } } });
    await load;
    expect(display.value).toEqual({
      symbolSize: 40, speedVectorMinutes: 5, speedVectorSeconds: 300, labels: expect.any(Array) as unknown, relations: { 'gmti.pairing': false },
      classes: { 'dwell-area': true, 'sensor-coverage': true }, // SDK 1.6.0: resolveDisplay fills them, on by default
      // SDK 1.8.0 (CR-0043 part A): the places and the arrow, the default's
      labelPlaces: { topLeft: null, topRight: 'uniqueDesignation', bottomLeft: null, bottomRight: null, below: 'name' }, directionArrow: true,
    });
    expect(display.choices.relations, 'kept for saving (R5)').toEqual({ 'gone.kind': true });
    expect(told).toHaveBeenCalledTimes(1);
  });

  it('reads one at a time, and once more when asked during a read', async () => {
    const s = server();
    const display = new DisplayState({ relationKinds: [], fetch: s.doFetch });
    const first = display.load();
    void display.load();
    void display.load();
    expect(s.reads).toHaveLength(1);
    await s.answer({ choices: { symbolSize: 20 }, defaults: {} });
    expect(s.reads, 'the notices during it make one more').toHaveLength(1);
    await s.answer({ choices: { symbolSize: 50 }, defaults: {} });
    await first;
    expect(display.value.symbolSize, 'the last stored').toBe(50);
  });

  it('shows a held change at once, saves it on release, and sets aside a read answered meanwhile', async () => {
    const s = server();
    const display = new DisplayState({ relationKinds: [], fetch: s.doFetch });
    const load = display.load();
    display.preview({ symbolSize: 60 });
    expect(display.value.symbolSize).toBe(60);
    await s.answer({ choices: {}, defaults: {} }); // older than the user's change
    await load;
    expect(display.value.symbolSize, 'not undone').toBe(60);

    const saved = display.save({ symbolSize: 64 });
    expect(display.value.symbolSize).toBe(64);
    await vi.waitFor(() => { expect(s.reads).toHaveLength(1); });
    expect(s.writes).toEqual([{ path: '/api/display', body: { symbolSize: 64 } }]);
    await s.answer({ choices: { symbolSize: 64 }, defaults: {} });
    await saved;
    expect(display.value.symbolSize).toBe(64);
  });

  it('says why a change was not saved and shows what is stored again', async () => {
    const s = server(400, 'symbolSize is a whole number from 16 to 96');
    const onProblem = vi.fn();
    const display = new DisplayState({ relationKinds: [], fetch: s.doFetch, onProblem });
    const saved = display.save({ symbolSize: 40 });
    await vi.waitFor(() => { expect(s.reads).toHaveLength(1); });
    expect(onProblem).toHaveBeenCalledWith('Your display settings were not saved: symbolSize is a whole number from 16 to 96');
    await s.answer({ choices: {}, defaults: {} });
    await saved;
    expect(display.value.symbolSize).toBe(30);
  });

  it('does not use what the server sends when it is not well formed', async () => {
    const s = server();
    const log = { warn: vi.fn() };
    const display = new DisplayState({ relationKinds: [], fetch: s.doFetch, log });
    const load = display.load();
    await s.answer({ choices: { symbolSize: 'big' }, defaults: { labels: ['speed'] } } as unknown as StoredDisplay);
    await load;
    expect(display.value.symbolSize).toBe(30);
    expect({ labelPlaces: display.value.labelPlaces, directionArrow: display.value.directionArrow }, 'a stored 1.7.0 list converts with the arrow on (owner WZ A)').toEqual({
      labelPlaces: { topLeft: null, topRight: 'speed', bottomLeft: null, bottomRight: null, below: null }, directionArrow: true,
    });
    expect(log.warn).toHaveBeenCalledWith('The user\'s display settings from the server are not used: symbolSize is a whole number from 16 to 96');
  });
});
