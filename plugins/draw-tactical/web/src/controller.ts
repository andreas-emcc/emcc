// The plugin's logic: follows the live picture and the map's selection, runs the map view's drawing,
// picking and editing, and turns the user's actions into change requests (ADR-0005). The React
// components only render its state and call it. No method of the controller rejects: unexpected
// errors are logged and shown as a notification. It follows `draw-shapes`' controller wherever the
// brief says "as `draw-shapes`"; what is new is the catalogue of graphics, the SIDC and the amplifiers.
import { changeRequests, GENERAL_DATA_TYPE, NotOnMapError, ObjectQueryError, OutcomeUnknownError, workspaceOf } from '@emc2/plugin-sdk';
import type {
  ChangeEvent, ChangeOutcome, ChangeRejection, ChangeRequestContent, GraphicCatalogEntry, Geometry, Layer, MapObject, MapObjectContent, MapView, MilSymbol,
  ModifierName, Overlay, PanelHandle, PluginContext, Position, SymbolService, Unsubscribe, Uuid, WorkspaceInfo,
} from '@emc2/plugin-sdk';
import { checkAmplifiers, draftsOf, LIST_AMPLIFIERS, mergeModifiers } from './amplifiers.ts';
import type { AmplifierDrafts, AmplifierResult } from './amplifiers.ts';
import {
  coreOf, geometryFor, isGraphicObject, newGraphicContent, normalizeText, reshapedGeometry, sameJson, symbolWith, withGeometry, withLayer, withName, withSymbol,
  controlPointsOf, MAX_NAME_LENGTH,
} from './content.ts';
import { GraphicDrag } from './drag.ts';
import { isInView, moveGeometry } from './geo.ts';
import { entryByKey, entryOfSymbol, isGraphicStandard, keyOf, maxPointsOf, pointCountFits, pointCountText } from './graphics.ts';
import type { GraphicStandard } from './graphics.ts';
import { readSettings } from './settings.ts';
import type { GraphicSettings } from './settings.ts';
import { composeSidc, IDENTITY_CODES, identityOptions, NO_ECHELON, PRESENT, withParts } from './sidc.ts';
import { samplePoints, THUMB_EXTENT, THUMB_RESOLUTION, thumbModelOf } from './thumb.ts';
import type { ThumbModel } from './thumb.ts';
import { editPermissionOf, notInWorkspaceHint, readOnlyHint, shownWorkspace } from './workspace.ts';
import type { LayerTracker } from './layers.ts';
import type { GraphicWatch, WatchChange } from './watch.ts';

/** At most this many change requests wait (sent or queued) at once. The server refuses more than 100 per browser. */
export const MAX_WAITING = 20;
/** How long after a switch a tool that was on still starts when the active layer arrives. */
const PENDING_TOOL_MS = 2000;
export const NO_LAYER_HINT = 'Select or create a layer in the layer panel';
export const NOT_DRAWN = 'This graphic is not drawn';

/** The title of the tool while the active layer is locked (as draw-shapes, function 17). */
export const lockedActiveTitle = (layer: Layer): string => `The active layer "${layer.name}" is locked`;
/** The edit panel's notice for a graphic in a locked layer. */
export const lockedLayerNotice = (layer: Layer): string => `Layer "${layer.name}" is locked`;

/** Whether the catalogue of a standard is there: it comes from the symbology service, and loads its renderer on the first call. */
export type CatalogueStatus = 'idle' | 'loading' | 'ready' | 'failed';

export interface CatalogueState {
  readonly status: CatalogueStatus;
  readonly entries: readonly GraphicCatalogEntry[];
  readonly error: string | null;
}

/** The edit panel's graphic (brief, function 6). */
export interface EditorState {
  readonly id: Uuid;
  /** The newest state known: the subscription's live copy or the one read by id, whichever is newer. Null while loading, or if it could not be read. */
  readonly object: MapObject | null;
  /** The graphic of the catalogue the object is; null while the catalogue loads, and when it lacks it ({@link NOT_DRAWN}). */
  readonly entry: GraphicCatalogEntry | null;
  /** The catalogue of the object's standard is still on its way. */
  readonly catalogueLoading: boolean;
  /** The browser does not hold the graphic (fetched by id, or it left the area): live updates are off until it comes back. */
  readonly notInView: boolean;
  readonly loading: boolean;
  /** Why the graphic could not be read, with a Retry in the panel. */
  readonly error: string | null;
  /** A change request for the graphic is waiting for the server. */
  readonly pending: boolean;
  /** The map view's editing is running for this graphic. */
  readonly reshaping: boolean;
  /** The graphic's layer is not one of the workspace's layers (another plugin selected it): it is shown read only, with this hint. */
  readonly notInWorkspace: string | null;
  /** The graphic's layer is locked: the panel is read only, with this notice. */
  readonly locked: string | null;
}

/** What the user chose for the next graphic besides the graphic itself; they go into the SIDC (brief, function 1). */
export interface NextChoice {
  readonly standardIdentity: string;
  readonly status: string;
  readonly echelon: string;
}

/** Everything the panels render. Immutable: every change makes a new value. */
export interface GraphicsState {
  readonly layers: readonly Layer[];
  /** The active layer, if it exists. */
  readonly activeLayer: Uuid | null;
  /** The user lacks the workspace's edit permission: the tool and the edit panel are off. */
  readonly readOnly: boolean;
  /** Why placing is impossible because of the permission or the layers, or null. */
  readonly hint: string | null;
  /** The active layer is locked: the tool is off, with this title. */
  readonly lockedTitle: string | null;
  /** The user may place into the active layer. */
  readonly canDraw: boolean;
  /** The tool is on. */
  readonly tool: boolean;
  /** Why the tool cannot start now (no graphic chosen, an amplifier missing), or null. */
  readonly toolTitle: string | null;
  readonly catalogue: CatalogueState;
  /** The chosen graphic, or null. */
  readonly entry: GraphicCatalogEntry | null;
  readonly next: NextChoice;
  /** The standard identities and the echelons the service offers (`SymbolService.catalog()`). */
  readonly identities: readonly { readonly code: string; readonly name: string }[];
  readonly echelons: readonly { readonly code: string; readonly name: string }[];
  /** The input for the chosen graphic's amplifiers, and what is wrong with it. */
  readonly drafts: AmplifierDrafts;
  readonly amplifiers: AmplifierResult | null;
  /** The name (`properties.name`) new graphics get. */
  readonly name: string;
  readonly settings: GraphicSettings;
  readonly editor: EditorState | null;
}

type Sent = { readonly kind: 'applied'; readonly event: ChangeEvent } | { readonly kind: 'rejected'; readonly rejection: ChangeRejection } | { readonly kind: 'unknown' };

