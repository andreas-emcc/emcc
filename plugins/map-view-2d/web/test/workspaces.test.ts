/**
 * The map view in workspaces (brief functions 22 to 25, criteria 44 to 48 and 50; T-085): the
 * switch's moment as the shell gives it (`emc2:workspace-switch` on the Map Pane's element, then
 * the test kit's `switchWorkspace` for the steps after it), the map state, the active layer and the
 * local visibility per workspace, View's layers as a reference, and the fade lists.
 */
import { describe, expect, it } from 'vitest';
import { EVERY_WORKSPACE, MAP_VIEW, NotOnMapError, VIEW_WORKSPACE, type JsonValue, type Layer, type MapView, type Position, type Uuid, type WorkspaceInfo } from '@emc2/plugin-sdk';
import { createFakeContext, type FakeContext } from '@emc2/plugin-sdk/testing';
import { SWITCH_EVENT } from '../src/activate.tsx';
import { event, layer, symbolObject, uuid } from './fixtures.ts';
import { activate, type MountableFakeEngine } from './harness.ts';

const SIM = 'simulator.simulation';
const SIMULATION: WorkspaceInfo = { id: SIM, name: 'Simulation', viewPermission: 'plugin.simulator.view', editPermission: 'plugin.simulator.edit', order: 10 };

function simLayer(n: number, drawOrder: number): Layer {
  return { ...layer(n, drawOrder), workspace: SIM };
}

// View: V on top of V2. Simulation: S2 on top of S. V is above both by drawOrder alone.
const V = layer(1, 50);
const V2 = layer(2, 10);
const S = simLayer(11, 0);
const S2 = simLayer(12, 5);
const v = symbolObject(101, V.id, 12, 58);
const v2 = symbolObject(102, V2.id, 13, 57);
const s = symbolObject(111, S.id, 16, 61);
const s2 = symbolObject(112, S2.id, 17, 63);
const PICTURE = { layers: [V, V2, S, S2], objects: [v, v2, s, s2] };

interface Started {
  readonly ctx: FakeContext;
  readonly engine: MountableFakeEngine;
  readonly map: MapView;
  readonly controller: ReturnType<typeof activate>['result']['controller'];
  readonly clock: ReturnType<typeof activate>['clock'];
  /** A switch as the shell makes it: the map view's moment on the Map Pane's element, then steps 3 to 5. */
  readonly switchTo: (id: string) => void;
  readonly moment: (id: string) => void;
}

/** The map view in View (or `workspace`), mounted, with the picture fed; `before` runs before it activates. */
async function start(options: { readonly workspace?: string; readonly before?: (ctx: FakeContext) => void; readonly share?: JsonValue } = {}): Promise<Started> {
  const ctx = createFakeContext({ pluginId: 'map-view-2d', provides: ['emc2.map-view'], workspaces: [SIMULATION], ...(options.workspace === undefined ? {} : { workspace: options.workspace }) });
  options.before?.(ctx);
  const { engine, clock, result } = activate({ ctx });
  if (engine === null) throw new Error('no engine');
  const element = document.createElement('div');
  ctx.mapViewMount?.mount(element);
  if (options.share !== undefined) ctx.restoreSetup(options.share);
  const map = await ctx.services.get(MAP_VIEW);
  ctx.live.snapshot(PICTURE);
  const moment = (id: string) => {
    element.dispatchEvent(new CustomEvent(SWITCH_EVENT, { detail: { workspace: id } }));
  };
  const switchTo = (id: string) => {
    moment(id);
    ctx.switchWorkspace(id);
  };
  return { ctx, engine, map, controller: result.controller, clock, switchTo, moment };
}

const fadedIn = (engine: MountableFakeEngine, layerId: Uuid, id: Uuid) => engine.items.get(layerId)?.get(id)?.faded === true;
const stackOf = (engine: MountableFakeEngine, layerId: Uuid) => engine.layers.find((l) => l.id === layerId)?.stack ?? -1;
const workspacesNamed = (ctx: FakeContext) => {
  expect(ctx.liveSubscriptions).toHaveLength(1);
  return ctx.liveSubscriptions[0]?.workspaces;
};
const expectCentre = (map: MapView, [lon, lat]: Position) => {
  expect(map.viewport.center[0]).toBeCloseTo(lon, 6);
  expect(map.viewport.center[1]).toBeCloseTo(lat, 6);
};

