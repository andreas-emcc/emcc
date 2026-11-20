// The Routes panel (brief function 22): the routes with their state, why one cannot run, the
// controls per route and for all, each route's end behaviour, in the user's units (function 8).
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Pause, Pencil, Play, Plus, RotateCcw } from 'lucide-react';
import { Button, ColorField, IconButton, Notice, Select } from '@emc2/plugin-sdk';
import { SimPanel } from './SimPanel.tsx';
import type { RouteColourModel } from './colour.ts';
import type { RouteEditorModel } from './editor.ts';
import { FailureNotice } from './FailureNotice.tsx';
import { useModel } from './model.ts';
import { EDIT_HINT, lockedHint, RUN_HINT } from './permissions.ts';
import type { Rights } from './permissions.ts';
import type { RouteObject, SimulationPicture } from './picture.ts';
import type { RouteInfo, RouteProblem, RoutesModel, RunState } from './routes.ts';
import { formatDuration, formatLength, formatSpeed } from './units.ts';
import type { Units } from './units.ts';
import type { UnitsModel } from './unitsModel.ts';
import { UnitFields } from './UnitFields.tsx';

const STATE_LABELS: Readonly<Record<RunState, string>> = { running: 'Running', paused: 'Paused', ended: 'At its end' };

const END_OPTIONS = [
  { value: 'stop', label: 'Stop' },
  { value: 'restart', label: 'Restart' },
] as const;

export function problemText(p: RouteProblem): string {
  return p.point === null ? p.message : `Point ${String(p.point + 1)}: ${p.message}`;
}

export function RoutesPanel(props: {
  readonly model: RoutesModel;
  readonly editor: RouteEditorModel;
  readonly colour: RouteColourModel;
  readonly picture: SimulationPicture;
  readonly units: UnitsModel;
  readonly rights: Rights;
}) {
  const { model, editor, picture, rights } = props;
  useModel(editor);
  const state = useModel(model);
  const units = useModel(props.units);
  useSyncExternalStore(picture.onChange, picture.revision);
  useEffect(() => model.watch(), [model]);

  const runTitle = (label: string) => (rights.run ? label : RUN_HINT);
  const all = (
    <>
      <IconButton icon={Play} label="Start all routes" title={runTitle('Start all routes')} disabled={!rights.run || state.busy} onClick={() => void model.control('start', null)} />
      <IconButton icon={Pause} label="Pause all routes" title={runTitle('Pause all routes')} disabled={!rights.run || state.busy} onClick={() => void model.control('pause', null)} />
      <IconButton icon={RotateCcw} label="Reset all routes" title={runTitle('Reset all routes')} disabled={!rights.run || state.busy} onClick={() => void model.control('reset', null)} />
    </>
  );
  const objects = new Map(picture.routes().map((r) => [r.object.id, r]));

  return (
    <SimPanel label="Routes" actions={all}>
      <div className="simulator-panel">
        <UnitFields units={props.units} />
        <NewRoute editor={editor} rights={rights} />
        <RouteColour model={props.colour} rights={rights} />
        {rights.edit ? null : <Notice>{EDIT_HINT}</Notice>}
        {state.readError === null ? null : <Notice severity="warning">{state.readError}</Notice>}
        <FailureNotice failure={state.failure} onDismiss={() => { model.dismissFailure(); }} />
        {state.routes === null ? (
          state.readError === null ? <p className="simulator-muted">Loading the routes…</p> : null
        ) : state.routes.length === 0 ? (
          <p className="simulator-muted">No routes in Simulation yet.</p>
        ) : (
          <>
            <p className="simulator-muted">{state.running ? 'The simulation runs.' : 'Everything is paused.'}</p>
            <ul className="simulator-list" aria-label="Routes">
              {state.routes.map((route) => (
                <RouteRow key={route.id} route={route} object={objects.get(route.id)} picture={picture} model={model} editor={editor} units={units} rights={rights} busy={state.busy} />
              ))}
            </ul>
          </>
        )}
      </div>
    </SimPanel>
  );
}

/** "New route" (A35, A36): draws a line into the active Simulation layer. */
function NewRoute(props: { readonly editor: RouteEditorModel; readonly rights: Rights }) {
  const { editor, rights } = props;
  const problem = rights.edit ? editor.newRouteProblem() : EDIT_HINT;
  const drawing = editor.getState().interaction === 'draw';
  return (
    <div className="simulator-actions">
      <Button icon={Plus} disabled={problem !== null || drawing} title={problem ?? 'Draw a new route on the map'} onClick={() => void editor.newRoute()}>
        New route
      </Button>
      {problem === null || !rights.edit ? null : <span className="simulator-muted">{problem}</span>}
    </div>
  );
}

