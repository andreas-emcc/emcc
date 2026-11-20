/**
 * Settings › Layers (ADR-0031 point 3; owner, 2026-10-17): each layer with its label and number of
 * objects. An admin with `layers.edit` chooses the classification to change it to, from its policy's
 * order, with "Also raise objects below it" (needs `objects.edit`); one with `objects.edit` only may
 * raise the objects below the layer's classification without changing the layer (owner, 2026-10-17).
 * Apply asks once, saying exactly what happens. A layer whose policy has no order, or whose
 * classification is outside it, is read only, with a note. So is a locked layer (ADR-0042; owner,
 * 2026-10-30): the server would refuse both changes, so the card says where to unlock it. The change
 * itself is `changer.ts`.
 *
 * Grouped by workspace (ADR-0039; T-080, owner 2026-10-27): View's layers, then each other
 * workspace the user may see, each group with its own heading once there are several. In a declared
 * workspace both changes need its edit permission instead of `layers.edit` and `objects.edit`.
 *
 * Each layer can list its objects (`ObjectList.tsx`) and be emptied with "Delete all objects" (T-175;
 * owner, QE and QF A, 2026-11-11): with the shared Delete's right, not on a locked or an empty layer,
 * after a question with the number of objects.
 */
import { Button, Checkbox, ConfirmDialog, Notice, Select, VIEW_WORKSPACE, workspaceOf, type Layer, type WorkspaceInfo } from '@emc2/plugin-sdk';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { count, objects } from '../actions/batch.ts';
import type { LayerChange, LayerChanger } from './changer.ts';
import type { KnownLayers } from './known.ts';
import { ObjectList } from './ObjectList.tsx';

const labelText = (layer: Layer): string => `${layer.label.policyIdentifier.name} ${layer.label.classification}`;

/** The question for a change, stating what happens. */
function question(change: LayerChange, objectCount: number): { readonly message: string; readonly confirmLabel: string } {
  const { layer, to, raise } = change;
  const from = layer.label.classification;
  const theObjects = `The layer has ${objects(objectCount)}; those of policy ${layer.label.policyIdentifier.name} below ${to} are raised to ${to}, others are left alone. This cannot be undone.`;
  if (from === to) return { message: `Raise the objects of the layer ${layer.name}? ${theObjects}`, confirmLabel: 'Raise objects' };
  if (!raise) return { message: `Change the layer ${layer.name} from ${from} to ${to}? Its objects keep their classifications.`, confirmLabel: 'Change layer' };
  return { message: `Change the layer ${layer.name} from ${from} to ${to}, and raise its objects? ${theObjects}`, confirmLabel: 'Change and raise' };
}

function permissionNote(changer: LayerChanger, workspace: WorkspaceInfo): string | null {
  if (changer.mayChangeLayersIn(workspace.id)) return null;
  if (workspace.id !== VIEW_WORKSPACE) {
    return changer.mayRaiseIn(workspace.id) ? null : `You may not change these layers or their objects (${workspace.editPermission ?? ''}).`;
  }
  return changer.mayRaiseIn(workspace.id)
    ? "You may not change layers (layers.edit); you may raise their objects to a layer's classification."
    : 'You may not change layers or objects (layers.edit, objects.edit).';
}

const VIEW: WorkspaceInfo = { id: VIEW_WORKSPACE, name: 'View', order: -2147483648 };

export function LayersEntry({ layers, changer, retry, workspaces = [VIEW] }: {
  readonly layers: KnownLayers; readonly changer: LayerChanger; readonly retry?: unknown;
  /** The workspaces the user may see, View first (`ctx.workspaces`). */
  readonly workspaces?: readonly WorkspaceInfo[];
}) {
  const state = useSyncExternalStore(layers.subscribe, layers.getState);
  const changing = useSyncExternalStore(changer.subscribe, changer.getState);
  // Subscribes when first shown; until the plugins have loaded there is no channel yet, so it tries again when `retry` changes.
  useEffect(() => { void layers.ready(); }, [layers, retry]);
  const asking = changing.asking;
  const emptying = changing.emptying;
  const groups = workspaces.map((workspace) => ({ workspace, layers: state.layers.filter((l) => workspaceOf(l) === workspace.id) }));
  return (
    <section className="settings-section" aria-labelledby="settings-layers">
      <h2 id="settings-layers">Layers</h2>
      <p className="muted">
        A layer's classification, and on request its objects' lower classifications raised to it. Only the classification changes; for now
        labels do not limit who sees what. Each layer also lists its objects, and can be emptied with Delete all objects.
      </p>
      {state.error !== null && <Notice severity="error">The layers could not be read: {state.error}</Notice>}
      {!state.arrived && state.error === null && <p className="muted">Reading the layers…</p>}
      {state.arrived && groups.map(({ workspace, layers: inGroup }) => {
        const note = permissionNote(changer, workspace);
        const headingId = `settings-layers-${workspace.id.replace(/[^A-Za-z0-9-]/g, '-')}`;
        return (
          <section key={workspace.id} className="settings-group" aria-labelledby={groups.length > 1 ? headingId : 'settings-layers'}>
            {groups.length > 1 && <h3 id={headingId}>{workspace.name}</h3>}
            {note !== null && <Notice>{note}</Notice>}
            {inGroup.length === 0 && <p className="muted">There are no layers.</p>}
            {inGroup.map((layer) => (
              <LayerCard key={layer.id} layer={layer} objectCount={state.counts[layer.id] ?? 0} changer={changer} running={changing.running} />
            ))}
          </section>
        );
      })}
      {asking !== null && (
        <ConfirmDialog
          open
          title="Change layer classification"
          {...question(asking, state.counts[asking.layer.id] ?? 0)}
          danger={asking.raise}
          onConfirm={() => { void changer.confirm(); }}
          onCancel={() => { changer.cancel(); }}
        />
      )}
      {emptying !== null && (
        <ConfirmDialog
          open
          title="Delete all objects"
          message={`Delete all ${objects(state.counts[emptying.id] ?? 0)} in ${emptying.name}? This cannot be undone.`}
          confirmLabel="Delete all objects"
          danger
          onConfirm={() => { void changer.confirmEmpty(); }}
          onCancel={() => { changer.cancel(); }}
        />
      )}
    </section>
  );
}