/** The newest state of a graphic: found, deleted, or not readable (the user has been told). */
type Latest = { readonly kind: 'found'; readonly object: MapObject } | { readonly kind: 'gone' } | { readonly kind: 'failed' };

export class GraphicsController {
  private readonly listeners = new Set<() => void>();
  private readonly cleanup: Unsubscribe[] = [];
  private tool = false;
  /** Ends the map view's placing of the tool that is on (CR-0020's `signal`); one per run. */
  private toolRun: AbortController | null = null;
  /** Ends the map view's editing of the graphic being reshaped; one per reshape. */
  private reshapeRun: AbortController | null = null;
  private waiting = 0;
  private readonly pendingCount = new Map<Uuid, number>();
  private readonly chains = new Map<Uuid, Promise<void>>();
  /** The graphic the edit panel is open for. */
  private editId: Uuid | null = null;
  /** The one selected object, when the user may edit; it is followed once it proves to be a graphic (brief, function 7). */
  private selectedId: Uuid | null = null;
  /** The selection as text, and how often it changed: a drop is sent only if the selection did not change while it waited. */
  private selectionKey = '';
  private selectionEpoch = 0;
  private readonly drag: GraphicDrag;
  private handle: PanelHandle | null = null;
  /** Graphics read by id: the edit target, or the selected graphic, when the browser does not hold it. */
  private readonly fetched = new Map<Uuid, MapObject>();
  private loading = false;
  private loadError: string | null = null;
  private reshaping: Uuid | null = null;
  /** Graphics the user has been told are gone, so that the notice comes once. */
  private readonly announcedGone = new Set<Uuid>();
  private settings: GraphicSettings;
  /** The chosen graphic (a key: symbol set and entity), the identity, status and echelon, the name and the amplifiers of the next graphic. */
  private entryKey: string | null = null;
  private identity: string;
  private status = PRESENT;
  private echelon = NO_ECHELON;
  private name = '';
  private drafts: AmplifierDrafts = {};
  private readonly catalogues = new Map<GraphicStandard, readonly GraphicCatalogEntry[]>();
  private readonly catalogueLoads = new Set<GraphicStandard>();
  private readonly catalogueErrors = new Map<GraphicStandard, string>();
  /** The pictures of the tiles, asked for once per standard, identity-less (T-204). */
  private readonly thumbs = new Map<string, Promise<ThumbModel | null>>();
  private readonly identities: readonly { readonly code: string; readonly name: string }[];
  private readonly echelons: readonly { readonly code: string; readonly name: string }[];
  /** The plugin's own overlay for the points set so far of a `points` graphic (the preview of that kind). */
  private overlay: Overlay | null = null;
  /**
   * A tool that was on at a switch whose new workspace had no active layer yet at `onChange`: the map view or the layer panel
   * may bring the active layer a moment later (the order of the plugins' listeners is not set), so the tool starts then.
   */
  private pendingTool: number | null = null;
  /** The workspace the plugin has settled in: the one of the last `onChange` (the shell's `current` changes a little earlier, at a switch's first step). */
  private settled: WorkspaceInfo;
  private current: GraphicsState;

  constructor(
    private readonly ctx: PluginContext,
    private readonly symbols: SymbolService,
    private readonly layerList: LayerTracker,
    private readonly watch: GraphicWatch,
    private readonly map: MapView,
    /** Adds the edit panel and returns its handle; called each time the panel opens (it is removed when it closes). */
    private readonly addEditPanel: () => PanelHandle,
  ) {
    this.settled = shownWorkspace(ctx);
    this.drag = new GraphicDrag(map, {
      target: () => this.armable(),
      busy: () => this.tool || this.reshaping !== null,
      dropped: (id, drop) => {
        this.dropGraphic(id, drop);
      },
      failed: (error) => {
        this.ctx.log.warn(`the map view could not start the drag: ${error instanceof Error ? error.message : String(error)}`);
      },
    });
    const catalog = symbols.catalog();
    this.identities = identityOptions(symbols);
    this.echelons = catalog.echelons;
    this.settings = this.applySettings(ctx.settings);
    this.identity = this.settings.standardIdentity;
    this.current = this.build();
    this.cleanup.push(
      layerList.onChange(() => {
        this.refresh();
      }),
      watch.onChange((change) => {
        this.onWatchChange(change);
      }),
      map.onViewportChange(() => {
        // "Not in view" follows the map's view, and so does the drag; only an open panel or a selected graphic needs it.
        if (this.editId !== null || this.selectedId !== null) this.refresh();
      }),
      ctx.onSettingsChange((raw) => {
        const before = this.settings;
        this.settings = this.applySettings(raw);
        // Changes in the Settings tab apply at once (ADR-0031): the identity starts again; a new standard has its own catalogue.
        this.identity = this.settings.standardIdentity;
        if (before.standard !== this.settings.standard) this.onStandardChange();
        this.refresh();
      }),
      map.selection.onChange(() => {
        this.onSelection();
      }),
      map.activeLayer.onChange(() => {
        this.refresh();
        this.startPendingTool();
      }),
      map.onLayerVisibilityChange(() => {
        this.drag.rearm(); // a hidden layer's graphic could not be dragged; a shown one can
      }),
    );
    this.cleanup.push(
      ctx.workspace.onChange(() => {
        this.onWorkspace();
      }),
    );
    if (map.selection.value.length > 0) this.onSelection(); // a selection that exists already
  }

  // For useSyncExternalStore.
  readonly subscribe = (listener: () => void): Unsubscribe => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly getState = (): GraphicsState => this.current;

  /** Reads the settings, reports a bad value (log and status), and returns what to use. */
  private applySettings(raw: PluginContext['settings']): GraphicSettings {
    const { settings, problems } = readSettings(raw);
    for (const problem of problems) this.ctx.log.warn(problem);
    if (problems.length > 0) this.ctx.status.set('DEGRADED', problems.join('; '));
    else this.ctx.status.set('OK', 'ready');
    return settings;
  }

  dispose(): void {
    for (const undo of this.cleanup.splice(0)) undo();
    this.endTool();
    this.endReshape();
    this.drag.stop();
    this.watch.release();
    this.overlay?.clear();
    this.handle?.remove();
    this.handle = null;
  }

  // ---- the catalogue (brief, function 1) ----

  /** The standard whose catalogue the Graphics panel offers. */
  private get standard(): GraphicStandard {
    return this.settings.standard;
  }

