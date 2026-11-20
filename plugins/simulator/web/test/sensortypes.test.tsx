// Sensor types, presets and the job area in the Sensors panel (brief functions 36 to 39; criteria 52,
// 54 and 59 in the browser). The generic sensor's tests, kept for a later milestone (owner, PX), are
// in generic.test.tsx.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { JsonValue } from '@emc2/plugin-sdk';
import { SYSTEMATIC_REVISIT } from '../src/SensorsPanel.tsx';
import { jobAreaOf } from '../src/sensors.ts';
import { activated, feedPicture, panel, SIM_LAYER, symbol, TRACK_1, TRACK_2, VIEW } from './harness.tsx';
import type { Rig } from './harness.tsx';

afterEach(() => {
  cleanup();
});

const RADAR = {
  type: 'GROUND_RADAR', revisitSeconds: 10, minRange: 20_000, maxRange: 150_000, startBearing: 45, endBearing: 135, detectionProbability: 1,
  rangeError: 20, crossRangeError: 50, minimumDetectableSpeed: 0, maxDetections: 200, mission: null, detectAll: false, outputs: [],
  preset: 'medium', searchWidth: 40, dwellDepth: 50_000, dwellInterval: 1, mode: 'random', targetRevisitSeconds: 2, range: 50_000, positionError: 50, jobArea: null,
};
/** A fake gmti channel taking ground radars, and a fake cot channel taking every type (criterion 52). */
const GMTI = { id: 'gmti/vista-out', plugin: 'gmti', name: 'VISTA (out)', outputType: 'gmti', canDelete: false, fields: [], fieldSet: null, maxAreaDepth: null, sensorTypes: ['GROUND_RADAR'], chosen: false };
const COT = { id: 'cot/tak-sensors', plugin: 'cot', name: 'TAK sensors (out)', outputType: 'cot', canDelete: true, fields: [], fieldSet: null, maxAreaDepth: null, sensorTypes: [], chosen: false };
/** Latitude ≠ longitude; four corners in the order drawn, closed. */
const SQUARE = { type: 'Polygon', coordinates: [[[15.0, 58.6], [15.6, 58.6], [15.6, 59.2], [15.0, 59.2], [15.0, 58.6]]] };

function body(sensors: readonly { readonly [key: string]: JsonValue }[]): { readonly [key: string]: JsonValue } {
  return { running: true, pairing: true, channels: [GMTI, COT], sensors };
}

function sensor(settings: { readonly [key: string]: JsonValue }, more: { readonly [key: string]: JsonValue } = {}): { readonly [key: string]: JsonValue } {
  return { platform: TRACK_1, name: 'Hawk 1', missing: false, settings, outputs: [], outOfRange: [], detections: 0, ...more };
}

async function showing(sensors: readonly { readonly [key: string]: JsonValue }[], permissions?: readonly string[]): Promise<Rig> {
  const rig = await activated(permissions === undefined ? {} : { permissions });
  feedPicture(rig.ctx, [symbol(TRACK_1, SIM_LAYER), symbol(TRACK_2, SIM_LAYER)]);
  rig.server.on('GET', 'sensors', { status: 200, body: body(sensors) });
  const Sensors = panel(rig.ctx, 'sensors');
  render(<Sensors />);
  await screen.findByRole(sensors.length === 0 ? 'paragraph' : 'list', sensors.length === 0 ? {} : { name: 'Sensors' });
  return rig;
}

function open(name = 'Hawk 1'): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name }));
  return screen.getByRole('region', { name: `Sensor ${name}` });
}

function value(form: HTMLElement, label: string): string {
  return within(form).getByLabelText<HTMLInputElement>(label).value;
}

async function save(rig: Rig, form: HTMLElement): Promise<unknown> {
  rig.server.on('POST', 'sensors', { status: 200, body: body([sensor(RADAR)]) });
  await act(async () => {
    fireEvent.click(within(form).getByRole('button', { name: 'Save' }));
    await Promise.resolve();
  });
  return rig.server.posts('sensors').at(-1)?.body;
}

describe('sensor types and their outputs (criterion 52)', () => {
  it('offers a ground radar both a gmti channel taking ground radars and a cot channel taking every type', async () => {
    await showing([sensor(RADAR)]);
    const radar = open();
    expect(within(radar).getByText('Ground radar')).toBeDefined();
    expect(within(radar).getByLabelText('VISTA (out)')).toBeDefined();
    expect(within(radar).getByLabelText('TAK sensors (out)')).toBeDefined();
  });
});

