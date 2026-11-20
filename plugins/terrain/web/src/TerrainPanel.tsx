import { useSyncExternalStore } from 'react';
import { Button, Notice, PanelFoot, TextField, type CoordinateService } from '@emc2/plugin-sdk';
import { formatBearing, formatDistance, formatHeight, formatPosition } from './format.ts';
import { formProblems, type TerrainController, type TerrainState, type ViewshedForm } from './controller.ts';
import { bandColor } from './overlay.ts';

/** One labelled value of a result. */
function Row(props: { readonly label: string; readonly value: string }) {
  return (
    <>
      <dt className="terrain-label">{props.label}</dt>
      <dd className="terrain-value">{props.value}</dd>
    </>
  );
}

function RangeSection(props: { readonly state: TerrainState; readonly controller: TerrainController; readonly coordinates: CoordinateService | null }) {
  const { state, controller, coordinates } = props;
  const on = state.rangeTool !== 'off';
  const hint =
    state.rangeTool === 'first' ? 'Click the first point on the map. Escape ends the tool.' : state.rangeTool === 'second' ? 'Click the second point. Escape ends the tool.' : null;
  return (
    <section className="terrain-section" aria-label="Range and bearing">
      <h3 className="terrain-heading">Range and bearing</h3>
      <div className="terrain-actions">
        <Button variant={on ? 'normal' : 'primary'} onClick={() => void controller.toggleRange()}>
          {on ? 'Stop' : 'Pick two points'}
        </Button>
      </div>
      {hint !== null && <p className="terrain-hint">{hint}</p>}
      {state.rangeBusy && <Notice>Computing…</Notice>}
      {state.rangeError !== null && <Notice severity="error">{state.rangeError}</Notice>}
      {state.range !== null && state.rangeFrom !== null && state.rangeTo !== null && (
        <dl className="terrain-results" aria-label="Range and bearing result">
          <Row label="Distance" value={formatDistance(state.range.distance)} />
          <Row label="Initial bearing" value={formatBearing(state.range.initialBearing)} />
          <Row label="Final bearing" value={formatBearing(state.range.finalBearing)} />
          <Row label="Back bearing" value={formatBearing(state.range.backBearing)} />
          <Row label="From" value={formatPosition(state.rangeFrom, coordinates)} />
          <Row label="To" value={formatPosition(state.rangeTo, coordinates)} />
        </dl>
      )}
    </section>
  );
}

/** The notice about the height data; each tool says what it cannot do without it (`what`: "viewsheds" or "height maps"). */
function heightNotice(state: TerrainState, what: 'viewsheds' | 'height maps'): string | null {
  switch (state.heights?.state) {
    case 'notSet':
      return `The height folder is not set, so ${what} are not available. An administrator sets it in the terrain settings. Range and bearing work without it.`;
    case 'notReadable':
      return `The height folder cannot be read${state.heights.reason === '' ? '' : ` (${state.heights.reason})`}, so ${what} are not available. Ask an administrator to check the terrain settings.`;
    case 'noFolders':
      return `This server cannot read the height folder yet, so ${what} are not available.`;
    case 'ready':
      return state.heights.cells === 0 ? 'The height folder holds no usable DTED cells.' : null;
    default:
      return null;
  }
}

