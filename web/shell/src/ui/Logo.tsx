import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import logoUrl from '../assets/logo.svg';
import logoSource from '../assets/logo.svg?raw';

/** How long the splash stays open unless clicked away (owner, 2026-10-29). */
export const SPLASH_MILLIS = 10_000;

/** Where the splash's lines start growing outward: the middle of the gap between "em" and "cc". */
const GAP_X = 118.5;

/**
 * The logo in the top bar's upper left corner (owner, 2026-10-29), from the owner's SVG in
 * `assets/logo.svg`. A click opens the splash: a pane about 400 px square in the middle of the
 * window that shows the logo drawing itself. It closes after {@link SPLASH_MILLIS}, at once on any
 * click inside or outside it, and on Escape; the focus then goes back to the logo.
 */
export function Logo() {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  return (
    <>
      <button ref={button} type="button" className="product" aria-label="Show the emcc splash" onClick={() => { setOpen(true); }}>
        <img src={logoUrl} alt="" className="product-logo" />
      </button>
      {open && <Splash onClose={close} />}
    </>
  );
}

/**
 * The splash, rebuilt from the owner's `emcc_splash.html` with the logo's own outlines instead of
 * a web font (ADR-0030: nothing from the internet): the two lines grow outward from the gap over
 * 1.8 s, the wordmark fades in over 5.6 s after them, then pulses (`shell-look.css`).
 *
 * A modal `<dialog>` in the browser's top layer, like the SDK's `ConfirmDialog`: above everything,
 * and every click in the window lands on it. Where the browser has no `showModal` (jsdom in
 * tests), it is an open `<dialog>` in the page with the same role, label and keys.
 */
function Splash({ onClose }: { readonly onClose: () => void }) {
  const box = useRef<HTMLDialogElement>(null);
  const modal = useRef(false);
  const latest = useRef(onClose);
  useLayoutEffect(() => {
    latest.current = onClose;
  });
  useLayoutEffect(() => {
    const dialog = box.current;
    if (dialog === null) return undefined;
    modal.current = typeof dialog.showModal === 'function';
    if (modal.current) dialog.showModal();
    else dialog.setAttribute('open', '');
    dialog.focus();
    const onCancel = (e: Event) => {
      e.preventDefault();
      latest.current();
    };
    dialog.addEventListener('cancel', onCancel);
    return () => {
      dialog.removeEventListener('cancel', onCancel);
      if (modal.current && dialog.open) dialog.close();
    };
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => { latest.current(); }, SPLASH_MILLIS);
    return () => { clearTimeout(timer); };
  }, []);
  const { viewBox, lines, paths } = logoArt();
  return (
    <dialog
      ref={box}
      className="splash-backdrop"
      aria-label="emcc splash"
      tabIndex={-1}
      onClick={onClose}
      onKeyDown={(e) => {
        // In the top layer the browser turns Escape into the cancel event above.
        if (e.key === 'Escape' && !modal.current) onClose();
      }}
    >
      <div className="splash">
        <svg viewBox={viewBox} className="splash-art" aria-hidden="true">
          {lines.flatMap((line, i) => [
            <line key={`${String(i)}l`} className="splash-line" x1={GAP_X} y1={line.y} x2={line.x1} y2={line.y} stroke={line.stroke} strokeWidth={line.width} pathLength={1} />,
            <line key={`${String(i)}r`} className="splash-line" x1={GAP_X} y1={line.y} x2={line.x2} y2={line.y} stroke={line.stroke} strokeWidth={line.width} pathLength={1} />,
          ])}
          <g className="splash-wordmark">
            {paths.map((path, i) => <path key={i} d={path.d} fill={path.fill} />)}
          </g>
        </svg>
      </div>
    </dialog>
  );
}

interface LogoArt {
  readonly viewBox: string;
  readonly lines: readonly { readonly x1: number; readonly x2: number; readonly y: number; readonly stroke: string; readonly width: string }[];
  readonly paths: readonly { readonly d: string; readonly fill: string }[];
}

let art: LogoArt | undefined;

/** The logo's lines and letter outlines, read once from `assets/logo.svg`, so the splash draws the same logo. */
function logoArt(): LogoArt {
  if (art !== undefined) return art;
  const svg = new DOMParser().parseFromString(logoSource, 'image/svg+xml').documentElement;
  const number = (e: Element, name: string) => Number(e.getAttribute(name));
  art = {
    viewBox: svg.getAttribute('viewBox') ?? '0 0 241 100',
    lines: [...svg.querySelectorAll('line')].map((l) => ({
      x1: number(l, 'x1'), x2: number(l, 'x2'), y: number(l, 'y1'), stroke: l.getAttribute('stroke') ?? '', width: l.getAttribute('stroke-width') ?? '',
    })),
    paths: [...svg.querySelectorAll('path')].map((p) => ({ d: p.getAttribute('d') ?? '', fill: p.getAttribute('fill') ?? '' })),
  };
  return art;
}
