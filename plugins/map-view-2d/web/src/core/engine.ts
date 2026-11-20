/**
 * What the map view needs from a map engine. The OpenLayers engine implements it (the only code
 * that imports `ol`); tests use a fake. Everything here is plain data: lon/lat draw items in,
 * pixels and projected coordinates out, no OpenLayers types (criterion 12).
 */
import type { BackgroundMapProvider, DrawKind, LabelPlaces, Pixel, Style, SymbolService, Uuid } from '@emc2/plugin-sdk';
import type { ClusterItem } from './clusters.ts';
import type { DrawnShape, EditShape, XY } from './drawing.ts';
import type { DrawItem } from './drawData.ts';
import type { TextLook } from './look.ts';
import type { PickCandidate, PixelBox } from './pick.ts';
import type { Projection } from './projections.ts';
import type { PreparedVector } from './vectorBackground.ts';
import type { ViewState } from './viewport.ts';

/**
 * A pointer event in pixels of the Map Pane. `click` is a click without a drag. After a press the
 * grab test claims, `move`, `up` and `cancel` follow it even outside the map.
 */
export interface EnginePointerEvent {
  /** `menu`: a right click (or Ctrl+click on a Mac), the browser's own menu suppressed. */
  readonly type: 'click' | 'move' | 'down' | 'up' | 'cancel' | 'menu';
  readonly pixel: Pixel;
  /** For `menu`, where on the page the menu opens (`clientX`, `clientY`). */
  readonly page?: readonly [x: number, y: number];
  /**
   * For a click, the keys held (brief function 14): `add` is the add key alone (Ctrl, Cmd on a
   * Mac), `other` any other key or combination (Shift, Alt, Ctrl on a Mac, which opens the menu
   * there); absent for none.
   */
  readonly keys?: 'add' | 'other';
}

/** One map layer, as the engine stacks and shows it. */
export interface EngineLayer {
  readonly id: Uuid;
  /** 0 for the bottom layer, increasing upwards. */
  readonly stack: number;
  readonly visible: boolean;
}

/**
 * - `none`: the map pans with the mouse, and a double-click zooms.
 * - `pick-point`: a crosshair; clicks still arrive as `click`; a double-click does not zoom.
 * - `drag-object`: an object can be dragged; the map still pans, except for a press the grab
 *   test claims (`setGrabTest`); a double-click does not zoom.
 * - `draw`, `edit`: a shape is drawn or edited (`startDrawing`, `startEditing`).
 *
 * The add key with a drag (Ctrl, Cmd on a Mac) draws a selection box in `none` and `drag-object`,
 * never in the others (owner, 2026-10-16); Shift with a drag zooms to a box in every mode.
 */
export type InteractionMode = 'none' | 'pick-point' | 'drag-object' | 'draw' | 'edit';

export type Unlisten = () => void;

/**
 * What a tactical graphic adds to drawing (brief function 32). The values are read when the engine
 * needs them: the limits come from the symbology service's catalogue, which may answer after the
 * drawing has started.
 */
export interface DrawingOptions {
  /** The drawing does not finish (Enter, a double-click) with fewer points set than this. */
  readonly minPoints?: number;
  /** The drawing finishes by itself when this many points are set; null for no limit. */
  readonly maxPoints?: number | null;
  /** The points set so far, with the pointer's position as the last one, as the sketch changes; empty when nothing is set. */
  readonly onSketch?: (points: readonly XY[]) => void;
  /**
   * A line's points (map coordinates) that the drawing continues from the last one (`MapView.append`, brief function 44):
   * only for a `line`. A click adds a point; Backspace and a right click take back only added points, so the right click
   * with none added is not used. `onEnd` gets the whole line: these points followed by the added ones.
   */
  readonly extend?: readonly XY[];
}

/** What a tactical graphic adds to editing (brief function 32). */
export interface EditingOptions {
  /** A handle on each point of the shape, always. */
  readonly vertexHandles?: boolean;
  /** The shape as it is while a point or the whole shape is dragged. */
  readonly onChange?: (shape: EditShape) => void;
}

