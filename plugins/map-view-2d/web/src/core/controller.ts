/**
 * The map view without OpenLayers: it takes the live picture, decides what the engine draws and
 * when, and is the `MapView` service other plugins use (brief functions 2–8). The engine
 * (`engine.ts`) only draws and reports pointer events.
 */
import { classShown, DISPLAY_CLASSES, MAX_FETCH_IDS, NotALineError, NotOnMapError, overlayProblem, VIEW_WORKSPACE, workspaceOf } from '@emc2/plugin-sdk';
import type {
  BackgroundMapProvider, MilSymbol, SymbolService, DrawKind, DrawnGeometry, FadeList, Geometry, JsonValue, Layer, LineString, LivePictureListener, MapPointerEvent, MapType, MapView, MenuTarget, Notification, Objects, Overlay, OverlayItem, Pixel, PluginLog, Position, ScreenPoint, SharedState,
  Snapshot, ChangeEvent, AreaChange, ClusterUpdate, DataType, DisplaySettings, MapObject, RelationKind, RelationLine, Style, Uuid, VectorFeature, Viewport,
} from '@emc2/plugin-sdk';
import { chooseBackground, compatibleProviders, providerProblem, type BackgroundChoices, type ChoiceStore } from './background.ts';
import { CLUSTER_CLICK_GRACE_MS, CLUSTER_ZOOM_FACTOR, clusterAt, ClusterStore, type ClusterItem } from './clusters.ts';
import { RedrawScheduler, type Clock } from './cadence.ts';
import { appearanceKey, directionOf, firstPosition, inProjection, sensorReportTypesOf, toDrawItem, type DrawItem } from './drawData.ts';
import { placedLabelsOf } from './labelPlaces.ts';
import { relationEnds, relationLines, type RelationInput } from './relations.ts';
import { FarEnds } from './farEnds.ts';
import { speedVectorSecondsOf } from './vectors.ts';
import { drawsGraphics, extentOfRing, GraphicPreview, GraphicRenderer, translatedParts, type GraphicView } from './graphics.ts';
import { createSharedState, Emitter, sameIds } from './emitter.ts';
import { ExpiryTracker, FADED_OPACITY } from './expiry.ts';
import { fitResolution, mapExtent, middleOf } from './extent.ts';
import { dimLevel, MAX_SHARED_LAYERS, readShare, shareToJson } from './setup.ts';
import type { DrawingOptions, EditingOptions, Engine, EngineBackground, EngineLayer, EnginePointerEvent, InteractionMode } from './engine.ts';
import { densifyPath, distance } from './geodesic.ts';
import { orderLayers } from './layerOrder.ts';
import { LiveStore } from './liveStore.ts';
import { boxAt, DEFAULT_TOLERANCE, pickAt, type PixelBox } from './pick.ts';
import { boxSelection, clickSelection, createSelection, type SelectionResult } from './selection.ts';
import { appendedLine, drawnGeometry, editedGeometry, editShapeOf, moveRound, multiPointEditShape, multiPointGeometry, reshape, type DrawnShape, type EditShape, type XY } from './drawing.ts';
import type { Projection } from './projections.ts';
import { RenderingNotice, type RenderingCheck } from './rendering.ts';
import type { MapSettings } from './settings.ts';
import { prepareVector, type PreparedVector } from './vectorBackground.ts';
import { wmsGrid } from './wms.ts';
import { groundResolution, mapToPixel, pixelToMap, resolutionForZoom, sameView, viewIn, visibleArea, type ProjectedView } from './viewport.ts';

/** Largest pick tolerance in pixels. */
export const MAX_TOLERANCE = 50;
/** At most this many selected objects are highlighted (a selection is bounded input from other plugins). */
export const MAX_HIGHLIGHTED = 1_000;
/** At most this many ids per fade list; more are left out (inputs are bounded). */
export const MAX_FADE_IDS = 10_000;
/** A background a restored setup names but no plugin provides yet is waited for this long before the notice (owner, 2026-10-17). */
export const BACKGROUND_WAIT_MS = 10_000;
/** A `goTo` centre this far from the one asked for (in metres on the ground) was clamped; below it is rounding. */
const CLAMP_TOLERANCE_METRES = 1;
/** After the user finishes a drawing or an edit, a click for this long is the last click of that finish, not a click on the map (SF A). */
export const FINISH_CLICK_GRACE_MS = 50;

/** A position for log lines: longitude, latitude, in degrees. */
function formatPosition([lon, lat]: Position): string {
  return `[${lon.toFixed(4)}, ${lat.toFixed(4)}]`;
}

export interface ControllerOptions {
  readonly engine: Engine;
  readonly settings: MapSettings;
  /** The usable projections (registered), the engine's current one among them. */
  readonly projections: readonly Projection[];
  readonly rendering: RenderingCheck;
  readonly clock: Clock;
  /** The page's origin, for checking background map URLs. */
  readonly origin: string;
  readonly log: PluginLog;
  /** Where the background chosen per projection is kept (per browser); without it, for the page only. */
  readonly choices?: ChoiceStore;
  /** The available data types with their effective behaviour (`ctx.dataTypes`); without them nothing fades. */
  readonly dataTypes?: readonly DataType[];
  /** Shows the user a notice (`ctx.notify`), e.g. what a selection box left out. */
  readonly notify?: (notification: Notification) => void;
  /** Reads objects the map does not hold, by id (`ctx.objects`), for Centre on and Zoom to. */
  readonly objects?: Pick<Objects, 'get'>;
  /** Opens the shell's menu (`ctx.actions.openMenu`) on a right click (brief function 15). */
  readonly openMenu?: (at: ScreenPoint, target: MenuTarget) => void;
  /** Tells the shell that the map view's share of the setup changed (`ctx.setup.changed`, brief function 20). */
  readonly setupChanged?: () => void;
  /** The workspace shown at start (`ctx.workspace`); View if not given, for tests. */
  readonly workspace?: string;
  /** The live picture subscription may need renewing ({@link MapController.needsSubscription}, brief function 23). */
  readonly subscriptionChanged?: () => void;
  /** The user's display settings (`ctx.display.value`, brief function 35) at start. */
  readonly display: DisplaySettings;
  /** The relation kinds the loaded plugins declare (`ctx.relationKinds`, brief function 34). */
  readonly relationKinds?: readonly RelationKind[];
  /** Each kind's line with its colour from settings (`ctx.relationLines.value`, brief function 43); absent in an older shell. */
  readonly relationLines?: Readonly<Record<string, RelationLine>>;
}

/** The view the map starts with (settings: initial projection, centre and zoom). */
export function initialView(settings: MapSettings, projections: readonly Projection[]): { projection: Projection; center: [number, number]; resolution: number } | null {
  const projection = projections.find((p) => p.def.code === settings.initialProjection) ?? projections[0];
  if (projection === undefined) return null;
  const resolution = resolutionForZoom(projection, settings.initialZoom);
  const metres = groundResolution(projection, projection.forward(settings.initialCenter) ?? [0, 0], resolution);
  return { projection, ...viewIn(projection, settings.initialCenter, metres) };
}

type Interaction =
  | { readonly kind: 'pick-point'; readonly resolve: (position: Position | null) => void }
  | {
      readonly kind: 'drag-object';
      readonly id: Uuid;
      grab: Grab | null;
      current: Position | null;
      readonly resolve: (position: Position | null) => void;
    }
  | {
      readonly kind: 'draw';
      readonly resolve: (geometry: DrawnGeometry | null) => void;
      /** `MapView.append` (brief function 44): the held line being continued, with its own points as they were at the start. */
      readonly appendTo?: { readonly id: Uuid; readonly own: readonly Position[]; readonly ownXY: number };
    }
  | { readonly kind: 'edit'; readonly id: Uuid; readonly resolve: (geometry: Geometry | null) => void; readonly asMultiPoint?: boolean };

/**
 * A press that grabbed the dragged object. The object's state is taken at that press, not when the
 * drag was prepared: the object may have moved since (draw-symbols prepares the next drag right
 * after a drop, before the change event of its update arrives).
 */
interface Grab {
  /** Map coordinates of the press. */
  readonly start: readonly [number, number];
  readonly item: DrawItem;
  /** The object's first position, and in map coordinates. */
  readonly anchor: Position;
  readonly anchorXY: readonly [number, number];
}

export class MapController {
  readonly store = new LiveStore();
  readonly notice: RenderingNotice;
  /** The `MapView` service (`emc2.map-view`). */
  readonly service: MapView;
  /** For the live picture subscription. */
  readonly listener: LivePictureListener = {
    snapshot: (snapshot) => {
      if (!this.pictureDropped) this.onSnapshot(snapshot);
    },
    changes: (batch) => {
      if (!this.pictureDropped) this.onChanges(batch);
    },
    area: (change) => {
      if (!this.pictureDropped) this.onArea(change);
    },
    clusters: (update) => {
      if (!this.pictureDropped) this.onClusters(update);
    },
  };

  private readonly engine: Engine;
  private readonly log: PluginLog;
  private readonly scheduler: RedrawScheduler;
  /** Draws the tactical graphics through the symbology service (brief function 29). */
  private readonly graphics: GraphicRenderer;
  private symbolService: SymbolService | null = null;
  /** The preview of a tactical graphic being placed or edited (brief function 32). */
  private graphicPreview: GraphicPreview | null = null;
  /** The local visibility in the workspace shown; each workspace keeps its own during the page (brief function 23). */
  private visibility = new Map<Uuid, boolean>();
  private readonly visibilityByWorkspace = new Map<string, Map<Uuid, boolean>>();
  /** The workspace shown (brief function 22). */
  private shown: string;
  /** The workspace of every layer seen during the page, so that a View layer is known as a reference elsewhere. */
  private readonly layerWorkspaces = new Map<Uuid, string>();
  /** The active layer each workspace had when it was left, during the page (brief function 22). */
  private readonly activeByWorkspace = new Map<string, Uuid>();
  /**
   * From a switch's moment until the map view's `onChange` listener: the active layer is not
   * recorded, the subscription not renewed, and no layer is drawn, so the new workspace's objects
   * never show at the old workspace's centre before the shell restores the new one's share
   * (ITA finding e, owner 2026-10-28: after a reload the server's snapshot throttle can hold
   * step 3 for 2 s).
   */
  private switching = false;
  /** Whether a snapshot of the picture came since the last switch's moment (not a dropped one). */
  private snapshotSinceMoment = false;
  /** An active layer brought back before the workspace's snapshot: the next snapshot checks it still exists (review F2). */
  private activeToCheck: Uuid | null = null;
  /** The workspaces the live picture subscription names; null while it follows the workspace shown. */
  private subscribedTo: readonly string[] | null = null;
  /** After a switch's moment, a subscription that names workspaces is not drawn until it is renewed (owner, 2026-10-28, T-085 Q2). */
  private pictureDropped = false;
  /** The fade lists by handle, and their union (brief function 24, ADR-0040). */
  private readonly fadeLists = new Map<number, ReadonlySet<Uuid>>();
  private fadeListCount = 0;
  private faded: ReadonlySet<Uuid> = new Set();
  /** The current settings and usable projections; both may change while the map runs (design pattern section 7). */
  private settings: MapSettings;
  private projections: readonly Projection[];
  private readonly clusters = new ClusterStore();
  /** Which objects are faded, and when the others will fade (brief function 13). */
  private readonly expiry: ExpiryTracker;
  private expiryTimer: unknown = null;
  /** The clusters drawn now (for a click on one). */
  private drawnClusters: readonly ClusterItem[] = [];
  /** When a click last zoomed in on a cluster (monotonic ms). */
  private lastClusterZoom = -Infinity;
  /** When a drawing or an edit was last finished by the user (the engine's own end): see `justFinished`. */
  private lastFinished = -Infinity;
  private engineLayers: readonly EngineLayer[] = [];
  private readonly viewportChanges: Emitter<Viewport>;
  private readonly pointer: Emitter<MapPointerEvent>;
  private readonly stateChanges: Emitter<undefined>;
  private readonly selection: SharedState<readonly Uuid[]>;
  private readonly activeLayer: SharedState<Uuid | null>;
  private cachedViewport: Viewport | null = null;
  private lastCenter: Position;
  private lastResolution: number;
  private interaction: Interaction | null = null;
  /** The drag preview shown now (the highlight follows it). */
  private preview: DrawItem | null = null;
  /** While a snapshot or batch is applied, the highlight is refreshed once at its end. */
  private highlightHeld = false;
  private highlightPending = false;
  private dragHover = false;
  private overlays = 0;
  /** What each overlay was last given, so that a display class's switch can show or hide its items again (brief function 40). */
  private readonly overlaySources = new Map<string, readonly OverlayItem[]>();
  /** The user's display settings (brief function 35). */
  private display: DisplaySettings;
  /** The ids of the data types that declare `sensorReport` (brief function 39). */
  private sensorReportTypes: ReadonlySet<string> = new Set();
  private readonly relationKinds: readonly RelationKind[];
  private relationStyles: Readonly<Record<string, RelationLine>> | undefined;
  /** The objects relation lines run to that the map does not hold, fetched for the lines (brief function 41). */
  private readonly farEnds: FarEnds;
  /** The relation lines drawn now, by item id, with what they were drawn from (brief function 34). */
  private readonly relationLinesDrawn = new Map<string, { readonly layerId: Uuid; readonly key: string }>();
  private providers: readonly BackgroundMapProvider[] = [];
  private readonly reportedProviders = new Set<string>();
  /** The user's last choice of background in any projection; undefined until the user chooses. */
  private backgroundChoice: string | null | undefined = undefined;
  /** A background a restored setup named that is not shown yet, and the wait for it (brief function 20). */
  private pendingBackground: { readonly id: string; readonly timer: unknown } | null = null;
  /** The dim level in percent (brief function 19). */
  private dim = 0;
  /** The map type last reported to `onMapTypeChange` listeners. */
  private reportedMapType: string | null = null;
  /** While setMapType or a restore switches projection and background: one report at the end. */
  private mapTypeHeld = false;
  /** Whether the live picture's first snapshot has come (layer visibility from a setup waits for it). */
  private snapshotSeen = false;
  /**
   * The centre and zoom of the share last restored, and the projected view they gave, until the view
   * differs: saved exactly as read, so the shell sees an unchanged setup (OpenLayers' round trip
   * changes the last digits; ITA, 2026-10-19). A centre beyond the projection stays as stored (owner, 2026-10-19).
   */
  private restoredView: { readonly view: ProjectedView; readonly center: Position; readonly metresPerPixel: number } | null = null;
  private readonly mapTypeChanges: Emitter<MapType>;
  private readonly visibilityChanges: Emitter<{ readonly layerId: Uuid; readonly visible: boolean }>;
  /** The user's last choice per projection, kept per browser. */
  private choices: BackgroundChoices;
  private shownBackground: BackgroundMapProvider | null = null;
  /** What the engine draws now (null: the graticule, also at start). */
  private engineBackground: EngineBackground | null = null;
  /** Vector backgrounds by provider id: loaded at most once per page, prepared once per projection (brief function 11). */
  private readonly vectorBackgrounds = new Map<string, VectorBackgroundState>();
  private disposed = false;
  private readonly unlisten: (() => void)[] = [];

