// The Route editor panel (brief function 22; Q10, Q13, A35 to A47; T-088): "All points", which sets
// values on every point, and one point at a time with its speed or time, altitude, step or ramp, the
// server part's computed values for the version shown, and its events; the route's object list;
// reshaping, appending (function 49), inserting and deleting points; and the move-or-disconnect
// question on line changes.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { ChevronDown, ChevronUp, Copy, ListEnd, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button, ConfirmDialog, IconButton, Notice, Select, TextField } from '@emc2/plugin-sdk';
import { SimPanel } from './SimPanel.tsx';
import type { DeclaredField, MapObject } from '@emc2/plugin-sdk';
import { extensionOf, formatTime, listedObjects, MIN_POINTS, pointValues } from './definition.ts';
import type { From, Json, Kind } from './definition.ts';
import { entriesOf, NO_MAP } from './editor.ts';
import type { AllPointsInput, RouteEditorModel } from './editor.ts';
import { summary } from './events.ts';
import type { EventModel } from './events.ts';
import { FailureNotice } from './FailureNotice.tsx';
import { useModel } from './model.ts';
import { EDIT_HINT } from './permissions.ts';
import type { Rights } from './permissions.ts';
import type { SimulationPicture } from './picture.ts';
import { problemText } from './RoutesPanel.tsx';
import type { ComputedPoint, RouteInfo } from './routes.ts';
import { ALTITUDE_LABELS, formatDuration, formatLength, lengthIn, SPEED_LABELS, speedIn } from './units.ts';
import type { Units } from './units.ts';
import type { UnitsModel } from './unitsModel.ts';
import { UnitFields } from './UnitFields.tsx';
import { ValueBox } from './ValueBox.tsx';

/** Q3: "instant" is a step at the point; "ramp" changes over the leg into it. */
const KINDS: readonly { readonly value: Kind; readonly label: string }[] = [
  { value: 'instant', label: 'Step at this point' },
  { value: 'ramp', label: 'Ramp over the leg into this point' },
];

/** "All points" (Q16): a kind left on "Unchanged" is not set. */
const ALL_KINDS: readonly { readonly value: Kind | 'unchanged'; readonly label: string }[] = [{ value: 'unchanged', label: 'Unchanged' }, ...KINDS];

const FROM: readonly { readonly value: From; readonly label: string }[] = [
  { value: 'previous', label: 'from the previous point' },
  { value: 'start', label: 'from the start' },
];

const END_OPTIONS = [
  { value: 'stop', label: 'Stop' },
  { value: 'restart', label: 'Restart' },
] as const;

const INTERACTION_HINTS = {
  draw: 'Draw the route on the map: click each point; double-click or Enter finishes, Escape cancels.',
  reshape: 'Drag the route or its points on the map; Enter finishes, Escape cancels.',
  append: 'Click the new points after the last one; double-click or Enter finishes, Backspace takes back the last, Escape cancels.',
  pick: 'Click the new point on the map; Escape cancels.',
} as const;

function decimal(value: number): string {
  return String(Math.round(value * 10) / 10);
}

