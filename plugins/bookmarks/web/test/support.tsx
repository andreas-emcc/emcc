// Shared by the component tests: the plugin activated in a fake context with its control rendered.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, vi } from 'vitest';
import { COORDINATES, MAP_VIEW, type Position, type WorkspaceInfo } from '@emc2/plugin-sdk';
import { createFakeContext, createFakeCoordinateService, createFakeMapView, type FakeContext, type FakeMapView } from '@emc2/plugin-sdk/testing';
import manifest from '../../plugin.json' with { type: 'json' };
import plugin from '../src/index.tsx';
import { DOCUMENT_NAME, parseDocument, serialize, type TreeItem } from '../src/tree.ts';

const RING: readonly Position[] = [[-10, 50], [40, 50], [40, 72], [-10, 72], [-10, 50]];

export interface Options {
  readonly maxItems?: number;
  readonly withMap?: boolean;
  readonly withCoordinates?: boolean;
  /** SDK 1.2.0: the workspaces besides View, and the one shown at the start (default View). */
  readonly workspaces?: readonly WorkspaceInfo[];
  readonly workspace?: string;
}

/** The plugin activated in a fake context, its control rendered the way the top bar does. */
export async function setup(options: Options = {}) {
  const ctx = createFakeContext({
    pluginId: manifest.id,
    settings: { maxItems: options.maxItems ?? 1000 },
    uses: manifest.uses,
    ...(options.workspaces === undefined ? {} : { workspaces: options.workspaces }),
    ...(options.workspace === undefined ? {} : { workspace: options.workspace }),
  });
  const map = createFakeMapView({ projections: ['EPSG:3857', 'EPSG:3413'], backgrounds: ['osm', 'naturalearth'] });
  if (options.withMap !== false) ctx.provideAs(MAP_VIEW, map);
  if (options.withCoordinates === true) ctx.provideAs(COORDINATES, createFakeCoordinateService());
  await act(async () => {
    await plugin.activate(ctx);
  });
  const Item = ctx.topBarItems[0]?.component;
  if (!Item) throw new Error('no top bar item');
  render(<Item />);
  return { ctx, map };
}

/** Where the map is: a point with latitude ≠ longitude, so that a swap shows. */
export function showMap(map: FakeMapView, projection: string, background: string, center: Position, resolution: number) {
  map.setMapType({ projection, background });
  map.setViewport({ center, resolution, projection, visibleArea: RING });
}

export const trigger = () => screen.getByRole('button', { name: 'Bookmarks' });

export async function openMenu() {
  fireEvent.click(trigger());
  return screen.findByRole('dialog', { name: 'Bookmarks' });
}

export async function addCurrentView(name?: string) {
  fireEvent.click(await screen.findByRole('button', { name: 'Add bookmark' }));
  if (name !== undefined) fireEvent.change(screen.getByLabelText('Name'), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => {
    expect(screen.queryByLabelText('Name')).toBeNull();
  });
}

/** The tree as stored for the user. */
export function stored(ctx: FakeContext): readonly TreeItem[] {
  const parsed = parseDocument(ctx.storedUserDocuments[DOCUMENT_NAME] ?? null);
  return parsed.kind === 'tree' ? parsed.tree.items : [];
}

/**
 * The real server answers 404 for a document that does not exist, and the browser logs that as an error.
 * The fake answers null, so this records every read of a name that is not stored: the requests that would fail.
 */
export function watchReads(ctx: FakeContext): string[] {
  const failing: string[] = [];
  const get = ctx.userDocuments.get.bind(ctx.userDocuments);
  vi.spyOn(ctx.userDocuments, 'get').mockImplementation((name) => {
    if (!(name in ctx.storedUserDocuments)) failing.push(name);
    return get(name);
  });
  return failing;
}

export function seed(ctx: FakeContext, items: readonly TreeItem[]) {
  return ctx.userDocuments.put(DOCUMENT_NAME, serialize({ items }));
}

export const bookmark = (id: string, name: string, over: Partial<Extract<TreeItem, { type: 'bookmark' }>> = {}): TreeItem => ({
  type: 'bookmark',
  id,
  name,
  mapType: { projection: 'EPSG:3857', background: 'osm' },
  center: [15.25, 62.5],
  resolution: 611.5,
  ...over,
});
