import { IconButton } from '@emc2/plugin-sdk';
import {
  ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ChevronDown, ChevronRight, PanelBottom, PanelBottomClose, PanelBottomOpen, PanelLeft, PanelLeftClose,
  PanelLeftOpen, PanelRight, PanelRightClose, PanelRightOpen, PanelTop, type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from 'react';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { bottomTabOf, DENSITY_SIZES, fittedSizes, isPanelCollapsed, KEY_STEP, maxSize, MIN_SIZE, PANE_NAMES, paneOf, panelsIn, PANES, type Pane, type Room } from './layout.ts';
import { densityOf } from './theme.ts';
import { MapPane } from './MapPane.tsx';
import { mountKey, panelElementId, revealPanel } from './panels.ts';
import { LiveNotice } from './StatusPanel.tsx';
import type { PanelItem, ShellStore, ShellView } from './store.ts';

/**
 * The View tab's workspace (ADR-0031 point 4): the Map Pane in the middle, the left and right panes
 * beside it at full height, the bottom pane under the map. The panes are docked: the map shrinks
 * and grows with them. A pane without panels is not shown.
 *
 * - Each pane resizes with its handle (pointer, or the arrow keys, Home and End on it) and
 *   collapses to a strip with a button to expand it again.
 * - The left and right panes stack their panels; each collapses on its own. The bottom pane shows
 *   one panel at a time, with a tab for each.
 * - Every panel moves to the other panes, and up and down (in the bottom pane back and forward)
 *   within its pane (owner, 2026-10-16). A panel collapsed, in a collapsed pane or behind another
 *   tab stays mounted, only hidden, so it keeps its state; a move to another pane, or a workspace
 *   switch (`mountKey`), mounts it again.
 *
 * The panes are shown at sizes fitted to the window (`fittedSizes`): the map keeps its least width,
 * also after the window shrinks; the user's sizes come back when it grows again.
 *
 * The right pane keeps its name "Control Pane", which it had before the panes.
 */
export function Workspace({ view, store }: { readonly view: ShellView; readonly store: ShellStore }) {
  const room = useRoom(view);
  const reveal = view.reveal;
  const revealed = useRef(0);
  useEffect(() => {
    // Only a new show() scrolls, not every later change of the panels.
    if (reveal === null || reveal.n === revealed.current) return;
    revealed.current = reveal.n;
    const item = view.panels.find((p) => p.id === reveal.id);
    if (item !== undefined) revealPanel(item.pluginId, item.panel.id);
  }, [reveal, view.panels]);
  return (
    <div className="workspace">
      <SidePane pane="left" view={view} store={store} room={room} />
      <div className="workspace-centre">
        {view.fatal !== null && <p role="alert" className="fatal">{view.fatal}</p>}
        <div className="workspace-map">
          <MapPane view={view} store={store} />
          <LiveNotice state={view.live} />
        </div>
        <BottomPane view={view} store={store} room={room} />
      </div>
      <SidePane pane="right" view={view} store={store} room={room} />
    </div>
  );
}

const PANE_WORDS: Readonly<Record<Pane, string>> = { left: 'the left pane', right: 'the right pane', bottom: 'the bottom pane' };
const MOVE_ICONS: Readonly<Record<Pane, LucideIcon>> = { left: PanelLeft, right: PanelRight, bottom: PanelBottom };
const COLLAPSE_ICONS: Readonly<Record<Pane, LucideIcon>> = { left: PanelLeftClose, right: PanelRightClose, bottom: PanelBottomClose };
const EXPAND_ICONS: Readonly<Record<Pane, LucideIcon>> = { left: PanelLeftOpen, right: PanelRightOpen, bottom: PanelBottomOpen };

type PaneProps = { readonly view: ShellView; readonly store: ShellStore };

const onResize = (listener: () => void) => {
  window.addEventListener('resize', listener);
  return () => { window.removeEventListener('resize', listener); };
};
const windowWidth = () => window.innerWidth;
const windowHeight = () => window.innerHeight;

/** The window's size, followed as it changes, and which panes have panels. */
function useRoom(view: ShellView): Room {
  const width = useSyncExternalStore(onResize, windowWidth);
  const height = useSyncExternalStore(onResize, windowHeight);
  const has = (pane: Pane) => view.panels.some((p) => paneOf(view.layout, p) === pane);
  return { width, height, shown: { left: has('left'), right: has('right'), bottom: has('bottom') }, defaults: DENSITY_SIZES[densityOf(view.look, view.installationLook)] };
}

function SidePane({ pane, view, store, room }: PaneProps & { readonly pane: 'left' | 'right'; readonly room: Room }) {
  const items = panelsIn(view.layout, view.panels, pane);
  if (items.length === 0) return null;
  const state = view.layout.panes[pane];
  const size = fittedSizes(view.layout, room)[pane];
  return (
    <aside
      className={`pane pane-${pane}${state.collapsed ? ' pane-collapsed' : ''}`}
      aria-label={PANE_NAMES[pane]}
      style={state.collapsed ? undefined : { width: size }}
    >
      <PaneToggle pane={pane} collapsed={state.collapsed} store={store} />
      <div className="pane-body" hidden={state.collapsed}>
        {items.map((item, i) => (
          <SidePanel key={mountKey(view.workspace, item)} item={item} first={i === 0} last={i === items.length - 1} pane={pane} view={view} store={store} />
        ))}
      </div>
      {!state.collapsed && <ResizeHandle pane={pane} size={size} room={room} store={store} />}
    </aside>
  );
}

/** A panel's title, cut with "…" when the pane is narrow and shown in full on hover (owner, 2026-10-21). */
function PanelTitle({ title }: { readonly title: string }) {
  return <span className="panel-title-text" title={title}>{title}</span>;
}

function SidePanel({ item, first, last, pane, view, store }: PaneProps & {
  readonly item: PanelItem; readonly first: boolean; readonly last: boolean; readonly pane: 'left' | 'right';
}) {
  const collapsed = isPanelCollapsed(view.layout, item.id);
  const elementId = panelElementId(item.pluginId, item.panel.id);
  const title = item.panel.title;
  return (
    // data-open (T-203): the open panel's state for the look's soft head (ADR-0056 point 4)
    <section id={elementId} className={`panel${collapsed ? ' panel-collapsed' : ''}`} aria-label={title} data-open={collapsed ? undefined : ''}>
      <header className="panel-head">
        <h2 className="panel-title">
          <button
            type="button"
            className="panel-toggle"
            aria-expanded={!collapsed}
            aria-controls={`${elementId}-body`}
            onClick={() => { store.setPanelCollapsed(item.id, !collapsed); }}
          >
            {collapsed ? <ChevronRight className="emc2-icon" aria-hidden="true" /> : <ChevronDown className="emc2-icon" aria-hidden="true" />}
            <PanelIcon item={item} />
            <PanelTitle title={title} />
          </button>
        </h2>
        <div className="panel-moves">
          <IconButton icon={ArrowUp} label={`Move ${title} up`} disabled={first} onClick={() => { store.shiftPanel(item.id, -1); }} />
          <IconButton icon={ArrowDown} label={`Move ${title} down`} disabled={last} onClick={() => { store.shiftPanel(item.id, 1); }} />
          <MoveButtons item={item} pane={pane} store={store} />
        </div>
      </header>
      <div id={`${elementId}-body`} className="panel-body" hidden={collapsed}>
        <PanelContent item={item} store={store} />
      </div>
    </section>
  );
}

function BottomPane({ view, store, room }: PaneProps & { readonly room: Room }) {
  const items = panelsIn(view.layout, view.panels, 'bottom');
  const selected = bottomTabOf(view.layout, view.panels);
  const tabs = useRef<HTMLDivElement>(null);
  if (items.length === 0 || selected === null) return null;
  const state = view.layout.panes.bottom;
  const size = fittedSizes(view.layout, room).bottom;
  const at = items.indexOf(selected);
  const tabId = (item: PanelItem) => `${panelElementId(item.pluginId, item.panel.id)}-tab`;
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const next = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: items.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const item = items[(next + items.length) % items.length] ?? selected;
    store.selectBottomTab(item.id);
    tabs.current?.querySelector<HTMLElement>(`#${tabId(item)}`)?.focus();
  };
  return (
    <aside
      className={`pane pane-bottom${state.collapsed ? ' pane-collapsed' : ''}`}
      aria-label={PANE_NAMES.bottom}
      style={state.collapsed ? undefined : { height: size }}
    >
      {!state.collapsed && <ResizeHandle pane="bottom" size={size} room={room} store={store} />}
      <div className="pane-tabs">
        <PaneToggle pane="bottom" collapsed={state.collapsed} store={store} />
        <div ref={tabs} role="tablist" aria-label="Bottom pane panels" className="bottom-tabs">
          {items.map((item) => (
            <button
              key={item.key}
              id={tabId(item)}
              type="button"
              role="tab"
              aria-selected={item === selected}
              aria-controls={panelElementId(item.pluginId, item.panel.id)}
              tabIndex={item === selected ? 0 : -1}
              className={item === selected ? 'bottom-tab selected' : 'bottom-tab'}
              onClick={() => { store.selectBottomTab(item.id); store.setPaneCollapsed('bottom', false); }}
              onKeyDown={onKeyDown}
            >
              <PanelIcon item={item} />
              <PanelTitle title={item.panel.title} />
            </button>
          ))}
        </div>
        {!state.collapsed && (
          <div className="panel-moves">
            <IconButton icon={ArrowLeft} label={`Move ${selected.panel.title} back`} disabled={at === 0} onClick={() => { store.shiftPanel(selected.id, -1); }} />
            <IconButton icon={ArrowRight} label={`Move ${selected.panel.title} forward`} disabled={at === items.length - 1} onClick={() => { store.shiftPanel(selected.id, 1); }} />
            <MoveButtons item={selected} pane="bottom" store={store} />
          </div>
        )}
      </div>
      {items.map((item) => (
        <section
          key={mountKey(view.workspace, item)}
          id={panelElementId(item.pluginId, item.panel.id)}
          role="tabpanel"
          aria-labelledby={tabId(item)}
          className="panel bottom-panel"
          hidden={state.collapsed || item !== selected}
          data-open={state.collapsed || item !== selected ? undefined : ''}
        >
          <PanelContent item={item} store={store} />
        </section>
      ))}
    </aside>
  );
}

