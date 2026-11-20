/**
 * SDK 1.8.0 part E (CR-0044 E3; owner, 2026-11-14, A): a floating window that stays open while the
 * user works elsewhere on the page, e.g. a live video beside the map. Its structure is the SDK's;
 * its look (`components.css`, `.emc2-window` and its parts) is the UXA's.
 *
 * @example
 * <FloatingWindow open={watching} title="Reaper 12" onClose={() => setWatching(false)} defaultSize={{ width: 640, height: 400 }}>
 *   <video ref={video} />
 * </FloatingWindow>
 */
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';

export interface WindowSize {
  readonly width: number;
  readonly height: number;
}

/** The default size of a window without `defaultSize`. */
export const WINDOW_DEFAULT_SIZE: WindowSize = Object.freeze({ width: 480, height: 320 });
/** The default smallest size of a window without `minSize`. */
export const WINDOW_MIN_SIZE: WindowSize = Object.freeze({ width: 240, height: 160 });
/** How far an arrow key moves or resizes a window, and with Shift. */
export const WINDOW_STEP = 10;
export const WINDOW_STEP_SHIFT = 50;
/** How far each further window opens from the one before. */
export const WINDOW_OFFSET = 24;

interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

// The windows open now, for the next one's offset; the open ones, the front one last.
let openCount = 0;
const stack: HTMLElement[] = [];
// Without the top layer the windows stack by z-index, the front one highest.
let zTop = 0;

const viewport = (): WindowSize => ({ width: globalThis.innerWidth, height: globalThis.innerHeight });

/** Keeps a window within the browser window, never below its smallest size unless the browser window is smaller. */
export function clampWindow(box: Box, min: WindowSize, view: WindowSize): Box {
  const width = Math.min(Math.max(box.width, min.width), view.width);
  const height = Math.min(Math.max(box.height, min.height), view.height);
  const left = Math.min(Math.max(box.left, 0), Math.max(view.width - width, 0));
  const top = Math.min(Math.max(box.top, 0), Math.max(view.height - height, 0));
  return { left, top, width, height };
}

const ARROWS: Readonly<Record<string, readonly [number, number]>> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/**
 * A window over the page that stays open while the user works elsewhere on it (unlike `Popover`,
 * which closes on a press outside).
 *
 * - **Moving:** by its title bar, with the pointer, or with the arrow keys while the title bar has
 *   the focus (`WINDOW_STEP`, with Shift `WINDOW_STEP_SHIFT`).
 * - **Resizing:** from its lower right corner, with the pointer or the arrow keys, never below
 *   `minSize` (default `WINDOW_MIN_SIZE`).
 * - **Staying in view:** it stays within the browser window when moved, resized, or when the
 *   browser window is resized (`clampWindow`).
 * - **Several at once:** each opens near the browser window's centre, offset by `WINDOW_OFFSET`
 *   from the one before (back to the centre after 8); the last one opened or pressed is in front.
 * - **Focus:** its title bar takes the focus when it opens, and the focus goes back to where it was
 *   when it closes from inside (its button, Escape).
 * - **Closing:** its close button, or Escape inside it, calls `onClose`.
 * - **Rendering:** in the browser's top layer (`popover="manual"`), so no container clips or covers
 *   it; in jsdom, a plain element. `role="dialog"`, not modal, labelled by its title. No position is
 *   stored in 1.8.0.
 */
export function FloatingWindow(props: {
  readonly open: boolean;
  readonly title: string;
  readonly onClose: () => void;
  readonly children?: ReactNode;
  /** Its size when it opens; default `WINDOW_DEFAULT_SIZE`. */
  readonly defaultSize?: WindowSize;
  /** Its smallest size; default `WINDOW_MIN_SIZE`. */
  readonly minSize?: WindowSize;
}): ReactNode {
  return props.open ? <WindowPanel {...props} /> : null;
}

