import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Lock } from 'lucide-react';
import { Icon } from '@emc2/plugin-sdk';
import type { LayerPanelController } from './controller.ts';

/** The Map Pane's share the box may take at most (brief, function 24). */
export const MAX_WIDTH_SHARE = 0.4;

/**
 * "Active layer: <name>" over the map, at the bottom left (brief, function 24), from the panel's
 * own state, so it follows the active layer, a rename, a lock and a delete at once. With Lucide
 * `Lock`, labelled "Locked", before the name of a locked layer; "No active layer" when there is
 * none or its layer is not (yet) in the picture. It only shows: no button, link or tab stop.
 */
export function ActiveLayer(props: { readonly controller: LayerPanelController }) {
  const { controller } = props;
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const box = useRef<HTMLDivElement>(null);
  const maxWidth = useMapPaneShare(box);
  const layer = state.activeLayer === null ? undefined : state.layers.find((l) => l.id === state.activeLayer);
  const text = layer === undefined ? 'No active layer' : `Active layer: ${layer.name}`;
  return (
    <div ref={box} className="layer-panel-active" title={text} style={maxWidth === null ? undefined : { maxWidth }}>
      {layer === undefined ? (
        <span className="layer-panel-active-name">{text}</span>
      ) : (
        <>
          <span className="layer-panel-active-label">{'Active layer: '}</span>
          {layer.locked === true && (
            <span className="layer-panel-active-lock">
              <Icon icon={Lock} label="Locked" />
            </span>
          )}
          <span className="layer-panel-active-name">{layer.name}</span>
        </>
      )}
    </div>
  );
}

/**
 * 40 % of the Map Pane's width in CSS pixels, or null where it cannot be measured (jsdom). The
 * shell's overlay column is sized by its content, so a CSS percentage would not be of the pane:
 * the pane is the column's containing block, the box's second offset parent.
 */
function useMapPaneShare(box: { readonly current: HTMLElement | null }): number | null {
  const [width, setWidth] = useState<number | null>(null);
  useLayoutEffect(() => {
    const column = box.current?.offsetParent;
    const pane = column instanceof HTMLElement ? column.offsetParent : null;
    if (!(pane instanceof HTMLElement) || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      setWidth(Math.floor(pane.clientWidth * MAX_WIDTH_SHARE));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(pane);
    return () => {
      observer.disconnect();
    };
  }, [box]);
  return width;
}
