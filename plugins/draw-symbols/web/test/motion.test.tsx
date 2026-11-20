// M4 (T-130, brief function 27): heading, speed and altitude in Symbol properties. The model keeps SI (modifier `direction` in degrees,
// modifier `speed` in m/s, the point's third coordinate in metres); the fields show the user's units.
import { act, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createFakeUser } from '@emc2/plugin-sdk/testing';
import type { MapObject } from '@emc2/plugin-sdk';
import { altitudeOf, withAltitude, withDirection, withSpeed } from '../src/content.ts';
import { ALTITUDE_UNIT_KEY, SPEED_UNIT_KEY } from '../src/keptChoice.ts';
import { lengthIn, lengthToMetres, parseNumber, speedIn, speedToMps } from '../src/units.ts';
import { FakeServer, layer, symbolObject } from './fakeServer.ts';
import { isolateDocumentListeners, openBrowser, settle, showPanels } from './harness.tsx';
import { choose, commit, dataOf, select } from './scene.tsx';

isolateDocumentListeners();

const SIDC = '10031000001211000000';

async function scene(options: { readonly overrides?: Partial<MapObject>; readonly locked?: boolean; readonly user?: ReturnType<typeof createFakeUser> } = {}) {
  const lay = layer('Alpha', 0);
  const server = new FakeServer([lay]);
  const symbol = server.seed(symbolObject(lay.id, options.overrides ?? {}));
  if (options.locked === true) server.setLocked(lay.id, true);
  const one = await openBrowser(server, options.user === undefined ? {} : { user: options.user });
  const panels = showPanels(one);
  await select(one, symbol.id);
  const field = (label: string) => panels.properties.getByLabelText(label) as HTMLInputElement;
  const stored = () => server.objects.get(symbol.id) as MapObject;
  return { server, lay, symbol, one, panels, field, stored };
}

const MOVING: Partial<MapObject> = {
  symbol: { standard: 'APP-6D', sidc: SIDC, modifiers: { direction: 90, speed: 15, uniqueDesignation: 'A1' } },
  geometry: { type: 'Point', coordinates: [15.5, 60.25, 100] },
};

describe('the units (pure)', () => {
  it('converts both ways and tidies the stored number', () => {
    expect(speedToMps(54, 'kmh')).toBe(15);
    expect(speedToMps(10, 'kn')).toBeCloseTo(5.144444, 6);
    expect(speedToMps(10, 'mph')).toBeCloseTo(4.4704, 6);
    expect(speedToMps(7, 'mps')).toBe(7);
    expect(speedIn(15, 'kmh')).toBe('54');
    expect(speedIn(15, 'kn')).toBe('29.16');
    expect(lengthToMetres(100, 'ft')).toBeCloseTo(30.48, 6);
    expect(lengthIn(30.48, 'ft')).toBe('100');
    expect(lengthIn(100, 'm')).toBe('100');
  });

  it('parses a number, an empty text and what is not a number', () => {
    expect(parseNumber(' 12,5 ')).toBe(12.5);
    expect(parseNumber('-3')).toBe(-3);
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('  ')).toBeNull();
    for (const bad of ['abc', '1e3', '1.2.3', '--1', 'Infinity', '12 km']) expect(parseNumber(bad)).toBe('invalid');
  });

  it('sets and removes the three values and leaves the rest of the content alone', () => {
    const object = symbolObject('00000000-0000-7000-8000-000000000000', MOVING);
    const base = { ...object } as unknown as Parameters<typeof withDirection>[0];
    expect(withDirection(base, 45).symbol?.modifiers).toEqual({ direction: 45, speed: 15, uniqueDesignation: 'A1' });
    expect(withDirection(base, null).symbol?.modifiers).toEqual({ speed: 15, uniqueDesignation: 'A1' });
    expect(withSpeed(base, null).symbol?.modifiers).toEqual({ direction: 90, uniqueDesignation: 'A1' });
    expect(altitudeOf(withAltitude(base, 5).geometry)).toBe(5);
    expect(withAltitude(base, null).geometry).toEqual({ type: 'Point', coordinates: [15.5, 60.25] });
    const bare = withDirection(withSpeed(withDirection({ ...base, symbol: { standard: 'APP-6D', sidc: SIDC } }, 10), 3), null);
    expect(bare.symbol?.modifiers).toEqual({ speed: 3 });
    expect(withSpeed(bare, null).symbol).toEqual({ standard: 'APP-6D', sidc: SIDC }); // no empty `modifiers`
  });
});

