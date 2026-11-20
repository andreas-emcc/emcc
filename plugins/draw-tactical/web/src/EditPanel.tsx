// The edit panel for one graphic (brief, function 6). It is added when Edit opens it and removed when
// the selection changes to anything else. A field commits when it is committed (Enter, leaving
// the field, or a choice from a list), not on every keystroke; a field being typed in is not
// overwritten by a live update (as draw-shapes, function 7).
import { useState } from 'react';
import { Move, X } from 'lucide-react';
import { Button, IconButton, Notice, PanelFrame, Select, TextField } from '@emc2/plugin-sdk';
import type { MapObject, ModifierName, SymbolService } from '@emc2/plugin-sdk';
import { AmplifierFields } from './AmplifierFields.tsx';
import { checkAmplifiers, draftsOf, foreignAmplifiers } from './amplifiers.ts';
import type { AmplifierDrafts } from './amplifiers.ts';
import type { EditorState, GraphicsController, GraphicsState } from './controller.ts';
import { NOT_DRAWN } from './controller.ts';
import { isGraphicStandard } from './graphics.ts';
import { identityOptions, partsOfSidc, STATUSES } from './sidc.ts';
import { useGraphicsState } from './useGraphicsState.ts';

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

export function EditPanel(props: { readonly controller: GraphicsController; readonly symbols: SymbolService }) {
  const { controller } = props;
  const state = useGraphicsState(controller);
  const editor = state.editor;
  return (
    // The shell's head shows the title once, so the frame draws none (SDK 1.8.0 part G); the Close button stays in the
    // frame's action bar, on the right, as it sat in the heading before. With no editor there are no actions at all:
    // the frame draws a bar for any `actions` that is not undefined, even a null one, hence the conditional spread.
    <PanelFrame
      title="Edit graphic"
      heading={false}
      {...(editor === null
        ? {}
        : {
            actions: (
              <IconButton
                icon={X}
                label="Close"
                onClick={() => {
                  controller.close();
                }}
              />
            ),
          })}
    >
      {editor === null ? (
        <p className="draw-tactical-hint">Select one tactical graphic on the map and choose Edit.</p>
      ) : (
        <EditBody key={editor.id} state={state} editor={editor} controller={controller} symbols={props.symbols} />
      )}
    </PanelFrame>
  );
}

