// M7's sensor package in the web part (brief functions 41, 43, 45 and 46; criteria 61, 63, 67, 68 and
// 69; T-177, T-179, T-184, T-185).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JsonValue, MapObject, OverlayArea, OverlayItem, OverlayLabel, Position } from '@emc2/plugin-sdk';
import { coloursOf, coverageLabels, coverageRings, direct, km } from '../src/coverage.ts';
import { parseDwells } from '../src/dwells.ts';
import type { SensorSettings } from '../src/sensors.ts';
import { activated, feedPicture, panel, settled, SIM_LAYER, symbol, TRACK_1, TRACK_2 } from './harness.tsx';
import type { Rig } from './harness.tsx';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

/** Latitude ≠ longitude. */
const PLATFORM: Position = [15.2, 58.41];
const HOSTILE = '10061000001211000000';
const FRIEND = '10031000001211000000';

const BAND: SensorSettings = {
  revisitSeconds: 10, minRange: 20_000, maxRange: 150_000, startBearing: 45, endBearing: 135, detectionProbability: 1,
  rangeError: 20, crossRangeError: 50, minimumDetectableSpeed: 0, maxDetections: 200, mission: null, detectAll: false, outputs: [],
  type: 'GROUND_RADAR', preset: 'medium', searchWidth: 40, dwellDepth: 50_000, dwellInterval: 1, mode: 'random', targetRevisitSeconds: 2, range: 50_000, positionError: 50, jobArea: null,
};
const SQUARE: Position[] = [[15.0, 58.6], [15.6, 58.6], [15.6, 59.2], [15.0, 59.2], [15.0, 58.6]];

/** Metres between two nearby positions (a local flat approximation). */
function apart(a: Position | undefined, b: Position): number {
  if (a === undefined) return Infinity;
  const north = (a[1] - b[1]) * 111_320;
  const east = (a[0] - b[0]) * 111_320 * Math.cos((b[1] * Math.PI) / 180);
  return Math.hypot(north, east);
}

function platform(direction: number, sidc = HOSTILE): MapObject {
  const base = symbol(TRACK_1, SIM_LAYER);
  return { ...base, geometry: { type: 'Point', coordinates: PLATFORM }, symbol: { standard: 'APP-6D', sidc, modifiers: { direction } } };
}

function sensor(settings: SensorSettings = BAND): { readonly [key: string]: JsonValue } {
  return { platform: TRACK_1, name: 'Hawk 1', missing: false, settings: settings as unknown as JsonValue, outputs: [], outOfRange: [], detections: 0 };
}

function sensorsBody(running: boolean, dwells: number, settings: SensorSettings = BAND): JsonValue {
  return { running, pairing: false, channels: [], sensors: [sensor(settings)], dwells };
}

async function drawn(options: { readonly running?: boolean; readonly settings?: SensorSettings; readonly sidc?: string; readonly documents?: { readonly [name: string]: JsonValue } } = {}): Promise<Rig> {
  const rig = await activated({
    sensors: sensorsBody(options.running ?? false, 0, options.settings),
    ...(options.documents === undefined ? {} : { userDocuments: options.documents }),
  });
  await act(async () => {
    feedPicture(rig.ctx, [platform(30, options.sidc), symbol(TRACK_2, SIM_LAYER)]);
    await settled();
  });
  return rig;
}

function last(rig: Rig): readonly OverlayItem[] {
  return rig.map.overlayItems.at(-1) ?? [];
}

function areas(rig: Rig): readonly OverlayArea[] {
  return last(rig).filter((i): i is OverlayArea => i.kind === 'area');
}

function labels(rig: Rig): readonly OverlayLabel[] {
  return last(rig).filter((i): i is OverlayLabel => i.kind === 'label');
}

/** The dwells: the 2 px areas (the coverage is 1.5 px dashed, the job area 3 px dotted). */
function dwellAreas(rig: Rig): readonly OverlayArea[] {
  return areas(rig).filter((a) => a.style?.strokeWidth === 2);
}

