// Shared by the tests: a fake context with the plugin activated, layers and objects of a fake
// server, and the panel rendered.
import { act, render } from '@testing-library/react';
import { MAP_VIEW, OBJECT_LIST, SYMBOLS, uuidv7 } from '@emc2/plugin-sdk';
import type { ChangeEvent, JsonValue, Layer, LayerPage, MapObject, ObjectListService, SecurityLabel, SymbolService, User, Uuid, WorkspaceInfo } from '@emc2/plugin-sdk';
import { createFakeContext, createFakeMapView, createFakeSymbolService, type FakeContext, type FakeMapView } from '@emc2/plugin-sdk/testing';
import manifest from '../../plugin.json' with { type: 'json' };
import plugin from '../src/index.tsx';

export const LABEL: SecurityLabel = { policyIdentifier: { name: 'NATO' }, classification: 'UNCLASSIFIED' };
export const AT = '2026-10-16T12:00:00.000Z';
const BY = { plugin: 'test' };
const BASE_TIME = 1_760_000_000_000;

export function layer(name: string, drawOrder: number): Layer {
  return { id: uuidv7(), version: 1, name, drawOrder, visible: true, label: LABEL, meta: { created: { at: AT, by: BY }, modified: { at: AT, by: BY } } };
}

/** Objects get ids in the order of creation (UUID v7, one millisecond apart), named "<prefix> 001", "<prefix> 002", …. */
export function objectsOf(layerId: Uuid, count: number, prefix = 'Object', first = 0): MapObject[] {
  return Array.from({ length: count }, (_, i) => objectNamed(layerId, `${prefix} ${String(first + i + 1).padStart(3, '0')}`, first + i));
}

export function objectNamed(layerId: Uuid, name: string | undefined, serial: number, extra: Partial<MapObject> = {}): MapObject {
  return {
    id: uuidv7(BASE_TIME + serial),
    version: 1,
    type: 'core.symbol',
    dataType: 'core.general',
    dataSource: 'manual',
    layerId,
    geometry: { type: 'Point', coordinates: [18.07, 59.33] },
    ...(name === undefined ? {} : { properties: { name } }),
    label: LABEL,
    meta: { created: { at: AT, by: BY }, modified: { at: AT, by: BY } },
    ...extra,
  };
}

/** The settings as the shell passes them when nothing is configured: the default of every setting. */
export function settingDefaults(): Record<string, JsonValue> {
  return Object.fromEntries(Object.entries(manifest.settings.properties).map(([name, schema]) => [name, schema.default]));
}

export async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

export interface ActivateOptions {
  /** Default true. Without it the key is in `uses` and no one provides it, as when the map view is not loaded. */
  withMapView?: boolean;
  /** Default false, as for the symbols. */
  withSymbols?: boolean;
  settings?: Record<string, JsonValue>;
  /** The symbol service to provide, when `withSymbols`. */
  symbols?: SymbolService;
  map?: FakeMapView;
  /** The workspaces besides View, and the one shown at the start (default View). */
  workspaces?: readonly WorkspaceInfo[];
  workspace?: string;
  user?: User;
}

export async function activated(options: ActivateOptions = {}): Promise<{ readonly ctx: FakeContext; readonly map: FakeMapView | null }> {
  const withMapView = options.withMapView !== false;
  const withSymbols = options.withSymbols === true;
  const unprovided = manifest.uses.filter((key) => (key === MAP_VIEW.id ? !withMapView : !withSymbols));
  const ctx = createFakeContext({
    pluginId: manifest.id,
    settings: options.settings ?? settingDefaults(),
    provides: manifest.provides,
    uses: unprovided,
    dataTypes: [{ id: 'cot.cot', name: 'Cursor on Target', declaredBy: 'cot', defaults: {} }],
    ...(options.workspaces === undefined ? {} : { workspaces: options.workspaces }),
    ...(options.workspace === undefined ? {} : { workspace: options.workspace }),
    ...(options.user === undefined ? {} : { user: options.user }),
  });
  const map = withMapView ? (options.map ?? createFakeMapView()) : null;
  if (map !== null) ctx.provideAs(MAP_VIEW, map);
  if (withSymbols) ctx.provideAs(SYMBOLS, options.symbols ?? createFakeSymbolService());
  await plugin.activate(ctx);
  await settle();
  return { ctx, map };
}

export function renderPanel(ctx: FakeContext) {
  const Panel = ctx.addedPanels[0]?.panel.component;
  if (!Panel) throw new Error('no panel');
  return render(<Panel />);
}

export interface Fixture {
  readonly ctx: FakeContext;
  /** The fake map view, or null when the fixture has none. */
  readonly map: FakeMapView | null;
  readonly layers: readonly Layer[];
  readonly service: ObjectListService;
}

/** Activates the plugin, gives the fake server the layers and objects, sends the snapshot with the counts and renders the panel. Nothing is opened yet. */
export async function fixture(layers: readonly Layer[], objects: readonly MapObject[], options: ActivateOptions = {}): Promise<Fixture> {
  const { ctx, map } = await activated(options);
  ctx.setServerObjects(objects);
  ctx.setServerLayers(layers.map((l) => l.id));
  renderPanel(ctx);
  act(() => {
    ctx.live.snapshot({ layers: [...layers], objectCounts: countsOf(layers, objects) });
  });
  const service = await ctx.services.get(OBJECT_LIST);
  return { ctx, map, layers, service };
}

export function countsOf(layers: readonly Layer[], objects: readonly MapObject[]): Record<string, number> {
  return Object.fromEntries(layers.map((l) => [l.id, objects.filter((o) => o.layerId === l.id).length]));
}

/** Tells the plugin that the layer's counts changed, as the server does after a batch. */
export function sendCounts(ctx: FakeContext, layers: readonly Layer[], objects: readonly MapObject[]): void {
  act(() => {
    ctx.live.counts(countsOf(layers, objects));
  });
}

export function layerCreated(l: Layer, sequenceNo: number): ChangeEvent {
  return { sequenceNo, requestId: uuidv7(), entityType: 'layer', operation: 'create', entityId: l.id, version: l.version, previousVersion: null, state: l, label: LABEL, at: AT, by: BY };
}

export function layerDeleted(l: Layer, sequenceNo: number): ChangeEvent {
  return { sequenceNo, requestId: uuidv7(), entityType: 'layer', operation: 'delete', entityId: l.id, version: l.version + 1, previousVersion: l.version, state: null, label: LABEL, at: AT, by: BY };
}

/** Holds back every layer query until the test lets it through, so that answers can arrive late or out of order. */
export interface Gate {
  /** The queries asked and not yet answered, oldest first. */
  readonly pending: readonly { readonly page: number; release(): void }[];
  /** Every query ever asked, as the page it wanted. */
  readonly asked: readonly number[];
}

export function gateQueries(ctx: FakeContext): Gate {
  const real = ctx.objects.queryLayer.bind(ctx.objects);
  const pending: { page: number; release(): void }[] = [];
  const asked: number[] = [];
  ctx.objects.queryLayer = (layerId, options) =>
    new Promise<LayerPage>((resolve, reject) => {
      const page = options?.page ?? 0;
      asked.push(page);
      pending.push({
        page,
        release() {
          pending.splice(pending.indexOf(entry), 1);
          real(layerId, options).then(resolve, reject);
        },
      });
      const entry = pending[pending.length - 1] as (typeof pending)[number];
    });
  return { pending, asked };
}
