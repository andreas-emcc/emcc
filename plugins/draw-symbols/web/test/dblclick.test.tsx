// T-032: one symbol per double-click while placing, and the small open items of the reviews: the
// deletion notice from our own tracker, promises that must not vanish, a second coordinate double.
import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { changeRequests, COORDINATES, MAP_VIEW, SYMBOLS } from '@emc2/plugin-sdk';
import type { MapObject } from '@emc2/plugin-sdk';
import { createFakeContext, createFakeCoordinateService, createFakeMapView, createFakeSymbolService } from '@emc2/plugin-sdk/testing';
import manifest from '../../plugin.json' with { type: 'json' };
import { DOUBLE_CLICK_MS, DrawController } from '../src/controller.ts';
import { PropertiesPanel } from '../src/PropertiesPanel.tsx';
import { ObjectTracker } from '../src/tracker.ts';
import { FakeServer, layer, symbolObject } from './fakeServer.ts';
import { advanceGrace, DEFAULT_LABEL, isolateDocumentListeners, openBrowser, settingDefaults, settle, showPanels, STOCKHOLM } from './harness.tsx';
import { clickMap, commit, dataOf, input, placeAt, select, twoBrowsers } from './scene.tsx';

isolateDocumentListeners();

async function placing() {
  const scene = await twoBrowsers();
  act(() => {
    scene.one.map.activeLayer.set(scene.lay.id);
  });
  return scene;
}

describe('AC10 (T-032): one symbol per double-click while placing', () => {
  it('two clicks 100 ms apart create one symbol, at the first click\'s point', async () => {
    const { server, one, p1 } = await placing();
    await placeAt(one, p1, STOCKHOLM);
    await clickMap(one, [-130.25, -12.5], 100); // the second click of the double-click
    expect(server.requests).toHaveLength(1);
    expect(dataOf(server.requests[0]).geometry).toEqual({ type: 'Point', coordinates: [18.0686, 59.3293] });
    expect(server.objects.size).toBe(1);
    expect(one.ctx.notifications).toEqual([]);
  });

  it('does not depend on how fast the computer is: real time between the clicks changes nothing', async () => {
    const { server, one, p1 } = await placing();
    await placeAt(one, p1, STOCKHOLM);
    // A busy machine: more real time than the double-click time passes. The tests' timers are faked (harness.tsx), so wait on the wall clock.
    const until = Date.now() + DOUBLE_CLICK_MS + 100;
    while (Date.now() < until) { /* busy */ }
    await clickMap(one, [-130.25, -12.5], 100);
    expect(server.requests).toHaveLength(1);
  });

  it('two clicks 300 ms apart (just outside the double-click time) create two symbols', async () => {
    const { server, one, p1 } = await placing();
    await placeAt(one, p1, STOCKHOLM);
    await clickMap(one, [-130.25, -12.5], 300);
    expect(server.requests).toHaveLength(2);
  });

  it('two clicks 600 ms apart create two symbols', async () => {
    const { server, one, p1 } = await placing();
    await placeAt(one, p1, STOCKHOLM);
    await clickMap(one, [-130.25, -12.5], 600);
    expect(server.requests).toHaveLength(2);
    expect(server.requests.map((r) => dataOf(r).geometry)).toEqual([
      { type: 'Point', coordinates: [18.0686, 59.3293] },
      { type: 'Point', coordinates: [-130.25, -12.5] },
    ]);
  });

  it('measures the time from the symbol that was placed, not from the click that was dropped', async () => {
    const { server, one, p1 } = await placing();
    await placeAt(one, p1, STOCKHOLM);
    await clickMap(one, [1, 2], 100); // dropped
    expect(server.requests).toHaveLength(1);
    await clickMap(one, [3, 4], 200); // 300 ms after the placement, but only 200 after the dropped click
    expect(server.requests).toHaveLength(2);
    expect(dataOf(server.requests[1]).geometry).toEqual({ type: 'Point', coordinates: [3, 4] });
  });

  it('keeps placing after a double-click: a later click places again', async () => {
    const { server, one, p1 } = await placing();
    await placeAt(one, p1, STOCKHOLM);
    await clickMap(one, [-130.25, -12.5], 100);
    await clickMap(one, [-130.25, -12.5], 2000);
    expect(server.requests).toHaveLength(2);
    expect(p1.symbols.getByRole('button', { name: 'Stop placing' })).toBeDefined();
  });

  it('a new placing session starts fresh: its first click places even right after the last one', async () => {
    const { server, one, p1 } = await placing();
    await placeAt(one, p1, STOCKHOLM);
    fireEvent.click(p1.symbols.getByRole('button', { name: 'Stop placing' }));
    fireEvent.click(p1.symbols.getByRole('button', { name: 'Place on map' }));
    await settle();
    await clickMap(one, [-130.25, -12.5], 50);
    expect(server.requests).toHaveLength(2);
  });

  it('the first click of a placing session always places, however soon after the session began', async () => {
    const { server, one, p1 } = await placing();
    fireEvent.click(p1.symbols.getByRole('button', { name: 'Infantry' }));
    fireEvent.click(p1.symbols.getByRole('button', { name: 'Place on map' }));
    await settle();
    await clickMap(one, STOCKHOLM, 10);
    expect(server.requests).toHaveLength(1);
  });
});

