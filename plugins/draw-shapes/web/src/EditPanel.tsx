// The edit panel for one shape (brief, function 4). It is added when Edit opens it and removed when
// the selection changes to anything else. A field commits when it is committed (Enter, leaving
// the field, or a choice from a list), not on every keystroke; a field being typed in is not
// overwritten by a live update (function 7).
import { useState } from 'react';
import { Move, Plus, X } from 'lucide-react';
import { Button, choosableDataTypes, IconButton, Notice, PanelFoot, Select, TextField } from '@emc2/plugin-sdk';
import type { MapObject } from '@emc2/plugin-sdk';
import type { EditorState, ShapesController, ShapesState } from './controller.ts';
import { kindLabelOf, kindOf } from './content.ts';
import { isAppendable, isAreaGeometry, isReshapable } from './kinds.ts';
import { StyleForm } from './StyleForm.tsx';
import type { LineOptions } from './StyleForm.tsx';
import { choiceOf } from './style.ts';
import { useShapesState } from './useShapesState.ts';

export const NOT_IN_VIEW = 'Not in view';

/** "2026-10-15 09:00:00 UTC" for an RFC 3339 timestamp in UTC. */
export function formatTime(timestamp: string): string {
  return `${timestamp.replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, '')} UTC`;
}

/** Who last changed the object: the user if there is one, else the system or the plugin. */
export function modifiedBy(object: MapObject): string {
  const by = object.meta.modified.by;
  const who = by.user ?? by.system ?? by.plugin;
  return by.user !== undefined || by.system !== undefined ? `${who} (${by.plugin})` : who;
}

function lineOptionsOf(object: MapObject): LineOptions {
  if (object.geometry.type !== 'LineString') return 'none';
  const kind = kindOf(object);
  if (kind === 'arrow') return 'arrowhead';
  if (kind === 'route') return 'markers';
  return 'both';
}

/**
 * The panel's name is the shell's head (SDK 1.8.0, "name once"): no heading of its own here, and the Close
 * button that sat in one is the first thing in the body.
 */
export function EditPanel(props: { readonly controller: ShapesController }) {
  const { controller } = props;
  const state = useShapesState(controller);
  const editor = state.editor;
  return editor === null ? (
    <div className="draw-shapes-content">
      <p className="draw-shapes-hint">Select one shape on the map and choose Edit.</p>
    </div>
  ) : (
    <EditBody key={editor.id} state={state} editor={editor} controller={controller} />
  );
}

function CloseRow(props: { readonly controller: ShapesController }) {
  return (
    <div className="draw-shapes-close">
      <IconButton
        icon={X}
        label="Close"
        onClick={() => {
          props.controller.close();
        }}
      />
    </div>
  );
}

