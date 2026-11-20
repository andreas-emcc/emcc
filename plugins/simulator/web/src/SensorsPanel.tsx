// The Sensors panel (brief functions 27, 29 and 36 to 39; A106) and the warning at the bottom of the
// Simulation map (function 29, CR-0035; A105). "New sensor" asks for the type and makes a sensor on
// the one selected track; each sensor's form shows its type's settings in the user's speed unit,
// ranges in km and errors in m (the owner, 2026-11-08), a ground radar's preset (A4), refuses a value
// outside its limits at the field, and chooses the sensor's outputs from the channels that take
// sensor reports of its type. A sensor's job area is drawn on the map (function 39). From M7: "Show
// dwells" (function 43), and the sensor being edited drawn at once from its fields (function 45).
import { useEffect, useState } from 'react';
import { Radar } from 'lucide-react';
import { Button, Checkbox, ConfirmDialog, Notice, Select, TextField } from '@emc2/plugin-sdk';
import { SimPanel } from './SimPanel.tsx';
import type { FieldSet, Uuid } from '@emc2/plugin-sdk';
import { colourFor, jobAreaStyle } from './coverage.ts';
import type { ColoursModel, CoverageModel, PreviewModel } from './coverage.ts';
import { FailureNotice } from './FailureNotice.tsx';
import { useModel } from './model.ts';
import { setLabel } from './OutputsPanel.tsx';
import { takesType } from './outputs.ts';
import type { ChannelInfo } from './outputs.ts';
import { EDIT_HINT } from './permissions.ts';
import type { Rights } from './permissions.ts';
import type { SimulationPicture } from './picture.ts';
import { DWELL_SETTINGS, KIND_LABELS, LIMITS, MAX_MISSION, MODE_LABELS, OFFERED_KINDS, PRESET_LABELS, PRESETS, warnings } from './sensors.ts';
import type { Mode, NumberSetting, Preset, SensorInfo, SensorKind, SensorSettings, SensorsModel } from './sensors.ts';
import { SPEED_LABELS, speedIn, speedToMps } from './units.ts';
import type { SpeedUnit } from './units.ts';
import type { UnitsModel } from './unitsModel.ts';

export const SENSORS_TITLE = 'Sensors';
export { Radar as SensorsIcon };

interface Field {
  readonly key: NumberSetting;
  readonly label: string;
  readonly unit: string;
  readonly factor: number | 'speed';
}

/** How a setting is shown: its label, and its unit's factor from SI ("speed" for the user's speed unit). */
const RADAR_FIELDS: readonly Field[] = [
  { key: 'revisitSeconds', label: 'Revisit interval', unit: 's', factor: 1 },
  { key: 'minRange', label: 'Min range', unit: 'km', factor: 1000 },
  { key: 'maxRange', label: 'Max range', unit: 'km', factor: 1000 },
  { key: 'startBearing', label: 'Start bearing', unit: '°', factor: 1 },
  { key: 'endBearing', label: 'End bearing', unit: '°', factor: 1 },
  { key: 'detectionProbability', label: 'Probability of detection', unit: '', factor: 1 },
  { key: 'rangeError', label: 'Range error', unit: 'm', factor: 1 },
  { key: 'crossRangeError', label: 'Cross-range error', unit: 'm', factor: 1 },
  { key: 'minimumDetectableSpeed', label: 'Minimum detectable speed', unit: '', factor: 'speed' },
  { key: 'maxDetections', label: 'Most detections per dwell', unit: '', factor: 1 },
];

/** Function 37: the three values a preset sets, after the preset; then function 50's Target revisit, shown in Systematic. */
const DWELL_FIELDS: readonly Field[] = [
  { key: 'searchWidth', label: 'Search width', unit: '°', factor: 1 },
  { key: 'dwellDepth', label: 'Dwell depth', unit: 'km', factor: 1000 },
  { key: 'dwellInterval', label: 'Dwell interval', unit: 's', factor: 1 },
  { key: 'targetRevisitSeconds', label: 'Target revisit', unit: 's', factor: 1 },
];

