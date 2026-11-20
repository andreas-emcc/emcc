import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronUp, Eye, EyeOff, Lock, LockOpen, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button, ConfirmDialog, IconButton, Notice, Select, TextField } from '@emc2/plugin-sdk';
import type { Layer, Uuid } from '@emc2/plugin-sdk';
import { CREATE, deleteKey, LOCKED_HINT, MAX_NAME_LENGTH, NO_LOCK_HINT, UPDATE, type LayerPanelController, type NewLayer, type PanelState } from './controller.ts';
import type { LayerState } from './layerState.ts';

/** The heading of the group of View's layers in a declared workspace (brief, function 20). */
export const REFERENCE_TITLE = 'View (reference)';

/** The panel "Layers": the layers of the workspace shown, top of the draw order first, and in a declared workspace View's layers as a reference. */
export function LayerPanel(props: { readonly controller: LayerPanelController }) {
  const { controller } = props;
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const [dragged, setDragged] = useState<Uuid | null>(null);
  // The layer whose delete waits for the user's confirmation (the shared dialog, owner 2026-10-21).
  const [confirming, setConfirming] = useState<Uuid | null>(null);
  // The new-layer dialog's start while it is open (brief, function 23).
  const [newLayer, setNewLayer] = useState<NewLayer | null>(null);
  const creating = state.pending.has(CREATE);
  const openNewLayer = () => {
    setNewLayer(controller.newLayer());
  };
  const newLayerDialog = newLayer === null ? null : (
    <NewLayerDialog
      start={newLayer}
      onCreate={(name, classification) => {
        setNewLayer(null);
        void controller.create(classification === undefined ? { name } : { name, classification });
      }}
      onCancel={() => {
        setNewLayer(null);
      }}
    />
  );
  // Without the workspace's permission the panel is read only: the hint says why (brief, functions 10 and 18).
  const readOnlyHint = state.canEdit ? null : <Notice>{state.noEditHint}.</Notice>;
  // Without it the create buttons say why they are disabled.
  const createTitle = state.canEdit ? {} : { title: state.noEditHint };
  const reference = state.reference === null ? null : <ReferenceGroup reference={state.reference} state={state} controller={controller} />;
  const toDelete = confirming === null ? undefined : state.layers.find((l) => l.id === confirming);

  if (!state.loaded) {
    return (
      <div className="layer-panel">
        <p className="layer-panel-hint">Waiting for the live picture…</p>
      </div>
    );
  }

  if (state.layers.length === 0) {
    return (
      <div className="layer-panel">
        <p className="layer-panel-hint">There are no layers.</p>
        <div className="layer-panel-toolbar">
          <Button icon={Plus} {...createTitle} disabled={creating || !state.canEdit} onClick={openNewLayer}>
            Create first layer
          </Button>
        </div>
        {readOnlyHint}
        {reference}
        {newLayerDialog}
      </div>
    );
  }

  return (
    <div className="layer-panel">
      {/* Stays at the top while the list scrolls, also in a low pane. */}
      <div className="layer-panel-toolbar layer-panel-toolbar-fixed">
        <Button icon={Plus} {...createTitle} disabled={creating || !state.canEdit} onClick={openNewLayer}>
          New layer
        </Button>
      </div>
      {readOnlyHint}
      {state.mapView !== 'ready' && (
        <Notice severity={state.mapView === 'waiting' ? 'info' : 'warning'}>
          {state.mapView === 'waiting' ? 'Waiting for the map view.' : 'The map view is not available.'} Visibility and the active layer cannot be changed.
        </Notice>
      )}
      <ul className="layer-panel-list" aria-label="Layers">
        {state.layers.map((layer, index) => (
          <LayerRow
            key={layer.id}
            layer={layer}
            index={index}
            state={state}
            controller={controller}
            onDelete={() => {
              setConfirming(layer.id);
            }}
            onDragStart={() => {
              setDragged(layer.id);
            }}
            onDrop={() => {
              if (dragged !== null) void controller.move(dragged, index);
              setDragged(null);
            }}
            onDragEnd={() => {
              // Also after a cancelled drag (Escape, or dropped outside the list): forget the layer.
              setDragged(null);
            }}
          />
        ))}
      </ul>
      {reference}
      {newLayerDialog}
      {/* Closes by itself when the layer disappears meanwhile; an object added meanwhile makes the server refuse the delete, which is notified. */}
      <ConfirmDialog
        open={toDelete !== undefined}
        title="Delete layer"
        message={toDelete === undefined ? '' : `Delete the empty layer "${toDelete.name}"?`}
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          setConfirming(null);
          if (toDelete !== undefined) void controller.remove(toDelete.id);
        }}
        onCancel={() => {
          setConfirming(null);
        }}
      />
    </div>
  );
}

