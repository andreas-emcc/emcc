import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Crosshair, X } from 'lucide-react';
import { IconButton, type CoordinateService, type CurrentWorkspace, type MapView, type SharedState } from '@emc2/plugin-sdk';
import { CoordinatesPanel } from './CoordinatesPanel.tsx';
import type { OpenStore } from './openStore.ts';
import type { Settings } from './settings.ts';

/** The icon's and the window's name, and what the ITA's tests look for. */
export const GOTO_LABEL = 'Coordinates';

/**
 * A Map Pane overlay at the top right, after the map view's "Map controls" (brief function 8): one
 * icon button that opens a window with the format choice and "Go to". The close button, Escape in
 * it, or a press outside it closes it, and the focus goes back to the icon; open or closed is
 * remembered per browser. The window stays open after "Go", with its message (owner, 2026-10-30).
 *
 * T-162 (owner, 2026-11-10): the window opens as the map view's map settings window does, in the
 * icon's place in the corner, so it grows to the left over the map; the icon is hidden meanwhile.
 */
export function GoToControl(props: {
  readonly service: CoordinateService;
  readonly mapView: SharedState<MapView | null>;
  readonly settings: SharedState<Settings>;
  readonly workspace: CurrentWorkspace;
  readonly openStore: OpenStore;
}) {
  const { openStore } = props;
  const [open, setOpen] = useState(() => openStore.load());
  // After the user opens or closes it, the focus goes to the format choice or back to the icon.
  const moved = useRef(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!moved.current) return undefined;
    moved.current = false;
    if (open) {
      box.current?.querySelector('select')?.focus();
      return;
    }
    // A press outside may have put the focus on what it pressed; it stays there. A press on something
    // that takes no focus (the map) has left it on the page by now, as the window closes after the press.
    const focused = globalThis.document.activeElement;
    if (focused === null || focused === globalThis.document.body || anchor.current?.contains(focused) === true) anchor.current?.querySelector('button')?.focus();
  }, [open]);
  const show = (next: boolean) => {
    moved.current = true;
    openStore.save(next);
    setOpen(next);
  };
  // A press outside the window closes it (the icon is hidden meanwhile, so every press outside the
  // window counts). It closes once the press has ended and its click has landed: closing at once
  // would move the display settings icon below it up before the click, which would then miss it
  // (owner, 2026-11-10).
  useEffect(() => {
    if (!open) return undefined;
    let later: ReturnType<typeof globalThis.setTimeout> | undefined;
    const close = () => {
      globalThis.document.removeEventListener('pointerup', close, true);
      globalThis.document.removeEventListener('pointercancel', close, true);
      later = globalThis.setTimeout(() => {
        moved.current = true;
        openStore.save(false);
        setOpen(false);
      }, 0);
    };
    const onPointerDown = (event: Event) => {
      if (!(event.target instanceof Node) || box.current?.contains(event.target) === true) return;
      globalThis.document.addEventListener('pointerup', close, true);
      globalThis.document.addEventListener('pointercancel', close, true);
    };
    globalThis.document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      globalThis.document.removeEventListener('pointerdown', onPointerDown, true);
      globalThis.document.removeEventListener('pointerup', close, true);
      globalThis.document.removeEventListener('pointercancel', close, true);
      globalThis.clearTimeout(later);
    };
  }, [open, openStore]);
  // Escape closes the window and goes no further, so the map view does not clear the selection.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || !open) return;
    event.stopPropagation();
    show(false);
  };

  return (
    <div className="coordinates-goto-control" onKeyDown={onKeyDown}>
      {open && (
        <div className="coordinates-window" ref={box} role="dialog" aria-label={GOTO_LABEL}>
          <div className="coordinates-head">
            <span>{GOTO_LABEL}</span>
            <IconButton
              icon={X}
              label={`Close ${GOTO_LABEL.toLowerCase()}`}
              onClick={() => {
                show(false);
              }}
            />
          </div>
          <CoordinatesPanel service={props.service} mapView={props.mapView} settings={props.settings} workspace={props.workspace} />
        </div>
      )}
      <span className="coordinates-toggle" ref={anchor} hidden={open}>
        <IconButton
          icon={Crosshair}
          label={GOTO_LABEL}
          expanded={open}
          hasPopup="dialog"
          onClick={() => {
            show(!open);
          }}
        />
      </span>
    </div>
  );
}