  constructor(private readonly options: ControllerOptions) {
    const { engine, log, settings, rendering, clock } = options;
    this.engine = engine;
    this.log = log;
    const reportError = (error: unknown) => {
      log.error('a map view listener failed', error);
    };
    this.settings = settings;
    this.display = options.display;
    this.relationKinds = options.relationKinds ?? [];
    this.relationStyles = options.relationLines;
    this.farEnds = new FarEnds({ objects: options.objects, clock: options.clock, log: this.log, changed: () => { this.refreshRelations(); } });
    this.pushDisplay();
    this.shown = options.workspace ?? VIEW_WORKSPACE;
    this.projections = options.projections;
    this.choices = options.choices?.load() ?? {};
    this.expiry = new ExpiryTracker(options.dataTypes ?? []);
    this.sensorReportTypes = sensorReportTypesOf(options.dataTypes ?? []);
    this.viewportChanges = new Emitter(reportError);
    this.pointer = new Emitter(reportError);
    this.stateChanges = new Emitter(reportError);
    this.mapTypeChanges = new Emitter(reportError);
    this.visibilityChanges = new Emitter(reportError);
    this.selection = createSelection(options.log, reportError);
    this.activeLayer = createSharedState<Uuid | null>(null, reportError);
    this.selection.onChange(() => {
      this.refreshHighlight();
    });
    this.notice = new RenderingNotice(rendering.mode);
    this.scheduler = new RedrawScheduler(clock, settings.updateCadenceMs, (layerId) => {
      this.redraw(layerId);
    });
    this.graphics = new GraphicRenderer({
      symbols: () => this.symbolService,
      view: () => this.graphicView(),
      deliver: (layerId, items) => {
        this.deliverGraphics(layerId, items);
      },
      log,
      clock,
    });
    this.lastCenter = settings.initialCenter;
    const p = engine.projection;
    this.lastResolution = groundResolution(p, p.forward(settings.initialCenter) ?? [0, 0], resolutionForZoom(p, settings.initialZoom));

    this.unlisten.push(
      engine.onViewChange(() => {
        this.cachedViewport = null;
        this.graphics.viewChanged(); // a zoom, or a pan out of the drawn extent: the graphics in view are drawn again (brief function 29)
        if (this.viewportChanges.size > 0) this.viewportChanges.emit(this.viewport());
        this.options.setupChanged?.(); // the shell saves at most about once per second
      }),
      engine.onPointer((event) => {
        this.onEnginePointer(event);
      }),
      // Escape cancels a running interaction first; only the next one clears the selection (brief
      // function 14, criterion 41). A drag that only waits for its press is not running, as clicks
      // still select then: one Escape ends the wait with null and clears (owner, 2026-10-20).
      engine.onEscape(() => {
        const interaction = this.interaction;
        const waiting = interaction?.kind === 'drag-object' && interaction.grab === null;
        if (interaction !== null) this.endInteraction(null);
        if (interaction === null || waiting) this.selection.set([]);
      }),
      engine.onSelectBox((box) => {
        this.selectBox(box);
      }),
    );

    const currentViewport = () => this.viewport();
    const currentMapType = () => this.mapType;
    this.service = Object.freeze<MapView>({
      get viewport() {
        return currentViewport();
      },
      onViewportChange: (listener) => this.viewportChanges.on(listener),
      goTo: (center, resolution) => {
        this.goTo(center, resolution);
      },
      onPointer: (listener) => this.pointer.on(listener),
      pick: (pixel, tolerance) => this.pick(pixel, tolerance),
      pickPoint: (options) => this.pickPoint(options?.signal),
      dragObject: (id, options) => this.dragObject(id, options?.signal),
      createOverlay: () => this.createOverlay(),
      createFadeList: () => this.createFadeList(),
      selection: this.selection,
      activeLayer: this.activeLayer,
      setLayerVisible: (layerId, visible) => {
        this.setLayerVisible(layerId, visible);
      },
      isLayerVisible: (layerId) => this.isLayerVisible(layerId),
      onLayerVisibilityChange: (listener) => this.visibilityChanges.on(({ layerId, visible }) => {
        listener(layerId, visible);
      }),
      centreOn: (ids) => this.showObjects(ids, false),
      zoomTo: (ids) => this.showObjects(ids, true),
      draw: (kind, options) => this.draw(kind, options?.style, options?.signal, options?.graphic),
      edit: (id, options) => this.edit(id, options?.style, options?.signal),
      append: (id, options) => this.append(id, options?.style, options?.signal),
      get mapType() {
        return currentMapType();
      },
      onMapTypeChange: (listener) => this.mapTypeChanges.on(listener),
      setMapType: (mapType) => this.setMapType(mapType),
      renderingMode: rendering.mode,
      renderer: rendering.renderer,
    });
  }

  // ---- Live picture (brief functions 4 and 5) ----

  private onSnapshot(snapshot: Snapshot): void {
    this.snapshotSeen = true;
    this.holdHighlight(() => {
      this.reportingVisibility(snapshot.layers.map((l) => l.id), () => {
        this.showSnapshot(snapshot);
      });
    });
    this.checkSubscription();
  }

  private showSnapshot(snapshot: Snapshot): void {
    this.store.snapshot(snapshot);
    this.scheduler.dispose();
    for (const layer of snapshot.layers) this.layerWorkspaces.set(layer.id, workspaceOf(layer));
    if (!this.pictureDropped) {
      this.snapshotSinceMoment = true;
      const check = this.activeToCheck;
      this.activeToCheck = null;
      if (check !== null && this.activeLayer.value === check && !this.store.layers.has(check)) this.activeLayer.set(null);
    }
    // Local visibility of layers the new picture no longer has is forgotten (review remark N2), once
    // the picture has every layer the workspace shown can show: in a declared workspace whose
    // subscription does not name View, an id it does not hold may be one of View's layers. A picture
    // dropped at a switch's moment forgets nothing.
    if (!this.pictureDropped && this.pictureHasReferences()) {
      const present = new Set([...this.store.layers.keys(), ...this.store.unknownLayers()]);
      for (const id of [...this.visibility.keys()]) if (!present.has(id)) this.visibility.delete(id);
    }
    this.pushLayers();
    const groups = this.store.objectsByLayer();
    this.expiry.clear();
    this.relationLinesDrawn.clear(); // `replaceItems` empties the layers, relation lines included
    for (const layer of this.engineLayers) this.engine.replaceItems(layer.id, this.drawItems(groups.get(layer.id) ?? []));
    this.refreshRelations();
    this.watchExpiry();
    this.cancelDragOfMissingObject();
    // Selected objects the new picture does not have stay selected (criterion 40); the highlight,
    // refreshed with the layers above, shows only what is drawn.
    // The clusters for the new picture come as a full set (brief function 12).
    this.clusters.clear();
    this.pushClusters();
  }

  private onChanges(batch: readonly ChangeEvent[]): void {
    this.holdHighlight(() => {
      this.applyChanges(batch);
    });
  }

  /**
   * Objects entered or left the area (brief function 12): left ones go from the map but stay
   * selected (brief function 14, criterion 40); a drag of one ends with null.
   */
  private onArea(change: AreaChange): void {
    this.holdHighlight(() => {
      this.afterStoreChange(this.store.applyArea(change), new Set());
      if (change.left.length > 0) this.cancelDragOfMissingObject();
    });
  }

  private onClusters(update: ClusterUpdate): void {
    this.clusters.apply(update);
    this.pushClusters();
  }

  /**
   * Hands the engine the clusters, without the objects of locally hidden layers, and without the
   * clusters outside the projection's world extent: objects there are not drawn, and neither are
   * their clusters (owner, 2026-10-12; zoomed out in EPSG:3413 the area reaches far south of
   * 30° N). Not drawn, so not clicked either.
   */
  private pushClusters(): void {
    const projection = this.engine.projection;
    const items = this.clusters.visible((layerId) => this.isLayerDrawn(layerId)).filter((c) => projection.isValid(c.position));
    if (items.length === 0 && this.drawnClusters.length === 0) return;
    this.drawnClusters = items;
    this.engine.setClusters(items);
  }

  private applyChanges(batch: readonly ChangeEvent[]): void {
    const result = this.store.apply(batch);
    for (const e of batch) {
      if (e.entityType !== 'layer') continue;
      if (e.state === null) {
        // A deleted layer's local visibility is forgotten, so a layer created later starts from its own field (N2).
        this.visibility.delete(e.entityId);
        this.layerWorkspaces.delete(e.entityId);
        for (const [workspace, id] of this.activeByWorkspace) if (id === e.entityId) this.activeByWorkspace.delete(workspace);
      } else {
        this.layerWorkspaces.set(e.entityId, workspaceOf(e.state as Layer));
      }
    }
    const gone = new Set(batch.filter((e) => e.entityType === 'object' && e.state === null).map((e) => e.entityId));
    this.afterStoreChange(result, gone);
    // A deleted object leaves every fade list (brief function 24).
    if ([...gone].some((id) => this.faded.has(id))) {
      for (const [listId, list] of this.fadeLists) this.fadeLists.set(listId, new Set([...list].filter((id) => !gone.has(id))));
      this.updateFaded();
    }
    if (result.layersChanged) this.checkSubscription();
  }

  /** After the store changed: layers, redraws, and deleted objects leave the selection (the only ones that do, criterion 40). */
  private afterStoreChange({ layersChanged, dirtyLayers }: { readonly layersChanged: boolean; readonly dirtyLayers: ReadonlySet<Uuid> }, gone: ReadonlySet<Uuid>): void {
    const known = new Set(this.engineLayers.map((l) => l.id));
    const unknownLayersChanged = !sameIds(this.store.unknownLayers().sort(), this.engineLayers.filter((l) => !this.store.layers.has(l.id)).map((l) => l.id));
    if (layersChanged || unknownLayersChanged || [...dirtyLayers].some((id) => !known.has(id))) this.pushLayers();
    for (const layerId of dirtyLayers) this.scheduler.changed(layerId);

    if (gone.size > 0) {
      // The selection first: a plugin that follows it lets go before the drag's null reaches it.
      this.pruneSelection(gone);
      this.cancelDragOfMissingObject();
    }
  }

