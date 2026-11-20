// Scenarios (brief function 32; criteria 46 and 47; A108 to A112): the export from the live picture
// and the server part's own part, and the import as new or merged, with every id new. From M7 in the
// top bar's Scenario button (function 48, criterion 71; SDK 1.6.0 part F).
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangeRequest, JsonValue, MapObject, RelationKind } from '@emc2/plugin-sdk';
import { buildScenario, FORMAT, remap } from '../src/scenario.ts';
import type { Scenario } from '../src/scenario.ts';
import { topBarItemAppearsIn } from '@emc2/plugin-sdk';
import { activated, EDIT, groups, layer, panel, route, ROUTE_A, ROUTE_B, routeInfo, SIM_LAYER, symbol, topBarItem, TRACK_1, TRACK_2, TRACK_3, VIEW } from './harness.tsx';
import type { Rig } from './harness.tsx';

const KINDS: readonly RelationKind[] = [{ id: 'gmti.pairing', label: 'GMTI Pairing', line: { strokeColor: '#FFFF00', strokeWidth: 1, strokeDash: 'solid', arrowhead: 'none' }, defaultOn: false }];
const ELSEWHERE = '0192f000-0000-7000-8000-0000000000ff';
const STATE = {
  outputs: ['cot/tak-out'],
  sensors: [{ platform: TRACK_1, settings: { revisitSeconds: 10, mission: 'ATO-2611-BRAVO', outputs: ['gmti/vista-out'] } }],
};

function objects(): readonly MapObject[] {
  const hide = { kind: 'hide', objects: [TRACK_2] };
  return [
    route(ROUTE_A, 'Alpha', { groups: groups(TRACK_1, TRACK_2), points: [{ speed: 8.33, events: [hide] }, { speed: 8.33 }] }),
    route(ROUTE_B, 'Bravo', { groups: groups(TRACK_3) }),
    { ...symbol(TRACK_1, SIM_LAYER), relations: [{ kind: 'gmti.pairing', objectId: TRACK_2 }, { kind: 'gmti.pairing', objectId: ELSEWHERE }] },
    symbol(TRACK_2, SIM_LAYER),
    symbol(TRACK_3, SIM_LAYER),
  ];
}

let blobs: Blob[] = [];
let downloads: string[] = [];

beforeEach(() => {
  blobs = [];
  downloads = [];
  URL.createObjectURL = vi.fn((b: Blob) => {
    blobs.push(b);
    return 'blob:scenario';
  });
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    downloads.push(this.download);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function scenarioMenu(locked = false, running = false, permissions?: readonly string[]): Promise<Rig> {
  const rig = await activated({ relationKinds: KINDS, ...(permissions === undefined ? {} : { permissions }) });
  rig.ctx.live.snapshot({ layers: [{ ...layer(SIM_LAYER, 'simulator.simulation'), ...(locked ? { locked: true } : {}) }], objects: objects() });
  rig.ctx.setServerObjects(objects());
  rig.server.on('GET', 'routes', { status: 200, body: { running, routes: [routeInfo(ROUTE_A, 'Alpha'), routeInfo(ROUTE_B, 'Bravo')] } });
  rig.server.on('GET', 'scenario-state', { status: 200, body: STATE });
  rig.server.on('POST', 'scenario-state', { status: 200, body: STATE });
  rig.server.on('POST', 'routes/reset', { status: 200, body: { running: false, routes: [] } });
  const Scenario = topBarItem(rig.ctx, 'scenario');
  render(<Scenario />);
  return rig;
}

/** Opens the Scenario button's menu. */
async function openMenu(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: 'Scenario' }));
  await screen.findByRole('menu', { name: 'Scenario' });
}

function scenarioFile(more: { readonly [key: string]: JsonValue } = {}): File {
  const scenario = buildScenario('Exercise', [layer(SIM_LAYER, 'simulator.simulation')], objects(), STATE, new Date('2026-11-08T10:00:00Z'));
  return new File([JSON.stringify({ ...scenario, ...more })], 'Exercise.emcc-scenario.json', { type: 'application/json' });
}

async function upload(file: File): Promise<void> {
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Scenario file'), { target: { files: [file] } });
    await new Promise((r) => setTimeout(r, 0));
  });
}

function deletes(rig: Rig): readonly ChangeRequest[] {
  return rig.ctx.submitted.filter((r) => r.operation === 'delete');
}

