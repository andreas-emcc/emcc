import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Workspace } from './Workspace.tsx';
import { DEFAULT_SIZES, KEY_STEP, MIN_MAP_WIDTH, MIN_SIZE } from './layout.ts';
import { pluginEntry } from '../testing/fakes.ts';
import { panelElementId } from './panels.ts';
import { ShellStore } from './store.ts';

/** A panel with its own state, to see that hiding it keeps it mounted. */
function Counter() {
  const [n, setN] = useState(0);
  return <button type="button" onClick={() => { setN(n + 1); }}>{`clicked ${String(n)}`}</button>;
}

function show(store: ShellStore) {
  const Shown = () => <Workspace view={store.getView()} store={store} />;
  const view = render(<Shown />);
  store.subscribe(() => { view.rerender(<Shown />); });
  return view;
}

const pane = (name: string) => screen.getByRole('complementary', { name });
const titles = (name: string) => within(pane(name)).queryAllByRole('heading', { level: 2 }).map((h) => h.textContent);

beforeEach(() => {
  vi.stubGlobal('fetch', () => new Promise(() => undefined)); // the map pane and status ask, and never hear
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  for (const name of ['scrollIntoView', 'setPointerCapture', 'hasPointerCapture', 'releasePointerCapture']) Reflect.deleteProperty(Element.prototype, name);
});

describe('the panes and the density (looks.md; owner, 2026-10-17)', () => {
  it("take the density's default sizes until the user resizes them; a size the user set stays", () => {
    const store = new ShellStore();
    store.addPanel('layers', { id: 'list', title: 'Layers', component: () => <p>layers</p> }, 'left');
    store.addPanel('draw', { id: 'symbols', title: 'Symbols', component: () => <p>symbols</p> }, 'right');
    show(store);
    const width = (pane: 'left' | 'right') => screen.getByRole('separator', { name: `Resize the ${pane} pane` }).getAttribute('aria-valuenow');
    expect([width('left'), width('right')]).toEqual(['248', '288']);
    act(() => { store.setLook({ look: 'default', scheme: 'system', density: 'comfortable' }); });
    expect([width('left'), width('right')]).toEqual(['268', '312']);
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize the left pane' }), { key: 'ArrowRight' });
    act(() => { store.setLook({ look: 'default', scheme: 'system', density: 'compact' }); });
    expect([width('left'), width('right')]).toEqual([String(268 + KEY_STEP), '288']);
    act(() => { store.setInstallationLook('chart-room'); store.setLook({ look: 'default', scheme: 'system', density: 'look' }); });
    expect(width('right')).toBe('312'); // Chart Room is comfortable
  });
});

