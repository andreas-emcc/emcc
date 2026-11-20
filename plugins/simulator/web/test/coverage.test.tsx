// A sensor's coverage on the map (brief function 33, criterion 49; T-158; the owner's Q25 to Q29 A).
// The reference positions are GeographicLib's (the server's Geodesy, ADR-0019), from WGS84.Direct.
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { VIEW_WORKSPACE } from '@emc2/plugin-sdk';
import type { JsonValue, MapObject, OverlayArea, OverlayItem, PluginLog, Position, UserDocuments } from '@emc2/plugin-sdk';
import { buildScenario } from '../src/scenario.ts';
import { CoverageModel, coverageRings, direct, identityColour } from '../src/coverage.ts';
import type { SensorSettings } from '../src/sensors.ts';
import { SIMULATION } from '../src/picture.ts';
import { activated, feedPicture, layer, panel, settled, SIM_LAYER, symbol, TRACK_1, TRACK_2, VIEW } from './harness.tsx';
import type { Rig } from './harness.tsx';

afterEach(() => {
  cleanup();
});

const PLATFORM: Position = [15.2, 58.41];

/** GeographicLib's WGS84.Direct from PLATFORM: [azimuth, distance, position]. */
const REFERENCE: readonly (readonly [number, number, Position])[] = [
  [75, 150_000, [17.7022105722, 58.7343117473]],
  [165, 150_000, [15.8406275846, 57.1074184347]],
  [120, 150_000, [17.380014995, 57.717766142]],
  [75, 20_000, [15.53091585, 58.4560460583]],
  [165, 20_000, [15.2881198555, 58.2365278577]],
  [135, 150_000, [16.9665710568, 57.445215724]],
  [225, 150_000, [13.4334289432, 57.445215724]],
  [0, 150_000, [15.2, 59.756540878]],
  [330, 150_000, [13.8731187359, 59.5694868138]],
  [270, 1_000_000, [-1.5535304558, 57.2882996404]],
];

function reference(azimuth: number, distance: number): Position {
  const found = REFERENCE.find(([a, d]) => a === azimuth && d === distance);
  if (found === undefined) throw new Error(`no reference for ${String(azimuth)}°, ${String(distance)} m`);
  return found[2];
}

/** Metres between two nearby positions (a local flat approximation: good to far below 1 mm at these distances). */
function apart(a: Position | undefined, b: Position): number {
  if (a === undefined) return Infinity;
  const north = (a[1] - b[1]) * 111_320;
  const east = (a[0] - b[0]) * 111_320 * Math.cos((b[1] * Math.PI) / 180);
  return Math.hypot(north, east);
}

const BAND: SensorSettings = {
  revisitSeconds: 10, minRange: 20_000, maxRange: 150_000, startBearing: 45, endBearing: 135, detectionProbability: 0.9,
  rangeError: 20, crossRangeError: 50, minimumDetectableSpeed: 2, maxDetections: 200, mission: null, detectAll: false, outputs: [],
  type: 'GROUND_RADAR', preset: 'custom', searchWidth: 90, dwellDepth: 130_000, dwellInterval: 1, mode: 'random', targetRevisitSeconds: 2, range: 50_000, positionError: 50, jobArea: null,
};

function ring(rings: Position[][] | null, n = 0): Position[] {
  const r = rings?.[n];
  if (r === undefined) throw new Error('no ring');
  return r;
}

describe('the geodesic (function 33)', () => {
  it('is within 1 m of the server\'s Geodesy, also at 1 000 km', () => {
    for (const [azimuth, distance, at] of REFERENCE) expect(apart(direct(PLATFORM, azimuth, distance), at)).toBeLessThan(1);
  });
});