describe('the deletion notice follows our own tracker, not the shared selection', () => {
  const ELSEWHERE = { plugin: 'core-shell', user: 'another-user' };

  it('is shown when the map view clears the selection in the same step in which the deletion reaches this plugin', async () => {
    const { server, one } = await twoBrowsers((layerId) => [symbolObject(layerId)]);
    const seeded = [...server.objects.values()][0] as MapObject;
    await select(one, seeded.id);
    await settle();
    expect(one.ctx.notifications).toEqual([]);
    act(() => {
      one.map.selection.set([]); // the map view removed the deleted object from the selection ...
      server.changeElsewhere(changeRequests.deleteObject(seeded), ELSEWHERE); // ... just before we heard of it
    });
    expect(one.ctx.notifications).toEqual([{ severity: 'info', message: 'The selected symbol was deleted by someone else.' }]);
  });

  it('is shown when this plugin hears of the deletion first, and once only; a snapshot that merely lacks the object says nothing', async () => {
    const { server, one } = await twoBrowsers((layerId) => [symbolObject(layerId)]);
    const seeded = [...server.objects.values()][0] as MapObject;
    await select(one, seeded.id);
    await settle();
    act(() => {
      server.changeElsewhere(changeRequests.deleteObject(seeded), ELSEWHERE);
      one.map.selection.set([]);
      server.sendSnapshot(one.ctx);
      server.sendSnapshot(one.ctx);
    });
    expect(one.ctx.notifications).toHaveLength(1);
  });

  it('is not shown for a symbol the user had deselected', async () => {
    const { server, one } = await twoBrowsers((layerId) => [symbolObject(layerId), symbolObject(layerId)]);
    const [first, second] = [...server.objects.values()] as [MapObject, MapObject];
    await select(one, first.id);
    await select(one, null); // a click on empty map, or Escape, in the map view
    await advanceGrace(); // the record of it is forgotten after the grace period
    await select(one, second.id);
    act(() => {
      one.map.selection.set([first.id, second.id]); // several selected: nothing is watched
    });
    await advanceGrace();
    act(() => {
      server.changeElsewhere(changeRequests.deleteObject(first), ELSEWHERE);
      server.changeElsewhere(changeRequests.deleteObject(second), ELSEWHERE);
    });
    expect(one.ctx.notifications).toEqual([]);
  });

  it('is not shown for a selected object that is not a symbol (a shape has its own plugin)', async () => {
    const { server, one } = await twoBrowsers((layerId) => [symbolObject(layerId, { type: 'core.shape' })]);
    const shape = [...server.objects.values()][0] as MapObject;
    await select(one, shape.id);
    await settle();
    act(() => {
      server.changeElsewhere(changeRequests.deleteObject(shape), ELSEWHERE);
    });
    expect(one.ctx.notifications).toEqual([]);
  });

  it('is not shown for a deletion this user made (the shared Delete of the shell)', async () => {
    const { server, one } = await twoBrowsers((layerId) => [symbolObject(layerId)]);
    const seeded = [...server.objects.values()][0] as MapObject;
    await select(one, seeded.id);
    await settle();
    act(() => {
      server.changeElsewhere(changeRequests.deleteObject(seeded), { plugin: 'core-shell', user: one.ctx.user.id });
    });
    expect(one.ctx.notifications).toEqual([]);
  });

  it('a symbol that is still selected when it is deleted elsewhere is deselected, with one notice', async () => {
    const { server, one, two, p2 } = await twoBrowsers((layerId) => [symbolObject(layerId)]);
    const seeded = [...server.objects.values()][0] as MapObject;
    await select(two, seeded.id);
    act(() => {
      server.changeElsewhere(changeRequests.deleteObject(seeded), ELSEWHERE);
    });
    expect(two.map.selection.value).toEqual([]);
    expect(p2.properties.getByText('Select a symbol on the map.')).toBeDefined();
    expect(two.ctx.notifications).toHaveLength(1);
    expect(one.ctx.notifications).toEqual([]);
  });
});

