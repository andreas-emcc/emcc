/**
 * The display settings window (ADR-0052): an icon button in the Map Pane's top-right corner after
 * the Coordinates icon (order 20, every workspace), opening a window with every display setting
 * and "Use defaults". A change applies at once and is saved for the user on the server (no Save
 * button); every user may open it. The close button, Escape or a press outside closes it, and the
 * focus goes back to the icon.
 *
 * T-162 (owner, 2026-11-10): the icon has the map settings icon's frame (`map-view-2d`), and the
 * window opens as the map settings window does: in the icon's place in the corner, growing to the
 * left over the map, inside the Map Pane.
 */
import { Button, IconButton } from '@emc2/plugin-sdk';
import { SlidersHorizontal, X } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { DisplayForm } from './DisplayForm.tsx';
import { changed, DISPLAY_LABEL, type DisplayChange } from './names.ts';
import type { DisplayState } from './state.ts';

export function DisplayControl({ display }: { readonly display: DisplayState }) {
  const shown = useSyncExternalStore((listener) => display.onChange(listener), () => display.value);
  const [open, setOpen] = useState(false);
  const moved = useRef(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!moved.current) return undefined;
    moved.current = false;
    if (open) {
      box.current?.querySelector('input')?.focus(); // the first control (ADR-0052 point 2)
      return undefined;
    }
    const back = () => {
      const focused = globalThis.document.activeElement;
      if (focused === null || focused === globalThis.document.body || anchor.current?.contains(focused) === true) anchor.current?.querySelector('button')?.focus();
    };
    back();
    const later = globalThis.setTimeout(back, 0); // a press on the map blurs after its pointerdown
    return () => {
      globalThis.clearTimeout(later);
    };
  }, [open]);
  const show = (next: boolean) => {
    moved.current = true;
    setOpen(next);
  };
  // A press outside the window closes it (the icon is hidden meanwhile, so every press outside the window counts).
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: Event) => {
      if (!(event.target instanceof Node) || box.current?.contains(event.target) === true) return;
      moved.current = true;
      setOpen(false);
    };
    globalThis.document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      globalThis.document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [open]);
  // Escape closes the window and goes no further, so the map view keeps its selection.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || !open) return;
    event.stopPropagation();
    show(false);
  };
  const preview = (change: DisplayChange) => {
    display.preview(changed(display.choices, change));
  };
  const save = (change: DisplayChange) => {
    void display.save(changed(display.choices, change));
  };

  return (
    <div className="display-control" onKeyDown={onKeyDown}>
      {open && (
        <div className="display-window" ref={box} role="dialog" aria-label={DISPLAY_LABEL}>
          <div className="display-head">
            <span>{DISPLAY_LABEL}</span>
            <IconButton icon={X} label={`Close ${DISPLAY_LABEL.toLowerCase()}`} onClick={() => { show(false); }} />
          </div>
          <DisplayForm shown={shown} relationKinds={display.relationKinds} onPreview={preview} onChange={save} idPrefix="display-window" />
          <div className="display-actions">
            <Button onClick={() => { void display.save({}); }}>Use defaults</Button>
          </div>
        </div>
      )}
      <span ref={anchor} className="display-toggle" hidden={open}>
        <IconButton icon={SlidersHorizontal} label={DISPLAY_LABEL} expanded={open} hasPopup="dialog" onClick={() => { show(!open); }} />
      </span>
    </div>
  );
}
