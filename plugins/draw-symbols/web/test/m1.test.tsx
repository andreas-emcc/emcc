// The M1 functions (SDK v1, data model 1.0.0), criteria 11 to 14 of docs/plugins/briefs/draw-symbols.md:
// data type and data source, read only without objects.edit, the live picture by area.
import { act, fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { changeRequests } from '@emc2/plugin-sdk';
import type { DataType, MapObject, User } from '@emc2/plugin-sdk';
import {
  createFakeContext, createFakeCoordinateService, createFakeMapView, createFakeSymbolService, createFakeUser, GENERAL_DATA_TYPE_INFO,
} from '@emc2/plugin-sdk/testing';
import { coreOf } from '../src/content.ts';
import { DrawController } from '../src/controller.ts';
import { PropertiesPanel } from '../src/PropertiesPanel.tsx';
import { SymbolsPanel } from '../src/SymbolsPanel.tsx';
import { ObjectTracker } from '../src/tracker.ts';
import manifest from '../../plugin.json' with { type: 'json' };
import { DATA_TYPE_KEY } from '../src/keptChoice.ts';
import { FakeServer, layer, modelExample, symbolObject } from './fakeServer.ts';
import { advanceGrace, isolateDocumentListeners, openBrowser, settingDefaults, settle, showPanels, STOCKHOLM } from './harness.tsx';
import type { Browser, Panels } from './harness.tsx';
import { clickMap, commit, dataOf, input, placeAt, select } from './scene.tsx';

isolateDocumentListeners();

const COT: Omit<DataType, 'behaviour'> = { id: 'cot-in.cot', name: 'CoT track', declaredBy: 'cot-in', defaults: {} };

interface Scene {
  readonly server: FakeServer;
  readonly lay: ReturnType<typeof layer>;
  readonly one: Browser;
  readonly two: Browser;
  readonly p1: Panels;
  readonly p2: Panels;
}

/** Two browsers on one store that accepts `core.general` and `cot-in.cot`; the first browser's user and settings can be chosen. */
async function scene(options: {
  readonly user?: User;
  readonly objects?: (layerId: string) => MapObject[];
  readonly lay?: ReturnType<typeof layer>;
  readonly settings?: Record<string, import('@emc2/plugin-sdk').JsonValue>;
  readonly storeTypes?: readonly string[];
} = {}): Promise<Scene> {
  const lay = options.lay ?? layer('Default', 0);
  const server = new FakeServer([lay], options.storeTypes ?? ['core.general', 'cot-in.cot']);
  for (const object of options.objects?.(lay.id) ?? []) server.seed(object);
  const one = await openBrowser(server, {
    dataTypes: [COT],
    ...(options.user !== undefined ? { user: options.user } : {}),
    ...(options.settings !== undefined ? { settings: options.settings } : {}),
  });
  const two = await openBrowser(server, { dataTypes: [COT] });
  act(() => {
    one.map.activeLayer.set(lay.id);
  });
  return { server, lay, one, two, p1: showPanels(one), p2: showPanels(two) };
}

const typeSelect = (panels: Panels, where: 'symbols' | 'properties') => panels[where].getByLabelText('Data type') as HTMLSelectElement;
const shownOption = (select: HTMLSelectElement) => select.selectedOptions[0]?.textContent;

describe('AC11: a placed symbol has the chosen data type and the data source manual', () => {
  it('offers the available data types by display name, core.general first and selected', async () => {
    const { p1 } = await scene();
    const select = typeSelect(p1, 'symbols');
    expect([...select.options].map((o) => [o.value, o.textContent])).toEqual([['core.general', 'General'], ['cot-in.cot', 'CoT track']]);
    expect(select.value).toBe('core.general');
  });

  it('a symbol placed without a choice has core.general and manual', async () => {
    const { server, one, p1 } = await scene();
    await placeAt(one, p1, STOCKHOLM);
    expect(dataOf(server.requests[0])).toMatchObject({ dataType: 'core.general', dataSource: 'manual' });
    expect(server.objects.size).toBe(1);
    expect(one.ctx.notifications).toEqual([]);
  });

  it('a symbol placed after choosing another data type has it, and manual; the choice stays for the next symbols', async () => {
    const { server, one, p1 } = await scene();
    fireEvent.change(typeSelect(p1, 'symbols'), { target: { value: 'cot-in.cot' } });
    await placeAt(one, p1, STOCKHOLM);
    await clickMap(one, [-130.25, -12.5]);
    expect(server.requests.map((r) => dataOf(r))).toMatchObject([
      { dataType: 'cot-in.cot', dataSource: 'manual', geometry: { coordinates: [18.0686, 59.3293] } },
      { dataType: 'cot-in.cot', dataSource: 'manual', geometry: { coordinates: [-130.25, -12.5] } },
    ]);
    expect(one.ctx.notifications).toEqual([]);
  });

  it('the setting applies when the browser has no choice yet', async () => {
    const { server, one, p1 } = await scene({ settings: { ...settingDefaults(), dataType: 'cot-in.cot' } });
    expect(typeSelect(p1, 'symbols').value).toBe('cot-in.cot');
    await placeAt(one, p1, STOCKHOLM);
    expect(dataOf(server.requests[0]).dataType).toBe('cot-in.cot');
  });

  it('keeps the choice in this browser, and it wins over the setting on the next visit', async () => {
    const { p1 } = await scene();
    fireEvent.change(typeSelect(p1, 'symbols'), { target: { value: 'cot-in.cot' } });
    expect(window.localStorage.getItem(DATA_TYPE_KEY)).toBe('cot-in.cot');

    const server = new FakeServer([layer('Default', 0)], ['core.general', 'cot-in.cot']);
    const next = await openBrowser(server, { dataTypes: [COT] }); // a later visit: the setting says core.general
    expect(typeSelect(showPanels(next), 'symbols').value).toBe('cot-in.cot');
  });

  it('a kept choice that is not available any more gives way to the setting, then to core.general', async () => {
    window.localStorage.setItem(DATA_TYPE_KEY, 'gone.type');
    const server = new FakeServer([layer('Default', 0)]);
    const withSetting = await openBrowser(server, { dataTypes: [COT], settings: { ...settingDefaults(), dataType: 'cot-in.cot' } });
    expect(typeSelect(showPanels(withSetting), 'symbols').value).toBe('cot-in.cot');
    const withoutSetting = await openBrowser(server, { dataTypes: [COT], settings: { ...settingDefaults(), dataType: 'also.gone' } });
    expect(typeSelect(showPanels(withoutSetting), 'symbols').value).toBe('core.general');
  });

  it('works when browser storage fails: the choice lasts for the session and the setting applies on a new visit', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const { server, one, p1 } = await scene();
    fireEvent.change(typeSelect(p1, 'symbols'), { target: { value: 'cot-in.cot' } });
    await placeAt(one, p1, STOCKHOLM);
    expect(dataOf(server.requests[0]).dataType).toBe('cot-in.cot');
    expect(one.ctx.logs.some((l) => l.level === 'warn' && l.message.includes('could not be kept'))).toBe(true);
  });

  it('follows a change of the setting at run time, unless the user has chosen', async () => {
    const { one, p1 } = await scene();
    act(() => {
      one.ctx.changeSettings({ ...settingDefaults(), dataType: 'cot-in.cot' });
    });
    expect(typeSelect(p1, 'symbols').value).toBe('cot-in.cot');
    fireEvent.change(typeSelect(p1, 'symbols'), { target: { value: 'core.general' } });
    act(() => {
      one.ctx.changeSettings({ ...settingDefaults(), dataType: 'cot-in.cot', pickerSymbolSize: 64 });
    });
    expect(typeSelect(p1, 'symbols').value).toBe('core.general'); // the user's choice wins
  });

  it('a refused data type is shown as a notification with the reason', async () => {
    const { one, p1 } = await scene({ storeTypes: ['core.general'] }); // the store does not know cot-in.cot
    fireEvent.change(typeSelect(p1, 'symbols'), { target: { value: 'cot-in.cot' } });
    await placeAt(one, p1, STOCKHOLM);
    expect(one.ctx.notifications).toHaveLength(1);
    expect(one.ctx.notifications[0]).toMatchObject({ severity: 'error' });
    expect(one.ctx.notifications[0]?.message).toContain('VALIDATION_FAILED');
  });
});