describe('the scenario file (criterion 46)', () => {
  it('remaps every id: layers, objects, a route\'s groups and events, the sensor\'s platform and relations; a relation out of the file is dropped', () => {
    const scenario = buildScenario('Exercise', [layer(SIM_LAYER, 'simulator.simulation')], objects(), STATE, new Date());
    let n = 0;
    const next = remap(scenario, () => `0192f000-0000-7000-9000-${String(++n).padStart(12, '0')}`);
    const text = JSON.stringify(next);
    for (const old of [SIM_LAYER, ROUTE_A, ROUTE_B, TRACK_1, TRACK_2, TRACK_3, ELSEWHERE]) expect(text).not.toContain(old);
    const byName = (name: string) => next.objects.find((o) => o.properties?.name === name);
    const alpha = byName('Alpha');
    const track1 = byName('Track 1');
    const track2 = byName('Track 2');
    expect(alpha?.layerId).toBe(next.layers[0]?.id);
    expect(JSON.stringify(alpha?.extensions?.['simulator'])).toContain(track1?.id ?? 'none');
    expect(JSON.stringify(alpha?.extensions?.['simulator'])).toContain(track2?.id ?? 'none'); // the event's tracks
    expect(alpha?.extensions?.['other']).toEqual({ kept: true });
    expect(track1?.relations).toEqual([{ kind: 'gmti.pairing', objectId: track2?.id }]);
    expect(next.simulator.sensors).toEqual([{ platform: track1?.id, settings: STATE.sensors[0]?.settings }]);
    expect(next.simulator.outputs).toEqual(['cot/tak-out']);
  });
});

describe('"Export scenario" (criterion 46)', () => {
  it('saves <name>.emcc-scenario.json with the layers, every object and the simulator\'s own part, the Mission included', async () => {
    await scenarioMenu();
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Export scenario…' }));
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.change(screen.getByLabelText('Scenario name'), { target: { value: 'Exercise' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Export' }));
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(downloads).toEqual(['Exercise.emcc-scenario.json']);
    const file = JSON.parse(await (blobs[0] ?? new Blob()).text()) as Scenario;
    expect(file.format).toBe(FORMAT);
    expect(file.version).toBe(1);
    expect(file.name).toBe('Exercise');
    expect(file.layers.map((l) => l.id)).toEqual([SIM_LAYER]);
    expect(file.objects).toHaveLength(5);
    expect(file.objects.find((o) => o.id === TRACK_1)?.relations).toHaveLength(2);
    expect(file.objects[0]).not.toHaveProperty('version');
    expect(file.simulator.sensors[0]?.settings['mission']).toBe('ATO-2611-BRAVO');
  });
});

describe('"Import scenario" (criterion 46)', () => {
  it('as new asks first, then resets, deletes Simulation\'s objects and layers, and creates the scenario\'s with new ids', async () => {
    const rig = await scenarioMenu();
    await upload(scenarioFile());
    expect(screen.getByText('1 layer and 5 objects.')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(screen.getByText('Delete 1 layer and 5 objects of Simulation?')).toBeDefined();
    expect(rig.ctx.submitted).toEqual([]);
    expect(rig.server.posts('routes/reset')).toHaveLength(0);
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete and import' }));
    });
    await waitFor(() => {
      expect(rig.server.posts('scenario-state')).toHaveLength(1);
    });
    expect(rig.server.posts('routes/reset')).toHaveLength(1);
    expect(deletes(rig)).toHaveLength(6);
    const creates = rig.ctx.submitted.filter((r) => r.operation === 'create');
    expect(creates).toHaveLength(6);
    expect(creates.every((r) => ![SIM_LAYER, ROUTE_A, ROUTE_B, TRACK_1, TRACK_2, TRACK_3].includes(r.entityId))).toBe(true);
    // The file has the routes first; they are created after the tracks, which the server part needs (function 9a).
    const names = creates.flatMap((r) => (r.entityType === 'object' && 'data' in r ? [String(r.data.properties?.name)] : []));
    expect(names).toEqual(['Track 1', 'Track 2', 'Track 3', 'Alpha', 'Bravo']);
    const newTrack1 = creates.find((r) => r.entityType === 'object' && 'data' in r && r.data.properties?.name === 'Track 1')?.entityId;
    const posted = rig.server.posts('scenario-state')[0]?.body as { readonly mode: string; readonly sensors: readonly { readonly platform: string }[] };
    expect(posted.mode).toBe('new');
    expect(posted.sensors[0]?.platform).toBe(newTrack1);
    expect(await screen.findByText(/Imported: 6 layers and objects created, 6 deleted/)).toBeDefined();
  });

  it('merge keeps what is there, and imports as merged', async () => {
    const rig = await scenarioMenu();
    await upload(scenarioFile());
    fireEvent.change(screen.getByLabelText('Import'), { target: { value: 'merge' } });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    });
    await waitFor(() => {
      expect(rig.server.posts('scenario-state')).toHaveLength(1);
    });
    expect(deletes(rig)).toEqual([]);
    expect(rig.server.posts('routes/reset')).toHaveLength(0);
    expect((rig.server.posts('scenario-state')[0]?.body as { readonly mode: string }).mode).toBe('merge');
  });

  it("leaves a generic sensor out and lists it, loading the ground radar and both platforms (criterion 52; owner PX, Q52 B)", async () => {
    const rig = await scenarioMenu();
    const sensors = [
      { platform: TRACK_1, settings: { type: 'GROUND_RADAR', revisitSeconds: 10, outputs: [] } },
      { platform: TRACK_3, settings: { type: 'GENERIC', range: 50_000, outputs: [] } },
    ];
    await upload(scenarioFile({ simulator: { outputs: [], sensors } }));
    fireEvent.change(screen.getByLabelText('Import'), { target: { value: 'merge' } });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    });
    await waitFor(() => {
      expect(rig.server.posts('scenario-state')).toHaveLength(1);
    });
    const creates = rig.ctx.submitted.filter((r) => r.operation === 'create');
    const newId = (name: string) => creates.find((r) => r.entityType === 'object' && 'data' in r && r.data.properties?.name === name)?.entityId;
    expect(newId('Track 3')).toBeDefined();
    const posted = rig.server.posts('scenario-state')[0]?.body as { readonly sensors: readonly { readonly platform: string }[] };
    expect(posted.sensors.map((s) => s.platform)).toEqual([newId('Track 1')]);
    expect(await screen.findByText('Track 3: generic sensors come later; not loaded')).toBeDefined();
  });

  it('refuses a version 2 file and a simulator part over 1 MiB before anything changes', async () => {
    const rig = await scenarioMenu();
    await upload(scenarioFile({ version: 2 }));
    expect(screen.getByText(/version 2, made by a newer emcc/)).toBeDefined();
    await upload(scenarioFile({ simulator: { outputs: ['x'.repeat(1024 * 1024)], sensors: [] } }));
    expect(screen.getByText(/larger than 1 MiB/)).toBeDefined();
    expect(rig.ctx.submitted).toEqual([]);
    expect(rig.server.posts()).toEqual([]);
  });

  it('lists a locked layer\'s refusals', async () => {
    await scenarioMenu(true);
    await upload(scenarioFile());
    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Delete and import' }));
    });
    const refused = await screen.findByRole('list', { name: 'Refused' });
    expect(within(refused).getAllByText(/is locked/).length).toBeGreaterThan(0);
  });

  it('is greyed with its reason while the simulation runs', async () => {
    await scenarioMenu(false, true);
    await openMenu();
    expect(await screen.findByText('Pause or reset the simulation before importing a scenario')).toBeDefined();
    expect(screen.getByRole('menuitem', { name: 'Import scenario…' })).toHaveProperty('disabled', true);
    expect(screen.getByRole('menuitem', { name: 'Export scenario…' })).toHaveProperty('disabled', false);
  });
});