describe('criterion 44 (brief function 22): every workspace', () => {
  it('the Map Pane controls, Centre map, Centre on and Zoom to appear in every workspace', async () => {
    const { ctx } = await start();
    expect(ctx.overlays.map((o) => [o.id, o.workspaces])).toEqual([['map-view-2d-controls', [EVERY_WORKSPACE]]]);
    expect(ctx.mapActions.map((a) => [a.id, a.workspaces])).toEqual([['centre-map', [EVERY_WORKSPACE]]]);
    expect(ctx.objectActions.map((a) => [a.id, a.workspaces])).toEqual([['centre-on', [EVERY_WORKSPACE]], ['zoom-to', [EVERY_WORKSPACE]]]);
  });

  it('a switch resolves a running draw with null, clears the selection and every fade list, and then draws only the new workspace\'s objects', async () => {
    const { engine, map, switchTo } = await start();
    expect(engine.idsIn(V.id)).toEqual([v.id]);
    map.selection.set([v.id]);
    map.createFadeList().set([v.id, s.id]);
    const drawing = map.draw('line');
    switchTo(SIM);
    await expect(drawing).resolves.toBeNull();
    expect(engine.interaction).toBe('none');
    expect(map.selection.value).toEqual([]);
    expect(engine.layers.map((l) => l.id)).toEqual([S.id, S2.id]);
    expect(engine.idsIn(S.id)).toEqual([s.id]);
    expect(fadedIn(engine, S.id, s.id)).toBe(false); // the list was cleared at the moment
    switchTo(VIEW_WORKSPACE);
    expect(engine.layers.map((l) => l.id)).toEqual([V2.id, V.id]);
    expect(fadedIn(engine, V.id, v.id)).toBe(false);
  });

  it('the software rendering notice is in every workspace too', () => {
    const { ctx } = activate({ mode: 'software', ctx: createFakeContext({ pluginId: 'map-view-2d', provides: ['emc2.map-view'], workspaces: [SIMULATION] }) });
    expect(ctx.overlays.map((o) => [o.id, o.workspaces])).toEqual([['map-view-2d-controls', [EVERY_WORKSPACE]], ['map-view-2d-rendering', [EVERY_WORKSPACE]]]);
  });

  it('listens for the moment only while mounted, and takes the workspace shown when the event names none', () => {
    const ctx = createFakeContext({ pluginId: 'map-view-2d', provides: ['emc2.map-view'], workspaces: [SIMULATION] });
    let current: WorkspaceInfo = { id: VIEW_WORKSPACE, name: 'View', order: 0 };
    // The shell shows the new workspace before its moment (CurrentWorkspace step 1).
    const context = Object.create(ctx, {
      workspace: { value: { get current() { return current; }, onChange: (l: (w: WorkspaceInfo) => void) => ctx.workspace.onChange(l) } },
    }) as FakeContext;
    const { result } = activate({ ctx, context });
    const element = document.createElement('div');
    const unmount = ctx.mapViewMount?.mount(element);
    current = SIMULATION;
    element.dispatchEvent(new CustomEvent(SWITCH_EVENT));
    expect(result.controller.workspace).toBe(SIM);
    unmount?.();
    current = { id: VIEW_WORKSPACE, name: 'View', order: 0 };
    element.dispatchEvent(new CustomEvent(SWITCH_EVENT, { detail: { workspace: VIEW_WORKSPACE } }));
    expect(result.controller.workspace).toBe(SIM);
  });

  it('without a Map Pane to give the moment, the moment\'s steps come with onChange', async () => {
    const ctx = createFakeContext({ pluginId: 'map-view-2d', provides: ['emc2.map-view'], workspaces: [SIMULATION] });
    activate({ ctx });
    const map = await ctx.services.get(MAP_VIEW);
    ctx.live.snapshot(PICTURE);
    map.selection.set([v.id]);
    const picking = map.pickPoint();
    ctx.switchWorkspace(SIM);
    await expect(picking).resolves.toBeNull();
    expect(map.selection.value).toEqual([]);
  });
});