describe('AC12: changing an object\'s data type updates it in a second browser; the data source stays', () => {
  it('sends one update with the new data type and the data source unchanged', async () => {
    const { server, one, two, p1, p2 } = await scene({ objects: (layerId) => [symbolObject(layerId)] });
    const seeded = [...server.objects.values()][0] as MapObject;
    await select(one, seeded.id);
    await select(two, seeded.id);
    expect(shownOption(typeSelect(p1, 'properties'))).toBe('General');

    fireEvent.change(typeSelect(p1, 'properties'), { target: { value: 'cot-in.cot' } });
    await settle();

    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({ operation: 'update', entityId: seeded.id, baseVersion: 1 });
    expect(dataOf(server.requests[0])).toEqual({ ...coreOf(seeded), dataType: 'cot-in.cot' });
    expect(dataOf(server.requests[0]).dataSource).toBe('manual');
    expect(server.objects.get(seeded.id)).toMatchObject({ dataType: 'cot-in.cot', dataSource: 'manual', version: 2 });
    expect(shownOption(typeSelect(p2, 'properties'))).toBe('CoT track');
    expect(one.ctx.notifications).toEqual([]);
  });

  it('every other update also carries the data type and the unchanged data source', async () => {
    const { server, one, p1 } = await scene({ objects: (layerId) => [symbolObject(layerId, { dataType: 'cot-in.cot' })] });
    await select(one, [...server.objects.keys()][0] ?? null);
    await commit(input(p1, 'Name'), 'Alpha');
    expect(dataOf(server.requests[0])).toMatchObject({ dataType: 'cot-in.cot', dataSource: 'manual', properties: { name: 'Alpha' } });
  });
});

