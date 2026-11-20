// Behaviour beyond the acceptance criteria: live updates, refusals, lost answers, double submits,
// the queue per object, the cap on waiting requests, objects that are not point symbols.
import { act, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { changeRequests, OutcomeUnknownError } from '@emc2/plugin-sdk';
import type { MapObject } from '@emc2/plugin-sdk';
import { coreOf, MAX_NAME_LENGTH, MAX_TEXT_LENGTH } from '../src/content.ts';
import { MAX_WAITING } from '../src/controller.ts';
import { symbolObject } from './fakeServer.ts';
import { isolateDocumentListeners, settle, STOCKHOLM } from './harness.tsx';
import { clickMap, commit, dataOf, input, placeAt, select, twoBrowsers } from './scene.tsx';

isolateDocumentListeners();

async function withSymbol() {
  const scene = await twoBrowsers((layerId) => [symbolObject(layerId)]);
  const seeded = [...scene.server.objects.values()][0] as MapObject;
  await select(scene.one, seeded.id);
  await select(scene.two, seeded.id);
  return { ...scene, seeded };
}

describe('live updates (brief, function 8)', () => {
  it('shows what someone else changed: values, the version and who changed it when', async () => {
    const { server, p1, seeded } = await withSymbol();
    expect(p1.properties.getByText('1')).toBeDefined(); // version
    server.changeElsewhere(changeRequests.updateObject(seeded, { ...coreOf(seeded), properties: { name: 'Elsewhere' }, geometry: { type: 'Point', coordinates: [18.0686, 59.3293] } }));
    await settle();
    expect(input(p1, 'Name').value).toBe('Elsewhere');
    expect(input(p1, 'Position (DD)').value).toBe('59.3293 N 18.0686 E');
    expect(p1.properties.getByText('UNCLASSIFIED (NATO)')).toBeDefined();
    expect(p1.properties.getByText('2')).toBeDefined();
    expect(p1.properties.getByText(/by someone-else/)).toBeDefined();
  });

  it('does not overwrite a field the user is editing; the user\'s commit then wins', async () => {
    const { server, p1, seeded } = await withSymbol();
    const name = input(p1, 'Name');
    fireEvent.change(name, { target: { value: 'Dra' } });
    server.changeElsewhere(changeRequests.updateObject(seeded, { ...coreOf(seeded), properties: { name: 'Elsewhere' }, geometry: { type: 'Point', coordinates: [18.0686, 59.3293] } }));
    await settle();
    expect(name.value).toBe('Dra'); // being edited
    expect(input(p1, 'Position (DD)').value).toBe('59.3293 N 18.0686 E'); // not being edited
    fireEvent.keyDown(name, { key: 'Enter' });
    await settle();
    expect(server.objects.get(seeded.id)?.properties?.name).toBe('Dra');
    expect(server.requests.at(-1)).toMatchObject({ baseVersion: 2 });
    expect(name.value).toBe('Dra');
  });

  it('a new snapshot replaces everything: changed values are shown; a missing object stays selected, is read from the server and gives no notice (it may only be outside the area)', async () => {
    const { server, one, p1, seeded } = await withSymbol();
    server.seed({ ...seeded, version: 5, properties: { name: 'From the snapshot' } });
    act(() => {
      server.sendSnapshot(one.ctx);
    });
    expect(input(p1, 'Name').value).toBe('From the snapshot');
    server.deleteSilently(seeded.id);
    act(() => {
      server.sendSnapshot(one.ctx);
    });
    await settle();
    expect(one.map.selection.value).toEqual([seeded.id]);
    expect(one.connection.reads.at(-1)).toEqual([seeded.id]);
    expect(p1.properties.getByText('The selected object no longer exists.')).toBeDefined();
    expect(one.ctx.notifications).toEqual([]);
  });

  it('says "has not arrived yet" while the symbol is read, and shows it when it is read', async () => {
    const { server, lay, one, p1 } = await twoBrowsers();
    const coming = server.seed(symbolObject(lay.id, { properties: { name: 'Late' } }));
    act(() => {
      one.map.selection.set([coming.id]); // another plugin selects it: this plugin holds nothing yet
    });
    expect(p1.properties.getByText('The selected object has not arrived yet.')).toBeDefined();
    await settle();
    await settle();
    expect(input(p1, 'Name').value).toBe('Late');
  });
});

describe('refusals (brief, function 9)', () => {
  it('shows the reason as a notification and keeps the input; the next Enter sends it again', async () => {
    const { server, one, p1 } = await withSymbol();
    one.connection.rejectNext.push('VALIDATION_FAILED');
    const name = input(p1, 'Name');
    await commit(name, 'Alpha');
    expect(one.ctx.notifications).toEqual([{ severity: 'error', message: 'Could not rename the symbol: refused by the test (VALIDATION_FAILED)' }]);
    expect(name.value).toBe('Alpha');
    expect(server.objects.size).toBe(1);
    expect([...server.objects.values()][0]?.properties).toBeUndefined();

    fireEvent.keyDown(name, { key: 'Enter' });
    await settle();
    expect([...server.objects.values()][0]?.properties?.name).toBe('Alpha');
    expect(one.ctx.notifications).toHaveLength(1);
  });

  it('limits what is typed into a text field to the longest the model takes', async () => {
    const { p1 } = await withSymbol();
    const name = input(p1, 'Name');
    fireEvent.change(name, { target: { value: 'n'.repeat(MAX_NAME_LENGTH + 20) } });
    expect(name.value).toHaveLength(MAX_NAME_LENGTH);
    const unique = input(p1, 'Unique designation');
    fireEvent.change(unique, { target: { value: 'u'.repeat(MAX_TEXT_LENGTH + 20) } });
    expect(unique.value).toHaveLength(MAX_TEXT_LENGTH);
  });

  it('shows a refused create and goes on placing', async () => {
    const { server, lay, one, p1 } = await twoBrowsers();
    act(() => {
      one.map.activeLayer.set(lay.id);
    });
    one.connection.rejectNext.push('LAYER_NOT_FOUND');
    await placeAt(one, p1, STOCKHOLM);
    expect(one.ctx.notifications).toEqual([{ severity: 'error', message: 'Could not place the symbol: refused by the test (LAYER_NOT_FOUND)' }]);
    expect(server.objects.size).toBe(0);
    await clickMap(one, [-130.25, -12.5]);
    expect(server.objects.size).toBe(1);
  });

  it('says so when the symbol was deleted by someone else before an edit', async () => {
    const { server, one, p1, seeded } = await withSymbol();
    server.deleteSilently(seeded.id);
    await commit(input(p1, 'Name'), 'Alpha');
    expect(one.ctx.notifications).toEqual([{ severity: 'warning', message: 'The symbol was deleted by someone else, so the change was not made.' }]);
    // The live picture's news of the deletion comes later and is not announced a second time.
    one.ctx.live.changes([
      { sequenceNo: 9, requestId: seeded.id, entityType: 'object', operation: 'delete', entityId: seeded.id, version: 2, previousVersion: 1, state: null, label: seeded.label, at: 'x', by: { plugin: 'p' } },
    ]);
    expect(one.ctx.notifications).toHaveLength(1);
    expect(one.map.selection.value).toEqual([]);
  });

  it('turns an unexpected error into a notification and frees the fields', async () => {
    const { one, p1 } = await withSymbol();
    one.ctx.changes.submit = () => Promise.reject(new Error('boom'));
    await commit(input(p1, 'Name'), 'Alpha');
    expect(one.ctx.notifications).toEqual([{ severity: 'error', message: 'Unexpected error: boom' }]);
    expect(input(p1, 'Name').disabled).toBe(false);
    expect(p1.properties.getByLabelText('Echelon')).toHaveProperty('disabled', false);
  });
});

describe('answers that do not arrive (OutcomeUnknownError)', () => {
  async function placing() {
    const scene = await twoBrowsers();
    act(() => {
      scene.one.map.activeLayer.set(scene.lay.id);
    });
    return scene;
  }

  it('sends a create again with the same id; if the first arrived, ENTITY_EXISTS means it is there and nothing is shown', async () => {
    const { server, one, p1 } = await placing();
    one.connection.unknownNext.push({ arrived: true });
    await placeAt(one, p1, STOCKHOLM);
    expect(server.requests).toHaveLength(2);
    expect(server.requests[1]?.entityId).toBe(server.requests[0]?.entityId);
    expect(dataOf(server.requests[1])).toEqual(dataOf(server.requests[0]));
    expect(server.objects.size).toBe(1);
    expect(one.ctx.notifications).toEqual([]);
  });

  it('creates the object with the second request when the first never arrived', async () => {
    const { server, one, p1 } = await placing();
    one.connection.unknownNext.push({ arrived: false });
    await placeAt(one, p1, STOCKHOLM);
    expect(server.requests).toHaveLength(2);
    expect(server.requests[1]?.entityId).toBe(server.requests[0]?.entityId);
    expect(server.objects.size).toBe(1);
    expect(one.ctx.notifications).toEqual([]);
  });

  it('warns when there is no answer to the second request either', async () => {
    const { server, one, p1 } = await placing();
    one.connection.unknownNext.push({ arrived: false }, { arrived: false });
    await placeAt(one, p1, STOCKHOLM);
    expect(server.requests).toHaveLength(2);
    expect(server.objects.size).toBe(0);
    expect(one.ctx.notifications).toEqual([{ severity: 'warning', message: 'No answer from the server to the request to place the symbol. Look at the map before trying again.' }]);
  });

  it('does not send an update again, warns, and keeps the input', async () => {
    const { server, one, p1 } = await withSymbol();
    one.connection.unknownNext.push({ arrived: false });
    const name = input(p1, 'Name');
    await commit(name, 'Alpha');
    expect(server.requests).toHaveLength(1);
    expect(one.ctx.notifications).toEqual([{ severity: 'warning', message: 'No answer from the server to the request to rename the symbol. Look at the map before trying again.' }]);
    expect(name.value).toBe('Alpha');
  });

  it('the error type is the one the SDK defines', () => {
    expect(new OutcomeUnknownError('x').name).toBe('OutcomeUnknownError');
  });
});

describe('one request at a time', () => {
  it('sends the edits of one object one after the other, each from the state the last one produced', async () => {
    const { server, one, p1, seeded } = await withSymbol();
    one.connection.lagLive = true; // the live picture is slow: only the answers carry the new state
    one.connection.hold = true;
    await commit(input(p1, 'Name'), 'Alpha');
    await commit(input(p1, 'Unique designation'), 'A-1');
    expect(server.requests).toHaveLength(1); // the second waits for the first

    one.connection.release();
    await settle();

    expect(server.requests).toHaveLength(2);
    expect(server.requests[1]).toMatchObject({ baseVersion: 2 });
    expect(dataOf(server.requests[1])).toEqual({ ...coreOf(seeded), properties: { name: 'Alpha' }, symbol: { ...seeded.symbol, modifiers: { uniqueDesignation: 'A-1' } } });
    expect(server.objects.get(seeded.id)?.properties?.name).toBe('Alpha');
    expect(server.objects.get(seeded.id)?.symbol?.modifiers).toEqual({ uniqueDesignation: 'A-1' });
  });

  it('keeps the number of waiting requests below the server limit', async () => {
    const { server, lay, one, p1 } = await twoBrowsers();
    act(() => {
      one.map.activeLayer.set(lay.id);
    });
    one.connection.hold = true;
    await placeAt(one, p1, [0.5, 10.25]);
    for (let i = 1; i < MAX_WAITING + 3; i++) {
      await clickMap(one, [i / 10, 10 + i / 10]);
    }
    expect(one.connection.waiting).toBe(MAX_WAITING);
    expect(server.requests).toHaveLength(MAX_WAITING);
    expect(one.ctx.notifications.filter((n) => n.message.startsWith('Too many changes')).length).toBe(3);

    one.connection.release();
    await settle();
    expect(server.objects.size).toBe(MAX_WAITING);
    // Room again.
    await clickMap(one, [-130.25, -12.5]);
    expect(server.objects.size).toBe(MAX_WAITING + 1);
  });
});

describe('map interactions', () => {
  it('shows one error when the map view fails an interaction, and does not ask again and again', async () => {
    const { lay, one, p1 } = await twoBrowsers();
    act(() => {
      one.map.activeLayer.set(lay.id);
    });
    let asked = 0;
    one.map.pickPoint = () => {
      asked++;
      return Promise.reject(new Error('no map'));
    };
    fireEvent.click(p1.symbols.getByRole('button', { name: 'Infantry' }));
    fireEvent.click(p1.symbols.getByRole('button', { name: 'Place on map' }));
    await settle();
    await settle();
    expect(asked).toBe(1);
    expect(one.ctx.notifications).toEqual([{ severity: 'error', message: 'Unexpected error: no map' }]);
  });

  it('refuses a point beyond the poles', async () => {
    const { server, lay, one, p1 } = await twoBrowsers();
    act(() => {
      one.map.activeLayer.set(lay.id);
    });
    await placeAt(one, p1, [10, 95]);
    expect(server.requests).toHaveLength(0);
    expect(one.ctx.notifications).toEqual([{ severity: 'warning', message: 'That point is outside the valid coordinates.' }]);
  });

  it('Escape stops placing (the map view ends the interaction with null)', async () => {
    const { lay, one, p1 } = await twoBrowsers();
    act(() => {
      one.map.activeLayer.set(lay.id);
    });
    fireEvent.click(p1.symbols.getByRole('button', { name: 'Infantry' }));
    fireEvent.click(p1.symbols.getByRole('button', { name: 'Place on map' }));
    await settle();
    await act(async () => {
      one.map.completeInteraction(null); // Escape: the map view ends the interaction
      await Promise.resolve();
    });
    await settle();
    expect(p1.symbols.getByRole('button', { name: 'Place on map' })).toBeDefined(); // not 'Stop placing' any more: placing stopped
  });

  it('while placing, a click on the map does not select', async () => {
    const { lay, one, p1 } = await twoBrowsers((layerId) => [symbolObject(layerId)]);
    act(() => {
      one.map.activeLayer.set(lay.id);
    });
    fireEvent.click(p1.symbols.getByRole('button', { name: 'Infantry' }));
    fireEvent.click(p1.symbols.getByRole('button', { name: 'Place on map' }));
    one.map.setPickResult(['0192a5c4-3b1e-7c2d-9f00-000000000009']);
    act(() => {
      one.map.firePointer({ type: 'click', position: STOCKHOLM, pixel: [5, 5] });
    });
    expect(one.map.selection.value).toEqual([]);
  });
});

describe('objects that are not point symbols', () => {
  it('shows the facts of a core.symbol that is not a point, offers no editing, and cannot be dragged', async () => {
    const { server, lay, one, p1 } = await twoBrowsers((layerId) => [
      symbolObject(layerId, { geometry: { type: 'LineString', coordinates: [[10, 20], [11, 21]] } }),
    ]);
    const shape = [...server.objects.values()][0] as MapObject;
    await select(one, shape.id);
    expect(p1.properties.getByText(/core\.symbol\) is not a point symbol/)).toBeDefined();
    expect(p1.properties.queryByLabelText('Name')).toBeNull();
    expect(p1.properties.getByText(lay.name)).toBeDefined();
    await act(async () => {
      one.map.completeInteraction([1, 2]); // no drag was asked for
      await Promise.resolve();
    });
    await settle();
    expect(server.requests).toHaveLength(0);
  });

  it('shows a hint when nothing is selected', async () => {
    const { p1 } = await twoBrowsers();
    expect(p1.properties.getByText('Select a symbol on the map.')).toBeDefined();
  });
});
