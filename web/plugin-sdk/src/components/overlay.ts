/**
 * Where a shared popover goes (internal, not exported; CR-0021). The popover is drawn in the
 * browser's top layer, above everything in the page, so it is placed in window coordinates.
 */

/** The distance a popover keeps from the window's edges, in CSS pixels. */
export const WINDOW_MARGIN = 8;
/** The distance between a popover and its anchor, in CSS pixels. */
export const ANCHOR_GAP = 4;

export interface Box {
  readonly left: number;
  readonly top: number;
  readonly bottom: number;
}

export interface Placement {
  readonly left: number;
  readonly top: number;
  readonly maxWidth: number;
  readonly maxHeight: number;
  readonly side: 'below' | 'above';
}

/**
 * Where a popover of this size goes for this anchor, in window coordinates: below the anchor and
 * lined up with its start edge; moved left or right as far as it must to stay in the window; above
 * the anchor when it does not fit below and there is more room above. `maxHeight` is the room on
 * that side: a taller popover scrolls.
 */
export function placePopover(anchor: Box, size: { readonly width: number; readonly height: number }, viewport: { readonly width: number; readonly height: number }): Placement {
  const maxWidth = Math.max(0, viewport.width - 2 * WINDOW_MARGIN);
  const width = Math.min(size.width, maxWidth);
  const left = Math.max(WINDOW_MARGIN, Math.min(anchor.left, viewport.width - WINDOW_MARGIN - width));
  const below = Math.max(0, viewport.height - WINDOW_MARGIN - anchor.bottom - ANCHOR_GAP);
  const above = Math.max(0, anchor.top - ANCHOR_GAP - WINDOW_MARGIN);
  if (size.height <= below || below >= above) return { left, top: anchor.bottom + ANCHOR_GAP, maxWidth, maxHeight: below, side: 'below' };
  return { left, top: anchor.top - ANCHOR_GAP - Math.min(size.height, above), maxWidth, maxHeight: above, side: 'above' };
}
