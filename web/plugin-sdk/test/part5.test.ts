// SDK 1.2.0 part 5 (CR-0025 parts 5 and 6; ADR-0039, ADR-0040): workspaces (where things appear,
// the fake's live picture by workspace, a switch in the shell's order) and fade lists.
import { describe, expect, it } from 'vitest';
import {
  appearsIn, EVERY_WORKSPACE, VIEW_WORKSPACE, workspaceOf,
  type Layer, type LivePictureListener, type MapObject, type Snapshot, type WorkspaceInfo,
} from '../src/index.ts';
import { createFakeContext, createFakeMapView } from '../src/testing/index.ts';

const SIM: WorkspaceInfo = { id: 'simulator.simulation', name: 'Simulation', viewPermission: 'plugin.simulator.view', editPermission: 'plugin.simulator.edit', order: 100 };
const REPLAY: WorkspaceInfo = { id: 'replay.replay', name: 'Replay', viewPermission: 'plugin.replay.view', editPermission: 'plugin.replay.edit', order: 50 };
const label = { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' };
const meta = { created: { at: '2026-01-01T00:00:00Z', by: { plugin: 'layer-panel' } }, modified: { at: '2026-01-01T00:00:00Z', by: { plugin: 'layer-panel' } } };
const OWN: Layer = { id: '0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e01', version: 1, meta, name: 'Own', drawOrder: 1, visible: true, label };
const RED: Layer = { ...OWN, id: '0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e41', name: 'Red', workspace: SIM.id };

// lon differs from lat, so a swapped order would show
function object(id: string, layerId: string): MapObject {
  return {
    id, version: 1, meta, type: 'core.symbol', dataType: 'core.general', dataSource: 'manual', layerId,
    geometry: { type: 'Point', coordinates: [18.0723, 59.3311] }, symbol: { standard: 'APP-6D', sidc: '10061000001211000000' }, label,
  };
}
const A = object('0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e16', OWN.id);
const B = object('0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e17', RED.id);

function recorder() {
  const got: string[] = [];
  const listener: LivePictureListener = {
    snapshot: (s: Snapshot) => got.push(`snapshot ${s.layers.map((l) => l.name).join(',')} | ${s.objects.length}`),
    changes: (b) => got.push(`changes ${b.map((e) => e.entityId.slice(-2)).join(',')}`),
  };
  return { got, listener };
}

describe('where things appear (SDK 1.2.0)', () => {
  it('is View without a list, every workspace with "*", and the listed ones otherwise', () => {
    expect(appearsIn({}, VIEW_WORKSPACE)).toBe(true);
    expect(appearsIn({}, SIM.id)).toBe(false);
    expect(appearsIn({ workspaces: [EVERY_WORKSPACE] }, SIM.id)).toBe(true);
    expect(appearsIn({ workspaces: [SIM.id] }, VIEW_WORKSPACE)).toBe(false);
    expect(workspaceOf(OWN)).toBe(VIEW_WORKSPACE);
    expect(workspaceOf(RED)).toBe(SIM.id);
  });
});

describe('the fake context with workspaces (SDK 1.2.0)', () => {
  it('lists View first, then the others by order, and starts in the one given', () => {
    const ctx = createFakeContext({ workspaces: [SIM, REPLAY], workspace: SIM.id });
    expect(ctx.workspaces.map((w) => w.id)).toEqual([VIEW_WORKSPACE, REPLAY.id, SIM.id]);
    expect(ctx.workspace.current.id).toBe(SIM.id);
    expect(() => createFakeContext({ workspace: SIM.id })).toThrow('no workspace');
  });

  it('gives each subscription the layers and objects of its workspaces only', () => {
    const ctx = createFakeContext({ workspaces: [SIM] });
    const follows = recorder();
    const fixed = recorder();
    ctx.livePicture.subscribe(follows.listener);
    ctx.livePicture.subscribe(fixed.listener, { workspaces: [SIM.id, VIEW_WORKSPACE] });
    ctx.live.snapshot({ layers: [OWN, RED], objects: [A, B] });
    expect(follows.got).toEqual(['snapshot Own | 1']);
    expect(fixed.got).toEqual(['snapshot Own,Red | 2']);
    const moved = (o: MapObject) => ({
      sequenceNo: 2, requestId: o.id, entityType: 'object' as const, operation: 'update' as const, entityId: o.id, version: 2, previousVersion: 1,
      state: o, label, at: '2026-01-01T00:00:01Z', by: { plugin: 'simulator' },
    });
    ctx.live.changes([moved(A), moved(B)]);
    expect(follows.got.at(-1)).toBe('changes 16');
    expect(fixed.got.at(-1)).toBe('changes 16,17');
  });

  it('counts only the layers of the workspaces for objects: false', () => {
    const ctx = createFakeContext({ workspaces: [SIM] });
    const counts: unknown[] = [];
    ctx.livePicture.subscribe({ snapshot: (s) => counts.push(s.objectCounts), changes: () => {} }, { objects: false });
    ctx.live.snapshot({ layers: [OWN, RED], objects: [A, B] });
    expect(counts).toEqual([{ [OWN.id]: 1 }]);
  });

  it('switches as the shell does: fresh snapshots, then the setup share, then onChange', () => {
    const ctx = createFakeContext({ workspaces: [SIM] });
    const order: string[] = [];
    ctx.livePicture.subscribe({ snapshot: (s) => order.push(`snapshot ${s.layers.map((l) => l.name).join(',')}`), changes: () => {} });
    ctx.livePicture.subscribe({ snapshot: () => order.push('fixed snapshot'), changes: () => {} }, { workspaces: [VIEW_WORKSPACE] });
    let dim = 0;
    ctx.setup.register({ save: () => ({ dim }), restore: (s) => order.push(`restore ${JSON.stringify(s)}`) });
    ctx.workspace.onChange((w) => order.push(`onChange ${w.id}`));
    ctx.live.snapshot({ layers: [OWN, RED], objects: [A, B] });
    ctx.switchWorkspace(SIM.id);
    dim = 30;
    ctx.saveSetup(); // saved for Simulation
    ctx.switchWorkspace(VIEW_WORKSPACE);
    order.length = 0;
    ctx.switchWorkspace(SIM.id);
    expect(order).toEqual(['snapshot Red', 'restore {"dim":30}', `onChange ${SIM.id}`]);
    expect(ctx.workspace.current.name).toBe('Simulation');
  });
});

describe('the fake live picture by workspace, further (SDK 1.2.0)', () => {
  const event = (o: MapObject | Layer, deleted = false) => ({
    sequenceNo: 5, requestId: o.id, entityType: ('layerId' in o ? 'object' : 'layer') as 'object' | 'layer', operation: (deleted ? 'delete' : 'update') as 'delete' | 'update',
    entityId: o.id, version: 2, previousVersion: 1, state: deleted ? null : o, label, at: '2026-01-01T00:00:01Z', by: { plugin: 'simulator' },
  });

  it('replays on a switch what the batches changed since the snapshot', () => {
    const ctx = createFakeContext({ workspaces: [SIM] });
    const r = recorder();
    ctx.livePicture.subscribe(r.listener);
    ctx.live.snapshot({ layers: [OWN, RED], objects: [A] });
    const C = object('0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e18', RED.id);
    ctx.live.changes([event(C), event(B)]);
    ctx.live.changes([event(C, true)]); // a delete reaches only who has the object's workspace
    ctx.switchWorkspace(SIM.id);
    expect(r.got.at(-1)).toBe('snapshot Red | 1'); // B created, C deleted
  });

  it('gives "*" every workspace, and filters area changes and supplied counts', () => {
    const ctx = createFakeContext({ workspaces: [SIM] });
    const every = recorder();
    ctx.livePicture.subscribe(every.listener, { workspaces: ['*'] });
    const entered: string[][] = [];
    ctx.livePicture.subscribe({ snapshot: () => {}, changes: () => {}, area: (c) => entered.push(c.entered.map((o) => o.id)) }, { area: 'viewport' });
    const counts: unknown[] = [];
    ctx.livePicture.subscribe({ snapshot: (s) => counts.push(s.objectCounts), changes: () => {} });
    ctx.live.snapshot({ layers: [OWN, RED], objects: [A, B], objectCounts: { [OWN.id]: 7, [RED.id]: 9 } });
    expect(every.got).toEqual(['snapshot Own,Red | 2']);
    ctx.live.area({ sequenceNo: 2, entered: [A, B], left: [] });
    expect(entered).toEqual([[A.id]]);
    expect(counts).toEqual([{ [OWN.id]: 7 }]);
  });
});

describe('fade lists (SDK 1.2.0)', () => {
  it('belong to their handle and plugin, fade their union, and a switch clears them and ends interactions', async () => {
    const map = createFakeMapView({ pluginId: 'simulator' });
    const sim = map.createFadeList();
    const other = map.asPlugin('replay').createFadeList();
    sim.set([A.id]);
    other.set([A.id, B.id]);
    expect(map.fadeLists).toEqual([{ plugin: 'simulator', ids: [A.id] }, { plugin: 'replay', ids: [A.id, B.id] }]);
    expect([...map.faded].sort()).toEqual([A.id, B.id].sort());
    other.clear();
    expect([...map.faded]).toEqual([A.id]);
    const picking = map.pickPoint();
    map.switchWorkspace();
    await expect(picking).resolves.toBeNull();
    expect(map.faded.size).toBe(0);
    expect(map.asPlugin('replay').viewport).toEqual(map.viewport);
  });

  it('a switch clears the selection at the moment of the map view, so what is set again after it stays', async () => {
    const ctx = createFakeContext({ workspaces: [SIM] });
    const map = createFakeMapView({ pluginId: 'simulator' });
    const list = map.createFadeList();
    map.selection.set([A.id]);
    map.activeLayer.set(OWN.id);
    const before = map.pickPoint();
    // A plugin that follows the workspace sets its list from the fresh snapshot; one whose
    // subscription names its workspace gets no fresh snapshot and sets its list from onChange; a
    // third starts placing again from onChange. All come after the map view's moment.
    ctx.livePicture.subscribe({ snapshot: (s) => list.set(s.objects.map((o) => o.id)), changes: () => {} });
    const named = map.asPlugin('replay').createFadeList();
    let held: string[] = [];
    ctx.livePicture.subscribe({ snapshot: (s) => { held = s.objects.map((o) => o.id); }, changes: () => {} }, { workspaces: [SIM.id] });
    ctx.workspace.onChange(() => named.set(held));
    let placing: Promise<unknown> | null = null;
    ctx.workspace.onChange(() => { placing = map.pickPoint(); });
    ctx.live.snapshot({ layers: [OWN, RED], objects: [A, B] });
    map.switchWorkspace();
    ctx.switchWorkspace(SIM.id);
    await expect(before).resolves.toBeNull();
    expect(map.selection.value).toEqual([]);
    expect(map.activeLayer.value).toBe(OWN.id);
    expect(map.fadeLists).toEqual([{ plugin: 'simulator', ids: [B.id] }, { plugin: 'replay', ids: [B.id] }]);
    expect(placing).not.toBeNull();
    expect(map.runningInteraction).toBe('pickPoint');
  });
});
