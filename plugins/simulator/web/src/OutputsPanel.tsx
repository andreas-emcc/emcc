// The Outputs panel (brief functions 18 and 22): the channels other plugins offer, with their
// output type, whether they send a delete, and the declared fields they use; the chosen ones, and
// those missing marked as such, not dropped (N8).
import { useEffect } from 'react';
import { X } from 'lucide-react';
import { Checkbox, IconButton, Notice } from '@emc2/plugin-sdk';
import { SimPanel } from './SimPanel.tsx';
import type { DeclaredField, FieldSet } from '@emc2/plugin-sdk';
import { FailureNotice } from './FailureNotice.tsx';
import { useModel } from './model.ts';
import type { ChannelInfo, OutputsModel } from './outputs.ts';
import { EDIT_HINT } from './permissions.ts';
import type { Rights } from './permissions.ts';

/** A field's label with its plugin, e.g. "Team (cot)", or its name if no loaded plugin declares it. */
export function fieldLabel(key: string, declared: readonly DeclaredField[]): string {
  const field = declared.find((f) => `${f.plugin}.${f.name}` === key);
  return field === undefined ? key : `${field.label} (${field.plugin})`;
}

/** A field set's label (function 31), or its id when no loaded plugin declares it (A107). */
export function setLabel(id: string, sets: readonly FieldSet[]): string {
  return sets.find((s) => s.id === id)?.label ?? id;
}

/** The Ground truth outputs (from M5, ADR-0048 point 6): the channels that take ground truth. */
export const GROUND_TRUTH_TITLE = 'Ground truth outputs';

export function OutputsPanel(props: {
  readonly model: OutputsModel;
  readonly declaredFields: readonly DeclaredField[];
  readonly fieldSets: readonly FieldSet[];
  readonly rights: Rights;
}) {
  const { model, rights } = props;
  const state = useModel(model);
  useEffect(() => model.watch(), [model]);
  const chosen = new Map(state.chosen.map((c) => [c.id, c]));
  const offered = new Set((state.channels ?? []).map((c) => c.id));
  const notOffered = state.chosen.filter((c) => !offered.has(c.id));
  const disabled = !rights.edit || state.busy;

  return (
    <SimPanel label={GROUND_TRUTH_TITLE}>
      <div className="simulator-panel">
        {rights.edit ? null : <Notice>{EDIT_HINT}</Notice>}
        {state.readError === null ? null : <Notice severity="warning">{state.readError}</Notice>}
        <FailureNotice failure={state.failure} onDismiss={() => { model.dismissFailure(); }} />
        {state.channels === null ? (
          state.readError === null ? <p className="simulator-muted">Loading the outputs…</p> : null
        ) : state.channels.length === 0 && notOffered.length === 0 ? (
          <p className="simulator-muted">No plugin offers an output channel. Output links, such as cot&apos;s, offer them.</p>
        ) : (
          <ul className="simulator-list" aria-label="Output channels">
            {state.channels.map((c) => (
              <ChannelRow key={c.id} channel={c} chosen={chosen.has(c.id)} missing={chosen.get(c.id)?.missing === true} declared={props.declaredFields} sets={props.fieldSets} disabled={disabled} model={model} />
            ))}
            {notOffered.map((c) => (
              <li key={c.id} className="simulator-item" aria-label={c.id}>
                <div className="simulator-item-head">
                  <span className="simulator-item-name simulator-data">{c.id}</span>
                  <span className="simulator-state simulator-state-missing">Missing</span>
                  <IconButton icon={X} label={`Remove ${c.id}`} title={rights.edit ? `Remove ${c.id}` : EDIT_HINT} disabled={disabled} onClick={() => void model.set(c.id, false)} />
                </div>
                <div className="simulator-muted">Chosen, but not offered now. It is used again when it is offered again.</div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SimPanel>
  );
}

function ChannelRow(props: {
  readonly channel: ChannelInfo;
  readonly chosen: boolean;
  readonly missing: boolean;
  readonly declared: readonly DeclaredField[];
  readonly sets: readonly FieldSet[];
  readonly disabled: boolean;
  readonly model: OutputsModel;
}) {
  const { channel, chosen, missing, model } = props;
  return (
    <li className="simulator-item" aria-label={channel.name}>
      <div className="simulator-item-head">
        <Checkbox label={channel.name} checked={chosen} disabled={props.disabled} onChange={(on) => void model.set(channel.id, on)} />
        {missing ? <span className="simulator-state simulator-state-missing">Missing</span> : null}
      </div>
      <div className="simulator-muted">
        {channel.plugin} · {channel.outputType === '' ? 'output' : channel.outputType} · {channel.canDelete ? 'sends deletes' : 'sends no deletes'}
      </div>
      {channel.fieldSet === null ? null : <div className="simulator-muted">Field set: {setLabel(channel.fieldSet, props.sets)}</div>}
      {channel.fields.length === 0 ? null : <div className="simulator-muted">Uses {channel.fields.map((f) => fieldLabel(f, props.declared)).join(', ')}</div>}
    </li>
  );
}