  /**
   * Asks the symbology service for the catalogue of a standard, once. The first call may load the renderer, so the panel asks
   * when it is first shown, not when the plugin starts.
   */
  ensureCatalogue(standard: GraphicStandard = this.standard): void {
    if (this.catalogues.has(standard) || this.catalogueLoads.has(standard)) return;
    this.catalogueLoads.add(standard);
    this.catalogueErrors.delete(standard);
    let promise: Promise<readonly GraphicCatalogEntry[]>;
    try {
      promise = this.symbols.graphicCatalog(standard);
    } catch (error) {
      promise = Promise.reject(error instanceof Error ? error : new Error(String(error)));
    }
    promise.then(
      (entries) => {
        this.catalogues.set(standard, entries);
      },
      (error: unknown) => {
        this.ctx.log.warn(`the graphic catalogue of ${standard} could not be read: ${error instanceof Error ? error.message : String(error)}`);
        this.catalogueErrors.set(standard, error instanceof Error ? error.message : String(error));
      },
    ).finally(() => {
      this.catalogueLoads.delete(standard);
      this.afterCatalogue();
    });
    this.refresh();
  }

  /**
   * The picture of a graphic's tile: the graphic drawn through sample points in a small view by the symbology
   * service, friend and present. Null for a graphic that needs amplifiers or does not draw. Asked for once.
   */
  thumb(entry: GraphicCatalogEntry): Promise<ThumbModel | null> {
    const standard = this.standard;
    const key = `${standard}/${entry.symbolSet}/${entry.entity}`;
    const known = this.thumbs.get(key);
    if (known !== undefined) return known;
    // A graphic the service does not draw stays null for good; an error (the renderer not ready) is asked again next time.
    const loading = this.drawThumb(standard, entry).catch(() => {
      this.thumbs.delete(key);
      return null;
    });
    this.thumbs.set(key, loading);
    return loading;
  }

  private async drawThumb(standard: GraphicStandard, entry: GraphicCatalogEntry): Promise<ThumbModel | null> {
    const points = samplePoints(entry);
    if (points === null) return null;
    const sidc = composeSidc(this.symbols, entry, { standard, standardIdentity: IDENTITY_CODES.Friend, status: PRESENT, echelon: NO_ECHELON });
    return thumbModelOf(await this.symbols.renderGraphic({ standard, sidc, points, resolution: THUMB_RESOLUTION, extent: THUMB_EXTENT }));
  }

  /** Reads a catalogue again after it failed (the panel's Retry). */
  retryCatalogue(): void {
    this.catalogueErrors.delete(this.standard);
    this.ensureCatalogue();
    this.refresh();
  }

  private catalogueState(standard: GraphicStandard): CatalogueState {
    const entries = this.catalogues.get(standard);
    if (entries !== undefined) return { status: 'ready', entries, error: null };
    const error = this.catalogueErrors.get(standard);
    if (error !== undefined) return { status: 'failed', entries: [], error };
    return { status: this.catalogueLoads.has(standard) ? 'loading' : 'idle', entries: [], error: null };
  }

  /** A catalogue arrived (or failed): the chosen graphic may be gone from it, and an open edit panel may now know its graphic. */
  private afterCatalogue(): void {
    if (this.entryKey !== null && entryByKey(this.catalogueState(this.standard).entries, this.entryKey) === undefined && this.catalogueState(this.standard).status === 'ready') {
      this.entryKey = null;
      this.endTool();
      this.tool = false;
    }
    this.refresh();
  }

  private onStandardChange(): void {
    this.ensureCatalogue();
    const entries = this.catalogues.get(this.standard);
    if (this.entryKey !== null && (entries === undefined || entryByKey(entries, this.entryKey) === undefined)) {
      this.entryKey = null;
      if (this.tool) {
        this.endTool();
        this.tool = false;
      }
    } else if (this.tool) {
      this.restartTool();
    }
  }

  // ---- the Graphics panel ----

  setName(name: string): void {
    this.name = name;
    this.refresh();
  }

  /** Chooses the next graphic by its key (symbol set and entity); a running tool starts again for it. */
  chooseGraphic(key: string | null): void {
    if (key === this.entryKey) return;
    const entry = entryByKey(this.catalogueState(this.standard).entries, key);
    if (key !== null && entry === undefined) return;
    this.entryKey = key;
    if (this.tool) {
      if (entry === undefined) {
        this.endTool();
        this.tool = false;
      } else {
        this.restartTool();
      }
    }
    this.refresh();
  }

  setIdentity(code: string): void {
    this.identity = code;
    this.refresh();
  }

  setStatus(code: string): void {
    this.status = code;
    this.refresh();
  }

  setEchelon(code: string): void {
    this.echelon = code;
    this.refresh();
  }

  /** The input of one amplifier of the next graphic: a text, or the rows of a list. */
  setDraft(name: ModifierName, value: string | readonly string[]): void {
    this.drafts = { ...this.drafts, [name]: value };
    this.refresh();
  }

  /**
   * Switches the tool on, or off when it is on (brief, function 2). With the tool on, the map view's drawing runs for the chosen graphic;
   * the tool stays on for the next graphic until it is switched off, the user cancels a placing (Escape), or another map interaction starts.
   */
  setTool(on: boolean): void {
    this.pendingTool = null;
    if (on === this.tool) return;
    if (on && !this.current.canDraw) return;
    if (on && this.current.toolTitle !== null) return;
    this.endTool();
    this.tool = on;
    this.refresh();
    if (on) this.startTool();
    else this.drag.rearm(); // the user switched the tool off: the selected graphic can be dragged again
  }

  private startTool(): void {
    const run = new AbortController();
    this.toolRun = run;
    this.guard(this.placeLoop(run));
  }

  /** The graphic or the standard changed while the tool is on: the old placing ends (nothing is sent) and a new one starts. */
  private restartTool(): void {
    this.endTool();
    if (this.build().canDraw && this.build().toolTitle === null) this.startTool();
    else this.tool = false;
  }

  /** Ends the map view's placing (CR-0020): its promise resolves with null, and the loop returns. */
  private endTool(): void {
    this.toolRun?.abort();
    this.toolRun = null;
    this.overlay?.clear();
  }

  private endReshape(): void {
    this.reshapeRun?.abort();
    this.reshapeRun = null;
  }

  /** The symbol the next graphic gets: the standard, the SIDC from the choices and the valid amplifiers; null if the input is not valid. */
  private nextSymbol(entry: GraphicCatalogEntry): MilSymbol | null {
    const check = checkAmplifiers(entry, this.drafts);
    if (!check.ok) return null;
    try {
      const sidc = composeSidc(this.symbols, entry, { standard: entry.standard, standardIdentity: this.identity, status: this.status, echelon: this.echelon });
      return { standard: entry.standard, sidc, ...(Object.keys(check.modifiers).length > 0 ? { modifiers: check.modifiers } : {}) };
    } catch (error) {
      if (error instanceof RangeError) {
        this.ctx.notify({ severity: 'error', message: `Cannot compose the graphic's code: ${error.message}` });
        return null;
      }
      throw error;
    }
  }

