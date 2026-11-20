/**
 * The engine when the browser has no WebGL (brief function 9, rendering "none"): it draws nothing
 * and the Map Pane says why, instead of an empty or broken map. `MapView` is still provided, so the
 * other plugins load and show their panels; it simply has no view.
 */
import type { Engine, Unlisten } from '../core/engine.ts';
import type { Projection } from '../core/projections.ts';
import { CANNOT_DRAW_MESSAGE } from '../core/rendering.ts';

const nothing: Unlisten = () => undefined;

export class NullEngine implements Engine {
  readonly view = null;

  constructor(public projection: Projection) {}

  /** Shows the message in the Map Pane. */
  mount(element: HTMLElement): () => void {
    const message = document.createElement('div');
    message.className = 'map-view-2d-cannot-draw';
    message.setAttribute('role', 'alert');
    message.textContent = CANNOT_DRAW_MESSAGE;
    element.appendChild(message);
    return () => {
      message.remove();
    };
  }

  setProjection(projection: Projection): void {
    this.projection = projection;
  }

  setView(): void {
    // No view to move.
  }

  onViewChange(): Unlisten {
    return nothing;
  }

  onPointer(): Unlisten {
    return nothing;
  }

  onEscape(): Unlisten {
    return nothing;
  }

  onSelectBox(): Unlisten {
    return nothing;
  }

  setLayers(): void {}
  replaceItems(): void {}
  updateItems(): void {}
  pickCandidates() {
    return [];
  }
  boxCandidates() {
    return [];
  }
  setSymbols(): void {}
  setBackground(): void {}
  setDim(): void {}

  setTextLook(): void {}
  registerProjections(): void {}
  setSymbolOptions(): void {}
  setDisplayOptions(): void {}
  setClusters(): void {}
  setOverlay(): void {}
  setInteraction(): void {}
  startDrawing(): void {}
  stopDrawing(): void {}
  setDrawingPlain(): void {}
  rightClickDrawing(): boolean {
    return false;
  }
  startEditing(): void {}
  stopEditing(): void {}
  pauseDoubleClickZoom(): void {}
  setGrabTest(): void {}
  setDragPreview(): void {}
  setHighlight(): void {}
  setDragHover(): void {}
}