// ---- Function 45: the labels (criterion 67) ----

describe('the bearing and range labels (criterion 67)', () => {
  it('a sensor of 45° to 135° and 20 to 150 km has four, each within 1 % of the range from the middle of its edge or arc', () => {
    const found = coverageLabels(PLATFORM, 0, BAND, '#FF3031');
    expect(found.map((l) => l.text)).toEqual(['45°', '135°', '150 km', '20 km']);
    const expected: Position[] = [direct(PLATFORM, 45, 85_000), direct(PLATFORM, 135, 85_000), direct(PLATFORM, 90, 150_000), direct(PLATFORM, 90, 20_000)];
    found.forEach((l, i) => {
      expect(apart(l.position, expected[i] as Position)).toBeLessThan(1_500);
      expect(l.style).toEqual({ color: '#FF3031', size: 12 }); // the map view's own halo
    });
  });

  it('turns with the heading, and shows the bearings as set (M7-S6)', () => {
    const found = coverageLabels(PLATFORM, 90, BAND, '#FF3031');
    expect(found.map((l) => l.text)).toEqual(['45°', '135°', '150 km', '20 km']);
    expect(apart(found[0]?.position, direct(PLATFORM, 135, 85_000))).toBeLessThan(1);
    expect(apart(found[2]?.position, direct(PLATFORM, 180, 150_000))).toBeLessThan(1);
  });

  it('looking all round (0° to 360°) only the range labels, ahead (owner, 2026-11-12); with a min range of 0 no "0 km"; one decimal at most', () => {
    const round = coverageLabels(PLATFORM, 30, { ...BAND, startBearing: 0, endBearing: 360 }, '#FF3031');
    expect(round.map((l) => l.text)).toEqual(['150 km', '20 km']);
    expect(apart(round[0]?.position, direct(PLATFORM, 30, 150_000))).toBeLessThan(1);
    expect(coverageLabels(PLATFORM, 0, { ...BAND, minRange: 0 }, '#FF3031').map((l) => l.text)).toEqual(['45°', '135°', '150 km']);
    expect(coverageLabels(PLATFORM, 0, { ...BAND, detectAll: true }, '#FF3031').map((l) => l.text)).toEqual(['150 km']);
    expect([km(12_500), km(50_000), km(12_449)]).toEqual(['12.5 km', '50 km', '12.4 km']);
  });

  it('are drawn with "Show coverage", in the coverage\'s colour, and count with the areas against the caps', async () => {
    const rig = await drawn();
    await waitFor(() => {
      expect(labels(rig).map((l) => l.text)).toEqual(['45°', '135°', '150 km', '20 km']);
    });
    expect(labels(rig)[0]?.style?.color).toBe('#FD0909');
    expect(rig.map.overlayProblems.at(-1)).toBeNull();
  });
});

// ---- Function 45: the live preview (criterion 68) ----

describe('the live preview (criterion 68)', () => {
  it('redraws the coverage and its label at once from the fields; an invalid field keeps the last valid drawing; leaving gives back the saved; nothing is sent', async () => {
    const rig = await drawn();
    const Sensors = panel(rig.ctx, 'sensors');
    render(<Sensors />);
    fireEvent.click(await screen.findByRole('button', { name: 'Hawk 1' }));
    const form = screen.getByRole('region', { name: 'Sensor Hawk 1' });
    const coverage = (): Position[][] | undefined => areas(rig).find((a) => a.style?.strokeDash === 'dash')?.rings as Position[][] | undefined;
    await act(async () => {
      fireEvent.change(within(form).getByLabelText('Max range (km)'), { target: { value: '100' } });
      await settled();
    });
    expect(coverage()).toEqual(coverageRings(PLATFORM, 30, { ...BAND, maxRange: 100_000 }));
    expect(labels(rig).map((l) => l.text)).toContain('100 km');
    await act(async () => {
      fireEvent.change(within(form).getByLabelText('Max range (km)'), { target: { value: 'x' } });
      await settled();
    });
    expect(coverage()).toEqual(coverageRings(PLATFORM, 30, { ...BAND, maxRange: 100_000 }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Hawk 1' }));
      await settled();
    });
    expect(coverage()).toEqual(coverageRings(PLATFORM, 30, BAND));
    expect(labels(rig).map((l) => l.text)).toContain('150 km');
    expect(rig.server.posts()).toEqual([]);
  });
});