  private pruneSelection(gone: ReadonlySet<Uuid>): void {
    const kept = this.selection.value.filter((id) => !gone.has(id));
    if (kept.length !== this.selection.value.length) this.selection.set(kept);
  }

  private redraw(layerId: Uuid): void {
    const pending = this.store.takePending(layerId);
    if (!this.engineLayers.some((l) => l.id === layerId)) return;
    const changes = new Map<Uuid, DrawItem | null>();
    for (const [id, object] of pending) {
      if (object === null && !this.store.objects.has(id)) {
        this.expiry.forget(id);
        this.graphics.forget(id);
      }
      changes.set(id, object === null ? null : this.drawItem(object));
    }
    if (changes.size > 0) this.engine.updateItems(layerId, changes);
    this.refreshRelations();
    this.watchExpiry();
    // The highlight follows what is drawn: refresh it when a selected object was redrawn.
    if (this.selection.value.some((id) => changes.has(id))) this.refreshHighlight();
  }

  // ---- Expired objects (brief function 13) ----

  /** The draw item of a held object, faded if it has expired or is on a fade list; remembers when it will fade otherwise. */
  private drawItem(object: MapObject): DrawItem | null {
    const item = toDrawItem(object, this.sensorReportTypes);
    if (item === null) return null;
    this.expiry.track(object, this.options.clock.wallNow());
    if (this.hidden(object)) return null; // the user's switch for its display class is off (brief function 40), or its fade in steps has reached 0 (function 46)
    return this.withParts(this.withFading(item, object.id), true);
  }

  /**
   * The opacity of an object of a data type with a fade in steps (brief function 46): its step, or the fade list's if that is lower;
   * undefined for any other object. At 0 the object is not drawn, picked or selected by a click.
   */
  private fadeStep(id: Uuid): number | undefined {
    const step = this.expiry.step(id);
    return step === undefined ? undefined : Math.min(step, this.faded.has(id) ? FADED_OPACITY : 1);
  }

  /** Neither drawn nor picked: its display class is switched off (function 40), or its fade in steps has reached 0 (function 46). */
  private hidden(object: MapObject): boolean {
    return this.classHidden(object) || this.fadeStep(object.id) === 0;
  }

  /** The item as it is drawn: at its step's opacity, in place of the expiry fade (function 46), else faded when it has expired or is on a fade list. */
  private withFading(item: DrawItem, id: Uuid): DrawItem {
    const step = this.fadeStep(id);
    if (step !== undefined) return step < 1 ? { ...item, opacity: step } : item;
    return this.expiry.isFaded(id) || this.faded.has(id) ? { ...item, faded: true } : item;
  }

  /** A tactical graphic with what is drawn of it (brief function 29); `ask` also asks the service to draw it if it is in view. */
  private withParts(item: DrawItem, ask: boolean): DrawItem {
    if (item.kind !== 'graphic') return item;
    return ask ? this.graphics.attach(item) : this.graphics.current(item);
  }

  private drawItems(objects: readonly MapObject[]): DrawItem[] {
    const items: DrawItem[] = [];
    for (const object of objects) {
      const item = this.drawItem(object);
      if (item !== null) items.push(item);
    }
    return items;
  }

  /** The draw item as it is drawn now, without changing what is tracked (for the highlight and a grab). */
  private shownItem(object: MapObject): DrawItem | null {
    const item = toDrawItem(object, this.sensorReportTypes);
    if (item === null || this.hidden(object)) return null;
    return this.withParts(this.withFading(item, object.id), false);
  }

  /** The data types' behaviour changed (`onDataTypesChange`): applied at once, without reload. */
  setDataTypes(dataTypes: readonly DataType[]): void {
    this.expiry.setDataTypes(dataTypes);
    // The objects of a data type that became a sensor report, or stopped being one, are drawn again (brief function 39).
    const before = this.sensorReportTypes;
    this.sensorReportTypes = sensorReportTypesOf(dataTypes);
    const flipped = new Set([...before, ...this.sensorReportTypes].filter((id) => before.has(id) !== this.sensorReportTypes.has(id)));
    const changes = new Map<Uuid, Map<Uuid, DrawItem | null>>();
    const now = this.options.clock.wallNow();
    for (const object of this.store.objects.values()) {
      const wasFaded = this.expiry.isFaded(object.id);
      const wasStep = this.expiry.step(object.id);
      this.expiry.track(object, now);
      if (this.expiry.isFaded(object.id) === wasFaded && this.expiry.step(object.id) === wasStep && !flipped.has(object.dataType)) continue; // most objects: nothing to draw again
      const item = this.shownItem(object); // null: not drawn now, so it is taken off the map if it was
      let layer = changes.get(object.layerId);
      if (layer === undefined) changes.set(object.layerId, (layer = new Map<Uuid, DrawItem | null>()));
      layer.set(object.id, item);
    }
    this.applyFading(changes);
    this.watchExpiry();
  }

  /**
   * Expiry comes without a change event: while some object will still fade, the clock is checked
   * at the update cadence (about once a second), and only the objects that have just expired are
   * drawn again.
   */
  private watchExpiry(): void {
    if (this.expiryTimer !== null || !this.expiry.waiting || this.disposed) return;
    this.expiryTimer = this.options.clock.setTimeout(() => {
      this.expiryTimer = null;
      const changes = new Map<Uuid, Map<Uuid, DrawItem | null>>();
      for (const id of this.expiry.due(this.options.clock.wallNow())) {
        const object = this.store.objects.get(id);
        if (object === undefined || toDrawItem(object, this.sensorReportTypes) === null) continue;
        let layer = changes.get(object.layerId);
        if (layer === undefined) changes.set(object.layerId, (layer = new Map<Uuid, DrawItem | null>()));
        layer.set(id, this.drawItem(object)); // tracks it again: the new step, and when the next one comes; null once it is invisible
      }
      this.applyFading(changes);
      this.watchExpiry();
    }, this.settings.updateCadenceMs);
  }

  private applyFading(changes: ReadonlyMap<Uuid, ReadonlyMap<Uuid, DrawItem | null>>): void {
    let selected = false;
    for (const [layerId, items] of changes) {
      if (!this.engineLayers.some((l) => l.id === layerId)) continue;
      this.engine.updateItems(layerId, items);
      selected ||= this.selection.value.some((id) => items.has(id));
    }
    this.refreshRelations();
    if (selected) this.refreshHighlight();
  }

  /**
   * The map layers, bottom first: View's layers shown as a reference in another workspace, by
   * drawOrder (brief function 23, open question 3); the workspace's own layers by drawOrder; then
   * layers only objects name (criterion 10).
   */
  private pushLayers(): void {
    const layers = [...this.store.layers.values()];
    const reference = layers.filter((l) => this.isReferenceLayer(l.id));
    const own = layers.filter((l) => !this.isReferenceLayer(l.id));
    const ordered: Uuid[] = [...orderLayers(reference), ...orderLayers(own)].map((l) => l.id);
    const unknown = this.store.unknownLayers().sort();
    const engineLayers = [...ordered, ...unknown].map((id, stack) => ({ id, stack, visible: this.isLayerDrawn(id) }));
    const kept = new Set(engineLayers.map((l) => l.id));
    for (const old of this.engineLayers) if (!kept.has(old.id)) this.scheduler.forget(old.id);
    this.engineLayers = engineLayers;
    this.engine.setLayers(engineLayers);
    this.refreshHighlight();
    this.pushClusters(); // a layer's visibility may have changed
  }

  // ---- Selection highlight (owner, 2026-10-09) ----

  /**
   * Hands the engine the draw items of the selected objects that are drawn now: not in a hidden
   * layer, at the drag preview's place while one is dragged. Only these are drawn again.
   */
  private refreshHighlight(): void {
    if (this.highlightHeld) {
      this.highlightPending = true;
      return;
    }
    const items: DrawItem[] = [];
    const visible = new Set(this.engineLayers.filter((l) => l.visible).map((l) => l.id));
    const ids = this.selection.value.slice(0, MAX_HIGHLIGHTED);
    // The line being continued is highlighted while `append` runs (brief function 44), selected or not.
    const appending = this.interaction?.kind === 'draw' ? this.interaction.appendTo?.id : undefined;
    if (appending !== undefined && !ids.includes(appending)) ids.push(appending);
    for (const id of ids) {
      const object = this.store.objects.get(id);
      // A reference object is never selected, so it is not highlighted either (brief function 23, T-085 A5).
      if (object === undefined || !visible.has(object.layerId) || this.isReferenceLayer(object.layerId)) continue;
      const dragged = this.interaction?.kind === 'drag-object' && this.interaction.id === id ? this.preview : null;
      const item = dragged ?? this.shownItem(object);
      if (item !== null) items.push(item);
    }
    this.engine.setHighlight(items);
  }

  /** Runs `update` with highlight refreshes held back, then refreshes once if any was asked for. */
  private holdHighlight(update: () => void): void {
    if (this.highlightHeld) {
      update();
      return;
    }
    this.highlightHeld = true;
    try {
      update();
    } finally {
      this.highlightHeld = false;
    }
    if (this.highlightPending) {
      this.highlightPending = false;
      this.refreshHighlight();
    }
  }

  private showPreview(item: DrawItem | null): void {
    // The object being dragged, or the one whose drag just ended (the highlight goes back to it).
    const id = item?.id ?? this.preview?.id;
    this.preview = item;
    this.engine.setDragPreview(item);
    if (id !== undefined && this.selection.value.includes(id)) this.refreshHighlight();
  }

  private setDragHover(hover: boolean): void {
    if (hover === this.dragHover) return;
    this.dragHover = hover;
    this.engine.setDragHover(hover);
  }

  // ---- Local layer visibility (brief function 7) ----

  private setLayerVisible(layerId: Uuid, visible: boolean): void {
    const before = this.isLayerVisible(layerId);
    if (before === visible && this.visibility.has(layerId)) return;
    this.visibility.set(layerId, visible);
    this.pushLayers();
    this.refreshRelations(); // a line to an object of a hidden layer goes
    if (before !== visible) {
      this.visibilityChanges.emit({ layerId, visible });
      this.options.setupChanged?.();
    }
    this.checkSubscription();
  }

  private isLayerVisible(layerId: Uuid): boolean {
    if (this.isForeignLayer(layerId)) return false;
    return this.visibility.get(layerId) ?? this.defaultVisible(layerId);
  }

  /** Whether the engine draws a layer: a visible one, except mid-switch (`switching`), when the eyes stay as they are. */
  private isLayerDrawn(layerId: Uuid): boolean {
    return !this.switching && this.isLayerVisible(layerId);
  }

  /**
   * Whether a layer belongs to a workspace that is neither shown nor View as its reference: the
   * old workspace's, from a switch's moment until the fresh snapshot replaces them. Hidden, so
   * never drawn, picked, selected or highlighted (review F3; brief function 22: only the new
   * workspace's objects).
   */
  private isForeignLayer(layerId: Uuid): boolean {
    const workspace = this.layerWorkspaces.get(layerId);
    return workspace !== undefined && workspace !== this.shown && workspace !== VIEW_WORKSPACE;
  }

  /** A layer's visibility until the user changes it here: off for a reference (brief function 23), else its own `visible` field. */
  private defaultVisible(layerId: Uuid): boolean {
    if (this.isReferenceLayer(layerId)) return false;
    return this.store.layers.get(layerId)?.visible ?? true;
  }

  /**
   * Whether a layer is one of View's, shown as a read-only reference in the declared workspace shown
   * (brief function 23). A layer not seen during the page and named by no object counts as one: the
   * map receives View's layers only while one of them is on, and the workspace's own come with its
   * snapshot, after which the eyes follow (`reportingVisibility`).
   */
  private isReferenceLayer(layerId: Uuid): boolean {
    if (this.shown === VIEW_WORKSPACE) return false;
    const workspace = this.layerWorkspaces.get(layerId);
    if (workspace !== undefined) return workspace === VIEW_WORKSPACE;
    return !this.store.holdsObjectsIn(layerId);
  }

