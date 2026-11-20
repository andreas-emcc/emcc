/**
 * The OpenLayers engine (ADR-0009): the only code of the plugin that uses OpenLayers. It draws
 * what the controller gives it and reports pointer events; it decides nothing about the live
 * picture. No OpenLayers type leaves this folder (criterion 12).
 *
 * Layer stack, bottom to top:
 * - the background map (tiles) or, without one, a graticule on a neutral background;
 * - one WebGL layer per map layer. They are kept next to each other with one class name, so
 *   OpenLayers draws them all with one WebGL context (browsers allow only a few contexts);
 * - Canvas layers: the texts of symbols and the labels of shapes below the text threshold (brief
 *   function 6; the symbols themselves stay on their layers, T-087), the plugins' overlays, and the
 *   drag preview. They are few, so Canvas is fast enough.
 *
 * Listeners (review remark N6): the pointer listeners are on the map's own viewport element and
 * live as long as the engine, which lives as long as the page (SDK v0 has no teardown; design
 * pattern FAQ). Those on the document, Escape and a grab's moves and release, are there only while
 * the map is mounted.
 */
import Feature from 'ol/Feature.js';
import OlMap from 'ol/Map.js';
import View from 'ol/View.js';
import Attribution from 'ol/control/Attribution.js';
import ScaleLine from 'ol/control/ScaleLine.js';
import Zoom from 'ol/control/Zoom.js';
import type { FeatureLike } from 'ol/Feature.js';
import LineString from 'ol/geom/LineString.js';
import MultiPoint from 'ol/geom/MultiPoint.js';
import Point from 'ol/geom/Point.js';
import MultiLineString from 'ol/geom/MultiLineString.js';
import MultiPolygon from 'ol/geom/MultiPolygon.js';
import Polygon from 'ol/geom/Polygon.js';
import Kinetic from 'ol/Kinetic.js';
import { never, noModifierKeys, primaryAction } from 'ol/events/condition.js';
import DoubleClickZoom from 'ol/interaction/DoubleClickZoom.js';
import DragBox from 'ol/interaction/DragBox.js';
import Draw from 'ol/interaction/Draw.js';
import Modify from 'ol/interaction/Modify.js';
import Translate from 'ol/interaction/Translate.js';
import Collection from 'ol/Collection.js';
import RegularShape from 'ol/style/RegularShape.js';
import DragPan from 'ol/interaction/DragPan.js';
import { defaults as defaultInteractions } from 'ol/interaction/defaults.js';
import type BaseLayer from 'ol/layer/Base.js';
import Graticule from 'ol/layer/Graticule.js';
import Layer from 'ol/layer/Layer.js';
import TileLayer from 'ol/layer/Tile.js';
import VectorLayer from 'ol/layer/Vector.js';
import VectorImageLayer from 'ol/layer/VectorImage.js';
import WebGLVectorLayer from 'ol/layer/WebGLVector.js';
import { addCommon, clearAllProjections, get as getOlProjection } from 'ol/proj.js';
import { register } from 'ol/proj/proj4.js';
import VectorSource from 'ol/source/Vector.js';
import XYZ from 'ol/source/XYZ.js';
import CircleStyle from 'ol/style/Circle.js';
import Fill from 'ol/style/Fill.js';
import Stroke from 'ol/style/Stroke.js';
import Style from 'ol/style/Style.js';
import proj4 from 'proj4';
import type { DrawKind, LabelPlaces, MilSymbol, Pixel, PluginLog, Style as ShapeStyle, SymbolImage, SymbolService, Uuid } from '@emc2/plugin-sdk';
import { arrowRotation, attributionHtml, cssColor, dashPattern, northOnScreen } from '../core/appearance.ts';
import { hasOffListText, NO_PLACED_LABELS, placedTexts, samePlaces, type PlacedText } from '../core/labelPlaces.ts';
import { DEFAULT_TEXT_LOOK, sameTextLook, type TextLook } from '../core/look.ts';
import { supportsProjection } from '../core/background.ts';
import { clusterLabel, clusterRadius, IDENTITIES, IDENTITY_COLOURS, type ClusterItem } from '../core/clusters.ts';
import { appearanceKey, drawWithText, steppedSymbol, symbolRequest, type DrawItem } from '../core/drawData.ts';
import { speedVectorItem } from '../core/vectors.ts';
import type { DisplayOptions, DrawingOptions, EditingOptions, Engine, EngineBackground, EngineLayer, EnginePointerEvent, InteractionMode, Unlisten } from '../core/engine.ts';
import type { PreparedVector } from '../core/vectorBackground.ts';
import type { PickCandidate, PixelBox } from '../core/pick.ts';
import type { Projection } from '../core/projections.ts';
import { mapToPixel, pixelToMap, type ViewState } from '../core/viewport.ts';
import { TextMeter } from './textMeter.ts';
import { arrowheadImage, arrowImage, createCanvas, hatchImage, loadImages, SymbolAtlas, textOnly, type AtlasEntry } from './atlas.ts';
import { boxCorners, DRAGGED_KINDS, drawnGeometry, outlineOf, type DrawnShape, type EditShape, type XY } from '../core/drawing.ts';
import { LayerSwap, type LayerSwapPort } from './layerSwap.ts';
import { EXTRA_IDS, extraFeatures, fillFeatures, geometryOf, IN_ATLAS, toFeature, type FeatureContext, type PendingImage } from './features.ts';
import { wmsLayer } from './wms.ts';
import { DashPatterns, graphicCanvasFeatures, graphicFeatureCount, graphicFeatureId, graphicFeatures, graphicHighlightFeatures, graphicImageFeatures, graphicLabelFeatures, graphicOwner } from './graphicFeatures.ts';
import { GraphicImageCache } from './graphicImages.ts';
import { listenForDrawingKeys, listenForEscape } from './keyboard.ts';
import { addKeyOnly, clickKeys } from './modifiers.ts';

import { PointerRouter } from './pointer.ts';
import { canvasLineExtras, canvasStyles, drawPreviewStyle, FALLBACK_RADIUS, highlightStyles, iconOf, KIND, layerStyle, opacityOf, overlayLabelStyle, P, POINT_RADIUS, placedLabelStyle, shapeLabelStyle, textBox, textObjectStyle, TEXT_ITEM, type DashRules, type ImageReach } from './styles.ts';

export { isMac } from './modifiers.ts';

type Source = VectorSource<Feature>;

interface MapLayer {
  /** The WebGL layer; another one takes its place when the style is swapped (`beginSwap`, T-200). */
  layer: WebGLVectorLayer<Source>;
  readonly source: Source;
  stack: number;
  /** The ids of the layer's items that are text objects (brief function 45). */
  readonly textIds: Set<Uuid>;
  /** The canvas layer over the layer's WebGL layer that draws its text objects, there while there are any: the WebGL layer cannot draw text. */
  textLayer: VectorLayer<Source> | null;
}

export interface OlEngineOptions {
  readonly projection: Projection;
  readonly center: readonly [number, number];
  readonly resolution: number;
  /** Symbol size in CSS pixels (settings). */
  readonly symbolSize: number;
  /** Up to this many visible symbols, symbols are drawn with text (settings). */
  readonly textThreshold: number;
  readonly log: PluginLog;
  /** On a Mac the add key is Cmd, elsewhere Ctrl (brief function 14). Default false. */
  readonly mac?: boolean;
  /** The least time between two swaps of the WebGL style, in ms (T-200); {@link STYLE_SWAP_INTERVAL_MS} by default. For tests. */
  readonly styleSwapIntervalMs?: number;
  /** Loads the images a new style names before it is used; `loadImages` by default. For tests. */
  readonly loadImages?: (urls: readonly string[]) => Promise<void> | null;
}

/**
 * The projections registered with OpenLayers so far, by code: kept for the page's lifetime on
 * purpose (a few codes at most), so their extents can be set again after OpenLayers is cleared.
 */
const registered = new Map<string, Projection>();

/**
 * Registers the configured projections with OpenLayers, after proj4 (`registerProjections`).
 * OpenLayers' `register` keeps the projection and conversions it already has for a code, so when a
 * settings change gives a code a new definition, they are all dropped and registered again from
 * proj4; otherwise the graticule and the scale line would keep the old one (review R9, owner
 * 2026-10-13). OpenLayers' built-in EPSG:4326 and EPSG:3857 with their aliases come back first
 * (`addCommon`, as OpenLayers asks after a clear). Only this plugin uses OpenLayers.
 */
export function registerWithOpenLayers(projections: readonly Projection[]): void {
  if (projections.some((p) => (registered.get(p.def.code)?.def.proj4 ?? p.def.proj4) !== p.def.proj4)) {
    clearAllProjections();
    addCommon();
  }
  for (const projection of projections) registered.set(projection.def.code, projection);
  register(proj4);
  for (const projection of registered.values()) {
    const ol = getOlProjection(projection.def.code);
    if (ol === null) continue;
    ol.setExtent([...projection.def.extent]);
    ol.setWorldExtent([...projection.def.worldExtent]);
    ol.setGlobal(projection.wrapsX);
  }
}

const WEBGL_CLASS = 'map-view-2d-layer';
/**
 * How long double-click zoom stays off after placing or dragging ends: longer than OpenLayers'
 * double-click window (250 ms). The second click of a double-click can end the interaction, and
 * OpenLayers sends its dblclick right after that click.
 */
export const DOUBLE_CLICK_GRACE_MS = 300;
const BASE_Z = 10;
/** A layer's text objects are drawn just over the layer, under the next one (brief function 45). */
const TEXT_Z_OFFSET = 0.5;
/** A text object lies over the other items of its layer, so it is picked before them. */
const TEXT_PICK_ORDER = 1_000_000_000;
const LABELS_Z = 1_000_000;
/** The labels every `render` call passes: none. The map view draws the placed labels itself, and `symbology` then draws only the amplifiers that cannot be placed (CR-0043 part A). */
const NO_LABELS: readonly never[] = [];
/** The WebGL style is swapped for one with a bigger atlas at most four times a second (T-200, brief function 33). */
export const STYLE_SWAP_INTERVAL_MS = 250;
/** A style swap does not wait longer than this for its images to load and decode: a browser that does not finish (a page in the background) must not stop every new symbol from being drawn. */
export const IMAGE_LOAD_TIMEOUT_MS = 3_000;
/** The feature property of a waiting symbol's Canvas feature that holds its style, which an empty style stands in for while its layer is hidden. */
const PENDING_STYLE = 'pendingStyle';
const HIDDEN_STYLE = new Style({});
/** The dim layer: above the background (0, 1), below every object layer (from BASE_Z). */
const DIM_Z = 2;