describe('the fields show the values in the user\'s units', () => {
  it('are empty for a symbol without them, and in km/h and metres by default', async () => {
    const { field } = await scene();
    expect(field('Heading (°)').value).toBe('');
    expect(field('Speed (km/h)').value).toBe('');
    expect(field('Altitude (m)').value).toBe('');
    expect((field('Speed unit') as unknown as HTMLSelectElement).value).toBe('kmh');
    expect((field('Altitude unit') as unknown as HTMLSelectElement).value).toBe('m');
  });

  it('show a moving symbol with its altitude: 90°, 15 m/s as 54 km/h, 100 m', async () => {
    const { field } = await scene({ overrides: MOVING });
    expect(field('Heading (°)').value).toBe('90');
    expect(field('Speed (km/h)').value).toBe('54');
    expect(field('Altitude (m)').value).toBe('100');
  });

  it('a change of unit changes only what is shown, and is kept for the next visit', async () => {
    const { server, panels, field } = await scene({ overrides: MOVING });
    await choose(panels.properties.getByLabelText('Speed unit'), 'kn');
    await choose(panels.properties.getByLabelText('Altitude unit'), 'ft');
    expect(field('Speed (kn)').value).toBe('29.16');
    expect(field('Altitude (ft)').value).toBe('328.08');
    expect(server.requests).toHaveLength(0);
    expect(window.localStorage.getItem(SPEED_UNIT_KEY)).toBe('kn');
    expect(window.localStorage.getItem(ALTITUDE_UNIT_KEY)).toBe('ft');
    const again = await scene({ overrides: MOVING });
    expect(again.field('Speed (kn)').value).toBe('29.16');
  });

  it('use the default unit when the kept one is not one of ours', async () => {
    window.localStorage.setItem(SPEED_UNIT_KEY, 'furlongs');
    const { field } = await scene();
    expect(field('Speed (km/h)')).toBeTruthy();
  });
});