  private async placeLoop(run: AbortController): Promise<void> {
    const signal = run.signal;
    const aborted = (): boolean => signal.aborted; // a call, so that the checks after an await are not narrowed away
    while (this.tool && !aborted()) {
      const entry = entryByKey(this.catalogueState(this.standard).entries, this.entryKey);
      const symbol = entry === undefined ? null : this.nextSymbol(entry);
      if (entry === undefined || symbol === null) {
        this.tool = false; // the graphic or its amplifiers went meanwhile
        this.refresh();
        return;
      }
      let points: Position[] | null;
      try {
        points = await this.collectPoints(entry, symbol, signal);
      } catch (error) {
        if (aborted()) return;
        this.tool = false;
        this.ctx.log.error('the map view could not place the graphic', error);
        this.ctx.notify({ severity: 'error', message: `Cannot place ${entry.name}: ${error instanceof Error ? error.message : String(error)}` });
        this.refresh();
        this.drag.rearm(); // no other plugin's interaction was involved
        return;
      }
      if (aborted()) return; // the tool was switched off or changed meanwhile
      if (points === null) {
        // A workspace switch ends the placing at the map view's moment, before `onChange`: the tool stays on, and `onChange` restarts it.
        if (this.switching) return;
        // Escape, or another interaction started: nothing is sent, and the tool goes off so that it does not fight the other interaction.
        // The drag is not armed by this end alone (it would end another plugin's interaction, e.g. draw-symbols' placing).
        this.tool = false;
        this.refresh();
        return;
      }
      if (points.length > 0) this.guard(this.createGraphic(entry, points));
    }
  }

  /**
   * The user sets the points of the graphic on the map, in the catalogue's order (brief, function 2). Null when the user cancels.
   * A `line` and an `arrow` are drawn as a line and an `area` as a polygon, the map view previewing the graphic itself; a `points` graphic
   * is picked point by point, with the plugin's own overlay of the points set so far.
   */
  private async collectPoints(entry: GraphicCatalogEntry, symbol: MilSymbol, signal: AbortSignal): Promise<Position[] | null> {
    if (entry.kind === 'points') {
      const wanted = maxPointsOf(entry) ?? entry.minPoints;
      const set: Position[] = [];
      this.overlay ??= this.map.createOverlay();
      while (set.length < wanted) {
        const point = await this.map.pickPoint({ signal });
        if (point === null) {
          this.overlay.clear();
          return null;
        }
        set.push(point);
        this.overlay.set(set.map((position) => ({ kind: 'point', position })));
      }
      this.overlay.clear();
      return set;
    }
    const drawn = await this.map.draw(entry.kind === 'area' ? 'polygon' : 'line', { graphic: symbol, signal });
    if (drawn === null) return null;
    const expected = entry.kind === 'area' ? 'Polygon' : 'LineString';
    if (drawn.type !== expected) {
      this.ctx.notify({ severity: 'error', message: `The map view returned ${drawn.type === 'Ellipse' ? 'an' : 'a'} ${drawn.type} for ${entry.name}. Nothing was created.` });
      return [];  // told; nothing to create
    }
    return controlPointsOf(drawn) ?? [];
  }

  // ---- the edit panel ----

  /**
   * Edit (brief, function 5): selects the graphic and opens the edit panel. A graphic the browser does
   * not hold is fetched by id and marked "not in view".
   */
  async openEditor(id: Uuid): Promise<void> {
    if (!this.canEdit) {
      this.refuseReadOnly();
      return;
    }
    if (this.editId !== null && this.editId !== id) this.closeEditor();
    this.announcedGone.delete(id);
    this.editId = id;
    this.loadError = null;
    this.handle ??= this.addEditPanel();
    this.map.selection.set([id]); // the panel follows the selection: this one graphic
    this.handle.show();
    this.refresh();
    await this.load(id);
  }

  /** Reads the graphic again after a failed read (the panel's Retry). */
  retry(): void {
    const id = this.editId;
    if (id !== null) this.guard(this.load(id));
  }

  /** Closes the edit panel (a click on its Close button). */
  close(): void {
    const id = this.editId;
    this.closeEditor();
    if (id !== null && this.map.selection.value.includes(id)) this.map.selection.set(this.map.selection.value.filter((s) => s !== id));
    this.refresh();
  }

  private closeEditor(): void {
    const id = this.editId;
    if (id === null) return;
    this.endReshape(); // a reshape of a graphic whose panel closes ends with it
    this.editId = null;
    this.watch.release(); // the fixed-area subscription ends with the edit; a selected graphic is followed again when its selection changes
    this.fetched.delete(id);
    this.loadError = null;
    this.loading = false;
    this.handle?.remove();
    this.handle = null;
  }

  /** The standard of an object's symbol when it can have a catalogue, else null. */
  private standardOf(object: MapObjectContent): GraphicStandard | null {
    const standard = object.symbol?.standard;
    return isGraphicStandard(standard) ? standard : null;
  }

  /**
   * Reads the graphic by id, and only then follows it: the fixed-area subscription starts round it, or
   * is renewed if the graphic moved out of its ring (brief, function 9). The catalogue of its standard is asked for too.
   */
  private async load(id: Uuid): Promise<void> {
    this.loading = true;
    this.loadError = null;
    this.refresh();
    try {
      const { found } = await this.ctx.objects.get([id]);
      if (this.editId !== id) return; // closed meanwhile
      const object = found[0];
      if (object === undefined) {
        this.notifyGone(id);
        this.closeAfterGone(id);
      } else if (this.checkIsGraphic(id, object)) {
        this.fetched.set(id, object);
        this.watch.follow(object);
        const standard = this.standardOf(object);
        if (standard !== null) this.ensureCatalogue(standard);
      }
    } catch (error) {
      if (this.editId !== id) return;
      if (error instanceof ObjectQueryError) this.loadError = error.message;
      else this.unexpected(error);
    } finally {
      if (this.editId === id) this.loading = false;
      this.refresh();
    }
  }

  /** The edit panel is only for graphics; Edit is offered for `core.multipoint` only, so this is a guard against a stale id. */
  private checkIsGraphic(id: Uuid, object: MapObject): boolean {
    if (isGraphicObject(object)) return true;
    this.ctx.notify({ severity: 'warning', message: 'This object is not a tactical graphic and cannot be edited here.' });
    this.closeAfterGone(id);
    return false;
  }

  /** The graphic is gone: closes its panel and takes it out of the selection. */
  private closeAfterGone(id: Uuid): void {
    if (this.editId === id) this.closeEditor();
    if (this.map.selection.value.includes(id)) this.map.selection.set(this.map.selection.value.filter((s) => s !== id));
  }

  private notifyGone(id: Uuid): void {
    if (this.announcedGone.has(id)) return;
    this.announcedGone.add(id);
    this.ctx.notify({ severity: 'info', message: 'The graphic was deleted by someone else.' });
  }