export class OpenLayersEngine implements Engine {
  projection: Projection;
  private readonly map: OlMap;
  private readonly layers = new Map<Uuid, MapLayer>();
  private readonly items = new Map<Uuid, Map<Uuid, DrawItem>>();
  private readonly overlays = new Map<string, readonly DrawItem[]>();
  private preview: DrawItem | null = null;
  private symbols: SymbolService | null = null;
  private atlas: SymbolAtlas;
  /** Whether the atlas holds a vessel: its images depend on the look's ground colour, so a new look draws them again (function 33). */
  private vesselsInAtlas = false;
  /** What the WebGL style was made for: the atlas and the dash patterns of the graphics; another value means the style is made again. */
  private styleKey = '0:0'; // the style the engine starts with has no atlas and no dash pattern
  /**
   * The style the layers have (T-200): a new atlas image is built, loaded and decoded first, and the style is swapped
   * for one that names it (`requestSwap`), because OpenLayers draws nothing of a style's images until they have loaded.
   */
  private shownStyle: ReturnType<typeof layerStyle>;
  /** The atlas version the shown style holds: an image added after it is drawn when the style is swapped. */
  private shownVersion = 0;
  /** Counts the atlases that were started again: a swap that was loading for an older one is dropped. */
  private atlasGeneration = 0;
  private swapTimer: number | null = null;
  /** How many swaps in a row were given up because the new layers did not get ready (`LayerSwap`): each makes the next wait twice as long. */
  private swapGiveUps = 0;
  /** True from the moment a swap has loaded its images to the moment its layers are in place. */
  private swapLoading = false;
  /** The swap whose new layers are being made ready, if any (`beginSwap`). */
  private layerSwap: LayerSwap<WebGLVectorLayer<Source>> | null = null;
  private lastSwapAt = Number.NEGATIVE_INFINITY;
  /** The symbol features that wait for the atlas image to hold their symbol: feature → atlas key. */
  private readonly pending = new Map<Feature, string>();
  /**
   * The images of the atlas entries the shown atlas image does not hold yet: a symbol that waits is drawn from its own image on a Canvas
   * layer, so that a new symbol is always drawn at once, with or without a GPU and however long the swap takes (T-200; ITA).
   */
  private readonly recentImages = new Map<string, SymbolImage>();
  /** The Canvas features that draw the waiting symbols: the symbol's WebGL feature → its Canvas feature. */
  private readonly pendingCanvas = new Map<Feature, Feature>();
  private readonly pendingSource = new VectorSource<Feature>();
  private readonly dashes = new DashPatterns();
  /** The decoded images inside tactical graphics (brief function 37); a decoded one asks for the labels and the preview to be drawn again. */
  private readonly graphicImages = new GraphicImageCache(() => {
    this.scheduleLabels();
    if (this.preview?.kind === 'graphic') this.setDragPreview(this.preview);
  });
  private arrow: { readonly canvas: HTMLCanvasElement; readonly anchor: readonly [number, number]; readonly url: string };
  /** The hatch tile of hatched fills, as a URL for the WebGL style. */
  private readonly hatchUrl = hatchImage(createCanvas).toDataURL('image/png');
  /** The arrowhead of lines with `arrowhead: 'end'`: the image for the Canvas, its URL for the WebGL style. */
  private readonly arrowhead = arrowheadImage(createCanvas);
  private readonly arrowheadUrl = this.arrowhead.toDataURL('image/png');
  /** Symbol size and text threshold, from the settings; they may change while the map runs. */
  private symbolSize: number;
  private textThreshold: number;
  /** The label at each place round a symbol, drawn as text by the map view (SDK 1.8.0, CR-0043 part A; brief function 35). */
  private labelPlaces: LabelPlaces = NO_PLACED_LABELS.labelPlaces;
  /** Whether a symbol with a direction gets the direction arrow. */
  private directionArrow = true;
  /** The speed vector's seconds of travel; 0 draws none (brief functions 35 and 38). */
  private speedVectorSeconds = 0;
  /**
   * The sensor report symbol as the service last gave it (brief function 39); undefined before it was asked. Another
   * image makes `sensorReportGeneration` one higher: the atlas key has it, so the new image gets its own entry.
   */
  private sensorReportImage: SymbolImage | null | undefined = undefined;
  private sensorReportGeneration = 0;
  /** The image changed: the next tick of the once-a-second look draws the symbols in view again. */
  private sensorReportStale = false;
  /** The once-a-second look at the image, from the first sensor report drawn until the map is unmounted. */
  private sensorReportTimer: number | null = null;
  private seq = 0;
  private background: EngineBackground | null = null;
  private backgroundLayer: BaseLayer | null = null;
  private readonly labels = new VectorSource<Feature>();
  /** Clusters (brief function 12): above all object layers, below the texts of symbols and labels. */
  private readonly clusterSource = new VectorSource();
  /** The clusters drawn now, kept in lon/lat so a projection change can draw them again. */
  private clusters: readonly ClusterItem[] = [];
  /** Shape labels and cluster counts in the look's colours and fonts (brief function 21). */
  private textLook: TextLook = DEFAULT_TEXT_LOOK;
  /** The width of a text object's text as drawn, for the box it is picked and highlighted on (SN A). */
  private readonly textMeter = new TextMeter(() => createCanvas().getContext('2d'));
  /** The styles of text objects by what they depend on; empty when the look changes (brief function 45). */
  private readonly textStyles = new Map<string, Style>();
  private readonly highlightSource = new VectorSource<Feature>();
  /** Black over the background at the dim level (brief function 19); an element of its own, so nothing else darkens. */
  private readonly dimElement = dimElementFor(document);
  private readonly dimLayer = new Layer({ zIndex: DIM_Z, visible: false, className: 'map-view-2d-dim', render: () => this.dimElement });
  private highlighted: readonly DrawItem[] = [];
  private mode: InteractionMode = 'none';
  /** The running edit (brief function 17): its layer, interactions and keys. */
  private editing: { readonly layer: VectorLayer<VectorSource<Feature>>; readonly interactions: readonly (Translate | Modify)[]; readonly stopKeys: () => void; readonly onEnd: (shape: null) => void } | null = null;
  /** The running drawing (brief function 17), with what stops its keys. */
  /** `started`: a point is set (a polygon or a line) or the press is down (the dragged kinds), from OpenLayers' drawstart, drawabort and drawend. */
  private drawing: { readonly kind: DrawKind; readonly interaction: Draw; readonly stopKeys: () => void; readonly onEnd: (shape: null) => void; started: boolean; readonly added: () => number | null } | null = null;
  /** OpenLayers' double-click zoom: off while a point is picked or an object dragged (T-032). */
  private readonly doubleClickZoom: DoubleClickZoom | undefined;
  private doubleClickZoomTimer: number | null = null;
  private readonly overlaySource = new VectorSource<Feature>();
  private readonly previewSource = new VectorSource<Feature>();
  private readonly labelImages = new Map<Uuid, { readonly key: string; readonly image: SymbolImage }>();
  private labelsPending = false;
  private readonly pointers: PointerRouter;
  private readonly viewListeners = new Set<() => void>();
  private readonly pointerListeners = new Set<(event: EnginePointerEvent) => void>();
  private readonly escapeListeners = new Set<() => void>();
  private readonly boxListeners = new Set<(box: PixelBox) => void>();
  private readonly featureContext: FeatureContext;

  constructor(private readonly options: OlEngineOptions) {
    this.projection = options.projection;
    this.symbolSize = options.symbolSize;
    this.textThreshold = options.textThreshold;
    this.atlas = new SymbolAtlas(createCanvas);
    this.arrow = arrowFor(this.symbolSize);
    this.shownStyle = this.styleFor(null, []);
    // Review note 5 (T-054 part A): without a 2D canvas the images below come out blank.
    if (createCanvas().getContext('2d') === null) {
      options.log.warn('this browser draws no 2D canvas: symbol images, direction arrows, hatched fills and arrowheads stay blank');
    }
    const projectionOf = () => this.projection;
    const directionArrowOf = () => this.directionArrow;
    this.featureContext = {
      get projection() {
        return projectionOf();
      },
      atlasEntry: (symbol) => this.shownEntry(appearanceKey(symbol), this.atlasEntry(symbol)),
      sensorReportEntry: () => {
        const entry = this.sensorReportEntry();
        return entry === null ? null : this.shownEntry(this.sensorReportKey(), entry);
      },
      get directionArrow() {
        return directionArrowOf();
      },
      nextSeq: () => ++this.seq,
    };

    // The default interactions, but our own pan: it stays on in every mode and only leaves out a
    // press the grab test claims (a press on the object being dragged, brief function 8).
    const interactions = defaultInteractions({ altShiftDragRotate: false, pinchRotate: false, dragPan: false });
    this.doubleClickZoom = interactions.getArray().find((i): i is DoubleClickZoom => i instanceof DoubleClickZoom);
    interactions.push(new DragPan({
      kinetic: new Kinetic(-0.005, 0.05, 100), // as in OpenLayers' defaults
      condition: (event) => noModifierKeys(event) && primaryAction(event) && !this.pointers.claims([event.pixel[0] ?? 0, event.pixel[1] ?? 0]),
    }));
    // The selection box (brief function 14): the add key with a drag, also when it starts on an
    // object, but not while a point is picked or a shape drawn or edited (owner, 2026-10-16).
    const selectBox = new DragBox({
      className: 'map-view-2d-select-box',
      condition: (event) => (this.mode === 'none' || this.mode === 'drag-object') && primaryAction(event) && addKeyOnly(event.originalEvent, options.mac ?? false),
    });
    let boxStart: Pixel = [0, 0];
    selectBox.on('boxstart', (event) => {
      boxStart = [event.mapBrowserEvent.pixel[0] ?? 0, event.mapBrowserEvent.pixel[1] ?? 0];
    });
    selectBox.on('boxend', (event) => {
      const box: PixelBox = { from: boxStart, to: [event.mapBrowserEvent.pixel[0] ?? 0, event.mapBrowserEvent.pixel[1] ?? 0] };
      for (const listener of [...this.boxListeners]) listener(box);
    });
    interactions.push(selectBox);
    this.map = new OlMap({
      controls: [
        new Zoom({ className: 'map-view-2d-zoom' }),
        new ScaleLine({ className: 'map-view-2d-scale-line' }),
        new Attribution({ className: 'map-view-2d-attribution', collapsible: false }),
      ],
      interactions,
      layers: [
        this.dimLayer,
        new VectorLayer({ source: this.pendingSource, zIndex: LABELS_Z - 2, updateWhileInteracting: true, updateWhileAnimating: true }),
        new VectorLayer({ source: this.clusterSource, zIndex: LABELS_Z - 1 }),
        new VectorLayer({ source: this.labels, zIndex: LABELS_Z }),
        new VectorLayer({ source: this.highlightSource, zIndex: LABELS_Z + 1 }),
        new VectorLayer({ source: this.overlaySource, zIndex: LABELS_Z + 2 }),
        new VectorLayer({ source: this.previewSource, zIndex: LABELS_Z + 3 }),
      ],
      view: this.createView(options.projection, options.center, options.resolution),
    });
    this.rebuildBackground();

    const emitView = () => {
      for (const listener of [...this.viewListeners]) listener();
      this.scheduleLabels();
    };
    this.map.on('postrender', () => {
      const swap = this.layerSwap;
      if (swap === null) return;
      swap.frame();
      // An idle map draws no frame of its own, and the new layers need one after they have their buffers: ask for the next while the swap waits.
      if (swap.busy) this.map.render();
    });
    this.map.on('moveend', emitView);
    this.map.on('change:size', emitView);
    this.map.on('click', (event) => {
      this.emitPointer('click', [event.pixel[0] ?? 0, event.pixel[1] ?? 0], clickKeys(event.originalEvent, options.mac ?? false));
    });
    // A right click (Ctrl+click on a Mac) is the map view's menu (brief function 15), never the browser's.
    this.map.getViewport().addEventListener('contextmenu', (event) => {
      event.preventDefault();
      const [x, y] = this.map.getEventPixel(event);
      this.emit({ type: 'menu', pixel: [x ?? 0, y ?? 0], page: [event.clientX, event.clientY] });
    });
    // While a shape is drawn, the right button is the map view's (brief function 27): OpenLayers' Draw would take its
    // press for a point or the start of a drag. Heard first (capture), so that OpenLayers never sees it.
    for (const type of ['pointerdown', 'pointerup'] as const) {
      this.map.getViewport().addEventListener(type, (event) => {
        if (this.drawing !== null && event.button === 2) event.stopImmediatePropagation();
      }, true);
    }
    this.pointers = new PointerRouter(
      this.map.getViewport(),
      (event) => {
        const [x, y] = this.map.getEventPixel(event);
        return [x ?? 0, y ?? 0];
      },
      (event) => {
        this.emitPointer(event.type, event.pixel);
      },
    );
  }

