/**
 * Settings › Layers' list of a layer's objects (T-175; owner, 2026-11-11): read from the server when
 * opened, {@link LIST_PAGE_SIZE} at a time in the order of creation, with Previous, Next and
 * Refresh. It is not live: it reads its page again on Refresh and when a layer change or an
 * emptying has finished.
 */
import { Button, Notice, type Layer, type LayerPage, type MapObject } from '@emc2/plugin-sdk';
import { useEffect, useState } from 'react';
import { count, describe, nameOf } from '../actions/batch.ts';
import type { LayerChanger } from './changer.ts';

/** The objects in one page of the list. */
export const LIST_PAGE_SIZE = 50;

/** What was read for one key (page, refresh and whether a change ran). */
interface Read {
  readonly key: string;
  readonly result: LayerPage | null;
  readonly error: string | null;
}

/** The classification, with its policy when that is not the layer's. */
function classificationOf(object: MapObject, layer: Layer): string {
  const policy = object.label.policyIdentifier.name;
  return policy === layer.label.policyIdentifier.name ? object.label.classification : `${policy} ${object.label.classification}`;
}

export function ObjectList({ layer, changer, running }: { readonly layer: Layer; readonly changer: LayerChanger; readonly running: boolean }) {
  const [page, setPage] = useState(0);
  const [refreshed, setRefreshed] = useState(0);
  const [read, setRead] = useState<Read | null>(null);
  const key = `${String(page)}/${String(refreshed)}/${String(running)}`;
  useEffect(() => {
    if (running) return undefined; // read again when it has finished
    let current = true;
    changer.readPage(layer.id, page, LIST_PAGE_SIZE).then((result) => {
      if (!current) return;
      const last = Math.max(0, Math.ceil(result.total / LIST_PAGE_SIZE) - 1);
      if (page > last) setPage(last); // the layer has fewer objects now
      else setRead({ key, result, error: null });
    }, (error: unknown) => {
      if (current) setRead({ key, result: null, error: describe(error) });
    });
    return () => { current = false; };
  }, [changer, layer.id, page, running, key]);

  const result = read?.result ?? null;
  const reading = read?.key !== key && !running;
  const total = result?.total ?? 0;
  const first = page * LIST_PAGE_SIZE;
  return (
    <div className="layer-objects">
      {read?.error != null && <Notice severity="error">The objects could not be read: {read.error}</Notice>}
      {reading && <p className="muted">Reading the objects…</p>}
      {result !== null && total === 0 && <p className="muted">The layer has no objects.</p>}
      {result !== null && result.objects.length > 0 && (
        <table className="monitor-table">
          <caption>Objects of {layer.name}</caption>
          <thead>
            <tr><th scope="col">Name</th><th scope="col">Data type</th><th scope="col">Source</th><th scope="col">Classification</th></tr>
          </thead>
          <tbody>
            {result.objects.map((object) => (
              <tr key={object.id}>
                <th scope="row">{nameOf(object)}</th>
                <td>{object.dataType}</td>
                <td>{object.dataSource}</td>
                <td>{classificationOf(object, layer)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="settings-inline">
        {result !== null && total > 0 && (
          <span className="muted">
            Objects {count(first + 1)}–{count(first + result.objects.length)} of {count(total)}
          </span>
        )}
        <Button disabled={page === 0} onClick={() => { setPage(page - 1); }}>Previous</Button>
        <Button disabled={first + LIST_PAGE_SIZE >= total} onClick={() => { setPage(page + 1); }}>Next</Button>
        <Button disabled={running} onClick={() => { setRefreshed(refreshed + 1); }}>Refresh</Button>
      </div>
    </div>
  );
}
