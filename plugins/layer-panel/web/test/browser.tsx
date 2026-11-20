// Opens the layer panel in a fake browser: a fake plugin context with a fake map view, connected
// to a FakeServer, with the panel rendered into its own container.
import { act, render, within } from '@testing-library/react';
import type { BoundFunctions, queries } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MAP_VIEW, OBJECT_LIST } from '@emc2/plugin-sdk';
import type { ClassificationOrders, SecurityLabel, User, WorkspaceInfo } from '@emc2/plugin-sdk';
import { createFakeContext, createFakeMapView, createFakeObjectListService, type FakeContext, type FakeMapView } from '@emc2/plugin-sdk/testing';
import manifest from '../../plugin.json' with { type: 'json' };
import plugin from '../src/index.tsx';
import { REFERENCE_TITLE } from '../src/LayerPanel.tsx';
import { LABEL, type FakeServer } from './fakeServer.ts';

export interface Browser {
  readonly ctx: FakeContext;
  readonly map: FakeMapView;
  /** The layers `object-list` was asked to open, in order (empty without `objectList`). */
  readonly opened: readonly string[];
  readonly view: BoundFunctions<typeof queries>;
  /** Layer names as listed, top first. */
  listed(): string[];
  /** The names in the reference group "View (reference)", top first (empty without it). */
  referenced(): string[];
  /** The list row of a layer. */
  row(name: string): HTMLElement;
}

/** Lets pending promises (submit outcomes, service lookups) settle inside act. */
export async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}

/** The panel's component, as the shell would render it in its pane. */
export function panelOf(ctx: FakeContext): () => ReactNode {
  const Panel = ctx.addedPanels[0]?.panel.component;
  if (!Panel) throw new Error('no panel');
  return () => <Panel />;
}

export interface BrowserOptions {
  readonly withMapView?: boolean;
  readonly user?: User;
  readonly objectList?: boolean;
  /** The workspaces besides View, and the one shown at the start (SDK 1.2.0). */
  readonly workspaces?: readonly WorkspaceInfo[];
  readonly workspace?: string;
  /** SDK 1.5.0 part 4: the orders (the test kit's NATO order without it, none with null), and the default label (LABEL without it). */
  readonly classifications?: ClassificationOrders;
  readonly defaultLabel?: SecurityLabel;
  /** Runs before the plugin activates, e.g. to register a `ctx.workspace.onChange` listener before the panel's. */
  readonly beforeActivate?: (ctx: FakeContext, map: FakeMapView) => void;
}

/**
 * Without `user`, the no-login user, who has every permission. Without `objectList`, no plugin
 * provides `emc2.object-list`, so the shell's `services.get` rejects at once (a `uses` key).
 */
export async function openBrowser(server: FakeServer, options: BrowserOptions = {}): Promise<Browser> {
  const ctx = createFakeContext({
    pluginId: manifest.id, defaultLabel: options.defaultLabel ?? LABEL, uses: manifest.uses,
    ...(options.classifications !== undefined ? { classifications: options.classifications } : {}),
    ...(options.user ? { user: options.user } : {}),
    ...(options.workspaces ? { workspaces: options.workspaces } : {}),
    ...(options.workspace !== undefined ? { workspace: options.workspace } : {}),
  });
  const map = createFakeMapView();
  const list = createFakeObjectListService();
  if (options.withMapView !== false) ctx.provideAs(MAP_VIEW, map);
  if (options.objectList === true) ctx.provideAs(OBJECT_LIST, list);
  server.connect(ctx);
  options.beforeActivate?.(ctx, map);
  await plugin.activate(ctx);
  await settle();
  act(() => {
    server.sendSnapshot(ctx);
  });
  const Panel = panelOf(ctx);
  const { container } = render(<Panel />);
  const view = within(container);
  // The workspace's own list; the reference group is a list of its own (brief, function 20).
  const rowsOf = (name: string) => {
    const found = view.queryByRole('list', { name });
    return found === null ? [] : within(found).queryAllByRole('listitem');
  };
  const rows = () => rowsOf('Layers');
  const nameOf = (row: HTMLElement) => within(row).queryByRole('button', { name: /^Make .* active$/ })?.textContent ?? '';
  return {
    ctx,
    map,
    opened: list.opened,
    view,
    listed: () => rows().map(nameOf),
    referenced: () => rowsOf(REFERENCE_TITLE).map((r) => r.querySelector('.layer-panel-name')?.textContent ?? ''),
    row(name) {
      const found = rows().find((r) => nameOf(r) === name);
      if (!found) throw new Error(`no row ${name}`);
      return found;
    },
  };
}
