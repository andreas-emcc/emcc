import { describe, expect, it } from 'vitest';
import type { JsonValue } from '@emc2/plugin-sdk';
import manifest from '../../../plugin.json' with { type: 'json' };
import { DEFAULT_SETTINGS, objectBudget, readSettings } from '../../src/core/settings.ts';

const defaults = (): Record<string, JsonValue> =>
  Object.fromEntries(Object.entries(manifest.settings.properties).map(([name, schema]) => [name, schema.default as JsonValue]));

describe('settings', () => {
  it('the code defaults equal the manifest defaults', () => {
    expect(DEFAULT_SETTINGS).toEqual(defaults());
  });

  it('reads the manifest defaults without problems', () => {
    const { settings, problems } = readSettings(defaults());
    expect(problems).toEqual([]);
    expect(settings).toEqual(DEFAULT_SETTINGS);
  });

  it('takes the defaults for missing settings, silently', () => {
    expect(readSettings({})).toEqual({ settings: DEFAULT_SETTINGS, problems: [] });
  });

  it('replaces a bad value by its default and reports it', () => {
    const { settings, problems } = readSettings({ textThreshold: 200_000, updateCadenceMs: 10, initialCenter: [62, 95], initialZoom: 'far' });
    expect(settings.textThreshold).toBe(2000);
    expect(settings.updateCadenceMs).toBe(1000);
    expect(settings.initialCenter).toEqual([15, 62]);
    expect(settings.initialZoom).toBe(5);
    expect(problems).toHaveLength(4);
    expect(problems[0]).toContain('initialCenter');
  });

  it('has the M1 defaults: EPSG:3031, the preferred backgrounds and both object budgets', () => {
    expect(DEFAULT_SETTINGS.projections.map((p) => p.code)).toEqual(['EPSG:3857', 'EPSG:3413', 'EPSG:3031']);
    expect(DEFAULT_SETTINGS.preferredBackgrounds).toEqual(['OpenStreetMap', 'Natural Earth']);
    expect([DEFAULT_SETTINGS.softwareBudget, DEFAULT_SETTINGS.hardwareBudget]).toEqual([10_000, 100_000]);
  });

  it('reads the preferred backgrounds, and refuses a list that is not names', () => {
    expect(readSettings({ preferredBackgrounds: ['Natural Earth'] }).settings.preferredBackgrounds).toEqual(['Natural Earth']);
    expect(readSettings({ preferredBackgrounds: [] }).settings.preferredBackgrounds).toEqual([]);
    for (const bad of ['OpenStreetMap', ['OpenStreetMap', 3], [''], Array.from({ length: 51 }, () => 'x')] as JsonValue[]) {
      const { settings, problems } = readSettings({ preferredBackgrounds: bad });
      expect(settings.preferredBackgrounds).toEqual(DEFAULT_SETTINGS.preferredBackgrounds);
      expect(problems[0]).toContain('preferredBackgrounds');
    }
  });

  it('takes the object budget of the rendering mode (brief function 12)', () => {
    const settings = readSettings({ softwareBudget: 5000, hardwareBudget: 50_000 }).settings;
    expect(objectBudget(settings, 'hardware')).toBe(50_000);
    expect(objectBudget(settings, 'software')).toBe(5000);
    expect(objectBudget(settings, 'none')).toBe(5000);
    expect(readSettings({ hardwareBudget: 0 }).problems[0]).toContain('hardwareBudget');
  });

  it('never accepts a cadence fast enough to block the page (below 250 ms)', () => {
    expect(readSettings({ updateCadenceMs: 249 }).settings.updateCadenceMs).toBe(1000);
    expect(readSettings({ updateCadenceMs: 250 }).settings.updateCadenceMs).toBe(250);
  });

  it('leaves out a bad projection and keeps the others', () => {
    const [mercator] = DEFAULT_SETTINGS.projections;
    const { settings, problems } = readSettings({
      projections: [mercator as unknown as JsonValue, { code: 'EPSG:9999', proj4: '+proj=stere', extent: [1, 1, 0, 0], worldExtent: [-180, 30, 180, 90] }],
    });
    expect(settings.projections.map((p) => p.code)).toEqual(['EPSG:3857']);
    expect(problems).toEqual(['setting projections[1] is ignored: extent must be [minX, minY, maxX, maxY] with min < max']);
  });

  it('falls back to the first projection when the initial one is not configured', () => {
    const { settings, problems } = readSettings({ initialProjection: 'EPSG:32633' });
    expect(settings.initialProjection).toBe('EPSG:3857');
    expect(problems).toHaveLength(1);
  });
});