describe('committing (as for the other fields)', () => {
  it('a heading sends one update with the complete core content, and the speed and altitude stay', async () => {
    const { server, field, stored } = await scene({ overrides: MOVING });
    await commit(field('Heading (°)'), '135.5');
    expect(server.requests).toHaveLength(1);
    const data = dataOf(server.requests[0]);
    expect(data.symbol?.modifiers).toEqual({ direction: 135.5, speed: 15, uniqueDesignation: 'A1' });
    expect(data.geometry).toEqual({ type: 'Point', coordinates: [15.5, 60.25, 100] });
    expect(stored().symbol?.modifiers?.direction).toBe(135.5);
  });

  it('a speed typed in km/h is stored in m/s; in knots as well', async () => {
    const { field, panels, stored } = await scene({ overrides: MOVING });
    await commit(field('Speed (km/h)'), '72');
    expect(stored().symbol?.modifiers?.speed).toBe(20);
    await choose(panels.properties.getByLabelText('Speed unit'), 'kn');
    await commit(field('Speed (kn)'), '10');
    expect(stored().symbol?.modifiers?.speed).toBeCloseTo(5.144444, 6);
  });

  it('an altitude typed in metres or feet is stored in metres, and the position stays', async () => {
    const { field, panels, stored } = await scene({ overrides: MOVING });
    await commit(field('Altitude (m)'), '250');
    expect(stored().geometry).toEqual({ type: 'Point', coordinates: [15.5, 60.25, 250] });
    await choose(panels.properties.getByLabelText('Altitude unit'), 'ft');
    await commit(field('Altitude (ft)'), '1000');
    expect(altitudeOf(stored().geometry)).toBeCloseTo(304.8, 6);
  });

  it('an altitude can be given to a symbol that had none', async () => {
    const { field, stored } = await scene();
    await commit(field('Altitude (m)'), '-12');
    expect(stored().geometry).toEqual({ type: 'Point', coordinates: [15.5, 60.25, -12] });
  });

  it('an empty field clears the value: no modifier left over, no third coordinate', async () => {
    const { field, stored } = await scene({ overrides: MOVING });
    await commit(field('Heading (°)'), '');
    await commit(field('Speed (km/h)'), '  ');
    await commit(field('Altitude (m)'), '');
    expect(stored().symbol?.modifiers).toEqual({ uniqueDesignation: 'A1' });
    expect(stored().geometry).toEqual({ type: 'Point', coordinates: [15.5, 60.25] });
  });

  it('a value that is not allowed is shown at its field and nothing is sent', async () => {
    const { server, panels, field } = await scene({ overrides: MOVING });
    await commit(field('Heading (°)'), '360');
    expect(panels.properties.getByText('The heading must be from 0 to under 360°.')).toBeTruthy();
    await commit(field('Heading (°)'), '-1');
    expect(panels.properties.getByText('The heading must be from 0 to under 360°.')).toBeTruthy(); // shown again for this value
    await commit(field('Heading (°)'), 'north');
    expect(panels.properties.getByText('Enter the heading in degrees.')).toBeTruthy();
    await commit(field('Speed (km/h)'), '-5');
    expect(panels.properties.getByText('The speed cannot be negative.')).toBeTruthy();
    await commit(field('Speed (km/h)'), 'fast');
    expect(panels.properties.getByText('Enter the speed as a number.')).toBeTruthy();
    await commit(field('Altitude (m)'), '1e3');
    expect(panels.properties.getByText('Enter the altitude as a number.')).toBeTruthy();
    expect(server.requests).toHaveLength(0);
  });

  it('Escape drops what was typed', async () => {
    const { server, field } = await scene({ overrides: MOVING });
    fireEvent.change(field('Heading (°)'), { target: { value: '10' } });
    fireEvent.keyDown(field('Heading (°)'), { key: 'Escape' });
    expect(field('Heading (°)').value).toBe('90');
    expect(server.requests).toHaveLength(0);
  });

  it('a move of the symbol keeps its heading, speed and altitude', async () => {
    const { panels, stored } = await scene({ overrides: MOVING });
    const position = panels.properties.getByLabelText(/^Position/) as HTMLInputElement;
    await commit(position, '12.5 S 130.25 W');
    expect(stored().geometry).toEqual({ type: 'Point', coordinates: [-130.25, -12.5, 100] });
    expect(stored().symbol?.modifiers).toEqual({ direction: 90, speed: 15, uniqueDesignation: 'A1' });
  });
});

describe('read only', () => {
  it('without the edit permission the three fields and their units show the values, and nothing can be typed', async () => {
    const { field } = await scene({ overrides: MOVING, user: createFakeUser({ permissions: [] }) });
    for (const label of ['Heading (°)', 'Speed (km/h)', 'Altitude (m)']) expect(field(label).disabled).toBe(true);
    expect(field('Speed (km/h)').value).toBe('54');
  });

  it('in a locked layer the fields are read only too, and an unlock makes them editable', async () => {
    const { server, lay, field } = await scene({ overrides: MOVING, locked: true });
    expect(field('Heading (°)').disabled).toBe(true);
    expect(field('Altitude (m)').disabled).toBe(true);
    act(() => { server.setLocked(lay.id, false); });
    await settle();
    expect(field('Heading (°)').disabled).toBe(false);
  });
});