describe('AC13: an object with a data type that is not available shows it marked and keeps it', () => {
  it('shows the mark, keeps the data type through an update of another field, and drops the mark when an available one is picked', async () => {
    const { server, one, p1 } = await scene({ objects: (layerId) => [symbolObject(layerId, { dataType: 'gone.type' })] });
    const seeded = [...server.objects.values()][0] as MapObject;
    await select(one, seeded.id);
    const select_ = typeSelect(p1, 'properties');
    expect(select_.value).toBe('gone.type');
    expect(shownOption(select_)).toBe('gone.type (not available)');

    await commit(input(p1, 'Name'), 'Alpha');
    expect(server.requests).toHaveLength(1);
    expect(dataOf(server.requests[0])).toMatchObject({ dataType: 'gone.type', dataSource: 'manual', properties: { name: 'Alpha' } });
    expect(server.objects.get(seeded.id)?.dataType).toBe('gone.type'); // kept: the store accepts an unchanged unavailable type
    expect(one.ctx.notifications).toEqual([]);

    fireEvent.change(typeSelect(p1, 'properties'), { target: { value: 'core.general' } });
    await settle();
    expect(server.objects.get(seeded.id)?.dataType).toBe('core.general');
    expect([...typeSelect(p1, 'properties').options].map((o) => o.value)).toEqual(['core.general', 'cot-in.cot']);
  });
});