  /** Shows the map in the Map Pane; returns what undoes it. */
  mount(element: HTMLElement): () => void {
    const target = document.createElement('div');
    target.className = 'map-view-2d-map';
    element.appendChild(target);
    this.map.setTarget(target);
    this.map.updateSize();
    // Escape counts while the map is shown; its listener is on the document, so it goes with the map.
    const stopEscape = listenForEscape(element.ownerDocument, () => {
      for (const listener of [...this.escapeListeners]) listener();
    });
    // A font that arrives after a text was measured changes its width (SN A): measure again.
    const fonts = (element.ownerDocument as unknown as { fonts?: FontFaceSet }).fonts;
    const fontsLoaded = (): void => {
      this.textMeter.clear();
      this.setHighlight(this.highlighted);
    };
    fonts?.addEventListener('loadingdone', fontsLoaded);
    return () => {
      stopEscape();
      fonts?.removeEventListener('loadingdone', fontsLoaded);
      this.stopSensorReportWatch();
      // A drawing ends with the map (review finding 1, owner 2026-10-16): its caller gets null, and
      // its keys do not stay on the page. pickPoint and dragObject wait for the map to come back.
      const drawing = this.drawing;
      if (drawing !== null) {
        this.stopDrawing();
        drawing.onEnd(null);
      }
      const editing = this.editing;
      if (editing !== null) {
        this.stopEditing();
        editing.onEnd(null);
      }
      this.pointers.cancelGrab();
      this.map.setTarget(undefined);
      target.remove();
    };
  }

  // ---- View ----

  get view(): ViewState | null {
    const size = this.map.getSize();
    const view = this.map.getView();
    const center = view.getCenter();
    const resolution = view.getResolution();
    const [width, height] = size ?? [];
    if (width === undefined || height === undefined || width === 0 || height === 0 || center === undefined || resolution === undefined) return null;
    return { width, height, center: [center[0] ?? 0, center[1] ?? 0], resolution };
  }

  setProjection(projection: Projection, center: readonly [number, number], resolution: number): void {
    this.projection = projection;
    this.map.setView(this.createView(projection, center, resolution));
    this.redrawEverything();
    this.setClusters(this.clusters); // projected again (conformance review B1)
    this.rebuildBackground();
    for (const listener of [...this.viewListeners]) listener();
  }

  setView(center: readonly [number, number], resolution?: number): void {
    const view = this.map.getView();
    view.setCenter([...center]);
    if (resolution !== undefined) view.setResolution(resolution);
  }

  onViewChange(listener: () => void): Unlisten {
    return subscribe(this.viewListeners, listener);
  }

  onPointer(listener: (event: EnginePointerEvent) => void): Unlisten {
    return subscribe(this.pointerListeners, listener);
  }

  onEscape(listener: () => void): Unlisten {
    return subscribe(this.escapeListeners, listener);
  }

  onSelectBox(listener: (box: PixelBox) => void): Unlisten {
    return subscribe(this.boxListeners, listener);
  }

  private createView(projection: Projection, center: readonly [number, number], resolution: number): View {
    return new View({
      projection: projection.def.code,
      center: [...center],
      resolution,
      enableRotation: false,
      maxZoom: 24,
      // A projection that does not repeat sideways keeps its centre inside the extent.
      ...(projection.wrapsX ? {} : { extent: [...projection.def.extent], constrainOnlyCenter: true }),
    });
  }

  /** The OpenLayers projection object, for queries that wrap around the world. */
  private olProjection() {
    return getOlProjection(this.projection.def.code) ?? undefined;
  }

  private emitPointer(type: EnginePointerEvent['type'], pixel: Pixel, keys?: 'add' | 'other'): void {
    this.emit(keys === undefined ? { type, pixel } : { type, pixel, keys });
  }

  private emit(event: EnginePointerEvent): void {
    for (const listener of [...this.pointerListeners]) listener(event);
  }

  // ---- Layers and items ----

  setLayers(layers: readonly EngineLayer[]): void {
    const wanted = new Set(layers.map((l) => l.id));
    for (const [id, entry] of this.layers) {
      if (wanted.has(id)) continue;
      this.layerSwap?.drop(id);
      this.map.removeLayer(entry.layer);
      entry.layer.dispose();
      entry.textIds.clear();
      this.syncTextLayer(entry);
      this.layers.delete(id);
      this.items.delete(id);
      this.prunePendingCanvas();
    }
    for (const { id, stack, visible } of layers) {
      let entry = this.layers.get(id);
      if (entry === undefined) {
        const source: Source = new VectorSource({ wrapX: true });
        const layer = this.newWebglLayer(source, this.currentStyle());
        entry = { layer, source, stack, textIds: new Set(), textLayer: null };
        this.layers.set(id, entry);
        this.items.set(id, new Map());
        this.map.addLayer(layer);
      }
      entry.stack = stack;
      entry.layer.setZIndex(BASE_Z + stack);
      entry.layer.setVisible(visible);
      this.syncPendingVisibility();
      entry.textLayer?.setZIndex(BASE_Z + stack + TEXT_Z_OFFSET);
      entry.textLayer?.setVisible(visible);
    }
    this.scheduleLabels();
  }

  replaceItems(layerId: Uuid, items: readonly DrawItem[]): void {
    const entry = this.layers.get(layerId);
    if (entry === undefined) return;
    this.items.set(layerId, new Map(items.map((item) => [item.id, item])));
    entry.source.clear(true);
    const made = this.features(items);
    entry.source.addFeatures(made);
    this.prunePendingCanvas();
    this.showPending(made);
    entry.textIds.clear();
    for (const item of items) if (item.kind === 'textobject') entry.textIds.add(item.id);
    this.syncTextLayer(entry);
    this.afterDraw();
  }

  updateItems(layerId: Uuid, changes: ReadonlyMap<Uuid, DrawItem | null>): void {
    const entry = this.layers.get(layerId);
    const stored = this.items.get(layerId);
    if (entry === undefined || stored === undefined) return;
    const added: Feature[] = [];
    for (const [id, item] of changes) {
      const before = stored.get(id);
      const oldImage = this.shownImageOf(entry.source.getFeatureById(id));
      const drawn = before?.kind === 'graphic' && before.parts !== null ? graphicFeatureCount(before, this.projection) : 0;
      for (const featureId of [id, ...EXTRA_IDS.map((suffix) => `${id}${suffix}`), ...Array.from({ length: drawn }, (_, n) => graphicFeatureId(id, n))]) {
        const old = entry.source.getFeatureById(featureId);
        if (old !== null) {
          this.dropPendingCanvas(old);
          this.pending.delete(old);
          entry.source.removeFeature(old);
        }
      }
      entry.textIds.delete(id);
      stored.delete(id);
      if (item === null) continue;
      if (item.kind === 'textobject') entry.textIds.add(id);
      stored.set(id, item);
      const made = this.features([item]);
      // A symbol whose new image is not in the shown atlas yet keeps the image it had, instead of vanishing until the swap.
      if (oldImage !== null) {
        const main = made.find((feature) => feature.getId() === id);
        if (main?.get(P.inAtlas) === IN_ATLAS.pending) main.setProperties({ ...oldImage, [P.inAtlas]: IN_ATLAS.yes }, true);
      }
      added.push(...made);
    }
    entry.source.addFeatures(added);
    this.showPending(added);
    this.syncTextLayer(entry);
    this.afterDraw();
  }

  /** The canvas layer that draws a layer's text objects is there while it has any (brief function 45), over the layer and under the next one. */
  private syncTextLayer(entry: MapLayer): void {
    if (entry.textIds.size > 0 && entry.textLayer === null) {
      entry.textLayer = new VectorLayer({
        source: entry.source,
        style: (feature) => this.textStyleOf(feature),
        zIndex: BASE_Z + entry.stack + TEXT_Z_OFFSET,
        visible: entry.layer.getVisible(),
        updateWhileInteracting: true,
        updateWhileAnimating: true,
      });
      this.map.addLayer(entry.textLayer);
    } else if (entry.textIds.size === 0 && entry.textLayer !== null) {
      this.map.removeLayer(entry.textLayer);
      entry.textLayer.dispose();
      entry.textLayer = null;
    }
  }

  /** The style of a feature in a text layer: its text, for a text object; nothing for the rest of the layer's features. */
  private textStyleOf(feature: FeatureLike): Style | undefined {
    if (feature.get(P.kind) !== KIND.text) return undefined;
    const item = feature.get(TEXT_ITEM) as Extract<DrawItem, { kind: 'textobject' }> | undefined;
    if (item === undefined) return undefined;
    const rotation = Number(feature.get(P.rotation) ?? 0);
    const key = `${item.text}|${String(item.size)}|${item.color ?? ''}|${rotation.toFixed(5)}|${String(opacityOf(item))}`;
    let style = this.textStyles.get(key);
    if (style === undefined) {
      if (this.textStyles.size > 2_000) this.textStyles.clear();
      style = textObjectStyle(item, rotation, 0, this.textLook);
      this.textStyles.set(key, style);
    }
    return style;
  }

  private features(items: Iterable<DrawItem>): Feature[] {
    const features: Feature[] = [];
    for (const item of items) {
      // A tactical graphic that has been drawn is features of its own, under the symbols (brief function 29).
      if (item.kind === 'graphic' && item.parts !== null) {
        features.push(...graphicFeatures(item, this.projection, () => this.featureContext.nextSeq(), this.dashes));
        continue;
      }
      const feature = toFeature(item, this.featureContext);
      if (feature === null) continue;
      if (item.kind === 'symbol' && feature.get(P.inAtlas) === IN_ATLAS.pending) this.pending.set(feature, this.drawnAsSensorReport(item) ? this.sensorReportKey() : appearanceKey(item.symbol));
      features.push(...fillFeatures(item, this.featureContext), feature, ...extraFeatures(item, this.featureContext)); // a crossing outline's fill goes under it
      // A sensor report is the admin's image and nothing else: no speed vector (brief function 39).
      if (item.kind === 'symbol' && this.speedVectorSeconds > 0 && !this.drawnAsSensorReport(item)) {
        const vector = speedVectorItem(item, this.speedVectorSeconds);
        const drawn = vector === null ? null : toFeature(vector, this.featureContext);
        if (drawn !== null) {
          features.push(drawn);
          feature.set(P.hasArrow, 0); // where a speed vector is drawn the map view's own direction arrow is not (owner, LB, 2026-11-08)
        }
      }
    }
    return features;
  }

  /** New symbol images in the atlas need the new atlas in every layer's style: swapped, not at once (`requestSwap`). */
  private afterDraw(): void {
    if (this.styleKeyNow() !== this.styleKey) this.requestSwap();
    this.scheduleLabels();
  }

  private styleKeyNow(): string {
    return `${String(this.atlas.version)}:${String(this.dashes.version)}`;
  }