/** The buttons that move a panel to each of the other panes. */
function MoveButtons({ item, pane, store }: { readonly item: PanelItem; readonly pane: Pane; readonly store: ShellStore }) {
  return (
    <>
      {PANES.filter((to) => to !== pane).map((to) => (
        <IconButton key={to} icon={MOVE_ICONS[to]} label={`Move ${item.panel.title} to ${PANE_WORDS[to]}`} onClick={() => { store.movePanel(item.id, to); }} />
      ))}
    </>
  );
}

function PaneToggle({ pane, collapsed, store }: { readonly pane: Pane; readonly collapsed: boolean; readonly store: ShellStore }) {
  return (
    <div className="pane-toggle">
      <IconButton
        icon={collapsed ? EXPAND_ICONS[pane] : COLLAPSE_ICONS[pane]}
        label={`${collapsed ? 'Expand' : 'Collapse'} ${PANE_WORDS[pane]}`}
        onClick={() => { store.setPaneCollapsed(pane, !collapsed); }}
      />
    </div>
  );
}

/**
 * The panel's own icon (`Panel.icon`) before its title; SDK 1.8.0 (CR-0043 part C, "icon always"):
 * a neutral one for a panel without (owner, 2026-11-13: PanelTop), as a 1.7.0 plugin's may be.
 */