describe('the coverage\'s rings (criterion 49)', () => {
  it('a band of 20 to 150 km at 45° to 135° on a platform turned to 30°: the outer arc from 75° to 165°, the inner arc back, 1° apart', () => {
    const rings = coverageRings(PLATFORM, 30, BAND);
    expect(rings).toHaveLength(1);
    const r = ring(rings);
    // 91 positions on each arc (90°, 1° apart), and the first again.
    expect(r).toHaveLength(91 + 91 + 1);
    expect(apart(r[0], reference(75, 150_000))).toBeLessThan(1);
    expect(apart(r[45], reference(120, 150_000))).toBeLessThan(1);
    expect(apart(r[90], reference(165, 150_000))).toBeLessThan(1);
    expect(apart(r[91], reference(165, 20_000))).toBeLessThan(1);
    expect(apart(r[181], reference(75, 20_000))).toBeLessThan(1);
    expect(r.at(-1)).toEqual(r[0]);
    // Every outer and inner position at its range from the platform, 1° after the one before.
    for (let i = 0; i <= 90; i++) {
      expect(apart(r[i], direct(PLATFORM, 75 + i, 150_000))).toBeLessThan(1e-6);
      expect(apart(r[181 - i], direct(PLATFORM, 75 + i, 20_000))).toBeLessThan(1e-6);
    }
  });

  it('turns with the platform: at 90° the outer arc runs from 135° to 225°', () => {
    const r = ring(coverageRings(PLATFORM, 90, BAND));
    expect(apart(r[0], reference(135, 150_000))).toBeLessThan(1);
    expect(apart(r[90], reference(225, 150_000))).toBeLessThan(1);
  });

  it('"Detect all in range" gives the disc of the max range', () => {
    const rings = coverageRings(PLATFORM, 30, { ...BAND, detectAll: true });
    expect(rings).toHaveLength(1);
    const r = ring(rings);
    expect(r).toHaveLength(361);
    expect(apart(r[0], reference(0, 150_000))).toBeLessThan(1);
    expect(apart(r[330], reference(330, 150_000))).toBeLessThan(1);
    expect(r.at(-1)).toEqual(r[0]);
  });

  it('bearings 300° to 60° are drawn across north', () => {
    const r = ring(coverageRings(PLATFORM, 0, { ...BAND, startBearing: 300, endBearing: 60 }));
    expect(r).toHaveLength(121 + 121 + 1);
    expect(apart(r[30], reference(330, 150_000))).toBeLessThan(1);
    expect(apart(r[60], reference(0, 150_000))).toBeLessThan(1);
  });

  it("equal bearings look all round (the owner's MX A): the ring between the circles, the inner one a hole; 0° and 360° too", () => {
    for (const [start, end] of [[45, 45], [0, 360]] as const) {
      const rings = coverageRings(PLATFORM, 30, { ...BAND, startBearing: start, endBearing: end });
      expect(rings).toHaveLength(2);
      expect(apart(ring(rings, 0)[0], reference(0, 150_000))).toBeLessThan(1);
      expect(apart(ring(rings, 1)[0], direct(PLATFORM, 0, 20_000))).toBeLessThan(1e-6);
      expect(ring(rings, 1)).toHaveLength(361);
    }
  });

  it('a min range of 0 starts at the platform', () => {
    const r = ring(coverageRings(PLATFORM, 30, { ...BAND, minRange: 0 }));
    expect(r).toHaveLength(91 + 1 + 1);
    expect(r[91]).toEqual(PLATFORM);
  });

  it('has no area for a max range of 0 or a min range not below the max', () => {
    expect(coverageRings(PLATFORM, 0, { ...BAND, maxRange: 0 })).toBeNull();
    expect(coverageRings(PLATFORM, 0, { ...BAND, minRange: 150_000 })).toBeNull();
  });
});

describe('the identity colour (Q26 A)', () => {
  it('is APP-6\'s medium frame colour of the platform\'s standard identity, yellow without one', () => {
    expect(identityColour({ standard: 'APP-6D', sidc: '10031000001211000000' })).toBe('#00A8DC');
    expect(identityColour({ standard: 'APP-6D', sidc: '10061000001211000000' })).toBe('#FF3031');
    expect(identityColour({ standard: 'APP-6E', sidc: '10041000001211000000' })).toBe('#00E200');
    expect(identityColour({ standard: 'APP-6D', sidc: '10011000001211000000' })).toBe('#FFFF00');
    expect(identityColour({ standard: 'APP-6B', sidc: 'SHGPUCI----D---' })).toBe('#FF3031');
    expect(identityColour({ standard: 'APP-6B', sidc: 'sfgpucI----D---' })).toBe('#00A8DC');
    expect(identityColour({ standard: 'vessel', sidc: '0570' })).toBe('#FF3031');
    expect(identityColour(undefined)).toBe('#FFFF00');
  });
});