describe('criterion 44 (review F3): the old workspace\'s objects until the fresh snapshot', () => {
  it('are hidden at the moment, so not drawn, picked or selected, while the subscription follows the workspace shown', async () => {
    const { ctx, engine, map, moment } = await start();
    const switchTo = (id: string) => {
      moment(id);
      ctx.switchWorkspace(id);
    };
    switchTo(SIM);
    const atS = engine.pixelOf([16, 61]);
    expect(map.pick(atS)).toEqual([s.id]);
    moment(VIEW_WORKSPACE); // the fresh snapshot of View has not come yet
    expect(engine.layers.filter((l) => l.visible)).toEqual([]);
    expect(map.pick(atS)).toEqual([]);
    engine.pointer('click', atS);
    expect(map.selection.value).toEqual([]);
    expect(map.isLayerVisible(S.id)).toBe(false);
    ctx.switchWorkspace(VIEW_WORKSPACE);
    expect(engine.layers.map((l) => [l.id, l.visible])).toEqual([[V2.id, true], [V.id, true]]);
  });
});

describe('criterion 45 (brief function 22): the map state per workspace', () => {
  it('restores each workspace\'s centre, zoom, map type, dim level and layer visibility on a switch back and after a reload; the first visit keeps the map', async () => {
    const { ctx, map, controller, switchTo } = await start();
    map.goTo([10, 55], 2000);
    controller.setDim(20);
    map.setLayerVisible(V2.id, false);
    ctx.saveSetup(); // the shell keeps the setup of the workspace left

    switchTo(SIM); // first visit: no share saved for it
    expectCentre(map, [10, 55]);
    expect(map.viewport.resolution).toBeCloseTo(2000, 3);
    expect(map.mapType.projection).toBe('EPSG:3857');
    expect(controller.dimLevel).toBe(20);
    expect([map.isLayerVisible(S.id), map.isLayerVisible(S2.id)]).toEqual([true, true]); // their own `visible` field
    controller.setProjection('EPSG:3413');
    map.goTo([20, 70], 3000);
    controller.setDim(40);
    map.setLayerVisible(S2.id, false);
    const simShare = ctx.saveSetup();

    switchTo(VIEW_WORKSPACE);
    expectCentre(map, [10, 55]);
    expect(map.viewport.resolution).toBeCloseTo(2000, 3);
    expect(map.mapType.projection).toBe('EPSG:3857');
    expect(controller.dimLevel).toBe(20);
    expect([map.isLayerVisible(V.id), map.isLayerVisible(V2.id)]).toEqual([true, false]);

    switchTo(SIM);
    expectCentre(map, [20, 70]);
    expect(map.viewport.resolution).toBeCloseTo(3000, 3);
    expect(map.mapType.projection).toBe('EPSG:3413');
    expect(controller.dimLevel).toBe(40);
    expect([map.isLayerVisible(S.id), map.isLayerVisible(S2.id)]).toEqual([true, false]);

    // A reload in Simulation: the shell restores Simulation's share.
    const reloaded = await start({ workspace: SIM, share: simShare });
    expectCentre(reloaded.map, [20, 70]);
    expect(reloaded.map.mapType.projection).toBe('EPSG:3413');
    expect(reloaded.controller.dimLevel).toBe(40);
    expect([reloaded.map.isLayerVisible(S.id), reloaded.map.isLayerVisible(S2.id)]).toEqual([true, false]);
  });
});

