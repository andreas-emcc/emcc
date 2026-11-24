// The Cameras panel (brief function 11), in Simulation only: the list of cameras with their state,
// pointing mode and Start or Stop (for users with run), and the open camera's form (for users with
// edit; read only for the others) showing only the chosen mode's fields. The limits are the server's:
// a value outside them comes back with the server's message at the field (criterion 14). The form's
// Output lists the channels that take the pose (function 9); one taken by another camera is shown as
// taken (U10), and a chosen one that is gone stays, as missing (C1, C4).
import { useEffect, useState } from 'react';
import { Button, Checkbox, ConfirmDialog, Notice, Select, TextField } from '@emc2/plugin-sdk';
import type { Uuid } from '@emc2/plugin-sdk';
import { cameraName, FRAME_SIZES, linkMark, linkNotice, MODE_LABELS, outputLabel, STATE_LABELS, useCameras } from './cameras.ts';
import type { CameraInfo, CamerasModel, Failure, Mode, OutputInfo, Settings } from './cameras.ts';

export const CAMERAS_TITLE = 'Cameras';

export interface Rights {
  readonly edit: boolean;
  readonly run: boolean;
}

export const EDIT_HINT = 'You may look at the cameras, not change them';

const MODE_OPTIONS = (Object.keys(MODE_LABELS) as Mode[]).map((m) => ({ value: m, label: MODE_LABELS[m] }));
const SIZE_OPTIONS = FRAME_SIZES.map((s) => ({ value: s, label: s.replace('x', ' × ') }));

/** A number field of the form: the key the server knows it by, its label and unit. */
interface NumberField {
  readonly key: NumberKey;
  readonly label: string;
}

type NumberKey =
  | 'pointLon'
  | 'pointLat'
  | 'pointHeight'
  | 'azimuth'
  | 'depression'
  | 'sectorStart'
  | 'sectorEnd'
  | 'sweepRate'
  | 'horizontalFov'
  | 'frameRate'
  | 'height'
  | SwayKey;

type SwayKey = 'swayAmplitude' | 'swayMinFrequency' | 'swayMaxFrequency' | 'swayJoltsPerMinute' | 'swayJoltStrength' | 'swayJoltDecay' | 'swaySeed';

/** Only the chosen mode's fields (brief function 11, as visibleWhen does in a settings form). */
const MODE_FIELDS: Readonly<Record<Mode, readonly NumberField[]>> = {
  trackPoint: [
    { key: 'pointLon', label: 'Longitude (°)' },
    { key: 'pointLat', label: 'Latitude (°)' },
    { key: 'pointHeight', label: "Point's height (m)" },
  ],
  trackObject: [{ key: 'pointHeight', label: "Target's height where it has none (m)" }],
  fixed: [
    { key: 'azimuth', label: 'Azimuth (°)' },
    { key: 'depression', label: 'Depression (°)' },
  ],
  sweep: [
    { key: 'sectorStart', label: 'Sector start (°)' },
    { key: 'sectorEnd', label: 'Sector end (°)' },
    { key: 'sweepRate', label: 'Sweep rate (°/s)' },
    { key: 'depression', label: 'Depression (°)' },
  ],
};

const COMMON_FIELDS: readonly NumberField[] = [
  { key: 'horizontalFov', label: 'Horizontal field of view (°)' },
  { key: 'frameRate', label: 'Frame rate (frames a second)' },
  { key: 'height', label: 'Height where the platform has none (m)' },
];

/** The micro sway's fields (M9.2's V3), shown while it is on. */
const SWAY_FIELDS: readonly NumberField[] = [
  { key: 'swayAmplitude', label: 'Sway amplitude (°)' },
  { key: 'swayMinFrequency', label: 'Sway lowest frequency (Hz)' },
  { key: 'swayMaxFrequency', label: 'Sway highest frequency (Hz)' },
  { key: 'swayJoltsPerMinute', label: 'Jolts a minute' },
  { key: 'swayJoltStrength', label: 'Jolt strength (°)' },
  { key: 'swayJoltDecay', label: 'Jolt decay (s)' },
  { key: 'swaySeed', label: 'Sway seed' },
];

type Draft = Readonly<Record<NumberKey, string>>;