describe('presets (criteria 54 and 73)', () => {
  const dwellValues = (form: HTMLElement): string[] => [value(form, 'Search width (°)'), value(form, 'Dwell depth (km)'), value(form, 'Dwell interval (s)')];

  it("each preset sets its table's three values and the Mode, the Narrow wedge also a Target revisit; changing one makes it \"Custom\"; no Empty dwells (T-196)", async () => {
    const rig = await showing([sensor(RADAR)]);
    const form = open();
    const preset = within(form).getByLabelText<HTMLSelectElement>('Preset');
    const mode = within(form).getByLabelText<HTMLSelectElement>('Mode');
    expect(within(preset).getAllByRole('option').map((o) => o.textContent)).toEqual(['Default', 'Narrow wedge', 'Medium wedge', 'Wide wedge', 'Custom']);
    expect(preset.value).toBe('medium');
    expect(mode.value).toBe('random');
    expect(dwellValues(form)).toEqual(['40', '50', '1']);
    expect(within(form).queryByLabelText('Empty dwells (%)')).toBeNull();
    expect(within(form).queryByLabelText('Target revisit (s)')).toBeNull(); // Systematic only (function 50)
    fireEvent.change(preset, { target: { value: 'default' } });
    expect(dwellValues(form)).toEqual(['2', '20', '0.2']); // M7's Narrow wedge (T-191)
    expect(mode.value).toBe('random');
    fireEvent.change(preset, { target: { value: 'narrow' } });
    expect(dwellValues(form)).toEqual(['1.7', '95', '0.1']); // like AFSERS (T-191)
    expect(mode.value).toBe('systematic');
    expect(value(form, 'Target revisit (s)')).toBe('2');
    expect(within(form).getByLabelText<HTMLInputElement>('Revisit interval (s)').disabled).toBe(true);
    expect(within(form).getByText(SYSTEMATIC_REVISIT)).toBeDefined();
    expect(await save(rig, form)).toEqual({ platform: TRACK_1, preset: 'narrow' });
    fireEvent.change(mode, { target: { value: 'random' } });
    expect(preset.value).toBe('custom'); // changing the mode by hand (function 50, TT A)
    expect(within(form).getByLabelText<HTMLInputElement>('Revisit interval (s)').disabled).toBe(false);
    expect(await save(rig, form)).toEqual({ platform: TRACK_1, preset: 'custom', searchWidth: 1.7, dwellDepth: 95_000, dwellInterval: 0.1 });
    fireEvent.change(preset, { target: { value: 'wide' } });
    expect(dwellValues(form)).toEqual(['180', '130', '4']);
    expect(mode.value).toBe('random');
    fireEvent.change(within(form).getByLabelText('Max range (km)'), { target: { value: '200' } });
    expect(value(form, 'Dwell depth (km)')).toBe('180'); // the whole band follows the band (A3)
    expect(await save(rig, form)).toEqual({ platform: TRACK_1, maxRange: 200_000, preset: 'wide' });
    fireEvent.change(within(form).getByLabelText('Dwell interval (s)'), { target: { value: '3' } });
    expect(preset.value).toBe('custom');
    expect(await save(rig, form)).toEqual({ platform: TRACK_1, maxRange: 200_000, preset: 'custom', searchWidth: 180, dwellDepth: 180_000, dwellInterval: 3 });
    fireEvent.change(mode, { target: { value: 'systematic' } });
    fireEvent.change(within(form).getByLabelText('Target revisit (s)'), { target: { value: '0.4' } });
    expect(within(form).getByText('From 0.5 to 60')).toBeDefined();
  });
});

describe('the job area (criterion 59)', () => {
  it('draws a rectangle, dotted (from M7 3 px with a faint fill, function 41), and saves its four corners closed in the order drawn', async () => {
    const rig = await showing([sensor(RADAR)]);
    const form = open();
    rig.server.on('POST', 'sensors', { status: 200, body: body([sensor({ ...RADAR, jobArea: SQUARE })]) });
    fireEvent.click(within(form).getByRole('button', { name: 'Draw job area' }));
    expect(rig.map.runningInteraction).toBe('draw:rectangle');
    expect(rig.map.drawCalls.at(-1)?.style).toMatchObject({ strokeDash: 'dot', strokeWidth: 3, fillOpacity: 0.15 });
    await act(async () => {
      rig.map.completeDrawing(SQUARE as never);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(rig.server.posts('sensors').at(-1)?.body).toEqual({ platform: TRACK_1, jobArea: SQUARE });
  });

  it('accepts four points and refuses five with the message; "Clear job area" removes it', async () => {
    const rig = await showing([sensor({ ...RADAR, jobArea: SQUARE })]);
    const form = open();
    fireEvent.click(within(form).getByRole('button', { name: 'Draw job area as four points' }));
    expect(rig.map.runningInteraction).toBe('draw:polygon');
    await act(async () => {
      rig.map.completeDrawing({ type: 'Polygon', coordinates: [[[15.0, 58.6], [15.6, 58.6], [15.7, 58.9], [15.6, 59.2], [15.0, 59.2], [15.0, 58.6]]] } as never);
      await Promise.resolve();
    });
    expect(screen.getByText('A job area has four corners')).toBeDefined();
    expect(rig.server.posts('sensors')).toHaveLength(0);
    rig.server.on('POST', 'sensors', { status: 200, body: body([sensor(RADAR)]) });
    await act(async () => {
      fireEvent.click(within(form).getByRole('button', { name: 'Clear job area' }));
      await Promise.resolve();
    });
    expect(rig.server.posts('sensors').at(-1)?.body).toEqual({ platform: TRACK_1, jobArea: null });
  });

  it('takes a four-point polygon closed or not, and nothing else', () => {
    const corners = [[15.0, 58.6], [15.6, 58.6], [15.6, 59.2], [15.0, 59.2]];
    expect(jobAreaOf({ type: 'Polygon', coordinates: [corners] })).toEqual(SQUARE);
    expect(jobAreaOf(SQUARE)).toEqual(SQUARE);
    expect(jobAreaOf({ type: 'Polygon', coordinates: [corners.slice(0, 3)] })).toBeNull();
    expect(jobAreaOf({ type: 'Circle', coordinates: [15, 58] })).toBeNull();
    expect(jobAreaOf(null)).toBeNull();
  });

  it('is for users with the edit right only', async () => {
    await showing([sensor({ ...RADAR, jobArea: SQUARE })], [VIEW]);
    const form = open();
    for (const name of ['Draw job area', 'Draw job area as four points', 'Clear job area']) {
      expect(within(form).getByRole('button', { name })).toHaveProperty('disabled', true);
    }
  });
});