interface RowProps {
  readonly layer: Layer;
  readonly index: number;
  readonly state: PanelState;
  readonly controller: LayerPanelController;
  readonly onDelete: () => void;
  readonly onDragStart: () => void;
  readonly onDrop: () => void;
  readonly onDragEnd: () => void;
}

/** Whether a pointer event came from one of the row's buttons or its name field, which handle it themselves. */
function onControl(target: EventTarget): boolean {
  return target instanceof Element && target.closest('button, input') !== null;
}

function LayerRow({ layer, index, state, controller, onDelete, onDragStart, onDrop, onDragEnd }: RowProps) {
  const [editing, setEditing] = useState(false);
  const count = state.counts.get(layer.id) ?? 0;
  const active = state.activeLayer === layer.id;
  const mapReady = state.mapView === 'ready';
  const { canEdit } = state;
  // A locked layer keeps its name and stays (brief, function 22); its draw order may still change.
  const locked = layer.locked === true;
  const canChange = canEdit && !locked;
  const changeHint = (title: string) => (!canEdit ? state.noEditHint : locked ? LOCKED_HINT : title);
  const moving = state.pending.has(UPDATE);
  const deleting = state.pending.has(deleteKey(layer.id));
  const objects = `${String(count)} ${count === 1 ? 'object' : 'objects'}`;
  const deleteHint = count > 0 ? `${layer.name} has ${objects}: only empty layers can be deleted` : `Delete ${layer.name}`;

  return (
    <li
      className={active ? 'layer-panel-row layer-panel-row-active' : 'layer-panel-row'}
      aria-current={active ? 'true' : undefined}
      draggable={canEdit && !editing}
      onDragStart={(e) => {
        // Some browsers start a drag only with data set; jsdom has no DataTransfer at all.
        (e.dataTransfer as DataTransfer | null)?.setData('text/plain', layer.id);
        onDragStart();
      }}
      onDragOver={(e) => {
        // Allows the drop; without layers.edit nothing can be dropped.
        if (canEdit) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
      // A click anywhere on the row makes the layer active (brief, function 4); a double-click opens
      // its objects, also for a hidden layer and without layers.edit (function 12). Not on the row's
      // buttons or the name field.
      onClick={(e) => {
        if (!onControl(e.target)) controller.activate(layer.id);
      }}
      onDoubleClick={(e) => {
        if (!onControl(e.target)) controller.openObjects(layer.id);
      }}
    >
      <EyeButton layer={layer} state={state} controller={controller} />
      <LockButton layer={layer} state={state} controller={controller} />

      {editing ? (
        <NameEditor
          name={layer.name}
          onDone={(name) => {
            setEditing(false);
            if (name !== null) void controller.rename(layer.id, name);
          }}
        />
      ) : (
        // Not a <button>: Chrome starts no drag of the row when the press lands on a button, and
        // the name is where users grab a row. Role, focus and keys make it work like one; its click
        // is the row's.
        <span
          role="button"
          tabIndex={0}
          className="layer-panel-name"
          aria-label={`Make ${layer.name} active`}
          aria-pressed={active}
          title={nameTitle(mapReady, canEdit, locked, state.canOpenObjects, state.noEditHint)}
          // Space makes the layer active (on key up, like a native button; its key down only stops
          // the page from scrolling). Enter opens its objects, as a double-click does, and F2
          // renames (owner, 2026-10-17). Held keys and Ctrl/Alt/Meta combinations do nothing.
          onKeyDown={(e) => {
            if (e.ctrlKey || e.altKey || e.metaKey) return;
            if (e.key === ' ') {
              e.preventDefault();
            } else if (e.key === 'Enter' || (e.key === 'F2' && canChange)) {
              e.preventDefault();
              if (e.repeat) return;
              if (e.key === 'Enter') controller.openObjects(layer.id);
              else setEditing(true);
            }
          }}
          onKeyUp={(e) => {
            if (e.key === ' ' && !(e.ctrlKey || e.altKey || e.metaKey)) controller.activate(layer.id);
          }}
        >
          {layer.name}
        </span>
      )}

      <span className="layer-panel-actions">
        <IconButton
          icon={ChevronUp}
          label={`Move ${layer.name} up`}
          title={canEdit ? 'Move up' : state.noEditHint}
          disabled={!canEdit || index === 0 || moving}
          onClick={() => void controller.move(layer.id, index - 1)}
        />
        <IconButton
          icon={ChevronDown}
          label={`Move ${layer.name} down`}
          title={canEdit ? 'Move down' : state.noEditHint}
          disabled={!canEdit || index === state.layers.length - 1 || moving}
          onClick={() => void controller.move(layer.id, index + 1)}
        />
        <IconButton
          icon={Pencil}
          label={`Rename ${layer.name}`}
          title={changeHint('Rename')}
          disabled={!canChange}
          onClick={() => {
            setEditing(true);
          }}
        />
        <IconButton
          icon={Trash2}
          label={`Delete ${layer.name}`}
          title={changeHint(deleteHint)}
          disabled={!canChange || count > 0 || deleting}
          onClick={onDelete}
        />
      </span>

      <Meta layer={layer} objects={objects} wide />
    </li>
  );
}

/**
 * View's layers in a declared workspace, under the workspace's own (brief, function 20): one group
 * with a heading, in View's order. Each row has the name, the classification, the count and the
 * eye, which is the visibility in the workspace shown (`map-view-2d` function 23). Nothing else: no
 * active marker, and a click, Space, a double-click and Enter do nothing.
 */
function ReferenceGroup({ reference, state, controller }: { readonly reference: LayerState; readonly state: PanelState; readonly controller: LayerPanelController }) {
  const heading = useId();
  return (
    <div className="layer-panel-reference" role="group" aria-labelledby={heading}>
      <h3 id={heading} className="layer-panel-heading">
        {REFERENCE_TITLE}
      </h3>
      {!reference.loaded ? (
        <p className="layer-panel-hint">Waiting for View's layers…</p>
      ) : reference.layers.length === 0 ? (
        <p className="layer-panel-hint">No layers in View</p>
      ) : (
        <ul className="layer-panel-list" aria-label={REFERENCE_TITLE}>
          {reference.layers.map((layer) => {
            const count = reference.counts.get(layer.id) ?? 0;
            return (
              <li key={layer.id} className="layer-panel-row layer-panel-row-reference">
                <EyeButton layer={layer} state={state} controller={controller} />
                <span className="layer-panel-name layer-panel-name-reference">{layer.name}</span>
                <Meta layer={layer} objects={`${String(count)} ${count === 1 ? 'object' : 'objects'}`} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** The eye: the layer's local visibility in this browser (brief, function 3), in the workspace shown. */
function EyeButton({ layer, state, controller }: { readonly layer: Layer; readonly state: PanelState; readonly controller: LayerPanelController }) {
  const visible = !state.hidden.has(layer.id);
  return (
    <span className="layer-panel-eye">
      <IconButton
        icon={visible ? Eye : EyeOff}
        label={visible ? `Hide ${layer.name}` : `Show ${layer.name}`}
        title={visible ? 'Hide in this browser' : 'Show in this browser'}
        pressed={!visible}
        disabled={state.mapView !== 'ready'}
        onClick={() => {
          controller.toggleVisible(layer.id);
        }}
      />
    </span>
  );
}

/**
 * The lock beside the eye: the layer's stored lock, one value for every user and browser (brief,
 * function 22). Without the permission to change the layer it shows the state, switched off.
 */
function LockButton({ layer, state, controller }: { readonly layer: Layer; readonly state: PanelState; readonly controller: LayerPanelController }) {
  const locked = layer.locked === true;
  return (
    <span className="layer-panel-eye">
      <IconButton
        icon={locked ? Lock : LockOpen}
        label={locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`}
        title={!state.canEdit ? NO_LOCK_HINT : locked ? 'Unlock layer' : 'Lock layer'}
        pressed={locked}
        disabled={!state.canEdit || state.pending.has(UPDATE)}
        onClick={() => void controller.setLocked(layer.id, !locked)}
      />
    </span>
  );
}

/** The second line of a row: the classification of the layer's label and its number of objects; `wide` past the eye and the lock. */
function Meta({ layer, objects, wide = false }: { readonly layer: Layer; readonly objects: string; readonly wide?: boolean }) {
  return (
    <span className={wide ? 'layer-panel-meta layer-panel-meta-wide' : 'layer-panel-meta'}>
      <span title="Classification of the layer's label">{layer.label.classification}</span>
      {' · '}
      <span className="layer-panel-count">{objects}</span>
    </span>
  );
}

/** The name's tooltip: what clicking, double-clicking, F2 and dragging do for this user; a locked layer is not renamed. */
function nameTitle(mapReady: boolean, canEdit: boolean, locked: boolean, canOpenObjects: boolean, noEditHint: string): string {
  const parts = [
    mapReady ? 'Click to make active' : null,
    canOpenObjects ? 'double-click to open its objects' : null,
    canEdit ? (locked ? 'drag to move' : 'F2 to rename, drag to move') : null,
  ].filter((p) => p !== null);
  if (parts.length === 0) return noEditHint;
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * "New layer" (brief, function 23): the name, "Layer N" at the start, and with an order the
 * classification, the default label's chosen. The shared dialog cannot disable its confirm button,
 * so Create with an empty name sends nothing, keeps the dialog open and says why under the field
 * (owner, 2026-11-11). Cancel and Escape send nothing.
 */
function NewLayerDialog(props: {
  readonly start: NewLayer;
  readonly onCreate: (name: string, classification: string | undefined) => void;
  readonly onCancel: () => void;
}) {
  const { start } = props;
  const [name, setName] = useState(start.name);
  const [classification, setClassification] = useState(start.classification);
  const empty = name.trim() === '';
  const choose = start.classifications.length > 0;
  return (
    <ConfirmDialog
      open
      title="New layer"
      message={
        <div className="layer-panel-new">
          <TextField label="Name" value={name} onChange={setName} spellCheck={false} {...(empty ? { error: 'Enter a name' } : {})} />
          {choose && (
            <Select label="Classification" value={classification} options={start.classifications.map((c) => ({ value: c, label: c }))} onChange={setClassification} />
          )}
        </div>
      }
      confirmLabel="Create"
      onConfirm={() => {
        if (!empty) props.onCreate(name, choose ? classification : undefined);
      }}
      onCancel={props.onCancel}
    />
  );
}

/** Inline name editing: Enter commits, Escape cancels (null). Leaving the field commits. The old name starts selected, so typing replaces it. */
function NameEditor(props: { readonly name: string; readonly onDone: (name: string | null) => void }) {
  const [value, setValue] = useState(props.name);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.select();
  }, []);
  // A ref, not state: Enter or Escape and the blur that follows may come in the same tick.
  const done = useRef(false);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    props.onDone(name);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') finish(value);
    else if (e.key === 'Escape') finish(null);
  };
  return (
    <input
      ref={input}
      className="layer-panel-name-input"
      aria-label={`New name for ${props.name}`}
      value={value}
      maxLength={MAX_NAME_LENGTH}
      autoFocus
      onChange={(e) => {
        setValue(e.target.value);
      }}
      onKeyDown={onKeyDown}
      onBlur={() => {
        finish(value);
      }}
    />
  );
}
