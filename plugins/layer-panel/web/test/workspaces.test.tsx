// Acceptance criteria 16 to 22 of the brief (M3): the panel in a workspace (ADR-0039; the workspace
// rules in docs/plugins/briefs/README.md). Each switch goes as the shell's does (SDK 1.2.0
// `CurrentWorkspace`): the fake map view's moment first, then the fake context's switch, which
// sends the fresh snapshots and then calls the `onChange` listeners.
// @vitest-environment jsdom
import { act, cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { VIEW_WORKSPACE } from '@emc2/plugin-sdk';
import type { Uuid, WorkspaceInfo } from '@emc2/plugin-sdk';
import { createFakeContext, createFakeUser, type FakeContext, type FakeMapView } from '@emc2/plugin-sdk/testing';
import { LayerPanelController } from '../src/controller.ts';
import { openBrowser, settle, type Browser, type BrowserOptions } from './browser.tsx';
import { FakeServer, LABEL, layer, layerIn } from './fakeServer.ts';

afterEach(cleanup);

const SIM: WorkspaceInfo = { id: 'simulator.simulation', name: 'Simulation', viewPermission: 'plugin.simulator.view', editPermission: 'plugin.simulator.edit', order: 10 };
const EDIT_SIM = 'plugin.simulator.edit';

function open(server: FakeServer, options: BrowserOptions = {}): Promise<Browser> {
  return openBrowser(server, { workspaces: [SIM], ...options });
}

/**
 * Switches the workspace shown as the shell does. A subscription that names its workspaces gets no
 * fresh snapshot, but a new one starts with its own: the fake has no way to send to one
 * subscription only, so the server sends its picture again to every subscription afterwards.
 */
function switchTo(one: Browser, server: FakeServer, id: string): void {
  act(() => {
    one.map.switchWorkspace();
    one.ctx.switchWorkspace(id);
    server.sendSnapshot(one.ctx);
  });
}

function nameButton(one: Browser, name: string): HTMLElement {
  return one.view.getByRole('button', { name: `Make ${name} active` });
}

/** Two View layers and two Simulation layers, all with their own draw orders. */
function picture(): FakeServer {
  return new FakeServer([layer('V1', 2), layer('V2', 1), layerIn(SIM.id, 'S1', 4), layerIn(SIM.id, 'S2', 3)]);
}

describe('AC16 (M3): the layers of the workspace shown', () => {
  it('lists View layers in View, Simulation layers and the reference group in Simulation, and View layers again back in View', async () => {
    const server = picture();
    const one = await open(server);
    expect(one.listed()).toEqual(['V1', 'V2']);
    expect(one.view.queryByRole('group', { name: 'View (reference)' })).toBeNull();

    switchTo(one, server, SIM.id);
    expect(one.listed()).toEqual(['S1', 'S2']);
    expect(one.referenced()).toEqual(['V1', 'V2']);

    switchTo(one, server, VIEW_WORKSPACE);
    expect(one.listed()).toEqual(['V1', 'V2']);
    expect(one.referenced()).toEqual([]);
  });

  it('holds the reference subscription, View only and without objects, only while a declared workspace is shown', async () => {
    const server = picture();
    const one = await open(server);
    // The main subscription names no workspace, so it follows the one shown (rule 2).
    expect(one.ctx.liveSubscriptions).toEqual([{ objects: false }]);
    switchTo(one, server, SIM.id);
    expect(one.ctx.liveSubscriptions).toEqual([{ objects: false }, { objects: false, workspaces: [VIEW_WORKSPACE] }]);
    switchTo(one, server, VIEW_WORKSPACE);
    expect(one.ctx.liveSubscriptions).toEqual([{ objects: false }]);
  });

  it('keeps the counts of both groups current, also after changes in a second browser', async () => {
    const server = picture();
    const one = await open(server, { workspace: SIM.id });
    const other = await open(server);
    const s1 = server.layerNamed('S1').id;
    const v2 = server.layerNamed('V2').id;
    act(() => {
      server.addObject(s1);
      server.addObject(v2);
      server.addObject(v2);
    });
    const meta = (row: HTMLElement) => row.querySelector('.layer-panel-meta')?.textContent;
    expect(meta(one.row('S1'))).toBe('UNCLASSIFIED · 1 object');
    const reference = within(one.view.getByRole('list', { name: 'View (reference)' }));
    expect(reference.getAllByRole('listitem').map(meta)).toEqual(['UNCLASSIFIED · 0 objects', 'UNCLASSIFIED · 2 objects']);
    expect(meta(other.row('V2'))).toBe('UNCLASSIFIED · 2 objects');

    act(() => {
      server.addLayerAs('cot', 'V0', 0);
    });
    expect(one.referenced()).toEqual(['V1', 'V2', 'V0']);
    expect(one.listed()).toEqual(['S1', 'S2']);
  });
});

describe('AC17 (M3): new layers belong to the workspace shown', () => {
  it('creates a layer in Simulation with its workspace, listed there only; in View with none', async () => {
    const server = picture();
    const one = await open(server, { workspace: SIM.id });
    fireEvent.click(one.view.getByRole('button', { name: 'New layer' }));
    fireEvent.click(one.view.getByRole('button', { name: 'Create' }));
    await settle();
    // FakeServer checks each request against the change request schema.
    const created = server.requests[0];
    expect(created?.operation).toBe('create');
    expect(created && 'data' in created ? created.data : undefined).toMatchObject({ workspace: SIM.id, name: 'Layer 1', drawOrder: 5, visible: true, label: LABEL });
    expect(one.listed()).toEqual(['Layer 1', 'S1', 'S2']);

    switchTo(one, server, VIEW_WORKSPACE);
    expect(one.listed()).toEqual(['V1', 'V2']);
    fireEvent.click(one.view.getByRole('button', { name: 'New layer' }));
    fireEvent.click(one.view.getByRole('button', { name: 'Create' }));
    await settle();
    const inView = server.requests[1];
    expect(inView && 'data' in inView ? Object.keys(inView.data) : []).not.toContain('workspace');
    expect(one.listed()).toEqual(['Layer 1', 'V1', 'V2']);
  });

  it('counts "Layer N" among the workspace\'s own layers', async () => {
    const server = new FakeServer([layer('Layer 7', 1), layerIn(SIM.id, 'Layer 2', 1)]);
    const one = await open(server, { workspace: SIM.id });
    fireEvent.click(one.view.getByRole('button', { name: 'New layer' }));
    fireEvent.click(one.view.getByRole('button', { name: 'Create' }));
    await settle();
    expect(one.listed()).toEqual(['Layer 3', 'Layer 2']);
  });

  it('shows "Create first layer" in a Simulation without layers, with the reference group under it', async () => {
    const server = new FakeServer([layer('V1', 1)]);
    const one = await open(server, { workspace: SIM.id });
    expect(one.view.getByText('There are no layers.')).toBeTruthy();
    expect(one.referenced()).toEqual(['V1']);
    fireEvent.click(one.view.getByRole('button', { name: 'Create first layer' }));
    fireEvent.click(one.view.getByRole('button', { name: 'Create' }));
    await settle();
    expect(one.listed()).toEqual(['Layer 1']);
    expect(server.layerNamed('Layer 1').workspace).toBe(SIM.id);
  });
});

describe('AC18 (M3): who may change layers, per workspace', () => {
  const readOnly = (one: Browser) => one.view.getByRole<HTMLButtonElement>('button', { name: /^(New layer|Create first layer)$/ }).disabled;

  it('with the Simulation permission only: changes in Simulation, not in View', async () => {
    const server = picture();
    const one = await open(server, { user: createFakeUser({ permissions: [EDIT_SIM] }) });
    expect(readOnly(one)).toBe(true);
    expect(one.view.getByRole('status').textContent).toBe('You may not change layers.');
    expect(one.view.getByRole('button', { name: 'Rename V1' }).title).toBe('You may not change layers');

    switchTo(one, server, SIM.id);
    expect(readOnly(one)).toBe(false);
    expect(one.view.queryByRole('status')).toBeNull();
    fireEvent.click(one.view.getByRole('button', { name: 'Move S2 up' }));
    await settle();
    expect(one.listed()).toEqual(['S2', 'S1']);
  });

  it('with layers.edit only: changes in View, not in Simulation, and the hint names Simulation', async () => {
    const server = picture();
    const one = await open(server, { user: createFakeUser({ permissions: ['layers.edit'] }) });
    expect(readOnly(one)).toBe(false);

    switchTo(one, server, SIM.id);
    expect(readOnly(one)).toBe(true);
    expect(one.view.getByRole('status').textContent).toBe('You may not change layers in Simulation.');
    for (const name of ['Move S2 up', 'Rename S1', 'Delete S1']) {
      const button = one.view.getByRole<HTMLButtonElement>('button', { name });
      expect([button.disabled, button.title]).toEqual([true, 'You may not change layers in Simulation']);
    }
    expect(nameButton(one, 'S1').title).toBe('Click to make active');
    // The eye and the active layer stay allowed (function 10).
    fireEvent.click(one.view.getByRole('button', { name: 'Hide S2' }));
    fireEvent.click(nameButton(one, 'S2'));
    expect([one.map.isLayerVisible(server.layerNamed('S2').id), one.map.activeLayer.value]).toEqual([false, server.layerNamed('S2').id]);
    expect(server.requests).toEqual([]);
  });

  it('shows a PERMISSION_DENIED in Simulation as a notification naming it', async () => {
    const server = picture();
    const one = await open(server, { workspace: SIM.id });
    server.rejectWith = 'PERMISSION_DENIED';
    fireEvent.click(one.view.getByRole('button', { name: 'New layer' }));
    fireEvent.click(one.view.getByRole('button', { name: 'Create' }));
    await settle();
    expect(one.ctx.notifications).toEqual([
      { severity: 'error', message: 'Could not create layer "Layer 1": You may not change layers in Simulation (the server refused: rejected by the test)' },
    ]);
  });
});

describe('AC19 (M3): reorder and rename in Simulation', () => {
  it('sends one update between the Simulation neighbours, with the layer\'s workspace, and changes no View layer', async () => {
    // View's V (3) lies between S1 and S2 in draw order; it is no neighbour in Simulation.
    const server = new FakeServer([layer('V', 3), layerIn(SIM.id, 'S1', 4), layerIn(SIM.id, 'S2', 2), layerIn(SIM.id, 'S3', 1)]);
    const one = await open(server, { workspace: SIM.id });
    fireEvent.click(one.view.getByRole('button', { name: 'Move S3 up' }));
    await settle();
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({ operation: 'update', entityId: server.layerNamed('S3').id, data: { workspace: SIM.id, drawOrder: 3 } });
    expect(one.listed()).toEqual(['S1', 'S3', 'S2']);
    expect(server.layerNamed('V').version).toBe(1);

    fireEvent.keyDown(nameButton(one, 'S1'), { key: 'F2' });
    const field = one.view.getByRole('textbox', { name: 'New name for S1' });
    fireEvent.change(field, { target: { value: 'Red' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await settle();
    expect(server.requests[1]).toMatchObject({ operation: 'update', data: { workspace: SIM.id, name: 'Red' } });
    expect(server.layerNamed('Red').workspace).toBe(SIM.id);
  });

  it('sends no workspace for a View layer', async () => {
    const server = picture();
    const one = await open(server);
    fireEvent.click(one.view.getByRole('button', { name: 'Move V2 up' }));
    await settle();
    const update = server.requests[0];
    expect(update && 'data' in update ? Object.keys(update.data) : []).not.toContain('workspace');
  });

  it('renumbers only the Simulation layers when their neighbours are too close to split', async () => {
    const server = new FakeServer([layer('V', 5), layerIn(SIM.id, 'S1', 1), layerIn(SIM.id, 'S2', 1), layerIn(SIM.id, 'S3', 0)]);
    const one = await open(server, { workspace: SIM.id });
    const [, second, third] = one.listed();
    if (second === undefined || third === undefined) throw new Error('three layers expected');
    fireEvent.click(one.view.getByRole('button', { name: `Move ${third} up` }));
    await settle();
    expect(server.requests.map((r) => r.entityId)).not.toContain(server.layerNamed('V').id);
    expect(server.requests.every((r) => 'data' in r && (r.data as { workspace?: string }).workspace === SIM.id)).toBe(true);
    expect(one.listed()[2]).toBe(second);
  });
});

describe('AC20 (M3): View\'s layers as a reference', () => {
  /** Stands for map-view-2d: View's layers start hidden in Simulation (its function 23). */
  function referenceOff(server: FakeServer): NonNullable<BrowserOptions['beforeActivate']> {
    return (_ctx, map) => {
      for (const name of ['V1', 'V2']) map.setLayerVisible(server.layerNamed(name).id, false);
    };
  }

  it('lists View\'s layers in a group with a heading, eyes as the map view has them, and nothing else', async () => {
    const server = picture();
    const one = await open(server, { workspace: SIM.id, objectList: true, beforeActivate: referenceOff(server) });
    const group = one.view.getByRole('group', { name: 'View (reference)' });
    expect(within(group).getByRole('heading', { name: 'View (reference)' })).toBeTruthy();
    const rows = within(group).getAllByRole('listitem');
    expect(one.referenced()).toEqual(['V1', 'V2']);
    // Only the eye, off; no active marker, no name button, no rename, move or delete.
    expect(rows.map((r) => within(r).getAllByRole('button').map((b) => b.getAttribute('aria-label')))).toEqual([['Show V1'], ['Show V2']]);
    expect(rows.map((r) => r.getAttribute('aria-current'))).toEqual([null, null]);
    expect(rows.every((r) => r.getAttribute('draggable') !== 'true')).toBe(true);

    const active = one.map.activeLayer.value;
    const name = rows[0]?.querySelector('.layer-panel-name');
    if (!(name instanceof HTMLElement) || rows[0] === undefined) throw new Error('no name');
    fireEvent.click(rows[0]);
    fireEvent.click(name);
    fireEvent.doubleClick(rows[0]);
    fireEvent.doubleClick(name);
    fireEvent.keyDown(name, { key: 'Enter' });
    fireEvent.keyUp(name, { key: ' ' });
    fireEvent.keyDown(name, { key: 'F2' });
    expect([one.map.activeLayer.value, one.opened, server.requests, one.view.queryByRole('textbox')]).toEqual([active, [], [], null]);
    expect(active).toBe(server.layerNamed('S1').id);
  });

  // That View's own eye for the layer stays as it was is map-view-2d's (its function 23): the fake
  // map view keeps one visibility per layer, so that part is checked in the browser.
  it('switches a reference layer on with its eye, and the eyes follow the map view\'s visibility events after a switch', async () => {
    const server = picture();
    const one = await open(server, { workspace: SIM.id, beforeActivate: referenceOff(server) });
    const v1 = server.layerNamed('V1').id;
    fireEvent.click(one.view.getByRole('button', { name: 'Show V1' }));
    expect(one.map.isLayerVisible(v1)).toBe(true);
    expect(one.view.getByRole('button', { name: 'Hide V1' }).getAttribute('aria-pressed')).toBe('false');
    expect(server.requests).toEqual([]);

    // In View the map view applies View's own visibility and reports each change (map-view-2d function 23).
    switchTo(one, server, VIEW_WORKSPACE);
    act(() => {
      one.map.setLayerVisible(v1, false);
    });
    expect(one.view.getByRole('button', { name: 'Show V1' })).toBeTruthy();
  });

  it('says "No layers in View" when View has none', async () => {
    const server = new FakeServer([layerIn(SIM.id, 'S1', 1)]);
    const one = await open(server, { workspace: SIM.id });
    const group = one.view.getByRole('group', { name: 'View (reference)' });
    expect(within(group).getByText('No layers in View')).toBeTruthy();
    expect(within(group).queryByRole('list')).toBeNull();
  });

  it('does not let a reference layer be made active or opened, even when asked directly', async () => {
    const server = picture();
    const one = await open(server, { workspace: SIM.id, objectList: true });
    expect(one.view.getByRole('button', { name: 'Make S1 active' })).toBeTruthy();
    expect(one.view.queryByRole('button', { name: 'Make V1 active' })).toBeNull();
    expect(one.map.activeLayer.value).toBe(server.layerNamed('S1').id);
  });
});

describe('AC21 (M3): the active layer is the workspace\'s own', () => {
  it('is one of the workspace\'s layers after each switch, never a View layer in Simulation, and none without layers', async () => {
    const server = picture();
    const one = await open(server);
    expect(one.map.activeLayer.value).toBe(server.layerNamed('V1').id);
    switchTo(one, server, SIM.id);
    expect(one.map.activeLayer.value).toBe(server.layerNamed('S1').id);

    act(() => {
      one.map.activeLayer.set(server.layerNamed('V2').id);
    });
    expect(one.map.activeLayer.value).toBe(server.layerNamed('S1').id);

    const empty = new FakeServer([layer('V1', 1)]);
    const two = await open(empty);
    switchTo(two, empty, SIM.id);
    expect(two.map.activeLayer.value).toBeNull();
  });
});

describe('AC22 (M3): a gap is filled, at any time', () => {
  /** Four Simulation layers, top first, so that the top layer and the one above the bottom differ. */
  function simulation(): FakeServer {
    return new FakeServer([layer('V1', 1), layerIn(SIM.id, 'S1', 4), layerIn(SIM.id, 'S2', 3), layerIn(SIM.id, 'S3', 2), layerIn(SIM.id, 'S4', 1)]);
  }
  const id = (server: FakeServer, name: string): Uuid => server.layerNamed(name).id;

  it('when the active layer changes: none, a View layer, or an unknown id becomes the top layer at once', async () => {
    const server = simulation();
    const one = await open(server, { workspace: SIM.id });
    for (const value of [null, id(server, 'V1'), '01890a5d-ac96-774b-bcce-b302099a8057']) {
      act(() => {
        one.map.activeLayer.set(id(server, 'S3'));
      });
      act(() => {
        one.map.activeLayer.set(value);
      });
      expect(one.map.activeLayer.value).toBe(id(server, 'S1'));
    }
  });

  it('when the list changes: a delete makes the layer below active, or the top one from the bottom', async () => {
    const server = simulation();
    const one = await open(server, { workspace: SIM.id });
    const other = await open(server, { workspace: SIM.id });
    act(() => {
      one.map.activeLayer.set(id(server, 'S2'));
    });
    fireEvent.click(other.view.getByRole('button', { name: 'Delete S2' }));
    fireEvent.click(within(other.view.getByRole('alertdialog', { name: 'Delete layer' })).getByRole('button', { name: 'Delete' }));
    await settle();
    expect(one.map.activeLayer.value).toBe(id(server, 'S3'));

    act(() => {
      one.map.activeLayer.set(id(server, 'S4'));
    });
    fireEvent.click(other.view.getByRole('button', { name: 'Delete S4' }));
    fireEvent.click(within(other.view.getByRole('alertdialog', { name: 'Delete layer' })).getByRole('button', { name: 'Delete' }));
    await settle();
    // The top layer, not S3 above it (function 21).
    expect(one.map.activeLayer.value).toBe(id(server, 'S1'));
  });

  it('when the list changes: a fresh snapshot without the active layer makes the top layer active', async () => {
    const server = simulation();
    const one = await open(server, { workspace: SIM.id });
    act(() => {
      one.map.activeLayer.set(id(server, 'S2'));
    });
    const kept = ['S1', 'S3', 'S4'].map((n) => server.layerNamed(n));
    act(() => {
      one.ctx.live.snapshot({ layers: kept, objects: [] });
    });
    expect(one.map.activeLayer.value).toBe(id(server, 'S1'));
  });

  /**
   * Stands for map-view-2d (its function 22): at its moment it remembers the old workspace's
   * active layer; from its `onChange` listener it brings back the one last active in the new
   * workspace, or none on a first visit.
   */
  function rememberingMapView(ctx: FakeContext, map: FakeMapView) {
    const remembered = new Map<string, Uuid | null>();
    const workspace = ctx.workspace;
    let shown = workspace.current.id;
    return {
      moment() {
        remembered.set(shown, map.activeLayer.value);
        map.switchWorkspace();
      },
      register() {
        workspace.onChange((w) => {
          shown = w.id;
          map.activeLayer.set(remembered.get(w.id) ?? null);
        });
      },
    };
  }

  for (const order of ['first', 'last'] as const) {
    it(`on a switch, with the map view's listener ${order}: the remembered layer stands, the top layer fills a first visit`, async () => {
      const server = simulation();
      let mapView: ReturnType<typeof rememberingMapView> | null = null;
      const one = await open(server, {
        beforeActivate: (ctx, map) => {
          mapView = rememberingMapView(ctx, map);
          if (order === 'first') mapView.register();
        },
      });
      const remembering = mapView as ReturnType<typeof rememberingMapView> | null;
      if (remembering === null) throw new Error('no map view');
      if (order === 'last') remembering.register();
      const go = (to: string) => {
        act(() => {
          remembering.moment();
          one.ctx.switchWorkspace(to);
        });
        // The reference subscription's own first snapshot (see switchTo).
        act(() => {
          server.sendSnapshot(one.ctx);
        });
      };

      expect(one.map.activeLayer.value).toBe(id(server, 'V1'));
      go(SIM.id);
      expect(one.map.activeLayer.value).toBe(id(server, 'S1'));
      fireEvent.click(nameButton(one, 'S3'));
      expect(one.map.activeLayer.value).toBe(id(server, 'S3'));

      go(VIEW_WORKSPACE);
      expect(one.map.activeLayer.value).toBe(id(server, 'V1'));
      go(SIM.id);
      expect(one.map.activeLayer.value).toBe(id(server, 'S3'));
    });
  }
});

describe('a new layer becomes active once it is listed (brief, function 21; owner, 2026-10-27)', () => {
  it('waits for the live event, and the user\'s own choice meanwhile wins', async () => {
    const server = picture();
    const one = await open(server, { workspace: SIM.id });
    server.holdEvents();
    fireEvent.click(one.view.getByRole('button', { name: 'New layer' }));
    fireEvent.click(one.view.getByRole('button', { name: 'Create' }));
    await settle();
    expect(one.map.activeLayer.value).toBe(server.layerNamed('S1').id);
    act(() => {
      server.deliver();
    });
    expect(one.map.activeLayer.value).toBe(server.layerNamed('Layer 1').id);

    server.holdEvents();
    fireEvent.click(one.view.getByRole('button', { name: 'New layer' }));
    fireEvent.click(one.view.getByRole('button', { name: 'Create' }));
    await settle();
    fireEvent.click(nameButton(one, 'S2'));
    act(() => {
      server.deliver();
    });
    expect(one.listed()).toEqual(['Layer 2', 'Layer 1', 'S1', 'S2']);
    expect(one.map.activeLayer.value).toBe(server.layerNamed('S2').id);
  });

  it('lets a choice made before the answer arrives win too', async () => {
    const server = picture();
    const one = await open(server, { workspace: SIM.id });
    server.holdEvents();
    // The answer comes a promise tick after the click; the user is quicker.
    fireEvent.click(one.view.getByRole('button', { name: 'New layer' }));
    fireEvent.click(one.view.getByRole('button', { name: 'Create' }));
    fireEvent.click(nameButton(one, 'S2'));
    await settle();
    act(() => {
      server.deliver();
    });
    expect(one.listed()).toEqual(['Layer 1', 'S1', 'S2']);
    expect(one.map.activeLayer.value).toBe(server.layerNamed('S2').id);
  });
});

describe('the reference group with a snapshot delivered during subscribe', () => {
  it('shows View\'s layers at once', () => {
    const server = picture();
    const plain = createFakeContext({ pluginId: 'layer-panel', defaultLabel: LABEL, workspaces: [SIM], workspace: SIM.id });
    // A live picture that answers a new subscription at once, before subscribe() returns.
    const livePicture: typeof plain.livePicture = {
      ...plain.livePicture,
      subscribe(listener, options) {
        const end = plain.livePicture.subscribe(listener, options);
        if (options?.workspaces !== undefined) listener.snapshot({ layers: [...server.layers.values()].filter((l) => l.workspace === undefined), objects: [], sequenceNo: 0 });
        return end;
      },
    };
    const ctx = new Proxy(plain, { get: (target, key): unknown => (key === 'livePicture' ? livePicture : Reflect.get(target, key, target)) });
    const controller = new LayerPanelController(ctx);
    expect(controller.getState().reference?.layers.map((l) => l.name)).toEqual(['V1', 'V2']);
  });
});