/**
 * What the engine draws under all layers (brief functions 3 and 11): a provider's tiles, or a
 * vector background prepared for the current projection. Null is a neutral background with a
 * graticule.
 */
export type EngineBackground =
  | { readonly kind: 'tiles'; readonly provider: BackgroundMapProvider }
  | { readonly kind: 'vector'; readonly provider: BackgroundMapProvider; readonly data: PreparedVector };

/** What the user's display settings change in how symbols are drawn (brief function 35); the size comes with `setSymbolOptions`. */
export interface DisplayOptions {
  /** The label drawn at each place round a symbol, as text (SDK 1.8.0, CR-0043 part A); `render` is asked with `labels: []`. */
  readonly labelPlaces: LabelPlaces;
  /** Whether a symbol with a direction gets the map view's own direction arrow (the "Direction arrow" switch). */
  readonly directionArrow: boolean;
  /** The speed vector's length in seconds of travel (function 38); 0 draws none. */
  readonly speedVectorSeconds: number;
}

export interface Engine {
  readonly projection: Projection;
  /** The current view; null while the map has no size (not mounted). */
  readonly view: ViewState | null;
  /** Changes the projection; the engine projects every item again. Centre in the new projection. */
  setProjection(projection: Projection, center: readonly [number, number], resolution: number): void;
  /** Centres the map; `resolution` in projected units per pixel. */
  setView(center: readonly [number, number], resolution?: number): void;
  /** After the view changed (end of a move, resize, projection change). */
  onViewChange(listener: () => void): Unlisten;
  onPointer(listener: (event: EnginePointerEvent) => void): Unlisten;
  /** The user pressed Escape while the map or the page had the focus. */
  onEscape(listener: () => void): Unlisten;
  /** The user drew a selection box (the add key with a drag, brief function 14). */
  onSelectBox(listener: (box: PixelBox) => void): Unlisten;

  /** The map layers, bottom first. Layers not listed are removed with their items. */
  setLayers(layers: readonly EngineLayer[]): void;
  /** Replaces all items of a layer. */
  replaceItems(layerId: Uuid, items: readonly DrawItem[]): void;
  /** Applies merged changes to a layer: an item is added or replaced, `null` removes it. */
  updateItems(layerId: Uuid, changes: ReadonlyMap<Uuid, DrawItem | null>): void;
  /** Items near a pixel (within the tolerance), as pixel shapes for {@link pickAt}. Only visible layers. */
  pickCandidates(pixel: Pixel, tolerance: number): PickCandidate[];
  /** Items that may reach into a box, as pixel shapes for {@link boxAt}. Only visible layers. */
  boxCandidates(box: PixelBox): PickCandidate[];

  /** Makes these projections known to the map library (at start, and after a settings change). */
  registerProjections(projections: readonly Projection[]): void;
  /** New symbol size and text threshold (a settings change): symbol images are made again and everything is redrawn. */
  setSymbolOptions(symbolSize: number, textThreshold: number): void;

  /** The user's labels by place, direction arrow and speed vector (brief function 35): the texts, the arrows and the vectors are drawn again. */
  setDisplayOptions(options: DisplayOptions): void;

  /** The symbology plugin's service once it is there; until then (or without it) symbols are drawn as markers. */
  setSymbols(symbols: SymbolService): void;

  /**
   * The background map under all layers; null shows a neutral background with a graticule (also
   * the state at start). A vector background prepared for another projection is not drawn: after
   * `setProjection` the graticule shows until the background for the new projection comes.
   */
  setBackground(background: EngineBackground | null): void;
  /**
   * Dims what lies under the objects (brief function 19): the background map, or the neutral
   * background and graticule, towards black; 0 is not dimmed, 0.9 the darkest. Objects, labels,
   * clusters and the highlight are never dimmed.
   */
  setDim(level: number): void;
  /**
   * Shape labels and cluster counts in the look's text colour, on a halo in its ground colour, in its
   * fonts (brief function 21, criterion 43); drawn again at once. Sizes stay the map view's own.
   */
  setTextLook(look: TextLook): void;