describe('the workspace (ADR-0031 point 4)', () => {
  function withPanels() {
    const store = new ShellStore();
    store.addPanel('layers', { id: 'list', title: 'Layers', component: () => <p>layers</p> }, 'left');
    store.addPanel('draw', { id: 'symbols', title: 'Symbols', order: 10, component: Counter }, 'right');
    store.addPanel('coords', { id: 'go', title: 'Go to', component: () => <p>go</p> });
    store.addPanel('objects', { id: 'table', title: 'Objects', component: () => <p>objects</p> }, 'bottom');
    store.addPanel('log', { id: 'lines', title: 'Log', component: () => <p>log</p> }, 'bottom');
    show(store);
    return store;
  }

  it('puts each panel in its default pane; addControlPanel is the right pane, and a pane without panels is not there', () => {
    const store = new ShellStore();
    store.addPanel('coords', { id: 'go', title: 'Go to', component: () => <p>go</p> });
    show(store);
    expect(titles('Control Pane')).toEqual(['Go to']);
    expect(screen.queryByRole('complementary', { name: 'Left pane' })).toBeNull();
    expect(screen.queryByRole('complementary', { name: 'Bottom pane' })).toBeNull();
    cleanup();
    withPanels();
    expect(titles('Left pane')).toEqual(['Layers']);
    expect(titles('Control Pane')).toEqual(['Symbols', 'Go to']);
    expect(within(pane('Bottom pane')).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Objects', 'Log']);
  });

  it('moves a panel to another pane with its buttons, and up and down within its pane', () => {
    withPanels();
    fireEvent.click(screen.getByRole('button', { name: 'Move Go to to the left pane' }));
    expect(titles('Left pane')).toEqual(['Layers', 'Go to']);
    expect(titles('Control Pane')).toEqual(['Symbols']);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Move Layers up' }).disabled).toBe(true);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Move Go to down' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Move Go to up' }));
    expect(titles('Left pane')).toEqual(['Go to', 'Layers']);
    fireEvent.click(screen.getByRole('button', { name: 'Move Symbols to the bottom pane' }));
    expect(screen.queryByRole('complementary', { name: 'Control Pane' })).toBeNull(); // nothing left there
    const bottom = pane('Bottom pane');
    expect(within(bottom).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Objects', 'Log', 'Symbols']);
    expect(within(bottom).getByRole('tab', { selected: true }).textContent).toBe('Symbols');
    fireEvent.click(within(bottom).getByRole('button', { name: 'Move Symbols back' }));
    expect(within(bottom).getAllByRole('tab').map((t) => t.textContent)).toEqual(['Objects', 'Symbols', 'Log']);
  });

  it('collapses a panel and a pane, and keeps what is hidden mounted, with its state', () => {
    const store = withPanels();
    // Every panel starts collapsed (T-153), its component mounted all the same.
    const toggle = screen.getByRole('button', { name: 'Symbols', expanded: false });
    const body = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(body?.hidden).toBe(true);
    expect(screen.getByRole('button', { name: 'Layers', expanded: false })).toBeDefined();
    fireEvent.click(toggle);
    expect(store.getView().layout.expanded).toEqual(['draw/symbols']);
    fireEvent.click(screen.getByRole('button', { name: 'clicked 0' }));
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(body?.hidden).toBe(true);
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'clicked 1' })).toBeDefined(); // the same component, not a new one

    fireEvent.click(screen.getByRole('button', { name: 'Collapse the right pane' }));
    expect(store.getView().layout.panes.right.collapsed).toBe(true);
    expect(pane('Control Pane').style.width).toBe('');
    expect(screen.queryByRole('separator', { name: 'Resize the right pane' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Expand the right pane' }));
    expect(screen.getByRole('button', { name: 'clicked 1' })).toBeDefined();
  });

  it('shows one bottom panel at a time; the arrow keys choose the tab and move the focus', () => {
    withPanels();
    const bottom = pane('Bottom pane');
    const panelOf = (title: string) => within(bottom).getByText(title.toLowerCase()).closest('section');
    expect(panelOf('Objects')?.hidden).toBe(false);
    expect(panelOf('Log')?.hidden).toBe(true);
    const first = within(bottom).getByRole('tab', { name: 'Objects' });
    expect(first.getAttribute('aria-controls')).toBe(panelElementId('objects', 'table'));
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    const second = within(bottom).getByRole('tab', { name: 'Log' });
    expect(second.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(second);
    expect(panelOf('Log')?.hidden).toBe(false);
    fireEvent.keyDown(second, { key: 'ArrowRight' }); // round to the first
    expect(within(bottom).getByRole('tab', { selected: true }).textContent).toBe('Objects');
    fireEvent.keyDown(within(bottom).getByRole('tab', { name: 'Objects' }), { key: 'End' });
    expect(within(bottom).getByRole('tab', { selected: true }).textContent).toBe('Log');
    fireEvent.keyDown(within(bottom).getByRole('tab', { name: 'Log' }), { key: 'Home' });
    expect(within(bottom).getByRole('tab', { selected: true }).textContent).toBe('Objects');
  });

  it('moves the bottom panel shown back, forward and to another pane; a tab of a collapsed bottom pane expands it', () => {
    const store = withPanels();
    const bottom = () => pane('Bottom pane');
    const tabs = () => within(bottom()).getAllByRole('tab').map((t) => t.textContent);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Move Objects back' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Move Objects forward' }));
    expect(tabs()).toEqual(['Log', 'Objects']);
    expect(screen.getByRole<HTMLButtonElement>('button', { name: 'Move Objects forward' }).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Move Objects to the right pane' }));
    expect(tabs()).toEqual(['Log']);
    expect(titles('Control Pane')).toEqual(['Symbols', 'Go to', 'Objects']);

    fireEvent.click(screen.getByRole('button', { name: 'Collapse the bottom pane' }));
    expect(store.getView().layout.panes.bottom.collapsed).toBe(true);
    expect(within(bottom()).getByText('log').closest('section')?.hidden).toBe(true);
    fireEvent.click(within(bottom()).getByRole('tab', { name: 'Log' }));
    expect(store.getView().layout.panes.bottom.collapsed).toBe(false);
    expect(within(bottom()).getByText('log').closest('section')?.hidden).toBe(false);
  });

  it('a panel that fails in any pane makes its plugin DEGRADED; the pane and the other panels stay', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const store = new ShellStore();
    store.setPlugins([pluginEntry('bad'), pluginEntry('good')]);
    store.addPanel('bad', { id: 'broken', title: 'Broken', component: () => { throw new Error('no'); } }, 'bottom');
    store.addPanel('good', { id: 'fine', title: 'Fine', component: () => <p>fine</p> }, 'bottom');
    show(store);
    expect(within(pane('Bottom pane')).getByRole('alert').textContent).toBe('Broken failed: no');
    fireEvent.click(within(pane('Bottom pane')).getByRole('tab', { name: 'Fine' }));
    expect(within(pane('Bottom pane')).getByText('fine')).toBeDefined();
    expect(store.getView().plugins.find((p) => p.id === 'bad')?.observed).toEqual({ state: 'DEGRADED', detail: 'panel broken failed: no' });
    vi.restoreAllMocks();
  });

  it("shows a panel's icon before its title, on its head and on its tab", () => {
    const store = new ShellStore();
    const Icon = (props: Record<string, unknown>) => <svg {...props} data-testid="icon" />;
    store.addPanel('a', { id: 'side', title: 'Side', icon: Icon as never, component: () => null }, 'left');
    store.addPanel('b', { id: 'low', title: 'Low', icon: Icon as never, component: () => null }, 'bottom');
    show(store);
    expect(within(screen.getByRole('button', { name: 'Side', expanded: false })).getByTestId('icon').getAttribute('aria-hidden')).toBe('true');
    expect(within(screen.getByRole('tab', { name: 'Low' })).getByTestId('icon')).toBeDefined();
  });

  it('marks the open panels, in the side panes and the bottom pane, for the look (T-203)', () => {
    const store = new ShellStore();
    store.addPanel('a', { id: 'one', title: 'One', component: () => null }, 'left');
    store.addPanel('a', { id: 'two', title: 'Two', component: () => null }, 'left');
    store.addPanel('b', { id: 'low', title: 'Low', component: () => null }, 'bottom');
    store.addPanel('b', { id: 'other', title: 'Other', component: () => null }, 'bottom');
    show(store);
    const open = () => [...document.querySelectorAll('.panel[data-open]')].map((p) => p.getAttribute('aria-label') ?? p.getAttribute('aria-labelledby'));
    fireEvent.click(screen.getByRole('button', { name: 'One', expanded: false }));
    expect(open()).toHaveLength(2);
    expect(screen.getByRole('region', { name: 'One' }).hasAttribute('data-open')).toBe(true);
    expect(screen.getByRole('region', { name: 'Two' }).hasAttribute('data-open'), 'collapsed').toBe(false);
    const low = screen.getByRole('tabpanel', { name: 'Low' });
    expect(low.hasAttribute('data-open'), "the bottom pane's shown panel").toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'One', expanded: true }));
    expect(screen.getByRole('region', { name: 'One' }).hasAttribute('data-open')).toBe(false);
  });

  it('draws a neutral icon for a panel without one (SDK 1.8.0 part C)', () => {
    const store = new ShellStore();
    store.addPanel('a', { id: 'side', title: 'Side', component: () => null }, 'left');
    store.addPanel('b', { id: 'low', title: 'Low', component: () => null }, 'bottom');
    show(store);
    for (const control of [screen.getByRole('button', { name: 'Side', expanded: false }), screen.getByRole('tab', { name: 'Low' })]) {
      const icon = control.querySelector('svg.panel-icon');
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
      expect(icon?.classList.contains('lucide-panel-top'), "Lucide's PanelTop").toBe(true);
    }
  });

  it('gives a panel title its own box, which CSS cuts with "…", with the full text as its title', () => {
    const store = new ShellStore();
    const long = 'Objects of the layer Reconnaissance North';
    store.addPanel('a', { id: 'side', title: long, component: () => null }, 'left');
    store.addPanel('b', { id: 'low', title: long, component: () => null }, 'bottom');
    show(store);
    for (const control of [screen.getByRole('button', { name: long, expanded: false }), screen.getByRole('tab', { name: long })]) {
      const text = control.querySelector('.panel-title-text');
      expect(text?.textContent).toBe(long);
      expect(text?.getAttribute('title')).toBe(long); // the name stays the title alone
    }
  });

  it('resizes a pane with the arrow keys, Home and End on its handle, each pane growing away from the map', () => {
    const store = withPanels();
    const size = (name: 'left' | 'right' | 'bottom') => store.getView().layout.panes[name].size ?? DEFAULT_SIZES[name];
    const left = screen.getByRole('separator', { name: 'Resize the left pane' });
    expect(left.getAttribute('aria-orientation')).toBe('vertical');
    fireEvent.keyDown(left, { key: 'ArrowRight' });
    expect(size('left')).toBe(248 + KEY_STEP);
    expect(pane('Left pane').style.width).toBe(`${String(248 + KEY_STEP)}px`);
    fireEvent.keyDown(screen.getByRole('separator', { name: 'Resize the right pane' }), { key: 'ArrowLeft' });
    expect(size('right')).toBe(288 + KEY_STEP);
    const bottom = screen.getByRole('separator', { name: 'Resize the bottom pane' });
    expect(bottom.getAttribute('aria-orientation')).toBe('horizontal');
    fireEvent.keyDown(bottom, { key: 'ArrowUp' });
    expect(size('bottom')).toBe(170 + KEY_STEP);
    act(() => { // two keys before the next render: both count
      left.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
      left.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    });
    expect(size('left')).toBe(248 - KEY_STEP);
    fireEvent.keyDown(left, { key: 'Home' });
    expect(size('left')).toBe(MIN_SIZE);
    fireEvent.keyDown(left, { key: 'End' });
    expect(size('left')).toBe(window.innerWidth - MIN_MAP_WIDTH - size('right')); // the map keeps its width
    expect(left.getAttribute('aria-valuenow')).toBe(String(size('left')));
  });

  it('resizes a pane by dragging its handle', () => {
    const captured = new Set<number>();
    Element.prototype.setPointerCapture = function setPointerCapture(id: number) { captured.add(id); };
    Element.prototype.hasPointerCapture = function hasPointerCapture(id: number) { return captured.has(id); };
    Element.prototype.releasePointerCapture = function releasePointerCapture(id: number) { captured.delete(id); };
    const store = withPanels();
    const handle = screen.getByRole('separator', { name: 'Resize the right pane' });
    const size = () => store.getView().layout.panes.right.size;
    const primary = { pointerId: 1, isPrimary: true, button: 0 };
    fireEvent.pointerDown(handle, { ...primary, clientX: 700 });
    fireEvent.pointerMove(handle, { ...primary, clientX: 650 }); // 50 px towards the map's side: wider
    expect(size()).toBe(288 + 50);
    fireEvent.pointerUp(handle, { ...primary, clientX: 650 });
    fireEvent.pointerMove(handle, { ...primary, clientX: 600 }); // no longer dragging
    expect(size()).toBe(288 + 50);
    expect(captured.size).toBe(0);

    // A cancelled pointer (a touch the browser took over) or a lost capture ends the drag too.
    fireEvent.pointerDown(handle, { ...primary, clientX: 700 });
    fireEvent.pointerCancel(handle, primary);
    fireEvent.pointerMove(handle, { ...primary, clientX: 600 });
    fireEvent.pointerDown(handle, { ...primary, clientX: 700 });
    fireEvent.lostPointerCapture(handle, primary);
    fireEvent.pointerMove(handle, { ...primary, clientX: 600 });
    expect(size()).toBe(288 + 50);
    // Only the main button of the main pointer drags.
    fireEvent.pointerDown(handle, { ...primary, button: 2, clientX: 700 });
    fireEvent.pointerMove(handle, { ...primary, clientX: 600 });
    fireEvent.pointerDown(handle, { ...primary, isPrimary: false, clientX: 700 });
    fireEvent.pointerMove(handle, { ...primary, clientX: 600 });
    expect(size()).toBe(288 + 50);
  });

  it('keeps the map its width when the window shrinks, and gives the panes their sizes back when it grows', () => {
    const store = withPanels();
    act(() => { store.setPaneSize('right', 600, { width: 3000, height: 800, shown: { left: true, right: true, bottom: true } }); });
    const width = () => pane('Control Pane').style.width;
    expect(width()).toBe(`${String(window.innerWidth - MIN_MAP_WIDTH - 248)}px`); // 1024: fitted
    const original = window.innerWidth;
    try {
      act(() => { Object.defineProperty(window, 'innerWidth', { configurable: true, value: 2000 }); window.dispatchEvent(new Event('resize')); });
      expect(width()).toBe('600px'); // the user's size again
      act(() => { Object.defineProperty(window, 'innerWidth', { configurable: true, value: 700 }); window.dispatchEvent(new Event('resize')); });
      expect(width()).toBe(`${String(MIN_SIZE)}px`);
      expect(pane('Left pane').style.width).toBe(`${String(700 - MIN_MAP_WIDTH - MIN_SIZE)}px`);
    } finally {
      act(() => { Object.defineProperty(window, 'innerWidth', { configurable: true, value: original }); window.dispatchEvent(new Event('resize')); });
    }
  });

  it("show() expands a panel's pane and the panel, chooses its tab, and scrolls it into view", () => {
    const scrolled = vi.fn<(options?: ScrollIntoViewOptions) => void>();
    Element.prototype.scrollIntoView = scrolled;
    const store = withPanels();
    act(() => { store.setPanelCollapsed('coords/go', true); store.setPaneCollapsed('right', true); });

    act(() => { store.showPanel('coords/go'); });

    expect(screen.getByRole('button', { name: 'Go to', expanded: true })).toBeDefined();
    expect(scrolled).toHaveBeenCalledOnce();
    expect(scrolled.mock.contexts[0]).toBe(document.getElementById(panelElementId('coords', 'go')));
    expect(scrolled.mock.calls[0]?.[0]).toEqual({ block: 'nearest' });
    act(() => { store.showPanel('log/lines'); });
    expect(within(pane('Bottom pane')).getByRole('tab', { selected: true }).textContent).toBe('Log');
    expect(scrolled).toHaveBeenCalledTimes(2);
    act(() => { store.showPanel('gone/x'); }); // no such panel: nothing happens
    act(() => { store.movePanel('coords/go', 'left'); }); // a later change does not scroll again
    expect(scrolled).toHaveBeenCalledTimes(2);
  });
});

