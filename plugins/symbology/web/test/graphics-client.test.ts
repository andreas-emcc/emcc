// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GraphicRenderRequest } from '@emc2/plugin-sdk';
import { createGraphicsClient, LOAD_TIMEOUT_MS, type WorkerLike } from '../src/graphics/client.ts';
import type { FromWorker, ToWorker } from '../src/graphics/protocol.ts';
import { createSymbolService } from '../src/service.ts';
import { inThreadWorker } from './inThreadWorker.ts';

afterEach(() => {
  vi.useRealTimers();
});

/** A worker the test drives: it records messages and answers only when told. */
class FakeWorker implements WorkerLike {
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly posted: ToWorker[] = [];
  terminated = false;
  postMessage(message: ToWorker): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(message: FromWorker): void {
    this.onmessage?.({ data: message } as MessageEvent<FromWorker>);
  }
  /** Answers every render request posted so far with an empty drawing. */
  answerAll(): void {
    for (const m of this.posted.splice(0)) {
      if (m.type === 'render') this.emit({ type: 'render', results: m.items.map((i) => ({ id: i.id, rendering: { ok: true, lines: [], fills: [], labels: [] } })) });
    }
  }
}

const REQUEST: GraphicRenderRequest = {
  standard: 'APP-6D',
  sidc: '10032500001403000000',
  points: [
    [17.6, 59.9],
    [17.85, 59.86],
  ],
  resolution: 13,
  extent: [17, 59, 19, 61],
};

function setup(timeoutMs = 5000) {
  const workers: FakeWorker[] = [];
  const frames: (() => void)[] = [];
  const client = createGraphicsClient({
    createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    timeoutMs: () => timeoutMs,
    schedule: (run) => frames.push(run),
  });
  const nextFrame = () => {
    for (const run of frames.splice(0)) run();
  };
  return { client, workers, nextFrame };
}

describe('criterion 14 (unit part): one worker, started when needed', () => {
  it('starts no worker before the first request, then exactly one for many', async () => {
    const { client, workers, nextFrame } = setup();
    expect(client.started).toBe(false);
    expect(workers).toHaveLength(0);
    const answers = [client.render(REQUEST), client.render(REQUEST), client.catalogue('APP-6D')];
    expect(workers).toHaveLength(1);
    const worker = workers[0] as FakeWorker;
    worker.emit({ type: 'ready' });
    nextFrame();
    expect(worker.posted.map((m) => m.type).sort()).toEqual(['catalogue', 'render']);
    const catalogue = worker.posted.find((m) => m.type === 'catalogue');
    worker.answerAll();
    if (catalogue?.type === 'catalogue') worker.emit({ type: 'catalogue', id: catalogue.id, entries: [] });
    await expect(Promise.all(answers)).resolves.toHaveLength(3);
    void client.render(REQUEST);
    expect(workers).toHaveLength(1);
  });

  it('sends the requests of one frame in one message, and each gets its own answer', async () => {
    const { client, workers, nextFrame } = setup();
    const answers = [1, 2, 3].map(() => client.render(REQUEST));
    const worker = workers[0] as FakeWorker;
    worker.emit({ type: 'ready' });
    nextFrame();
    expect(worker.posted).toHaveLength(1);
    const message = worker.posted[0];
    if (message?.type !== 'render') throw new Error('expected one render message');
    expect(message.items).toHaveLength(3);
    const [a, b, c] = message.items;
    worker.emit({
      type: 'render',
      results: [
        { id: c?.id ?? 0, rendering: { ok: false, reason: 'third' } },
        { id: a?.id ?? 0, rendering: { ok: false, reason: 'first' } },
        { id: b?.id ?? 0, rendering: { ok: false, reason: 'second' } },
      ],
    });
    expect(await Promise.all(answers)).toEqual([
      { ok: false, reason: 'first' },
      { ok: false, reason: 'second' },
      { ok: false, reason: 'third' },
    ]);
  });
});