export function RouteEditorPanel(props: {
  readonly model: RouteEditorModel;
  readonly events: EventModel;
  readonly picture: SimulationPicture;
  readonly units: UnitsModel;
  readonly declaredFields: readonly DeclaredField[];
  readonly rights: Rights;
}) {
  const { model, picture, rights } = props;
  const state = useModel(model);
  const units = useModel(props.units);
  useSyncExternalStore(picture.onChange, picture.revision);
  useEffect(() => model.watch(), [model]);
  const route = model.route();
  // Read only without the edit right, or for everyone while the route's layer is locked (function 25, A81).
  const hint = rights.edit ? model.lockHint() : EDIT_HINT;
  const readOnly = hint !== null;
  const busy = state.busy || state.interaction !== null || state.pendingLine !== null;
  const noMap = model.hasMap ? null : NO_MAP;

  return (
    <SimPanel label="Route editor" actions={<IconButton icon={X} label="Close the route editor" onClick={() => { model.close(); }} />}>
      <div className="simulator-panel">
        {hint === null ? null : <Notice>{hint}</Notice>}
        {state.interaction === null ? null : (
          <Notice>
            <span className="simulator-notice-row">
              <span>{INTERACTION_HINTS[state.interaction]}</span>
            </span>
          </Notice>
        )}
        <FailureNotice failure={state.failure} onDismiss={() => { model.dismissFailure(); }} />
        {state.pendingLine === null ? null : (
          <Notice severity="warning">
            <span className="simulator-notice-row">
              <span>{state.pendingLine} The route has objects on it.</span>
              <Button variant="primary" onClick={() => { model.answer('move'); }}>Move them with it</Button>
              <Button onClick={() => { model.answer('disconnect'); }}>Disconnect them</Button>
              <Button onClick={() => { model.answer(null); }}>Undo the change</Button>
            </span>
          </Notice>
        )}
        {state.readError === null ? null : <Notice severity="warning">{state.readError}</Notice>}
        {route === undefined ? (
          state.routeId === null || state.gone ? null : <p className="simulator-muted">Waiting for the route…</p>
        ) : (
          <RouteForm
            route={route}
            computed={state.computed?.version === route.version ? state.computed : null}
            model={model}
            events={props.events}
            picture={picture}
            units={units}
            declaredFields={props.declaredFields}
            readOnly={readOnly}
            hint={hint ?? ''}
            busy={busy}
            noMap={noMap}
            rejections={state.rejections}
            unitsModel={props.units}
          />
        )}
      </div>
    </SimPanel>
  );
}

