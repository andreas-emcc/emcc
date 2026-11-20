import { ConfirmDialog } from '@emc2/plugin-sdk';
import { useSyncExternalStore } from 'react';
import type { Deleter } from './deletion.ts';

/** The shared Delete's question (ADR-0032 point 6): the number of objects, and that there is no undo. */
export function DeleteQuestion({ deleter }: { readonly deleter: Deleter }) {
  const state = useSyncExternalStore(deleter.subscribe, deleter.getState);
  const n = state.asking?.length ?? 0;
  const what = `${n.toLocaleString('en-GB')} ${n === 1 ? 'object' : 'objects'}`;
  return (
    <ConfirmDialog
      open={state.asking !== null}
      title="Delete objects"
      message={`Delete ${what}? This cannot be undone.`}
      confirmLabel={`Delete ${what}`}
      danger
      onConfirm={() => { void deleter.confirm(); }}
      onCancel={() => { deleter.cancel(); }}
    />
  );
}