function ViewshedSection(props: { readonly state: TerrainState; readonly controller: TerrainController }) {
  const { state, controller } = props;
  const problems = formProblems(state.form, state.maxRange);
  const invalid = Object.keys(problems).length > 0;
  const heightsMissing = state.heights !== null && state.heights.state !== 'ready' && state.heights.state !== 'building';
  const noCells = state.heights?.state === 'ready' && state.heights.cells === 0;
  const unavailable = heightsMissing || noCells;
  const notice = heightNotice(state, 'viewsheds');
  const set = (changes: Partial<ViewshedForm>) => {
    controller.setForm(changes);
  };
  const result = state.viewshed?.result ?? null;
  const disabledReason = state.computing ? 'A viewshed is being computed.' : state.mapComputing ? 'A height map is being computed.' : invalid ? 'Correct the fields first.' : unavailable ? 'There is no height data.' : undefined;
  return (
    <section className="terrain-section" aria-label="Viewshed">
      <h3 className="terrain-heading">Viewshed</h3>
      {notice !== null && <Notice severity="warning">{notice}</Notice>}
      <div className="terrain-fields">
        <TextField label="Observer height above ground (m)" value={state.form.observerHeight} data inputMode="decimal" autoComplete="off" spellCheck={false} onChange={(v) => { set({ observerHeight: v }); }} {...(problems.observerHeight === undefined ? {} : { error: problems.observerHeight })} />
        <TextField label="Target height above ground (m)" value={state.form.targetHeight} data inputMode="decimal" autoComplete="off" spellCheck={false} onChange={(v) => { set({ targetHeight: v }); }} {...(problems.targetHeight === undefined ? {} : { error: problems.targetHeight })} />
        <TextField label="Maximum range (m)" value={state.form.maxRange} data inputMode="decimal" autoComplete="off" spellCheck={false} onChange={(v) => { set({ maxRange: v }); }} {...(problems.maxRange === undefined ? {} : { error: problems.maxRange })} />
      </div>
      <div className="terrain-actions">
        <Button variant="primary" disabled={(disabledReason !== undefined && !state.picking) || state.computing || state.mapComputing} {...(disabledReason === undefined ? {} : { title: disabledReason })} onClick={() => void controller.startViewshed()}>
          {state.picking ? 'Cancel' : 'Pick the observer'}
        </Button>
      </div>
      {state.picking && <p className="terrain-hint">Click the observer's point on the map. Escape cancels.</p>}
      {state.computing && <Notice>Computing…</Notice>}
      {state.viewshedError !== null && <Notice severity="error">{state.viewshedError}</Notice>}
      {result !== null && (
        <>
          <dl className="terrain-results" aria-label="Viewshed result">
            <Row label="Data" value={`DTED level ${String(result.level)}, ${String(result.cells)} ${result.cells === 1 ? 'cell' : 'cells'} read`} />
            <Row label="Areas" value={String(result.areas.length)} />
            <Row label="Time" value={result.millis < 1000 ? `${String(result.millis)} ms` : `${(result.millis / 1000).toFixed(1)} s`} />
          </dl>
          {result.partlyWithoutData && <Notice severity="warning">Partly without data: some ground within range has no height data and is not shown as visible.</Notice>}
          {result.notes.map((note) => (
            <Notice key={note}>{note}</Notice>
          ))}
        </>
      )}
    </section>
  );
}

/** The 16 steps from the lowest height to the highest, each in the colour it has on the map (the brief's function 10). */
function Legend(props: { readonly bands: readonly { readonly index: number; readonly lowest: number; readonly highest: number }[] }) {
  const { bands } = props;
  const first = bands[0];
  const last = bands[bands.length - 1];
  if (first === undefined || last === undefined) return null;
  return (
    <div className="terrain-legend">
      <div className="terrain-legend-steps" role="img" aria-label={`Height bands from ${formatHeight(first.lowest)} to ${formatHeight(last.highest)}`}>
        {bands.map((band) => (
          <span
            key={band.index}
            className="terrain-legend-step"
            title={`${formatHeight(band.lowest)} to ${formatHeight(band.highest)}`}
            style={{ background: bandColor(band.index, bands.length) }}
          />
        ))}
      </div>
      <div className="terrain-legend-ends">
        <span>{formatHeight(first.lowest)}</span>
        <span>{formatHeight(last.highest)}</span>
      </div>
    </div>
  );
}

function HeightMapSection(props: { readonly state: TerrainState; readonly controller: TerrainController }) {
  const { state, controller } = props;
  const heightsMissing = state.heights !== null && state.heights.state !== 'ready' && state.heights.state !== 'building';
  const noCells = state.heights?.state === 'ready' && state.heights.cells === 0;
  const unavailable = heightsMissing || noCells;
  const notice = heightNotice(state, 'height maps');
  const busy = state.mapComputing || state.computing;
  const disabledReason = busy ? 'A viewshed or a height map is being computed.' : unavailable ? 'There is no height data.' : undefined;
  const shown = state.heightMap;
  const result = shown?.result ?? null;
  const limit = String(Math.round(state.maxRange / 10) / 100);
  return (
    <section className="terrain-section" aria-label="Height map">
      <h3 className="terrain-heading">Height map</h3>
      {notice !== null && <Notice severity="warning">{notice}</Notice>}
      <div className="terrain-actions">
        <Button variant="primary" disabled={(disabledReason !== undefined && !state.drawing) || busy} {...(disabledReason === undefined ? {} : { title: disabledReason })} onClick={() => void controller.startHeightMap()}>
          {state.drawing ? 'Cancel' : 'Draw a circle'}
        </Button>
      </div>
      <p className="terrain-hint">{state.drawing ? 'Press on the centre and drag to the radius. Escape cancels.' : `A circle of 100 m to ${limit} km. The height is above mean sea level.`}</p>
      {state.mapComputing && <Notice>Computing…</Notice>}
      {state.heightMapError !== null && <Notice severity="error">{state.heightMapError}</Notice>}
      {result !== null && (
        <>
          <dl className="terrain-results" aria-label="Height map result">
            <Row label="Highest" value={formatHeight(result.highestHeight)} />
            <Row label="Lowest" value={formatHeight(result.lowest)} />
            <Row label="Data" value={`DTED level ${String(result.level)}, ${String(result.cells)} ${result.cells === 1 ? 'cell' : 'cells'} read`} />
            <Row label="Time" value={result.millis < 1000 ? `${String(result.millis)} ms` : `${(result.millis / 1000).toFixed(1)} s`} />
          </dl>
          <Legend bands={result.bands} />
          {result.partlyWithoutData && <Notice severity="warning">Partly without data: some ground inside the circle has no height data and is not shown.</Notice>}
          {result.notes.map((note) => (
            <Notice key={note}>{note}</Notice>
          ))}
        </>
      )}
    </section>
  );
}

/** The terrain panel (the brief's function 1): range and bearing, the viewshed, the height map and Clear. */
export function TerrainPanel(props: { readonly controller: TerrainController; readonly coordinates: CoordinateService | null }) {
  const state = useSyncExternalStore(props.controller.subscribe, props.controller.getState);
  const hasResult = state.range !== null || state.viewshed !== null || state.rangePending !== null || state.heightMap !== null;
  // The shell's head shows the title once (SDK 1.8.0 part C), so there is no heading here. Clear acts on all three
  // tools' results, the whole body, so it is the panel's foot, which the shell keeps at the bottom while the body scrolls.
  return (
    <div className="terrain-content">
      {state.overlayError !== null && <Notice severity="error">{state.overlayError}</Notice>}
      <RangeSection state={state} controller={props.controller} coordinates={props.coordinates} />
      <ViewshedSection state={state} controller={props.controller} />
      <HeightMapSection state={state} controller={props.controller} />
      <PanelFoot>
        <Button disabled={!hasResult && !state.picking && !state.drawing && !state.computing && !state.mapComputing && state.rangeTool === 'off'} title="Removes the results from the map" onClick={() => { props.controller.clear(); }}>
          Clear
        </Button>
      </PanelFoot>
    </div>
  );
}