  /** Whether the picture has every layer the workspace shown can show: in View always, elsewhere once the subscription names View too. */
  private pictureHasReferences(): boolean {
    return this.shown === VIEW_WORKSPACE || (this.subscribedTo?.includes(VIEW_WORKSPACE) ?? false);
  }

  /** Runs `update`, then tells the listeners of each layer whose local visibility it changed, so that layer-panel's eyes follow. */
  private reportingVisibility(more: Iterable<Uuid>, update: () => void): void {
    const ids = () => new Set([...this.store.layers.keys(), ...this.store.unknownLayers(), ...this.visibility.keys()]);
    const before = new Map([...ids(), ...more].map((id) => [id, this.isLayerVisible(id)]));
    update();
    for (const id of new Set([...before.keys(), ...ids()])) {
      const visible = this.isLayerVisible(id);
      if (visible !== (before.get(id) ?? visible)) this.visibilityChanges.emit({ layerId: id, visible });
    }
  }

  // ---- Viewport (brief function 8) ----

  /** The symbology service came (brief function 29): the graphics in view are drawn through it. */
  setSymbols(symbols: SymbolService): void {
    this.symbolService = symbols;
    this.graphics.viewChanged();
  }

  /** The view for the graphics: its extent in longitude, latitude, and its resolutions. */
  private graphicView(): GraphicView | null {
    const view = this.engine.view;
    if (view === null || view.width <= 0 || view.height <= 0) return null;
    const viewport = this.viewport();
    if (viewport.visibleArea.length === 0) return null;
    return { extent: extentOfRing(viewport.visibleArea, viewport.center), groundResolution: viewport.resolution, resolution: view.resolution };
  }

  /** Drawn graphics, a slice at a time: they replace the markers, and the highlight follows (brief function 29). */
  private deliverGraphics(layerId: Uuid, items: ReadonlyMap<Uuid, DrawItem>): void {
    if (this.disposed || !this.engineLayers.some((l) => l.id === layerId)) return;
    // The faded state may have changed since the answer was asked for: the item the renderer holds is the newest.
    this.engine.updateItems(layerId, items);
    if (this.selection.value.some((id) => items.has(id))) this.refreshHighlight();
  }

  private viewport(): Viewport {
    if (this.cachedViewport !== null) return this.cachedViewport;
    const projection = this.engine.projection;
    const view = this.engine.view;
    if (view !== null) {
      const center = projection.inverse(view.center);
      if (center !== null) this.lastCenter = center;
      this.lastResolution = groundResolution(projection, view.center, view.resolution);
    }
    this.cachedViewport = Object.freeze({
      center: this.lastCenter,
      resolution: this.lastResolution,
      projection: projection.def.code,
      visibleArea: view === null ? [] : visibleArea(view, projection),
    });
    return this.cachedViewport;
  }

  /** Moves the view; returns the projected view it asked the engine for (null without a centre and zoom). */
  private goTo(center: Position, resolution?: number): ProjectedView | null {
    if (!isPosition(center)) {
      this.log.warn('goTo ignored: the centre is not a lon/lat position', center);
      return null;
    }
    this.restoredView = null; // a move of its own, also before the map has a size (restoreShare sets it again)
    const usable = resolution !== undefined && Number.isFinite(resolution) && resolution > 0;
    if (resolution !== undefined && !usable) this.log.warn('goTo: the resolution is not a positive number; keeping the zoom', resolution);
    const projection = this.engine.projection;
    const target = viewIn(projection, center, usable ? resolution : 1);
    this.engine.setView(target.center, usable ? target.resolution : undefined);
    // The viewport tells the caller where the map went, at once (the engine reports the move only
    // when it ends): beyond what the projection can show, the nearest point it can (owner, 2026-10-12).
    this.cachedViewport = null;
    const shown = projection.inverse(target.center);
    if (shown !== null) this.lastCenter = shown; // also before the map is shown
    if (shown === null || distance(shown, center) > CLAMP_TOLERANCE_METRES) {
      this.log.info(`goTo: ${formatPosition(center)} is beyond what ${projection.def.code} can show; centred on ${formatPosition(this.viewport().center)}, the nearest point it can`);
    }
    return usable ? target : null;
  }

  /** A position's pixel in the world copy nearest to `near` (a map that repeats sideways shows several). */
  private clusterPixel(position: Position, near: Pixel): Pixel | null {
    const view = this.engine.view;
    const projection = this.engine.projection;
    const xy = projection.forward(position);
    if (view === null || xy === null) return null;
    const [minX, , maxX] = projection.def.extent;
    const worldWidth = projection.wrapsX ? maxX - minX : 0;
    const shift = worldWidth > 0 ? Math.round((pixelToMap(view, near)[0] - xy[0]) / worldWidth) * worldWidth : 0;
    return mapToPixel(view, [xy[0] + shift, xy[1]]);
  }

  /** Lon/lat at a pixel; null outside the projection's valid area or before the map has a size. */
  positionAt(pixel: Pixel): Position | null {
    const view = this.engine.view;
    if (view === null) return null;
    const position = this.engine.projection.inverse(pixelToMap(view, pixel));
    return position !== null && this.engine.projection.isValid(position) ? position : null;
  }

  // ---- Projections (brief function 2) ----

  get projectionCode(): string {
    return this.engine.projection.def.code;
  }

  get projectionCodes(): string[] {
    return this.projections.map((p) => p.def.code);
  }

  // ---- Settings at runtime (design pattern section 7) ----

  get currentSettings(): MapSettings {
    return this.settings;
  }

  /**
   * New settings, already read and checked, with the projections registered from them. Everything
   * applies at once except the initial projection, centre and zoom, which only matter at start.
   * The object budget is the activation's: it subscribes again.
   */
  setSettings(settings: MapSettings, projections: readonly Projection[]): void {
    const before = this.settings;
    this.settings = settings;
    // Unchanged definitions keep their projection, so nothing is projected again for them.
    const changed = (p: Projection) => !this.projections.some((old) => old.def.code === p.def.code && sameDef(old.def, p.def));
    this.projections = projections.map((p) => (changed(p) ? p : this.projections.find((old) => old.def.code === p.def.code) ?? p));
    this.engine.registerProjections(this.projections);
    if (projections.some(changed)) {
      for (const vector of this.vectorBackgrounds.values()) if (vector.state === 'loaded') vector.prepared.clear();
    }
    if (settings.textThreshold !== before.textThreshold) this.engine.setSymbolOptions(this.display.symbolSize, settings.textThreshold);
    if (settings.updateCadenceMs !== before.updateCadenceMs) this.scheduler.setCadence(settings.updateCadenceMs);
    if (this.dim > settings.highestDim) this.setDim(this.dim);
    const current = this.projections.find((p) => p.def.code === this.engine.projection.def.code);
    const next = current ?? this.projections[0];
    if (next !== undefined && next !== this.engine.projection) this.switchTo(next);
    this.updateBackground();
  }

  private pushDisplay(): void {
    this.engine.setSymbolOptions(this.display.symbolSize, this.settings.textThreshold);
    this.engine.setDisplayOptions({ ...placedLabelsOf(this.display), speedVectorSeconds: speedVectorSecondsOf(this.display) });
  }

  /**
   * The user's display settings changed (`ctx.display.onChange`, brief function 35): the symbols in view are
   * drawn again with the new size and labels, names and speed vectors come and go, and relation lines follow
   * the switches (function 34), at once and without a new subscription.
   */
  setDisplay(display: DisplaySettings): void {
    const before = this.display;
    this.display = display;
    this.pushDisplay();
    this.applyClasses(DISPLAY_CLASSES.map((c) => c.id).filter((c) => classShown(before, c) !== classShown(display, c)));
    this.refreshRelations();
  }

  /** Whether the user's switch for the object's display class is off: it is then neither drawn, picked nor selected (brief function 40). */
  private classHidden(object: MapObject): boolean {
    return object.displayClass !== undefined && !classShown(this.display, object.displayClass);
  }

  /**
   * A display class's switch changed (brief function 40): its objects and its overlay items are drawn again or taken off
   * the map, at once and with no new subscription. Nothing is deleted; a selected object keeps its place in the selection.
   */
  private applyClasses(flipped: readonly string[]): void {
    if (flipped.length === 0) return;
    const changes = new Map<Uuid, Map<Uuid, DrawItem | null>>();
    for (const object of this.store.objects.values()) {
      if (object.displayClass === undefined || !flipped.includes(object.displayClass)) continue;
      let layer = changes.get(object.layerId);
      if (layer === undefined) changes.set(object.layerId, (layer = new Map<Uuid, DrawItem | null>()));
      layer.set(object.id, this.drawItem(object));
    }
    this.applyFading(changes);
    for (const [overlayId, items] of this.overlaySources) {
      if (items.some((item) => item.displayClass !== undefined && flipped.includes(item.displayClass))) this.engine.setOverlay(overlayId, this.overlayItems(overlayId, items, false));
    }
    this.watchExpiry();
  }

  /** The kinds' lines changed, e.g. an admin chose another colour (`ctx.relationLines`, brief function 43): they are drawn again at once. */
  setRelationLines(lines: Readonly<Record<string, RelationLine>>): void {
    this.relationStyles = lines;
    this.refreshRelations();
  }

  /**
   * Draws the relation lines that should show now (brief function 34), and draws again, adds or removes only
   * those that differ from what is drawn: a line follows both of its objects, and goes with either.
   */
  private refreshRelations(): void {
    if (this.relationKinds.length === 0 && this.relationLinesDrawn.size === 0) return;
    const switches = this.display.relations;
    const input: RelationInput = {
      objects: this.store.objects,
      kinds: this.relationKinds,
      ...(this.relationStyles === undefined ? {} : { lines: this.relationStyles }),
      on: (kind) => switches[kind] ?? this.relationKinds.find((k) => k.id === kind)?.defaultOn ?? false,
      shown: (object) => this.isLayerDrawn(object.layerId) && !this.hidden(object),
      faded: (id) => this.expiry.isFaded(id) || this.faded.has(id),
      opacity: (id) => this.fadeStep(id),
    };
    const ends = relationEnds(input);
    this.farEnds.want(ends.far, ends.near); // the objects a line runs to that the map does not hold (brief function 41)
    const lines = relationLines({ ...input, farEnds: this.farEnds.objects });
    const changes = new Map<Uuid, Map<string, DrawItem | null>>();
    const layerChanges = (layerId: Uuid) => {
      let layer = changes.get(layerId);
      if (layer === undefined) changes.set(layerId, (layer = new Map<string, DrawItem | null>()));
      return layer;
    };
    for (const [id, item] of lines) {
      if (!this.engineLayers.some((l) => l.id === item.layerId)) continue; // the layer is not on the map yet: drawn when it is
      const ends = item.kind === 'line' ? `${(item.positions[0] ?? []).join(',')}|${(item.positions[item.positions.length - 1] ?? []).join(',')}` : '';
      const style = item.kind === 'line' ? JSON.stringify(item.style ?? {}) : '';
      const key = `${ends}|${String(item.faded === true)}|${String(item.opacity ?? '')}|${style}`;
      const drawn = this.relationLinesDrawn.get(id);
      if (drawn?.key === key && drawn.layerId === item.layerId) continue;
      layerChanges(item.layerId).set(id, item);
      this.relationLinesDrawn.set(id, { layerId: item.layerId, key });
    }
    for (const [id, drawn] of [...this.relationLinesDrawn]) {
      if (lines.has(id) && this.engineLayers.some((l) => l.id === drawn.layerId)) continue;
      layerChanges(drawn.layerId).set(id, null);
      this.relationLinesDrawn.delete(id);
    }
    for (const [layerId, items] of changes) this.engine.updateItems(layerId, items);
  }

  /** Switches the projection, keeping the centre where possible and the metres per pixel. */
  setProjection(code: string): void {
    const projection = this.projections.find((p) => p.def.code === code);
    if (projection === undefined || projection === this.engine.projection) return;
    this.endBackgroundWait(); // the user's own choice: a restored background is no longer waited for
    this.switchTo(projection);
  }

  private switchTo(projection: Projection): void {
    this.restoredView = null; // the view in the new projection is worked out, not the stored one
    const { center, resolution } = this.viewport();
    const target = viewIn(projection, center, resolution);
    this.endInteraction(null);
    this.engine.setProjection(projection, target.center, target.resolution);
    this.cachedViewport = null;
    this.pushClusters(); // the clusters this projection can show
    this.refreshHighlight();
    this.updateBackground();
    this.stateChanges.emit(undefined);
  }

