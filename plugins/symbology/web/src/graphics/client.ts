// The main thread's side of the graphics worker (brief, function 9): one module worker, started at
// the first call and kept for the page's life; one message per frame; a timeout per request.
import type { GraphicCatalogEntry, GraphicRenderRequest, GraphicRendering } from '@emc2/plugin-sdk';
import type { GraphicStandard } from './catalogue.ts';
import type { FromWorker, ToWorker } from './protocol.ts';

/** What the client needs of a `Worker`; tests give a fake. */
export interface WorkerLike {
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: ToWorker): void;
  terminate(): void;
}

/**
 * How long the worker may take to load mil-sym-ts before it counts as failed. The request timeout
 * (the setting) starts only when it is loaded, so a slow first load does not time requests out.
 */
export const LOAD_TIMEOUT_MS = 60_000;

export interface GraphicsClientOptions {
  readonly createWorker: () => WorkerLike;
  /** The request timeout in milliseconds, read at each request (the setting may change). */
  readonly timeoutMs: () => number;
  /** Runs a function before the next frame (requestAnimationFrame); tests run it at once or by hand. */
  readonly schedule?: (run: () => void) => void;
}

export interface GraphicsClient {
  catalogue(standard: GraphicStandard): Promise<readonly GraphicCatalogEntry[]>;
  render(request: GraphicRenderRequest): Promise<GraphicRendering>;
  /** True once a worker has been started (for tests of criterion 14). */
  readonly started: boolean;
}

interface Pending {
  /** The catalogue's entries, or one request's rendering. */
  readonly resolve: (answer: readonly GraphicCatalogEntry[] | GraphicRendering) => void;
  readonly fail: (reason: string) => void;
  timer?: ReturnType<typeof setTimeout>;
}

function defaultSchedule(run: () => void): void {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { run(); });
  else setTimeout(run, 0);
}

export function createGraphicsClient(options: GraphicsClientOptions): GraphicsClient {
  const schedule = options.schedule ?? defaultSchedule;
  let worker: WorkerLike | null = null;
  let ready = false;
  let started = false;
  let loadTimer: ReturnType<typeof setTimeout> | undefined;
  let nextId = 1;
  const pending = new Map<number, Pending>();
  /** Messages waiting for the worker to load (catalogue requests) or for the frame (render requests). */
  const waiting: ToWorker[] = [];
  let frame: { id: number; request: GraphicRenderRequest }[] = [];
  let frameScheduled = false;

  /** Drops the worker and fails everything it holds; the next call starts a new one. */
  function discard(reason: string): void {
    clearTimeout(loadTimer);
    worker?.terminate();
    worker = null;
    ready = false;
    waiting.length = 0;
    const failed = [...pending.values()];
    pending.clear();
    for (const p of failed) {
      clearTimeout(p.timer);
      p.fail(reason);
    }
  }

  function startTimer(id: number): void {
    const p = pending.get(id);
    if (p === undefined) return;
    p.timer = setTimeout(() => {
      // The worker is held up (a request too large, or stuck): drop it, so that the next request draws.
      // A late answer finds nothing pending and is dropped.
      if (pending.has(id)) discard('timeout');
    }, options.timeoutMs());
  }

  function send(message: ToWorker): void {
    if (worker === null || !ready) {
      waiting.push(message);
      return;
    }
    worker.postMessage(message);
    if (message.type === 'catalogue') startTimer(message.id);
    else for (const item of message.items) startTimer(item.id);
  }

  function onMessage(message: FromWorker): void {
    if (message.type === 'ready') {
      ready = true;
      clearTimeout(loadTimer);
      for (const queued of waiting.splice(0)) send(queued);
      return;
    }
    const answers = message.type === 'catalogue' ? [{ id: message.id, answer: message.entries }] : message.results.map((r) => ({ id: r.id, answer: r.rendering }));
    for (const { id, answer } of answers) {
      const p = pending.get(id);
      if (p === undefined) continue;
      pending.delete(id);
      clearTimeout(p.timer);
      p.resolve(answer);
    }
  }

  function ensureWorker(): void {
    if (worker !== null) return;
    const created = options.createWorker();
    worker = created;
    started = true;
    created.onmessage = (event) => {
      if (worker === created) onMessage(event.data);
    };
    created.onerror = (event) => {
      if (worker === created) discard(`the renderer failed: ${event.message || 'worker error'}`);
    };
    loadTimer = setTimeout(() => {
      if (worker === created && !ready) discard('the renderer did not load');
    }, LOAD_TIMEOUT_MS);
  }

  function flushFrame(): void {
    frameScheduled = false;
    const items = frame;
    frame = [];
    if (items.length > 0) send({ type: 'render', items });
  }

  return {
    get started() {
      return started;
    },
    catalogue(standard) {
      return new Promise((resolve, reject) => {
        ensureWorker();
        const id = nextId++;
        pending.set(id, {
          resolve: (answer) => {
            resolve(answer as readonly GraphicCatalogEntry[]);
          },
          fail: (reason) => {
            reject(new Error(`graphicCatalog(${standard}): ${reason}`));
          },
        });
        send({ type: 'catalogue', id, standard });
      });
    },
    render(request) {
      return new Promise((resolve) => {
        ensureWorker();
        const id = nextId++;
        pending.set(id, {
          resolve: (answer) => {
            resolve(answer as GraphicRendering);
          },
          fail: (reason) => {
            resolve({ ok: false, reason });
          },
        });
        frame.push({ id, request });
        if (!frameScheduled) {
          frameScheduled = true;
          schedule(flushFrame);
        }
      });
    },
  };
}
