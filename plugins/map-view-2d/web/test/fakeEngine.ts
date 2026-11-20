/** A map engine for tests: records what it is asked to draw, and lets the test send pointer events. */
import type { BackgroundMapProvider, DrawKind, Pixel, Position, Style, SymbolService, Uuid } from '@emc2/plugin-sdk';
import type { ClusterItem } from '../src/core/clusters.ts';
import type { DrawItem } from '../src/core/drawData.ts';
import type { DrawnShape, EditShape, XY } from '../src/core/drawing.ts';
import type { DisplayOptions, DrawingOptions, EditingOptions, Engine, EngineBackground, EngineLayer, EnginePointerEvent, InteractionMode, Unlisten } from '../src/core/engine.ts';
import { DEFAULT_TEXT_LOOK, type TextLook } from '../src/core/look.ts';
import type { PickCandidate, PixelBox } from '../src/core/pick.ts';
import type { Projection } from '../src/core/projections.ts';
import { mapToPixel, type ViewState } from '../src/core/viewport.ts';

type Listener<T> = (value: T) => void;

function listeners<T>() {
  const set = new Set<Listener<T>>();
  return {
    on(listener: Listener<T>): Unlisten {
      set.add(listener);
      return () => set.delete(listener);
    },
    emit(value: T) {
      for (const l of [...set]) l(value);
    },
    get size() {
      return set.size;
    },
  };
}

/** Symbols and markers are 30 × 30 pixel boxes around their position in the fake. */
const BOX = 30;

export class FakeEngine implements Engine {
  view: ViewState | null = null;
  layers: readonly EngineLayer[] = [];
  /** Layer id → item id → item, in drawing order (an updated item moves to the end). */
  readonly items = new Map<Uuid, Map<Uuid, DrawItem>>();
  readonly overlays = new Map<string, readonly DrawItem[]>();
  interaction: InteractionMode = 'none';
  dragPreview: DrawItem | null = null;
  /** The provider whose background is drawn (tiles or vector), null for the graticule. */
  background: BackgroundMapProvider | null | 'unset' = 'unset';
  /** What was last given to setBackground. */
  backgroundShown: EngineBackground | null = null;
  /** How often each call happened. */
  readonly calls = { replaceItems: 0, updateItems: 0, setLayers: 0, setBackground: 0 };
  private readonly viewChanges = listeners<undefined>();
  private readonly pointers = listeners<EnginePointerEvent>();
  private readonly escapes = listeners<undefined>();
  private readonly boxes = listeners<PixelBox>();

  constructor(public projection: Projection) {}

  /** Gives the map a size and a view, as mounting does. */
  show(center: readonly [number, number], resolution: number, width = 800, height = 600): void {
    this.view = { width, height, center, resolution };
    this.viewChanges.emit(undefined);
  }

  setProjection(projection: Projection, center: readonly [number, number], resolution: number): void {
    this.projection = projection;
    this.view = this.view === null ? null : { ...this.view, center, resolution };
    this.viewChanges.emit(undefined);
  }

  setView(center: readonly [number, number], resolution?: number): void {
    if (this.view === null) return;
    this.view = { ...this.view, center, resolution: resolution ?? this.view.resolution };
    this.viewChanges.emit(undefined);
  }

  onViewChange(listener: () => void): Unlisten {
    return this.viewChanges.on(listener);
  }

  onPointer(listener: (event: EnginePointerEvent) => void): Unlisten {
    return this.pointers.on(listener);
  }

  onEscape(listener: () => void): Unlisten {
    return this.escapes.on(listener);
  }

  onSelectBox(listener: (box: PixelBox) => void): Unlisten {
    return this.boxes.on(listener);
  }

  setLayers(layers: readonly EngineLayer[]): void {
    this.calls.setLayers++;
    this.layers = layers;
    for (const id of [...this.items.keys()]) if (!layers.some((l) => l.id === id)) this.items.delete(id);
    for (const layer of layers) if (!this.items.has(layer.id)) this.items.set(layer.id, new Map());
  }

  replaceItems(layerId: Uuid, items: readonly DrawItem[]): void {
    this.calls.replaceItems++;
    this.items.set(layerId, new Map(items.map((item) => [item.id, item])));
  }

  updateItems(layerId: Uuid, changes: ReadonlyMap<Uuid, DrawItem | null>): void {
    this.calls.updateItems++;
    const layer = this.items.get(layerId);
    if (layer === undefined) throw new Error(`updateItems for unknown layer ${layerId}`);
    for (const [id, item] of changes) {
      layer.delete(id);
      if (item !== null) layer.set(id, item);
    }
  }