describe('criterion 45 (ITA finding e): nothing drawn before the share is restored', () => {
  it('from the moment until onChange no layer is drawn, so the fresh snapshot never shows at the old workspace\'s centre; the eyes stay', async () => {
    const { ctx, engine, map, moment, switchTo } = await start();
    map.goTo([10, 55], 2000);
    ctx.saveSetup();
    switchTo(SIM);
    map.goTo([20, 62], 500);
    ctx.saveSetup();
    // Each time the engine gets its layers: where the map is, and which layers it draws.
    const drawn: { readonly lon: number; readonly ids: readonly Uuid[] }[] = [];
    const setLayers = engine.setLayers.bind(engine);
    engine.setLayers = (layers) => {
      setLayers(layers);
      drawn.push({ lon: map.viewport.center[0], ids: layers.filter((l) => l.visible).map((l) => l.id) });
    };
    const reported: [Uuid, boolean][] = [];
    map.onLayerVisibilityChange((id, visible) => { reported.push([id, visible]); });
    // Back to View: View's fresh snapshot (step 3) comes before the shell restores View's share
    // (step 4); after a reload the server's snapshot throttle can keep step 3 waiting for 2 s.
    moment(VIEW_WORKSPACE);
    expect(engine.layers.filter((l) => l.visible)).toEqual([]);
    ctx.switchWorkspace(VIEW_WORKSPACE);
    expect(drawn.filter((d) => d.ids.length > 0).map((d) => d.lon)).toEqual([expect.closeTo(10, 6)]);
    expectCentre(map, [10, 55]);
    expect(engine.layers.map((l) => [l.id, l.visible])).toEqual([[V2.id, true], [V.id, true]]);
    expect(engine.idsIn(V.id)).toEqual([v.id]);
    expect(map.pick(engine.pixelOf([12, 58]))).toEqual([v.id]);
    // View's eyes went on once, at the moment (they were references in Simulation), and did not go off and on.
    expect(reported.filter(([id]) => id === V.id)).toEqual([[V.id, true]]);
    expect(reported.filter(([id]) => id === V2.id)).toEqual([[V2.id, true]]);
  });

  it('an object of the fresh snapshot is not picked or edited mid-switch, and is from onChange on', async () => {
    const { ctx, engine, map, controller, moment, switchTo } = await start();
    switchTo(SIM);
    moment(VIEW_WORKSPACE);
    // View's fresh snapshot, straight to the map view (the test kit's switch gives it only with steps 4 and 5).
    controller.listener.snapshot({ ...PICTURE, sequenceNo: 2 });
    const atV = engine.pixelOf([12, 58]);
    expect(engine.idsIn(V.id)).toEqual([v.id]);
    expect(map.pick(atV)).toEqual([]);
    await expect(map.edit(v.id)).rejects.toBeInstanceOf(NotOnMapError);
    ctx.switchWorkspace(VIEW_WORKSPACE);
    expect(map.pick(atV)).toEqual([v.id]);
    const stop = new AbortController();
    const editing = map.edit(v.id, { signal: stop.signal });
    expect(engine.interaction).toBe('edit');
    stop.abort();
    await expect(editing).resolves.toBeNull();
  });

  it('holds clusters that come mid-switch until onChange', async () => {
    const { ctx, engine, controller, moment, switchTo } = await start();
    switchTo(SIM);
    moment(VIEW_WORKSPACE);
    ctx.live.clusters({ level: 6, full: true, upsert: [{ cell: 'c', position: [12, 58], count: 9, byLayer: { [V.id]: 9 }, byIdentity: { friend: 9, hostile: 0, neutral: 0, unknown: 0 } }], remove: [] });
    expect(engine.clusters).toEqual([]);
    controller.workspaceShown(VIEW_WORKSPACE); // the map view's onChange listener
    expect(engine.clusters.map((c) => c.count)).toEqual([9]);
  });
});

