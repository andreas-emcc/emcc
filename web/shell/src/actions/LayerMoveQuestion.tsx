import { Button } from '@emc2/plugin-sdk';
import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { KnownLayers } from '../layers/known.ts';
import { objects } from './batch.ts';
import { WORDS, type LayerMover } from './layerMoves.ts';

/**
 * The question of "Move to layer…" and "Copy to layer…" (ADR-0053 point 1): the workspace's layers
 * that are not locked, the top one first, nothing chosen until the user picks one (A1); the layer
 * picker's list without its "+". Escape and Cancel close it.
 */
export function LayerMoveQuestion({ mover, layers }: { readonly mover: LayerMover; readonly layers: KnownLayers }) {
  const state = useSyncExternalStore(mover.subscribe, mover.getState);
  return state.asking === null ? null : <Question key={state.asking.ids.join()} mover={mover} layers={layers} />;
}

function Question({ mover, layers }: { readonly mover: LayerMover; readonly layers: KnownLayers }) {
  const asking = useSyncExternalStore(mover.subscribe, () => mover.getState().asking);
  const known = useSyncExternalStore(layers.subscribe, layers.getState);
  const [chosen, setChosen] = useState('');
  const box = useRef<HTMLDialogElement>(null);
  const modal = useRef(false);
  const id = useId().replace(/:/g, '');
  useEffect(() => { void layers.ready(); }, [layers]);
  useLayoutEffect(() => {
    const dialog = box.current;
    if (dialog === null) return undefined;
    modal.current = typeof dialog.showModal === 'function';
    if (modal.current) dialog.showModal();
    else dialog.setAttribute('open', '');
    dialog.querySelector<HTMLSelectElement>('select')?.focus();
    const onCancelEvent = (e: Event) => {
      e.preventDefault();
      mover.cancel();
    };
    dialog.addEventListener('cancel', onCancelEvent);
    return () => {
      dialog.removeEventListener('cancel', onCancelEvent);
      if (modal.current && dialog.open) dialog.close();
    };
  }, [mover]);
  if (asking === null) return null;
  const words = WORDS[asking.kind];
  const offered = mover.choices(known.layers, asking.workspace);
  const what = objects(asking.ids.length);
  const note = known.error !== null ? `The layers could not be read: ${known.error}`
    : !known.arrived ? 'Loading the layers…'
      : offered.length === 0 ? `${asking.workspace.name} has no layer that is not locked.` : null;
  const pick = offered.some((l) => l.id === chosen) ? chosen : '';
  return (
    <dialog
      ref={box}
      className="emc2-backdrop"
      aria-modal="true"
      aria-labelledby={`${id}-title`}
      onKeyDown={(e) => { if (e.key === 'Escape' && !modal.current) mover.cancel(); }}
    >
      <form
        className="emc2-dialog layer-move-question"
        onSubmit={(e) => {
          e.preventDefault();
          if (pick !== '') void mover.confirm(pick);
        }}
      >
        <h2 className="emc2-dialog-title" id={`${id}-title`}>{words.title}</h2>
        <div className="emc2-dialog-message">
          <label className="emc2-field">
            <span className="emc2-field-label">{`${words.verb} ${what} to`}</span>
            <select className="emc2-input" value={pick} onChange={(e) => { setChosen(e.currentTarget.value); }} aria-describedby={note === null ? undefined : `${id}-note`}>
              <option value="">Choose a layer</option>
              {offered.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </label>
          {note !== null && <p className="muted" id={`${id}-note`}>{note}</p>}
        </div>
        <div className="emc2-dialog-buttons">
          <Button onClick={() => { mover.cancel(); }}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={pick === ''}>{`${words.verb} ${what}`}</Button>
        </div>
      </form>
    </dialog>
  );
}
