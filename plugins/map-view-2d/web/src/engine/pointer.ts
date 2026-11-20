/**
 * Pointer events of the map's viewport for the controller (plain DOM, no OpenLayers, so jsdom can
 * test it). A press the grab test claims (a press on the object being dragged, brief function 8)
 * is followed until its release wherever that happens: the pointer is captured, and the moves, the
 * release and a cancel are taken from the document, so releasing outside the map ends the drag.
 * Every other press is left to the map, which pans.
 */
import type { Pixel } from '@emc2/plugin-sdk';
import type { EnginePointerEvent } from '../core/engine.ts';
import { anyModifier } from './modifiers.ts';

export type GrabTest = (pixel: Pixel) => boolean;

export class PointerRouter {
  private test: GrabTest | null = null;
  /** The grabbing pointer and where it was last seen. */
  private grab: { readonly pointerId: number; readonly pixel: Pixel } | null = null;
  /** Events the document listeners (capture phase, so first) reported; the viewport's own listeners skip them. */
  private readonly reported = new WeakSet<Event>();
  private readonly onDocumentMove = (event: PointerEvent) => {
    this.reported.add(event);
    if (this.grab !== null) this.grab = { ...this.grab, pixel: this.pixelOf(event) };
    this.emit('move', event);
  };
  private readonly onDocumentUp = (event: PointerEvent) => {
    this.reported.add(event);
    this.release();
    this.emit('up', event);
  };
  private readonly onDocumentCancel = (event: PointerEvent) => {
    this.reported.add(event);
    this.release();
    this.emit('cancel', event);
  };

  constructor(
    private readonly viewport: HTMLElement,
    private readonly pixelOf: (event: MouseEvent) => Pixel,
    private readonly listener: (event: EnginePointerEvent) => void,
  ) {
    viewport.addEventListener('pointerdown', (event) => {
      this.onDown(event);
    });
    viewport.addEventListener('pointermove', (event) => {
      if (!this.reported.has(event)) this.emit('move', event);
    });
    viewport.addEventListener('pointerup', (event) => {
      if (!this.reported.has(event)) this.emit('up', event);
    });
  }

  /** While set, a press it claims is a grab (no panning); null ends any grab. */
  setGrabTest(test: GrabTest | null): void {
    this.test = test;
    if (test === null) this.release();
  }

  /** True if a press at this pixel is a grab, so the map must not pan for it. */
  claims(pixel: Pixel): boolean {
    return this.test?.(pixel) ?? false;
  }

  /**
   * Ends a grab from outside (the map is unmounted while the pointer is held): its document
   * listeners go, and the grab is reported as cancelled where the pointer was last seen, as a
   * cancelled pointer would be.
   */
  cancelGrab(): void {
    const grab = this.grab;
    if (grab === null) return;
    this.release();
    this.listener({ type: 'cancel', pixel: grab.pixel });
  }

  /** True from a claimed press until its release, cancel or the end of the grab test. */
  get grabbing(): boolean {
    return this.grab !== null;
  }

  private onDown(event: PointerEvent): void {
    const pixel = this.pixelOf(event);
    // A press with Ctrl, Cmd or Shift is a box (brief function 14), and one with another button than
    // the main one a menu (brief function 15): never a grab.
    if (this.grab === null && event.button === 0 && !anyModifier(event) && this.claims(pixel)) {
      this.grab = { pointerId: event.pointerId, pixel };
      try {
        this.viewport.setPointerCapture(event.pointerId);
      } catch {
        // Not every environment supports capture; the document listeners still see the release.
      }
      const doc = this.viewport.ownerDocument;
      doc.addEventListener('pointermove', this.onDocumentMove, true);
      doc.addEventListener('pointerup', this.onDocumentUp, true);
      doc.addEventListener('pointercancel', this.onDocumentCancel, true);
    }
    this.listener({ type: 'down', pixel });
  }

  private release(): void {
    const grab = this.grab;
    if (grab === null) return;
    this.grab = null;
    const doc = this.viewport.ownerDocument;
    doc.removeEventListener('pointermove', this.onDocumentMove, true);
    doc.removeEventListener('pointerup', this.onDocumentUp, true);
    doc.removeEventListener('pointercancel', this.onDocumentCancel, true);
    try {
      if (this.viewport.hasPointerCapture(grab.pointerId)) this.viewport.releasePointerCapture(grab.pointerId);
    } catch {
      // Nothing captured.
    }
  }

  private emit(type: EnginePointerEvent['type'], event: MouseEvent): void {
    this.listener({ type, pixel: this.pixelOf(event) });
  }
}
