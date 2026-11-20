// Criterion 6, units: m/s, km/h, knots or mph, and metres or feet, chosen per user and remembered
// in the browser (from M4, BV); display only.
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_UNITS, formatDuration, formatLength, formatSpeed, lengthIn, lengthToMetres, readUnits, speedIn, speedToMps,
} from '../src/units.ts';
import { unitsKey } from '../src/unitsModel.ts';
import { activated, panel } from './harness.tsx';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('unit conversions (criterion 6)', () => {
  it('converts speeds both ways', () => {
    expect(speedIn(10, 'mps')).toBe(10);
    expect(speedIn(10, 'kmh')).toBeCloseTo(36, 10);
    expect(speedIn(1852 / 3600, 'kn')).toBeCloseTo(1, 10);
    expect(speedIn(1609.344 / 3600, 'mph')).toBeCloseTo(1, 10);
    for (const unit of ['mps', 'kmh', 'kn', 'mph'] as const) expect(speedToMps(speedIn(123.4, unit), unit)).toBeCloseTo(123.4, 10);
  });

  it('converts altitudes both ways', () => {
    expect(lengthIn(0.3048, 'ft')).toBeCloseTo(1, 10);
    expect(lengthToMetres(1000, 'ft')).toBeCloseTo(304.8, 10);
    expect(lengthIn(-1000, 'm')).toBe(-1000);
  });

  it('shows speeds to one decimal and lengths whole (A27)', () => {
    expect(formatSpeed(8.333_333, 'kmh')).toBe('30.0 km/h');
    expect(formatSpeed(10, 'kn')).toBe('19.4 kn');
    expect(formatSpeed(null, 'mps')).toBe('–');
    expect(formatLength(12_345.6, 'm')).toBe('12,346 m');
    expect(formatLength(1000, 'ft')).toBe('3,281 ft');
    expect(formatDuration(3725)).toBe('1:02:05');
    expect(formatDuration(null)).toBe('–');
  });

  it('reads a saved share, and refuses one it cannot read', () => {
    expect(readUnits({ speed: 'kn', altitude: 'ft' })).toEqual({ speed: 'kn', altitude: 'ft' });
    expect(readUnits({ speed: 'furlongs', altitude: 'ft' })).toBeNull();
    expect(readUnits('kmh')).toBeNull();
    expect(readUnits(null)).toBeNull();
  });
});

describe('the units in the browser (criterion 6, from M4; BV, A67)', () => {
  function shownUnits(): { readonly speed: string; readonly altitude: string } {
    return { speed: screen.getByLabelText<HTMLSelectElement>('Speed unit').value, altitude: screen.getByLabelText<HTMLSelectElement>('Altitude unit').value };
  }

  it('starts at km/h and metres, keeps a choice in localStorage per user, and nothing in the setup', async () => {
    const { ctx } = await activated();
    render(createElement(panel(ctx, 'routes')));
    expect(shownUnits()).toEqual(DEFAULT_UNITS);
    fireEvent.change(screen.getByLabelText('Speed unit'), { target: { value: 'mph' } });
    fireEvent.change(screen.getByLabelText('Altitude unit'), { target: { value: 'ft' } });
    expect(JSON.parse(globalThis.localStorage.getItem(unitsKey(ctx.user.id)) ?? 'null')).toEqual({ speed: 'mph', altitude: 'ft' });
    expect(() => ctx.saveSetup()).toThrow(/registered no setup share/);
  });

  it('starts with the units kept in this browser, and ignores ones it cannot read', async () => {
    const { ctx } = await activated({ storedUnits: JSON.stringify({ speed: 'kn', altitude: 'ft' }) });
    render(createElement(panel(ctx, 'routes')));
    expect(shownUnits()).toEqual({ speed: 'kn', altitude: 'ft' });
    cleanup();
    const other = await activated({ storedUnits: '{"speed": "warp"' });
    render(createElement(panel(other.ctx, 'routes')));
    expect(shownUnits()).toEqual(DEFAULT_UNITS);
  });
});