  /** A plugin's temporary graphics, drawn above all layers; an empty list removes them. */
  setOverlay(overlayId: string, items: readonly DrawItem[]): void;
  setInteraction(mode: InteractionMode): void;
  /**
   * Lets the user draw a shape (brief function 17): circle, ellipse, square and rectangle by
   * pressing and dragging, polygon and line point by point (a click sets a point, a double-click
   * or Enter finishes, Backspace removes the last point; a click where the projection cannot show
   * a point sets none). The preview is drawn in `style`. `onEnd` gets what was drawn in map
   * coordinates, or null when the engine ends the drawing itself (the map is unmounted).
   * `stopDrawing` ends it without calling `onEnd` (Escape and a new interaction go through the
   * controller).
   */
  startDrawing(kind: DrawKind, style: Style | undefined, onEnd: (shape: DrawnShape | null) => void, options?: DrawingOptions): void;
  stopDrawing(): void;
  /** Shows or hides the drawing's plain preview line: hidden while a tactical graphic is the preview. */
  setDrawingPlain(visible: boolean): void;
  /**
   * A right click while a shape is drawn (brief function 27): in a polygon or a line it removes the
   * last point set, as Backspace does, and the preview follows; in a circle, ellipse, square or
   * rectangle it changes nothing during the press and drag. Returns true when the right click was
   * used so; false when there is nothing to remove (no point set, or no press yet), which the
   * controller treats as Escape. False too when no shape is drawn.
   */
  rightClickDrawing(): boolean;
  /**
   * Lets the user edit a shape (brief function 17): drag inside it to move it, drag a corner or
   * point (a polygon's, a line's) or a handle (a circle's radius, an ellipse's axes) to reshape it;
   * Enter finishes. `reshape` keeps a circle's or ellipse's handles consistent and gives the outline
   * to show; `move` gives a moved circle or ellipse at its new centre with its size kept. `onEnd`
   * gets the edited shape in map coordinates, or null when the engine ends it (the map is
   * unmounted). `stopEditing` ends it without calling `onEnd`.
   */
  startEditing(
    shape: EditShape,
    style: Style | undefined,
    tools: {
      readonly reshape: (shape: EditShape) => { readonly shape: EditShape; readonly outline: readonly XY[] } | null;
      readonly move: (before: EditShape, center: XY) => EditShape | null;
    },
    onEnd: (shape: EditShape | null) => void,
    options?: EditingOptions,
  ): void;
  stopEditing(): void;
  /**
   * Turns the double-click zoom off for the double-click window: the first click of a double-click
   * on a cluster has zoomed in on it already (owner, 2026-10-13, review R2).
   */
  pauseDoubleClickZoom(): void;
  /**
   * While set, a press at a pixel it claims does not pan the map, and its moves and release are
   * followed even outside the map (brief function 8: press on the object, drag). Null ends a grab
   * in progress.
   */
  setGrabTest(test: ((pixel: Pixel) => boolean) | null): void;
  /** The preview of an object being dragged, drawn on top; null removes it. */
  setDragPreview(item: DrawItem | null): void;
  /**
   * The selected objects' highlight (owner, 2026-10-09): a frame around a symbol's image, a halo
   * around a point or marker, a wide contrasting casing under a line or an area's outline. Only
   * these items are drawn again; an empty list removes the highlight.
   */
  setHighlight(items: readonly DrawItem[]): void;
  /** True while the pointer is over the object that can be dragged (the "move" cursor). */
  setDragHover(hover: boolean): void;
  /** The clusters to draw above all object layers (brief function 12); an empty list removes them. */
  setClusters(items: readonly ClusterItem[]): void;
}