describe('the Scenario button (function 48, criterion 71; SDK 1.6.0 part F)', () => {
  it('is a top-bar item in Simulation and not in View, after the bookmarks', async () => {
    const rig = await activated();
    const item = rig.ctx.topBarItems.find((i) => i.id === 'scenario');
    expect(item?.order).toBe(20);
    expect(item === undefined ? null : [topBarItemAppearsIn(item, 'simulator.simulation'), topBarItemAppearsIn(item, 'core.view')]).toEqual([true, false]);
  });

  it('replaces the two buttons in the Routes panel', async () => {
    const rig = await activated();
    const Routes = panel(rig.ctx, 'routes');
    render(<Routes />);
    await screen.findByText('No routes in Simulation yet.');
    expect(screen.queryByRole('button', { name: /scenario/i })).toBeNull();
    expect(screen.queryByLabelText('Scenario file')).toBeNull();
  });

  it('greys Import with its reason for a user who may not change or run the simulation; Export stays', async () => {
    await scenarioMenu(false, false, [VIEW, EDIT]);
    await openMenu();
    expect(screen.getByRole('menuitem', { name: 'Import scenario…' })).toHaveProperty('disabled', true);
    expect(screen.getByText('Importing a scenario needs the rights to change and to run the simulation')).toBeDefined();
    expect(screen.getByRole('menuitem', { name: 'Export scenario…' })).toHaveProperty('disabled', false);
  });

  it('Import opens the file chooser and closes the menu; a refused file is told in the menu, opened again', async () => {
    await scenarioMenu();
    await openMenu();
    const input = screen.getByLabelText<HTMLInputElement>('Scenario file');
    const chooser = vi.spyOn(input, 'click').mockImplementation(() => undefined);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Import scenario…' }));
    expect(chooser).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('menu')).toBeNull();
    await upload(scenarioFile({ version: 2 }));
    expect(screen.getByRole('menu', { name: 'Scenario' })).toBeDefined();
    expect(screen.getByText(/version 2, made by a newer emcc/)).toBeDefined();
  });
});