describe('criterion 46 (brief function 22): the active layer per workspace', () => {
  /** layer-panel's gap filling (its function 21): the top layer of the workspace shown when the active layer is not one of its layers. */
  const fillGap = (map: () => MapView, workspace: string) => {
    const own = workspace === SIM ? [S2, S] : [V, V2];
    const active = map().activeLayer.value;
    if (!own.some((l) => l.id === active)) map().activeLayer.set(own[0]?.id ?? null);
  };

  it.each(['before', 'after'])('brings back each workspace\'s active layer, with layer-panel\'s listener running %s the map view\'s', async (order) => {
    let shown: MapView | null = null;
    const map = () => shown as unknown as MapView;
    const listen = (ctx: FakeContext) => ctx.workspace.onChange((w) => {
      fillGap(map, w.id);
    });
    const started = await start(order === 'before' ? { before: listen } : {});
    if (order === 'after') listen(started.ctx);
    shown = started.map;
    started.map.activeLayer.set(V2.id); // A: not View's top layer, so not what a gap fill gives
    started.switchTo(SIM);
    expect(started.map.activeLayer.value).toBe(S2.id); // first visit: the map view sets none, layer-panel the top layer
    started.map.activeLayer.set(S.id);
    started.switchTo(VIEW_WORKSPACE);
    expect(started.map.activeLayer.value).toBe(V2.id);
    started.switchTo(SIM);
    expect(started.map.activeLayer.value).toBe(S.id);
  });

  it('a layer made active between the moment and the map view\'s listener (from a fresh snapshot) does not replace the remembered one', async () => {
    const started = await start();
    const { ctx, map, switchTo } = started;
    // layer-panel's subscription follows the workspace shown and fills a gap from each fresh snapshot.
    ctx.livePicture.subscribe({
      snapshot: (snapshot) => {
        const top = [...snapshot.layers].sort((a, b) => b.drawOrder - a.drawOrder)[0];
        if (!snapshot.layers.some((l) => l.id === map.activeLayer.value)) map.activeLayer.set(top?.id ?? null);
      },
      changes: () => undefined,
    }, { objects: false });
    map.activeLayer.set(V2.id);
    switchTo(SIM);
    expect(map.activeLayer.value).toBe(S2.id);
    map.activeLayer.set(S.id);
    switchTo(VIEW_WORKSPACE); // the fresh snapshot makes V active first
    expect(map.activeLayer.value).toBe(V2.id);
    switchTo(SIM); // the fresh snapshot makes S2 active first
    expect(map.activeLayer.value).toBe(S.id);
    switchTo(VIEW_WORKSPACE);
    expect(map.activeLayer.value).toBe(V2.id);
  });

  it('a newer switch before the map view\'s listener does not record the layer made active in between', async () => {
    const { ctx, map, switchTo, moment } = await start();
    map.activeLayer.set(V2.id);
    switchTo(SIM);
    map.activeLayer.set(S.id);
    switchTo(VIEW_WORKSPACE);
    moment(SIM);
    map.activeLayer.set(S2.id); // a gap filled between the moment and onChange
    moment(VIEW_WORKSPACE); // a newer switch: the shell runs only its steps 4 and 5
    ctx.switchWorkspace(VIEW_WORKSPACE);
    expect(map.activeLayer.value).toBe(V2.id);
    switchTo(SIM);
    expect(map.activeLayer.value).toBe(S.id);
  });

  it('forgets a remembered layer it sees deleted, here through a reference subscription', async () => {
    const { ctx, map, switchTo } = await start();
    map.activeLayer.set(V2.id);
    switchTo(SIM);
    map.activeLayer.set(S.id);
    map.setLayerVisible(V.id, true);
    ctx.live.snapshot(PICTURE);
    ctx.live.changes([event(5, null, { id: V2.id, type: 'layer' })]);
    switchTo(VIEW_WORKSPACE);
    expect(map.activeLayer.value).toBeNull(); // nothing remembered, and never Simulation's layer in View
  });

  it('a remembered layer the fresh snapshot lacks (deleted while another workspace was shown) is not made active (review F2)', async () => {
    const { ctx, map, switchTo } = await start();
    map.activeLayer.set(V2.id);
    switchTo(SIM);
    ctx.live.changes([event(5, null, { id: V2.id, type: 'layer' })]); // not seen: the subscription follows Simulation
    switchTo(VIEW_WORKSPACE);
    expect(map.activeLayer.value).toBeNull();
  });

  it('a remembered layer brought back before the workspace\'s snapshot is checked by the next one (review F2)', async () => {
    const run = async (holdsIt: boolean) => {
      const { map, controller, switchTo } = await start();
      map.activeLayer.set(V2.id);
      switchTo(SIM);
      controller.workspaceMoment(VIEW_WORKSPACE);
      controller.workspaceShown(VIEW_WORKSPACE); // the fresh snapshot is late (the shell waits at most 5 s)
      expect(map.activeLayer.value).toBe(V2.id);
      controller.listener.snapshot({ layers: holdsIt ? [V, V2] : [V], objects: [], sequenceNo: 50 });
      return map.activeLayer.value;
    };
    expect(await run(true)).toBe(V2.id);
    expect(await run(false)).toBeNull();
  });

  it('does not remember a View layer made active in Simulation, even when the snapshot is late', async () => {
    const { ctx, map, controller, switchTo } = await start();
    map.activeLayer.set(V2.id);
    switchTo(SIM);
    map.setLayerVisible(V.id, true);
    ctx.live.snapshot(PICTURE);
    map.activeLayer.set(V.id); // a reference layer, not Simulation's
    switchTo(VIEW_WORKSPACE);
    ctx.live.snapshot(PICTURE);
    expect(map.activeLayer.value).toBe(V2.id);
    controller.workspaceMoment(SIM);
    controller.workspaceShown(SIM); // before Simulation's snapshot
    expect(map.activeLayer.value).toBeNull();
  });

  it('remembers only a layer of the workspace left', async () => {
    const { map, switchTo } = await start();
    map.activeLayer.set(V2.id);
    switchTo(SIM);
    map.activeLayer.set(V.id); // not a Simulation layer: not remembered for Simulation
    switchTo(VIEW_WORKSPACE);
    expect(map.activeLayer.value).toBe(V2.id);
    switchTo(SIM);
    expect(map.activeLayer.value).toBeNull(); // nothing remembered for Simulation: none, not View's layer (review F1)
  });
});