function RouteForm(props: {
  readonly route: MapObject;
  readonly computed: RouteInfo | null;
  readonly model: RouteEditorModel;
  readonly events: EventModel;
  readonly picture: SimulationPicture;
  readonly units: Units;
  readonly declaredFields: readonly DeclaredField[];
  readonly readOnly: boolean;
  /** Why it is read only (no edit right, or a locked layer), for the disabled controls' titles. */
  readonly hint: string;
  readonly busy: boolean;
  readonly noMap: string | null;
  readonly rejections: number;
  readonly unitsModel: UnitsModel;
}) {
  const { route, computed, model, units, readOnly, busy, noMap, rejections } = props;
  const ext = extensionOf(route);
  const entries = entriesOf(route);
  const objects = listedObjects(ext);
  const routeProblems = computed?.problems.filter((p) => p.point === null) ?? [];
  const shown = model.shownPoint();
  const lineTitle = readOnly ? props.hint : (noMap ?? undefined);
  // Append (function 49): off as Reshape, and while the map view has no `append` yet (SDK 1.6.0 part B).
  const appendProblem = model.appendProblem();
  const appendTitle = readOnly ? props.hint : (appendProblem ?? undefined);
  return (
    <>
      <ValueBox rejections={rejections} label="Name" value={route.properties?.name ?? ''} readOnly={readOnly} numeric={false} onCommit={(text) => model.setName(text)} />
      <div className="simulator-item-controls">
        <Select
          label="At the end"
          value={ext['end'] === 'restart' ? 'restart' : 'stop'}
          options={END_OPTIONS}
          disabled={readOnly || busy}
          onChange={(end) => {
            model.setEnd(end);
          }}
        />
        <span className="simulator-push-end">
          <Button icon={Pencil} disabled={readOnly || busy || noMap !== null} {...(lineTitle === undefined ? {} : { title: lineTitle })} onClick={() => void model.reshape()}>
            Reshape
          </Button>
          <Button icon={ListEnd} disabled={readOnly || busy || appendProblem !== null} {...(appendTitle === undefined ? {} : { title: appendTitle })} onClick={() => void model.append()}>
            Append
          </Button>
        </span>
      </div>
      {computed === null ? (
        <p className="simulator-muted">Waiting for the server's values for this version…</p>
      ) : (
        <p className="simulator-data simulator-muted">
          {formatLength(computed.lengthMetres, units.altitude)} · {formatDuration(computed.durationSeconds)}
        </p>
      )}
      {routeProblems.length === 0 ? null : (
        <Notice severity="warning">
          <ul className="simulator-problems">
            {routeProblems.map((p, i) => (
              <li key={i}>{problemText(p)}</li>
            ))}
          </ul>
        </Notice>
      )}
      {readOnly ? null : (
        <>
          <AllPoints model={model} count={entries.length} routeName={route.properties?.name ?? 'the route'} units={units} unitsModel={props.unitsModel} busy={busy} />
          <hr className="simulator-separator" />
        </>
      )}
      {entries.map((entry, i) =>
        i === shown ? (
          <PointRow
            key={i}
            index={i}
            count={entries.length}
            entry={entry}
            routeId={route.id}
            computed={computed?.points[i] ?? null}
            previousArrival={i === 0 ? null : (computed?.points[i - 1]?.arrivalSeconds ?? null)}
            problems={computed?.problems.filter((p) => p.point === i).map((p) => p.message) ?? []}
            model={model}
            events={props.events}
            units={units}
            declaredFields={props.declaredFields}
            readOnly={readOnly}
            hint={props.hint}
            busy={busy}
            noMap={noMap}
            lineTitle={lineTitle}
            rejections={rejections}
          />
        ) : null,
      )}
      <section className="simulator-section" aria-label="Objects on the route">
        <h3 className="simulator-heading">Objects on the route</h3>
        {objects.length === 0 ? (
          <p className="simulator-muted">None. Use "Put on route" on symbols in Simulation.</p>
        ) : (
          <ol className="simulator-objects">
            {objects.map((o) => (
              <li key={o.id}>
                {objectName(props.picture, o.id)} <span className="simulator-muted">({o.kind})</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

/**
 * "All points" (T-088, Q16, A60): sets the chosen speed and altitude values on every point, after a
 * confirmation. A kind on "Unchanged" and an empty box leave the points' values alone.
 */
function AllPoints(props: {
  readonly model: RouteEditorModel;
  readonly count: number;
  readonly routeName: string;
  readonly units: Units;
  readonly unitsModel: UnitsModel;
  readonly busy: boolean;
}) {
  const { model, count, units, busy } = props;
  const [speedKind, setSpeedKind] = useState<Kind | 'unchanged'>('unchanged');
  const [speed, setSpeed] = useState('');
  const [altitudeKind, setAltitudeKind] = useState<Kind | 'unchanged'>('unchanged');
  const [altitude, setAltitude] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const input: AllPointsInput = {
    speedKind: speedKind === 'unchanged' ? null : speedKind,
    speed,
    altitudeKind: altitudeKind === 'unchanged' ? null : altitudeKind,
    altitude,
  };
  const typed = (set: (text: string) => void) => (text: string) => {
    set(text);
    setError(null);
  };
  return (
    <section className="simulator-section" aria-label="All points">
      <h3 className="simulator-heading">All points</h3>
      <UnitFields units={props.unitsModel} />
      <div className="simulator-fields">
        <div className="simulator-select">
          <Select label="Speed change" value={speedKind} options={ALL_KINDS} disabled={busy} onChange={(k) => { setSpeedKind(k); setError(null); }} />
        </div>
        <TextField label={`Speed (${SPEED_LABELS[units.speed]})`} value={speed} placeholder="unchanged" disabled={busy} inputMode="decimal" autoComplete="off" spellCheck={false} data onChange={typed(setSpeed)} />
        <div className="simulator-select">
          <Select label="Altitude change" value={altitudeKind} options={ALL_KINDS} disabled={busy} onChange={(k) => { setAltitudeKind(k); setError(null); }} />
        </div>
        <TextField label={`Altitude (${ALTITUDE_LABELS[units.altitude]})`} value={altitude} placeholder="unchanged" disabled={busy} inputMode="decimal" autoComplete="off" spellCheck={false} data onChange={typed(setAltitude)} />
      </div>
      {error === null ? null : <Notice severity="warning">{error}</Notice>}
      <div className="simulator-actions">
        <Button
          disabled={busy}
          onClick={() => {
            const problem = model.allPointsProblem(input);
            setError(problem);
            if (problem === null) setAsking(true);
          }}
        >
          Set on all points
        </Button>
      </div>
      <ConfirmDialog
        open={asking}
        title="Change all points"
        message={`All ${String(count)} points of ${props.routeName} will be changed.${speed.trim() === '' ? '' : ' Their typed times are removed, as for a typed speed.'}`}
        confirmLabel={`Change all ${String(count)} points`}
        onCancel={() => { setAsking(false); }}
        onConfirm={() => {
          setAsking(false);
          const problem = model.setAllPoints(input);
          setError(problem);
          if (problem === null) {
            setSpeed('');
            setAltitude('');
            setSpeedKind('unchanged');
            setAltitudeKind('unchanged');
          }
        }}
      />
    </section>
  );
}

export function objectName(picture: SimulationPicture, id: string): string {
  return picture.object(id)?.properties?.name ?? `Object ${id.slice(0, 8)}`;
}

function PointRow(props: {
  readonly index: number;
  readonly count: number;
  readonly entry: Json;
  readonly routeId: string;
  readonly computed: ComputedPoint | null;
  readonly previousArrival: number | null;
  readonly problems: readonly string[];
  readonly model: RouteEditorModel;
  readonly events: EventModel;
  readonly units: Units;
  readonly declaredFields: readonly DeclaredField[];
  readonly readOnly: boolean;
  /** Why it is read only (no edit right, or a locked layer), for the disabled controls' titles. */
  readonly hint: string;
  readonly busy: boolean;
  readonly noMap: string | null;
  readonly lineTitle: string | undefined;
  readonly rejections: number;
}) {
  const { index: i, count, entry, computed, model, units, readOnly, busy, noMap, lineTitle, rejections } = props;
  const v = pointValues(entry);
  const label = `Point ${String(i + 1)}`;
  const speedUnit = SPEED_LABELS[units.speed];
  const altitudeUnit = ALTITUDE_LABELS[units.altitude];
  const computedSpeed = computed?.speed ?? null;
  const speedText = v.speed !== null ? decimal(speedIn(v.speed, units.speed)) : computedSpeed !== null ? decimal(speedIn(computedSpeed, units.speed)) : '';
  const speedNote = v.speed !== null ? 'typed' : computedSpeed !== null ? 'computed' : undefined;
  const from: From = v.time?.from ?? 'previous';
  const arrival = computed?.arrivalSeconds ?? null;
  const computedTime = arrival === null ? null : from === 'start' ? arrival : props.previousArrival === null ? null : arrival - props.previousArrival;
  const timeText = v.time !== null ? formatTime(v.time.seconds) : computedTime !== null ? formatTime(computedTime) : '';
  const timeNote = v.time !== null ? 'typed' : computedTime !== null ? 'computed' : undefined;
  const last = i === count - 1;
  const insertLabel = last ? 'Add point at the end' : `Insert point after ${label.toLowerCase()}`;
  const deleteTitle = readOnly ? props.hint : count <= MIN_POINTS ? 'A route needs at least two points' : `Delete ${label.toLowerCase()}`;
  const copyTitle = readOnly ? props.hint : i === 0 ? 'The first point has no previous point' : "Copy the previous point's speed and altitude, with their changes";
  return (
    <section className="simulator-item" aria-label={label}>
      <div className="simulator-item-head">
        <span className="simulator-item-name">
          {label} of {String(count)}
        </span>
        <IconButton icon={ChevronUp} label="Next point" onClick={() => { model.stepPoint(1); }} />
        <IconButton icon={ChevronDown} label="Previous point" onClick={() => { model.stepPoint(-1); }} />
        <IconButton icon={Plus} label={insertLabel} title={lineTitle ?? insertLabel} disabled={readOnly || busy || noMap !== null} onClick={() => void model.insertAfter(i)} />
        <IconButton icon={Trash2} label={`Delete ${label.toLowerCase()}`} title={deleteTitle} disabled={readOnly || busy || count <= MIN_POINTS} onClick={() => { model.deletePoint(i); }} />
      </div>
      <div className="simulator-actions">
        <Button icon={Copy} title={copyTitle} disabled={readOnly || busy || i === 0} onClick={() => { model.copyFromPrevious(i); }}>
          Copy from previous point
        </Button>
      </div>
      {i === 0 ? null : (
        <div className="simulator-data simulator-muted">
          leg {formatLength(computed?.legMetres ?? null, units.altitude)} · arrives {formatDuration(arrival)}
          {computed?.speedFrom === 'next-time' ? ' · speed from the next point\'s time' : ''}
        </div>
      )}
      <div className="simulator-fields">
        <div className="simulator-select">
          <Select label="Speed change" value={v.speedKind} options={KINDS} disabled={readOnly || busy} onChange={(k) => { model.setSpeedKind(i, k); }} />
        </div>
        <ValueBox rejections={rejections} label={`Speed (${speedUnit})`} value={speedText} note={speedNote} placeholder={computed === null ? '…' : undefined} readOnly={readOnly} onCommit={(t) => model.setSpeed(i, t)} />
        {i === 0 ? null : (
          <>
            <ValueBox rejections={rejections} label="Time (h:mm:ss)" value={timeText} note={timeNote} placeholder={computed === null ? '…' : undefined} readOnly={readOnly} numeric={false} onCommit={(t) => model.setTime(i, t)} />
            <Select label="Counted" value={from} options={FROM} disabled={readOnly || busy || v.time === null} onChange={(f) => { model.setFrom(i, f); }} />
          </>
        )}
        <div className="simulator-select">
          <Select label="Altitude change" value={v.altitudeKind} options={KINDS} disabled={readOnly || busy} onChange={(k) => { model.setAltitudeKind(i, k); }} />
        </div>
        <ValueBox rejections={rejections}
          label={`Altitude (${altitudeUnit})`}
          value={v.altitude === null ? '' : String(Math.round(lengthIn(v.altitude, units.altitude)))}
          placeholder="the object's own"
          readOnly={readOnly}
          onCommit={(t) => model.setAltitude(i, t)}
        />
      </div>
      {props.problems.length === 0 ? null : (
        <Notice severity="warning">
          <ul className="simulator-problems">
            {props.problems.map((p, j) => (
              <li key={j}>{p}</li>
            ))}
          </ul>
        </Notice>
      )}
      <PointEvents
        index={i}
        routeId={props.routeId}
        events={v.events}
        eventModel={props.events}
        model={model}
        declaredFields={props.declaredFields}
        readOnly={readOnly}
        hint={props.hint}
        busy={busy}
      />
    </section>
  );
}

function PointEvents(props: {
  readonly index: number;
  readonly routeId: string;
  readonly events: readonly Json[];
  readonly eventModel: EventModel;
  readonly model: RouteEditorModel;
  readonly declaredFields: readonly DeclaredField[];
  readonly readOnly: boolean;
  /** Why it is read only (no edit right, or a locked layer), for the disabled controls' titles. */
  readonly hint: string;
  readonly busy: boolean;
}) {
  const { index: i, routeId, events, eventModel, model, readOnly, busy } = props;
  const point = `point ${String(i + 1)}`;
  return (
    <div className="simulator-events">
      {events.length === 0 ? null : (
        <ul className="simulator-objects" aria-label={`Events at ${point}`}>
          {events.map((event, j) => {
            const text = summary(event, props.declaredFields);
            return (
              <li key={j} className="simulator-item-controls">
                <span className="simulator-item-name">{text}</span>
                <IconButton icon={Pencil} label={readOnly ? `Open event ${String(j + 1)} at ${point}` : `Edit event ${String(j + 1)} at ${point}`} onClick={() => { eventModel.open(routeId, i, j, event); }} />
                <IconButton
                  icon={Trash2}
                  label={`Remove event ${String(j + 1)} at ${point}`}
                  title={readOnly ? props.hint : `Remove event ${String(j + 1)} at ${point}`}
                  disabled={readOnly || busy}
                  onClick={() => void model.setEvents(i, (list) => list.filter((_, k) => k !== j))}
                />
              </li>
            );
          })}
        </ul>
      )}
      <Button icon={Plus} disabled={readOnly || busy} {...(readOnly ? { title: props.hint } : {})} onClick={() => { eventModel.open(routeId, i, null, null); }}>
        Add event at {point}
      </Button>
    </div>
  );
}
