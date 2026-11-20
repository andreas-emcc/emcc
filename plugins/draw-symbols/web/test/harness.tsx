// Shared test setup: fake browsers (a fake plugin context with fake map view, symbol and coordinate
// services) connected to one fake object store, with the plugin activated in each.
import { act, cleanup, render, type RenderResult } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';
import { COORDINATES, MAP_VIEW, SYMBOLS } from '@emc2/plugin-sdk';
import type { CatalogEntry, SymbolPalette, CoordinateFormat, CoordinateService, DataType, DeclaredField, FieldSet, JsonValue, Position, SecurityLabel, User, WorkspaceInfo } from '@emc2/plugin-sdk';
import { createFakeContext, createFakeMapView, createFakeSymbolService, sharedState, type FakeContext, type FakeMapView } from '@emc2/plugin-sdk/testing';
import manifest from '../../plugin.json' with { type: 'json' };
import { WATCH_GRACE_MS } from '../src/controller.ts';
import plugin from '../src/index.tsx';
import { type Connection, type FakeServer, layer } from './fakeServer.ts';

export { layer };

/** The settings as the shell passes them in SDK v0: the default of every setting. */
export function settingDefaults(): Record<string, JsonValue> {
  return Object.fromEntries(Object.entries(manifest.settings.properties).map(([name, schema]) => [name, schema.default]));
}

export const DEFAULT_LABEL: SecurityLabel = { policyIdentifier: { name: 'NATO' }, classification: 'RESTRICTED' };

/** Stockholm, then a point with other numbers in both axes, so a swapped latitude and longitude cannot pass. */
export const STOCKHOLM: Position = [18.0686, 59.3293];
export const ROUND_TRIP: readonly { readonly format: CoordinateFormat; readonly text: string; readonly position: Position }[] = [
  { format: 'dd', text: '59.3293 N 18.0686 E', position: STOCKHOLM },
  { format: 'dms', text: '59°19′45.5″ N 018°04′06.9″ E', position: [18.0686, 59.3293] },
  { format: 'mgrs', text: '34VCL3862266164', position: [18.0686, 59.3293] },
  { format: 'dd', text: '12.5 S 130.25 W', position: [-130.25, -12.5] },
];

/** A coordinate service double that knows a few texts. The conversions themselves are the coordinates plugin's tests. */
export function createTestCoordinates(): CoordinateService {
  return {
    format(position, format = 'dd') {
      const [lon, lat] = position;
      const known = ROUND_TRIP.find((r) => r.position[0] === lon && r.position[1] === lat && r.format === format);
      return known?.text ?? `${format}:${String(lat)},${String(lon)}`;
    },
    parse(text) {
      const known = ROUND_TRIP.find((r) => r.text === text.trim());
      return known === undefined ? { error: `cannot read "${text}" as a position` } : { position: known.position };
    },
    chosenFormat: sharedState<CoordinateFormat>('dd'),
  };
}

export interface Browser {
  readonly ctx: FakeContext;
  readonly map: FakeMapView;
  readonly coordinates: CoordinateService;
  readonly connection: Connection;
  /** The symbol service of the test kit this browser got (its `renderRequests` say what was drawn). */
  readonly symbols: ReturnType<typeof createFakeSymbolService>;
}

export interface BrowserOptions {
  readonly settings?: Record<string, JsonValue>;
  readonly coordinates?: CoordinateService;
  /** The session's user; by default the no-login user, who has every permission. */
  readonly user?: User;
  /** Data types the loaded plugins declare (`core.general` is always there). */
  readonly dataTypes?: readonly Omit<DataType, 'behaviour'>[];
  /** The workspaces besides View the user may see (SDK 1.2.0), and the one shown at the start (default View). */
  readonly workspaces?: readonly WorkspaceInfo[];
  readonly workspace?: string;
  /** The fields the loaded plugins declare (SDK 1.2.0); without them the plugin shows no fields. */
  readonly declaredFields?: readonly DeclaredField[];
  /** The symbol catalog (default: the test kit's, two land units). */
  readonly entities?: readonly CatalogEntry[];
  /** The standard identities of the catalog (default: the test kit's, friend, hostile, neutral, unknown). */
  readonly identities?: readonly { readonly code: string; readonly name: string }[];
  /** The field sets the loaded plugins declare (SDK 1.4.0); the store of the test knows them too. */
  readonly fieldSets?: readonly FieldSet[];
  /** The symbol palettes the enabled plugins declare (SDK 1.6.0, `ctx.symbolPalettes`). */
  readonly symbolPalettes?: readonly SymbolPalette[];
  /** False: the symbol service's `vesselGroups()` gives no groups (default true, as the test kit's). */
  readonly vessels?: boolean;
}