describe('criterion 47 (brief function 23): View\'s layers as a reference', () => {
  /** In Simulation with V switched on as a reference, and the server's snapshot for that subscription. */
  async function withReference(): Promise<Started> {
    const started = await start();
    started.switchTo(SIM);
    started.map.setLayerVisible(V.id, true);
    started.ctx.live.snapshot(PICTURE);
    return started;
  }

  it('is off by default; while one is on, the subscription names both workspaces, and is not renewed for each eye', async () => {
    const { ctx, map, switchTo } = await start();
    expect(workspacesNamed(ctx)).toBeUndefined();
    switchTo(SIM);
    expect(workspacesNamed(ctx)).toBeUndefined();
    expect([map.isLayerVisible(V.id), map.isLayerVisible(V2.id)]).toEqual([false, false]);
    map.setLayerVisible(V.id, true);
    expect(workspacesNamed(ctx)).toEqual([SIM, VIEW_WORKSPACE]);
    const subscription = ctx.liveSubscriptions[0];
    map.setLayerVisible(V2.id, true);
    map.setLayerVisible(V.id, false);
    expect(ctx.liveSubscriptions[0]).toBe(subscription);
    map.setLayerVisible(V2.id, false);
    expect(workspacesNamed(ctx)).toBeUndefined();
  });

  it('is drawn under every layer of the workspace, in View\'s order among themselves', async () => {
    const { engine, map } = await withReference();
    map.setLayerVisible(V2.id, true);
    const [v2At, vAt, sAt, s2At] = [V2, V, S, S2].map((l) => stackOf(engine, l.id));
    expect(engine.layers.map((l) => l.id)).toEqual([V2.id, V.id, S.id, S2.id]);
    expect([v2At, vAt, sAt, s2At]).toEqual([0, 1, 2, 3]); // V's drawOrder 50 is above S's 0 and S2's 5 in View
    expect(engine.idsIn(V.id)).toEqual([v.id]);
  });

  it('its objects are not selected by a click, a Ctrl/Cmd+click or a box, pick leaves them out, and a right click on one opens the map actions', async () => {
    const { ctx, engine, map } = await withReference();
    const atV = engine.pixelOf([12, 58]);
    const atS = engine.pixelOf([16, 61]);
    engine.pointer('click', atV);
    expect(map.selection.value).toEqual([]);
    engine.pointer('click', atS);
    expect(map.selection.value).toEqual([s.id]);
    engine.pointer('click', atV, 'add');
    expect(map.selection.value).toEqual([s.id]);
    expect(map.pick(atV)).toEqual([]);
    expect(map.pick(atS)).toEqual([s.id]);
    engine.selectBox([0, 0], [800, 600]);
    expect([...map.selection.value].sort()).toEqual([s.id, s2.id]);
    engine.menu(atV);
    expect(ctx.openedMenus.at(-1)?.target).toHaveProperty('position');
    // Another plugin's selection of one is not highlighted.
    map.selection.set([v.id, s.id]);
    expect(engine.highlighted).toEqual([s.id]);
  });

  it('its eye in Simulation and in View are independent, layer-panel\'s eyes follow a switch, and the subscription names no workspace back in View', async () => {
    const { ctx, map, switchTo } = await start();
    map.setLayerVisible(V.id, false);
    const changes: [Uuid, boolean][] = [];
    map.onLayerVisibilityChange((id, visible) => changes.push([id, visible]));
    switchTo(SIM);
    expect(map.isLayerVisible(V.id)).toBe(false);
    map.setLayerVisible(V.id, true);
    ctx.live.snapshot(PICTURE);
    ctx.saveSetup(); // so the shell restores Simulation's share too when the user comes back
    changes.length = 0;
    switchTo(VIEW_WORKSPACE);
    expect(changes).toContainEqual([V.id, false]);
    expect(map.isLayerVisible(V.id)).toBe(false);
    expect(workspacesNamed(ctx)).toBeUndefined();
    ctx.live.snapshot(PICTURE); // the renewed subscription's snapshot
    expect(map.isLayerVisible(V2.id)).toBe(true);
    changes.length = 0;
    switchTo(SIM);
    expect(changes).toContainEqual([V.id, true]);
    expect(changes).toContainEqual([V2.id, false]);
    expect(map.isLayerVisible(V.id)).toBe(true);
    expect(workspacesNamed(ctx)).toEqual([SIM, VIEW_WORKSPACE]);
  });

  it('a share keeps the references switched on, and restores them in that workspace (T-085 A3)', async () => {
    const { ctx } = await withReference();
    const share = ctx.saveSetup() as { readonly layers: Record<string, boolean> };
    expect(share.layers).toEqual({ [V.id]: true });
    const reloaded = await start({ workspace: SIM, share });
    expect(reloaded.map.isLayerVisible(V.id)).toBe(true);
    expect(workspacesNamed(reloaded.ctx)).toEqual([SIM, VIEW_WORKSPACE]);
  });

  it('T-085 Q2: after the moment, a subscription that names workspaces is not drawn until it is renewed', async () => {
    const { ctx, engine, map, moment } = await withReference();
    expect(engine.idsIn(S.id)).toEqual([s.id]);
    moment(VIEW_WORKSPACE);
    expect(engine.layers).toEqual([]);
    ctx.live.changes([event(5, symbolObject(111, S.id, 16.5, 61.5))]); // still on its way to the old subscription
    expect(engine.layers).toEqual([]);
    engine.pointer('click', engine.pixelOf([16, 61]));
    expect(map.selection.value).toEqual([]);
    ctx.switchWorkspace(VIEW_WORKSPACE);
    expect(workspacesNamed(ctx)).toBeUndefined();
    ctx.live.snapshot(PICTURE);
    expect(engine.layers.map((l) => l.id)).toEqual([V2.id, V.id]);
    expect(engine.idsIn(V.id)).toEqual([v.id]);
  });
});