function EditBody(props: { readonly state: ShapesState; readonly editor: EditorState; readonly controller: ShapesController }) {
  const { state, editor, controller } = props;
  const object = editor.object;
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  if (object === null) {
    return (
      <div className="draw-shapes-content">
        <CloseRow controller={controller} />
        {editor.error !== null && (
          <>
            <Notice severity="error">{editor.error}</Notice>
            <Button
              onClick={() => {
                controller.retry();
              }}
            >
              Retry
            </Button>
          </>
        )}
        {editor.loading && <p className="draw-shapes-hint">Reading the shape from the server…</p>}
      </div>
    );
  }

  const disabled = state.readOnly || editor.notInWorkspace !== null || editor.locked !== null;
  const geometry = object.geometry;
  const reshapable = isReshapable(geometry);
  const running = editor.reshaping || editor.appending;
  // Why Reshape and Append are off, as their title (functions 12, 17 and 19): the permission, the workspace, the lock, the view.
  const offReason = state.readOnly ? state.hint : (editor.notInWorkspace ?? editor.locked ?? (editor.notInView ? 'Show the shape on the map first' : null));
  const commitName = () => {
    if (nameDraft === null) return;
    void controller.renameShape(object.id, nameDraft).then((ok) => {
      if (ok) setNameDraft(null);
    });
  };
  const layerKnown = state.layers.some((l) => l.id === object.layerId);
  const typeKnown = state.dataTypes.some((t) => t.id === object.dataType);

  return (
    <>
      <div className="draw-shapes-content">
        <CloseRow controller={controller} />
        {state.hint !== null && state.readOnly && <Notice severity="warning">{state.hint}</Notice>}
        {editor.notInWorkspace !== null && <Notice severity="warning">{editor.notInWorkspace}</Notice>}
        {editor.locked !== null && <Notice severity="warning">{editor.locked}</Notice>}
        {editor.notInView && (
          <>
            <Notice severity="info">{NOT_IN_VIEW}</Notice>
            <Button
              onClick={() => {
                void controller.showOnMap(object.id);
              }}
            >
              Show on map
            </Button>
          </>
        )}
        {editor.error !== null && <Notice severity="error">{editor.error}</Notice>}

        <dl className="draw-shapes-facts">
          <dt>Kind</dt>
          <dd>{kindLabelOf(object)}</dd>
        </dl>

        <TextField
          label="Name"
          value={nameDraft ?? object.properties?.name ?? ''}
          disabled={disabled}
          onChange={setNameDraft}
          onCommit={commitName}
        />

        <StyleForm
          value={choiceOf(object.style, state.settings.style)}
          area={isAreaGeometry(geometry)}
          lines={lineOptionsOf(object)}
          disabled={disabled}
          onChange={(patch) => controller.restyleShape(object.id, patch)}
        />

        <Select
          label="Layer"
          value={object.layerId}
          options={[...state.layers.map((l) => ({ value: l.id, label: l.name, ...(l.locked === true && l.id !== object.layerId ? { disabled: true } : {}) })), ...(layerKnown ? [] : [{ value: object.layerId, label: 'Unknown layer' }])]}
          disabled={disabled}
          onChange={(layerId) => {
            void controller.moveShapeToLayer(object.id, layerId);
          }}
        />
        <Select
          label="Data type"
          value={object.dataType}
          options={[...choosableDataTypes(state.dataTypes, object.dataType).map((t) => ({ value: t.id, label: t.name })), ...(typeKnown ? [] : [{ value: object.dataType, label: `${object.dataType} (not available)` }])]}
          disabled={disabled}
          onChange={(id) => {
            void controller.setShapeDataType(object.id, id);
          }}
        />

        {reshapable ? (
          <>
            {editor.reshaping && <p className="draw-shapes-hint">Move the shape or drag its handles on the map. Enter finishes, Escape cancels.</p>}
            {editor.appending && <p className="draw-shapes-hint">Click to add points after the last point. Double-click or Enter finishes, Escape cancels.</p>}
          </>
        ) : (
          <Notice severity="info">This kind of geometry cannot be reshaped here. Its properties can be edited.</Notice>
        )}

        <dl className="draw-shapes-facts">
          <dt>Classification</dt>
          <dd>{object.label.classification}</dd>
          <dt>Version</dt>
          <dd>{object.version}</dd>
          <dt>Last modified</dt>
          <dd>{`${formatTime(object.meta.modified.at)} by ${modifiedBy(object)}`}</dd>
          <dt>Data source</dt>
          <dd>{object.dataSource}</dd>
        </dl>
      </div>
      {/* Reshape and Append act on the whole shape: the panel's foot, last in the body (SDK 1.8.0, P5). */}
      {reshapable && (
        <PanelFoot>
          <Button
            icon={Move}
            disabled={disabled || editor.notInView || running}
            {...(offReason === null ? {} : { title: offReason })}
            onClick={() => {
              void controller.reshape(object.id);
            }}
          >
            Reshape
          </Button>
          {isAppendable(geometry) && (
            <Button
              icon={Plus}
              disabled={disabled || editor.notInView || running}
              {...(offReason === null ? {} : { title: offReason })}
              onClick={() => {
                void controller.append(object.id);
              }}
            >
              Append
            </Button>
          )}
        </PanelFoot>
      )}
    </>
  );
}
