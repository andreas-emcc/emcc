// Helpers for the tests that use fake browsers on one fake store.
import { act, fireEvent } from '@testing-library/react';
import type { ChangeRequest, MapObject, MapObjectContent, Position, Uuid } from '@emc2/plugin-sdk';
import { FakeServer, layer } from './fakeServer.ts';
import { advanceClock, openBrowser, settle, showPanels, type Browser, type Panels } from './harness.tsx';

export const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface Scene {
  readonly server: FakeServer;
  readonly lay: ReturnType<typeof layer>;
  readonly one: Browser;
  readonly two: Browser;
  readonly p1: Panels;
  readonly p2: Panels;
}

/** A store with one layer (and the given objects), and two browsers on it, each with its panels. */
export async function twoBrowsers(objects: (layerId: Uuid) => MapObject[] = () => [], lay = layer('Default', 0)): Promise<Scene> {
  const server = new FakeServer([lay]);
  for (const object of objects(lay.id)) server.seed(object);
  const one = await openBrowser(server);
  const two = await openBrowser(server);
  return { server, lay, one, two, p1: showPanels(one), p2: showPanels(two) };
}

/**
 * The map view (or another plugin) selects: the plugin then reads the symbol by id and subscribes to the small area round it, so the
 * panel is filled a few steps later; this waits for them.
 */
export async function select(browser: Browser, id: Uuid | null): Promise<void> {
  act(() => {
    browser.map.selection.set(id === null ? [] : [id]);
  });
  await settle();
  await settle();
}

export function input(panels: Panels, label: string): HTMLInputElement {
  return panels.properties.getByLabelText(label) as HTMLInputElement;
}

/** Types into a field and presses Enter, as a user commits it. */
export async function commit(field: HTMLInputElement, text: string): Promise<void> {
  fireEvent.change(field, { target: { value: text } });
  fireEvent.keyDown(field, { key: 'Enter' });
  await settle();
}

/** Adds a field set with the editor's "+" (SDK 1.5.0): opens its menu and chooses the set by its label. */
export async function addSet(view: { getByRole: (role: string, options: { name: string }) => HTMLElement }, label: string): Promise<void> {
  fireEvent.click(view.getByRole('button', { name: 'Add a field set' }));
  fireEvent.click(view.getByRole('menuitem', { name: label }));
  await settle();
}

export async function choose(element: HTMLElement, value: string): Promise<void> {
  fireEvent.change(element, { target: { value } });
  await settle();
}

/** Picks a symbol, starts placing and clicks the map at a position. */
export async function placeAt(browser: Browser, panels: Panels, position: Position, entity = 'Infantry'): Promise<void> {
  fireEvent.click(panels.symbols.getByRole('button', { name: entity }));
  if (browser.map.activeLayer.value === null) throw new Error('no active layer');
  if (panels.symbols.queryByRole('button', { name: 'Place on map' }) !== null) fireEvent.click(panels.symbols.getByRole('button', { name: 'Place on map' }));
  await settle();
  await act(async () => {
    browser.map.completeInteraction(position);
    await Promise.resolve();
  });
  await settle();
}

/** One more click on the map while placing, `gapMs` after the last one (the double-click time is 500 ms). */
export async function clickMap(browser: Browser, position: Position, gapMs = 1000): Promise<void> {
  advanceClock(gapMs);
  await act(async () => {
    browser.map.completeInteraction(position);
    await Promise.resolve();
  });
  await settle();
}

export function dataOf(request: ChangeRequest | undefined): MapObjectContent {
  if (!request || !('data' in request) || request.entityType !== 'object') throw new Error('not an object create or update');
  return request.data;
}