function PanelIcon({ item }: { readonly item: PanelItem }) {
  const Icon = item.panel.icon ?? PanelTop;
  return <Icon className="emc2-icon panel-icon" aria-hidden="true" />;
}

/** A plugin's panel component; one that fails makes its plugin DEGRADED, not the shell fail. */
function PanelContent({ item, store }: { readonly item: PanelItem; readonly store: ShellStore }) {
  const Panel = item.panel.component;
  return (
    <ErrorBoundary
      name={item.panel.title}
      onError={(error) => {
        store.observe(item.pluginId, { state: 'DEGRADED', detail: `panel ${item.panel.id} failed: ${error.message}` });
      }}
    >
      <Panel />
    </ErrorBoundary>
  );
}

/**
 * The handle on a pane's inner edge (WAI-ARIA window splitter): drag it, or use the arrow keys
 * towards the map (smaller) and away from it (larger), Home (the smallest) and End (the largest).
 */
function ResizeHandle({ pane, size, room, store }: { readonly pane: Pane; readonly size: number; readonly room: Room; readonly store: ShellStore }) {
  const drag = useRef<{ readonly from: number; readonly size: number } | null>(null);
  const side = pane !== 'bottom';
  const end = () => { drag.current = null; };
  // Which way grows the pane: the left pane's edge goes right, the right pane's left, the bottom pane's up.
  const grow = pane === 'left' ? 1 : -1;
  const at = (event: PointerEvent) => (side ? event.clientX : event.clientY);
  const keys: Readonly<Record<string, number | undefined>> = side
    ? { ArrowRight: grow * KEY_STEP, ArrowLeft: -grow * KEY_STEP }
    : { ArrowUp: KEY_STEP, ArrowDown: -KEY_STEP };
  return (
    <div
      className={`resize-handle resize-${pane}`}
      role="separator"
      tabIndex={0}
      aria-label={`Resize ${PANE_WORDS[pane]}`}
      aria-orientation={side ? 'vertical' : 'horizontal'}
      aria-valuenow={size}
      aria-valuemin={MIN_SIZE}
      aria-valuemax={maxSize(store.getView().layout, pane, room)}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0) return; // the main button only, and one pointer
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { from: at(event), size };
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start !== null) store.setPaneSize(pane, start.size + grow * (at(event) - start.from), room);
      }}
      onPointerUp={(event) => {
        end();
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onKeyDown={(event) => {
        let next: number | undefined;
        if (event.key === 'Home') next = MIN_SIZE;
        else if (event.key === 'End') next = Number.MAX_SAFE_INTEGER;
        else {
          // From the store: keys pressed faster than the page renders all count.
          const by = keys[event.key];
          if (by !== undefined) next = fittedSizes(store.getView().layout, room)[pane] + by;
        }
        if (next === undefined) return;
        event.preventDefault();
        store.setPaneSize(pane, next, room);
      }}
    />
  );
}