/**
 * The routes' colour (T-088, BE a, A62): sent when the picker closes or a typed colour is committed,
 * not while the user drags in the picker.
 */
function RouteColour(props: { readonly model: RouteColourModel; readonly rights: Rights }) {
  const { model, rights } = props;
  const state = useModel(model);
  const [draft, setDraft] = useState<string | null>(null);
  // The colour as picked, for the second commit of one edit (Enter, then blur), which must not send again.
  const picked = useRef<string | null>(null);
  return (
    <div className="simulator-section" {...(rights.edit ? {} : { title: EDIT_HINT })}>
      <ColorField
        label="Route colour"
        value={draft ?? model.colour()}
        disabled={!rights.edit || state.busy}
        onChange={(colour) => {
          picked.current = colour;
          setDraft(colour);
        }}
        onCommit={() => {
          const colour = picked.current;
          picked.current = null;
          setDraft(null);
          if (colour !== null && colour !== model.colour()) void model.choose(colour);
        }}
      />
      <FailureNotice failure={state.failure} onDismiss={() => { model.dismissFailure(); }} />
    </div>
  );
}

function RouteRow(props: {
  readonly route: RouteInfo;
  readonly object: RouteObject | undefined;
  readonly picture: SimulationPicture;
  readonly model: RoutesModel;
  readonly editor: RouteEditorModel;
  readonly units: Units;
  readonly rights: Rights;
  readonly busy: boolean;
}) {
  const { route, object, model, editor, units, rights, busy } = props;
  const name = object?.name ?? route.name;
  const mean = route.lengthMetres !== null && route.durationSeconds !== null && route.durationSeconds > 0 ? route.lengthMetres / route.durationSeconds : null;
  const count = route.objects.length;
  const runTitle = (label: string) => (rights.run ? label : RUN_HINT);
  const startTitle = !rights.run ? RUN_HINT : route.runnable ? `Start ${name}` : `${name} cannot run`;
  // A route in a locked layer is read only for everyone (function 25, A82).
  const locked = object === undefined ? null : props.picture.lockedLayer(object.object.layerId);
  const endTitle = !rights.edit ? EDIT_HINT : object === undefined ? 'The route is not in the live picture yet' : locked !== null ? lockedHint(locked.name) : undefined;
  return (
    <li className="simulator-item" aria-label={name}>
      <div className="simulator-item-head">
        <span className="simulator-item-name">{name}</span>
        <IconButton icon={Pencil} label={rights.edit ? `Edit ${name}` : `Open ${name}`} onClick={() => { editor.open(route.id); }} />
        <span className={`simulator-state simulator-state-${route.state}`}>{STATE_LABELS[route.state]}</span>
      </div>
      <div className="simulator-data simulator-muted">
        {count === 1 ? '1 object' : `${String(count)} objects`} · {formatLength(route.lengthMetres, units.altitude)} · {formatDuration(route.durationSeconds)} · mean{' '}
        {formatSpeed(mean, units.speed)}
      </div>
      {route.runnable ? null : (
        <Notice severity="warning">
          <span>Cannot run:</span>
          <ul className="simulator-problems">
            {route.problems.map((p, i) => (
              <li key={i}>{problemText(p)}</li>
            ))}
          </ul>
        </Notice>
      )}
      <div className="simulator-item-controls">
        <IconButton icon={Play} label={`Start ${name}`} title={startTitle} disabled={!rights.run || busy || !route.runnable} onClick={() => void model.control('start', route.id)} />
        <IconButton icon={Pause} label={`Pause ${name}`} title={runTitle(`Pause ${name}`)} disabled={!rights.run || busy} onClick={() => void model.control('pause', route.id)} />
        <IconButton icon={RotateCcw} label={`Reset ${name}`} title={runTitle(`Reset ${name}`)} disabled={!rights.run || busy} onClick={() => void model.control('reset', route.id)} />
        <span title={endTitle}>
          <Select
            label="At the end"
            value={object?.end ?? 'stop'}
            options={END_OPTIONS}
            disabled={!rights.edit || busy || object === undefined || locked !== null}
            onChange={(end) => void model.setEnd(route.id, end)}
          />
        </span>
      </div>
    </li>
  );
}