describe('objects from other sources', () => {
  it('can be edited, show their data source read only, and the update keeps it and the time attributes', async () => {
    const track = modelExample('object-track-from-cot.json');
    const { server, one, p1 } = await scene({ objects: () => [track], lay: { ...layer('Tracks', 0), id: track.layerId } });
    await select(one, track.id);
    expect(p1.properties.getByText('tak-north')).toBeDefined();
    expect(p1.properties.queryByLabelText('Data source')).toBeNull(); // not editable
    expect(shownOption(typeSelect(p1, 'properties'))).toBe('CoT track');

    await commit(input(p1, 'Name'), 'Viper');
    expect(dataOf(server.requests[0])).toEqual({ ...coreOf(track), properties: { name: 'Viper' } });
    expect(dataOf(server.requests[0])).toMatchObject({ dataType: 'cot-in.cot', dataSource: 'tak-north', time: track.time });
    expect(server.objects.get(track.id)).toMatchObject({ dataSource: 'tak-north', extensions: track.extensions });
    expect(one.ctx.notifications).toEqual([]);
  });

  it('a refused change of the data source is a store matter: the plugin never sends one', async () => {
    const track = modelExample('object-track-from-cot.json');
    const { server, one, p1 } = await scene({ objects: () => [track], lay: { ...layer('Tracks', 0), id: track.layerId } });
    await select(one, track.id);
    fireEvent.change(typeSelect(p1, 'properties'), { target: { value: 'core.general' } });
    await commit(input(p1, 'Name'), 'x');
    for (const request of server.requests) expect(dataOf(request).dataSource).toBe('tak-north');
  });
});

describe('AC14: without objects.edit nothing can be placed, edited, dragged or deleted', () => {
  const readOnlyUser = () => createFakeUser({ permissions: [] });

  it('placing is off and the hint is shown; the picker stays usable, it only changes the preview and the kept choice', async () => {
    const { server, one, p1 } = await scene({ user: readOnlyUser() });
    fireEvent.click(p1.symbols.getByRole('button', { name: 'Infantry' }));
    expect(p1.symbols.getByRole('button', { name: 'Place on map' })).toHaveProperty('disabled', true);
    expect(p1.symbols.getByRole('status').textContent).toBe('You may not edit objects');
    fireEvent.click(p1.symbols.getByRole('button', { name: 'Place on map' }));
    await settle();
    await act(async () => {
      one.map.completeInteraction(STOCKHOLM);
      await Promise.resolve();
    });
    expect(server.requests).toHaveLength(0);
  });

  it('the properties panel shows the symbol but every field and select is off, with the hint; there is no Delete to switch off', async () => {
    const { server, one, p1 } = await scene({ user: readOnlyUser(), objects: (layerId) => [symbolObject(layerId, { properties: { name: 'Look' } })] });
    const seeded = [...server.objects.values()][0] as MapObject;
    await select(one, seeded.id); // selecting works
    expect(one.map.selection.value).toEqual([seeded.id]);
    expect(p1.properties.getByText('You may not edit objects')).toBeDefined();
    expect(input(p1, 'Name').value).toBe('Look');
    for (const label of ['Name', 'SIDC', 'Unique designation', 'Higher formation', 'Additional information', 'Position (DD)']) {
      expect(input(p1, label).disabled).toBe(true);
    }
    for (const label of ['Identity', 'Echelon', 'Entity', 'Layer', 'Data type']) {
      expect((p1.properties.getByLabelText(label) as HTMLSelectElement).disabled).toBe(true);
    }
    expect(p1.properties.queryByRole('button', { name: /delete/i })).toBeNull();
  });

  it('a drag does nothing, and a selected symbol (selected by the map view) is shown', async () => {
    const { server, one, p1 } = await scene({ user: readOnlyUser(), objects: (layerId) => [symbolObject(layerId)] });
    const seeded = [...server.objects.values()][0] as MapObject;
    await select(one, seeded.id);
    expect(p1.properties.getByLabelText('SIDC')).toBeDefined();

    await act(async () => {
      one.map.completeInteraction([-130.25, -12.5]); // no drag was asked for
      await Promise.resolve();
    });
    await settle();
    expect(server.requests).toHaveLength(0);
    expect(server.objects.size).toBe(1);
    // The plugin does not even try: a try would end in the controller's own refusal, which is a notification.
    expect(one.ctx.notifications).toEqual([]);
  });

  it('even a commit that gets past the read-only fields is refused by the plugin, and sends nothing', async () => {
    const { server, one, p1 } = await scene({ user: readOnlyUser(), objects: (layerId) => [symbolObject(layerId)] });
    await select(one, [...server.objects.keys()][0] ?? null);
    await commit(input(p1, 'Name'), 'Alpha');
    expect(server.requests).toHaveLength(0);
    expect(one.ctx.notifications).toEqual([{ severity: 'warning', message: 'You may not edit objects.' }]);
  });

  it('with objects.edit, everything works', async () => {
    const { server, one, p1 } = await scene({ user: createFakeUser({ permissions: ['objects.edit'] }), objects: (layerId) => [symbolObject(layerId)] });
    await select(one, [...server.objects.keys()][0] ?? null);
    expect(p1.properties.queryByText('You may not edit objects')).toBeNull();
    await commit(input(p1, 'Name'), 'Alpha');
    expect(server.requests).toHaveLength(1);
    await placeAt(one, p1, STOCKHOLM);
    expect(server.requests).toHaveLength(2);
  });

  it('the no-login user may edit', async () => {
    const { one, p1 } = await scene();
    expect(one.ctx.user.noLogin).toBe(true);
    fireEvent.click(p1.symbols.getByRole('button', { name: 'Infantry' }));
    expect(p1.symbols.getByRole('button', { name: 'Place on map' })).toHaveProperty('disabled', false);
  });

  it('a PERMISSION_DENIED rejection from the server is shown as a notification', async () => {
    const { server, one, p1 } = await scene({ objects: (layerId) => [symbolObject(layerId)] });
    await select(one, [...server.objects.keys()][0] ?? null);
    one.connection.rejectNext.push('PERMISSION_DENIED');
    await commit(input(p1, 'Name'), 'Alpha');
    expect(one.ctx.notifications).toEqual([{ severity: 'error', message: 'Could not rename the symbol: refused by the test (PERMISSION_DENIED)' }]);
    expect(input(p1, 'Name').value).toBe('Alpha'); // the input stays
  });
});