function EditBody(props: { readonly state: GraphicsState; readonly editor: EditorState; readonly controller: GraphicsController; readonly symbols: SymbolService }) {
  const { state, editor, controller, symbols } = props;
  const object = editor.object;
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<AmplifierDrafts>({});

  if (object === null) {
    return (
      <div className="draw-tactical-content">
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
        {editor.loading && <p className="draw-tactical-hint">Reading the graphic from the server…</p>}
      </div>
    );
  }

  const disabled = state.readOnly || editor.notInWorkspace !== null || editor.locked !== null;
  const entry = editor.entry;
  const symbol = object.symbol;
  const standard = symbol?.standard;
  const parts = symbol === undefined || !isGraphicStandard(standard) ? null : partsOfSidc(symbols, standard, symbol.sidc);
  const commitName = () => {
    if (nameDraft === null) return;
    void controller.renameGraphic(object.id, nameDraft).then((ok) => {
      if (ok) setNameDraft(null);
    });
  };
  const layerKnown = state.layers.some((l) => l.id === object.layerId);

  // The amplifiers the graphic allows show the object's values until the user types; a commit sends them.
  const shown: AmplifierDrafts = entry === null ? {} : { ...draftsOf(entry, symbol?.modifiers), ...drafts };
  const problems = entry === null ? {} : checkAmplifiers(entry, shown).problems;
  const commitAmplifier = (name: ModifierName, value: string | readonly string[]) => {
    if (entry === null || problems[name] !== undefined) return;
    const current = draftsOf(entry, symbol?.modifiers)[name];
    if (JSON.stringify(current ?? '') === JSON.stringify(value) || (current === undefined && (value === '' || (Array.isArray(value) && value.every((r) => r === '')))))
      return; // nothing changed
    void controller.setGraphicAmplifier(object.id, name, value).then((ok) => {
      if (ok) setDrafts((before) => Object.fromEntries(Object.entries(before).filter(([n]) => n !== name)));
    });
  };
  const foreign = entry === null ? [] : foreignAmplifiers(entry, symbol?.modifiers);

  return (
    <div className="draw-tactical-content">
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

      <dl className="draw-tactical-facts">
        <dt>Graphic</dt>
        <dd>{entry?.name ?? (symbol === undefined ? 'No symbol' : `Code ${symbol.sidc}`)}</dd>
        <dt>Standard</dt>
        <dd>{symbol?.standard ?? '–'}</dd>
      </dl>
      {entry === null && (editor.catalogueLoading ? <p className="draw-tactical-hint">Reading the graphics…</p> : <Notice severity="info">{NOT_DRAWN}</Notice>)}

      <TextField label="Name" value={nameDraft ?? object.properties?.name ?? ''} disabled={disabled} onChange={setNameDraft} onCommit={commitName} />

      {entry !== null && parts !== null && (
        <>
          <Select
            label="Identity"
            value={parts.standardIdentity}
            options={identityOptions(symbols, parts.standardIdentity).map((i) => ({ value: i.code, label: i.name }))}
            disabled={disabled}
            onChange={(code) => {
              void controller.changeSidc(object.id, 'change the identity', { standardIdentity: code });
            }}
          />
          <Select
            label="Status"
            value={parts.status}
            options={[...STATUSES.map((s) => ({ value: s.code, label: s.label })), ...(STATUSES.some((s) => s.code === parts.status) ? [] : [{ value: parts.status, label: `Status ${parts.status}` }])]}
            disabled={disabled}
            onChange={(code) => {
              void controller.changeSidc(object.id, 'change the status', { status: code });
            }}
          />
          {entry.echelon && (
            <Select
              label="Echelon"
              value={parts.echelonMobility}
              options={[
                ...state.echelons.map((e) => ({ value: e.code, label: e.name })),
                ...(state.echelons.some((e) => e.code === parts.echelonMobility) ? [] : [{ value: parts.echelonMobility, label: `Echelon ${parts.echelonMobility}` }]),
              ]}
              disabled={disabled}
              onChange={(code) => {
                void controller.changeSidc(object.id, 'change the echelon', { echelonMobility: code });
              }}
            />
          )}
        </>
      )}

      {entry !== null && entry.allowedModifiers.length > 0 && (
        <AmplifierFields
          entry={entry}
          drafts={shown}
          problems={problems}
          disabled={disabled}
          onChange={(name, value) => {
            setDrafts((before) => ({ ...before, [name]: value }));
          }}
          onCommit={commitAmplifier}
        />
      )}
      {foreign.length > 0 && (
        <dl className="draw-tactical-facts" aria-label="Amplifiers this graphic does not use">
          {foreign.flatMap((f) => [<dt key={`${f.name}-name`}>{f.name}</dt>, <dd key={`${f.name}-text`}>{f.text}</dd>])}
        </dl>
      )}

      <Select
        label="Layer"
        value={object.layerId}
        options={[...state.layers.map((l) => ({ value: l.id, label: l.name, ...(l.locked === true && l.id !== object.layerId ? { disabled: true } : {}) })), ...(layerKnown ? [] : [{ value: object.layerId, label: 'Unknown layer' }])]}
        disabled={disabled}
        onChange={(layerId) => {
          void controller.moveGraphicToLayer(object.id, layerId);
        }}
      />

      {entry !== null && (
        <>
          <Button
            icon={Move}
            disabled={disabled || editor.notInView || editor.reshaping}
            {...(editor.notInView ? { title: 'Show the graphic on the map first' } : {})}
            onClick={() => {
              void controller.reshape(object.id);
            }}
          >
            Reshape
          </Button>
          {editor.reshaping && <p className="draw-tactical-hint">Move the graphic or drag its control points on the map. Enter finishes, Escape cancels.</p>}
        </>
      )}

      <dl className="draw-tactical-facts">
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
  );
}