  /**
   * The panel follows the selection: it stays only while exactly its graphic is selected (brief,
   * function 6). The one selected object, when the user may edit, is read and, if it is a graphic,
   * followed and made draggable (brief, function 7); a selection of anything else ends that.
   */
  private onSelection(): void {
    const selection = this.map.selection.value;
    const key = selection.join(',');
    if (key !== this.selectionKey) {
      this.selectionKey = key;
      this.selectionEpoch++;
    }
    const previous = this.selectedId;
    const only = this.canEdit && selection.length === 1 ? (selection[0] ?? null) : null;
    this.selectedId = only;
    const id = this.editId;
    if (id !== null && (selection.length !== 1 || selection[0] !== id)) {
      this.closeEditor();
      this.guard(this.checkGone(id));
    }
    if (previous !== null && previous !== only) this.leave(previous);
    if (only !== null && only !== previous && this.editId !== only) this.guard(this.readSelected(only));
    this.drag.rearm();
    this.refresh();
  }

  /** The graphic is no longer the selected one: it is not followed any more. */
  private leave(id: Uuid): void {
    this.fetched.delete(id);
    if (this.watch.id === id) this.watch.release();
  }

  /**
   * Reads the selected object by id and, only when it proves a `core.multipoint`, follows it with the
   * fixed-area subscription (brief, function 9). An answer for an object that is no longer the
   * selected one is ignored. Any other object gets no subscription.
   */
  private async readSelected(id: Uuid): Promise<void> {
    try {
      const { found } = await this.ctx.objects.get([id]);
      if (this.selectedId !== id) return;
      const object = found[0];
      if (object === undefined || !isGraphicObject(object)) return;
      this.fetched.set(id, object);
      this.watch.follow(object);
      const standard = this.standardOf(object);
      if (standard !== null) this.ensureCatalogue(standard);
    } catch (error) {
      if (!(error instanceof ObjectQueryError)) this.unexpected(error);
      else this.ctx.log.warn(`could not read the selected object: ${error.message}`);
    } finally {
      if (this.selectedId === id) this.refresh();
    }
  }

  /**
   * The map view may take a deleted graphic out of the selection before this plugin hears of the
   * deletion; so when the panel closes because the selection changed, ask the server whether the
   * graphic still exists, and say so if it does not.
   */
  private async checkGone(id: Uuid): Promise<void> {
    if (this.announcedGone.has(id)) return;
    try {
      const { missing } = await this.ctx.objects.get([id]);
      if (missing.includes(id)) this.notifyGone(id);
    } catch (error) {
      if (!(error instanceof ObjectQueryError)) this.unexpected(error);
      // Could not ask: say nothing; the user just changed the selection.
    }
  }

  /** The graphic's own subscription reported: a deleted graphic closes the panel and leaves the selection; one that left the area is read by id and followed again. */
  private onWatchChange({ removed, left }: WatchChange): void {
    const id = this.watch.id;
    if (id !== null && (this.editId === id || this.selectedId === id)) {
      if (removed) {
        if (this.editId === id) this.notifyGone(id);
        this.closeAfterGone(id);
      } else if (left) {
        this.guard(this.editId === id ? this.load(id) : this.readSelected(id));
      }
    }
    this.refresh();
  }

  // ---- changes from the edit panel ----

  /** Changes one graphic: `change` gets the core content of the newest state and returns the new content. True if applied or nothing to do. */
  update(id: Uuid, what: string, change: (core: MapObjectContent) => MapObjectContent): Promise<boolean> {
    if (!this.canEdit) return Promise.resolve(this.refuseReadOnly());
    return this.enqueue(id, async () => {
      const latest = await this.latest(id);
      if (latest.kind === 'failed') return false;
      if (latest.kind === 'gone') {
        this.notifyGone(id);
        this.closeAfterGone(id);
        this.refresh();
        return false;
      }
      const object = latest.object;
      if (!isGraphicObject(object)) {
        this.ctx.notify({ severity: 'warning', message: 'This object is not a tactical graphic and cannot be edited here.' });
        return false;
      }
      if (!this.inWorkspace(object)) {
        this.ctx.notify({ severity: 'warning', message: `${notInWorkspaceHint(this.workspace())}.` });
        return false;
      }
      if (this.refuseLocked(object)) return false;
      const core = coreOf(object);
      const next = change(core);
      if (sameJson(core, next)) return true;
      const sent = await this.submit(changeRequests.updateObject(object, next));
      if (sent.kind === 'rejected' && sent.rejection.code === 'ENTITY_NOT_FOUND') {
        this.notifyGone(id);
        this.closeAfterGone(id);
        this.refresh();
        return false;
      }
      return this.report(sent, what, id);
    });
  }

  renameGraphic(id: Uuid, text: string): Promise<boolean> {
    return this.update(id, 'rename the graphic', (core) => withName(core, text));
  }

  moveGraphicToLayer(id: Uuid, layerId: Uuid): Promise<boolean> {
    // The panel offers a locked layer disabled; a stale choice is refused here, not by the store.
    const target = this.layerById(layerId);
    if (target?.locked === true) {
      this.ctx.notify({ severity: 'warning', message: `${lockedLayerNotice(target)}.` });
      return Promise.resolve(false);
    }
    return this.update(id, 'move the graphic to another layer', (core) => withLayer(core, layerId));
  }

  /** Changes the identity, the status or the echelon in the SIDC of a graphic. The graphic's other SIDC digits stay as they are. */
  changeSidc(id: Uuid, what: string, change: Parameters<typeof withParts>[3]): Promise<boolean> {
    return this.update(id, what, (core) => {
      const symbol = core.symbol;
      if (symbol === undefined || !isGraphicStandard(symbol.standard)) return core;
      const sidc = withParts(this.symbols, symbol.standard, symbol.sidc, change);
      return sidc === null ? core : withSymbol(core, { ...symbol, sidc });
    });
  }

  /**
   * Sets one amplifier of a graphic to the user's input (a text, or the rows of a list; empty removes it). An invalid input, or an
   * empty required amplifier, is refused with a notification and nothing is sent; amplifiers the graphic does not allow are kept.
   */
  setGraphicAmplifier(id: Uuid, name: ModifierName, input: string | readonly string[]): Promise<boolean> {
    const known = this.editorObject(id);
    const entry = known === null ? null : this.entryOfObject(known);
    if (known?.symbol === undefined || entry === null) {
      this.ctx.notify({ severity: 'warning', message: `${NOT_DRAWN}, so its amplifiers cannot be edited here.` });
      return Promise.resolve(false);
    }
    const problem = checkAmplifiers(entry, { ...draftsOf(entry, known.symbol.modifiers), [name]: input }).problems[name];
    if (problem !== undefined) {
      this.ctx.notify({ severity: 'warning', message: `Cannot change the amplifier: ${problem}.` });
      return Promise.resolve(false);
    }
    return this.update(id, 'change the amplifier', (core) => {
      const symbol = core.symbol;
      const fresh = symbol === undefined ? null : this.entryOfObject(core);
      if (symbol === undefined || fresh === null) return core;
      const check = checkAmplifiers(fresh, { ...draftsOf(fresh, symbol.modifiers), [name]: input });
      if (!check.ok) return core;
      return withSymbol(core, symbolWith(symbol, mergeModifiers(fresh, symbol.modifiers, check.modifiers)));
    });
  }