// ---- Function 46: the colours (criteria 61 and 69) ----

describe('the colours (criterion 69)', () => {
  it('by default fixed (criterion 77, T-189): the coverage and its labels #FD0909, the job area #BDCF3D, the dwells #7EF26A', async () => {
    const rig = await drawn({ sidc: FRIEND, settings: { ...BAND, jobArea: { type: 'Polygon', coordinates: [SQUARE] } } });
    rig.server.on('GET', 'sensors/dwells', { status: 200, body: { seq: 3, whole: true, sensors: [{ platform: TRACK_1, dwells: [dwell(0, 45, 85)] }] } });
    const Sensors = panel(rig.ctx, 'sensors');
    render(<Sensors />);
    await act(async () => {
      fireEvent.click(await screen.findByRole('checkbox', { name: 'Show dwells' }));
      await settled();
      fireEvent.click(screen.getByRole('checkbox', { name: 'Show dwells' })); // off and on again: read anew
      await settled();
    });
    await waitFor(() => {
      expect(dwellAreas(rig)).toHaveLength(1);
    });
    expect(areas(rig)[0]?.style).toEqual({ strokeColor: '#BDCF3D', strokeWidth: 3, strokeDash: 'dot', fillColor: '#BDCF3D', fillOpacity: 0.15 });
    expect(areas(rig)[1]?.style?.strokeColor).toBe('#FD0909');
    expect(labels(rig).every((l) => l.style?.color === '#FD0909')).toBe(true);
    expect(dwellAreas(rig)[0]?.style?.strokeColor).toBe('#7EF26A');
    expect(coloursOf({ dwellColour: { use: 'fixed', colour: 'green' } }).dwell).toEqual({ use: 'fixed', colour: '#7EF26A' });
  });

  it('identity still selectable: a friend platform\'s coverage, labels and job area take #00A8DC', async () => {
    const rig = await drawn({ sidc: FRIEND, settings: { ...BAND, jobArea: { type: 'Polygon', coordinates: [SQUARE] } } });
    act(() => {
      rig.ctx.changeSettings({ outputStaleSeconds: 5, jobAreaColour: { use: 'identity' }, coverageColour: { use: 'identity' }, dwellColour: { use: 'identity' } });
    });
    rig.server.on('GET', 'sensors/dwells', { status: 200, body: { seq: 3, whole: true, sensors: [{ platform: TRACK_1, dwells: [dwell(0, 45, 85)] }] } });
    await waitFor(() => {
      expect(areas(rig)).toHaveLength(2);
    });
    // Criterion 61: the job area first, its fill its outline's colour.
    expect(areas(rig)[0]?.style).toEqual({ strokeColor: '#00A8DC', strokeWidth: 3, strokeDash: 'dot', fillColor: '#00A8DC', fillOpacity: 0.15 });
    expect(areas(rig)[1]?.style?.strokeColor).toBe('#00A8DC');
    expect(labels(rig).every((l) => l.style?.color === '#00A8DC')).toBe(true);
  });

  it('a fixed colour for each of the three, applied at once on a settings change, without a reload', async () => {
    const rig = await drawn({ settings: { ...BAND, jobArea: { type: 'Polygon', coordinates: [SQUARE] } } });
    rig.server.on('GET', 'sensors/dwells', { status: 200, body: { seq: 3, whole: true, sensors: [{ platform: TRACK_1, dwells: [dwell(0, 45, 85)] }] } });
    const Sensors = panel(rig.ctx, 'sensors');
    render(<Sensors />);
    await act(async () => {
      fireEvent.click(await screen.findByRole('checkbox', { name: 'Show dwells' }));
      await settled();
      fireEvent.click(screen.getByRole('checkbox', { name: 'Show dwells' })); // off and on again: read anew
      await settled();
    });
    await waitFor(() => {
      expect(dwellAreas(rig)).toHaveLength(1);
    });
    expect(areas(rig)[1]?.style?.strokeColor).toBe('#FD0909');
    act(() => {
      rig.ctx.changeSettings({
        outputStaleSeconds: 5,
        coverageColour: { use: 'fixed', colour: '#00FFFF' },
        jobAreaColour: { use: 'fixed', colour: '#FF00FF' },
        dwellColour: { use: 'fixed', colour: '#FFFFFF' },
      });
    });
    expect(areas(rig)[0]?.style).toMatchObject({ strokeColor: '#FF00FF', fillColor: '#FF00FF' });
    expect(areas(rig)[1]?.style?.strokeColor).toBe('#00FFFF');
    expect(labels(rig).every((l) => l.style?.color === '#00FFFF')).toBe(true);
    expect(dwellAreas(rig)[0]?.style).toEqual({ strokeColor: '#FFFFFF', strokeWidth: 2, fillOpacity: 0 });
    act(() => {
      rig.ctx.changeSettings({ outputStaleSeconds: 5, coverageColour: { use: 'identity', colour: '#00FFFF' } });
    });
    expect(areas(rig)[1]?.style?.strokeColor).toBe('#FF3031');
  });
});