  pickCandidates(pixel: Pixel, tolerance: number): PickCandidate[] {
    const view = this.view;
    if (view === null) return [];
    const result: PickCandidate[] = [];
    for (const layer of this.layers) {
      if (!layer.visible) continue;
      let order = 0;
      for (const item of this.items.get(layer.id)?.values() ?? []) {
        if (item.kind === 'line' && item.aux === true) continue; // a speed vector or a relation line is never picked, as in the real engine
        const position = firstPositionOf(item);
        const xy = this.projection.forward(position);
        if (xy === null) continue;
        const [x, y] = mapToPixel(view, xy);
        if (Math.abs(x - pixel[0]) > BOX + tolerance || Math.abs(y - pixel[1]) > BOX + tolerance) continue;
        result.push({ kind: 'box', id: item.id, stack: layer.stack, order: order++, left: x - BOX / 2, top: y - BOX / 2, right: x + BOX / 2, bottom: y + BOX / 2, at: [x, y] });
      }
    }
    return result;
  }

  /** Every item of the visible layers, drawn at its first position (the box test is `boxAt`'s). */
  boxCandidates(): PickCandidate[] {
    const view = this.view;
    if (view === null) return [];
    const result: PickCandidate[] = [];
    for (const layer of this.layers) {
      if (!layer.visible) continue;
      let order = 0;
      for (const item of this.items.get(layer.id)?.values() ?? []) {
        if (item.kind === 'line' && item.aux === true) continue;
        const xy = this.projection.forward(firstPositionOf(item));
        if (xy === null) continue;
        result.push({ kind: 'circle', id: item.id, stack: layer.stack, order: order++, center: mapToPixel(view, xy), radius: 4 });
      }
    }
    return result;
  }

  symbols: SymbolService | null = null;

  /** The dim level last set, 0 to 0.9. */
  dim = 0;

  /** The text look last set (brief function 21). */
  textLook: TextLook = DEFAULT_TEXT_LOOK;

  setTextLook(look: TextLook): void {
    this.textLook = look;
  }

  setDim(level: number): void {
    this.dim = level;
  }

  setSymbols(symbols: SymbolService): void {
    this.symbols = symbols;
  }

  /** The clusters drawn now. */
  clusters: readonly ClusterItem[] = [];

  /** Projections made known (registerProjections), and the last symbol options. */
  registered: readonly Projection[] = [];
  symbolOptions: { readonly symbolSize: number; readonly textThreshold: number } | null = null;

  registerProjections(projections: readonly Projection[]): void {
    this.registered = projections;
  }

  setSymbolOptions(symbolSize: number, textThreshold: number): void {
    this.symbolOptions = { symbolSize, textThreshold };
  }

  /** The last display options (brief function 35). */
  displayOptions: DisplayOptions | null = null;

  setDisplayOptions(options: DisplayOptions): void {
    this.displayOptions = options;
  }

  setClusters(items: readonly ClusterItem[]): void {
    this.clusters = items;
  }

  setBackground(background: EngineBackground | null): void {
    this.calls.setBackground++;
    this.backgroundShown = background;
    this.background = background?.provider ?? null;
  }

  setOverlay(overlayId: string, items: readonly DrawItem[]): void {
    if (items.length === 0) this.overlays.delete(overlayId);
    else this.overlays.set(overlayId, items);
  }

  setInteraction(mode: InteractionMode): void {
    this.interaction = mode;
  }

  /** The running drawing: its kind and where its end goes. */
  drawing: { readonly kind: DrawKind; readonly style: Style | undefined; readonly onEnd: (shape: DrawnShape | null) => void; readonly options: DrawingOptions | undefined } | null = null;

  startDrawing(kind: DrawKind, style: Style | undefined, onEnd: (shape: DrawnShape | null) => void, options?: DrawingOptions): void {
    this.drawing = { kind, style, onEnd, options };
    this.drawingPlain = true;
  }

  /** Whether the plain preview line shows (hidden while a graphic is the preview). */
  drawingPlain = true;

  setDrawingPlain(visible: boolean): void {
    this.drawingPlain = visible;
  }

  /** The sketch as the drawing reports it: the points set and the pointer last (a test's click or move). */
  sketch(points: readonly XY[]): void {
    this.drawingPoints = Math.max(0, points.length - 1);
    this.drawing?.options?.onSketch?.(points);
  }

  stopDrawing(): void {
    this.drawing = null;
    this.drawingPoints = 0;
    this.pressing = false;
  }

  /** How many points the drawing has set (a polygon or a line), for tests; a right click removes one. */
  drawingPoints = 0;
  /** Whether the press of a circle, ellipse, square or rectangle is down. */
  pressing = false;