  /** The style the layers have now: a layer made later starts with it. */
  private currentStyle() {
    return this.shownStyle;
  }

  private styleFor(atlasUrl: string | null, dashes: DashRules) {
    return layerStyle({ atlas: atlasUrl, arrow: this.arrow.url, arrowAnchor: this.arrow.anchor, hatch: this.hatchUrl, arrowhead: this.arrowheadUrl }, dashes);
  }

  /**
   * The style is to be swapped for one that names the atlas as it is now (T-200; brief function 33). At most four times a
   * second, so the images that came in between go together; the atlas image is built and decoded before the swap, so
   * no frame is drawn without it; until then the layers keep the style they have.
   */
  private requestSwap(): void {
    if (this.swapTimer !== null || this.swapLoading) return;
    const wait = this.lastSwapAt + (this.options.styleSwapIntervalMs ?? STYLE_SWAP_INTERVAL_MS) * 2 ** Math.min(this.swapGiveUps, 5) - performance.now(); // twice as long after each swap given up, so a map whose layers never get ready does not draw for ever
    if (wait <= 0) {
      this.startSwap();
      return;
    }
    this.swapTimer = window.setTimeout(() => {
      this.swapTimer = null;
      this.startSwap();
    }, wait);
  }

  private startSwap(): void {
    const version = this.atlas.version;
    const dashVersion = this.dashes.version;
    const generation = this.atlasGeneration;
    const atlasUrl = this.atlas.isEmpty ? null : this.atlas.url();
    const style = this.styleFor(atlasUrl, this.dashes.patterns);
    const loading = (this.options.loadImages ?? loadImages)([...(atlasUrl === null ? [] : [atlasUrl]), this.arrow.url, this.hatchUrl, this.arrowheadUrl]);
    if (loading === null) {
      this.applySwap(version, dashVersion, style);
      return;
    }
    this.swapLoading = true;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(giveUp);
      this.swapLoading = false;
      if (generation !== this.atlasGeneration) this.requestSwap(); // the atlas was started again meanwhile: that one is wanted
      else this.applySwap(version, dashVersion, style);
    };
    const giveUp = window.setTimeout(done, IMAGE_LOAD_TIMEOUT_MS); // the images are not ready in time: swapped all the same
    void loading.then(done, done); // an image that cannot be decoded: the style is swapped all the same
  }

  /**
   * The images are loaded. A map that is shown gets the style on **new layers** that take over when they have drawn
   * (`LayerSwap`): `setStyle` on a layer in use blanks it until its new renderer has its buffers. A map that is not shown
   * draws nothing, so the layers have the style at once.
   */
  private applySwap(version: number, dashVersion: number, style: ReturnType<typeof layerStyle>): void {
    if (this.map.getTarget() === undefined || this.layers.size === 0) {
      for (const entry of this.layers.values()) entry.layer.setStyle(style);
      this.swapDone(version, dashVersion, style);
      return;
    }
    const ids = [...this.layers.keys()];
    this.swapLoading = true;
    const port: LayerSwapPort<WebGLVectorLayer<Source>> = {
      add: (id) => {
        const source = (this.layers.get(id) as MapLayer).source;
        const layer = this.newWebglLayer(source, style);
        layer.setZIndex(BASE_Z + (this.layers.get(id) as MapLayer).stack);
        layer.setVisible((this.layers.get(id) as MapLayer).layer.getVisible());
        this.map.addLayer(layer);
        return layer;
      },
      // OpenLayers' renderer starts `ready`, and builds its buffers only while the view is not moving: it has them when it is ready and they exist.
      ready: (layer) => {
        const renderer = layer.getRenderer() as unknown as { ready?: boolean; buffers_?: unknown } | null;
        return renderer?.ready === true && renderer.buffers_ !== null;
      },
      replace: (id, next) => {
        const entry = this.layers.get(id);
        if (entry === undefined) {
          port.discard(next);
          return;
        }
        next.setZIndex(BASE_Z + entry.stack);
        next.setVisible(entry.layer.getVisible());
        this.map.removeLayer(entry.layer);
        entry.layer.dispose();
        entry.layer = next;
      },
      discard: (layer) => {
        this.map.removeLayer(layer);
        layer.dispose();
      },
    };
    this.layerSwap = new LayerSwap(port, ids, () => {
      this.layerSwap = null;
      this.swapLoading = false;
      // A layer that came after the swap began has the old style: it is given the new one.
      for (const [id, entry] of this.layers) if (!ids.includes(id)) entry.layer.setStyle(style);
      this.swapDone(version, dashVersion, style);
    }, () => {
      this.layerSwap = null;
      this.swapLoading = false;
      this.swapGiveUps++;
      this.lastSwapAt = performance.now();
      this.requestSwap(); // the new layers were not ready in time: another try, later, with the atlas as it is then
    });
    this.map.render();
  }

  private swapDone(version: number, dashVersion: number, style: ReturnType<typeof layerStyle>): void {
    this.shownVersion = version;
    this.shownStyle = style;
    this.styleKey = `${String(version)}:${String(dashVersion)}`;
    this.lastSwapAt = performance.now();
    this.swapGiveUps = 0;
    this.promotePending();
    for (const key of [...this.recentImages.keys()]) if (this.atlas.stampOf(key) <= version) this.recentImages.delete(key); // the shown image holds them now
    if (this.styleKeyNow() !== this.styleKey) this.requestSwap(); // more came in meanwhile
  }

  private newWebglLayer(source: Source, style: ReturnType<typeof layerStyle>): WebGLVectorLayer<Source> {
    return new WebGLVectorLayer({ source, className: WEBGL_CLASS, style, disableHitDetection: true }); // nothing here uses OpenLayers' hit detection (picking is pickCandidates), and it renders the layer a second time every frame
  }

  /** Whether the shown atlas holds an entry already: the entry, or a {@link PendingImage}. */
  private shownEntry(key: string, entry: AtlasEntry | null): AtlasEntry | null | PendingImage {
    if (entry === null) return null;
    return this.atlas.stampOf(key) <= this.shownVersion ? entry : { pending: entry };
  }

  /** The symbols that wait for the shown atlas to hold their image are drawn from the image itself on a Canvas layer, until the swap. */
  private showPending(features: readonly Feature[]): void {
    for (const feature of features) {
      const key = this.pending.get(feature);
      if (key === undefined || feature.get(P.inAtlas) !== IN_ATLAS.pending || this.pendingCanvas.has(feature)) continue;
      const image = this.recentImages.get(key);
      const geometry = feature.getGeometry();
      if (image === undefined || !(geometry instanceof Point)) continue;
      const drawn = new Feature(geometry.clone());
      const style = new Style({ zIndex: Number(feature.get(P.seq)), image: iconOf(image, Number(feature.get(P.opacity))) });
      drawn.set(PENDING_STYLE, style);
      drawn.setStyle(this.ownerOf(feature)?.layer.getVisible() === false ? HIDDEN_STYLE : style); // a hidden layer's symbols are not drawn either
      this.pendingCanvas.set(feature, drawn);
      this.pendingSource.addFeature(drawn);
    }
  }

  private ownerOf(feature: Feature): MapLayer | undefined {
    for (const entry of this.layers.values()) if (entry.source.hasFeature(feature)) return entry;
    return undefined;
  }

  /** The Canvas symbols of a layer follow its visibility. */
  private syncPendingVisibility(): void {
    for (const [feature, drawn] of this.pendingCanvas) {
      drawn.setStyle(this.ownerOf(feature)?.layer.getVisible() === false ? HIDDEN_STYLE : (drawn.get(PENDING_STYLE) as Style));
    }
  }

  private dropPendingCanvas(feature: Feature): void {
    const drawn = this.pendingCanvas.get(feature);
    if (drawn === undefined) return;
    this.pendingSource.removeFeature(drawn);
    this.pendingCanvas.delete(feature);
  }

  /** Takes away the Canvas symbols of features that are not in a layer any more (replaced, deleted, their layer gone). */
  private prunePendingCanvas(): void {
    if (this.pendingCanvas.size === 0 && this.pending.size === 0) return;
    const sources = [...this.layers.values()].map((entry) => entry.source);
    for (const feature of [...this.pendingCanvas.keys()]) {
      if (!sources.some((source) => source.hasFeature(feature))) this.dropPendingCanvas(feature);
    }
    for (const feature of [...this.pending.keys()]) {
      if (!sources.some((source) => source.hasFeature(feature))) this.pending.delete(feature);
    }
  }

  /** The symbol features that wait for an image get it now that the style shows it. */
  private promotePending(): void {
    for (const [feature, key] of [...this.pending]) {
      const entry = this.atlas.get(key);
      if (entry === undefined || (entry !== null && this.atlas.stampOf(key) > this.shownVersion)) continue; // not yet
      this.pending.delete(feature);
      this.dropPendingCanvas(feature);
      feature.setProperties(entry === null
        ? { [P.inAtlas]: IN_ATLAS.no }
        : { [P.inAtlas]: IN_ATLAS.yes, [P.ox]: entry.x, [P.oy]: entry.y, [P.w]: entry.w, [P.h]: entry.h, [P.ax]: entry.ax, [P.ay]: entry.ay });
    }
  }

  /** The image properties of a symbol feature that is drawn from the shown atlas, or null. */
  private shownImageOf(feature: Feature | null): Record<string, unknown> | null {
    if (feature === null || feature.get(P.kind) !== KIND.symbol || feature.get(P.inAtlas) !== IN_ATLAS.yes) return null;
    return Object.fromEntries([P.ox, P.oy, P.w, P.h, P.ax, P.ay].map((name) => [name, feature.get(name)]));
  }

  private redrawEverything(): void {
    this.pending.clear(); // the features that waited are replaced below
    const made: Feature[] = [];
    for (const [id, entry] of this.layers) {
      entry.source.clear(true);
      const features = this.features(this.items.get(id)?.values() ?? []);
      entry.source.addFeatures(features);
      made.push(...features);
    }
    this.prunePendingCanvas();
    this.showPending(made);
    this.rebuildOverlays();
    this.setDragPreview(this.preview);
    this.setHighlight(this.highlighted);
    this.afterDraw();
  }

  // ---- Symbols ----

  registerProjections(projections: readonly Projection[]): void {
    registerWithOpenLayers(projections);
  }

  setSymbolOptions(symbolSize: number, textThreshold: number): void {
    if (symbolSize === this.symbolSize && textThreshold === this.textThreshold) return;
    if (symbolSize !== this.symbolSize) {
      this.symbolSize = symbolSize;
      this.startAtlasAgain();
      this.arrow = arrowFor(symbolSize);
      this.styleKey = ''; // the WebGL style names the new atlas and arrow
    }
    this.textThreshold = textThreshold;
    this.labelImages.clear();
    this.redrawEverything();
  }

  setDisplayOptions(options: DisplayOptions): void {
    const { labelPlaces, directionArrow, speedVectorSeconds } = options;
    const samePlacesAsBefore = samePlaces(labelPlaces, this.labelPlaces);
    if (samePlacesAsBefore && directionArrow === this.directionArrow && speedVectorSeconds === this.speedVectorSeconds) return;
    this.labelPlaces = labelPlaces;
    this.directionArrow = directionArrow;
    this.speedVectorSeconds = speedVectorSeconds;
    // The images do not depend on the labels: `symbology` is asked with `labels: []` (CR-0043 part A), so only the texts and the arrows are drawn again.
    this.redrawEverything();
  }

  setSymbols(symbols: SymbolService): void {
    this.symbols = symbols;
    this.sensorReportImage = undefined; // a new service: its image is asked for again
    this.sensorReportGeneration++;
    this.labelImages.clear();
    this.redrawEverything();
  }

  private startAtlasAgain(): void {
    this.atlas = new SymbolAtlas(createCanvas);
    this.vesselsInAtlas = false;
    this.shownVersion = 0; // none of the new atlas is in the shown image
    this.atlasGeneration++;
    this.recentImages.clear();
    if (this.layerSwap !== null) {
      this.layerSwap.cancel(); // its layers name the old atlas
      this.layerSwap = null;
      this.swapLoading = false;
    }
    this.pending.clear();
  }

  private atlasEntry(symbol: MilSymbol) {
    if (this.symbols === null) return null;
    const key = appearanceKey(symbol);
    const known = this.atlas.get(key);
    if (known !== undefined) return known;
    const image = this.render(symbol, false, key);
    if (image === null) {
      this.atlas.refuse(key);
      return null;
    }
    const entry = this.atlas.add(key, image);
    if (entry !== null) this.recentImages.set(key, image);
    if (symbol.standard === 'vessel') this.vesselsInAtlas = true;
    if (entry === null) this.options.log.warn('the symbol atlas is full; further symbol kinds are drawn as markers');
    return entry;
  }

  private sensorReportKey(): string {
    return `sensor-report|${String(this.sensorReportGeneration)}`;
  }

  /** True when this symbol item is drawn as the sensor report symbol: its data type says so and the service has one (brief function 39). */
  private drawnAsSensorReport(item: Extract<DrawItem, { kind: 'symbol' }>): boolean {
    return item.sensorReport === true && this.sensorReportEntry() !== null;
  }

  /**
   * The service's sensor report symbol now, or null before the service is there or when it fails (the APP-6 symbol
   * is drawn). Required of the service since the 1.5.0 freeze. Asked at every draw and once a second while sensor reports are drawn; another image than the
   * last one draws the symbols in view again (brief function 39: a settings change shows within 2 s).
   */
  private currentSensorReport(): SymbolImage | null {
    let image: SymbolImage | null = null;
    try {
      image = this.symbols?.sensorReportSymbol() ?? null;
    } catch (error) {
      this.options.log.warn('the sensor report symbol cannot be got; sensor reports are drawn as APP-6 symbols', error);
    }
    const before = this.sensorReportImage;
    if (before !== undefined && !sameSymbolImage(before, image)) {
      this.sensorReportGeneration++;
      this.sensorReportStale = true;
    }
    this.sensorReportImage = image;
    return image;
  }

  private sensorReportEntry(): AtlasEntry | null {
    const image = this.currentSensorReport();
    if (image === null) return null;
    this.startSensorReportWatch();
    const key = this.sensorReportKey();
    const known = this.atlas.get(key);
    if (known !== undefined) return known;
    const entry = this.atlas.add(key, image);
    if (entry !== null) this.recentImages.set(key, image);
    if (entry === null) this.options.log.warn('the symbol atlas is full; the sensor report symbol is drawn as a marker');
    return entry;
  }

  private startSensorReportWatch(): void {
    if (this.sensorReportTimer !== null) return;
    this.sensorReportTimer = window.setInterval(() => {
      this.currentSensorReport();
      if (!this.sensorReportStale) return;
      this.sensorReportStale = false;
      this.redrawEverything(); // the only place that draws again for a changed image, so a service that gives a new object at every call costs one redraw a second
    }, 1000);
  }

  private stopSensorReportWatch(): void {
    if (this.sensorReportTimer === null) return;
    window.clearInterval(this.sensorReportTimer);
    this.sensorReportTimer = null;
  }

  private render(symbol: MilSymbol, withText: boolean, what: string): SymbolImage | null {
    if (this.symbols === null) return null;
    try {
      return this.symbols.render(symbolRequest(symbol, this.symbolSize, withText, NO_LABELS)); // the map view draws the placed labels itself (CR-0043 part A)
    } catch (error) {
      this.options.log.warn(`symbol ${what} cannot be drawn; it is shown as a marker`, error);
      return null;
    }
  }

  // ---- Symbols with text (brief function 6) ----

  private scheduleLabels(): void {
    if (this.labelsPending) return;
    this.labelsPending = true;
    window.setTimeout(() => {
      this.labelsPending = false;
      this.refreshLabels();
    }, 0);
  }

  /**
   * Up to the threshold of visible symbols and named shapes (one count, owner 2026-10-16), the
   * texts of the symbols in view are drawn on top, and the named shapes get their label. Above it,
   * no texts. A symbol's text image holds only its text (the symbol cut out, see `textOnly`): the
   * symbol itself stays on its layer's WebGL layer, so the layer order decides which objects are on
   * top (T-087; owner, 2026-10-22), and only texts and labels lie above all objects. A faded
   * symbol's text is drawn at its opacity.
   */
  private refreshLabels(): void {
    this.labels.clear(true);
    const size = this.map.getSize();
    if (size === undefined || this.textThreshold === 0) return;
    const extent = this.map.getView().calculateExtent(size);
    const olProjection = this.olProjection();
    const wanted: { item: Extract<DrawItem, { kind: 'symbol' }>; stack: number; coordinates: number[] }[] = [];
    const named: { name: string; opacity: number; stack: number; coordinates: number[] }[] = [];
    const placed: { texts: PlacedText[]; reach: ImageReach; opacity: number; stack: number; coordinates: number[] }[] = [];
    const graphicLabels: { item: Extract<DrawItem, { kind: 'graphic' }>; stack: number }[] = [];
    const graphicsSeen = new Set<string>();
    let visible = 0;
    for (const [layerId, entry] of this.layers) {
      if (!entry.layer.getVisible()) continue;
      for (const feature of entry.source.getFeaturesInExtent(extent, olProjection)) {
        const kind = feature.get(P.kind) as number;
        if (kind === KIND.gline || kind === KIND.gfill) {
          // A graphic's labels come from the service; it counts once, like a named shape.
          const owner = graphicOwner(String(feature.getId()));
          const graphic = owner === null ? undefined : this.items.get(layerId)?.get(owner);
          if (owner === null || graphic?.kind !== 'graphic' || graphic.parts === null || (graphic.parts.labels.length === 0 && (graphic.parts.images ?? []).length === 0) || graphicsSeen.has(owner)) continue;
          graphicsSeen.add(owner);
          visible++;
          if (!drawWithText(visible, this.textThreshold)) return;
          graphicLabels.push({ item: graphic, stack: entry.stack });
          continue;
        }
        if (kind !== KIND.symbol && kind !== KIND.line && kind !== KIND.polygon) continue;
        const item = this.items.get(layerId)?.get(String(feature.getId()));
        const geometry = feature.getGeometry();
        if (kind !== KIND.symbol) {
          // A named shape counts like a symbol (owner, 2026-10-16) and is labelled at its middle.
          const name = item?.kind === 'line' || item?.kind === 'polygon' ? item.name : undefined;
          if (item === undefined || name === undefined) continue;
          visible++;
          if (!drawWithText(visible, this.textThreshold)) return;
          const at = geometry instanceof Polygon ? geometry.getInteriorPoint().getCoordinates().slice(0, 2)
            : geometry instanceof LineString ? geometry.getCoordinateAt(0.5) : null;
          if (at !== null) named.push({ name, opacity: opacityOf(item), stack: entry.stack, coordinates: at });
          continue;
        }
        if (item?.kind === 'symbol' && this.drawnAsSensorReport(item)) continue; // no text, no name: it does not count toward the threshold (function 39)
        visible++;
        if (!drawWithText(visible, this.textThreshold)) return;
        // The labels the user placed round the symbol (brief function 35; CR-0043 part A), counted with the symbol itself.
        if (item?.kind === 'symbol' && geometry instanceof Point) {
          const texts = placedTexts(item.symbol, item.name, this.labelPlaces);
          if (texts.length > 0) {
            const inAtlas = feature.get(P.inAtlas) !== IN_ATLAS.no; // the size of a symbol that waits for its image is known too
            const reach: ImageReach = inAtlas
              ? { left: Number(feature.get(P.ax)), top: Number(feature.get(P.ay)), right: Number(feature.get(P.w)) - Number(feature.get(P.ax)), bottom: Number(feature.get(P.h)) - Number(feature.get(P.ay)) }
              : { left: FALLBACK_RADIUS, top: FALLBACK_RADIUS, right: FALLBACK_RADIUS, bottom: FALLBACK_RADIUS };
            placed.push({ texts, reach, opacity: opacityOf(item), stack: entry.stack, coordinates: geometry.getCoordinates() });
          }
        }
        // What `symbology` still draws with `labels: []` (the amplifiers that cannot be placed) needs the SymbolService; shape labels do not.
        if (this.symbols !== null && item?.kind === 'symbol' && hasOffListText(item.symbol) && geometry instanceof Point) {
          wanted.push({ item, stack: entry.stack, coordinates: geometry.getCoordinates() });
        }
      }
    }
    const features: Feature[] = [];
    for (const { name, opacity, stack, coordinates } of named) {
      const feature = new Feature(new Point(coordinates));
      feature.setStyle(shapeLabelStyle(name, opacity, stack, this.textLook));
      features.push(feature);
    }
    for (const { texts, reach, opacity, stack, coordinates } of placed) {
      for (const { place, text } of texts) {
        const feature = new Feature(new Point(coordinates));
        feature.setStyle(placedLabelStyle(text, place, reach, opacity, stack, this.textLook));
        features.push(feature);
      }
    }
    // A graphic's images go before its labels, so that its labels lie over them (brief function 37).
    for (const { item, stack } of graphicLabels) features.push(...graphicImageFeatures(item, this.projection, stack, this.graphicImages), ...graphicLabelFeatures(item, this.projection, stack));
    for (const { item, stack, coordinates } of wanted) {
      const image = this.labelImage(item);
      if (image === null) continue;
      const feature = new Feature(new Point(coordinates));
      feature.setStyle(new Style({ zIndex: stack, image: iconOf(image, opacityOf(item)) }));
      features.push(feature);
    }
    this.labels.addFeatures(features);
    if (this.labelImages.size > 2 * this.textThreshold + 100) {
      const keep = new Set(wanted.map((w) => w.item.id));
      for (const id of this.labelImages.keys()) if (!keep.has(id)) this.labelImages.delete(id);
    }
  }

  private labelImage(item: Extract<DrawItem, { kind: 'symbol' }>): SymbolImage | null {
    const key = JSON.stringify(steppedSymbol(item.symbol)); // a turning vessel's text image changes with its hull's step only (T-200)
    const cached = this.labelImages.get(item.id);
    if (cached?.key === key) return cached.image;
    const withText = this.render(item.symbol, true, item.symbol.sidc);
    if (withText === null) return null;
    // Only the text, where the WebGL layer draws the symbol itself. When the atlas is full it draws
    // a marker there, so the full image stays (on top of every layer, as before T-087).
    const plain = this.atlasEntry(item.symbol) !== null ? this.render(item.symbol, false, item.symbol.sidc) : null;
    const image = plain === null ? withText : textOnly(createCanvas, withText, plain);
    this.labelImages.set(item.id, { key, image });
    return image;
  }

  // ---- Pick ----

  pickCandidates(pixel: Pixel, tolerance: number): PickCandidate[] {
    const view = this.view;
    if (view === null) return [];
    const [x, y] = pixelToMap(view, pixel);
    const reach = (tolerance + Math.max(2 * this.symbolSize, 40)) * view.resolution;
    return this.candidatesIn([x - reach, y - reach, x + reach, y + reach], view, x);
  }

  boxCandidates(box: PixelBox): PickCandidate[] {
    const view = this.view;
    if (view === null) return [];
    const [x1, y1] = pixelToMap(view, box.from);
    const [x2, y2] = pixelToMap(view, box.to);
    return this.candidatesIn([Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)], view, (x1 + x2) / 2);
  }

  /** The items of the visible layers in an extent, as pixel shapes near `pointerX` (map units) where the world repeats. */
  private candidatesIn(extent: number[], view: ViewState, pointerX: number): PickCandidate[] {
    const [minX, , maxX] = this.projection.def.extent;
    const worldWidth = this.projection.wrapsX ? maxX - minX : 0;
    const candidates: PickCandidate[] = [];
    // An area across the antimeridian is stored past the edge of the world (brief function 36), where the
    // source's own wrapping of a query (given the projection) does not look: ask at the world's copies one
    // by one, and `candidate` moves each feature to the copy the pointer is in.
    const copies = worldWidth > 0 ? [-worldWidth, 0, worldWidth] : [0];
    for (const entry of this.layers.values()) {
      if (!entry.layer.getVisible()) continue;
      const seen = new Set<Feature>();
      for (const copy of copies) {
        const shifted = [extent[0] as number + copy, extent[1] as number, extent[2] as number + copy, extent[3] as number];
        for (const feature of entry.source.getFeaturesInExtent(shifted)) {
          if (seen.has(feature)) continue;
          seen.add(feature);
          const candidate = this.candidate(feature, entry.stack, view, pointerX, worldWidth);
          if (candidate !== null) candidates.push(candidate);
        }
      }
      // A text object is picked on its box, which reaches further from its point than the query does: a long text is
      // wider than the reach, so its point is outside the extent while the pointer is on its end (SN A). Every text
      // object of the layer is a candidate; `pickAt` and `boxAt` test its box.
      for (const id of entry.textIds) {
        const feature = entry.source.getFeatureById(id);
        if (feature === null || seen.has(feature)) continue;
        const candidate = this.candidate(feature, entry.stack, view, pointerX, worldWidth);
        if (candidate !== null) candidates.push(candidate);
      }
    }
    return candidates;
  }

  private candidate(feature: Feature, stack: number, view: ViewState, pointerX: number, worldWidth: number): PickCandidate | null {
    const geometry = feature.getGeometry();
    const featureId = feature.getId();
    if (geometry === undefined || featureId === undefined) return null;
    // A graphic's lines and fills are picked as the graphic (brief function 30).
    const id = graphicOwner(String(featureId)) ?? featureId;
    const base = { id: String(id), stack, order: Number(feature.get(P.seq)) };
    const [gMinX, , gMaxX] = geometry.getExtent();
    const shift = worldWidth > 0 ? Math.round((pointerX - ((gMinX ?? 0) + (gMaxX ?? 0)) / 2) / worldWidth) * worldWidth : 0;
    const toPixel = (c: number[]): Pixel => mapToPixel(view, [(c[0] ?? 0) + shift, c[1] ?? 0]);
    const kind = feature.get(P.kind) as number;
    if (kind === KIND.arrowhead || kind === KIND.markers || kind === KIND.aux) return null; // the line under them is picked; a speed vector or a relation line never is (brief functions 34 and 35)
    if (kind === KIND.text) {
      // A text object is picked on its box, turned with the text; its text layer lies over the layer's own features (brief function 45).
      const item = feature.get(TEXT_ITEM) as Extract<DrawItem, { kind: 'textobject' }> | undefined;
      if (item === undefined || !(geometry instanceof Point)) return null;
      const at = toPixel(geometry.getCoordinates());
      const { width, height } = textBox(item.text, item.size, this.textLook, this.textMeter);
      const angle = Number(feature.get(P.rotation) ?? 0);
      const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
      const corners = ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([cx, cy]): Pixel => {
        const [dx, dy] = [(cx * (width + 4)) / 2, (cy * (height + 4)) / 2];
        return [at[0] + dx * cos - dy * sin, at[1] + dx * sin + dy * cos];
      });
      return { ...base, order: base.order + TEXT_PICK_ORDER, kind: 'quad', corners, at };
    }
    const width = Number(feature.get(P.strokeWidth) ?? 1);
    // A graphic's fill is picked on its outline only, as a shape's is (function 28), and a line it draws within its width.
    if (kind === KIND.gfill) return geometry instanceof Polygon ? { ...base, kind: 'polygon', rings: geometry.getCoordinates().map((ring) => ring.map(toPixel)), width: 1 } : null;
    if (kind === KIND.gline) return geometry instanceof LineString ? { ...base, kind: 'line', pixels: geometry.getCoordinates().map(toPixel), width } : null;
    if (geometry instanceof Point) {
      const [px, py] = toPixel(geometry.getCoordinates());
      if (kind === KIND.symbol && feature.get(P.inAtlas) !== IN_ATLAS.no) { // also a symbol that waits for its image: drawn on a Canvas layer, with its size known (T-200)
        const left = px - Number(feature.get(P.ax));
        const top = py - Number(feature.get(P.ay));
        return { ...base, kind: 'box', left, top, right: left + Number(feature.get(P.w)), bottom: top + Number(feature.get(P.h)), at: [px, py] };
      }
      const radius = kind === KIND.point ? POINT_RADIUS + width / 2 : FALLBACK_RADIUS + 1;
      return { ...base, kind: 'circle', center: [px, py], radius };
    }
    if (geometry instanceof LineString) return { ...base, kind: 'line', pixels: geometry.getCoordinates().map(toPixel), width };
    if (geometry instanceof Polygon) return { ...base, kind: 'polygon', rings: geometry.getCoordinates().map((ring) => ring.map(toPixel)), width };
    return null;
  }

  // ---- Clusters (brief function 12) ----

  setClusters(items: readonly ClusterItem[]): void {
    this.clusters = items;
    this.clusterSource.clear(true);
    const features: Feature[] = [];
    for (const item of items) {
      const xy = this.projection.forward(item.position);
      if (xy === null) continue;
      const feature = new Feature(new Point([xy[0], xy[1]]));
      feature.setStyle(clusterStyle(item, this.textLook));
      features.push(feature);
    }
    this.clusterSource.addFeatures(features);
  }

  // ---- Background (brief function 3) ----

  setBackground(background: EngineBackground | null): void {
    this.background = background;
    this.rebuildBackground();
  }

  private rebuildBackground(): void {
    if (this.backgroundLayer !== null) {
      this.map.removeLayer(this.backgroundLayer);
      this.backgroundLayer.dispose();
    }
    const background = this.background;
    const provider = background?.provider ?? null;
    const code = this.projection.def.code;
    const source = provider?.source;
    if (background?.kind === 'vector' && background.data.projection === code) {
      this.backgroundLayer = vectorBackgroundLayer(background.data, attributionHtml(background.provider.attribution), this.projection.wrapsX);
      this.map.addLayer(this.backgroundLayer);
      return;
    }
    const wms = background?.kind === 'tiles' && provider !== null && source?.type === 'wms' && supportsProjection(provider, code)
      ? wmsLayer(source, this.projection, attributionHtml(provider.attribution))
      : null;
    this.backgroundLayer = wms ?? (background?.kind === 'tiles' && provider !== null && source?.type === 'xyz' && supportsProjection(provider, code)
      ? new TileLayer({
          zIndex: 0,
          source: new XYZ({
            url: source.url,
            minZoom: source.minZoom,
            maxZoom: source.maxZoom,
            tileSize: source.tileSize,
            projection: code,
            wrapX: this.projection.wrapsX,
            attributions: attributionHtml(provider.attribution),
          }),
        })
      : new Graticule({ zIndex: 1, strokeStyle: new Stroke({ color: 'rgba(128, 128, 128, 0.5)', width: 1 }), showLabels: false, wrapX: this.projection.wrapsX }));
    this.map.addLayer(this.backgroundLayer);
  }

  setTextLook(look: TextLook): void {
    if (sameTextLook(look, this.textLook)) return;
    this.textLook = look;
    this.textStyles.clear();
    this.setHighlight(this.highlighted); // a text object's frame fits the text in the new font
    for (const entry of this.layers.values()) entry.textLayer?.changed(); // the text objects are in the look's colours
    if (this.vesselsInAtlas) {
      // The vessel images have the look's ground colour in the gap round the fill (function 33): draw them again.
      this.startAtlasAgain();
      this.styleKey = '';
      this.labelImages.clear();
      this.redrawEverything();
    }
    this.setClusters(this.clusters);
    this.rebuildOverlays(); // an overlay's label is in the look's colours
    this.scheduleLabels();
  }

  setDim(level: number): void {
    const opacity = Number.isFinite(level) ? Math.min(Math.max(level, 0), 0.9) : 0;
    this.dimElement.style.opacity = String(opacity);
    this.dimLayer.setVisible(opacity > 0);
  }

  // ---- Overlays and interactions (brief function 8) ----

  setOverlay(overlayId: string, items: readonly DrawItem[]): void {
    if (items.length === 0) this.overlays.delete(overlayId);
    else this.overlays.set(overlayId, items);
    this.rebuildOverlays();
  }

  private rebuildOverlays(): void {
    this.overlaySource.clear(true);
    let z = 0;
    const features: Feature[] = [];
    for (const items of this.overlays.values()) {
      z++;
      for (const item of items) {
        const feature = this.canvasFeature(item, z);
        if (feature !== null) features.push(feature);
      }
    }
    this.overlaySource.addFeatures(features);
  }

  setInteraction(mode: InteractionMode): void {
    this.mode = mode;
    // Two clicks while placing or dragging must not zoom the map (owner, 2026-10-10, T-032);
    // panning is handled by the grab test. In every other mode a double-click zooms as usual, but
    // only after the double-click window, so a double-click that ends the interaction does not zoom.
    if (this.doubleClickZoomTimer !== null) window.clearTimeout(this.doubleClickZoomTimer);
    this.doubleClickZoomTimer = null;
    if (mode !== 'none') {
      this.doubleClickZoom?.setActive(false);
    } else if (this.doubleClickZoom?.getActive() === false) {
      this.enableDoubleClickZoomLater();
    }
    this.map.getViewport().style.cursor = mode === 'pick-point' ? 'crosshair' : '';
  }

  startDrawing(kind: DrawKind, style: ShapeStyle | undefined, onEnd: (shape: DrawnShape | null) => void, options?: DrawingOptions): void {
    this.stopDrawing();
    const dragged = DRAGGED_KINDS.has(kind);
    /** A line continued from its last point (`MapView.append`, brief function 44): the line being extended, with its own number of points. */
    const base = kind === 'line' && options?.extend !== undefined && options.extend.length >= 2 ? options.extend : null;
    const extended = base === null ? null : new Feature(new LineString(base.map((xy) => [...xy])));
    /** How many points the user has added to the line being continued (the pointer's own position at the end is not one); null for any other drawing. */
    const added = (): number | null => {
      const geometry = extended?.getGeometry();
      return base === null || !(geometry instanceof LineString) ? null : Math.max(0, geometry.getCoordinates().length - 1 - base.length);
    };
    /** How many points are set (a tactical graphic's drawing: the limits are the graphic's, brief function 32). */
    let setCount = 0;
    const enoughPoints = () => setCount >= (options?.minPoints ?? 0);
    const shown = (coordinate: number[]) => {
      const p = this.projection.inverse([coordinate[0] ?? 0, coordinate[1] ?? 0]);
      return p !== null && this.projection.isValid(p);
    };
    // A dragged shape is previewed as what it will be: the result's own outline (a circle's and an
    // ellipse's geodesic ring, a square's equal sides), or the plain box while it cannot be drawn.
    let ends: [XY, XY] | null = null;
    const draggedGeometry = (coordinates: unknown, geometry: unknown) => {
      const [from, to] = (coordinates as number[][]).map((c) => [c[0] ?? 0, c[1] ?? 0] as const);
      ends = from !== undefined && to !== undefined ? [from, to] : ends;
      const preview = ends === null ? null : drawnGeometry(this.draggedShape(kind, ends), this.projection);
      const ring = preview !== null && 'geometry' in preview
        ? outlineOf(preview.geometry).map((p) => this.projection.forward(p)).filter((xy) => xy !== null).map((xy) => [...xy])
        : ends === null ? [] : boxCorners(ends[0], ends[1]).map((xy) => [...xy]);
      const polygon = geometry instanceof Polygon ? geometry : new Polygon([]);
      polygon.setCoordinates(ring.length >= 3 ? [[...ring, ring[0] ?? [0, 0]]] : []);
      return polygon;
    };
    const interaction = new Draw({
      type: kind === 'polygon' ? 'Polygon' : kind === 'line' ? 'LineString' : 'Circle',
      // Press and drag (owner, 2026-10-16); the other kinds set points with clicks, which OpenLayers
      // takes only where the projection can show a point.
      ...(dragged ? { freehand: true, geometryFunction: draggedGeometry } : { condition: (event) => noModifierKeys(event) && shown(event.coordinate), finishCondition: enoughPoints }),
      style: drawPreviewStyle(kind === 'line' ? 'line' : 'area', style, this.arrowhead),
    });
    interaction.on('drawend', (event) => {
      const geometry = event.feature.getGeometry();
      const points = (coordinates: number[][]) => coordinates.map((c) => [c[0] ?? 0, c[1] ?? 0] as const);
      const shape: DrawnShape | null = dragged
        ? (ends === null ? null : this.draggedShape(kind, ends))
        : geometry instanceof Polygon ? { kind: 'polygon', points: points(geometry.getCoordinates()[0] ?? []) }
          : geometry instanceof LineString ? { kind: 'line', points: points(geometry.getCoordinates()) } : null;
      this.stopDrawing();
      onEnd(shape);
    });
    this.map.addInteraction(interaction);
    // Enter and Backspace count on the page, in the map and on the element that started the drawing
    // (owner, 2026-10-16), not on another plugin's button or a dialog.
    const startedFrom = document.activeElement;
    // Null before the map is mounted, whatever OpenLayers' type says.
    const mapElement = this.map.getTargetElement() as HTMLElement | null;
    const stopKeys = listenForDrawingKeys(document, {
      enter: () => {
        if (enoughPoints()) interaction.finishDrawing(); // a graphic's minimum: the line stays and the drawing goes on
      },
      backspace: () => {
        if ((added() ?? 1) > 0) interaction.removeLastPoint(); // a line's own points are never taken back (brief function 44)
      },
    }, (target) => target === document.body || target === document.documentElement || target === startedFrom
      || (target instanceof Node && mapElement !== null && mapElement.contains(target)));
    const drawing = { kind, interaction, stopKeys, onEnd, started: false, added };
    const xyOf = (c: number[]): XY => [c[0] ?? 0, c[1] ?? 0];
    interaction.on('drawstart', (event) => {
      drawing.started = true;
      const geometry = event.feature.getGeometry();
      if (dragged || options?.onSketch === undefined && options?.maxPoints === undefined || !(geometry instanceof LineString || geometry instanceof Polygon)) return;
      // The sketch holds the points set and the pointer's position (a polygon's ring also its closing point).
      const sketch = () => {
        const coordinates = geometry instanceof Polygon ? (geometry.getCoordinates()[0] ?? []).slice(0, -1) : geometry.getCoordinates();
        setCount = Math.max(0, coordinates.length - 1);
        options.onSketch?.(coordinates.map(xyOf));
        const max = options.maxPoints;
        if (max !== undefined && max !== null && setCount >= max) queueMicrotask(() => { if (drawing.started) interaction.finishDrawing(); });
      };
      geometry.on('change', sketch);
      sketch();
    });
    // The last point removed (OpenLayers aborts the sketch then), or the drawing finished.
    for (const type of ['drawabort', 'drawend'] as const) {
      interaction.on(type, () => {
        drawing.started = false;
        setCount = 0;
        if (type === 'drawabort') options?.onSketch?.([]);
      });
    }
    this.drawing = drawing;
    if (extended !== null) interaction.extend(extended); // continues from the last point; `drawstart` follows
  }

  setDrawingPlain(visible: boolean): void {
    this.drawing?.interaction.getOverlay().setVisible(visible);
  }

  rightClickDrawing(): boolean {
    const drawing = this.drawing;
    if (drawing === null || !drawing.started) return false;
    if (drawing.added() === 0) return false; // a line being continued, with no point added: nothing to take back, as Escape (brief function 44)
    if (!DRAGGED_KINDS.has(drawing.kind)) drawing.interaction.removeLastPoint(); // the first point removed aborts the sketch: the next right click is Escape
    return true; // a press and drag is left alone
  }

  /** What a dragged shape is from its two ends in map coordinates. */
  private draggedShape(kind: DrawKind, [from, to]: [XY, XY]): DrawnShape {
    return kind === 'circle' ? { kind, center: from, edge: to } : { kind: kind === 'ellipse' || kind === 'square' ? kind : 'rectangle', from, to };
  }

  startEditing(
    shape: EditShape,
    style: ShapeStyle | undefined,
    tools: {
      readonly reshape: (shape: EditShape) => { readonly shape: EditShape; readonly outline: readonly XY[] } | null;
      readonly move: (before: EditShape, center: XY) => EditShape | null;
    },
    onEnd: (shape: EditShape | null) => void,
    options?: EditingOptions,
  ): void {
    const { reshape, move } = tools;
    this.stopEditing();
    const round = shape.kind === 'circle' || shape.kind === 'ellipse';
    const preview = drawPreviewStyle(shape.kind === 'line' ? 'line' : 'area', style, this.arrowhead);
    const body = new Feature(editBodyGeometry(shape));
    // A tactical graphic's points each have a handle, always (brief function 32), not only near the pointer.
    body.setStyle((feature) => (options?.vertexHandles === true ? [...preview(feature), vertexHandles(feature)] : preview(feature)));
    // A circle's and an ellipse's handles: the centre (moved with the shape), and the points the
    // user drags: a circle's edge, an ellipse's two axis ends.
    const handleXYs: XY[] = shape.kind === 'circle' ? [shape.center, shape.edge] : shape.kind === 'ellipse' ? [shape.center, shape.major, shape.minor] : [];
    const handles = handleXYs.map((xy, i) => {
      const feature = new Feature(new Point([...xy]));
      feature.setStyle(i === 0 ? EDIT_CENTRE_STYLE : EDIT_HANDLE_STYLE);
      return feature;
    });
    const layer = new VectorLayer({ source: new VectorSource({ features: [body, ...handles] }), zIndex: LABELS_Z + 4 });
    this.map.addLayer(layer);
    const handleShape = (): EditShape => {
      const at = (i: number) => {
        const geometry = handles[i]?.getGeometry();
        const [x, y] = geometry instanceof Point ? geometry.getCoordinates() : [0, 0];
        return [x ?? 0, y ?? 0] as const;
      };
      return shape.kind === 'circle' ? { kind: 'circle', center: at(0), edge: at(1) } : { kind: 'ellipse', center: at(0), major: at(1), minor: at(2) };
    };
    let moving: EditShape | null = null;
    let fixing = false;
    const placeHandles = (fixed: EditShape) => {
      const xys = fixed.kind === 'circle' ? [fixed.center, fixed.edge] : fixed.kind === 'ellipse' ? [fixed.center, fixed.major, fixed.minor] : [];
      xys.forEach((xy, i) => {
        const geometry = handles[i]?.getGeometry();
        if (geometry instanceof Point) geometry.setCoordinates([...xy]);
      });
    };
    const refit = () => {
      if (!round || moving !== null || fixing) return;
      const fitted = reshape(handleShape());
      if (fitted === null) return;
      fixing = true;
      placeHandles(fitted.shape);
      const outline = fitted.outline.map((xy) => [...xy]);
      if (outline.length >= 3) body.setGeometry(new Polygon([[...outline, outline[0] ?? [0, 0]]]));
      fixing = false;
    };
    for (const handle of handles.slice(1)) handle.getGeometry()?.on('change', refit);
    refit();
    // Drag inside the shape to move it all; drag a corner, point or handle to reshape it.
    const translate = new Translate({ features: new Collection([body, ...handles]), filter: (feature) => feature === body });
    // Translate asks every visible layer for the feature under the pointer (its `layers` option is ignored when `features` is given), and a WebGL layer made with
    // `disableHitDetection` throws on that (T-195). Only the edit layer holds what it moves, so only it is asked.
    (translate as unknown as { layerFilter_: (candidate: unknown) => boolean }).layerFilter_ = (candidate) => candidate === layer;
    translate.on('translatestart', () => {
      moving = round ? handleShape() : null;
    });
    translate.on('translateend', () => {
      // A moved circle or ellipse keeps its radius, axes and rotation; only its centre moved.
      const before = moving;
      moving = null;
      if (before === null) return;
      const moved = move(before, centreOf(handleShape()));
      if (moved !== null) {
        fixing = true;
        placeHandles(moved);
        fixing = false;
      }
      refit();
    });
    const modify = new Modify({
      features: new Collection(round ? handles.slice(1) : [body]),
      insertVertexCondition: never,
      deleteCondition: never,
      pixelTolerance: 10,
    });
    const interactions = [translate, modify];
    for (const interaction of interactions) this.map.addInteraction(interaction);
    /** The shape as the body is now. */
    const bodyShape = (): EditShape | null => {
      const geometry = body.getGeometry();
      const xy = (c: number[]) => [c[0] ?? 0, c[1] ?? 0] as const;
      return round ? handleShape()
        : shape.kind === 'polygon' && geometry instanceof Polygon ? { kind: 'polygon', rings: geometry.getCoordinates().map((ring) => ring.map(xy)) }
          : shape.kind === 'line' && geometry instanceof LineString ? { kind: 'line', points: geometry.getCoordinates().map(xy) }
            : shape.kind === 'point' && geometry instanceof Point ? { kind: 'point', at: xy(geometry.getCoordinates()) } : null;
    };
    if (options?.onChange !== undefined) {
      // While a point or the whole shape is dragged (a tactical graphic's preview follows).
      const changed = options.onChange;
      body.getGeometry()?.on('change', () => {
        const now = bodyShape();
        if (now !== null) changed(now);
      });
    }
    const finish = () => {
      const edited = bodyShape();
      this.stopEditing();
      onEnd(edited);
    };
    const startedFrom = document.activeElement;
    const mapElement = this.map.getTargetElement() as HTMLElement | null;
    const stopKeys = listenForDrawingKeys(document, { enter: finish }, (target) => target === document.body
      || target === document.documentElement || target === startedFrom || (target instanceof Node && mapElement !== null && mapElement.contains(target)));
    this.editing = { layer, interactions, stopKeys, onEnd };
  }

  stopEditing(): void {
    const editing = this.editing;
    if (editing === null) return;
    this.editing = null;
    editing.stopKeys();
    for (const interaction of editing.interactions) interaction.setActive(false);
    // Removed after the event that ended it, as a drawing.
    queueMicrotask(() => {
      for (const interaction of editing.interactions) this.map.removeInteraction(interaction);
      this.map.removeLayer(editing.layer);
      editing.layer.dispose();
    });
  }

  stopDrawing(): void {
    const drawing = this.drawing;
    if (drawing === null) return;
    this.drawing = null;
    drawing.stopKeys();
    drawing.interaction.setActive(false);
    // Removed after the event that ended it: OpenLayers still handles that event in the interaction.
    queueMicrotask(() => {
      this.map.removeInteraction(drawing.interaction);
    });
  }

  pauseDoubleClickZoom(): void {
    if (this.mode !== 'none') return; // off anyway while placing or dragging
    if (this.doubleClickZoomTimer !== null) window.clearTimeout(this.doubleClickZoomTimer);
    this.doubleClickZoom?.setActive(false);
    this.enableDoubleClickZoomLater();
  }

  private enableDoubleClickZoomLater(): void {
    this.doubleClickZoomTimer = window.setTimeout(() => {
      this.doubleClickZoomTimer = null;
      this.doubleClickZoom?.setActive(true);
    }, DOUBLE_CLICK_GRACE_MS);
  }

  setDragHover(hover: boolean): void {
    if (this.mode !== 'pick-point') this.map.getViewport().style.cursor = hover ? 'move' : '';
  }

  setHighlight(items: readonly DrawItem[]): void {
    this.highlighted = items;
    this.highlightSource.clear(true);
    const features: Feature[] = [];
    for (const item of items) {
      if (item.kind === 'graphic' && item.parts !== null) {
        features.push(...graphicHighlightFeatures(item, this.projection));
        continue;
      }
      const geometry = geometryOf(item, this.projection);
      if (geometry === null) continue;
      // The frame fits the symbol's image as drawn: its atlas entry (size and anchor).
      const box = item.kind === 'symbol' ? (item.sensorReport === true ? this.sensorReportEntry() : null) ?? this.atlasEntry(item.symbol) : null;
      const textFrame = item.kind === 'textobject' ? textBox(item.text, item.size, this.textLook, this.textMeter) : null;
      const feature = new Feature(geometry);
      feature.setStyle(item.kind === 'textobject' && textFrame !== null
        ? highlightStyles(item, { w: textFrame.width, h: textFrame.height, ax: textFrame.width / 2, ay: textFrame.height / 2 }, 0, northOnScreen(this.projection, item.position) + (item.rotation * Math.PI) / 180)
        : highlightStyles(item, box));
      features.push(feature);
    }
    this.highlightSource.addFeatures(features);
    if (this.styleKeyNow() !== this.styleKey) this.afterDraw();
  }

  setGrabTest(test: ((pixel: Pixel) => boolean) | null): void {
    this.pointers.setGrabTest(test);
  }

  setDragPreview(item: DrawItem | null): void {
    this.preview = item;
    this.previewSource.clear(true);
    if (item === null) return;
    if (item.kind === 'graphic' && item.parts !== null) {
      this.previewSource.addFeatures(graphicCanvasFeatures(item, this.projection, 0, this.graphicImages));
      return;
    }
    const feature = this.canvasFeature(item, 0);
    if (feature !== null) this.previewSource.addFeature(feature);
  }

  private canvasFeature(item: DrawItem, zIndex: number): Feature | null {
    const geometry = geometryOf(item, this.projection);
    if (geometry === null) return null;
    const report = item.kind === 'symbol' && item.sensorReport === true && this.sensorReportEntry() !== null ? this.sensorReportImage ?? null : null;
    const image = item.kind === 'symbol' ? report ?? this.render(item.symbol, false, item.symbol.sidc) : null;
    const rotation = item.kind === 'symbol' && report === null && item.direction !== null ? arrowRotation(this.projection, item.position, item.direction) : 0;
    const feature = new Feature(geometry);
    if (item.kind === 'text') {
      feature.setStyle(overlayLabelStyle(item.text, item.style, zIndex, this.textLook));
      return feature;
    }
    if (item.kind === 'textobject') {
      feature.setStyle(textObjectStyle(item, northOnScreen(this.projection, item.position) + (item.rotation * Math.PI) / 180, zIndex, this.textLook));
      return feature;
    }
    feature.setStyle([...canvasStyles(report === null && this.directionArrow ? item : { ...item, direction: null } as DrawItem, image, this.arrow, rotation, zIndex), ...canvasLineExtras(item, this.projection, this.arrowhead, zIndex)]);
    return feature;
  }
}