  // ---- Background maps (brief function 3) ----

  /** The registered providers changed. Unusable ones are reported once each. */
  setProviders(providers: readonly BackgroundMapProvider[]): void {
    const gone = this.shownBackground !== null && !providers.some((p) => p.id === this.shownBackground?.id) ? this.shownBackground : null;
    this.providers = providers;
    for (const provider of providers) {
      const problem = providerProblem(provider, this.options.origin);
      if (problem !== null && !this.reportedProviders.has(provider.id)) {
        this.reportedProviders.add(provider.id);
        this.log.warn(`background map ${provider.id} is not used: ${problem}`);
      }
    }
    this.updateBackground();
    // The shown background's plugin removed it: the map falls back as after a switch, and says so (brief function 3).
    if (gone !== null) this.backgroundMissing(gone.name);
  }

  /**
   * The background maps for the current projection. A WMS one needs an extent it can be cut into
   * tiles inside of (`wmsGrid`), also in `'image'` mode, which is cut at the extent only.
   */
  get backgrounds(): BackgroundMapProvider[] {
    const extent = this.engine.projection.def.extent;
    return compatibleProviders(this.providers, this.projectionCode, this.options.origin)
      .filter((p) => p.source.type !== 'wms' || p.source.mode === 'image' || wmsGrid(extent) !== null);
  }

  get background(): BackgroundMapProvider | null {
    return this.shownBackground;
  }

  /** The user's choice in the current projection: a provider id, or null for none. Kept per browser. */
  chooseBackground(id: string | null): void {
    this.endBackgroundWait(); // the user's own choice: a restored background is no longer waited for
    this.backgroundChoice = id;
    this.choices = { ...this.choices, [this.projectionCode]: id };
    this.options.choices?.save(this.choices);
    this.updateBackground();
  }

  /** Why the chosen background is not shown, for the Map Pane controls; null when nothing is wrong. */
  get backgroundProblem(): string | null {
    const chosen = this.shownBackground;
    return chosen !== null && this.vectorBackgrounds.get(chosen.id)?.state === 'failed' ? `Background unavailable: ${chosen.name}` : null;
  }

  private updateBackground(): void {
    const choice = { current: this.backgroundChoice, inProjection: this.choices[this.projectionCode] };
    const chosen = chooseBackground(choice, this.settings.preferredBackgrounds, this.backgrounds);
    this.shownBackground = chosen;
    const wanted = this.engineBackgroundFor(chosen);
    if (!sameBackground(wanted, this.engineBackground)) {
      this.engineBackground = wanted;
      this.engine.setBackground(wanted);
    }
    if (this.pendingBackground !== null && chosen?.id === this.pendingBackground.id) this.endBackgroundWait();
    this.stateChanges.emit(undefined);
    this.reportMapType();
  }

  // ---- Map type (SDK 1.1.0, brief function 20: for setups and bookmarks) ----

  /** The projection and the background shown now. */
  get mapType(): MapType {
    return { projection: this.projectionCode, background: this.shownBackground?.id ?? null };
  }

  /** Tells `onMapTypeChange` listeners and the setup when the projection or the background shown changed. */
  private reportMapType(): void {
    if (this.mapTypeHeld) return; // reported once when setMapType or a restore is done
    const mapType = this.mapType;
    const key = `${mapType.projection}|${mapType.background ?? ''}`;
    if (key === this.reportedMapType) return;
    this.reportedMapType = key;
    this.mapTypeChanges.emit(mapType);
    this.options.setupChanged?.();
  }

  /**
   * Switches projection and background (SDK 1.1.0, for bookmarks): one that is not available falls
   * back as the map view's own choice does (brief function 3), with a notice. The background is
   * kept as the choice in that projection, so it is shown once its provider comes.
   */
  setMapType(mapType: MapType): MapType {
    this.applyMapType(mapType, false);
    return this.mapType;
  }

  private applyMapType(mapType: MapType, waitForBackground: boolean): void {
    this.mapTypeHeld = true;
    try {
      this.switchMapType(mapType, waitForBackground);
    } finally {
      this.mapTypeHeld = false;
    }
    this.reportMapType();
  }

  private switchMapType(mapType: MapType, waitForBackground: boolean): void {
    const code: unknown = (mapType as { projection?: unknown } | null)?.projection;
    const background: unknown = (mapType as { background?: unknown } | null)?.background;
    if (typeof code !== 'string' || (background !== null && typeof background !== 'string')) {
      this.log.warn('setMapType ignored: not a map type', mapType);
      return;
    }
    const projection = this.projections.find((p) => p.def.code === code);
    if (projection === undefined) {
      this.options.notify?.({ severity: 'warning', message: `The map projection ${code} is not available; the map stays in ${this.projectionCode}.` });
    } else if (projection !== this.engine.projection) {
      this.switchTo(projection);
    }
    this.endBackgroundWait();
    this.chooseBackground(background);
    if (background === null || this.shownBackground?.id === background) return;
    if (!waitForBackground) {
      this.backgroundMissing(background);
      return;
    }
    // At start its plugin may not have started yet: wait for it (owner, 2026-10-17).
    const timer = this.options.clock.setTimeout(() => {
      if (this.pendingBackground?.id !== background) return;
      this.pendingBackground = null;
      this.backgroundMissing(background);
    }, BACKGROUND_WAIT_MS);
    this.pendingBackground = { id: background, timer };
  }

  private endBackgroundWait(): void {
    if (this.pendingBackground === null) return;
    this.options.clock.clearTimeout(this.pendingBackground.timer);
    this.pendingBackground = null;
  }

  private backgroundMissing(id: string): void {
    const shown = this.shownBackground;
    this.options.notify?.({ severity: 'warning', message: `The background map ${id} is not available; showing ${shown === null ? 'the grid' : shown.name}.` });
  }

  // ---- Dim (brief function 19) ----

  /** The dim level in percent, in steps of 10, from 0 to the highest level the settings allow. */
  get dimLevel(): number {
    return this.dim;
  }

  setDim(percent: number): void {
    const level = dimLevel(percent, this.settings.highestDim);
    if (level === this.dim) return;
    this.dim = level;
    this.engine.setDim(level / 100);
    this.stateChanges.emit(undefined);
    this.options.setupChanged?.();
  }

  // ---- The setup share (brief function 20, ADR-0031 point 5) ----

  /** The share to save: map type, centre, zoom, dim level and the layers' local visibility. */
  saveShare(): JsonValue {
    const { center, resolution } = this.unmovedSinceRestore() ?? this.viewport();
    const layers: Record<Uuid, boolean> = {};
    let count = 0;
    for (const [id, visible] of this.visibility) {
      // A layer the map does not know yet (before the first snapshot, or one only objects name) is
      // kept as it is: its own field cannot be checked, and the next save must not lose it.
      const layer = this.store.layers.get(id);
      if ((layer !== undefined && this.defaultVisible(id) === visible) || count >= MAX_SHARED_LAYERS) continue;
      layers[id] = visible;
      count++;
    }
    return shareToJson({
      projection: this.projectionCode,
      // A background still waited for is the one the user had, not the fallback shown meanwhile.
      background: this.pendingBackground?.id ?? this.shownBackground?.id ?? null,
      center,
      metresPerPixel: resolution,
      dim: this.dim,
      layers,
    });
  }

  /**
   * Applies a saved share: at start and when the user picks a named setup. A layer that no longer
   * exists is ignored and a new one keeps its own `visible` field. False for a share it cannot
   * read, which changes nothing.
   */
  restoreShare(json: JsonValue): boolean {
    const share = readShare(json);
    if (share === null) {
      this.log.warn('the saved setup could not be read; the map keeps its current state');
      return false;
    }
    this.applyMapType({ projection: share.projection, background: share.background }, true);
    const view = this.goTo(share.center, share.metresPerPixel);
    this.restoredView = view === null ? null : { view, center: share.center, metresPerPixel: share.metresPerPixel };
    this.setDim(share.dim);
    const before = new Map([...this.allLayerIds(), ...Object.keys(share.layers)].map((id) => [id, this.isLayerVisible(id)]));
    this.visibility.clear();
    for (const [id, visible] of Object.entries(share.layers)) {
      // Before the first snapshot every layer is kept: the snapshot forgets those that are gone. So
      // is a layer the picture cannot check: a View layer while it has no references (brief function 23).
      const unchecked = !this.snapshotSeen || this.pictureDropped || !this.pictureHasReferences();
      if (unchecked || this.store.layers.has(id) || this.store.unknownLayers().includes(id)) this.visibility.set(id, visible);
    }
    this.pushLayers();
    this.checkSubscription();
    for (const [layerId, was] of before) {
      const visible = this.isLayerVisible(layerId);
      if (visible !== was && (this.store.layers.has(layerId) || this.visibility.has(layerId))) this.visibilityChanges.emit({ layerId, visible });
    }
    return true;
  }

  /** The restored centre and zoom while the map still shows the view they gave; null once it moved. */
  private unmovedSinceRestore(): { readonly center: Position; readonly resolution: number } | null {
    const restored = this.restoredView;
    if (restored === null) return null;
    // Without a size the map has not moved: OpenLayers keeps the view it was given until it has one.
    const view = this.engine.view;
    if (view !== null && !sameView(view, restored.view)) {
      this.restoredView = null;
      return null;
    }
    return { center: restored.center, resolution: restored.metresPerPixel };
  }

  private allLayerIds(): Uuid[] {
    return [...this.store.layers.keys(), ...this.store.unknownLayers(), ...this.visibility.keys()];
  }

  /**
   * What the engine should draw for a provider. A vector source is loaded the first time it is
   * chosen (never at page load, brief function 11) and drawn once it has arrived; until then, and
   * if loading fails, the graticule shows.
   */
  private engineBackgroundFor(provider: BackgroundMapProvider | null): EngineBackground | null {
    if (provider === null) return null;
    const { source } = provider;
    if (source.type === 'xyz' || source.type === 'wms') return { kind: 'tiles', provider };
    const vector = this.vectorBackgrounds.get(provider.id);
    if (vector === undefined) {
      this.loadVector(provider, source.load.bind(source));
      return null;
    }
    if (vector.state !== 'loaded') return null;
    const code = this.projectionCode;
    let data = vector.prepared.get(code);
    if (data === undefined) {
      try {
        data = prepareVector(source, vector.features, this.engine.projection);
      } catch (error: unknown) {
        // The features are another plugin's data: a malformed one fails the background, not the map.
        this.log.warn(`background map ${provider.id} could not be drawn`, error);
        this.vectorBackgrounds.set(provider.id, { state: 'failed' });
        return null;
      }
      vector.prepared.set(code, data);
    }
    return { kind: 'vector', provider, data };
  }

  private loadVector(provider: BackgroundMapProvider, load: () => Promise<{ readonly features: readonly VectorFeature[] }>): void {
    this.vectorBackgrounds.set(provider.id, { state: 'loading' });
    const failed = (error: unknown) => {
      this.log.warn(`background map ${provider.id} could not be loaded`, error);
      this.vectorBackgrounds.set(provider.id, { state: 'failed' });
      if (!this.disposed) this.updateBackground();
    };
    let loading: Promise<{ readonly features: readonly VectorFeature[] }>;
    try {
      loading = load();
    } catch (error: unknown) {
      // A load() that throws instead of rejecting is still a failed load; this is called inside updateBackground.
      queueMicrotask(() => {
        failed(error);
      });
      return;
    }
    loading.then(
      (result: unknown) => {
        const features = (result as { readonly features?: unknown } | null)?.features;
        if (!Array.isArray(features)) {
          failed(new Error('load() did not resolve to { features }'));
          return;
        }
        this.vectorBackgrounds.set(provider.id, { state: 'loaded', features: features as VectorFeature[], prepared: new Map() });
        if (!this.disposed) this.updateBackground();
      },
      failed,
    );
  }

  /** Projection or background changed (for the Map Pane controls). */
  onStateChange(listener: () => void): () => void {
    return this.stateChanges.on(listener);
  }

  // ---- Pointer, pick and interactions (brief function 8) ----

  /**
   * A drawing (and so an append, SDK 1.6.0 part B) or an edit that the user finished is over, and a click that follows
   * at once is not a click on the map: OpenLayers ends a drawing on the second click of a double-click, on its
   * release, and then sends that click, which on empty map would clear the selection (owner, SF A, 2026-11-12).
   * Enter and Escape send no click. The window is far shorter than a click of the user's own.
   */
  private justFinished(): boolean {
    return this.options.clock.now() - this.lastFinished < FINISH_CLICK_GRACE_MS;
  }