/** Opens a browser: provides the services, connects it to the store, activates the plugin and sends the first snapshot. */
export async function openBrowser(server: FakeServer, options: BrowserOptions = {}): Promise<Browser> {
  const ctx = createFakeContext({
    pluginId: manifest.id,
    settings: options.settings ?? settingDefaults(),
    defaultLabel: DEFAULT_LABEL,
    ...(options.user !== undefined ? { user: options.user } : {}),
    ...(options.dataTypes !== undefined ? { dataTypes: options.dataTypes } : {}),
    ...(options.workspaces !== undefined ? { workspaces: options.workspaces } : {}),
    ...(options.workspace !== undefined ? { workspace: options.workspace } : {}),
    ...(options.declaredFields !== undefined ? { declaredFields: options.declaredFields } : {}),
    ...(options.fieldSets !== undefined ? { fieldSets: options.fieldSets } : {}),
    ...(options.symbolPalettes !== undefined ? { symbolPalettes: options.symbolPalettes } : {}),
  });
  if (options.fieldSets !== undefined) server.fieldSets = options.fieldSets;
  server.typeSets = Object.fromEntries((options.dataTypes ?? []).flatMap((t) => (t.fieldSets === undefined ? [] : [[t.id, t.fieldSets] as const])));
  const map = createFakeMapView();
  const coordinates = options.coordinates ?? createTestCoordinates();
  ctx.provideAs(MAP_VIEW, map);
  const fake = createFakeSymbolService();
  const symbols = options.vessels === false ? { ...fake, vesselGroups: () => [] } : fake; // required since the 1.5.0 freeze: no groups instead of none
  const { entities, identities } = options;
  ctx.provideAs(SYMBOLS, entities === undefined && identities === undefined ? symbols : {
    ...symbols,
    catalog: () => ({ ...symbols.catalog(), ...(entities === undefined ? {} : { entities }), ...(identities === undefined ? {} : { standardIdentities: identities }) }),
  });
  ctx.provideAs(COORDINATES, coordinates);
  const connection = server.connect(ctx);
  await plugin.activate(ctx);
  await settle();
  act(() => {
    server.sendSnapshot(ctx);
  });
  return { ctx, map, coordinates, connection, symbols: fake };
}

export interface Panels {
  readonly symbols: RenderResult;
  readonly properties: RenderResult;
}

/** Shows the browser's two panels, each in its own container so that several browsers can be on screen. */
export function showPanels(browser: Browser): Panels {
  const mount = (id: string) => {
    const Panel = browser.ctx.addedPanels.find((entry) => entry.panel.id === id)?.panel.component;
    if (!Panel) throw new Error(`no panel ${id}`);
    const container = document.body.appendChild(document.createElement('div'));
    return render(<Panel />, { container });
  };
  return { symbols: mount('draw-symbols-symbols'), properties: mount('draw-symbols-properties') };
}

/** jsdom has no canvas: a recording 2D context stands in (real pixels are the ITA's browser tests). */
export const canvasStub = { clearRect: vi.fn(), drawImage: vi.fn() };

/**
 * The plugin measures the double-click time with `performance.now()`. The tests' clock stands still
 * until {@link advanceClock} moves it, so the gap between two clicks is exactly what a test says and
 * never depends on how fast or how loaded the machine is (a test that waits for real time can be
 * 150 ms late on a busy computer and turn a double-click into two clicks).
 */
let clockOffset = 0;
export function advanceClock(milliseconds: number): void {
  clockOffset += milliseconds;
}

/** The entry module listens to the document's keys and cannot be undone; remove the listeners after each test. */
export function isolateDocumentListeners(): void {
  const added: [string, EventListenerOrEventListenerObject][] = [];
  const real = document.addEventListener.bind(document);
  beforeEach(() => {
    // Only the timers: the grace period after a selection ends (WATCH_GRACE_MS) is moved by advanceGrace, never waited for.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    clockOffset = 0;
    const start = performance.now();
    vi.spyOn(performance, 'now').mockImplementation(() => start + clockOffset);
    canvasStub.clearRect.mockClear();
    canvasStub.drawImage.mockClear();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvasStub as unknown as CanvasRenderingContext2D);
    vi.spyOn(document, 'addEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
      added.push([type, listener]);
      real(type, listener, options);
    });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    for (const [type, listener] of added.splice(0)) document.removeEventListener(type, listener);
    vi.restoreAllMocks();
    document.body.replaceChildren();
    window.localStorage.clear(); // the kept data type belongs to one test
  });
}

/** Moves the grace period after the end of a selection: the area round the symbol ends and the record of it is forgotten. */
export async function advanceGrace(): Promise<void> {
  await act(async () => {
    vi.advanceTimersByTime(WATCH_GRACE_MS + 1);
    await Promise.resolve();
  });
  await settle();
}

/** Lets pending promises (change outcomes, map interactions, service lookups) settle inside act. */
export async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
}