describe('"Show coverage" is read without a failed request (the quick run q12)', () => {
  const quiet: PluginLog = { debug: () => undefined, info: () => undefined, warn: () => undefined, error: () => undefined };

  /** User documents that record each call: the shell's `get` of a missing document answers 404, which the browser logs. */
  function recorded(stored: { readonly [name: string]: JsonValue }, failList = false): { readonly documents: UserDocuments; readonly calls: string[] } {
    const calls: string[] = [];
    const documents: UserDocuments = {
      get: (name) => {
        calls.push(`get ${name}`);
        return Promise.resolve(stored[name] ?? null);
      },
      put: (name) => {
        calls.push(`put ${name}`);
        return Promise.resolve();
      },
      delete: (name) => {
        calls.push(`delete ${name}`);
        return Promise.resolve();
      },
      list: () => {
        calls.push('list');
        return failList ? Promise.reject(new Error('offline')) : Promise.resolve(Object.keys(stored).sort());
      },
    };
    return { documents, calls };
  }

  it('a user who never saved it lists the documents, reads none, and has it on', async () => {
    const { documents, calls } = recorded({ bookmarks: {} });
    const model = new CoverageModel(documents, quiet);
    await model.load();
    expect(calls).toEqual(['list']);
    expect(model.getState().show).toBe(true);
  });

  it('a saved switch is read', async () => {
    const { documents, calls } = recorded({ 'sensors-view': { showCoverage: false } });
    const model = new CoverageModel(documents, quiet);
    await model.load();
    expect(calls).toEqual(['list', 'get sensors-view']);
    expect(model.getState().show).toBe(false);
  });

  it('is on when the documents cannot be listed', async () => {
    const { documents, calls } = recorded({}, true);
    const model = new CoverageModel(documents, quiet);
    await model.load();
    expect(calls).toEqual(['list']);
    expect(model.getState().show).toBe(true);
  });
});

// ---- In the web part ----

function platform(direction: number, at: Position = PLATFORM, sidc = '10061000001211000000'): MapObject {
  const base = symbol(TRACK_1, SIM_LAYER);
  return { ...base, geometry: { type: 'Point', coordinates: at }, symbol: { standard: 'APP-6D', sidc, modifiers: { direction } } };
}

function sensorsBody(running: boolean, sensors: readonly { readonly [key: string]: JsonValue }[]): JsonValue {
  return { running, pairing: false, channels: [], sensors };
}

function sensor(more: { readonly [key: string]: JsonValue } = {}): { readonly [key: string]: JsonValue } {
  return { platform: TRACK_1, name: 'Hawk 1', missing: false, settings: { ...BAND } as unknown as JsonValue, outputs: [], outOfRange: [], ...more };
}