describe('criterion 48 (brief function 24): fade lists', () => {
  it('ids on a list are drawn faded at once, also an object that arrives later; clear draws them normally again', async () => {
    const { ctx, engine, map, clock } = await start();
    const list = map.createFadeList();
    list.set([v.id, uuid(150)]);
    expect(fadedIn(engine, V.id, v.id)).toBe(true);
    expect(fadedIn(engine, V2.id, v2.id)).toBe(false);
    ctx.live.changes([event(5, symbolObject(150, V.id, 11, 56))]);
    clock.advance(1000); // the update cadence: within 1 s
    expect(fadedIn(engine, V.id, uuid(150))).toBe(true);
    list.clear();
    expect([fadedIn(engine, V.id, v.id), fadedIn(engine, V.id, uuid(150))]).toEqual([false, false]);
  });

  it('the lists of two plugins fade their union, and a faded object can still be selected', async () => {
    const { engine, map } = await start();
    const a = map.createFadeList();
    const b = map.createFadeList();
    a.set([v.id]);
    b.set([v.id, v2.id]);
    a.clear();
    expect([fadedIn(engine, V.id, v.id), fadedIn(engine, V2.id, v2.id)]).toEqual([true, true]);
    b.set([v2.id]);
    expect([fadedIn(engine, V.id, v.id), fadedIn(engine, V2.id, v2.id)]).toEqual([false, true]);
    engine.pointer('click', engine.pixelOf([13, 57]));
    expect(map.selection.value).toEqual([v2.id]);
    expect(engine.highlight.map((item) => [item.id, item.faded])).toEqual([[v2.id, true]]);
  });

  it('takes at most 10 000 ids, with a warning, and ignores what is not an id list', async () => {
    const { ctx, engine, map } = await start();
    const list = map.createFadeList();
    list.set([v.id, ...Array.from({ length: 9_999 }, (_, i) => uuid(200_000 + i)), v2.id]);
    expect([fadedIn(engine, V.id, v.id), fadedIn(engine, V2.id, v2.id)]).toEqual([true, false]); // v2 is the 10 001st
    expect(ctx.logs.some((l) => l.level === 'warn' && l.message === 'fade list: only the first 10000 of 10001 ids are faded')).toBe(true);
    // What is not an id does not count: v2 after 10 000 numbers is faded.
    list.set([...Array.from({ length: 10_000 }, () => 42), v2.id] as unknown as Uuid[]);
    expect([fadedIn(engine, V.id, v.id), fadedIn(engine, V2.id, v2.id)]).toEqual([false, true]);
    list.set('nope' as unknown as Uuid[]);
    expect(fadedIn(engine, V2.id, v2.id)).toBe(false);
  });

  it('changes nothing once the map view is disposed', async () => {
    const { engine, map, controller } = await start();
    const list = map.createFadeList();
    controller.dispose();
    list.set([v.id]);
    expect(fadedIn(engine, V.id, v.id)).toBe(false);
  });

  it('a deleted object leaves every list', async () => {
    const { ctx, engine, map, clock } = await start();
    map.createFadeList().set([v.id]);
    map.createFadeList().set([v.id]);
    ctx.live.changes([event(5, null, { id: v.id, type: 'object' })]);
    ctx.live.changes([event(6, v)]);
    clock.advance(1000);
    expect(engine.idsIn(V.id)).toEqual([v.id]);
    expect(fadedIn(engine, V.id, v.id)).toBe(false);
  });
});