describe('criterion 15: timeout', () => {
  it('a request held longer than the setting resolves with "timeout", a late answer is dropped, and the next request draws', async () => {
    vi.useFakeTimers();
    const { client, workers, nextFrame } = setup(2000);
    const held = client.render(REQUEST);
    const first = workers[0] as FakeWorker;
    first.emit({ type: 'ready' });
    nextFrame();
    const sent = first.posted[0];
    vi.advanceTimersByTime(1999);
    let settled = false;
    void held.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    vi.advanceTimersByTime(1);
    await expect(held).resolves.toEqual({ ok: false, reason: 'timeout' });
    expect(first.terminated).toBe(true);
    // The held-up worker answers late: nothing is pending, so the answer goes nowhere.
    if (sent?.type === 'render') first.emit({ type: 'render', results: sent.items.map((i) => ({ id: i.id, rendering: { ok: true, lines: [], fills: [], labels: [] } })) });
    const next = client.render(REQUEST);
    expect(workers).toHaveLength(2);
    const second = workers[1] as FakeWorker;
    second.emit({ type: 'ready' });
    nextFrame();
    second.answerAll();
    await expect(next).resolves.toEqual({ ok: true, lines: [], fills: [], labels: [] });
  });

  it('the timeout starts when the renderer is loaded, not before', async () => {
    vi.useFakeTimers();
    const { client, workers, nextFrame } = setup(1000);
    const answer = client.render(REQUEST);
    nextFrame();
    vi.advanceTimersByTime(5000);
    const worker = workers[0] as FakeWorker;
    expect(worker.terminated).toBe(false);
    worker.emit({ type: 'ready' });
    worker.answerAll();
    await expect(answer).resolves.toMatchObject({ ok: true });
  });

  it('a renderer that does not load in time, or a worker error, resolves with ok: false; the next call starts a new worker', async () => {
    vi.useFakeTimers();
    const { client, workers, nextFrame } = setup();
    const notLoaded = client.render(REQUEST);
    nextFrame();
    vi.advanceTimersByTime(LOAD_TIMEOUT_MS);
    await expect(notLoaded).resolves.toEqual({ ok: false, reason: 'the renderer did not load' });
    const failed = client.render(REQUEST);
    expect(workers).toHaveLength(2);
    workers[1]?.onerror?.({ message: 'out of memory' } as ErrorEvent);
    await expect(failed).resolves.toEqual({ ok: false, reason: 'the renderer failed: out of memory' });
    void client.render(REQUEST);
    expect(workers).toHaveLength(3);
  });

  it('a failed catalogue rejects, and the service asks for it again next time', async () => {
    vi.useFakeTimers();
    const workers: FakeWorker[] = [];
    const symbols = createSymbolService({
      cacheSize: 10,
      graphicTimeoutSeconds: 1,
      createWorker: () => {
        const w = new FakeWorker();
        workers.push(w);
        return w;
      },
    });
    const first = symbols.service.graphicCatalog('APP-6D');
    workers[0]?.emit({ type: 'ready' });
    vi.advanceTimersByTime(1000);
    await expect(first).rejects.toThrow(/timeout/);
    const second = symbols.service.graphicCatalog('APP-6D');
    const worker = workers[1] as FakeWorker;
    worker.emit({ type: 'ready' });
    const message = worker.posted[0];
    if (message?.type === 'catalogue') worker.emit({ type: 'catalogue', id: message.id, entries: [] });
    await expect(second).resolves.toEqual([]);
    expect(symbols.service.graphicCatalog('APP-6D')).toBe(second);
  });
});

describe('the service with the engine (criteria 10, 11 end to end)', () => {
  it('graphicCatalog and renderGraphic answer through the worker protocol', async () => {
    const { service } = createSymbolService({ cacheSize: 10, createWorker: inThreadWorker, schedule: (run) => { queueMicrotask(run); } });
    const catalogue = await service.graphicCatalog('APP-6E');
    expect(catalogue.length).toBeGreaterThan(300);
    const drawn = await service.renderGraphic({ ...REQUEST, standard: 'APP-6E', sidc: '14032500001403000000' });
    expect(drawn).toMatchObject({ ok: true });
    if (drawn.ok) expect(drawn.lines[0]?.coordinates).toBeInstanceOf(Float64Array);
  });
});