/**
 * Brief section 5: Track a point's point defaults to the platform's position when the mode is chosen.
 * The draft with that position in the point's boxes when the mode is Track a point and both are empty.
 */
function withDefaultPoint(draft: Draft, mode: Mode, at: readonly [number, number] | null): Draft {
  if (mode !== 'trackPoint' || at === null || draft.pointLon.trim() !== '' || draft.pointLat.trim() !== '') return draft;
  return { ...draft, pointLon: String(at[0]), pointLat: String(at[1]) };
}

function draftOf(s: Settings): Draft {
  return {
    pointLon: s.point === null ? '' : String(s.point[0]),
    pointLat: s.point === null ? '' : String(s.point[1]),
    pointHeight: String(s.pointHeight),
    azimuth: String(s.azimuth),
    depression: String(s.depression),
    sectorStart: String(s.sectorStart),
    sectorEnd: String(s.sectorEnd),
    sweepRate: String(s.sweepRate),
    horizontalFov: String(s.horizontalFov),
    frameRate: String(s.frameRate),
    height: String(s.height),
    swayAmplitude: String(s.swayAmplitude),
    swayMinFrequency: String(s.swayMinFrequency),
    swayMaxFrequency: String(s.swayMaxFrequency),
    swayJoltsPerMinute: String(s.swayJoltsPerMinute),
    swayJoltStrength: String(s.swayJoltStrength),
    swayJoltDecay: String(s.swayJoltDecay),
    swaySeed: String(s.swaySeed),
  };
}

/** The server's field for a form field: the point's two boxes are the server's `point`. */
function serverField(key: NumberKey): string {
  return key === 'pointLon' || key === 'pointLat' ? 'point' : key;
}

function number(text: string): number | null {
  const n = Number(text.trim().replace(',', '.'));
  return text.trim() === '' || !Number.isFinite(n) ? null : n;
}

