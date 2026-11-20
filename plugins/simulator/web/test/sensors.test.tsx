// The Sensors panel and the warning over the map (brief functions 27, 29 and 31; criteria 35, 45 and
// 48 in the browser; A105, A106; the owner's units answer of 2026-11-08).
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { FieldSet, JsonValue } from '@emc2/plugin-sdk';
import { activated, feedPicture, panel, SIM_LAYER, symbol, TRACK_1, TRACK_2, VIEW } from './harness.tsx';
import type { Rig } from './harness.tsx';

afterEach(() => {
  cleanup();
});

const SETS: readonly FieldSet[] = [{ id: 'gmti.report', plugin: 'gmti', name: 'report', label: 'GMTI report', fields: ['snr'] }];

const DEFAULTS = {
  revisitSeconds: 10, minRange: 20_000, maxRange: 150_000, startBearing: 45, endBearing: 135, detectionProbability: 0.9,
  rangeError: 20, crossRangeError: 50, minimumDetectableSpeed: 2, maxDetections: 200, mission: null, detectAll: false, outputs: [],
  type: 'GROUND_RADAR', preset: 'custom', searchWidth: 90, dwellDepth: 130_000, dwellInterval: 1, mode: 'random', targetRevisitSeconds: 2, range: 50_000, positionError: 50, jobArea: null,
};
const VISTA = { id: 'gmti/vista-out', plugin: 'gmti', name: 'VISTA (out)', outputType: 'gmti', canDelete: false, fields: [], fieldSet: 'gmti.report', maxAreaDepth: 511_980, chosen: false };

function sensorsBody(sensors: readonly { readonly [key: string]: JsonValue }[]): { readonly [key: string]: JsonValue } {
  return { running: true, pairing: true, channels: [VISTA], sensors };
}

function hawk(more: { readonly [key: string]: JsonValue } = {}): { readonly [key: string]: JsonValue } {
  return { platform: TRACK_1, name: 'Hawk 1', missing: false, settings: DEFAULTS, outputs: [], outOfRange: [], detections: 0, ...more };
}

async function showing(sensors: readonly { readonly [key: string]: JsonValue }[], permissions?: readonly string[]): Promise<Rig> {
  const rig = await activated({ fieldSets: SETS, ...(permissions === undefined ? {} : { permissions }) });
  feedPicture(rig.ctx, [symbol(TRACK_1, SIM_LAYER), symbol(TRACK_2, SIM_LAYER)]);
  rig.server.on('GET', 'sensors', { status: 200, body: sensorsBody(sensors) });
  const Sensors = panel(rig.ctx, 'sensors');
  render(<Sensors />);
  await screen.findByRole(sensors.length === 0 ? 'paragraph' : 'list', sensors.length === 0 ? {} : { name: 'Sensors' });
  return rig;
}

