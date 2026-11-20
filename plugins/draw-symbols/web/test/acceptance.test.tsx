// One or more tests per acceptance criterion of docs/plugins/briefs/draw-symbols.md. "A second
// browser" is a second fake context connected to the same FakeServer, with its own panels. Every
// request is checked against model/schemas/change-request.schema.json by the fake store. What a
// unit test cannot show (real pixels, the 1 s of criterion 1, the 1 pixel of criterion 3) is the
// ITA's browser tests; here the position the map view returns is checked to be sent unchanged.
import { act, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { changeRequests } from '@emc2/plugin-sdk';
import type { MapObject } from '@emc2/plugin-sdk';
import { coreOf } from '../src/content.ts';
import { FakeServer, layer, modelExample, symbolObject } from './fakeServer.ts';
import { DEFAULT_LABEL, isolateDocumentListeners, openBrowser, ROUND_TRIP, settingDefaults, settle, showPanels, STOCKHOLM } from './harness.tsx';
import { choose, clickMap, commit, dataOf, input, placeAt, select, twoBrowsers, UUID_V7 } from './scene.tsx';

isolateDocumentListeners();

describe('AC1: placing creates exactly one valid change request, and the symbol is in a second browser', () => {
  it('sends one create with the active layer, a new UUID v7, the default label, and the clicked point as lon/lat', async () => {
    const { server, lay, one, two, p1, p2 } = await twoBrowsers();
    act(() => {
      one.map.activeLayer.set(lay.id);
    });

    await placeAt(one, p1, STOCKHOLM);

    expect(server.requests).toHaveLength(1);
    const request = server.requests[0];
    expect(request).toMatchObject({ entityType: 'object', operation: 'create', source: { plugin: 'draw-symbols' } });
    expect(request?.entityId).toMatch(UUID_V7);
    expect('baseVersion' in (request ?? {})).toBe(false);
    expect(dataOf(request)).toEqual({
      type: 'core.symbol',
      dataType: 'core.general', // M1: the data type chosen in the picker (the setting's default), drawn by hand
      dataSource: 'manual',
      layerId: lay.id,
      geometry: { type: 'Point', coordinates: [18.0686, 59.3293] }, // longitude first; latitude ≠ longitude
      symbol: { standard: 'APP-6D', sidc: '10031000001211000000' },
      label: DEFAULT_LABEL,
    });
    expect(one.ctx.notifications).toEqual([]);

    // The second browser has it: selecting it there shows the symbol.
    const id = request?.entityId ?? '';
    expect(two.map.selection.value).toEqual([]);
    await select(two, id);
    expect(input(p2, 'SIDC').value).toBe('10031000001211000000');
    expect(input(p2, 'Position (DD)').value).toBe('59.3293 N 18.0686 E');
    await select(one, id);
    expect(input(p1, 'SIDC').value).toBe('10031000001211000000');
  });

  it('keeps placing: each further click is one more create with its own id, until Escape', async () => {
    const { server, lay, one, p1 } = await twoBrowsers();
    act(() => {
      one.map.activeLayer.set(lay.id);
    });
    await placeAt(one, p1, STOCKHOLM);
    await clickMap(one, [-130.25, -12.5]);
    expect(server.requests).toHaveLength(2);
    expect(new Set(server.requests.map((r) => r.entityId)).size).toBe(2);
    expect(dataOf(server.requests[1]).geometry).toEqual({ type: 'Point', coordinates: [-130.25, -12.5] });

    await act(async () => {
      one.map.completeInteraction(null); // Escape in the map view
      await Promise.resolve();
    });
    await settle();
    expect(p1.symbols.getByRole('button', { name: 'Place on map' })).toBeDefined(); // not 'Stop placing' any more: placing stopped
    await act(async () => {
      one.map.completeInteraction([1, 2]);
      await Promise.resolve();
    });
    expect(server.requests).toHaveLength(2);
  });

  it('places the symbol with the standard of the setting', async () => {
    const lay = layer('Default', 0);
    const server = new FakeServer([lay]);
    const browser = await openBrowser(server, { settings: { ...settingDefaults(), standard: 'APP-6E' } });
    const panels = showPanels(browser);
    act(() => {
      browser.map.activeLayer.set(lay.id);
    });
    await placeAt(browser, panels, STOCKHOLM);
    expect(dataOf(server.requests[0]).symbol?.standard).toBe('APP-6E');
    expect(dataOf(server.requests[0]).symbol?.sidc).toMatch(/^13/); // APP-6E version digits
  });
});

describe('AC2: editing sends the complete core content with baseVersion, and a second browser follows', () => {
  it('name, text modifier, echelon and identity each update the object', async () => {
    const { server, one, two, p1, p2 } = await twoBrowsers((layerId) => [symbolObject(layerId)]);
    const seeded = [...server.objects.values()][0] as MapObject;
    await select(one, seeded.id);
    await select(two, seeded.id);

    await commit(input(p1, 'Name'), 'Alpha');
    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({ operation: 'update', entityId: seeded.id, baseVersion: 1 });
    expect(dataOf(server.requests[0])).toEqual({ ...coreOf(seeded), properties: { name: 'Alpha' } });
    expect(input(p2, 'Name').value).toBe('Alpha');

    await commit(input(p1, 'Unique designation'), 'A-1');
    expect(server.requests[1]).toMatchObject({ baseVersion: 2 });
    expect(dataOf(server.requests[1])).toEqual({ ...coreOf(seeded), properties: { name: 'Alpha' }, symbol: { ...seeded.symbol, modifiers: { uniqueDesignation: 'A-1' } } });
    expect(input(p2, 'Unique designation').value).toBe('A-1');

    await choose(p1.properties.getByLabelText('Echelon'), '16');
    expect(server.requests[2]).toMatchObject({ baseVersion: 3 });
    expect(dataOf(server.requests[2]).symbol?.sidc).toBe('10031000161211000000');
    expect((p2.properties.getByLabelText('Echelon') as HTMLSelectElement).value).toBe('16');

    await choose(p1.properties.getByLabelText('Identity'), '6');
    expect(server.requests[3]).toMatchObject({ baseVersion: 4 });
    const final = dataOf(server.requests[3]);
    expect(final.symbol).toEqual({ standard: 'APP-6D', sidc: '10061000161211000000', modifiers: { uniqueDesignation: 'A-1' } });
    expect(final.properties).toEqual({ name: 'Alpha' });
    expect(final.geometry).toEqual(seeded.geometry);
    expect(final.layerId).toBe(seeded.layerId);
    expect(final.label).toEqual(seeded.label);
    expect((p2.properties.getByLabelText('Identity') as HTMLSelectElement).value).toBe('6');
    expect(server.requests).toHaveLength(4);
    expect(one.ctx.notifications).toEqual([]);
  });

  it('changes the other two text modifiers and the layer, and empty text removes a value', async () => {
    const other = layer('Other', 5);
    const { server, one, two, p1, p2 } = await twoBrowsers((layerId) => [symbolObject(layerId, { properties: { name: 'x', description: 'keep me' } })]);
    server.layers.set(other.id, other);
    server.sendSnapshot(one.ctx);
    server.sendSnapshot(two.ctx);
    const seeded = [...server.objects.values()][0] as MapObject;
    await select(one, seeded.id);
    await select(two, seeded.id);

    await commit(input(p1, 'Higher formation'), '2 Bde');
    await commit(input(p1, 'Additional information'), 'note');
    await choose(p1.properties.getByLabelText('Layer'), other.id);
    expect(server.objects.get(seeded.id)?.layerId).toBe(other.id);
    expect(server.objects.get(seeded.id)?.symbol?.modifiers).toEqual({ higherFormation: '2 Bde', additionalInformation: 'note' });
    expect((p2.properties.getByLabelText('Layer') as HTMLSelectElement).value).toBe(other.id);

    await commit(input(p1, 'Name'), '   ');
    expect(server.objects.get(seeded.id)?.properties).toEqual({ description: 'keep me' });
    expect(input(p2, 'Name').value).toBe('');
  });

  it('commits on Enter or when leaving the field, not on every keystroke', async () => {
    const { server, one, p1 } = await twoBrowsers((layerId) => [symbolObject(layerId)]);
    const seeded = [...server.objects.values()][0] as MapObject;
    await select(one, seeded.id);
    const name = input(p1, 'Name');
    for (const text of ['A', 'Al', 'Alp', 'Alph', 'Alpha']) fireEvent.change(name, { target: { value: text } });
    await settle();
    expect(server.requests).toHaveLength(0);
    fireEvent.blur(name);
    await settle();
    expect(server.requests).toHaveLength(1);
    expect(dataOf(server.requests[0]).properties).toEqual({ name: 'Alpha' });

    // Enter and then leaving the field is still one change.
    await commit(name, 'Bravo');
    fireEvent.blur(name);
    await settle();
    expect(server.requests).toHaveLength(2);

    // Escape gives up the edit.
    fireEvent.change(name, { target: { value: 'zzz' } });
    fireEvent.keyDown(name, { key: 'Escape' });
    expect(name.value).toBe('Bravo');
    fireEvent.blur(name);
    await settle();
    expect(server.requests).toHaveLength(2);

    // A commit that changes nothing sends nothing: the same text with spaces around it, or an empty modifier left empty.
    await commit(name, '  Bravo ');
    await commit(input(p1, 'Unique designation'), '   ');
    expect(server.requests).toHaveLength(2);
    expect(name.value).toBe('Bravo');
  });
});

describe('AC3: dragging moves the symbol with one update, at the drop point', () => {
  it('sends the drop point as lon/lat, unchanged, and a second browser follows', async () => {
    const { server, one, two, p2 } = await twoBrowsers((layerId) => [symbolObject(layerId)]);
    const seeded = [...server.objects.values()][0] as MapObject;
    await select(one, seeded.id);
    await select(two, seeded.id);

    await act(async () => {
      one.map.completeInteraction([-130.25, -12.5]); // the map view's drop point; latitude ≠ longitude
      await Promise.resolve();
    });
    await settle();

    expect(server.requests).toHaveLength(1);
    expect(server.requests[0]).toMatchObject({ operation: 'update', entityId: seeded.id, baseVersion: 1 });
    expect(dataOf(server.requests[0]).geometry).toEqual({ type: 'Point', coordinates: [-130.25, -12.5] });
    expect(dataOf(server.requests[0])).toEqual({ ...coreOf(seeded), geometry: { type: 'Point', coordinates: [-130.25, -12.5] } });
    expect(input(p2, 'Position (DD)').value).toBe('12.5 S 130.25 W');
    expect(one.ctx.notifications).toEqual([]);
  });

  it('can be dragged again, and a cancelled drag changes nothing', async () => {
    const { server, one } = await twoBrowsers((layerId) => [symbolObject(layerId)]);
    const seeded = [...server.objects.values()][0] as MapObject;
    await select(one, seeded.id);
    await act(async () => {
      one.map.completeInteraction(null); // Escape during the drag
      await Promise.resolve();
    });
    await settle();
    expect(server.requests).toHaveLength(0);
    await select(one, null); // the map view's Escape also clears the selection
    await select(one, seeded.id); // ... and selecting the symbol again waits for a drag again
    await settle();
    await act(async () => {
      one.map.completeInteraction(STOCKHOLM);
      await Promise.resolve();
    });
    await settle();
    await act(async () => {
      one.map.completeInteraction([-130.25, -12.5]);
      await Promise.resolve();
    });
    await settle();
    expect(server.requests.map((r) => dataOf(r).geometry)).toEqual([
      { type: 'Point', coordinates: [18.0686, 59.3293] },
      { type: 'Point', coordinates: [-130.25, -12.5] },
    ]);
    expect(server.requests.map((r) => 'baseVersion' in r && r.baseVersion)).toEqual([1, 2]);
  });
});

describe('AC4: typing a position in MGRS, DMS or DD moves the symbol', () => {
  it.each(ROUND_TRIP)('moves it when $text is typed ($format)', async ({ format, text, position }) => {
    const { server, one, two, p1, p2 } = await twoBrowsers((layerId) => [symbolObject(layerId)]);
    const seeded = [...server.objects.values()][0] as MapObject;
    await select(one, seeded.id);
    await select(two, seeded.id);
    act(() => {
      one.coordinates.chosenFormat.set(format);
      two.coordinates.chosenFormat.set(format);
    });

    await commit(input(p1, `Position (${format.toUpperCase()})`), text);

    expect(server.requests).toHaveLength(1);
    expect(dataOf(server.requests[0]).geometry).toEqual({ type: 'Point', coordinates: [position[0], position[1]] });
    // What the user sees in the chosen format comes back from the service for the stored position.
    expect(input(p1, `Position (${format.toUpperCase()})`).value).toBe(text);
    expect(input(p2, `Position (${format.toUpperCase()})`).value).toBe(text);
  });

  it('keeps what was typed and says why when the text is not a position; nothing is sent', async () => {
    const { server, one, p1 } = await twoBrowsers((layerId) => [symbolObject(layerId)]);
    const seeded = [...server.objects.values()][0] as MapObject;
    await select(one, seeded.id);
    const field = input(p1, 'Position (DD)');
    await commit(field, 'nowhere');
    expect(server.requests).toHaveLength(0);
    expect(field.value).toBe('nowhere');
    expect(p1.properties.getByRole('alert').textContent).toContain('cannot read "nowhere" as a position');
  });

  it('shows the position in the format the user chooses, also when it changes', async () => {
    const { server, one, p1 } = await twoBrowsers((layerId) => [symbolObject(layerId, { geometry: { type: 'Point', coordinates: [18.0686, 59.3293] } })]);
    await select(one, [...server.objects.keys()][0] ?? null);
    expect(input(p1, 'Position (DD)').value).toBe('59.3293 N 18.0686 E');
    act(() => {
      one.coordinates.chosenFormat.set('mgrs');
    });
    expect(input(p1, 'Position (MGRS)').value).toBe('34VCL3862266164');
  });
});

describe('AC5: another plugin\'s extension is left unchanged', () => {
  it('an update and a move of the cot-in track send no extensions, and the store still holds them', async () => {
    const track = modelExample('object-track-from-cot.json');
    const scene = await twoBrowsers(() => [track], { ...layer('Tracks', 0), id: track.layerId });
    const { server, one, p1 } = scene;
    await select(one, track.id);

    await commit(input(p1, 'Name'), 'Viper');
    await act(async () => {
      one.map.completeInteraction([-130.25, -12.5]);
      await Promise.resolve();
    });
    await settle();

    expect(server.requests).toHaveLength(2);
    for (const request of server.requests) expect('extensions' in dataOf(request)).toBe(false);
    const stored = server.objects.get(track.id);
    expect(stored?.extensions).toEqual(track.extensions);
    expect(stored?.meta.externalRef).toEqual(track.meta.externalRef);
    expect(stored?.version).toBe(track.version + 2);
    // What else the object carried is sent back as it was: the altitude, speed and direction, the APP-6B SIDC.
    expect(stored?.geometry).toEqual({ type: 'Point', coordinates: [-130.25, -12.5, 45.2] });
    expect(stored?.symbol).toEqual(track.symbol);
    expect(stored?.properties).toEqual({ name: 'Viper' });
    expect(stored?.label).toEqual(track.label);
  });

  it('shows an APP-6B symbol without the identity, echelon and entity choices, and edits its SIDC', async () => {
    const track = modelExample('object-track-from-cot.json');
    const { server, one, p1 } = await twoBrowsers(() => [track], { ...layer('Tracks', 0), id: track.layerId });
    await select(one, track.id);
    expect(p1.properties.queryByLabelText('Identity')).toBeNull();
    expect(p1.properties.queryByLabelText('Echelon')).toBeNull();
    expect(input(p1, 'SIDC').value).toBe('SFGPUCI--------');
    await commit(input(p1, 'SIDC'), 'SHGPUCI--------');
    expect(dataOf(server.requests[0]).symbol).toEqual({ ...track.symbol, sidc: 'SHGPUCI--------' });
  });
});

describe('AC6 (M2): the shared Delete of the shell deletes; the plugin has no Delete of its own', () => {
  it('has no Delete button, and the Delete key sends nothing', async () => {
    const { server, one, p1 } = await twoBrowsers((layerId) => [symbolObject(layerId)]);
    const seeded = [...server.objects.values()][0] as MapObject;
    await select(one, seeded.id);
    expect(p1.properties.queryByRole('button', { name: /delete/i })).toBeNull();
    fireEvent.keyDown(document.body, { key: 'Delete' });
    await settle();
    expect(server.requests).toHaveLength(0);
    expect(server.objects.size).toBe(1);
  });

  it('when the shell deletes the selected symbol for this user: the panel goes back to its hint and nothing is announced', async () => {
    const { server, one, p1 } = await twoBrowsers((layerId) => [symbolObject(layerId)]);
    const seeded = [...server.objects.values()][0] as MapObject;
    await select(one, seeded.id);
    act(() => {
      server.changeElsewhere(changeRequests.deleteObject(seeded), { plugin: 'core-shell', user: one.ctx.user.id });
    });
    await settle();
    expect(one.map.selection.value).toEqual([]);
    expect(p1.properties.getByText('Select a symbol on the map.')).toBeDefined();
    expect(one.ctx.notifications).toEqual([]);
  });

  it('when someone else deletes the selected symbol, the other browser is told once and its panel goes back to its hint', async () => {
    const { server, one, two, p1, p2 } = await twoBrowsers((layerId) => [symbolObject(layerId)]);
    const seeded = [...server.objects.values()][0] as MapObject;
    await select(one, seeded.id);
    await select(two, seeded.id);
    act(() => {
      server.changeElsewhere(changeRequests.deleteObject(seeded), { plugin: 'core-shell', user: 'another-user' });
    });
    await settle();
    for (const [browser, panels] of [[one, p1], [two, p2]] as const) {
      expect(browser.ctx.notifications).toEqual([{ severity: 'info', message: 'The selected symbol was deleted by someone else.' }]);
      expect(panels.properties.getByText('Select a symbol on the map.')).toBeDefined();
    }
  });
});

describe('AC7: with no active layer, placing is impossible and the hint is shown', () => {
  it('disables placing, shows the hint, and a click on the map places nothing', async () => {
    const { server, one, p1 } = await twoBrowsers();
    expect(one.map.activeLayer.value).toBeNull();
    fireEvent.click(p1.symbols.getByRole('button', { name: 'Infantry' }));
    const place = p1.symbols.getByRole('button', { name: 'Place on map' }) as HTMLButtonElement;
    expect(place.disabled).toBe(true);
    expect(p1.symbols.getByRole('status').textContent).toBe('Select or create a layer in the layer panel');
    fireEvent.click(place);
    await settle();
    act(() => {
      one.map.firePointer({ type: 'click', position: STOCKHOLM, pixel: [10, 10] });
    });
    await act(async () => {
      one.map.completeInteraction(STOCKHOLM); // nothing is waiting for it
      await Promise.resolve();
    });
    expect(server.requests).toHaveLength(0);
  });

  it('treats an active layer that does not exist (yet) like none', async () => {
    const { one, p1 } = await twoBrowsers();
    act(() => {
      one.map.activeLayer.set('0192a5c4-3b1e-7c2d-9f00-000000000000');
    });
    fireEvent.click(p1.symbols.getByRole('button', { name: 'Infantry' }));
    expect((p1.symbols.getByRole('button', { name: 'Place on map' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('stops placing when the active layer goes away', async () => {
    const { server, lay, one, two, p1 } = await twoBrowsers();
    act(() => {
      one.map.activeLayer.set(lay.id);
    });
    fireEvent.click(p1.symbols.getByRole('button', { name: 'Infantry' }));
    fireEvent.click(p1.symbols.getByRole('button', { name: 'Place on map' }));
    expect(p1.symbols.getByRole('button', { name: 'Stop placing' })).toBeDefined();
    act(() => {
      one.map.activeLayer.set(null);
    });
    expect((p1.symbols.getByRole('button', { name: 'Place on map' }) as HTMLButtonElement).disabled).toBe(true);
    expect(two.map.activeLayer.value).toBeNull();
    expect(server.requests).toHaveLength(0);
  });
});

describe('AC8: an invalid typed SIDC cannot be placed, and the reason is shown', () => {
  async function withLayer() {
    const scene = await twoBrowsers();
    act(() => {
      scene.one.map.activeLayer.set(scene.lay.id);
    });
    return scene;
  }

  it.each(['123', 'abc', '10031000001211000000999', '13031000001211000000'])('refuses "%s" for APP-6D', async (text) => {
    const { server, p1 } = await withLayer();
    fireEvent.click(p1.symbols.getByRole('button', { name: 'Infantry' }));
    fireEvent.change(p1.symbols.getByLabelText('SIDC (APP-6D)'), { target: { value: text } });
    expect(p1.symbols.getByRole('alert').textContent).toBe('not a valid APP-6D SIDC');
    const place = p1.symbols.getByRole('button', { name: 'Place on map' }) as HTMLButtonElement;
    expect(place.disabled).toBe(true);
    fireEvent.click(place);
    await settle();
    expect(server.requests).toHaveLength(0);
  });

  it('places a valid typed SIDC instead of the chosen entity, and clears the typed one when an entity is chosen', async () => {
    const { server, one, p1 } = await withLayer();
    fireEvent.click(p1.symbols.getByRole('button', { name: 'Infantry' }));
    fireEvent.change(p1.symbols.getByLabelText('SIDC (APP-6D)'), { target: { value: '10061000161211000000' } });
    expect(p1.symbols.queryByRole('alert')).toBeNull();
    expect(p1.symbols.getByText('10061000161211000000')).toBeDefined();
    await placeAt(one, p1, STOCKHOLM, 'Infantry');
    // Clicking the entity above made the typed SIDC give way to the catalog choice.
    expect(dataOf(server.requests[0]).symbol?.sidc).toBe('10031000001211000000');
    fireEvent.change(p1.symbols.getByLabelText('SIDC (APP-6D)'), { target: { value: '10061000161211000000' } });
    await clickMap(one, [-130.25, -12.5]);
    expect(dataOf(server.requests[1]).symbol).toEqual({ standard: 'APP-6D', sidc: '10061000161211000000' });
  });

  it('stops placing when the typed SIDC becomes invalid', async () => {
    const { p1 } = await withLayer();
    fireEvent.click(p1.symbols.getByRole('button', { name: 'Armour' }));
    fireEvent.click(p1.symbols.getByRole('button', { name: 'Place on map' }));
    fireEvent.change(p1.symbols.getByLabelText('SIDC (APP-6D)'), { target: { value: '12' } });
    expect(p1.symbols.getByRole('button', { name: 'Place on map' })).toHaveProperty('disabled', true);
  });
});

describe('AC9: two browsers editing the same symbol end up with the same state', () => {
  it('the later commit wins, also when the second browser had not yet heard of the first', async () => {
    const { server, one, two, p1, p2 } = await twoBrowsers((layerId) => [symbolObject(layerId)]);
    const seeded = [...server.objects.values()][0] as MapObject;
    await select(one, seeded.id);
    await select(two, seeded.id);
    two.connection.lagLive = true; // the second browser does not hear of the first's change in time

    await commit(input(p1, 'Name'), 'Alpha');
    expect(input(p2, 'Name').value).toBe(''); // still the old state
    await commit(input(p2, 'Name'), 'Bravo');
    expect(server.requests.map((r) => ('baseVersion' in r ? r.baseVersion : null))).toEqual([1, 1]); // both from version 1
    two.connection.flushLive();
    await settle();

    expect(server.objects.get(seeded.id)?.properties?.name).toBe('Bravo');
    expect(input(p1, 'Name').value).toBe('Bravo');
    expect(input(p2, 'Name').value).toBe('Bravo');
    expect(one.ctx.notifications).toEqual([]);
    expect(two.ctx.notifications).toEqual([]);
  });

  it('different fields from two browsers both survive, because each sends the latest state', async () => {
    const { server, one, two, p1, p2 } = await twoBrowsers((layerId) => [symbolObject(layerId)]);
    const seeded = [...server.objects.values()][0] as MapObject;
    await select(one, seeded.id);
    await select(two, seeded.id);
    await commit(input(p1, 'Name'), 'Alpha');
    await commit(input(p2, 'Higher formation'), '2 Bde');
    const stored = server.objects.get(seeded.id);
    expect(stored?.properties?.name).toBe('Alpha');
    expect(stored?.symbol?.modifiers).toEqual({ higherFormation: '2 Bde' });
    expect(input(p1, 'Higher formation').value).toBe('2 Bde');
    expect(input(p2, 'Name').value).toBe('Alpha');
  });
});

describe('selecting belongs to the map view (M2, brief function 12 and criterion 15)', () => {
  it('sends no selection of its own on a click: the selection is only what the map view or another plugin sets', async () => {
    const { server, one } = await twoBrowsers((layerId) => [symbolObject(layerId)]);
    const [id] = [...server.objects.keys()];
    one.map.setPickResult([id ?? '']);
    act(() => {
      one.map.firePointer({ type: 'click', position: STOCKHOLM, pixel: [10, 10] });
    });
    expect(one.map.selection.value).toEqual([]);
    await select(one, id ?? null);
    expect(one.map.selection.value).toEqual([id]);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(one.map.selection.value).toEqual([id]); // the map view's Escape clears it, not this plugin
    expect(server.requests).toHaveLength(0);
  });

  it('shows the symbol while exactly one is selected, "N objects selected" for several, a hint for none', async () => {
    const { server, one, p1 } = await twoBrowsers((layerId) => [symbolObject(layerId, { properties: { name: 'one' } }), symbolObject(layerId, { properties: { name: 'two' } })]);
    const ids = [...server.objects.keys()];
    expect(p1.properties.getByText('Select a symbol on the map.')).toBeDefined();
    await select(one, ids[0] ?? null);
    expect(input(p1, 'Name').value).toBe('one');
    act(() => {
      one.map.selection.set(ids);
    });
    expect(p1.properties.getByText('2 objects selected')).toBeDefined();
    expect(p1.properties.queryByLabelText('Name')).toBeNull();
    await select(one, ids[1] ?? null);
    expect(input(p1, 'Name').value).toBe('two');
    await select(one, null);
    expect(p1.properties.getByText('Select a symbol on the map.')).toBeDefined();
  });

  it('shows nothing for another kind of object, a shape', async () => {
    const { server, one, p1 } = await twoBrowsers((layerId) => [symbolObject(layerId, { type: 'core.shape', geometry: { type: 'LineString', coordinates: [[10, 20], [11, 21]] } })]);
    await select(one, [...server.objects.keys()][0] ?? null);
    expect(p1.properties.container.textContent).toBe('');
  });
});