describe('promises that nobody awaits are never lost', () => {
  function bareController() {
    const lay = layer('Default', 0);
    const other = layer('Other', 1);
    const object = symbolObject(lay.id);
    const ctx = createFakeContext({ pluginId: manifest.id, settings: settingDefaults(), defaultLabel: DEFAULT_LABEL });
    const map = createFakeMapView();
    const tracker = new ObjectTracker();
    tracker.snapshot({ layers: [lay, other], objects: [object], sequenceNo: 0 });
    map.selection.set([object.id]);
    const controller = new DrawController(ctx, tracker, map);
    const symbols = createFakeSymbolService();
    ctx.provideAs(MAP_VIEW, map);
    ctx.provideAs(SYMBOLS, symbols);
    const coordinates = createFakeCoordinateService();
    ctx.provideAs(COORDINATES, coordinates);
    const view = render(<PropertiesPanel controller={controller} symbols={symbols} coordinates={coordinates} />);
    return { ctx, controller, view, other };
  }

  it('identity, echelon, entity and layer: a failing update becomes a notification', async () => {
    const { ctx, controller, view } = bareController();
    controller.update = () => Promise.reject(new Error('boom'));
    fireEvent.change(view.getByLabelText('Echelon'), { target: { value: '16' } });
    fireEvent.change(view.getByLabelText('Identity'), { target: { value: '6' } });
    fireEvent.change(view.getByLabelText('Entity'), { target: { value: '10:120500' } });
    await settle();
    expect(ctx.notifications.map((n) => n.message)).toEqual(['Unexpected error: boom', 'Unexpected error: boom', 'Unexpected error: boom']);
  });

  it('the layer select too', async () => {
    const { ctx, controller, view, other } = bareController();
    controller.update = () => Promise.reject(new Error('boom'));
    fireEvent.change(view.getByLabelText('Layer'), { target: { value: other.id } });
    await settle();
    expect(ctx.notifications).toEqual([{ severity: 'error', message: 'Unexpected error: boom' }]);
  });

  it('guard turns a rejection into a notification and lets a success pass', async () => {
    const { ctx, controller } = bareController();
    controller.guard(Promise.resolve(1));
    controller.guard(Promise.reject(new Error('late')));
    await settle();
    expect(ctx.notifications).toEqual([{ severity: 'error', message: 'Unexpected error: late' }]);
  });

  it('the clock can be injected: the double-click time is measured with it', async () => {
    const lay = layer('Default', 0);
    const ctx = createFakeContext({ pluginId: manifest.id, settings: settingDefaults(), defaultLabel: DEFAULT_LABEL });
    const map = createFakeMapView();
    const tracker = new ObjectTracker();
    tracker.snapshot({ layers: [lay], objects: [], sequenceNo: 0 });
    map.activeLayer.set(lay.id);
    let time = 0;
    const controller = new DrawController(ctx, tracker, map, () => time);
    controller.setPickerSymbol({ standard: 'APP-6D', sidc: '10031000001211000000' });
    controller.setPlacing(true);
    for (const [at, position] of [[0, [1, 2]], [249, [3, 4]], [250, [5, 6]]] as const) {
      time = at;
      await act(async () => {
        map.completeInteraction(position);
        await Promise.resolve();
      });
      await settle();
    }
    expect(DOUBLE_CLICK_MS).toBe(250); // OpenLayers' double-click time, as the brief says
    expect(ctx.submitted.map((r) => dataOf(r).geometry)).toEqual([
      { type: 'Point', coordinates: [1, 2] },
      { type: 'Point', coordinates: [5, 6] },
    ]);
  });
});

describe('AC4 with the test kit\'s own coordinate service', () => {
  it.each([
    { text: '59.3293 N 18.0686 E', position: [18.0686, 59.3293] },
    { text: '12.5 S 130.25 W', position: [-130.25, -12.5] },
  ])('typing $text moves the symbol to the position the service parses (lon, lat)', async ({ text, position }) => {
    const lay = layer('Default', 0);
    const server = new FakeServer([lay]);
    const seeded = server.seed(symbolObject(lay.id));
    const one = await openBrowser(server, { coordinates: createFakeCoordinateService() });
    const panels = showPanels(one);
    await select(one, seeded.id);

    await commit(input(panels, 'Position (DMS)'), text); // the fake's chosen format is DMS
    expect(dataOf(server.requests[0]).geometry).toEqual({ type: 'Point', coordinates: position });
    expect(input(panels, 'Position (DMS)').value).toBe(text);
    expect(one.ctx.notifications).toEqual([]);

    await commit(input(panels, 'Position (DMS)'), 'somewhere');
    expect(panels.properties.getByRole('alert').textContent).toBe('expected e.g. "60.5 N 15.25 E"');
    expect(server.requests).toHaveLength(1);
  });
});