/** Function 50: why the Revisit interval is greyed in Systematic. */
export const SYSTEMATIC_REVISIT = 'Not used in Systematic: each pass follows the one before.';

/** Function 38. */
const GENERIC_FIELDS: readonly Field[] = [
  { key: 'revisitSeconds', label: 'Revisit time', unit: 's', factor: 1 },
  { key: 'range', label: 'Range', unit: 'km', factor: 1000 },
  { key: 'detectionProbability', label: 'Probability of detection', unit: '', factor: 1 },
  { key: 'positionError', label: 'Position error', unit: 'm', factor: 1 },
  { key: 'maxDetections', label: 'Most detections per report', unit: '', factor: 1 },
];

const KIND_OPTIONS = OFFERED_KINDS.map((k) => ({ value: k, label: KIND_LABELS[k] }));
const PRESET_OPTIONS = (Object.keys(PRESET_LABELS) as Preset[]).map((p) => ({ value: p, label: PRESET_LABELS[p] }));
const MODE_OPTIONS = (Object.keys(MODE_LABELS) as Mode[]).map((m) => ({ value: m, label: MODE_LABELS[m] }));

function shown(si: number, factor: number | 'speed', speed: SpeedUnit): number {
  return factor === 'speed' ? speedIn(si, speed) : si / factor;
}

function toSi(value: number, factor: number | 'speed', speed: SpeedUnit): number {
  return factor === 'speed' ? speedToMps(value, speed) : value * factor;
}