/** Whether the service gave the same sensor report image: the same image element, size and anchor. */
function sameSymbolImage(a: SymbolImage | null, b: SymbolImage | null): boolean {
  if (a === null || b === null) return a === b;
  return a.image === b.image && a.width === b.width && a.height === b.height && a.anchor[0] === b.anchor[0] && a.anchor[1] === b.anchor[1];
}

function subscribe<T>(set: Set<T>, listener: T): Unlisten {
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

/**
 * A vector background as one image layer (brief function 11): OpenLayers draws it to an image and
 * reuses that while the map moves, so pan and zoom stay usable without a GPU (criterion 8), and
 * simplifies the geometries at the current resolution. The data is projected once per projection.
 */
/** The dim layer's element: black, over the whole map, letting every pointer event through. */
function dimElementFor(doc: Document): HTMLElement {
  const element = doc.createElement('div');
  element.className = 'map-view-2d-dim-shade';
  Object.assign(element.style, { position: 'absolute', inset: '0', background: '#000', opacity: '0', pointerEvents: 'none' });
  return element;
}

function vectorBackgroundLayer(data: PreparedVector, attributions: string, wrapX: boolean): VectorImageLayer {
  const features: Feature[] = [];
  data.layers.forEach((layer, index) => {
    const stroke = layer.stroke !== null
      ? new Stroke({ color: cssColor(layer.stroke), width: layer.strokeWidth, lineDash: dashPattern(layer.dash, layer.strokeWidth) })
      : layer.seamCover && layer.fill !== null ? new Stroke({ color: cssColor(layer.fill), width: 1 }) : undefined;
    const style = new Style({
      zIndex: index,
      ...(layer.fill === null ? {} : { fill: new Fill({ color: cssColor(layer.fill) }) }),
      ...(stroke === undefined ? {} : { stroke }),
    });
    if (layer.polygons.length > 0) {
      const feature = new Feature(new MultiPolygon(layer.polygons.map((polygon) => polygon.map((ring) => ring.map(([x, y]) => [x, y])))));
      feature.setStyle(style);
      features.push(feature);
    }
    if (layer.lines.length > 0 && layer.stroke !== null) {
      const feature = new Feature(new MultiLineString(layer.lines.map((line) => line.map(([x, y]) => [x, y]))));
      feature.setStyle(style);
      features.push(feature);
    }
  });
  return new VectorImageLayer({
    zIndex: 0,
    source: new VectorSource({ features, wrapX, attributions }),
    ...(data.background === null ? {} : { background: cssColor(data.background) }),
  });
}

/** The count's size and halo, the map view's own in every density. */
export const CLUSTER_COUNT = { size: 11, haloWidth: 3 } as const;

/**
 * A cluster's marker (brief function 12): a disc split into the standard identity colours in
 * proportion, with a dark rim and the count in the middle, in the look's text colour on a halo in its
 * ground colour and in its data font (brief function 21; owner, 2026-10-20). Drawn on the Canvas in
 * screen pixels, so it keeps its size at every zoom; the fills stay the fixed affiliation colours.
 */
function clusterStyle(item: ClusterItem, look: TextLook): Style {
  return new Style({
    renderer: (coordinates, state) => {
      const [x, y] = coordinates as number[];
      if (x === undefined || y === undefined) return;
      const ctx = state.context;
      const r = clusterRadius(item.count) * state.pixelRatio;
      ctx.save();
      let start = -Math.PI / 2;
      for (const key of IDENTITIES) {
        const share = item.identity[key];
        if (share <= 0) continue;
        const angle = (share / item.count) * 2 * Math.PI;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.arc(x, y, r, start, start + angle);
        ctx.closePath();
        ctx.fillStyle = IDENTITY_COLOURS[key];
        ctx.fill();
        start += angle;
      }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, 2 * Math.PI);
      ctx.lineWidth = 1.5 * state.pixelRatio;
      ctx.strokeStyle = '#202020';
      ctx.stroke();
      ctx.font = `bold ${String(CLUSTER_COUNT.size * state.pixelRatio)}px ${look.dataFont}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      ctx.lineWidth = CLUSTER_COUNT.haloWidth * state.pixelRatio;
      ctx.strokeStyle = cssColor(look.halo);
      ctx.strokeText(clusterLabel(item.count), x, y);
      ctx.fillStyle = cssColor(look.text);
      ctx.fillText(clusterLabel(item.count), x, y);
      ctx.restore();
    },
  });
}

/** The direction arrow for a symbol size, with its image as a URL for the WebGL style. */
function arrowFor(symbolSize: number): { readonly canvas: HTMLCanvasElement; readonly anchor: readonly [number, number]; readonly url: string } {
  const arrow = arrowImage(createCanvas, symbolSize * 1.5);
  return { ...arrow, url: arrow.canvas.toDataURL('image/png') };
}

/** The shape being edited as an OpenLayers geometry; a circle and an ellipse start as a polygon that `reshape` fills in. */
function editBodyGeometry(shape: EditShape): Polygon | LineString | Point {
  switch (shape.kind) {
    case 'polygon':
      return new Polygon(shape.rings.map((ring) => ring.map((xy) => [...xy])));
    case 'line':
      return new LineString(shape.points.map((xy) => [...xy]));
    case 'point':
      return new Point([...shape.at]);
    case 'circle':
    case 'ellipse':
      return new Polygon([]);
  }
}

/** A handle the user drags while editing: a white square with a dark outline. */
const EDIT_HANDLE_STYLE = new Style({
  image: new RegularShape({ points: 4, radius: 7, angle: Math.PI / 4, fill: new Fill({ color: '#ffffff' }), stroke: new Stroke({ color: '#1a1a1a', width: 1.5 }) }),
});
/** The centre of a circle or ellipse being edited: a small dot (it moves with the shape). */
const EDIT_CENTRE_STYLE = new Style({ image: new CircleStyle({ radius: 3, fill: new Fill({ color: '#1a1a1a' }) }) });

/** The centre of a circle or ellipse being edited. */
function centreOf(shape: EditShape): XY {
  return shape.kind === 'circle' || shape.kind === 'ellipse' ? shape.center : [0, 0];
}

/** A handle on each point of a line, a polygon's ring or a point: the style of a tactical graphic's edit. */
function vertexHandles(feature: FeatureLike): Style {
  return new Style({
    geometry: () => {
      const geometry = (feature as Feature).getGeometry();
      const coordinates = geometry instanceof LineString ? geometry.getCoordinates()
        : geometry instanceof Polygon ? (geometry.getCoordinates()[0] ?? []).slice(0, -1)
          : geometry instanceof Point ? [geometry.getCoordinates()] : [];
      return new MultiPoint(coordinates);
    },
    image: EDIT_HANDLE_STYLE.getImage() ?? undefined,
  });
}
