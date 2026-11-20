import { Icon } from '@emc2/plugin-sdk';
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import { SYMBOL_SIZE, type ActionMenu, type Candidate, type MenuEntry } from './menu.ts';

/** The menu stays this far inside the window, in CSS pixels. */
const MARGIN = 8;

/**
 * The shell's menu (`menu.ts`) at the point it was opened, moved into the window. A WAI-ARIA menu:
 * the focus moves to its first item, Up and Down move it (round), Home and End, Enter or Space
 * choose; Escape, Tab and a press outside close it, and the focus goes back where it was (Tab then
 * moves on from there). When the focus leaves it otherwise, it closes and the focus stays there.
 * It is in the browser's top layer (`popover="manual"`), above the panes and the SDK's popovers.
 */
export function ActionMenuView({ menu }: { readonly menu: ActionMenu }) {
  const state = useSyncExternalStore(menu.subscribe, menu.getState);
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  const open = state.kind !== 'closed';
  const n = open ? state.n : 0;

  // Placed at the point and inside the window before it is painted; then the focus on its first
  // item. Where the focus was is kept, and it goes back there when the menu closes.
  useLayoutEffect(() => {
    const element = ref.current;
    if (element === null || state.kind === 'closed') {
      const back = opener.current;
      opener.current = null;
      if (back instanceof HTMLElement && back.isConnected) back.focus();
      return;
    }
    opener.current ??= document.activeElement;
    // In the top layer, as the SDK's popovers (CR-0021); without the feature (jsdom) fixed in the page.
    if (typeof element.showPopover === 'function' && !element.hasAttribute('popover')) {
      element.setAttribute('popover', 'manual');
      element.showPopover();
    }
    const [x, y] = state.at;
    const { width, height } = element.getBoundingClientRect();
    element.style.left = `${String(Math.max(MARGIN, Math.min(x, window.innerWidth - width - MARGIN)))}px`;
    element.style.top = `${String(y + height + MARGIN > window.innerHeight ? Math.max(MARGIN, y - height) : y)}px`;
    (element.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? element).focus();
  }, [state]);

  // A press outside closes it.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && ref.current?.contains(event.target) !== true) menu.close();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => { document.removeEventListener('pointerdown', onPointerDown, true); };
  }, [open, n, menu]);

  if (state.kind === 'closed') return null;

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const to = event.relatedTarget;
    if (to === null || ref.current?.contains(to) === true) return; // another window, or within the menu
    opener.current = null; // the focus stays where it went
    menu.close();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Tab') {
      menu.close(); // the focus goes back to the opener first, and Tab moves on from there
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      menu.close();
      return;
    }
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
    if (items.length === 0) return;
    const at = items.indexOf(document.activeElement as HTMLElement);
    const next = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    items[(next + items.length) % items.length]?.focus();
  };

  return (
    <div ref={ref} className="action-menu" tabIndex={-1} onKeyDown={onKeyDown} onBlur={onBlur} onContextMenu={(e) => { e.preventDefault(); }}>
      {state.kind === 'loading' && <p className="action-menu-note" role="status">Reading the objects…</p>}
      {state.kind === 'actions' && <Entries entries={state.entries} problem={state.problem} menu={menu} />}
      {state.kind === 'choose' && <Choice candidates={state.candidates} menu={menu} />}
    </div>
  );
}

function Entries({ entries, problem, menu }: { readonly entries: readonly MenuEntry[]; readonly problem: string | null; readonly menu: ActionMenu }) {
  return (
    <ul role="menu" aria-label="Actions" className="action-menu-list">
      {problem !== null && <li role="none" className="action-menu-note action-menu-problem">{problem}</li>}
      {problem === null && entries.length === 0 && (
        <li role="menuitem" aria-disabled="true" className="action-menu-item action-menu-none">No actions</li>
      )}
      {entries.map((entry, i) => (
        <MenuLine key={entry.key} separator={i > 0 && entries[i - 1]?.group !== entry.group}>
          <button type="button" role="menuitem" className="action-menu-item" tabIndex={-1} onClick={() => { menu.run(entry.key); }}>
            {entry.icon === undefined ? <span className="action-menu-icon" /> : <Icon icon={entry.icon} />}
            <span>{entry.label}</span>
          </button>
        </MenuLine>
      ))}
    </ul>
  );
}

function MenuLine({ separator, children }: { readonly separator: boolean; readonly children: ReactNode }) {
  return (
    <>
      {separator && <li role="separator" className="action-menu-separator" />}
      <li role="none">{children}</li>
    </>
  );
}

function Choice({ candidates, menu }: { readonly candidates: readonly Candidate[]; readonly menu: ActionMenu }) {
  return (
    <ul role="menu" aria-label="Choose an object" className="action-menu-list">
      <li role="presentation" className="action-menu-note">Choose an object</li>
      {candidates.map((c) => (
        <li key={c.id} role="none">
          <button type="button" role="menuitem" className="action-menu-item" tabIndex={-1} onClick={() => { void menu.choose(c.id); }}>
            <SymbolIcon image={c.symbol} />
            <span className="action-menu-label">{c.label}</span>
            {c.layer !== null && <span className="action-menu-layer">{c.layer}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** An object's symbol, drawn into a small canvas; an empty space of the same size without one. */
function SymbolIcon({ image }: { readonly image: CanvasImageSource | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (canvas === null || image === null) return;
    const context = canvas.getContext('2d');
    if (context === null) return;
    const w = 'width' in image && typeof image.width === 'number' ? image.width : SYMBOL_SIZE;
    const h = 'height' in image && typeof image.height === 'number' ? image.height : SYMBOL_SIZE;
    const scale = Math.min(SYMBOL_SIZE / w, SYMBOL_SIZE / h, 1);
    context.clearRect(0, 0, SYMBOL_SIZE, SYMBOL_SIZE);
    context.drawImage(image, (SYMBOL_SIZE - w * scale) / 2, (SYMBOL_SIZE - h * scale) / 2, w * scale, h * scale);
  }, [image]);
  if (image === null) return <span className="action-menu-icon" aria-hidden="true" />;
  return <canvas ref={ref} className="action-menu-symbol" width={SYMBOL_SIZE} height={SYMBOL_SIZE} aria-hidden="true" />;
}