/** A value for its box: at most three decimals, no trailing zeros. */
function text(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

/** The setting typed in `draft`, in SI units, or why it cannot be saved. */
export function checkSetting(key: NumberSetting, draft: string, factor: number | 'speed', speed: SpeedUnit): { readonly value: number } | { readonly error: string } {
  const typed = Number(draft.trim().replace(',', '.'));
  if (draft.trim() === '' || !Number.isFinite(typed)) return { error: 'Type a number' };
  const limit = LIMITS[key];
  const value = toSi(typed, factor, speed);
  const unit = factor === 'speed' ? ` ${SPEED_LABELS[speed]}` : '';
  const scale = (n: number): string => text(shown(n, factor, speed));
  if (value < limit.min - 1e-9 || value > limit.max + 1e-9) return { error: `From ${scale(limit.min)} to ${scale(limit.max)}${unit}` };
  if (limit.whole === true && value !== Math.round(value)) return { error: 'A whole number' };
  return { value: Math.min(limit.max, Math.max(limit.min, value)) };
}

export function SensorsPanel(props: {
  readonly model: SensorsModel;
  readonly coverage: CoverageModel;
  readonly picture: SimulationPicture;
  readonly units: UnitsModel;
  readonly fieldSets: readonly FieldSet[];
  readonly rights: Rights;
  readonly colours: ColoursModel;
  readonly preview: PreviewModel;
}) {
  const { model, picture, rights } = props;
  const state = useModel(model);
  const coverage = useModel(props.coverage);
  const colours = useModel(props.colours);
  useEffect(() => model.watch(), [model]);
  const [open, setOpen] = useState<Uuid | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [kind, setKind] = useState<SensorKind>('GROUND_RADAR');
  const platforms = new Set(state.sensors.map((s) => s.platform));
  const one = state.selection.length === 1 ? picture.object(state.selection[0] ?? '') : undefined;
  const candidate = one !== undefined && picture.isTrack(one) && !platforms.has(one.id) ? one : undefined;
  const newTitle = !rights.edit
    ? EDIT_HINT
    : candidate !== undefined
      ? `Make a sensor on ${one?.properties?.name ?? 'the selected track'}`
      : one !== undefined && platforms.has(one.id)
        ? 'The selected track is already a sensor\'s platform'
        : 'Select one track of the simulation';
  const shownSensor = state.sensors.find((s) => s.platform === open) ?? null;

  return (
    <SimPanel
      label={SENSORS_TITLE}
      actions={
        <Button
          disabled={!rights.edit || candidate === undefined || state.busy}
          title={newTitle}
          onClick={() => {
            if (candidate === undefined) return;
            // With one type offered (M6: ground radars, owner PX) it is made at once; with more, the type is asked.
            const only = OFFERED_KINDS.length === 1 ? OFFERED_KINDS[0] : undefined;
            if (only === undefined) {
              setChoosing(true);
              return;
            }
            void model.create(candidate.id, only).then((ok) => {
              if (ok) setOpen(candidate.id);
            });
          }}
        >
          New sensor
        </Button>
      }
    >
      {/* Function 36: "New sensor" asks for the type when more than one is offered. */}
      <ConfirmDialog
        open={choosing}
        title="New sensor"
        message={<Select label="Type" value={kind} options={KIND_OPTIONS} onChange={setKind} />}
        confirmLabel="Make the sensor"
        onCancel={() => { setChoosing(false); }}
        onConfirm={() => {
          setChoosing(false);
          if (candidate === undefined) return;
          void model.create(candidate.id, kind).then((ok) => {
            if (ok) setOpen(candidate.id);
          });
        }}
      />
      <div className="simulator-panel">
        {/* Function 33 (Q28 A): for every user, read-only ones too, since it changes nothing shared. */}
        <Checkbox
          label="Show coverage"
          checked={coverage.show !== false}
          disabled={coverage.show === null}
          onChange={(on) => void props.coverage.setShow(on)}
        />
        {/* Function 43: under "Show coverage", on by default, per user; read-only users have it too. */}
        <Checkbox
          label="Show dwells"
          checked={coverage.showDwells !== false}
          disabled={coverage.showDwells === null}
          onChange={(on) => void props.coverage.setShowDwells(on)}
        />
        {coverage.saveError === null ? null : <Notice severity="warning">{coverage.saveError}</Notice>}
        {rights.edit ? null : <Notice>{EDIT_HINT}</Notice>}
        {state.readError === null ? null : <Notice severity="warning">{state.readError}</Notice>}
        <FailureNotice failure={state.failure} onDismiss={() => { model.dismissFailure(); }} />
        {state.channels === null ? (
          state.readError === null ? <p className="simulator-muted">Loading the sensors…</p> : null
        ) : state.sensors.length === 0 ? (
          <p className="simulator-muted">No sensors. Select one track of the simulation, then choose New sensor.</p>
        ) : (
          <ul className="simulator-list" aria-label="Sensors">
            {state.sensors.map((s) => (
              <li key={s.platform} className="simulator-item" aria-label={s.name}>
                <div className="simulator-item-head">
                  <Button
                    expanded={open === s.platform}
                    onClick={() => {
                      setOpen(open === s.platform ? null : s.platform);
                    }}
                  >
                    {s.name}
                  </Button>
                  <span className="simulator-muted">{KIND_LABELS[s.settings.type]}</span>
                  {s.missing ? <span className="simulator-state simulator-state-missing">Missing</span> : null}
                </div>
                {s.missing ? <div className="simulator-muted">Its track was deleted: the sensor does nothing.</div> : null}
                {s.outOfRange.map((o) => (
                  <div key={o} className="simulator-muted">Some units are out of range for {o}</div>
                ))}
              </li>
            ))}
          </ul>
        )}
        {shownSensor === null ? null : (
          <SensorForm
            key={`${shownSensor.platform} ${JSON.stringify(shownSensor.settings)}`}
            sensor={shownSensor}
            channels={state.channels ?? []}
            sets={props.fieldSets}
            units={props.units}
            readOnly={!rights.edit}
            busy={state.busy}
            model={model}
            preview={props.preview}
            colour={colourFor(colours.jobArea, picture.object(shownSensor.platform)?.symbol)}
            onRemoved={() => {
              setOpen(null);
            }}
          />
        )}
      </div>
    </SimPanel>
  );
}

function SensorForm(props: {
  readonly sensor: SensorInfo;
  readonly channels: readonly ChannelInfo[];
  readonly sets: readonly FieldSet[];
  readonly units: UnitsModel;
  readonly readOnly: boolean;
  readonly busy: boolean;
  readonly model: SensorsModel;
  readonly preview: PreviewModel;
  readonly colour: string;
  readonly onRemoved: () => void;
}) {
  const { sensor, model, readOnly, preview } = props;
  const speed = useModel(props.units).speed;
  const s = sensor.settings;
  const radar = s.type === 'GROUND_RADAR';
  const [drafts, setDrafts] = useState<Partial<Record<NumberSetting, string>>>({});
  const [preset, setPreset] = useState<Preset>(s.preset);
  const [mode, setMode] = useState<Mode>(s.mode);
  const systematic = radar && mode === 'systematic';
  const [mission, setMission] = useState(s.mission ?? '');
  const [detectAll, setDetectAll] = useState(s.detectAll);
  const [outputs, setOutputs] = useState<readonly string[]>(s.outputs);
  const [removing, setRemoving] = useState(false);
  const fields = radar ? [...RADAR_FIELDS, ...DWELL_FIELDS] : GENERIC_FIELDS;

  const draftOf = (f: Field): string => drafts[f.key] ?? text(shown(s[f.key], f.factor, speed));
  /** The Wide wedge's depth is the whole band, and follows it (A3). */
  const band = (): number | null => {
    const min = checkSetting('minRange', draftOf(RADAR_FIELDS[1] as Field), 1000, speed);
    const max = checkSetting('maxRange', draftOf(RADAR_FIELDS[2] as Field), 1000, speed);
    return 'value' in min && 'value' in max ? Math.max(1_000, Math.min(1_000_000, max.value - min.value)) : null;
  };
  const checked = fields.map((f) => {
    const wide = f.key === 'dwellDepth' && preset === 'wide' ? band() : null;
    const draft = wide === null ? draftOf(f) : text(wide / 1000);
    return { field: f, draft, result: checkSetting(f.key, draft, f.factor, speed) };
  });
  const values: Partial<Record<NumberSetting, number>> = {};
  for (const c of checked) if ('value' in c.result) values[c.field.key] = c.result.value;
  const errors = new Map<NumberSetting, string>();
  for (const c of checked) if ('error' in c.result) errors.set(c.field.key, c.result.error);
  if (radar && values.minRange !== undefined && values.maxRange !== undefined && !(values.minRange < values.maxRange)) errors.set('maxRange', 'Above the min range');
  const missionError = mission.length > MAX_MISSION ? `At most ${String(MAX_MISSION)} characters` : null;
  const changed: Partial<SensorSettings> = {};
  for (const c of checked) {
    const v = values[c.field.key];
    // A chosen preset sets its values on the server part; only "Custom" sends them.
    if (preset !== 'custom' && DWELL_SETTINGS.includes(c.field.key)) continue;
    if (preset !== 'custom' && c.field.key === 'targetRevisitSeconds' && PRESETS[preset].targetRevisitSeconds !== null) continue;
    if (v !== undefined && drafts[c.field.key] !== undefined && Math.abs(v - s[c.field.key]) > 1e-9) (changed as Record<string, number>)[c.field.key] = v;
  }
  if (radar && preset !== s.preset) (changed as { preset: Preset }).preset = preset;
  if (radar && preset === 'custom' && mode !== s.mode) (changed as { mode: Mode }).mode = mode;
  if (mission.trim() !== (s.mission ?? '')) (changed as { mission: string }).mission = mission.trim();
  if (detectAll !== s.detectAll) (changed as { detectAll: boolean }).detectAll = detectAll;
  if (JSON.stringify(outputs) !== JSON.stringify(s.outputs)) (changed as { outputs: readonly string[] }).outputs = outputs;
  const canSave = !readOnly && !props.busy && errors.size === 0 && missionError === null && Object.keys(changed).length > 0;
  // Function 45: the coverage, its labels and the job area drawn at once from the fields; an invalid
  // field keeps the last valid drawing, and leaving the edit brings back the saved one. Nothing is sent.
  const previewKey = errors.size === 0 ? JSON.stringify({ ...s, ...values, detectAll }) : null;
  useEffect(() => {
    if (previewKey !== null) preview.show(sensor.platform, JSON.parse(previewKey) as SensorSettings);
  }, [preview, sensor.platform, previewKey]);
  useEffect(() => () => {
    preview.end(sensor.platform);
  }, [preview, sensor.platform]);
  // Function 36: only the channels that take its type; a chosen one that no longer does is missing.
  const channels = props.channels.filter((c) => takesType(c, s.type));
  const offered = new Set(channels.map((c) => c.id));
  const missingChosen = sensor.outputs.filter((o) => !offered.has(o.id) || o.missing);

  return (
    <section className="simulator-section" aria-label={`Sensor ${sensor.name}`}>
      <h3 className="simulator-heading">{sensor.name}</h3>
      <p className="simulator-muted">{KIND_LABELS[s.type]}</p>
      {fields.map((f) => {
        if (f.key === 'targetRevisitSeconds' && !systematic) return null; // function 50: shown in Systematic only
        const unit = f.factor === 'speed' ? SPEED_LABELS[speed] : f.unit;
        const error = errors.get(f.key);
        const draft = checked.find((c) => c.field.key === f.key)?.draft ?? '';
        const box = (
          <TextField
            key={f.key}
            label={unit === '' ? f.label : `${f.label} (${unit})`}
            value={draft}
            onChange={(t) => {
              const next: Partial<Record<NumberSetting, string>> = { ...drafts, [f.key]: t };
              if (DWELL_SETTINGS.includes(f.key)) {
                // Leaving the Wide wedge keeps the depth it showed, the whole band.
                const wide = preset === 'wide' && f.key !== 'dwellDepth' ? band() : null;
                if (wide !== null) next.dwellDepth = text(wide / 1000);
                setPreset('custom'); // changing one of the three makes it "Custom" (A4)
              }
              if (f.key === 'targetRevisitSeconds' && preset !== 'custom' && PRESETS[preset].targetRevisitSeconds !== null) setPreset('custom');
              setDrafts(next);
            }}
            {...(error === undefined ? {} : { error })}
            readOnly={readOnly}
            disabled={f.key === 'revisitSeconds' && systematic}
            inputMode="decimal"
            autoComplete="off"
            spellCheck={false}
            data
          />
        );
        if (f.key === 'revisitSeconds' && systematic) {
          return (
            <div key={f.key}>
              {box}
              <p className="simulator-muted">{SYSTEMATIC_REVISIT}</p>
            </div>
          );
        }
        if (f.key === 'dwellInterval' && radar) {
          return (
            <div key={f.key}>
              {box}
              <Select
                label="Mode"
                value={mode}
                options={MODE_OPTIONS}
                disabled={readOnly}
                onChange={(m) => {
                  setMode(m);
                  // Changing the mode by hand makes the preset "Custom" (function 50, TT A).
                  if (preset !== 'custom' && PRESETS[preset].mode !== m) {
                    const wide = preset === 'wide' ? band() : null;
                    if (wide !== null) setDrafts({ ...drafts, dwellDepth: text(wide / 1000) });
                    setPreset('custom');
                  }
                }}
              />
            </div>
          );
        }
        if (f.key !== 'searchWidth') return box;
        return (
          <div key="preset">
            <Select
              label="Preset"
              value={preset}
              options={PRESET_OPTIONS}
              disabled={readOnly}
              onChange={(p) => {
                setPreset(p);
                if (p === 'custom') return;
                const values = PRESETS[p];
                const next: Partial<Record<NumberSetting, string>> = { ...drafts, searchWidth: text(values.searchWidth), dwellInterval: text(values.dwellInterval) };
                if (values.dwellDepth !== null) next.dwellDepth = text(values.dwellDepth / 1000);
                if (values.targetRevisitSeconds !== null) next.targetRevisitSeconds = text(values.targetRevisitSeconds);
                setDrafts(next);
                setMode(values.mode);
              }}
            />
            {box}
          </div>
        );
      })}
      <TextField
        label="Mission"
        value={mission}
        onChange={setMission}
        placeholder="None"
        {...(missionError === null ? {} : { error: missionError })}
        readOnly={readOnly}
        autoComplete="off"
        spellCheck={false}
      />
      {radar ? <Checkbox label="Detect all in range" checked={detectAll} disabled={readOnly} onChange={setDetectAll} /> : null}
      <fieldset className="simulator-fieldset">
        <legend>Job area</legend>
        <p className="simulator-muted">{s.jobArea === null ? 'None: the sensor covers its whole area.' : 'Four corners: only tracks inside it are detected.'}</p>
        <div className="simulator-actions">
          <Button disabled={readOnly || props.busy} title={readOnly ? EDIT_HINT : ''} onClick={() => void model.drawJobArea(sensor.platform, 'rectangle', jobAreaStyle(props.colour))}>
            Draw job area
          </Button>
          <Button disabled={readOnly || props.busy} title={readOnly ? EDIT_HINT : ''} onClick={() => void model.drawJobArea(sensor.platform, 'polygon', jobAreaStyle(props.colour))}>
            Draw job area as four points
          </Button>
          <Button disabled={readOnly || props.busy || s.jobArea === null} title={readOnly ? EDIT_HINT : ''} onClick={() => void model.clearJobArea(sensor.platform)}>
            Clear job area
          </Button>
        </div>
      </fieldset>
      <fieldset className="simulator-fieldset">
        <legend>Sensor outputs</legend>
        {channels.length === 0 && missingChosen.length === 0 ? (
          <p className="simulator-muted">{radar ? 'No plugin offers a channel for sensor reports. A gmti out link offers one.' : 'No plugin offers a channel for a generic sensor\'s reports.'}</p>
        ) : null}
        {channels.map((c) => (
          <div key={c.id}>
            <Checkbox
              label={c.name}
              checked={outputs.includes(c.id)}
              disabled={readOnly}
              onChange={(on) => {
                setOutputs(on ? [...outputs, c.id] : outputs.filter((o) => o !== c.id));
              }}
            />
            <div className="simulator-muted">
              {c.plugin} · {c.outputType}
              {c.fieldSet === null ? '' : ` · Field set: ${setLabel(c.fieldSet, props.sets)}`}
            </div>
          </div>
        ))}
        {missingChosen.filter((o) => !offered.has(o.id)).map((o) => (
          <div key={o.id}>
            <Checkbox
              label={`${o.id} (missing)`}
              checked={outputs.includes(o.id)}
              disabled={readOnly}
              onChange={(on) => {
                setOutputs(on ? [...outputs, o.id] : outputs.filter((x) => x !== o.id));
              }}
            />
            <div className="simulator-muted">Chosen, but not offered now. It is used again when it is offered again.</div>
          </div>
        ))}
      </fieldset>
      <div className="simulator-actions">
        <Button variant="primary" disabled={!canSave} title={readOnly ? EDIT_HINT : ''} onClick={() => void model.save(sensor.platform, changed)}>
          Save
        </Button>
        <Button variant="danger" disabled={readOnly || props.busy} title={readOnly ? EDIT_HINT : ''} onClick={() => { setRemoving(true); }}>
          Remove
        </Button>
      </div>
      <ConfirmDialog
        open={removing}
        title="Remove the sensor"
        message={`The sensor on ${sensor.name} will be removed. Its track stays.`}
        confirmLabel="Remove the sensor"
        danger
        onCancel={() => { setRemoving(false); }}
        onConfirm={() => {
          setRemoving(false);
          void model.remove(sensor.platform).then((ok) => {
            if (ok) props.onRemoved();
          });
        }}
      />
    </section>
  );
}

/** The warning at the bottom of the Simulation map (function 29; A105): shown only while there is a line. */
export function SensorWarnings(props: { readonly model: SensorsModel }) {
  const { model } = props;
  const state = useModel(model);
  useEffect(() => model.watch(), [model]);
  const lines = warnings(state);
  if (lines.length === 0) return null;
  return (
    <div className="simulator-warning" role="status" aria-label="Sensor warnings">
      {lines.map((line) => (
        <div key={line}>{line}</div>
      ))}
    </div>
  );
}
