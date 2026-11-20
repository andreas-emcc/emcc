// Shared test setup: fake browsers (a fake plugin context with the fake map view) connected to one
// fake object store, with the plugin activated in each.
import { act, cleanup, fireEvent, render, screen, within, type RenderResult } from '@testing-library/react';
import { afterEach } from 'vitest';
import { MAP_VIEW } from '@emc2/plugin-sdk';
import type { DataType, Geometry, JsonValue, SecurityLabel, User, Uuid, Viewport, WorkspaceInfo } from '@emc2/plugin-sdk';
import { createFakeContext, createFakeMapView, type FakeContext, type FakeMapView } from '@emc2/plugin-sdk/testing';
import manifest from '../../plugin.json' with { type: 'json' };
import plugin from '../src/index.tsx';
import { type Connection, type FakeServer } from './fakeServer.ts';

/** The settings as the shell passes them: the default of every setting. */
export function settingDefaults(): Record<string, JsonValue> {
  return Object.fromEntries(Object.entries(manifest.settings.properties).map(([name, schema]) => [name, schema.default]));
}

export const DEFAULT_LABEL: SecurityLabel = { policyIdentifier: { name: 'NATO' }, classification: 'RESTRICTED' };

/** A view of the Indian Ocean: none of the test shapes (Sweden) is in it. */
export const AWAY: Viewport = { center: [100, -30], resolution: 4891.97, projection: 'EPSG:3857', visibleArea: [[90, -40], [110, -40], [110, -20], [90, -20], [90, -40]] };

/** The simulator's workspace, as the shell lists it for a user who may see and edit it. */
export const SIMULATION: WorkspaceInfo = {
  id: 'simulator.simulation',
  name: 'Simulation',
  viewPermission: 'plugin.simulator.view',
  editPermission: 'plugin.simulator.edit',
  order: 1,
};

export interface Browser {
  readonly ctx: FakeContext;
  readonly map: FakeMapView;
  readonly connection: Connection;
}

export interface BrowserOptions {
  readonly settings?: Record<string, JsonValue>;
  /** The session's user; by default the no-login user, who has every permission. */
  readonly user?: User;
  /** Data types the loaded plugins declare (`core.general` is always there). */
  readonly dataTypes?: readonly Omit<DataType, 'behaviour'>[];
  /** The layer that is active; default the first layer of the store, `null` for none. */
  readonly activeLayer?: Uuid | null;
  /** The map shows another part of the world, so no test shape is in its view ("not in view"); default: the view holds the test shapes. */
  readonly viewAway?: boolean;
  /** Objects that are selected already when the plugin activates. */
  readonly selected?: readonly Uuid[];
  /** The workspaces besides View that the user may see (SDK 1.2.0); default none. */
  readonly workspaces?: readonly WorkspaceInfo[];
  /** The workspace shown at the start; default View. */
  readonly workspace?: string;
}

/** Opens a browser: provides the map view, connects it to the store, activates the plugin and sends the first snapshot. */
export async function openBrowser(server: FakeServer, options: BrowserOptions = {}): Promise<Browser> {
  const ctx = createFakeContext({
    pluginId: manifest.id,
    settings: options.settings ?? settingDefaults(),
    defaultLabel: DEFAULT_LABEL,
    ...(options.user !== undefined ? { user: options.user } : {}),
    ...(options.dataTypes !== undefined ? { dataTypes: options.dataTypes } : {}),
    ...(options.workspaces !== undefined ? { workspaces: options.workspaces } : {}),
    ...(options.workspace !== undefined ? { workspace: options.workspace } : {}),
  });
  const map = createFakeMapView();
  ctx.provideAs(MAP_VIEW, map);
  const connection = server.connect(ctx);
  if (options.workspace !== undefined) connection.shown = options.workspace;
  // The fresh snapshots of a switch (step 3) come after the shell's `current` has changed and before the plugin's `onChange`:
  // this listener is registered first, so it runs first.
  ctx.workspace.onChange((workspace) => {
    connection.shown = workspace.id;
    act(() => {
      connection.sendSnapshots();
    });
  });
  if (options.viewAway === true) map.setViewport(AWAY);
  if (options.selected !== undefined) map.selection.set([...options.selected]);
  await plugin.activate(ctx);
  await settle();
  act(() => {
    server.sendSnapshot(ctx);
  });
  const active = options.activeLayer === undefined ? [...server.layers.keys()][0] ?? null : options.activeLayer;
  act(() => {
    map.activeLayer.set(active);
  });
  return { ctx, map, connection };
}