/** What the admin has chosen in a card, for one version of its layer. */
interface Form {
  readonly version: number;
  readonly to: string;
  readonly raise: boolean;
}

function LayerCard({ layer, objectCount, changer, running }: {
  readonly layer: Layer; readonly objectCount: number; readonly changer: LayerChanger; readonly running: boolean;
}) {
  const choices = changer.choicesFor(layer);
  const current = layer.label.classification;
  const mayChange = changer.mayChangeLayersIn(workspaceOf(layer));
  const mayRaise = changer.mayRaiseIn(workspaceOf(layer));
  const mayEmpty = changer.mayEmptyIn(workspaceOf(layer));
  const [listing, setListing] = useState(false);
  // A new version of the layer (this change done, or one from elsewhere) starts the form afresh; the
  // card itself stays, so the page keeps its place (review F2).
  const [chosen, setChosen] = useState<Form | null>(null);
  const form: Form = chosen?.version === layer.version ? chosen : { version: layer.version, to: current, raise: false };
  const change = (part: Partial<Form>) => { setChosen({ ...form, ...part }); };
  // When this card's change is done, Apply is off (nothing left to do), so the focus goes to the card's heading.
  const heading = useRef<HTMLHeadingElement>(null);
  const askedHere = useRef(false);
  useEffect(() => {
    if (running || !askedHere.current || changer.getState().asking !== null || changer.getState().emptying !== null) return;
    askedHere.current = false;
    if (document.activeElement === null || document.activeElement === document.body) heading.current?.focus();
  }, [running, changer]);
  const apply = (to: string, raise: boolean) => {
    askedHere.current = true;
    changer.ask({ layer, to, raise });
  };
  const empty = () => {
    askedHere.current = true;
    changer.askEmpty(layer);
  };
  const headingId = `layer-${layer.id}`;
  return (
    <article className="settings-card" aria-labelledby={headingId}>
      <h3 id={headingId} ref={heading} tabIndex={-1}>{layer.name}</h3>
      <p className="muted">{labelText(layer)} · {count(objectCount)} {objectCount === 1 ? 'object' : 'objects'}</p>
      {layer.locked === true && (
        <p className="muted">This layer is locked. Unlock it in the Layers panel to change its classification or raise or delete its objects.</p>
      )}
      {layer.locked !== true && choices === null && (
        <p className="muted">
          No order of classifications is configured for {layer.label.policyIdentifier.name} {current}, so it cannot be changed here.
        </p>
      )}
      {layer.locked !== true && choices !== null && mayChange && (
        <div className="settings-inline">
          <Select
            label="Classification"
            value={form.to}
            options={choices.map((c) => ({ value: c, label: c === current ? `${c} (now)` : c }))}
            onChange={(to) => { change({ to }); }}
            disabled={running}
          />
          <Checkbox
            label={mayRaise ? 'Also raise objects below it' : 'Also raise objects below it (you may not change objects)'}
            checked={form.raise}
            onChange={(raise) => { change({ raise }); }}
            disabled={running || !mayRaise}
          />
          <Button variant="primary" disabled={running || (form.to === current && !form.raise)} onClick={() => { apply(form.to, form.raise); }}>
            Apply
          </Button>
        </div>
      )}
      {layer.locked !== true && choices !== null && !mayChange && mayRaise && (
        <div className="settings-inline">
          <Button disabled={running} onClick={() => { apply(current, true); }}>
            Raise objects below {current}
          </Button>
        </div>
      )}
      <div className="settings-inline">
        <Button expanded={listing} onClick={() => { setListing(!listing); }}>{listing ? 'Hide objects' : 'Show objects'}</Button>
        {mayEmpty && (
          <Button variant="danger" disabled={running || layer.locked === true || objectCount === 0} onClick={empty}>Delete all objects</Button>
        )}
      </div>
      {mayEmpty && layer.locked !== true && objectCount > 0 && (
        <p className="muted">Deleting all objects also deletes a data link's live tracks; they come back with their next report.</p>
      )}
      {listing && <ObjectList layer={layer} changer={changer} running={running} />}
    </article>
  );
}