describe('the panes across a workspace switch (ADR-0039; T-080)', () => {
  it("unmounts the old workspace's panels and overlays and mounts the new one's, also those in both (CurrentWorkspace step 1)", () => {
    const store = new ShellStore();
    const sim = { id: 'simulator.simulation', name: 'Simulation', viewPermission: 'v', editPermission: 'e', order: 10 };
    store.setWorkspaces([sim]);
    const seen: string[] = [];
    const Tracked = (name: string) => function Tracked() {
      useEffect(() => {
        seen.push(`mount ${name}`);
        return () => { seen.push(`unmount ${name}`); };
      }, []);
      return <p>{name}</p>;
    };
    store.addPanel('layer-panel', { id: 'layers', title: 'Layers', component: Counter, workspaces: ['*'] }, 'left');
    store.addPanel('object-list', { id: 'objects', title: 'Objects', component: Tracked('objects'), workspaces: ['*'] }, 'bottom');
    store.addPanel('bookmarks', { id: 'marks', title: 'Bookmarks', component: Tracked('marks') }, 'left');
    store.addOverlay('coordinates', { id: 'cursor', position: 'bottom-left', component: Tracked('cursor'), workspaces: ['*'] });
    show(store);
    // Panels start collapsed (T-153); a collapsed panel is mounted all the same.
    fireEvent.click(screen.getByRole('button', { name: 'clicked 0', hidden: true }));
    seen.length = 0;

    act(() => { store.setWorkspace(sim.id); });

    expect(titles('Left pane')).toEqual(['Layers']);
    expect(screen.getByRole('button', { name: 'clicked 0', hidden: true })).toBeTruthy(); // mounted again: its state starts afresh
    expect(seen.filter((s) => s.startsWith('unmount')).sort()).toEqual(['unmount cursor', 'unmount marks', 'unmount objects']);
    expect(seen.filter((s) => s.startsWith('mount')).sort()).toEqual(['mount cursor', 'mount objects']);
    expect(seen.indexOf('unmount objects')).toBeLessThan(seen.indexOf('mount objects')); // the old one goes first
  });
});