  /**
   * Reshape (brief, function 6): starts the map view's editing; the user moves the graphic or its control points, which the map view
   * previews as the graphic. On finish one update with the new geometry; Escape sends nothing.
   */
  async reshape(id: Uuid): Promise<boolean> {
    if (!this.canEdit) return this.refuseReadOnly();
    if (this.reshaping !== null) return false;
    const object = this.editorObject(id);
    if (object === null) return false;
    if (!this.inWorkspace(object)) {
      this.ctx.notify({ severity: 'warning', message: `${notInWorkspaceHint(this.workspace())}.` });
      return false;
    }
    if (this.refuseLocked(object)) return false;
    if (this.entryOfObject(object) === null) {
      this.ctx.notify({ severity: 'info', message: `${NOT_DRAWN}, so it cannot be reshaped. Its properties can be edited.` });
      return false;
    }
    // The editing ends a running placing, so the tool goes off first.
    this.endTool();
    this.tool = false;
    const run = new AbortController();
    this.reshapeRun = run;
    this.reshaping = id;
    this.refresh();
    let geometry: Geometry | null | undefined;
    try {
      geometry = await this.map.edit(id, { signal: run.signal });
    } catch (error) {
      if (error instanceof NotOnMapError) {
        this.ctx.notify({ severity: 'warning', message: 'The map does not show this graphic. Use "Show on map" first, then reshape it.' });
      } else {
        this.unexpected(error);
      }
      return false;
    } finally {
      if (this.reshapeRun === run) this.reshapeRun = null;
      this.reshaping = null;
      this.refresh();
      // A result, a refusal, an error or the plugin's own abort arms the drag again; null (Escape, or another plugin's interaction replaced the reshape) does not.
      if (geometry !== null || run.signal.aborted) this.drag.rearm();
    }
    if (geometry === null) return false; // Escape: nothing is sent
    const entry = this.entryOfObject(object);
    const cleaned = reshapedGeometry(object.geometry, geometry);
    const points = cleaned === null ? null : controlPointsOf(cleaned);
    if (cleaned === null || points === null) {
      this.ctx.notify({ severity: 'error', message: 'The new graphic is outside the valid coordinates or has another geometry, so it was not changed.' });
      return false;
    }
    if (entry !== null && !pointCountFits(entry, points.length)) {
      this.ctx.notify({ severity: 'error', message: `${entry.name} takes ${pointCountText(entry)}, not ${String(points.length)}. The graphic was not changed.` });
      return false;
    }
    return this.update(id, 'reshape the graphic', (core) => withGeometry(core, cleaned));
  }

  /** Centres the map on a graphic that is not in view, so that it can be reshaped. */
  async showOnMap(id: Uuid): Promise<void> {
    try {
      const { missing } = await this.map.centreOn([id]);
      if (missing.includes(id)) this.ctx.notify({ severity: 'warning', message: 'The map cannot show this graphic.' });
    } catch (error) {
      this.unexpected(error);
    }
  }

  // ---- the workspace (brief, function 10) ----

  /** The workspace shown (`ctx.workspace.current`). */
  private workspace(): WorkspaceInfo {
    return shownWorkspace(this.ctx);
  }

  /** True between a switch's first step (`current` changes) and its last (`onChange`): the layers and the tool are in between. */
  private get switching(): boolean {
    return this.workspace().id !== this.settled.id;
  }

  /** Whether the user may edit objects in the workspace shown: its edit permission, or `objects.edit` in View (rule 4). The server checks it anyway. */
  private get canEdit(): boolean {
    return this.ctx.user.has(editPermissionOf(this.workspace()));
  }

  /** The layers of the workspace shown: the only ones the plugin lists, places into and edits in (rules 5 and 6). */
  private workspaceLayers(): readonly Layer[] {
    const id = this.workspace().id;
    return this.layerList.layers.filter((l) => workspaceOf(l) === id);
  }

  private inWorkspace(object: MapObject): boolean {
    return this.workspaceLayers().some((l) => l.id === object.layerId);
  }

  private layerById(id: Uuid): Layer | undefined {
    return this.layerList.layers.find((l) => l.id === id);
  }

  /** The layer of the object, when it is locked (SDK 1.3.0, as draw-shapes function 17): the store refuses every user's change to its content. */
  private lockOf(object: MapObject): Layer | null {
    const layer = this.layerById(object.layerId);
    return layer?.locked === true ? layer : null;
  }

  private lockNoticeOf(object: MapObject): string | null {
    const layer = this.lockOf(object);
    return layer === null ? null : lockedLayerNotice(layer);
  }

  /** Tells the user that the graphic's layer is locked and returns true; nothing is sent for such a graphic. */
  private refuseLocked(object: MapObject): boolean {
    const layer = this.lockOf(object);
    if (layer === null) return false;
    this.ctx.notify({ severity: 'warning', message: `${lockedLayerNotice(layer)}.` });
    return true;
  }

  /**
   * The last step of a switch (brief, function 10). The map view has ended the running interactions and
   * cleared the selection at its moment, and the fresh snapshots are in. What belongs to the old
   * workspace ends: the edit panel and its subscription, a reshape. A tool that was on places in the
   * new workspace if the user may place into it, else it goes off.
   */
  private onWorkspace(): void {
    this.settled = this.workspace();
    this.endReshape();
    this.closeEditor();
    const selected = this.selectedId;
    this.selectedId = null;
    if (selected !== null) this.leave(selected);
    this.watch.release();
    this.fetched.clear();
    this.selectionEpoch++;
    this.pendingTool = null;
    if (this.tool) {
      this.endTool();
      if (this.build().canDraw) this.startTool();
      else {
        this.tool = false;
        this.pendingTool = Date.now();
      }
    }
    this.drag.rearm();
    this.refresh();
  }

  /** The active layer came a moment after the switch's last step: the tool that was on starts then, if the user may place into it. */
  private startPendingTool(): void {
    const at = this.pendingTool;
    if (at === null) return;
    this.pendingTool = null;
    if (this.tool || Date.now() - at > PENDING_TOOL_MS || !this.current.canDraw || this.current.toolTitle !== null) return;
    this.tool = true;
    this.refresh();
    this.startTool();
  }