describe('criterion 50 (brief function 22): the switch\'s moment', () => {
  it.each(['before', 'after'])('ends the interaction and clears the lists and the selection before the fresh snapshots and onChange, so what is set again from them stays (draw-symbols\' listener %s the map view\'s)', async (order) => {
    let map: MapView | null = null;
    let placing: Promise<Position | null> | null = null;
    // draw-symbols starts placing again from its onChange listener (its function 19).
    const listen = (ctx: FakeContext) => ctx.workspace.onChange(() => {
      placing = (map as unknown as MapView).pickPoint();
    });
    const started = await start(order === 'before' ? { before: listen } : {});
    if (order === 'after') listen(started.ctx);
    map = started.map;
    const { ctx, engine, switchTo } = started;
    // The simulator sets its list again from each fresh snapshot: the objects of its layer S.
    const list = started.map.createFadeList();
    let atSnapshot: unknown = null;
    ctx.livePicture.subscribe({
      snapshot: (snapshot) => {
        atSnapshot = { interaction: engine.interaction, selection: started.map.selection.value };
        list.set(snapshot.objects.filter((o) => o.layerId === S.id).map((o) => o.id));
      },
      changes: () => undefined,
    });
    started.map.activeLayer.set(V2.id);
    started.map.selection.set([v.id]);
    const first = started.map.pickPoint();

    switchTo(SIM);
    expect(atSnapshot).toEqual({ interaction: 'none', selection: [] });
    await expect(first).resolves.toBeNull();
    expect(fadedIn(engine, S.id, s.id)).toBe(true);
    expect(engine.interaction).toBe('pick-point');
    started.map.activeLayer.set(S.id);

    const inSimulation = placing as Promise<Position | null> | null;
    switchTo(VIEW_WORKSPACE);
    await expect(inSimulation).resolves.toBeNull(); // ended by the moment, not later
    expect(engine.interaction).toBe('pick-point'); // placing started again in View stays
    expect(started.map.activeLayer.value).toBe(V2.id); // the map view's setting of the active layer

    switchTo(SIM);
    expect(engine.interaction).toBe('pick-point');
    expect(started.map.activeLayer.value).toBe(S.id);
    expect(fadedIn(engine, S.id, s.id)).toBe(true);
  });
});