function WindowPanel(props: {
  readonly title: string;
  readonly onClose: () => void;
  readonly children?: ReactNode;
  readonly defaultSize?: WindowSize;
  readonly minSize?: WindowSize;
}): ReactNode {
  const panel = useRef<HTMLDivElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const min = props.minSize ?? WINDOW_MIN_SIZE;
  const minRef = useRef(min);
  minRef.current = min;
  const [box, setBox] = useState<Box>(() => {
    const size = props.defaultSize ?? WINDOW_DEFAULT_SIZE;
    const view = viewport();
    return clampWindow({ left: (view.width - size.width) / 2, top: (view.height - size.height) / 2, ...size }, min, view);
  });
  const centred = useRef(box);

  useLayoutEffect(() => {
    const element = panel.current;
    if (element === null) return undefined;
    // The slot is taken here, not in the first render, so that windows opened together get their own.
    const offset = (openCount % 8) * WINDOW_OFFSET;
    openCount += 1;
    if (offset > 0) {
      const c = centred.current;
      setBox(clampWindow({ ...c, left: c.left + offset, top: c.top + offset }, minRef.current, viewport()));
    }
    // Set here, not in the markup: without the feature, a [popover] that is not open stays hidden.
    const topLayer = typeof element.showPopover === 'function';
    if (topLayer) {
      element.setAttribute('popover', 'manual');
      element.showPopover();
    }
    else element.style.zIndex = String(++zTop);
    stack.push(element);
    const opener = globalThis.document.activeElement;
    bar.current?.focus({ preventScroll: true });
    const onResize = () => setBox((b) => clampWindow(b, minRef.current, viewport()));
    globalThis.addEventListener('resize', onResize);
    return () => {
      openCount -= 1;
      stack.splice(stack.indexOf(element), 1);
      globalThis.removeEventListener('resize', onResize);
      const focused = globalThis.document.activeElement;
      const hadFocus = focused !== null && (element.contains(focused) || focused === globalThis.document.body);
      if (topLayer && element.isConnected) element.hidePopover();
      if (hadFocus && opener instanceof HTMLElement && opener.isConnected) opener.focus({ preventScroll: true });
    };
  }, []);

  /** Brings it to the front when another window is above it; a press on the front one changes nothing. */
  const toFront = () => {
    const element = panel.current;
    if (element === null || stack[stack.length - 1] === element) return;
    stack.splice(stack.indexOf(element), 1);
    stack.push(element);
    if (typeof element.showPopover === 'function' && element.matches(':popover-open')) {
      // In the top layer the last shown is in front; showing it again moves it there. The press's own
      // focus comes after this (on mousedown), and a focus inside it is given back.
      const focused = globalThis.document.activeElement;
      element.hidePopover();
      element.showPopover();
      if (focused instanceof HTMLElement && element.contains(focused)) focused.focus({ preventScroll: true });
    } else {
      element.style.zIndex = String(++zTop);
    }
  };

  /** Follows the pointer from a press on the title bar (move) or the corner (resize). */
  const drag = (e: ReactPointerEvent<HTMLElement>, resize: boolean) => {
    if (e.button !== 0) return;
    if (!resize && e.target instanceof Element && e.target.closest('button') !== null) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY, box };
    const onMove = (m: globalThis.PointerEvent) => {
      const dx = m.clientX - start.x;
      const dy = m.clientY - start.y;
      const b = start.box;
      setBox(clampWindow(resize ? { ...b, width: b.width + dx, height: b.height + dy } : { ...b, left: b.left + dx, top: b.top + dy }, minRef.current, viewport()));
    };
    const onUp = () => {
      globalThis.removeEventListener('pointermove', onMove);
      globalThis.removeEventListener('pointerup', onUp);
      globalThis.removeEventListener('pointercancel', onUp);
    };
    globalThis.addEventListener('pointermove', onMove);
    globalThis.addEventListener('pointerup', onUp);
    globalThis.addEventListener('pointercancel', onUp);
  };

  /** The arrow keys on the title bar (move) or the corner (resize). */
  const step = (e: KeyboardEvent<HTMLElement>, resize: boolean) => {
    const arrow = ARROWS[e.key];
    if (arrow === undefined) return;
    e.preventDefault();
    const by = e.shiftKey ? WINDOW_STEP_SHIFT : WINDOW_STEP;
    const [dx, dy] = [arrow[0] * by, arrow[1] * by];
    setBox((b) => clampWindow(resize ? { ...b, width: b.width + dx, height: b.height + dy } : { ...b, left: b.left + dx, top: b.top + dy }, min, viewport()));
  };

  return (
    <div
      ref={panel}
      className="emc2-window"
      role="dialog"
      aria-modal="false"
      aria-labelledby={titleId}
      style={{ left: `${box.left}px`, top: `${box.top}px`, width: `${box.width}px`, height: `${box.height}px` }}
      onPointerDownCapture={toFront}
      onKeyDown={(e) => {
        if (e.key === 'Escape') props.onClose();
      }}
    >
      <div
        ref={bar}
        className="emc2-window-title"
        tabIndex={0}
        role="group"
        aria-roledescription="title bar"
        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown"
        aria-label={`Move ${props.title}`}
        onPointerDown={(e) => drag(e, false)}
        onKeyDown={(e) => step(e, false)}
      >
        <span id={titleId} className="emc2-window-title-text">{props.title}</span>
        <button type="button" className="emc2-icon-button" aria-label={`Close ${props.title}`} title="Close" onClick={props.onClose}>
          <X className="emc2-icon" aria-hidden="true" focusable="false" />
        </button>
      </div>
      <div className="emc2-window-body">{props.children}</div>
      <div
        className="emc2-window-resize"
        tabIndex={0}
        role="button"
        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown"
        aria-label={`Resize ${props.title}`}
        onPointerDown={(e) => drag(e, true)}
        onKeyDown={(e) => step(e, true)}
      />
    </div>
  );
}
