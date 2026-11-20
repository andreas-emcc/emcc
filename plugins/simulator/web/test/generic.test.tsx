// The generic sensor in the Sensors panel (brief functions 36 and 38; criterion 52's later parts): not
// offered in M6 (owner, PX, 2026-11-11), kept for a later milestone. These tests offer it as that
// milestone will, by mocking the types "New sensor" offers.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { JsonValue } from '@emc2/plugin-sdk';
import { activated, feedPicture, panel, SIM_LAYER, symbol, TRACK_1, TRACK_2 } from './harness.tsx';
import type { Rig } from './harness.tsx';

vi.mock('../src/sensors.ts', async (actual) => ({ ...(await actual<typeof import('../src/sensors.ts')>()), OFFERED_KINDS: ['GROUND_RADAR', 'GENERIC'] }));

afterEach(() => {
  cleanup();
});

const RADAR = {
  type: 'GROUND_RADAR', revisitSeconds: 10, minRange: 20_000, maxRange: 150_000, startBearing: 45, endBearing: 135, detectionProbability: 1,
  rangeError: 20, crossRangeError: 50, minimumDetectableSpeed: 0, maxDetections: 200, mission: null, detectAll: false, outputs: [],
  preset: 'medium', searchWidth: 40, dwellDepth: 50_000, dwellInterval: 1, mode: 'random', targetRevisitSeconds: 2, range: 50_000, positionError: 50, jobArea: null,
};
const GENERIC = { ...RADAR, type: 'GENERIC' };
/** A fake gmti channel taking ground radars, and a fake cot channel taking every type (criterion 52). */
const GMTI = { id: 'gmti/vista-out', plugin: 'gmti', name: 'VISTA (out)', outputType: 'gmti', canDelete: false, fields: [], fieldSet: null, maxAreaDepth: null, sensorTypes: ['GROUND_RADAR'], chosen: false };
const COT = { id: 'cot/tak-sensors', plugin: 'cot', name: 'TAK sensors (out)', outputType: 'cot', canDelete: true, fields: [], fieldSet: null, maxAreaDepth: null, sensorTypes: [], chosen: false };

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

describe('the generic sensor, later (criterion 52; owner PX)', () => {
  it('"New sensor" asks for the type and makes a generic sensor', async () => {
    const rig = await showing([]);
    act(() => {
      rig.map.selection.set([TRACK_2]);
    });
    fireEvent.click(screen.getByRole('button', { name: 'New sensor' }));
    const dialog = screen.getByRole('alertdialog', { name: 'New sensor' });
    const type = within(dialog).getByLabelText<HTMLSelectElement>('Type');
    expect([...type.options].map((o) => o.text)).toEqual(['Ground radar', 'Generic sensor']);
    fireEvent.change(type, { target: { value: 'GENERIC' } });
    rig.server.on('POST', 'sensors', { status: 200, body: body([sensor(GENERIC, { platform: TRACK_2, name: 'Track 2' })]) });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Make the sensor' }));
      await Promise.resolve();
    });
    expect(rig.server.posts('sensors').at(-1)?.body).toEqual({ platform: TRACK_2, create: true, type: 'GENERIC' });
  });

  it('offers a ground radar both channels, and a generic sensor only the cot one; a chosen one that does not take its type shows missing', async () => {
    await showing([sensor(RADAR), sensor({ ...GENERIC, outputs: ['gmti/vista-out'] }, { platform: TRACK_2, name: 'Watcher', outputs: [{ id: 'gmti/vista-out', missing: true }] })]);
    const radar = open();
    expect(within(radar).getByLabelText('VISTA (out)')).toBeDefined();
    expect(within(radar).getByLabelText('TAK sensors (out)')).toBeDefined();
    const generic = open('Watcher');
    expect(within(generic).queryByLabelText('VISTA (out)')).toBeNull();
    expect(within(generic).getByLabelText('TAK sensors (out)')).toBeDefined();
    expect(within(generic).getByLabelText('gmti/vista-out (missing)')).toBeDefined();
  });

  it("shows a generic sensor's own settings (function 38), without the band, the preset or \"Detect all in range\"", async () => {
    await showing([sensor(GENERIC)]);
    const form = open();
    expect(within(form).getByText('Generic sensor')).toBeDefined();
    expect(value(form, 'Revisit time (s)')).toBe('10');
    expect(value(form, 'Range (km)')).toBe('50');
    expect(value(form, 'Position error (m)')).toBe('50');
    expect(value(form, 'Most detections per report')).toBe('200');
    expect(within(form).queryByLabelText('Max range (km)')).toBeNull();
    expect(within(form).queryByLabelText('Preset')).toBeNull();
    expect(within(form).queryByLabelText('Detect all in range')).toBeNull();
  });
});

