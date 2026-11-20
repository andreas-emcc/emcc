import { IconButton, Select, Slider } from '@emc2/plugin-sdk';
import { Map as MapIcon, X } from 'lucide-react';
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import type { MapController } from '../core/controller.ts';
import { DIM_STEP } from '../core/setup.ts';
import type { ControlsOpenStore } from './controlsOpen.ts';

/**
 * A Map Pane overlay: the map projection, the background map and its dim level (brief functions 2,
 * 3 and 19). Only the background maps that support the current projection are offered; "None"
 * shows a graticule. A vector background that could not be loaded is named below them (brief
 * function 11). The dim slider moves in steps of 10 % up to the highest level the settings allow.
 * The SDK's shared components in the shell's tokens (brief function 21, ADR-0034).
 *
 * Collapsible (owner, 2026-10-21): they start as one icon button, so the box covers the map only
 * while the user needs it; open or closed is remembered per browser. While collapsed, a problem the
 * box would show puts a warning marker on the button and its text in the button's name.
 */
export function MapControls(props: { readonly controller: MapController; readonly openStore: ControlsOpenStore }) {
  const { controller, openStore } = props;
  const [open, setOpen] = useState(() => openStore.load());
  // After the user opens or closes it, the focus goes to the box's first list or back to the button.
  const moved = useRef(false);
  const box = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    (open ? box.current?.querySelector('select') : toggle.current?.querySelector('button'))?.focus();
  }, [open]);
  const show = (next: boolean) => {
    moved.current = true;
    openStore.save(next);
    setOpen(next);
  };
  // Re-render when the projection or the background changes; the controller holds the state.
  useSyncExternalStore((onChange) => controller.onStateChange(onChange), () => stateKey(controller));
  const backgrounds = controller.backgrounds;
  const shown = controller.background;
  const problem = controller.backgroundProblem;

  if (!open) {
    return (
      <div className="map-view-2d-controls-toggle" ref={toggle}>
        <IconButton
          icon={MapIcon}
          label={problem === null ? CONTROLS_LABEL : `${CONTROLS_LABEL}: ${problem}`}
          onClick={() => {
            show(true);
          }}
        />
        {problem !== null && <span className="map-view-2d-controls-marker" aria-hidden="true" />}
      </div>
    );
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Escape anywhere in the box closes it and goes no further (the map's Escape would clear the
    // selection), the lists included (T-172): the box opens with the focus in the first list, so Escape
    // there must work. A list that is open keeps its own Escape: the browser handles that key in the
    // list's popup, and the page does not see it, so what arrives here is Escape on a closed list.
    if (event.key !== 'Escape') return;
    event.stopPropagation();
    show(false);
  };

  return (
    <div className="map-view-2d-controls" ref={box} role="group" aria-label={CONTROLS_LABEL} onKeyDown={onKeyDown}>
      <div className="map-view-2d-controls-head">
        <span>{CONTROLS_LABEL}</span>
        <IconButton
          icon={X}
          label={`Close ${CONTROLS_LABEL.toLowerCase()}`}
          onClick={() => {
            show(false);
          }}
        />
      </div>
      <Select
        label="Projection"
        value={controller.projectionCode}
        options={controller.projectionCodes.map((code) => ({ value: code, label: code }))}
        onChange={(code) => {
          controller.setProjection(code);
        }}
      />
      <Select
        label="Background"
        value={shown?.id ?? ''}
        options={[...backgrounds.map((provider) => ({ value: provider.id, label: provider.name })), { value: '', label: 'None (grid)' }]}
        onChange={(id) => {
          controller.chooseBackground(id === '' ? null : id);
        }}
      />
      <Slider
        label="Dim"
        value={controller.dimLevel}
        min={0}
        max={controller.currentSettings.highestDim}
        step={DIM_STEP}
        format={(value) => `${String(value)} %`}
        disabled={controller.currentSettings.highestDim < DIM_STEP}
        onChange={(value) => {
          controller.setDim(value);
        }}
      />
      {problem !== null && (
        <p className="map-view-2d-controls-problem" role="status">
          {problem}
        </p>
      )}
    </div>
  );
}

/** The controls' name: the toggle button's, the box's, and what the ITA's tests look for. */
export const CONTROLS_LABEL = 'Map controls';

function stateKey(controller: MapController): string {
  return `${controller.projectionCode}|${controller.background?.id ?? ''}|${controller.backgrounds.map((b) => b.id).join(',')}|${controller.backgroundProblem ?? ''}|${String(controller.dimLevel)}|${String(controller.currentSettings.highestDim)}`;
}