describe('the live picture: the layers, and a small area round the selected symbol (T-054, brief function 8)', () => {
  const FAR: [number, number] = [-130.25, -12.5];
  const areas = (browser: Browser) => browser.ctx.liveSubscriptions.filter((o) => typeof o.area === 'object');

  it('subscribes to the layers only at start: no objects, and never to the viewport', async () => {
    const { one } = await scene();
    expect(one.ctx.liveSubscriptions).toEqual([{ objects: false }]);
  });

  it('selecting a symbol subscribes to a small area round it, and only that', async () => {
    const { server, one } = await scene({ objects: (layerId) => [symbolObject(layerId)] });
    const seeded = [...server.objects.values()][0] as MapObject;
    await select(one, seeded.id);
    const [area] = one.connection.areas;
    expect(one.connection.areas).toHaveLength(1);
    expect(one.ctx.liveSubscriptions).toHaveLength(2);
    expect(area?.inside).toEqual([15.5, 60.25]); // lon, lat: not the same number
    const lons = area?.ring.map(([lon]) => lon) ?? [];
    const lats = area?.ring.map(([, lat]) => lat) ?? [];
    expect(Math.max(...lats) - Math.min(...lats)).toBeLessThan(0.05); // about 2 km
    expect(Math.max(...lons) - Math.min(...lons)).toBeLessThan(0.1);
    expect(Math.min(...lons)).toBeLessThan(15.5);
    expect(Math.max(...lons)).toBeGreaterThan(15.5);
    expect(area?.ring[0]).toEqual(area?.ring[area.ring.length - 1]);
  });

  it('ending the selection ends the area subscription', async () => {
    const { server, one } = await scene({ objects: (layerId) => [symbolObject(layerId)] });
    await select(one, [...server.objects.keys()][0] ?? null);
    expect(areas(one)).toHaveLength(1);
    await select(one, null);
    expect(areas(one)).toHaveLength(1); // still there for a moment: a deletion that is on its way would be seen
    await advanceGrace();
    expect(one.ctx.liveSubscriptions).toEqual([{ objects: false }]);
  });

  it('selecting the same symbol again within the grace period keeps its area', async () => {
    const { server, one } = await scene({ objects: (layerId) => [symbolObject(layerId)] });
    const id = [...server.objects.keys()][0] ?? null;
    await select(one, id);
    await select(one, null);
    await select(one, id);
    await advanceGrace();
    expect(one.connection.areas).toHaveLength(1);
    expect(areas(one)).toHaveLength(1);
  });

  it('another symbol gets its own area, and the old one ends', async () => {
    const { server, one } = await scene({ objects: (layerId) => [symbolObject(layerId), symbolObject(layerId, { geometry: { type: 'Point', coordinates: [20.25, 63.5] } })] });
    const [first, second] = [...server.objects.keys()];
    await select(one, first ?? null);
    await select(one, second ?? null);
    expect(one.connection.areas).toHaveLength(2);
    expect(one.connection.areas[1]?.inside).toEqual([20.25, 63.5]);
    expect(areas(one)).toHaveLength(1);
  });

  it('several selected, or one that is not a symbol, subscribe to no area', async () => {
    const { server, one } = await scene({ objects: (layerId) => [symbolObject(layerId), symbolObject(layerId), symbolObject(layerId, { type: 'core.shape' })] });
    const [a, b, shape] = [...server.objects.keys()];
    act(() => {
      one.map.selection.set([a ?? '', b ?? '']);
    });
    await settle();
    await select(one, shape ?? null);
    expect(one.connection.areas).toHaveLength(0);
    expect(one.ctx.liveSubscriptions).toEqual([{ objects: false }]);
  });

  it('placing subscribes to nothing, and the new symbol is not held', async () => {
    const { one, p1 } = await scene();
    await placeAt(one, p1, STOCKHOLM);
    await settle();
    expect(one.ctx.liveSubscriptions).toEqual([{ objects: false }]);
    expect(one.connection.areas).toHaveLength(0);
  });

  it('the layers come from the layer subscription: placing is possible in the active layer', async () => {
    const { one, lay, p1 } = await scene({ objects: (layerId) => [symbolObject(layerId)] });
    fireEvent.click(p1.symbols.getByRole('button', { name: 'Infantry' }));
    expect(p1.symbols.getByRole('button', { name: 'Place on map' })).toHaveProperty('disabled', false);
    expect(one.map.activeLayer.value).toBe(lay.id);
  });

  it('a symbol moved out of the area by someone else: the area is subscribed again round the new position, the panel stays open, no notice', async () => {
    const { server, one, p1 } = await scene({ objects: (layerId) => [symbolObject(layerId, { properties: { name: 'Roamer' } })] });
    const seeded = [...server.objects.values()][0] as MapObject;
    await select(one, seeded.id);
    expect(input(p1, 'Name').value).toBe('Roamer');
    act(() => {
      server.changeElsewhere(changeRequests.updateObject(seeded, { ...coreOf(seeded), properties: { name: 'Roamer' }, geometry: { type: 'Point', coordinates: FAR } }));
    });
    await settle();
    await settle();
    expect(one.connection.areas).toHaveLength(2);
    expect(one.connection.areas[1]?.inside).toEqual(FAR);
    expect(areas(one)).toHaveLength(1);
    expect(one.map.selection.value).toEqual([seeded.id]);
    expect(input(p1, 'Name').value).toBe('Roamer');
    expect(one.ctx.notifications).toEqual([]);
    // It is followed again: a change at the new place reaches the panel.
    const moved = server.objects.get(seeded.id) as MapObject;
    act(() => {
      server.changeElsewhere(changeRequests.updateObject(moved, { ...coreOf(moved), properties: { name: 'Settled' } }));
    });
    await settle();
    expect(input(p1, 'Name').value).toBe('Settled');
  });

  it('moving the symbol out of the area by dragging it: followed to the new place, the panel stays open', async () => {
    const { server, one, p1 } = await scene({ objects: (layerId) => [symbolObject(layerId)] });
    const seeded = [...server.objects.values()][0] as MapObject;
    await select(one, seeded.id);
    await act(async () => {
      one.map.completeInteraction(FAR);
      await Promise.resolve();
    });
    await settle();
    await settle();
    expect(server.requests).toHaveLength(1);
    expect(one.connection.areas).toHaveLength(2);
    expect(one.connection.areas[1]?.inside).toEqual(FAR);
    expect(input(p1, 'Position (DD)').value).toBe('12.5 S 130.25 W');
    expect(one.ctx.notifications).toEqual([]);
  });

  it('the typed text is not lost when the symbol moves out of the area and is read again', async () => {
    const { server, one, p1 } = await scene({ objects: (layerId) => [symbolObject(layerId)] });
    const seeded = [...server.objects.values()][0] as MapObject;
    await select(one, seeded.id);
    const name = input(p1, 'Name');
    fireEvent.change(name, { target: { value: 'Typing' } });
    act(() => {
      server.changeElsewhere(changeRequests.updateObject(seeded, { ...coreOf(seeded), geometry: { type: 'Point', coordinates: FAR } }));
    });
    await settle();
    await settle();
    expect(input(p1, 'Name')).toBe(name); // the same field, not a new one
    expect(name.value).toBe('Typing');
  });

  it('a real deletion of the selected symbol gives the notice, and the area ends with the selection', async () => {
    const { server, one } = await scene({ objects: (layerId) => [symbolObject(layerId)] });
    const seeded = [...server.objects.values()][0] as MapObject;
    await select(one, seeded.id);
    act(() => {
      server.changeElsewhere(changeRequests.deleteObject(seeded));
    });
    await settle();
    expect(one.ctx.notifications).toEqual([{ severity: 'info', message: 'The selected symbol was deleted by someone else.' }]);
    expect(one.map.selection.value).toEqual([]);
    await advanceGrace();
    expect(one.ctx.liveSubscriptions).toEqual([{ objects: false }]);
  });

  it('a deletion that reaches this plugin after the map view emptied the selection is still announced (within the grace period)', async () => {
    const { server, one } = await scene({ objects: (layerId) => [symbolObject(layerId)] });
    const seeded = [...server.objects.values()][0] as MapObject;
    await select(one, seeded.id);
    await select(one, null); // the map view heard of the deletion first
    act(() => {
      server.changeElsewhere(changeRequests.deleteObject(seeded), { plugin: 'core-shell', user: 'another-user' }); // then this plugin's own channel
    });
    await settle();
    expect(one.ctx.notifications).toEqual([{ severity: 'info', message: 'The selected symbol was deleted by someone else.' }]);
  });

  it('a symbol that moved away between the read and the snapshot is read again and followed to the new place', async () => {
    const { server, one, p1 } = await scene({ objects: (layerId) => [symbolObject(layerId, { properties: { name: 'Runner' } })] });
    const seeded = [...server.objects.values()][0] as MapObject;
    one.connection.holdSnapshots = true;
    await select(one, seeded.id);
    server.seed({ ...seeded, version: 2, geometry: { type: 'Point', coordinates: FAR } }); // moved while the snapshot was on its way
    act(() => {
      one.connection.releaseSnapshots();
    });
    await settle();
    await settle();
    expect(one.connection.areas).toHaveLength(2);
    expect(one.connection.areas[1]?.inside).toEqual(FAR);
    expect(areas(one)).toHaveLength(1);
    expect(input(p1, 'Name').value).toBe('Runner');
    expect(input(p1, 'Position (DD)').value).toBe('12.5 S 130.25 W');
  });

  it('does not subscribe again and again while the snapshot of the area is on its way', async () => {
    const { server, one } = await scene({ objects: (layerId) => [symbolObject(layerId)] });
    const seeded = [...server.objects.values()][0] as MapObject;
    one.connection.holdSnapshots = true;
    await select(one, seeded.id);
    for (let i = 0; i < 5; i++) {
      act(() => {
        one.map.setViewport({ ...one.map.viewport, center: [15 + i, 62] });
      });
      await settle();
    }
    expect(one.connection.areas).toHaveLength(1);
  });

  it('a symbol that cannot be read, or no longer exists, gets no area', async () => {
    const { server, one } = await scene({ objects: (layerId) => [symbolObject(layerId), symbolObject(layerId)] });
    const [gone, unreadable] = [...server.objects.values()] as [MapObject, MapObject];
    server.deleteSilently(gone.id);
    await select(one, gone.id);
    one.connection.failReads = true;
    await select(one, unreadable.id);
    expect(one.connection.areas).toHaveLength(0);
  });

  it('a symbol this browser has just placed is not held: selecting it reads it', async () => {
    const { server, one, p1 } = await scene();
    await placeAt(one, p1, STOCKHOLM);
    const [placed] = [...server.objects.keys()];
    one.connection.holdSnapshots = true;
    one.connection.reads.length = 0;
    await select(one, placed ?? null);
    expect(one.connection.reads).toEqual([[placed]]);
  });

  it('a symbol that is not selected cannot reach this browser: a change of another symbol shows nothing', async () => {
    const { server, one, p1 } = await scene({ objects: (layerId) => [symbolObject(layerId), symbolObject(layerId, { geometry: { type: 'Point', coordinates: [40, 70] } })] });
    const [mine, other] = [...server.objects.values()] as [MapObject, MapObject];
    await select(one, mine.id);
    act(() => {
      server.changeElsewhere(changeRequests.updateObject(other, { ...coreOf(other), properties: { name: 'Other' } }));
    });
    await settle();
    expect(input(p1, 'Name').value).toBe('');
    expect(one.ctx.notifications).toEqual([]);
  });
});

