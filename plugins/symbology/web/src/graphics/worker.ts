// The graphics worker (a module worker, one per page): mil-sym-ts loads here and only here. It gets
// copies and gives copies; the drawn coordinates are transferred, never sent as GeoJSON text.
import { createEngine } from './engine.ts';
import type { FromWorker, ToWorker } from './protocol.ts';

interface WorkerScope {
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
const engine = createEngine();

scope.onmessage = ({ data }) => {
  if (data.type === 'catalogue') {
    scope.postMessage({ type: 'catalogue', id: data.id, entries: engine.catalogue(data.standard) });
    return;
  }
  const results: { id: number; rendering: ReturnType<typeof engine.render>['rendering'] }[] = [];
  const transfer: ArrayBuffer[] = [];
  for (const { id, request } of data.items) {
    const parsed = engine.render(request);
    results.push({ id, rendering: parsed.rendering });
    transfer.push(...parsed.transfer);
  }
  scope.postMessage({ type: 'render', results }, transfer);
};

scope.postMessage({ type: 'ready' });