describe('the Sensors panel (criterion 35)', () => {
  it('makes a ground radar on the one selected track without asking for a type (function 36, M6: owner PX), and opens its form with the defaults', async () => {
    const rig = await showing([]);
    const button = () => screen.getByRole('button', { name: 'New sensor' });
    expect(button()).toHaveProperty('disabled', true);
    expect(button().getAttribute('title')).toBe('Select one track of the simulation');
    act(() => {
      rig.map.selection.set([TRACK_2]);
    });
    expect(button()).toHaveProperty('disabled', false);
    const made = sensorsBody([hawk({ platform: TRACK_2, name: 'Track 2' })]);
    rig.server.on('POST', 'sensors', { status: 200, body: made });
    rig.server.on('GET', 'sensors', { status: 200, body: made });
    await act(async () => {
      fireEvent.click(button());
      await Promise.resolve();
    });
    expect(screen.queryByRole('alertdialog', { name: 'New sensor' })).toBeNull();
    expect(rig.server.posts('sensors').at(-1)?.body).toEqual({ platform: TRACK_2, create: true, type: 'GROUND_RADAR' });
    const form = await screen.findByRole('region', { name: 'Sensor Track 2' });
    expect(within(form).getByLabelText<HTMLInputElement>('Revisit interval (s)').value).toBe('10');
    expect(within(form).getByLabelText<HTMLInputElement>('Min range (km)').value).toBe('20');
    expect(within(form).getByLabelText<HTMLInputElement>('Max range (km)').value).toBe('150');
    expect(within(form).getByLabelText<HTMLInputElement>('Range error (m)').value).toBe('20');
    // The speed in the user's unit, km/h by default (function 8): 2 m/s.
    expect(within(form).getByLabelText<HTMLInputElement>('Minimum detectable speed (km/h)').value).toBe('7.2');
    expect(within(form).getByLabelText<HTMLInputElement>('Mission').value).toBe('');
  });

  it('refuses a value outside its limits at the field, and saves only what changed, in SI units', async () => {
    const rig = await showing([hawk()]);
    fireEvent.click(screen.getByRole('button', { name: 'Hawk 1' }));
    const form = screen.getByRole('region', { name: 'Sensor Hawk 1' });
    const save = () => within(form).getByRole('button', { name: 'Save' });
    expect(save()).toHaveProperty('disabled', true);
    fireEvent.change(within(form).getByLabelText('Revisit interval (s)'), { target: { value: '0' } });
    expect(within(form).getByText('From 1 to 600')).toBeDefined();
    expect(save()).toHaveProperty('disabled', true);
    fireEvent.change(within(form).getByLabelText('Revisit interval (s)'), { target: { value: '10' } });
    fireEvent.change(within(form).getByLabelText('Max range (km)'), { target: { value: '10' } });
    expect(within(form).getByText('Above the min range')).toBeDefined();
    fireEvent.change(within(form).getByLabelText('Max range (km)'), { target: { value: '600' } });
    fireEvent.change(within(form).getByLabelText('Range error (m)'), { target: { value: '0' } }); // an error of 0 is none (the owner, A100)
    fireEvent.change(within(form).getByLabelText('Mission'), { target: { value: 'ATO-2611-BRAVO' } });
    fireEvent.click(within(form).getByLabelText('VISTA (out)'));
    expect(within(form).getByText(/Field set: GMTI report/)).toBeDefined();
    rig.server.on('POST', 'sensors', { status: 200, body: sensorsBody([hawk()]) });
    await act(async () => {
      fireEvent.click(save());
      await Promise.resolve();
    });
    expect(rig.server.posts('sensors').at(-1)?.body).toEqual({
      platform: TRACK_1, maxRange: 600_000, rangeError: 0, mission: 'ATO-2611-BRAVO', outputs: ['gmti/vista-out'],
    });
  });

  it('asks before it removes a sensor', async () => {
    const rig = await showing([hawk()]);
    fireEvent.click(screen.getByRole('button', { name: 'Hawk 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(rig.server.posts('sensors/remove')).toHaveLength(0);
    rig.server.on('POST', 'sensors/remove', { status: 200, body: sensorsBody([]) });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Remove the sensor' }));
      await Promise.resolve();
    });
    expect(rig.server.posts('sensors/remove').at(-1)?.body).toEqual({ platform: TRACK_1 });
  });

  it('shows a missing platform, and is read only without the edit right', async () => {
    await showing([hawk({ missing: true, name: 'Ground radar' })], [VIEW]);
    expect(screen.getByText('Missing')).toBeDefined();
    expect(screen.getByRole('button', { name: 'New sensor' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Ground radar' }));
    expect(screen.getByLabelText<HTMLInputElement>('Revisit interval (s)').readOnly).toBe(true);
    expect(screen.getByRole('button', { name: 'Save' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('button', { name: 'Remove' })).toHaveProperty('disabled', true);
  });
});

describe('the warning over the map (criterion 48; A105)', () => {
  async function warning(sensors: readonly { readonly [key: string]: JsonValue }[]): Promise<void> {
    const rig = await activated();
    rig.server.on('GET', 'sensors', { status: 200, body: sensorsBody(sensors) });
    const overlay = rig.ctx.overlays.find((o) => o.id === 'sensor-warnings');
    expect(overlay?.position).toBe('bottom-left');
    expect(overlay?.workspaces).toEqual(['simulator.simulation']);
    const Warning = overlay?.component;
    if (Warning === undefined) throw new Error('no warning overlay');
    render(<Warning />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('names the sensor and the output, without numbers, one line each', async () => {
    await warning([hawk({ outOfRange: ['VISTA (out)'] }), hawk({ platform: TRACK_2, name: 'Eagle', outOfRange: ['VISTA (out)', 'Deep (out)'] })]);
    const box = await screen.findByRole('status', { name: 'Sensor warnings' });
    expect(box.textContent).toContain('Hawk 1: some units are out of range for VISTA (out)');
    expect(within(box).getAllByText(/some units are out of range for/)).toHaveLength(3);
    expect(box.textContent.replace(/Hawk 1/g, '')).not.toMatch(/\d/);
  });

  it('shows nothing while no output leaves a unit out', async () => {
    await warning([hawk()]);
    expect(screen.queryByRole('status', { name: 'Sensor warnings' })).toBeNull();
  });
});

describe('the channels\' field sets (criterion 45)', () => {
  it('the Ground truth outputs panel names a channel\'s field set by its label, and by its id when no plugin declares it', async () => {
    const cotUnit: FieldSet = { id: 'cot.unit', plugin: 'cot', name: 'unit', label: 'CoT unit', fields: ['team'] };
    const rig = await activated({ fieldSets: [cotUnit] });
    const channel = { id: 'cot/tak-out', plugin: 'cot', name: 'TAK (out)', outputType: 'cot', canDelete: true, fields: [], chosen: false };
    rig.server.on('GET', 'outputs', {
      status: 200,
      body: { channels: [{ ...channel, fieldSet: 'cot.unit' }, { ...channel, id: 'ais/out', name: 'AIS (out)', fieldSet: 'ais.ship' }], chosen: [] },
    });
    const Outputs = panel(rig.ctx, 'outputs');
    render(<Outputs />);
    expect(await screen.findByText('Field set: CoT unit')).toBeDefined();
    expect(screen.getByText('Field set: ais.ship')).toBeDefined();
    expect(screen.getByRole('region', { name: 'Ground truth outputs' })).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'Ground truth outputs' })).toBeNull(); // the shell's head shows it (SDK 1.8.0 part C)
  });
});