  private onEnginePointer(event: EnginePointerEvent): void {
    const interaction = this.interaction;
    // Clicks select (brief function 14), also while dragObject waits; they belong to pickPoint and
    // to a drawing or an edit while those run (criterion 41).
    if ((interaction === null || interaction.kind === 'drag-object') && event.type === 'click' && !this.justFinished()) {
      // A click on a cluster zooms in on it (brief function 12), also with the add key (owner,
      // 2026-10-16); clusters are never picked or selected. A double-click on one zooms in once:
      // its second click and OpenLayers' double-click zoom do not add to it (owner, 2026-10-13,
      // review R2).
      const cluster = clusterAt(this.drawnClusters, event.pixel, (position) => this.clusterPixel(position, event.pixel));
      const now = this.options.clock.now();
      if (cluster === null) {
        if (event.keys !== 'other') this.applySelection(clickSelection(this.selection.value, this.pick(event.pixel)[0] ?? null, event.keys === 'add'));
      } else if (interaction === null && now - this.lastClusterZoom >= CLUSTER_CLICK_GRACE_MS) {
        this.lastClusterZoom = now;
        this.engine.pauseDoubleClickZoom();
        this.goTo(cluster.position, this.viewport().resolution / CLUSTER_ZOOM_FACTOR);
      }
    }
    if (interaction?.kind === 'pick-point' && event.type === 'click') {
      const position = this.positionAt(event.pixel);
      if (position !== null) this.endInteraction(position);
    } else if (interaction?.kind === 'drag-object') {
      this.onDragPointer(interaction, event);
    }
    if (event.type === 'menu') this.onMenu(event);
    if ((event.type === 'click' || event.type === 'move') && this.pointer.size > 0) {
      this.pointer.emit({ type: event.type, position: this.positionAt(event.pixel), pixel: event.pixel });
    }
  }

  /**
   * A right click (brief function 15, ADR-0032 points 3 and 5): on a cluster or empty map the map
   * actions at its position; on a selected object the object actions for the whole selection; on
   * one object that is not selected, that object becomes the selection first; on several that
   * overlap, the shell lets the user choose one (and selects it). No menu while pickPoint, a drawing
   * or an edit runs (owner, 2026-10-17); instead the right click ends pickPoint, takes back the
   * last point of a drawing or ends it (brief function 27), and does nothing in an edit and in a
   * grabbed drag.
   */
  private onMenu(event: EnginePointerEvent): void {
    const interaction = this.interaction;
    // Right-click while placing and drawing (brief function 27, owner 2026-10-30): no menu then.
    if (interaction?.kind === 'pick-point') {
      this.endInteraction(null); // as Escape: back to selection
      return;
    }
    if (interaction?.kind === 'draw') {
      if (!this.engine.rightClickDrawing()) this.endInteraction(null); // no point left, or no press yet: as Escape
      return;
    }
    if (interaction?.kind === 'edit' || (interaction?.kind === 'drag-object' && interaction.grab !== null)) return; // nothing, as before
    const open = this.options.openMenu;
    if (open === undefined || event.page === undefined) return;
    const cluster = clusterAt(this.drawnClusters, event.pixel, (position) => this.clusterPixel(position, event.pixel));
    const hits = cluster === null ? this.pick(event.pixel) : [];
    if (hits.length === 0) {
      const position = this.positionAt(event.pixel);
      if (position !== null) open(event.page, { position });
      return;
    }
    const selected = this.selection.value;
    if (hits.some((id) => selected.includes(id))) {
      open(event.page, { objects: selected });
    } else if (hits.length === 1) {
      this.selection.set(hits);
      open(event.page, { objects: hits });
    } else {
      open(event.page, { choose: hits });
    }
  }

  /**
   * Centre on and Zoom to (brief function 16): the objects' extent in map coordinates, from the
   * live picture and, for the ids the map does not hold, from the server. Objects with no position
   * inside the projection's world extent are left out; with none left the map stays and a notice
   * says so (criterion 42). Zoom to fits the extent with a margin, never closer than a view
   * `zoomToWidthMetres` wide (10 km; owner, 2026-10-17).
   */
  private async showObjects(ids: readonly Uuid[], zoom: boolean): Promise<{ readonly missing: readonly Uuid[] }> {
    const wanted = [...new Set(ids)];
    if (wanted.length === 0) return { missing: [] };
    const held: MapObject[] = [];
    const notHeld: Uuid[] = [];
    for (const id of wanted) {
      const object = this.store.objects.get(id);
      if (object === undefined) notHeld.push(id);
      else held.push(object);
    }
    const fetched = await this.fetchObjects(notHeld);
    const projection = this.engine.projection;
    const found = mapExtent([...held, ...fetched], projection);
    const middle = found === null ? null : middleOf(found);
    const center = middle === null ? null : projection.inverse(middle);
    if (found === null || middle === null || center === null) {
      this.options.notify?.({ severity: 'warning', message: `Nothing to show: ${wanted.length === 1 ? 'the object is' : 'the objects are'} gone or ${wanted.length === 1 ? 'has' : 'have'} no position this map projection can show.` });
      return { missing: wanted };
    }
    const shown = new Set(found.shown);
    const missing = wanted.filter((id) => !shown.has(id));
    if (!zoom) {
      this.goTo(center);
      return { missing };
    }
    const view = this.engine.view;
    const width = view?.width ?? 800;
    const fit = groundResolution(projection, middle, fitResolution(found, width, view?.height ?? 600));
    this.goTo(center, Math.max(fit, this.settings.zoomToWidthMetres / width));
    return { missing };
  }

  /** Objects the map does not hold, from the server; on a failed query none (logged), so they count as missing. */
  private async fetchObjects(ids: readonly Uuid[]): Promise<readonly MapObject[]> {
    const objects = this.options.objects;
    if (ids.length === 0 || objects === undefined) return [];
    const found: MapObject[] = [];
    for (let i = 0; i < ids.length; i += MAX_FETCH_IDS) {
      try {
        found.push(...(await objects.get(ids.slice(i, i + MAX_FETCH_IDS))).found);
      } catch (error) {
        this.log.warn('the objects to show could not be read from the server', error);
      }
    }
    return found;
  }

  /**
   * A selection box (brief function 14): the drawn objects whose position or outline reaches into
   * it replace the selection; objects in clusters inside it cannot be selected and are counted for
   * the notice. Not while pickPoint, a drawing or an edit runs (owner, 2026-10-16).
   */
  private selectBox(box: PixelBox): void {
    if (this.interaction !== null && this.interaction.kind !== 'drag-object') return;
    const left = Math.min(box.from[0], box.to[0]);
    const right = Math.max(box.from[0], box.to[0]);
    const top = Math.min(box.from[1], box.to[1]);
    const bottom = Math.max(box.from[1], box.to[1]);
    const middle: Pixel = [(left + right) / 2, (top + bottom) / 2];
    let clustered = 0;
    for (const cluster of this.drawnClusters) {
      const pixel = this.clusterPixel(cluster.position, middle);
      if (pixel !== null && pixel[0] >= left && pixel[0] <= right && pixel[1] >= top && pixel[1] <= bottom) clustered += cluster.count;
    }
    this.applySelection(boxSelection(this.withoutReferences(boxAt(this.engine.boxCandidates(box), box)), clustered));
  }

  private applySelection({ ids, notice }: SelectionResult): void {
    this.selection.set(ids);
    if (notice !== null) this.options.notify?.(notice);
  }

  private pick(pixel: Pixel, tolerance = DEFAULT_TOLERANCE): readonly Uuid[] {
    if (!Number.isFinite(pixel[0]) || !Number.isFinite(pixel[1])) return [];
    const t = Number.isFinite(tolerance) ? Math.min(Math.max(tolerance, 0), MAX_TOLERANCE) : DEFAULT_TOLERANCE;
    return this.withoutReferences(pickAt(this.engine.pickCandidates(pixel, t), pixel, t));
  }

  /** The ids without objects of reference layers, which are never picked or selected (brief function 23, open question 6). */
  private withoutReferences(ids: readonly Uuid[]): Uuid[] {
    return ids.filter((id) => {
      const object = this.store.objects.get(id);
      return object === undefined || !this.isReferenceLayer(object.layerId);
    });
  }

  private pickPoint(signal: AbortSignal | undefined): Promise<Position | null> {
    return this.cancellable(signal, (resolve) => {
      const interaction: Interaction = { kind: 'pick-point', resolve };
      this.startInteraction(interaction, 'pick-point');
      return interaction;
    });
  }

  private dragObject(id: Uuid, signal: AbortSignal | undefined): Promise<Position | null> {
    if (signal?.aborted === true) return Promise.resolve(null);
    // Only checks that the object can be grabbed now; the real grab (and start point) comes at the press.
    if (this.grabOf(id, [0, 0]) === null) {
      this.log.warn('dragObject: the object is not on the map', id);
      return Promise.resolve(null);
    }
    return this.cancellable(signal, (resolve) => {
      const interaction: Interaction = { kind: 'drag-object', id, grab: null, current: null, resolve };
      this.startInteraction(interaction, 'drag-object');
      // Only a press on this object grabs it; any other press pans the map as usual.
      this.engine.setGrabTest((pixel) => this.pick(pixel).includes(id));
      return interaction;
    });
  }