  rightClickDrawing(): boolean {
    if (this.drawing === null) return false;
    if (['circle', 'ellipse', 'square', 'rectangle'].includes(this.drawing.kind)) return this.pressing;
    if (this.drawingPoints === 0) return false;
    this.drawingPoints--;
    return true;
  }

  /** The running edit: the shape, its style, and the callbacks. */
  editing: {
    readonly shape: EditShape;
    readonly style: Style | undefined;
    readonly reshape: (shape: EditShape) => { readonly shape: EditShape; readonly outline: readonly XY[] } | null;
    readonly move: (before: EditShape, center: XY) => EditShape | null;
    readonly onEnd: (shape: EditShape | null) => void;
    readonly options: EditingOptions | undefined;
  } | null = null;

  startEditing(
    shape: EditShape,
    style: Style | undefined,
    tools: {
      readonly reshape: (shape: EditShape) => { readonly shape: EditShape; readonly outline: readonly XY[] } | null;
      readonly move: (before: EditShape, center: XY) => EditShape | null;
    },
    onEnd: (shape: EditShape | null) => void,
    options?: EditingOptions,
  ): void {
    this.editing = { shape, style, ...tools, onEnd, options };
  }

  /** The shape changes while a point or the whole shape is dragged (a test's drag). */
  editChange(shape: EditShape): void {
    this.editing?.options?.onChange?.(shape);
  }

  stopEditing(): void {
    this.editing = null;
  }

  /** The user finishes the edit (Enter) with this shape. */
  finishEditing(shape: EditShape | null): void {
    const editing = this.editing;
    if (editing === null) throw new Error('nothing is being edited');
    this.editing = null;
    editing.onEnd(shape);
  }

  /** The user finishes the drawing with this shape (map coordinates), as the engine reports it. */
  finishDrawing(shape: DrawnShape | null): void {
    const drawing = this.drawing;
    if (drawing === null) throw new Error('nothing is being drawn');
    this.drawing = null;
    drawing.onEnd(shape);
  }

  /** How often the double-click zoom was paused after a cluster zoom. */
  doubleClickZoomPauses = 0;

  pauseDoubleClickZoom(): void {
    this.doubleClickZoomPauses++;
  }

  /** As the OpenLayers engine: a press the grab test claims does not pan; every other press does. */
  grabTest: ((pixel: Pixel) => boolean) | null = null;

  setGrabTest(test: ((pixel: Pixel) => boolean) | null): void {
    this.grabTest = test;
  }

  /** Whether a press at this pixel would pan the map. */
  pansOnPress(pixel: Pixel): boolean {
    return !(this.grabTest?.(pixel) ?? false);
  }

  setDragPreview(item: DrawItem | null): void {
    this.dragPreview = item;
  }

  /** The highlighted items, as last set; and how often it was set. */
  highlight: readonly DrawItem[] = [];
  highlightCalls = 0;

  setHighlight(items: readonly DrawItem[]): void {
    this.highlight = items;
    this.highlightCalls++;
  }

  /** Ids of the highlighted items. */
  get highlighted(): string[] {
    return this.highlight.map((item) => item.id);
  }

  dragHover = false;

  setDragHover(hover: boolean): void {
    this.dragHover = hover;
  }

  // ---- Test hooks ----

  pointer(type: EnginePointerEvent['type'], pixel: Pixel, keys?: 'add' | 'other'): void {
    this.pointers.emit(keys === undefined ? { type, pixel } : { type, pixel, keys });
  }

  /** A right click at a pixel; the menu opens at the page point 100 px right and 50 px down of it. */
  menu(pixel: Pixel): void {
    this.pointers.emit({ type: 'menu', pixel, page: [pixel[0] + 100, pixel[1] + 50] });
  }

  /** The user drew a selection box. */
  selectBox(from: Pixel, to: Pixel): void {
    this.boxes.emit({ from, to });
  }

  escape(): void {
    this.escapes.emit(undefined);
  }

  /** The pixel of a lon/lat position in the current view. */
  pixelOf(position: Position): Pixel {
    const xy = this.projection.forward(position);
    if (xy === null || this.view === null) throw new Error('not on the map');
    return mapToPixel(this.view, xy);
  }

  /** Item ids of a layer in drawing order. */
  idsIn(layerId: Uuid): Uuid[] {
    return [...(this.items.get(layerId)?.keys() ?? [])];
  }

  get listenerCount(): number {
    return this.viewChanges.size + this.pointers.size + this.escapes.size + this.boxes.size;
  }
}

function firstPositionOf(item: DrawItem): Position {
  if (item.kind === 'line') return item.positions[0] ?? [0, 0];
  if (item.kind === 'polygon') return item.rings[0]?.[0] ?? [0, 0];
  if (item.kind === 'graphic') return item.points[0] ?? [0, 0];
  return item.position;
}
