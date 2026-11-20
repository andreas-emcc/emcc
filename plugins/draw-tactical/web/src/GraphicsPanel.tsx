// The Graphics panel (brief, function 1): what the next graphic is, and its tool. It works in every
// pane: content wraps, nothing has a fixed size. It asks the symbology service for the catalogue when it is
// first shown, not when the plugin starts, so the renderer loads only for someone who looks at it.
import { useEffect } from 'react';
import { Crosshair } from 'lucide-react';
import { Button, Notice, PanelFoot, PanelFrame, Select, TextField } from '@emc2/plugin-sdk';
import type { GraphicCatalogEntry, ModifierName } from '@emc2/plugin-sdk';
import { AmplifierFields } from './AmplifierFields.tsx';
import type { GraphicsController, GraphicsState } from './controller.ts';
import { GraphicPicker } from './GraphicPicker.tsx';
import { pointCountText, pointGuide } from './graphics.ts';
import { STATUSES } from './sidc.ts';
import { useGraphicsState } from './useGraphicsState.ts';

/** How the user places a kind of graphic on the map. */
export function placingHint(entry: GraphicCatalogEntry): string {
  switch (entry.kind) {
    case 'points':
      return `Placing ${entry.name}: click its point on the map. Escape cancels.`;
    case 'area':
      return `Placing ${entry.name}: click its points on the map in the order shown; double-click or Enter finishes, a right click takes back a point, Escape cancels.`;
    case 'line':
    case 'arrow':
      return `Placing ${entry.name}: click its points on the map in the order shown; double-click or Enter finishes, a right click takes back a point, Escape cancels.`;
  }
}

function Chosen(props: { readonly controller: GraphicsController; readonly state: GraphicsState; readonly entry: GraphicCatalogEntry }) {
  const { controller, state, entry } = props;
  const guide = pointGuide(entry);
  return (
    <section className="draw-tactical-chosen" aria-label="The chosen graphic">
      <h3 className="draw-tactical-group-title">{entry.name}</h3>
      <p className="draw-tactical-hint">{`${pointCountText(entry)}, in this order:`}</p>
      <ul className="draw-tactical-points">
        {guide.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      {entry.echelon && (
        <Select
          label="Echelon"
          value={state.next.echelon}
          options={state.echelons.map((e) => ({ value: e.code, label: e.name }))}
          disabled={state.readOnly}
          onChange={(code) => {
            controller.setEchelon(code);
          }}
        />
      )}
      {entry.allowedModifiers.length > 0 && (
        <AmplifierFields
          entry={entry}
          drafts={state.drafts}
          problems={state.amplifiers?.problems ?? {}}
          disabled={state.readOnly}
          onChange={(name: ModifierName, value) => {
            controller.setDraft(name, value);
          }}
        />
      )}
    </section>
  );
}

/** The button that starts and stops the tool. It is shown at the top of the panel and in its foot, the same control twice (T-190, T-204). */
function PlaceButton(props: { readonly controller: GraphicsController; readonly state: GraphicsState }) {
  const { controller, state } = props;
  return (
    <Button
      icon={Crosshair}
      variant={state.tool ? 'primary' : 'normal'}
      disabled={!state.tool && (!state.canDraw || state.toolTitle !== null)}
      title={state.tool ? 'Stop placing' : (state.lockedTitle ?? state.toolTitle ?? state.hint ?? 'Place the chosen graphic on the map')}
      onClick={() => {
        controller.setTool(!state.tool);
      }}
    >
      {state.tool ? 'Stop placing' : 'Place graphic'}
    </Button>
  );
}

export function GraphicsPanel(props: { readonly controller: GraphicsController }) {
  const { controller } = props;
  const state = useGraphicsState(controller);
  useEffect(() => {
    controller.ensureCatalogue();
  }, [controller]);
  const { catalogue, entry } = state;

  return (
    // The shell's head shows the title once, so the frame draws none (SDK 1.8.0 part C and G, name once); the Place
    // button in the foot is full width and pinned at the bottom of the panel.
    <PanelFrame
      title="Graphics"
      heading={false}
      foot={
        <PanelFoot>
          <PlaceButton controller={controller} state={state} />
        </PanelFoot>
      }
    >
      <div className="draw-tactical-content">
        <PlaceButton controller={controller} state={state} />
        {state.hint !== null && <Notice severity="warning">{state.hint}</Notice>}
        <div className="draw-tactical-row">
          <Select
            label="Identity"
            value={state.next.standardIdentity}
            options={state.identities.map((i) => ({ value: i.code, label: i.name }))}
            disabled={state.readOnly}
            onChange={(code) => {
              controller.setIdentity(code);
            }}
          />
          <Select
            label="Status"
            value={state.next.status}
            options={STATUSES.map((s) => ({ value: s.code, label: s.label }))}
            disabled={state.readOnly}
            onChange={(code) => {
              controller.setStatus(code);
            }}
          />
        </div>

        {catalogue.status === 'failed' && (
          <>
            <Notice severity="error">{`The graphics could not be read: ${catalogue.error ?? 'unknown error'}`}</Notice>
            <Button
              onClick={() => {
                controller.retryCatalogue();
              }}
            >
              Retry
            </Button>
          </>
        )}
        {(catalogue.status === 'loading' || catalogue.status === 'idle') && <p className="draw-tactical-hint">Reading the graphics…</p>}
        {catalogue.status === 'ready' && (
          <GraphicPicker
            controller={controller}
            catalogue={catalogue.entries}
            chosen={entry}
            onChoose={(key) => {
              controller.chooseGraphic(key);
            }}
          />
        )}

        {entry !== null && <Chosen controller={controller} state={state} entry={entry} />}

        <TextField
          label="Name"
          value={state.name}
          placeholder="Shown as the label"
          disabled={state.readOnly}
          onChange={(name) => {
            controller.setName(name);
          }}
        />

        {state.tool && entry !== null && <p className="draw-tactical-hint">{placingHint(entry)}</p>}
      </div>
    </PanelFrame>
  );
}