describe('objects that are not point symbols, and the list of data types at run time', () => {
  it('a symbol that is not a point is shown read only, with its data type by name and its data source', async () => {
    const { server, one, p1 } = await scene({
      objects: (layerId) => [
        symbolObject(layerId, { dataType: 'cot-in.cot', dataSource: 'tak-north', geometry: { type: 'LineString', coordinates: [[10, 20], [11, 21]] } }),
      ],
    });
    await select(one, [...server.objects.keys()][0] ?? null);
    expect(p1.properties.getByText('CoT track')).toBeDefined();
    expect(p1.properties.getByText('tak-north')).toBeDefined();
    expect(p1.properties.queryByLabelText('Data type')).toBeNull();
  });

  it('follows onDataTypesChange: a data type that is gone from the list is marked in the panel and gives way in the picker', () => {
    const lay = layer('Default', 0);
    const object = symbolObject(lay.id, { dataType: 'cot-in.cot' });
    window.localStorage.setItem(DATA_TYPE_KEY, 'cot-in.cot');
    const ctx = createFakeContext({ pluginId: manifest.id, settings: settingDefaults(), dataTypes: [COT] });
    // The fake's list is fixed: stand in for ECore changing it, and call the listener the controller registered.
    let current = ctx.dataTypes;
    const listeners: ((types: readonly DataType[]) => void)[] = [];
    Object.defineProperty(ctx, 'dataTypes', { get: () => current });
    ctx.onDataTypesChange = (listener) => {
      listeners.push(listener);
      return () => undefined;
    };
    const map = createFakeMapView();
    const tracker = new ObjectTracker();
    tracker.snapshot({ layers: [lay], objects: [object], sequenceNo: 0 });
    map.selection.set([object.id]);
    const controller = new DrawController(ctx, tracker, map);
    const symbols = createFakeSymbolService();
    const view = render(
      <>
        <SymbolsPanel controller={controller} symbols={symbols} />
        <PropertiesPanel controller={controller} symbols={symbols} coordinates={createFakeCoordinateService()} />
      </>,
    );
    const options = (label: string) => [...(view.getAllByLabelText(label)[0] as HTMLSelectElement).options].map((o) => o.textContent);
    expect(view.getAllByLabelText('Data type').map((e) => (e as HTMLSelectElement).value)).toEqual(['cot-in.cot', 'cot-in.cot']);

    current = [GENERAL_DATA_TYPE_INFO];
    act(() => {
      for (const listener of listeners) listener(current);
    });
    // The picker falls back (the kept choice is not available any more); the object keeps its type, marked.
    const [picker, properties] = view.getAllByLabelText('Data type') as HTMLSelectElement[];
    expect(picker?.value).toBe('core.general');
    expect(options('Data type')).toEqual(['General']);
    expect(properties?.value).toBe('cot-in.cot');
    expect(shownOption(properties as HTMLSelectElement)).toBe('cot-in.cot (not available)');
  });
});