  /**
   * SDK 1.2.0 (CR-0020): the caller's `signal` ends the interaction `begin` starts as Escape ends it
   * (with null; the drawing, editing or drag preview stopped), and does nothing else: an abort never
   * clears the selection, not even while a drag only waits. A signal already aborted starts nothing
   * and resolves with null; an abort after the interaction ended, or after another replaced it,
   * changes nothing. The abort listener goes when the interaction ends.
   */
  private cancellable<T>(signal: AbortSignal | undefined, begin: (resolve: (value: T | null) => void) => Interaction): Promise<T | null> {
    if (signal?.aborted === true) return Promise.resolve(null);
    return new Promise((resolve) => {
      let own: Interaction | null = null;
      const onAbort = () => {
        if (own !== null && this.interaction === own) this.endInteraction(null);
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      own = begin((value) => {
        signal?.removeEventListener('abort', onAbort);
        resolve(value);
      });
    });
  }

  /** A new interaction ends the one before (it resolves with null). */
  private startInteraction(interaction: Interaction, mode: InteractionMode): void {
    this.endInteraction(null);
    this.interaction = interaction;
    this.engine.setInteraction(mode);
  }

  private endInteraction(result: Position | null): void {
    const interaction = this.interaction;
    if (interaction === null) return;
    this.interaction = null;
    this.engine.setInteraction('none');
    if (interaction.kind === 'draw') {
      this.stopGraphicPreview();
      this.engine.stopDrawing();
      interaction.resolve(null);
      if (interaction.appendTo !== undefined) this.refreshHighlight();
      return;
    }
    if (interaction.kind === 'edit') {
      this.stopGraphicPreview();
      this.engine.stopEditing();
      interaction.resolve(null);
      return;
    }
    if (interaction.kind === 'drag-object') {
      this.engine.setGrabTest(null);
      this.setDragHover(false);
      this.showPreview(null);
    }
    interaction.resolve(result);
  }

  /**
   * Lets the user draw a shape (brief function 17, ADR-0033 point 3), with a preview in `style`.
   * It changes nothing: the caller sends the change request.
   */
  private draw(kind: DrawKind, style: Style | undefined, signal: AbortSignal | undefined, graphic?: MilSymbol): Promise<DrawnGeometry | null> {
    return this.cancellable(signal, (resolve) => {
      const interaction: Interaction = { kind: 'draw', resolve };
      this.startInteraction(interaction, 'draw');
      const options = graphic !== undefined && (kind === 'polygon' || kind === 'line') ? this.graphicDrawing(graphic) : undefined;
      this.engine.startDrawing(kind, style, (shape) => {
        this.finishDrawing(shape);
      }, options);
      return interaction;
    });
  }

  /**
   * What a tactical graphic adds to drawing (brief function 32): its points' limits from the
   * symbology service's catalogue (they may come after the drawing has started), and the preview, the
   * graphic itself, once the points set and the pointer make up the graphic's minimum.
   */
  private graphicDrawing(graphic: MilSymbol): DrawingOptions {
    this.stopGraphicPreview();
    const limits: { minPoints: number; maxPoints: number | null } = { minPoints: 2, maxPoints: null };
    const { standard } = graphic;
    if (drawsGraphics(standard)) {
      const catalogue = this.symbolService?.graphicCatalog(standard);
      void catalogue?.then((entries) => {
        const entry = entries.find((e) => e.symbolSet === graphic.sidc.slice(4, 6) && e.entity === graphic.sidc.slice(10, 16));
        if (entry !== undefined) {
          limits.minPoints = entry.minPoints;
          limits.maxPoints = entry.maxPoints;
        }
      }, () => undefined);
    }
    const preview = new GraphicPreview({
      symbols: () => this.symbolService,
      view: () => this.graphicView(),
      show: (parts, points) => {
        // The graphic itself, and the plain line hidden; a refusal (or too few points) leaves the plain line.
        this.engine.setDragPreview(parts === null ? null : { id: GRAPHIC_PREVIEW_ID, layerId: GRAPHIC_PREVIEW_ID, kind: 'graphic', symbol: graphic, points, parts });
        this.engine.setDrawingPlain(parts === null);
      },
    }, graphic);
    this.graphicPreview = preview;
    return {
      get minPoints() {
        return limits.minPoints;
      },
      get maxPoints() {
        return limits.maxPoints;
      },
      onSketch: (sketch) => {
        const positions = sketch.map((xy) => this.engine.projection.inverse(xy));
        if (sketch.length < limits.minPoints || positions.some((p) => p === null)) preview.clear();
        else preview.update(positions as Position[]);
      },
    };
  }

  private stopGraphicPreview(): void {
    if (this.graphicPreview === null) return;
    this.graphicPreview.stop();
    this.graphicPreview = null;
    this.engine.setDragPreview(null);
  }

  /** The user finished drawing: the geometry in lon/lat (`drawing.ts`); null when the engine ended it or nothing could be drawn. */
  private finishDrawing(shape: DrawnShape | null): void {
    const interaction = this.interaction;
    if (interaction?.kind !== 'draw') return;
    this.interaction = null;
    this.lastFinished = this.options.clock.now();
    this.stopGraphicPreview();
    this.engine.setInteraction('none');
    if (shape === null) {
      interaction.resolve(null);
      return;
    }
    if (interaction.appendTo !== undefined) {
      this.refreshHighlight();
      // The line's own points as they were, and the points added to it (brief function 44).
      const { own, ownXY } = interaction.appendTo;
      const result = shape.kind === 'line' ? appendedLine(own, shape.points.slice(ownXY), this.engine.projection) : { problem: 'not a line' };
      if ('problem' in result) {
        if (result.problem !== 'no point was added') this.log.info(`append: nothing added: ${result.problem}`);
        interaction.resolve(null);
        return;
      }
      interaction.resolve({ type: 'LineString', coordinates: result.line });
      return;
    }
    const result = drawnGeometry(shape, this.engine.projection);
    if ('problem' in result) {
      this.log.info(`draw: nothing drawn: ${result.problem}`);
      interaction.resolve(null);
      return;
    }
    interaction.resolve(result.geometry);
  }

  /**
   * Lets the user continue a held line from its last point (brief function 44, SDK 1.6.0 part B; owner, QG A and QH A):
   * clicks add points, with a preview from the last point to the pointer in `style`. A double-click or Enter finishes with
   * the line's points followed by the added ones, or with null when none was added; Backspace and a right click take back an
   * added point (a right click with none left is Escape); Escape, an abort and another interaction give null. It changes
   * nothing: the caller sends the update. Rejects at once with NotOnMapError for an object the map does not draw, and with
   * NotALineError for any other geometry, unless `signal` is already aborted: that resolves with null first.
   */
  private append(id: Uuid, style: Style | undefined, signal: AbortSignal | undefined): Promise<LineString | null> {
    if (signal?.aborted === true) return Promise.resolve(null);
    const object = this.store.objects.get(id);
    const item = object === undefined ? null : this.shownItem(object);
    if (object === undefined || item === null || !inProjection(item, this.engine.projection) || !this.isLayerDrawn(object.layerId)) {
      return Promise.reject(new NotOnMapError(`object ${id} is not drawn on the map: centre on it first`));
    }
    if (object.geometry.type !== 'LineString') return Promise.reject(new NotALineError(`MapView.append: a ${object.geometry.type} is not a line`));
    const shape = editShapeOf(object.geometry, this.engine.projection);
    if (shape === null || shape.kind !== 'line') return Promise.reject(new NotOnMapError(`object ${id} has a point this projection cannot show: centre on it in another projection`));
    const own = object.geometry.coordinates;
    return this.cancellable(signal, (resolve) => {
      const interaction: Interaction = {
        kind: 'draw',
        resolve: (geometry) => { resolve(geometry?.type === 'LineString' ? geometry : null); },
        appendTo: { id, own, ownXY: shape.points.length },
      };
      this.startInteraction(interaction, 'draw');
      this.engine.startDrawing('line', style ?? object.style, (drawn) => {
        this.finishDrawing(drawn);
      }, { extend: shape.points });
      this.refreshHighlight();
      return interaction;
    });
  }

  /**
   * Lets the user edit an object's geometry (brief function 17, ADR-0033 point 3), with the shape
   * drawn in `style`. It changes nothing: the caller sends the change request. Rejects at once
   * with NotOnMapError for an object the map does not draw (not held: outside the area or in a
   * cluster; in a locally hidden layer; mid-switch; outside this projection), unless `signal` is already
   * aborted: that resolves with null before anything else (SDK 1.2.0, CR-0020).
   */
  private edit(id: Uuid, style: Style | undefined, signal: AbortSignal | undefined): Promise<Geometry | null> {
    if (signal?.aborted === true) return Promise.resolve(null);
    const object = this.store.objects.get(id);
    const item = object === undefined ? null : this.shownItem(object);
    if (object === undefined || item === null || !inProjection(item, this.engine.projection) || !this.isLayerDrawn(object.layerId)) {
      return Promise.reject(new NotOnMapError(`object ${id} is not drawn on the map: centre on it first`));
    }
    const projection = this.engine.projection;
    // A tactical graphic is edited by its control points (brief function 32), also when it is stored as a MultiPoint.
    const graphic = item.kind === 'graphic' ? item : null;
    const multi = graphic !== null && object.geometry.type === 'MultiPoint';
    if (!EDITABLE.has(object.geometry.type) && !multi) return Promise.reject(new Error(`MapView.edit: a ${object.geometry.type} cannot be edited`));
    const shape = multi ? multiPointEditShape(object.geometry.coordinates, projection) : editShapeOf(object.geometry, projection);
    // Drawn whole although partly outside the projection, but such a point cannot be dragged here.
    if (shape === null) return Promise.reject(new NotOnMapError(`object ${id} has a point this projection cannot show: centre on it in another projection`));
    return this.cancellable(signal, (resolve) => {
      const interaction: Interaction = { kind: 'edit', id, resolve, ...(multi ? { asMultiPoint: true } : {}) };
      this.startInteraction(interaction, 'edit');
      const tools = { reshape: (changed: EditShape) => reshape(changed, this.engine.projection), move: (before: EditShape, center: XY) => moveRound(before, center, this.engine.projection) };
      this.engine.startEditing(shape, style ?? object.style, tools, (edited) => {
        this.finishEditing(edited);
      }, graphic === null ? undefined : this.graphicEditing(graphic));
      return interaction;
    });
  }

  /**
   * What a tactical graphic adds to editing (brief function 32): a handle on each control point, and the
   * graphic itself as the preview, drawn again as a point (or the whole graphic) moves, one request at a time.
   */
  private graphicEditing(graphic: Extract<DrawItem, { kind: 'graphic' }>): EditingOptions {
    this.stopGraphicPreview();
    const preview = new GraphicPreview({
      symbols: () => this.symbolService,
      view: () => this.graphicView(),
      show: (parts, points) => {
        this.engine.setDragPreview(parts === null ? null : { ...graphic, points, parts });
      },
    }, graphic.symbol);
    this.graphicPreview = preview;
    return {
      vertexHandles: true,
      onChange: (shape) => {
        const xys = shape.kind === 'line' ? shape.points : shape.kind === 'point' ? [shape.at] : shape.kind === 'polygon' ? this.withoutClosing(shape.rings[0] ?? []) : [];
        const positions = xys.map((xy) => this.engine.projection.inverse(xy));
        if (xys.length > 0 && positions.every((p) => p !== null)) preview.update(positions);
      },
    };
  }

  /** A ring without its closing point. */
  private withoutClosing(ring: readonly XY[]): readonly XY[] {
    const first = ring[0];
    const last = ring[ring.length - 1];
    return first !== undefined && last !== undefined && ring.length > 1 && first[0] === last[0] && first[1] === last[1] ? ring.slice(0, -1) : ring;
  }

  /** The user finished editing: the new geometry in lon/lat; null when the engine ended it or the shape cannot be kept. */
  private finishEditing(shape: EditShape | null): void {
    const interaction = this.interaction;
    if (interaction?.kind !== 'edit') return;
    this.interaction = null;
    this.lastFinished = this.options.clock.now();
    this.stopGraphicPreview();
    this.engine.setInteraction('none');
    if (shape === null) {
      interaction.resolve(null);
      return;
    }
    const result = interaction.asMultiPoint === true ? multiPointGeometry(shape, this.engine.projection) : editedGeometry(shape, this.engine.projection);
    if ('problem' in result) {
      this.log.info(`edit: nothing changed: ${result.problem}`);
      interaction.resolve(null);
      return;
    }
    interaction.resolve(result.geometry);
  }

  /**
   * Press on the object, drag, release: the drop position is the anchor moved by the drag. The
   * object itself never changes. A press elsewhere pans the map; a release without a move, or a
   * cancelled pointer, drops nothing and the object can be grabbed again.
   */
  private onDragPointer(drag: Extract<Interaction, { kind: 'drag-object' }>, event: EnginePointerEvent): void {
    const view = this.engine.view;
    if (view === null) return;
    if (event.type === 'move') this.setDragHover(drag.grab !== null || this.pick(event.pixel).includes(drag.id));
    if (event.type === 'down') {
      if (this.pick(event.pixel).includes(drag.id)) drag.grab = this.grabOf(drag.id, pixelToMap(view, event.pixel));
      return;
    }
    if (drag.grab === null) return;
    if (event.type === 'cancel' || (event.type === 'up' && drag.current === null)) {
      drag.grab = null;
      drag.current = null;
      this.showPreview(null);
      return;
    }
    if (event.type === 'move' || event.type === 'up') {
      const xy = pixelToMap(view, event.pixel);
      const { start, item, anchor, anchorXY } = drag.grab;
      const moved = this.engine.projection.inverse([anchorXY[0] + xy[0] - start[0], anchorXY[1] + xy[1] - start[1]]);
      if (moved !== null && this.engine.projection.isValid(moved)) {
        drag.current = moved;
        this.showPreview(translated(item, anchor, moved));
      }
    }
    if (event.type === 'up') this.endInteraction(drag.current);
  }

  /** The object's current state for a grab at `start`; null if it is not on the map. */
  private grabOf(id: Uuid, start: readonly [number, number]): Grab | null {
    const object = this.store.objects.get(id);
    const anchor = object === undefined ? null : firstPosition(object.geometry);
    // An arc band and a corridor are drawn as areas, but a drag previews them as a marker at the pointer (brief function 26).
    const shown = object === undefined ? null : this.shownItem(object);
    const marker = object !== undefined && anchor !== null && (object.geometry.type === 'ArcBand' || object.geometry.type === 'Corridor');
    const item: DrawItem | null = marker && shown !== null ? { id: shown.id, layerId: shown.layerId, kind: 'fallback', position: anchor, ...(shown.faded === true ? { faded: true } : {}), ...(shown.opacity === undefined ? {} : { opacity: shown.opacity }) } : shown;
    const anchorXY = anchor === null ? null : this.engine.projection.forward(anchor);
    return item === null || anchor === null || anchorXY === null ? null : { start, item, anchor, anchorXY };
  }

  private cancelDragOfMissingObject(): void {
    const interaction = this.interaction;
    // A waiting drag or an edit of an object that is gone ends with null.
    if ((interaction?.kind === 'drag-object' || interaction?.kind === 'edit') && !this.store.objects.has(interaction.id)) this.endInteraction(null);
    if (interaction?.kind === 'draw' && interaction.appendTo !== undefined && !this.store.objects.has(interaction.appendTo.id)) this.endInteraction(null); // the line is gone (brief function 44)
  }

  // ---- Workspaces (brief functions 22 and 23, ADR-0039) ----

  /** The workspace shown. */
  get workspace(): string {
    return this.shown;
  }

  /**
   * The switch's moment for the map view (brief function 22, rule 3), which the shell gives with
   * its `emc2:workspace-switch` event, before the fresh snapshots and before any `onChange`
   * listener: running interactions resolve with null, every fade list and the selection are cleared,
   * and the new workspace's local visibility applies. The active layer stays as it is; the old
   * workspace's is remembered, unless a switch is already under way (a layer made active since its
   * moment is not the user's choice). A subscription that names workspaces gets no fresh snapshot:
   * its picture is not drawn until it is renewed (T-085 Q2).
   */
  workspaceMoment(workspace: string): void {
    if (workspace === this.shown || this.disposed) return;
    if (!this.switching) this.rememberActiveLayer();
    this.switching = true;
    this.snapshotSinceMoment = false;
    this.activeToCheck = null;
    this.endInteraction(null);
    this.clearFadeLists();
    this.selection.set([]);
    const known = [...this.layerWorkspaces.keys()];
    this.holdHighlight(() => {
      this.reportingVisibility(known, () => {
        this.visibilityByWorkspace.set(this.shown, this.visibility);
        this.shown = workspace;
        this.visibility = this.visibilityByWorkspace.get(workspace) ?? new Map<Uuid, boolean>();
        if (this.subscribedTo === null) this.pushLayers();
        else this.dropPicture();
      });
    });
  }

  /**
   * The map view's `ctx.workspace.onChange` listener (brief function 22): the workspace's active
   * layer comes back, the one it had when it was last left during the page (none on a first visit,
   * when layer-panel makes its top layer active), and the subscription is renewed if it must change.
   * Without the Map Pane's moment (no Map Pane mounted) the moment's steps come here.
   */
  workspaceShown(workspace: string): void {
    if (this.disposed) return;
    if (workspace !== this.shown) this.workspaceMoment(workspace);
    const remembered = this.activeByWorkspace.get(workspace);
    // With the fresh snapshot in, a remembered layer it lacks was deleted meanwhile; without it
    // (a dropped picture, a late snapshot) the next snapshot checks it (review F2).
    const checked = this.snapshotSinceMoment && !this.pictureDropped;
    if (remembered !== undefined && (!checked || this.store.layers.has(remembered))) {
      this.activeLayer.set(remembered);
      this.activeToCheck = checked ? null : remembered;
    } else {
      // None on a first visit: never another workspace's layer; a layer of this one that
      // layer-panel made active from the fresh snapshot stays (review F1).
      const active = this.activeLayer.value;
      const of = active === null ? undefined : this.layerWorkspaces.get(active);
      if (of !== undefined && of !== workspace) this.activeLayer.set(null);
    }
    this.switching = false;
    this.pushLayers(); // drawn again, now at the centre the workspace's share gave
    this.options.subscriptionChanged?.();
  }

  private rememberActiveLayer(): void {
    const id = this.activeLayer.value;
    // Only a layer of the workspace left (workspaceOf): never another's.
    if (id !== null && this.layerWorkspaces.get(id) === this.shown) this.activeByWorkspace.set(this.shown, id);
    else this.activeByWorkspace.delete(this.shown);
  }

  /**
   * The workspaces the live picture subscription should name (brief function 23): the workspace
   * shown and View while one of View's layers is on as a reference; otherwise null, so that it
   * follows the workspace shown (rule 2).
   */
  get subscriptionWorkspaces(): readonly string[] | null {
    if (this.shown === VIEW_WORKSPACE) return null;
    for (const [id, visible] of this.visibility) if (visible && this.isReferenceLayer(id)) return [this.shown, VIEW_WORKSPACE];
    return null;
  }

  /** Whether the subscription must be made again: it names other workspaces than it should, or its picture was dropped at a moment. */
  get needsSubscription(): boolean {
    return this.pictureDropped || (this.subscribedTo?.join() ?? null) !== (this.subscriptionWorkspaces?.join() ?? null);
  }

  /** The live picture subscription was made with these workspaces (null: it follows the workspace shown). */
  subscribed(workspaces: readonly string[] | null): void {
    this.subscribedTo = workspaces;
    this.pictureDropped = false;
  }

  /** Outside a switch, asks for a new subscription when it must change; a switch renews it from `onChange`. */
  private checkSubscription(): void {
    if (!this.switching && this.needsSubscription) this.options.subscriptionChanged?.();
  }

  /** Draws nothing of the picture until the subscription is renewed (T-085 Q2). */
  private dropPicture(): void {
    this.pictureDropped = true;
    this.showSnapshot({ layers: [], objects: [], sequenceNo: this.store.sequenceNo });
  }

  // ---- Fade lists (brief function 24, ADR-0040) ----

  /**
   * A plugin's list of objects to show faded. It stays until its owner clears it, also when the
   * plugin stops, as an overlay does (brief function 24, amended by the owner, 2026-10-28, T-085 Q3).
   */
  private createFadeList(): FadeList {
    const listId = ++this.fadeListCount;
    return {
      set: (ids) => {
        this.setFadeList(listId, ids);
      },
      clear: () => {
        this.setFadeList(listId, []);
      },
    };
  }

  private setFadeList(listId: number, ids: readonly Uuid[]): void {
    if (this.disposed) return;
    const given = Array.isArray(ids) ? ids.filter((id): id is Uuid => typeof id === 'string') : [];
    if (given.length > MAX_FADE_IDS) this.log.warn(`fade list: only the first ${String(MAX_FADE_IDS)} of ${String(given.length)} ids are faded`);
    const list = new Set(given.slice(0, MAX_FADE_IDS));
    if (list.size === 0) this.fadeLists.delete(listId);
    else this.fadeLists.set(listId, list);
    this.updateFaded();
  }

  private clearFadeLists(): void {
    if (this.fadeLists.size === 0) return;
    this.fadeLists.clear();
    this.updateFaded();
  }

  /** The union of the lists; held objects that come onto it or leave it are drawn again at once. */
  private updateFaded(): void {
    const before = this.faded;
    const after = new Set<Uuid>();
    for (const list of this.fadeLists.values()) for (const id of list) after.add(id);
    this.faded = after;
    const changes = new Map<Uuid, Map<Uuid, DrawItem | null>>();
    for (const id of new Set([...before, ...after])) {
      if (before.has(id) === after.has(id)) continue;
      const object = this.store.objects.get(id);
      const item = object === undefined ? null : this.shownItem(object);
      if (object === undefined || item === null) continue;
      let layer = changes.get(object.layerId);
      if (layer === undefined) changes.set(object.layerId, (layer = new Map<Uuid, DrawItem | null>()));
      layer.set(id, item);
    }
    this.applyFading(changes);
  }

  // ---- Overlays (brief function 8) ----

  private createOverlay(): Overlay {
    const overlayId = `overlay-${String(++this.overlays)}`;
    return {
      set: (items) => {
        this.overlaySources.set(overlayId, items);
        this.engine.setOverlay(overlayId, this.overlayItems(overlayId, items));
      },
      clear: () => {
        this.overlaySources.delete(overlayId);
        this.engine.setOverlay(overlayId, []);
      },
    };
  }

  private overlayItems(overlayId: string, items: readonly OverlayItem[], warn = true): DrawItem[] {
    // SDK 1.4.0 part 6: an overlay the SDK's rules refuse is not drawn at all, and the reason is logged.
    const problem = overlayProblem(items);
    if (problem !== null) {
      if (warn) this.log.warn(`overlay: nothing is drawn: ${problem}`);
      return [];
    }
    const result: DrawItem[] = [];
    let invalid = 0;
    items.forEach((item, index) => {
      // An item of a display class the user has switched off is not drawn (brief function 40); the others keep their ids.
      if (item.displayClass !== undefined && !classShown(this.display, item.displayClass)) return;
      const drawn = overlayItem(`${overlayId}/${String(index)}`, overlayId, item);
      if (drawn === null) invalid++;
      else result.push(drawn);
    });
    if (warn && invalid > 0) this.log.warn(`overlay: ${String(invalid)} items without valid lon/lat positions are not drawn`);
    return result;
  }

  /** Stops listening to the engine and ends what is waiting. */
  dispose(): void {
    this.disposed = true;
    this.endBackgroundWait();
    if (this.expiryTimer !== null) this.options.clock.clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    this.endInteraction(null);
    this.scheduler.dispose();
    this.graphics.dispose();
    this.farEnds.dispose();
    for (const unlisten of this.unlisten.splice(0)) unlisten();
  }
}

type VectorBackgroundState =
  | { readonly state: 'loading' }
  | { readonly state: 'failed' }
  | { readonly state: 'loaded'; readonly features: readonly VectorFeature[]; readonly prepared: Map<string, PreparedVector> };

function sameDef(a: Projection['def'], b: Projection['def']): boolean {
  return a.proj4 === b.proj4 && a.extent.every((v, i) => v === b.extent[i]) && a.worldExtent.every((v, i) => v === b.worldExtent[i]);
}

function sameBackground(a: EngineBackground | null, b: EngineBackground | null): boolean {
  if (a === null || b === null) return a === b;
  return a.kind === b.kind && a.provider === b.provider && (a.kind !== 'vector' || (b.kind === 'vector' && a.data === b.data));
}

function isPosition(value: unknown): value is Position {
  if (!Array.isArray(value) || value.length < 2) return false;
  const [lon, lat] = value as unknown[];
  return typeof lon === 'number' && typeof lat === 'number' && Number.isFinite(lon) && Math.abs(lat) <= 90;
}

function overlayItem(id: string, layerId: string, item: OverlayItem): DrawItem | null {
  switch (item.kind) {
    case 'point':
      return isPosition(item.position) ? { id, layerId, kind: 'point', position: item.position, style: item.style } : null;
    case 'line':
      return Array.isArray(item.positions) && item.positions.length >= 2 && item.positions.every(isPosition)
        ? { id, layerId, kind: 'line', positions: densifyPath(item.positions), style: item.style, vertices: item.positions }
        : null;
    case 'symbol':
      return isPosition(item.position)
        ? { id, layerId, kind: 'symbol', position: item.position, symbol: item.symbol, appearance: appearanceKey(item.symbol), direction: directionOf(item.symbol) }
        : null;
    case 'area': {
      // The rings are closed already (`overlayProblem`); their edges are geodesic, so they are densified as a polygon's are.
      const all: readonly (readonly Position[])[] = Array.isArray(item.rings) ? item.rings : [];
      const rings = all.filter((ring) => Array.isArray(ring) && ring.length >= 4 && ring.every(isPosition));
      return rings.length > 0 && rings.length === all.length
        ? { id, layerId, kind: 'polygon', rings: rings.map((ring) => densifyPath(ring)), style: item.style }
        : null;
    }
    case 'label':
      return isPosition(item.position) ? { id, layerId, kind: 'text', position: item.position, text: item.text, style: item.style } : null;
    default:
      return null;
  }
}

/**
 * The item moved so that `from` lands on `to` (a preview: lines and polygons are shifted in lon/lat,
 * latitudes clamped at ±90). A line's own points move with it, so a route's point markers follow the
 * line (brief function 26, T-066).
 */
export function translated(item: DrawItem, from: Position, to: Position): DrawItem {
  const dLon = to[0] - from[0];
  const dLat = to[1] - from[1];
  const shift = (p: Position): Position => [p[0] + dLon, Math.max(-90, Math.min(90, p[1] + dLat))];
  switch (item.kind) {
    case 'symbol':
    case 'point':
    case 'fallback':
    case 'text':
    case 'textobject':
      return { ...item, position: to };
    case 'line':
      return { ...item, positions: item.positions.map(shift), ...(item.vertices === undefined ? {} : { vertices: item.vertices.map(shift) }) };
    case 'polygon':
      return { ...item, rings: item.rings.map((ring) => ring.map(shift)) };
    case 'graphic':
      return { ...item, points: item.points.map(shift), parts: item.parts === null ? null : translatedParts(item.parts, dLon, dLat) };
  }
}

/** The id of a graphic's preview while it is placed (it is no object). */
const GRAPHIC_PREVIEW_ID = '00000000-0000-0000-0000-000000000000';

/** The geometries `MapView.edit` edits (brief function 17); the others are refused. */
const EDITABLE: ReadonlySet<string> = new Set(['Polygon', 'LineString', 'Point', 'Circle', 'Ellipse']);