async function drawn(options: { readonly running?: boolean; readonly sensors?: readonly { readonly [key: string]: JsonValue }[]; readonly documents?: { readonly [name: string]: JsonValue }; readonly permissions?: readonly string[] } = {}): Promise<Rig> {
  const rig = await activated({
    sensors: sensorsBody(options.running ?? false, options.sensors ?? [sensor()]),
    ...(options.documents === undefined ? {} : { userDocuments: options.documents }),
    ...(options.permissions === undefined ? {} : { permissions: options.permissions }),
  });
  await act(async () => {
    feedPicture(rig.ctx, [platform(30), symbol(TRACK_2, SIM_LAYER)]);
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

describe('the coverage overlay (criterion 49)', () => {
  it('draws one dashed area without fill in the coverage colour (from M8 #FD0909 by default, T-189), round its position and heading', async () => {
    const rig = await drawn();
    await waitFor(() => {
      expect(areas(rig)).toHaveLength(1);
    });
    const area = areas(rig)[0];
    expect(area?.style).toEqual({ strokeColor: '#FD0909', strokeWidth: 1.5, strokeDash: 'dash', fillOpacity: 0 });
    expect(area?.rings).toEqual(coverageRings(PLATFORM, 30, BAND));
    expect(rig.map.overlayProblems.at(-1)).toBeNull();
  });

  it('is drawn while the simulation is reset or paused as well as while it runs', async () => {
    for (const running of [false, true]) {
      const rig = await drawn({ running });
      await waitFor(() => {
        expect(areas(rig)).toHaveLength(1);
      });
      cleanup();
    }
  });

  it('follows the platform when it moves and turns', async () => {
    const rig = await drawn();
    await waitFor(() => {
      expect(areas(rig)).toHaveLength(1);
    });
    const moved: Position = [15.5, 58.6];
    act(() => {
      const state = { ...platform(90, moved), version: 2 };
      rig.ctx.live.changes([{
        sequenceNo: 5, requestId: TRACK_1, entityType: 'object', operation: 'update', entityId: TRACK_1, version: 2, previousVersion: 1,
        state, label: state.label, at: '2026-11-09T08:00:01.000Z', by: { plugin: 'simulator' },
      }]);
    });
    expect(areas(rig)[0]?.rings).toEqual(coverageRings(moved, 90, BAND));
  });

  it('a sensor whose platform was deleted has none', async () => {
    const rig = await drawn({ sensors: [sensor({ missing: true }), sensor({ platform: '0192f000-0000-7000-8000-0000000000ee' })] });
    await act(settled);
    expect(rig.map.overlayItems.flat().filter((i) => i.kind === 'area')).toEqual([]);
  });

  it('another workspace clears it, and it is drawn again on the way back', async () => {
    const rig = await drawn();
    await waitFor(() => {
      expect(areas(rig)).toHaveLength(1);
    });
    act(() => {
      rig.map.switchWorkspace();
      rig.ctx.switchWorkspace(VIEW_WORKSPACE);
    });
    expect(last(rig)).toEqual([]);
    act(() => {
      rig.map.switchWorkspace();
      rig.ctx.switchWorkspace(SIMULATION);
    });
    expect(areas(rig)).toHaveLength(1);
  });

  it('"Show coverage" off clears it, is saved for the user, and stays off after a reload; read-only users have it too', async () => {
    const rig = await drawn({ permissions: [VIEW] });
    await waitFor(() => {
      expect(areas(rig)).toHaveLength(1);
    });
    const Sensors = panel(rig.ctx, 'sensors');
    render(<Sensors />);
    const box = await screen.findByRole<HTMLInputElement>('checkbox', { name: 'Show coverage' });
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(box);
      await settled();
    });
    expect(last(rig)).toEqual([]);
    expect(rig.ctx.storedUserDocuments['sensors-view']).toEqual({ showCoverage: false, showDwells: true });
    cleanup();

    const reloaded = await drawn({ documents: { 'sensors-view': { showCoverage: false } } });
    await act(settled);
    expect(reloaded.map.overlayItems.flat().filter((i) => i.kind === 'area')).toEqual([]);
    const Again = panel(reloaded.ctx, 'sensors');
    render(<Again />);
    await waitFor(() => {
      expect(screen.getByRole<HTMLInputElement>('checkbox', { name: 'Show coverage' }).checked).toBe(false);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('checkbox', { name: 'Show coverage' }));
      await settled();
    });
    expect(areas(reloaded)).toHaveLength(1);
  });

  it('stores and sends nothing: no change request, no command, and a scenario\'s file is the same', async () => {
    const rig = await drawn();
    await waitFor(() => {
      expect(areas(rig)).toHaveLength(1);
    });
    expect(rig.ctx.submitted).toEqual([]);
    expect(rig.server.posts()).toEqual([]);
    // The scenario's objects come from the live picture, which the overlay is not part of.
    const objects = [platform(30), symbol(TRACK_2, SIM_LAYER)];
    const scenario = buildScenario('Exercise', [layer(SIM_LAYER, SIMULATION)], objects, { outputs: [], sensors: [] }, new Date('2026-11-09T10:00:00Z'));
    expect(scenario.objects).toHaveLength(2);
    expect(JSON.stringify(scenario)).not.toContain('"area"');
  });
});

describe('the coverage of a generic sensor and a job area (functions 38 and 39; criterion 59)', () => {
  const SQUARE: Position[] = [[15.0, 58.6], [15.6, 58.6], [15.6, 59.2], [15.0, 59.2], [15.0, 58.6]];

  it("draws a generic sensor's disc of its range", () => {
    const generic: SensorSettings = { ...BAND, type: 'GENERIC', range: 30_000 };
    const rings = coverageRings(PLATFORM, 30, generic);
    expect(rings).toHaveLength(1);
    for (const p of ring(rings)) expect(Math.abs(apart(p, PLATFORM) - 30_000)).toBeLessThan(150); // the flat approximation's error
  });

  it('draws the job area (criterion 61, M7): 3 px dotted, filled 15 % in its outline colour (from M8 #BDCF3D by default), before the dashed coverage', async () => {
    const rig = await drawn({ sensors: [sensor({ settings: { ...BAND, jobArea: { type: 'Polygon', coordinates: [SQUARE] } } as unknown as JsonValue })] });
    await waitFor(() => {
      expect(areas(rig)).toHaveLength(2);
    });
    expect(areas(rig)[0]).toEqual({ kind: 'area', rings: [SQUARE], style: { strokeColor: '#BDCF3D', strokeWidth: 3, strokeDash: 'dot', fillColor: '#BDCF3D', fillOpacity: 0.15 }, displayClass: 'sensor-coverage' });
    expect(areas(rig)[1]?.style?.strokeDash).toBe('dash');
    expect(last(rig).findIndex((i) => i.kind === 'area' && i.style?.strokeDash === 'dot')).toBeLessThan(last(rig).findIndex((i) => i.kind === 'area' && i.style?.strokeDash === 'dash'));
  });
});