  // ---- the drag (brief, function 7) ----

  /** The graphic the panel is open for, or the selected graphic: the ones followed by the fixed-area subscription. */
  private tracks(id: Uuid): boolean {
    return this.editId === id || this.selectedId === id;
  }

  /**
   * The graphic whose drag is armed now, or null: exactly one object is selected, it proved to be a `core.multipoint` (only those are
   * followed), the user may edit in the workspace shown, the graphic's layer is one of the workspace's layers and is not locked, and the
   * graphic is in the map's view. While one of the plugin's own interactions runs (the tool, a reshape) the drag waits (`busy`).
   */
  private armable(): Uuid | null {
    const id = this.selectedId;
    if (id === null || !this.canEdit) return null;
    const object = this.editorObject(id);
    if (object === null || this.outsideView(object) || !this.inWorkspace(object) || this.lockOf(object) !== null) return null;
    return id;
  }

  /**
   * A drop: moves the graphic by the difference between the drop and its first control point, after the
   * updates still under way, from its newest state. Nothing is sent if the selection changed while it waited.
   */
  private dropGraphic(id: Uuid, drop: Position): void {
    const epoch = this.selectionEpoch;
    this.guard(
      this.update(id, 'move the graphic', (core) => {
        if (epoch !== this.selectionEpoch) return core;
        const moved = moveGeometry(core.geometry, drop);
        return moved === null ? core : withGeometry(core, moved);
      }),
    );
  }

  // ---- state ----

  /** The newest state of the graphic the panel is open for: the live copy of its subscription, or the one read by id, whichever is newer. */
  private editorObject(id: Uuid): MapObject | null {
    const live = this.watch.id === id ? this.watch.object : undefined;
    const read = this.fetched.get(id);
    if (live !== undefined && (read === undefined || live.version >= read.version)) return live;
    return read ?? null;
  }

  /** The graphic of the catalogue an object is, or null if its catalogue lacks it or has not come yet. */
  private entryOfObject(object: MapObjectContent): GraphicCatalogEntry | null {
    const symbol = object.symbol;
    if (symbol === undefined || !isGraphicStandard(symbol.standard)) return null;
    return entryOfSymbol(this.symbols, this.catalogues.get(symbol.standard) ?? [], symbol);
  }

  /** The graphic is outside the map's view: none of its control points is inside `viewport.visibleArea`. */
  private outsideView(object: MapObject): boolean {
    const { center, visibleArea } = this.map.viewport;
    return !isInView(object.geometry, { centre: center, ring: visibleArea });
  }

  private build(): GraphicsState {
    const workspace = this.workspace();
    const layers = this.workspaceLayers();
    const active = this.map.activeLayer.value;
    const activeLayer = active !== null && layers.some((l) => l.id === active) ? active : null;
    const activeLocked = layers.find((l) => l.id === activeLayer && l.locked === true);
    const lockedTitle = this.canEdit && activeLocked !== undefined ? lockedActiveTitle(activeLocked) : null;
    let hint: string | null = null;
    if (!this.canEdit) hint = readOnlyHint(workspace);
    else if (activeLayer === null) hint = NO_LAYER_HINT;
    const catalogue = this.catalogueState(this.standard);
    const entry = entryByKey(catalogue.entries, this.entryKey) ?? null;
    const amplifiers = entry === null ? null : checkAmplifiers(entry, this.drafts);
    let toolTitle: string | null = null;
    if (entry === null) toolTitle = 'Choose a graphic first';
    else if (amplifiers !== null && !amplifiers.ok) toolTitle = `Fill in the amplifiers first: ${Object.entries(amplifiers.problems).map(([n, p]) => `${n} (${p})`).join(', ')}`;
    const id = this.editId;
    const shown = id === null ? null : this.editorObject(id);
    const shownStandard = shown === null ? null : this.standardOf(shown);
    const editor: EditorState | null =
      id === null
        ? null
        : {
            id,
            object: shown,
            entry: shown === null ? null : this.entryOfObject(shown),
            catalogueLoading: shownStandard !== null && this.catalogueState(shownStandard).status === 'loading',
            notInView: shown !== null && this.outsideView(shown),
            loading: this.loading,
            error: this.loadError,
            pending: this.pendingCount.has(id),
            reshaping: this.reshaping === id,
            notInWorkspace: shown !== null && !layers.some((l) => l.id === shown.layerId) ? notInWorkspaceHint(workspace) : null,
            locked: shown === null ? null : this.lockNoticeOf(shown),
          };
    return {
      layers,
      activeLayer,
      readOnly: !this.canEdit,
      hint,
      lockedTitle,
      canDraw: this.canEdit && activeLayer !== null && lockedTitle === null,
      tool: this.tool,
      toolTitle,
      catalogue,
      entry,
      next: { standardIdentity: this.identity, status: this.status, echelon: this.echelon },
      identities: this.identities,
      echelons: this.echelons,
      drafts: this.drafts,
      amplifiers,
      name: this.name,
      settings: this.settings,
      editor,
    };
  }

  /** Recomputes the state after any change, switches the tool off if placing became impossible, and tells the listeners. */
  private refresh(): void {
    let state = this.build();
    let toolEnded = false;
    if (this.tool && !state.canDraw && !this.switching) {
      this.tool = false;
      this.endTool();
      toolEnded = true; // placing became impossible (the layer is gone, or locked): the plugin's own event
      state = this.build();
    }
    // A reshape of a graphic whose layer was locked meanwhile ends, and sends nothing.
    const reshaped = this.reshaping === null ? null : this.editorObject(this.reshaping);
    if (reshaped !== null && this.lockOf(reshaped) !== null) this.endReshape();
    this.current = state;
    if (toolEnded) this.drag.rearm();
    else this.drag.sync();
    for (const listener of [...this.listeners]) listener();
  }

  // ---- change requests ----

