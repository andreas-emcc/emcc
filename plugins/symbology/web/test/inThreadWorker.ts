import type { WorkerLike } from '../src/graphics/client.ts';
import { createEngine } from '../src/graphics/engine.ts';
import type { FromWorker } from '../src/graphics/protocol.ts';

/** A worker that runs the engine in this thread, as the real one does in its own. */
export function inThreadWorker(): WorkerLike {
  const engine = createEngine();
  const worker: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(message) {
      queueMicrotask(() => {
        const answer: FromWorker =
          message.type === 'catalogue'
            ? { type: 'catalogue', id: message.id, entries: structuredClone(engine.catalogue(message.standard)) }
            : { type: 'render', results: message.items.map((i) => ({ id: i.id, rendering: engine.render(structuredClone(i.request)).rendering })) };
        worker.onmessage?.({ data: answer } as MessageEvent<FromWorker>);
      });
    },
    terminate() {},
  };
  queueMicrotask(() => worker.onmessage?.({ data: { type: 'ready' } } as MessageEvent<FromWorker>));
  return worker;
}