/**
 * The user switches to workspace `id`, in the order of the SDK (`CurrentWorkspace`): the map view's
 * moment (it ends the running interactions and clears the selection; `active` then plays its own
 * bringing back of the workspace's active layer), the fresh snapshots, `onChange`. By default
 * `ctx.workspace.current` is already the new workspace at the moment, as in the shell, where it
 * changes at the switch's first step; with `early: false` it changes later, as in the test kit.
 */
export async function switchTo(browser: Browser, id: string, options: { readonly active?: Uuid | null; readonly early?: boolean } = {}): Promise<void> {
  const real = browser.ctx.workspace;
  const target = browser.ctx.workspaces.find((w) => w.id === id);
  if (target === undefined) throw new Error(`no workspace ${id}`);
  const mutable = browser.ctx as { workspace?: typeof real };
  if (options.early !== false) mutable.workspace = { current: target, onChange: (listener) => real.onChange(listener) };
  act(() => {
    browser.map.switchWorkspace();
    if (options.active !== undefined) browser.map.activeLayer.set(options.active);
  });
  await settle(); // the shell waits for the fresh snapshots, so the interactions that ended at the moment are heard of before `onChange`
  mutable.workspace = real;
  act(() => {
    browser.ctx.switchWorkspace(id);
  });
  await settle();
}

/** Shows one of the browser's panels in its own container, so that several browsers can be on screen. */
export function showPanel(browser: Browser, id: string): RenderResult {
  const added = browser.ctx.addedPanels.find((p) => p.panel.id === id);
  if (added === undefined) throw new Error(`no panel ${id}`);
  const Panel = added.panel.component;
  const container = document.body.appendChild(document.createElement('div'));
  return render(<Panel />, { container });
}

/** The Shapes panel. */
export function showShapesPanel(browser: Browser): RenderResult {
  return showPanel(browser, 'draw-shapes');
}

/** Runs the Edit action for a shape as the shell's menu would, and shows the edit panel it opened. */
export async function editShape(browser: Browser, id: Uuid, actionId = 'edit'): Promise<RenderResult> {
  await act(async () => {
    await browser.ctx.runObjectAction(actionId, [id]);
  });
  await settle();
  return showPanel(browser, 'draw-shapes-edit');
}

export function editPanelOpen(browser: Browser): boolean {
  return browser.ctx.addedPanels.some((p) => p.panel.id === 'draw-shapes-edit');
}

/** The tool button of a kind in the Shapes panel. */
export function toolButton(label: string): HTMLButtonElement {
  return screen.getByRole<HTMLButtonElement>('button', { name: label });
}

/** A text or colour field of a panel by its label. */
export function inputOf(panel: { readonly container: HTMLElement }, label: string): HTMLInputElement {
  return within(panel.container).getByLabelText<HTMLInputElement>(label);
}

/** A list field of a panel by its label. */
export function selectOf(panel: { readonly container: HTMLElement }, label: string): HTMLSelectElement {
  return within(panel.container).getByLabelText<HTMLSelectElement>(label);
}

/** A button of a panel by its name. */
export function buttonOf(panel: { readonly container: HTMLElement }, name: string): HTMLButtonElement {
  return within(panel.container).getByRole<HTMLButtonElement>('button', { name });
}

/** Clicks a tool and lets the drawing service start. */
export async function chooseTool(label: string): Promise<void> {
  fireEvent.click(toolButton(label));
  await settle();
}

/** The user finishes the running drawing (or reshape) with this geometry. */
export async function finishDrawing(browser: Browser, geometry: Geometry | null): Promise<void> {
  act(() => {
    browser.map.completeDrawing(geometry);
  });
  await settle();
}

/** Types into a field and commits it with Enter. */
export async function typeAndEnter(field: HTMLElement, text: string): Promise<void> {
  fireEvent.change(field, { target: { value: text } });
  fireEvent.keyDown(field, { key: 'Enter' });
  await settle();
}

/** Lets pending promises (change outcomes, map interactions, service lookups) settle inside act. */
export async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
}

afterEach(() => {
  cleanup();
  document.body.replaceChildren();
  window.localStorage.clear(); // the kept data type belongs to one test
});