export function CamerasPanel(props: { readonly model: CamerasModel; readonly rights: Rights }) {
  const { model, rights } = props;
  const state = useCameras(model);
  useEffect(() => model.watch(), [model]);
  const open = state.cameras?.find((c) => c.id === state.open) ?? null;

  return (
    // SDK 1.8.0 part C: the shell's head shows the title, so the panel shows no inner heading.
    <section className="uav-simulation-frame" aria-label={CAMERAS_TITLE}>
      <div className="uav-simulation-panel">
        {rights.edit ? null : <Notice>{EDIT_HINT}</Notice>}
        {state.readError === null ? null : <Notice severity="warning">{state.readError}</Notice>}
        {state.failure !== null && state.failure.field === null ? <Notice severity="error">{state.failure.message}</Notice> : null}
        {state.cameras === null ? (
          state.readError === null ? <p className="uav-simulation-muted">Loading the cameras…</p> : null
        ) : state.cameras.length === 0 ? (
          <p className="uav-simulation-muted">No cameras. Right-click a track of the simulation and choose New camera.</p>
        ) : (
          <ul className="uav-simulation-list" aria-label="Cameras">
            {state.cameras.map((c) => (
              <li key={c.id} className="uav-simulation-row" aria-label={cameraName(c)}>
                <Button variant={c.id === state.open ? 'primary' : 'normal'} onClick={() => { model.openCamera(c.id === state.open ? null : c.id); }}>
                  {cameraName(c)}
                </Button>
                <span className="uav-simulation-state">{STATE_LABELS[c.state]}</span>
                <span className="uav-simulation-muted">
                  {MODE_LABELS[c.settings.mode]} · {outputLabel(c)}
                </span>
                {rights.run ? (
                  c.running ? (
                    <Button disabled={state.busy} onClick={() => void model.stop(c.id)}>Stop</Button>
                  ) : (
                    <Button
                      disabled={state.busy || c.state === 'platformGone'}
                      title={c.state === 'platformGone' ? 'The platform is gone: choose New camera on another track' : 'Start the camera'}
                      onClick={() => void model.start(c.id)}
                    >
                      Start
                    </Button>
                  )
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {open === null ? null : (
          <CameraForm
            key={open.id}
            camera={open}
            cameras={state.cameras ?? []}
            outputs={state.outputs}
            model={model}
            rights={rights}
            failure={state.failure}
            busy={state.busy}
            selection={state.selection}
          />
        )}
      </div>
    </section>
  );
}

/** The Output select's value for no output. */
const NONE = '';

/** The Output select's options: none, the outputs on offer (one another camera chose is taken, U10), and the camera's own missing one (C1). */
function outputOptions(camera: CameraInfo, cameras: readonly CameraInfo[], outputs: readonly OutputInfo[]) {
  const options: { value: string; label: string; disabled?: boolean }[] = [{ value: NONE, label: 'None' }];
  for (const o of outputs) {
    if (o.camera === null || o.camera === camera.id) {
      options.push({ value: o.id, label: `${o.name}${linkMark(o.state)}` });
    } else {
      const by = cameras.find((c) => c.id === o.camera);
      options.push({ value: o.id, label: `${o.name} (used by ${by === undefined ? 'another camera' : cameraName(by)})`, disabled: true });
    }
  }
  if (camera.settings.output !== null && !outputs.some((o) => o.id === camera.settings.output)) {
    options.push({ value: camera.settings.output, label: `${camera.outputName ?? camera.settings.output} (missing)` });
  }
  return options;
}

function CameraForm(props: {
  readonly camera: CameraInfo;
  readonly cameras: readonly CameraInfo[];
  readonly outputs: readonly OutputInfo[];
  readonly model: CamerasModel;
  readonly rights: Rights;
  readonly failure: Failure | null;
  readonly busy: boolean;
  readonly selection: readonly Uuid[];
}) {
  const { camera, model, rights } = props;
  const [mode, setMode] = useState<Mode>(camera.settings.mode);
  const [draft, setDraft] = useState<Draft>(() => withDefaultPoint(draftOf(camera.settings), camera.settings.mode, camera.platformPosition));
  const chooseMode = (next: Mode): void => {
    setMode(next);
    setDraft(withDefaultPoint(draft, next, camera.platformPosition));
  };
  const [frameSize, setFrameSize] = useState(camera.settings.frameSize);
  const [mission, setMission] = useState(camera.settings.mission);
  const [target, setTarget] = useState<Uuid | null>(camera.settings.target);
  const [output, setOutput] = useState<string>(camera.settings.output ?? NONE);
  const [sway, setSway] = useState(camera.settings.sway);
  const [overlay, setOverlay] = useState(camera.settings.overlay);
  const [typing, setTyping] = useState<Partial<Record<NumberKey, string>>>({});
  const [removing, setRemoving] = useState(false);
  const readOnly = !rights.edit;
  const fields = [...MODE_FIELDS[mode], ...COMMON_FIELDS];
  const swayFields = sway ? SWAY_FIELDS : [];
  const one = props.selection.length === 1 ? props.selection[0] : undefined;
  const selectable = one !== undefined && one !== camera.platform;

  const errorAt = (key: string): string | undefined => typing[key as NumberKey] ?? (props.failure?.field === key ? props.failure.message : undefined);

  const targetError = errorAt('target');
  const missionError = errorAt('mission');
  const outputError = errorAt('output');

  const numberField = (f: NumberField) => {
    const error = errorAt(f.key) ?? (f.key === 'pointLon' ? errorAt(serverField(f.key)) : undefined);
    return (
      <TextField
        key={f.key}
        label={f.label}
        value={draft[f.key]}
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        data
        readOnly={readOnly}
        onChange={(v) => {
          setDraft({ ...draft, [f.key]: v });
          // The server's message was for the value it saw; a new value clears it.
          if (props.failure?.field === serverField(f.key)) model.dismissFailure();
        }}
        {...(error === undefined ? {} : { error })}
      />
    );
  };

  const save = (): void => {
    const wrong: Partial<Record<NumberKey, string>> = {};
    const values: Partial<Record<NumberKey, number>> = {};
    for (const f of [...fields, ...swayFields]) {
      const n = number(draft[f.key]);
      if (n === null) wrong[f.key] = 'Type a number';
      else values[f.key] = n;
    }
    setTyping(wrong);
    if (Object.keys(wrong).length > 0) return;
    const patch: Record<string, unknown> = { mode, frameSize, mission, output: output === NONE ? null : output, overlay, sway };
    for (const f of [...fields, ...swayFields]) {
      if (f.key !== 'pointLon' && f.key !== 'pointLat') patch[f.key] = values[f.key];
    }
    if (mode === 'trackPoint') patch['point'] = [values.pointLon, values.pointLat];
    if (mode === 'trackObject') patch['target'] = target;
    void model.save(camera.id, patch);
  };

  return (
    <form
      className="uav-simulation-form"
      aria-label={`Camera on ${cameraName(camera)}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (!readOnly) save();
      }}
    >
      <h3 className="uav-simulation-heading">Camera on {cameraName(camera)}</h3>
      <p className="uav-simulation-muted">
        {STATE_LABELS[camera.state]} · {camera.poses} poses · {camera.sent} sent
      </p>
      {camera.notSent === null ? null : <Notice severity="warning">Not sent: {camera.notSent}</Notice>}
      {props.failure?.field === 'platform' ? <Notice severity="error">{props.failure.message}</Notice> : null}
      <Select label="Pointing mode" value={mode} options={MODE_OPTIONS} disabled={readOnly} onChange={chooseMode} />
      {mode === 'trackObject' ? (
        <div className="uav-simulation-target">
          <TextField
            label="Target"
            value={target === null ? '' : target === camera.settings.target ? (camera.targetName ?? 'An object without a name') : 'The selected object'}
            placeholder="Select one object on the map"
            readOnly
            onChange={() => undefined}
            {...(targetError === undefined ? {} : { error: targetError })}
          />
          {readOnly ? null : (
            <Button
              disabled={!selectable}
              title={selectable ? 'Track the selected object' : 'Select one object on the map, not the platform'}
              onClick={() => {
                if (one !== undefined) setTarget(one);
              }}
            >
              Use selection
            </Button>
          )}
        </div>
      ) : null}
      {fields.map((f) => numberField(f))}
      <Select label="Frame size" value={frameSize} options={SIZE_OPTIONS} disabled={readOnly} onChange={setFrameSize} />
      <TextField
        label="Mission"
        value={mission}
        placeholder="None"
        readOnly={readOnly}
        onChange={(v) => {
          setMission(v);
          if (props.failure?.field === 'mission') model.dismissFailure();
        }}
        {...(missionError === undefined ? {} : { error: missionError })}
      />
      <Select
        label="Output"
        value={output}
        options={outputOptions(camera, props.cameras, props.outputs)}
        disabled={readOnly}
        onChange={(v) => {
          setOutput(v);
          if (props.failure?.field === 'output') model.dismissFailure();
        }}
      />
      {outputError === undefined ? null : <Notice severity="error">{outputError}</Notice>}
      <Checkbox
        label="Burn the camera's data into the video"
        checked={overlay}
        disabled={readOnly}
        onChange={(v) => {
          setOverlay(v);
          if (props.failure?.field === 'overlay') model.dismissFailure();
        }}
      />
      <Checkbox
        label="Micro sway"
        checked={sway}
        disabled={readOnly}
        onChange={(v) => {
          setSway(v);
          if (props.failure?.field === 'sway') model.dismissFailure();
        }}
      />
      {swayFields.map((f) => numberField(f))}
      {output === camera.settings.output && linkNotice(camera) !== null ? <Notice severity="warning">{linkNotice(camera)}</Notice> : null}
      {props.outputs.length === 0 && camera.settings.output === null ? (
        <p className="uav-simulation-muted">No output takes camera poses. An admin adds an output link to fmv.</p>
      ) : null}
      {readOnly ? null : (
        <div className="uav-simulation-buttons">
          <Button type="submit" variant="primary" disabled={props.busy}>
            Save
          </Button>
          <Button variant="danger" disabled={props.busy} onClick={() => { setRemoving(true); }}>
            Remove
          </Button>
        </div>
      )}
      <ConfirmDialog
        open={removing}
        title="Remove camera"
        message={`Remove the camera on ${cameraName(camera)}? Its settings are lost.`}
        confirmLabel="Remove"
        danger
        onCancel={() => { setRemoving(false); }}
        onConfirm={() => {
          setRemoving(false);
          void model.remove(camera.id);
        }}
      />
    </form>
  );
}
