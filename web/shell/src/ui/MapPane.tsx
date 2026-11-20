import { useEffect, useRef } from 'react';
import type { MapPaneOverlay } from '@emc2/plugin-sdk';
import { ErrorBoundary } from './ErrorBoundary.tsx';
import { mountKey } from './panels.ts';
import type { ShellStore, ShellView } from './store.ts';

const CORNERS: readonly MapPaneOverlay['position'][] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

/**
 * The Map Pane: the element the map view plugin mounts into (`ui.setMapView`), and the plugins'
 * overlays in its four corners. The overlay layer lets the pointer through to the map except on
 * the overlays themselves.
 */
export function MapPane({ view, store }: { readonly view: ShellView; readonly store: ShellStore }) {
  const host = useRef<HTMLDivElement>(null);
  const mapView = view.mapView;

  useEffect(() => {
    const element = host.current;
    if (mapView === null || element === null) return;
    let unmount: (() => void) | undefined;
    try {
      unmount = mapView.view.mount(element);
      store.setMapPane(element); // for the switch's moment (`workspaces/switch.ts`)
    } catch (error) {
      console.error(`[${mapView.pluginId}] the map view could not be mounted`, error);
      store.observe(mapView.pluginId, { state: 'FAILED', detail: `the map view could not be mounted: ${String(error)}` });
      store.notify(null, { severity: 'error', message: `The map (${mapView.pluginId}) could not be shown.` });
    }
    return () => {
      store.setMapPane(null);
      try {
        unmount?.();
      } catch (error) {
        console.error(`[${mapView.pluginId}] the map view could not be unmounted`, error);
      }
    };
  }, [mapView, store]);

  return (
    <main className="map-pane" aria-label="Map Pane">
      <div ref={host} className="map-host" data-testid="map-host" />
      {mapView === null && <p className="placeholder">No map view plugin is active.</p>}
      {CORNERS.map((corner) => (
        <div key={corner} className={`overlays overlays-${corner}`}>
          {view.overlays
            .filter((item) => item.overlay.position === corner)
            .map((item) => {
              const Overlay = item.overlay.component;
              return (
                <div key={mountKey(view.workspace, item)} className="overlay">
                  <ErrorBoundary
                    name={`Overlay ${item.overlay.id}`}
                    onError={(error) => {
                      store.observe(item.pluginId, { state: 'DEGRADED', detail: `overlay ${item.overlay.id} failed: ${error.message}` });
                    }}
                  >
                    <Overlay />
                  </ErrorBoundary>
                </div>
              );
            })}
        </div>
      ))}
    </main>
  );
}