  /** Turns the placed points into a create request (brief, function 3). */
  private async createGraphic(entry: GraphicCatalogEntry, points: readonly Position[]): Promise<boolean> {
    if (!this.canEdit) return this.refuseReadOnly();
    const layerId = this.current.activeLayer;
    if (layerId === null) {
      this.ctx.notify({ severity: 'warning', message: `Cannot create the graphic: ${NO_LAYER_HINT.toLowerCase()}.` });
      return false;
    }
    if (this.current.lockedTitle !== null) {
      // The layer was locked while the user placed; the tool goes off with the next refresh. Nothing is sent.
      this.ctx.notify({ severity: 'warning', message: `Cannot create the graphic. ${this.current.lockedTitle}.` });
      return false;
    }
    if (!pointCountFits(entry, points.length)) {
      this.ctx.notify({ severity: 'error', message: `${entry.name} takes ${pointCountText(entry)}, not ${String(points.length)}. Nothing was created.` });
      return false;
    }
    const symbol = this.nextSymbol(entry);
    if (symbol === null) {
      this.ctx.notify({ severity: 'warning', message: 'Cannot create the graphic: fill in its amplifiers first.' });
      return false;
    }
    const geometry = geometryFor(entry, points);
    if (geometry === null) {
      this.ctx.notify({ severity: 'warning', message: 'The graphic is outside the valid coordinates, so it was not created.' });
      return false;
    }
    const usedName = this.name;
    const content = newGraphicContent({ symbol, geometry, name: usedName, layerId, dataType: GENERAL_DATA_TYPE, label: this.ctx.defaultLabel });
    const created = await this.create(content);
    if (created) this.afterCreate(usedName);
    return created;
  }

  /** The next graphic gets its own name and text amplifiers; the numbers a tool needs (distances, azimuths) stay for the next one. */
  private afterCreate(usedName: string): void {
    if (this.name === usedName && normalizeText(usedName, MAX_NAME_LENGTH) !== undefined) this.name = '';
    this.drafts = Object.fromEntries(Object.entries(this.drafts).filter(([name]) => (LIST_AMPLIFIERS as readonly string[]).includes(name)));
    this.refresh();
  }

  private async create(content: MapObjectContent): Promise<boolean> {
    if (!this.reserve()) return false;
    const id = this.ctx.newId();
    try {
      let sent = await this.submit(changeRequests.createObject(id, content));
      if (sent.kind === 'unknown') {
        // The same id again: if the first request arrived, the store answers ENTITY_EXISTS.
        sent = await this.submit(changeRequests.createObject(id, content));
        if (sent.kind === 'rejected' && sent.rejection.code === 'ENTITY_EXISTS') return true;
      }
      return this.report(sent, 'create the graphic', null);
    } catch (error) {
      this.unexpected(error);
      return false;
    } finally {
      this.waiting--;
    }
  }

  /**
   * Runs `task` after the earlier tasks for the same graphic, so that each one starts from the
   * state the previous one produced. `task` is built when it runs, from the newest state.
   */
  private enqueue(id: Uuid, task: () => Promise<boolean>): Promise<boolean> {
    if (!this.reserve()) return Promise.resolve(false);
    this.markPending(id, 1);
    const previous = this.chains.get(id) ?? Promise.resolve();
    const run = previous.then(async () => {
      try {
        return await task();
      } catch (error) {
        this.unexpected(error);
        return false;
      } finally {
        this.waiting--;
        this.markPending(id, -1);
      }
    });
    const tail = run.then(() => undefined);
    this.chains.set(id, tail);
    void tail.then(() => {
      if (this.chains.get(id) === tail) this.chains.delete(id);
    });
    return run;
  }

  /**
   * The newest state of a graphic before a commit (brief, function 9): the subscription's live copy
   * if the graphic is in the map's view, else read by id again, so that the update is based on the
   * newest version. A graphic the subscription does not hold is read by id too.
   */
  private async latest(id: Uuid): Promise<Latest> {
    const live = this.watch.id === id ? this.watch.object : undefined;
    if (live !== undefined && !this.outsideView(live)) return { kind: 'found', object: live };
    try {
      const { found } = await this.ctx.objects.get([id]);
      const object = found[0];
      if (object === undefined) return { kind: 'gone' };
      if (this.tracks(id)) {
        this.fetched.set(id, object);
        this.watch.follow(object);
        this.refresh();
      }
      return { kind: 'found', object };
    } catch (error) {
      if (error instanceof ObjectQueryError) {
        this.ctx.notify({ severity: 'error', message: `Could not read the graphic from the server: ${error.message}` });
      } else {
        this.unexpected(error);
      }
      return { kind: 'failed' };
    }
  }

  /** Counts a waiting request; false (with a notification) above {@link MAX_WAITING}. */
  private reserve(): boolean {
    if (this.waiting >= MAX_WAITING) {
      this.ctx.notify({ severity: 'warning', message: 'Too many changes are waiting for the server. Try again in a moment.' });
      return false;
    }
    this.waiting++;
    return true;
  }

  private markPending(id: Uuid, delta: number): void {
    const count = (this.pendingCount.get(id) ?? 0) + delta;
    if (count > 0) this.pendingCount.set(id, count);
    else this.pendingCount.delete(id);
    this.refresh();
  }

  private async submit(request: ChangeRequestContent): Promise<Sent> {
    let outcome: ChangeOutcome;
    try {
      outcome = await this.ctx.changes.submit(request);
    } catch (error) {
      if (error instanceof OutcomeUnknownError) return { kind: 'unknown' };
      throw error;
    }
    return outcome.outcome === 'applied' ? { kind: 'applied', event: outcome.event } : { kind: 'rejected', rejection: outcome.rejection };
  }

  /**
   * Tells the user what went wrong; true if the change was applied. An applied update changes our
   * state at once (the graphic's copy, and its subscription, which follows it if it moved far).
   */
  private report(sent: Sent, what: string, id: Uuid | null): boolean {
    if (sent.kind === 'applied') {
      if (id !== null && sent.event.state !== null && sent.event.entityType === 'object') {
        const state = sent.event.state as MapObject;
        const known = this.fetched.get(id);
        if (this.tracks(id) && (known === undefined || state.version > known.version)) this.fetched.set(id, state);
        this.watch.applyEvent(sent.event);
        this.refresh();
      }
      return true;
    }
    if (sent.kind === 'unknown') {
      this.ctx.notify({ severity: 'warning', message: `No answer from the server to the request to ${what}. Look at the map before trying again.` });
    } else {
      const { code, message } = sent.rejection;
      this.ctx.notify({ severity: 'error', message: `Could not ${what}: ${message} (${code})` });
    }
    return false;
  }

  /** Defence in depth: the tool and the panel are off without the edit permission, and the server checks anyway. */
  private refuseReadOnly(): boolean {
    this.ctx.notify({ severity: 'warning', message: `${readOnlyHint(this.workspace())}.` });
    return false;
  }

  private unexpected(error: unknown): void {
    this.ctx.log.error('unexpected error', error);
    this.ctx.notify({ severity: 'error', message: `Unexpected error: ${error instanceof Error ? error.message : String(error)}` });
  }

  /** Runs a promise nobody awaits, so that a failure becomes a notification instead of vanishing. */
  guard(promise: Promise<unknown>): void {
    promise.catch((error: unknown) => {
      this.unexpected(error);
    });
  }

  /** The key of the chosen graphic, for the panel's selection. */
  keyOfChosen(): string | null {
    const entry = this.current.entry;
    return entry === null ? null : keyOf(entry);
  }
}