// ---- Function 43: the dwells (criterion 63, in the browser) ----

function dwell(index: number, from: number, to: number, revisit = 0): JsonValue {
  return { index, revisit, time: '2026-11-12T08:00:00Z', area: { type: 'ArcBand', center: PLATFORM, innerRadius: 20_000, outerRadius: 70_000, startBearing: from, endBearing: to } };
}

describe('the dwells (criterion 63)', () => {
  it('parses the endpoint\'s answer, and refuses another shape', () => {
    const parsed = parseDwells({ seq: 7, whole: false, sensors: [{ platform: TRACK_1, dwells: [dwell(0, 45, 85)] }] });
    expect(parsed?.seq).toBe(7);
    expect(parsed?.whole).toBe(false);
    expect(parsed?.sets.get(TRACK_1)?.[0]?.area).toEqual({ type: 'ArcBand', center: PLATFORM, innerRadius: 20_000, outerRadius: 70_000, startBearing: 45, endBearing: 85 });
    expect(parseDwells({ seq: 7, sensors: [{ platform: TRACK_1, dwells: [{ index: 0 }] }] })).toBeNull();
    expect(parseDwells(null)).toBeNull();
  });

  it('appear as 2 px solid outlines while the simulation runs, read about once a second; stay while paused; go on a reset and with "Show dwells" off; the choice survives a reload', async () => {
    vi.useFakeTimers();
    let seq = 4;
    let sets: JsonValue = [{ platform: TRACK_1, dwells: [dwell(0, 45, 85), dwell(1, 85, 125)] }];
    const rig = await drawn({ running: true });
    rig.server.on('GET', 'sensors/dwells', () => {
      const path = rig.server.calls.at(-1)?.path ?? '';
      const since = path.includes('since=') ? Number(path.split('since=')[1]) : null;
      return since === seq ? { status: 304 } : { status: 200, body: { seq, whole: true, sensors: sets } };
    });
    rig.server.on('GET', 'sensors', { status: 200, body: sensorsBody(true, seq) });
    const reads = (): number => rig.server.calls.filter((c) => c.path.startsWith('sensors/dwells')).length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    expect(dwellAreas(rig)).toHaveLength(2);
    expect(dwellAreas(rig)[0]).toEqual({ kind: 'area', rings: coverageRings(PLATFORM, 0, { ...BAND, startBearing: 45, endBearing: 85, minRange: 20_000, maxRange: 70_000 }), style: { strokeColor: '#7EF26A', strokeWidth: 2, fillOpacity: 0 }, displayClass: 'dwell-area' });
    const before = reads();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(reads() - before).toBeGreaterThanOrEqual(2); // about once a second while it runs (304s)
    seq = 5;
    sets = [{ platform: TRACK_1, dwells: [dwell(0, 45, 85, 1), dwell(1, 85, 125), dwell(2, 125, 135)] }];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    expect(dwellAreas(rig)).toHaveLength(3);

    // Paused: one read after the pause, then none while nothing changes; the dwells stay.
    rig.server.on('GET', 'sensors', { status: 200, body: sensorsBody(false, seq) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    const paused = reads();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(reads()).toBe(paused);
    expect(dwellAreas(rig)).toHaveLength(3);

    // A reset while paused: the sensors' answer names a new number, so the dwells are read and go.
    seq = 6;
    sets = [{ platform: TRACK_1, dwells: [] }];
    rig.server.on('GET', 'sensors', { status: 200, body: sensorsBody(false, seq) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    expect(dwellAreas(rig)).toEqual([]);
    expect(areas(rig)).toHaveLength(1); // the coverage stays

    // "Show dwells" off: none drawn; saved for the user; off after a reload.
    seq = 7;
    sets = [{ platform: TRACK_1, dwells: [dwell(0, 45, 85)] }];
    rig.server.on('GET', 'sensors', { status: 200, body: sensorsBody(false, seq) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_100);
    });
    expect(dwellAreas(rig)).toHaveLength(1);
    const Sensors = panel(rig.ctx, 'sensors');
    render(<Sensors />);
    const box = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Show dwells' });
    expect(box.checked).toBe(true);
    await act(async () => {
      fireEvent.click(box);
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(dwellAreas(rig)).toEqual([]);
    expect(rig.ctx.storedUserDocuments['sensors-view']).toEqual({ showCoverage: true, showDwells: false });
    expect(rig.server.posts()).toEqual([]);
    cleanup();
    vi.useRealTimers();

    const reloaded = await drawn({ documents: { 'sensors-view': { showCoverage: true, showDwells: false } } });
    reloaded.server.on('GET', 'sensors/dwells', { status: 200, body: { seq: 1, whole: true, sensors: [{ platform: TRACK_1, dwells: [dwell(0, 45, 85)] }] } });
    await act(settled);
    expect(dwellAreas(reloaded)).toEqual([]);
    const Again = panel(reloaded.ctx, 'sensors');
    render(<Again />);
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Show dwells' }).checked).toBe(false);
    });
  });
});

// ---- Function 47: the display classes (criterion 70; SDK 1.6.0 part D) ----

describe('the display classes (criterion 70)', () => {
  it('mark the coverage, its labels and the job area sensor-coverage, and the dwells dwell-area, which the overlay takes', async () => {
    vi.useFakeTimers();
    const withJob: SensorSettings = { ...BAND, jobArea: { type: 'Polygon', coordinates: [SQUARE] } };
    const rig = await drawn({ running: true, settings: withJob });
    rig.server.on('GET', 'sensors/dwells', { status: 200, body: { seq: 1, whole: true, sensors: [{ platform: TRACK_1, dwells: [dwell(0, 45, 85)] }] } });
    rig.server.on('GET', 'sensors', { status: 200, body: sensorsBody(true, 1, withJob) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_100);
    });
    expect(last(rig).filter((i) => i.kind === 'area' && i.style?.strokeWidth === 2).map((i) => i.displayClass)).toEqual(['dwell-area']);
    const others = last(rig).filter((i) => i.displayClass !== 'dwell-area');
    // The job area, the coverage and its four labels.
    expect(others.map((i) => [i.kind, i.displayClass])).toEqual([
      ['area', 'sensor-coverage'], ['area', 'sensor-coverage'],
      ['label', 'sensor-coverage'], ['label', 'sensor-coverage'], ['label', 'sensor-coverage'], ['label', 'sensor-coverage'],
    ]);
    expect(rig.map.overlayProblems.at(-1)).toBeNull();
  });
});
