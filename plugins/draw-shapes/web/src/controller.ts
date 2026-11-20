// The plugin's logic: follows the live picture and the map's selection, runs the map view's
// drawing and editing service, and turns the user's actions into change requests (ADR-0005). The
// React components only render its state and call it. No method of the controller rejects:
// unexpected errors are logged and shown as a notification.
import { changeRequests, choosableDataTypes, GENERAL_DATA_TYPE, NotALineError, NotOnMapError, ObjectQueryError, OutcomeUnknownError, workspaceOf } from '@emc2/plugin-sdk';
import type {
  ChangeEvent, ChangeOutcome, ChangeRejection, ChangeRequestContent, DataType, Geometry, Layer, MapObject, MapObjectContent, MapView, PanelHandle,
  PluginContext, Position, Unsubscribe, Uuid, WorkspaceInfo,
} from '@emc2/plugin-sdk';
import {
  cleanGeometry, coreOf, isShape, newShapeContent, sameJson, withDataType, withGeometry, withLayer, withName, withStyle,
} from './content.ts';
import { ShapeDrag } from './drag.ts';
import { isInView, moveGeometry } from './geo.ts';
import { drawKindOf, geometryTypeOf, isAppendable, isAreaGeometry, isReshapable, KIND_LABELS, withArticle } from './kinds.ts';
import type { ShapeKind } from './kinds.ts';
import { keepDataType, readKeptDataType } from './keptChoice.ts';
import { readSettings } from './settings.ts';
import type { ShapeSettings } from './settings.ts';
import { applyChoice, choiceOf, styleFor } from './style.ts';
import { editPermissionOf, notInWorkspaceHint, readOnlyHint, shownWorkspace } from './workspace.ts';
import type { StyleChoice } from './style.ts';
import type { LayerTracker } from './layers.ts';
import type { ShapeWatch, WatchChange } from './watch.ts';

/** At most this many change requests wait (sent or queued) at once. The server refuses more than 100 per browser. */
export const MAX_WAITING = 20;
/** How long after a switch a tool that was on still starts when the active layer arrives. */
const PENDING_TOOL_MS = 2000;
export const NO_LAYER_HINT = 'Select or create a layer in the layer panel';

/** The title of the draw tools while the active layer is locked (function 17). */
export const lockedActiveTitle = (layer: Layer): string => `The active layer "${layer.name}" is locked`;
/** The edit panel's notice for a shape in a locked layer (function 17). */
export const lockedLayerNotice = (layer: Layer): string => `Layer "${layer.name}" is locked`;

/** The edit panel's shape (brief, function 4). */
export interface EditorState {
  readonly id: Uuid;
  /** The newest state known: the subscription's live copy or the one read by id, whichever is newer. Null while loading, or if it could not be read. */
  readonly object: MapObject | null;
  /** The browser does not hold the shape (fetched by id, or it left the area): live updates are off until it comes back (function 7). */
  readonly notInView: boolean;
  readonly loading: boolean;
  /** Why the shape could not be read, with a Retry in the panel. */
  readonly error: string | null;
  /** A change request for the shape is waiting for the server. */
  readonly pending: boolean;
  /** The map view's editing service is running for this shape. */
  readonly reshaping: boolean;
  /** The map view's `append` is running for this shape (function 19). */
  readonly appending: boolean;
  /** The shape's layer is not one of the workspace's layers (another plugin selected it): it is shown read only, with this hint (function 11). */
  readonly notInWorkspace: string | null;
  /** The shape's layer is locked: the panel is read only, with this notice (function 17). */
  readonly locked: string | null;
}

/** Everything the panels render. Immutable: every change makes a new value. */
export interface ShapesState {
  readonly layers: readonly Layer[];
  /** The active layer, if it exists. */
  readonly activeLayer: Uuid | null;
  /** The user lacks the workspace's edit permission (`objects.edit` in View): the tools and the edit panel are off (brief, functions 9 and 12). */
  readonly readOnly: boolean;
  /** Why drawing is impossible because of the permission or the layers, or null. */
  readonly hint: string | null;
  /** The active layer is locked: the tools are off, with this title (function 17). */
  readonly lockedTitle: string | null;
  readonly canDraw: boolean;
  /** The tool that is on, or null. */
  readonly tool: ShapeKind | null;
  /** The style new shapes get. */
  readonly style: StyleChoice;
  /** The name (the label) new shapes get. */
  readonly name: string;
  readonly settings: ShapeSettings;
  /** The available data types, `core.general` first (ADR-0023). */
  readonly dataTypes: readonly DataType[];
  /** The data type new shapes get: the choice kept in this browser if it is available, else the setting, else `core.general`. */
  readonly dataType: string;
  readonly editor: EditorState | null;
}

type Sent = { readonly kind: 'applied'; readonly event: ChangeEvent } | { readonly kind: 'rejected'; readonly rejection: ChangeRejection } | { readonly kind: 'unknown' };

/** The newest state of a shape: found, deleted, or not readable (the user has been told). */
type Latest = { readonly kind: 'found'; readonly object: MapObject } | { readonly kind: 'gone' } | { readonly kind: 'failed' };

export class ShapesController {
  private readonly listeners = new Set<() => void>();
  private readonly cleanup: Unsubscribe[] = [];
  private tool: ShapeKind | null = null;
  /** Ends the map view's drawing of the tool that is on (CR-0020's `signal`); one per tool. */
  private toolRun: AbortController | null = null;
  /** Ends the map view's editing of the shape being reshaped; one per reshape. */
  private reshapeRun: AbortController | null = null;
  private style: StyleChoice;
  private name = '';
  private waiting = 0;
  private readonly pendingCount = new Map<Uuid, number>();
  private readonly chains = new Map<Uuid, Promise<void>>();
  /** The shape the edit panel is open for. */
  private editId: Uuid | null = null;
  /** The one selected object, when the user may edit; it is followed once it proves to be a shape (brief, function 16). */
  private selectedId: Uuid | null = null;
  /** The selection as text, and how often it changed: a drop is sent only if the selection did not change while it waited. */
  private selectionKey = '';
  private selectionEpoch = 0;
  private readonly drag: ShapeDrag;
  private handle: PanelHandle | null = null;
  /** Shapes read by id: the edit target, or the selected shape, when the browser does not hold it. */
  private readonly fetched = new Map<Uuid, MapObject>();
  private loading = false;
  private loadError: string | null = null;
  private reshaping: Uuid | null = null;
  /** The run in `reshaping` is an append (function 19), not a reshape. */
  private appending = false;
  /** Shapes the user has been told are gone, so that the notice comes once. */
  private readonly announcedGone = new Set<Uuid>();
  private settings: ShapeSettings;
  private dataTypes: readonly DataType[];
  /** The user's choice of data type for new shapes, kept in this browser. */
  private kept: string | null = readKeptDataType();
  /**
   * A tool that was on at a switch whose new workspace had no active layer yet at `onChange`: the map view or the layer panel
   * may bring the active layer a moment later (the order of the plugins' listeners is not set), so the tool starts then.
   */
  private pendingTool: { readonly kind: ShapeKind; readonly at: number } | null = null;
  /** The workspace the plugin has settled in: the one of the last `onChange` (the shell's `current` changes a little earlier, at a switch's first step). */
  private settled: WorkspaceInfo;
  private current: ShapesState;

  constructor(
    private readonly ctx: PluginContext,
    private readonly layerList: LayerTracker,
    private readonly watch: ShapeWatch,
    private readonly map: MapView,
    /** Adds the edit panel and returns its handle; called each time the panel opens (it is removed when it closes). */
    private readonly addEditPanel: () => PanelHandle,
  ) {
    this.settled = shownWorkspace(ctx);
    this.drag = new ShapeDrag(map, {
      target: () => this.armable(),
      busy: () => this.tool !== null || this.reshaping !== null,
      dropped: (id, drop) => {
        this.dropShape(id, drop);
      },
      failed: (error) => {
        this.ctx.log.warn(`the map view could not start the drag: ${error instanceof Error ? error.message : String(error)}`);
      },
    });
    this.dataTypes = ctx.dataTypes;
    this.settings = this.applySettings(ctx.settings);
    this.style = this.settings.style;
    this.current = this.build();
    this.cleanup.push(
      layerList.onChange(() => {
        this.refresh();
      }),
      watch.onChange((change) => {
        this.onWatchChange(change);
      }),
      map.onViewportChange(() => {
        // "Not in view" follows the map's view, and so does the drag; only an open panel or a selected shape needs it.
        if (this.editId !== null || this.selectedId !== null) this.refresh();
      }),
      ctx.onDataTypesChange((dataTypes) => {
        this.dataTypes = dataTypes;
        this.refresh();
      }),
      ctx.onSettingsChange((raw) => {
        this.settings = this.applySettings(raw);
        this.style = this.settings.style; // changes in the Settings tab apply at once (ADR-0031)
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
        this.drag.rearm(); // a hidden layer's shape could not be dragged; a shown one can
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

  readonly getState = (): ShapesState => this.current;

  /** Reads the settings, reports a bad value (log and status), and returns what to use. */
  private applySettings(raw: PluginContext['settings']): ShapeSettings {
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
    this.handle?.remove();
    this.handle = null;
  }

  // ---- the Shapes panel ----

  /** Chooses the data type of new shapes and keeps the choice in this browser (brief, function 1). */
  setDataType(id: string): void {
    if (!choosableDataTypes(this.dataTypes).some((t) => t.id === id)) return;
    this.kept = id;
    if (!keepDataType(id)) this.ctx.log.warn('the data type choice could not be kept in this browser');
    this.refresh();
  }

  /** Changes some fields of the style new shapes get. */
  setStyle(patch: Partial<StyleChoice>): void {
    this.style = { ...this.style, ...patch };
    this.refresh();
  }

  setName(name: string): void {
    this.name = name;
    this.refresh();
  }

  /**
   * Switches a tool on, or off when it is the one that is on (brief, function 2). With a tool on,
   * the map view's drawing service runs; the tool stays on for the next shape until it is switched
   * off, the user cancels a drawing (Escape), or another map interaction starts.
   */
  setTool(kind: ShapeKind | null): void {
    const next = kind === this.tool ? null : kind;
    this.pendingTool = null;
    if (next !== null && !this.current.canDraw) return;
    this.endTool();
    this.tool = next;
    this.refresh();
    if (next !== null) this.startTool(next);
    else this.drag.rearm(); // the user switched the tool off: the selected shape can be dragged again
  }

  private startTool(kind: ShapeKind): void {
    const run = new AbortController();
    this.toolRun = run;
    this.guard(this.drawLoop(kind, run.signal));
  }

  /** Ends the map view's drawing of the tool (CR-0020): its promise resolves with null, and the loop returns. */
  private endTool(): void {
    this.toolRun?.abort();
    this.toolRun = null;
  }

  private endReshape(): void {
    this.reshapeRun?.abort();
    this.reshapeRun = null;
  }

  private async drawLoop(kind: ShapeKind, signal: AbortSignal): Promise<void> {
    const aborted = (): boolean => signal.aborted; // a call, so that the checks after an await are not narrowed away
    while (this.tool === kind && !aborted()) {
      let geometry: Awaited<ReturnType<MapView['draw']>>;
      try {
        geometry = await this.map.draw(drawKindOf(kind), { style: styleFor(this.style, kind), signal });
      } catch (error) {
        if (aborted()) return;
        this.tool = null;
        this.ctx.log.error('the map view could not draw', error);
        this.ctx.notify({ severity: 'error', message: `Cannot draw ${withArticle(KIND_LABELS[kind].toLowerCase())}: ${error instanceof Error ? error.message : String(error)}` });
        this.refresh();
        this.drag.rearm(); // no other plugin's interaction was involved
        return;
      }
      if (aborted()) return; // the tool was switched off or changed meanwhile
      if (geometry === null) {
        // A workspace switch ends the drawing at the map view's moment, before `onChange`: the tool stays on, and `onChange` restarts it (function 13).
        if (this.switching) return;
        // Escape, or another interaction started: nothing is sent, and the tool goes off so that it does not fight the other interaction.
        // The drag is not armed by this end alone (it would end another plugin's interaction, e.g. draw-symbols' placing).
        this.tool = null;
        this.refresh();
        return;
      }
      this.guard(this.createShape(kind, geometry));
    }
  }

  // ---- the edit panel ----

  /**
   * Edit (brief, function 3): selects the shape and opens the edit panel. A shape the browser does
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
    this.map.selection.set([id]); // the panel follows the selection: this one shape
    this.handle.show();
    this.refresh();
    await this.load(id);
  }

  /** Reads the shape again after a failed read (the panel's Retry). */
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
    this.endReshape(); // a reshape of a shape whose panel closes ends with it
    this.editId = null;
    this.watch.release(); // the fixed-area subscription ends with the edit; a selected shape is followed again when its selection changes
    this.fetched.delete(id);
    this.loadError = null;
    this.loading = false;
    this.handle?.remove();
    this.handle = null;
  }

  /**
   * Reads the shape by id, and only then follows it: the fixed-area subscription starts round it, or
   * is renewed if the shape moved out of its ring (brief, function 7).
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
      } else if (this.checkIsShape(id, object)) {
        this.fetched.set(id, object);
        this.watch.follow(object);
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

  /** The edit panel is only for shapes; Edit is offered for `core.shape` only, so this is a guard against a stale id. */
  private checkIsShape(id: Uuid, object: MapObject): boolean {
    if (isShape(object)) return true;
    this.ctx.notify({ severity: 'warning', message: 'This object is not a shape and cannot be edited here.' });
    this.closeAfterGone(id);
    return false;
  }

  /** The shape is gone: closes its panel and takes it out of the selection. */
  private closeAfterGone(id: Uuid): void {
    if (this.editId === id) this.closeEditor();
    if (this.map.selection.value.includes(id)) this.map.selection.set(this.map.selection.value.filter((s) => s !== id));
  }

  private notifyGone(id: Uuid): void {
    if (this.announcedGone.has(id)) return;
    this.announcedGone.add(id);
    this.ctx.notify({ severity: 'info', message: 'The shape was deleted by someone else.' });
  }

  /**
   * The panel follows the selection: it stays only while exactly its shape is selected (brief,
   * function 4). The one selected object, when the user may edit, is read and, if it is a shape,
   * followed and made draggable (brief, function 16); a selection of anything else ends that.
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

  /** The shape is no longer the selected one: it is not followed any more. */
  private leave(id: Uuid): void {
    this.fetched.delete(id);
    if (this.watch.id === id) this.watch.release();
  }

  /**
   * Reads the selected object by id and, only when it proves a `core.shape`, follows it with the
   * fixed-area subscription (brief, function 7). An answer for an object that is no longer the
   * selected one is ignored. Any other object gets no subscription.
   */
  private async readSelected(id: Uuid): Promise<void> {
    try {
      const { found } = await this.ctx.objects.get([id]);
      if (this.selectedId !== id) return;
      const object = found[0];
      if (object === undefined || !isShape(object)) return;
      this.fetched.set(id, object);
      this.watch.follow(object);
    } catch (error) {
      if (!(error instanceof ObjectQueryError)) this.unexpected(error);
      else this.ctx.log.warn(`could not read the selected object: ${error.message}`);
    } finally {
      if (this.selectedId === id) this.refresh();
    }
  }

  /**
   * The map view may take a deleted shape out of the selection before this plugin hears of the
   * deletion; so when the panel closes because the selection changed, ask the server whether the
   * shape still exists, and say so if it does not (brief, function 7).
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

  /** The shape's own subscription reported: a deleted shape closes the panel and leaves the selection; one that left the area is read by id and followed again. */
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

  /** Changes one shape: `change` gets the core content of the newest state and returns the new content. True if applied or nothing to do. */
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
      if (!isShape(object)) {
        this.ctx.notify({ severity: 'warning', message: 'This object is not a shape and cannot be edited here.' });
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

  renameShape(id: Uuid, text: string): Promise<boolean> {
    return this.update(id, 'rename the shape', (core) => withName(core, text));
  }

  /** Changes some fields of a shape's style; the other fields are taken from the newest state, so a field changed by someone else is not overwritten. */
  restyleShape(id: Uuid, patch: Partial<StyleChoice>): Promise<boolean> {
    return this.update(id, 'change the style', (core) =>
      withStyle(core, applyChoice(core.style, { ...choiceOf(core.style, this.settings.style), ...patch }, { area: isAreaGeometry(core.geometry), line: core.geometry.type === 'LineString' })));
  }

  moveShapeToLayer(id: Uuid, layerId: Uuid): Promise<boolean> {
    // The panel offers a locked layer disabled; a stale choice is refused here, not by the store (function 17).
    const target = this.layerById(layerId);
    if (target?.locked === true) {
      this.ctx.notify({ severity: 'warning', message: `${lockedLayerNotice(target)}.` });
      return Promise.resolve(false);
    }
    return this.update(id, 'move the shape to another layer', (core) => withLayer(core, layerId));
  }

  setShapeDataType(id: Uuid, dataType: string): Promise<boolean> {
    return this.update(id, 'change the data type', (core) => withDataType(core, dataType));
  }

  /**
   * Reshape (brief, function 4): starts the map view's editing service; the user moves the shape or
   * drags its corners. On finish one update with the new geometry; Escape sends nothing.
   */
  reshape(id: Uuid): Promise<boolean> {
    return this.editGeometry(id, 'reshape');
  }

  /**
   * Append (brief, function 19; SDK 1.6.0): starts the map view's `append` for a line; the user
   * continues it from its last point. On finish one update with the whole line; Escape, or no point
   * added, sends nothing. Only one of Reshape, Append and the drag runs at a time.
   */
  append(id: Uuid): Promise<boolean> {
    return this.editGeometry(id, 'append');
  }

  /** Runs the map view's editing service for one shape, as a reshape or an append: they share the guards, the `signal` and the update (functions 4, 17 and 19). */
  private async editGeometry(id: Uuid, how: 'reshape' | 'append'): Promise<boolean> {
    if (!this.canEdit) return this.refuseReadOnly();
    if (this.reshaping !== null) return false;
    const object = this.editorObject(id);
    if (object === null) return false;
    if (!this.inWorkspace(object)) {
      this.ctx.notify({ severity: 'warning', message: `${notInWorkspaceHint(this.workspace())}.` });
      return false;
    }
    if (this.refuseLocked(object)) return false;
    if (how === 'append') {
      if (!isAppendable(object.geometry)) {
        this.ctx.notify({ severity: 'info', message: 'Points can only be appended to a line.' });
        return false;
      }
    } else if (!isReshapable(object.geometry)) {
      this.ctx.notify({ severity: 'info', message: 'The map view cannot reshape this kind of geometry. Its properties can be edited.' });
      return false;
    }
    // The editing service ends a running drawing, so the tool goes off first.
    this.endTool();
    this.tool = null;
    const run = new AbortController();
    this.reshapeRun = run;
    this.reshaping = id;
    this.appending = how === 'append';
    this.refresh();
    const options = { ...(object.style === undefined ? {} : { style: object.style }), signal: run.signal };
    let geometry: Geometry | null | undefined;
    try {
      geometry = how === 'append' ? await this.map.append(id, options) : await this.map.edit(id, options);
    } catch (error) {
      if (error instanceof NotOnMapError) {
        this.ctx.notify({ severity: 'warning', message: `The map does not show this shape. Use "Show on map" first, then ${how} it.` });
      } else if (error instanceof NotALineError) {
        this.ctx.notify({ severity: 'info', message: 'Points can only be appended to a line.' });
      } else {
        this.unexpected(error);
      }
      return false;
    } finally {
      if (this.reshapeRun === run) this.reshapeRun = null;
      this.reshaping = null;
      this.appending = false;
      this.refresh();
      // A result, a refusal, an error or the plugin's own abort arms the drag again; null (Escape, or another plugin's interaction replaced the reshape) does not.
      if (geometry !== null || run.signal.aborted) this.drag.rearm();
    }
    if (geometry === null) return false; // Escape: nothing is sent
    if (geometry.type !== object.geometry.type) {
      this.ctx.notify({ severity: 'error', message: `The map view returned ${withArticle(geometry.type)} for ${withArticle(object.geometry.type)}. The shape was not changed.` });
      return false;
    }
    const cleaned = cleanGeometry(geometry);
    if (cleaned === null) {
      this.ctx.notify({ severity: 'warning', message: 'The new shape is outside the valid coordinates, so it was not changed.' });
      return false;
    }
    return this.update(id, how === 'append' ? 'append to the line' : 'reshape the shape', (core) => withGeometry(core, cleaned));
  }

  /** Centres the map on a shape that is not in view, so that it can be reshaped. */
  async showOnMap(id: Uuid): Promise<void> {
    try {
      const { missing } = await this.map.centreOn([id]);
      if (missing.includes(id)) this.ctx.notify({ severity: 'warning', message: 'The map cannot show this shape.' });
    } catch (error) {
      this.unexpected(error);
    }
  }

  // ---- the workspace (functions 10 to 13) ----

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

  /** The layers of the workspace shown: the only ones the plugin lists, draws into and edits in (rules 5 and 6). */
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

  /** The layer of the object, when it is locked (SDK 1.3.0, function 17): the store refuses every user's change to its content. */
  private lockOf(object: MapObject): Layer | null {
    const layer = this.layerById(object.layerId);
    return layer?.locked === true ? layer : null;
  }

  /** Tells the user that the shape's layer is locked and returns true; nothing is sent for such a shape. */
  private lockNoticeOf(object: MapObject): string | null {
    const layer = this.lockOf(object);
    return layer === null ? null : lockedLayerNotice(layer);
  }

  private refuseLocked(object: MapObject): boolean {
    const layer = this.lockOf(object);
    if (layer === null) return false;
    this.ctx.notify({ severity: 'warning', message: `${lockedLayerNotice(layer)}.` });
    return true;
  }

  /**
   * The last step of a switch (function 13). The map view has ended the running interactions and
   * cleared the selection at its moment, and the fresh snapshots are in. What belongs to the old
   * workspace ends: the edit panel and its subscription, a reshape. A tool that was on draws in the
   * new workspace if the user may draw into it, else it goes off.
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
    if (this.tool !== null) {
      const kind = this.tool;
      this.endTool();
      if (this.build().canDraw) this.startTool(kind);
      else {
        this.tool = null;
        this.pendingTool = { kind, at: Date.now() };
      }
    }
    this.drag.rearm();
    this.refresh();
  }

  /** The active layer came a moment after the switch's last step: the tool that was on starts then, if the user may draw into it. */
  private startPendingTool(): void {
    const pending = this.pendingTool;
    if (pending === null) return;
    this.pendingTool = null;
    if (this.tool !== null || Date.now() - pending.at > PENDING_TOOL_MS || !this.current.canDraw) return;
    this.tool = pending.kind;
    this.refresh();
    this.startTool(pending.kind);
  }

  // ---- the drag ----

  /** The shape the panel is open for, or the selected shape: the ones followed by the fixed-area subscription. */
  private tracks(id: Uuid): boolean {
    return this.editId === id || this.selectedId === id;
  }

  /**
   * The shape whose drag is armed now, or null (brief, function 16): exactly one object is selected,
   * it proved to be a `core.shape` (only those are followed), the user may edit in the workspace shown (`canEdit`), the shape's layer
   * is one of the workspace's layers and is not locked (function 17), and the shape is in the map's view. While one of the plugin's own interactions runs (a tool, a
   * reshape) the drag waits (`busy`).
   */
  private armable(): Uuid | null {
    const id = this.selectedId;
    if (id === null || !this.canEdit) return null;
    const object = this.editorObject(id);
    if (object === null || this.outsideView(object) || !this.inWorkspace(object) || this.lockOf(object) !== null) return null;
    return id;
  }

  /**
   * A drop: moves the shape by the difference between the drop and its first position, after the
   * updates still under way, from its newest state. Nothing is sent if the selection changed while it waited.
   */
  private dropShape(id: Uuid, drop: Position): void {
    const epoch = this.selectionEpoch;
    this.guard(
      this.update(id, 'move the shape', (core) => {
        if (epoch !== this.selectionEpoch) return core;
        const moved = moveGeometry(core.geometry, drop);
        return moved === null ? core : withGeometry(core, moved);
      }),
    );
  }

  // ---- state ----

  /** The newest state of the shape the panel is open for: the live copy of its subscription, or the one read by id, whichever is newer. */
  private editorObject(id: Uuid): MapObject | null {
    const live = this.watch.id === id ? this.watch.object : undefined;
    const read = this.fetched.get(id);
    if (live !== undefined && (read === undefined || live.version >= read.version)) return live;
    return read ?? null;
  }

  /** The shape is outside the map's view: none of its points is inside `viewport.visibleArea` (brief, function 7). */
  private outsideView(object: MapObject): boolean {
    const { center, visibleArea } = this.map.viewport;
    return !isInView(object.geometry, { centre: center, ring: visibleArea });
  }

  private build(): ShapesState {
    const workspace = this.workspace();
    const layers = this.workspaceLayers();
    const active = this.map.activeLayer.value;
    const activeLayer = active !== null && layers.some((l) => l.id === active) ? active : null;
    const activeLocked = layers.find((l) => l.id === activeLayer && l.locked === true);
    const lockedTitle = this.canEdit && activeLocked !== undefined ? lockedActiveTitle(activeLocked) : null;
    let hint: string | null = null;
    if (!this.canEdit) hint = readOnlyHint(workspace);
    else if (activeLayer === null) hint = NO_LAYER_HINT;
    const id = this.editId;
    const shown = id === null ? null : this.editorObject(id);
    const editor: EditorState | null =
      id === null
        ? null
        : {
            id,
            object: shown,
            notInView: shown !== null && this.outsideView(shown),
            loading: this.loading,
            error: this.loadError,
            pending: this.pendingCount.has(id),
            reshaping: this.reshaping === id && !this.appending,
            appending: this.reshaping === id && this.appending,
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
      style: this.style,
      name: this.name,
      settings: this.settings,
      dataTypes: this.dataTypes,
      dataType: this.effectiveDataType(),
      editor,
    };
  }

  /** The kept choice if users may choose that data type (function 18), else the setting if they may, else `core.general`. */
  private effectiveDataType(): string {
    const choosable = choosableDataTypes(this.dataTypes);
    const available = (id: string | null): id is string => id !== null && choosable.some((t) => t.id === id);
    if (available(this.kept)) return this.kept;
    if (available(this.settings.dataType)) return this.settings.dataType;
    return GENERAL_DATA_TYPE;
  }

  /** Recomputes the state after any change, switches the tool off if drawing became impossible, and tells the listeners. */
  private refresh(): void {
    let state = this.build();
    let toolEnded = false;
    if (this.tool !== null && !state.canDraw && !this.switching) {
      this.tool = null;
      this.endTool();
      toolEnded = true; // drawing became impossible (the layer is gone): the plugin's own event
      state = this.build();
    }
    // A reshape of a shape whose layer was locked meanwhile ends, and sends nothing (function 17).
    const reshaped = this.reshaping === null ? null : this.editorObject(this.reshaping);
    if (reshaped !== null && this.lockOf(reshaped) !== null) this.endReshape();
    this.current = state;
    if (toolEnded) this.drag.rearm();
    else this.drag.sync();
    for (const listener of [...this.listeners]) listener();
  }

  // ---- change requests ----

  /** Turns a drawn geometry into a create request (brief, function 2). */
  private async createShape(kind: ShapeKind, drawn: Geometry): Promise<boolean> {
    if (!this.canEdit) return this.refuseReadOnly();
    const layerId = this.current.activeLayer;
    if (layerId === null) {
      this.ctx.notify({ severity: 'warning', message: `Cannot create the shape: ${NO_LAYER_HINT.toLowerCase()}.` });
      return false;
    }
    if (this.current.lockedTitle !== null) {
      // The layer was locked while the user drew; the tool goes off with the next refresh. Nothing is sent (function 17).
      this.ctx.notify({ severity: 'warning', message: `Cannot create the shape. ${this.current.lockedTitle}.` });
      return false;
    }
    if (drawn.type !== geometryTypeOf(kind)) {
      this.ctx.notify({ severity: 'error', message: `The map view returned ${withArticle(drawn.type)} for ${withArticle(KIND_LABELS[kind].toLowerCase())}. Nothing was created.` });
      return false;
    }
    const geometry = cleanGeometry(drawn);
    if (geometry === null) {
      this.ctx.notify({ severity: 'warning', message: 'The drawn shape is outside the valid coordinates, so it was not created.' });
      return false;
    }
    const usedName = this.name;
    const content = newShapeContent({
      kind,
      geometry,
      style: styleFor(this.style, kind),
      name: usedName,
      layerId,
      dataType: this.current.dataType,
      label: this.ctx.defaultLabel,
    });
    const created = await this.create(content);
    if (created && this.name === usedName && usedName !== '') {
      this.name = ''; // the next shape gets its own name
      this.refresh();
    }
    return created;
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
      return this.report(sent, 'create the shape', null);
    } catch (error) {
      this.unexpected(error);
      return false;
    } finally {
      this.waiting--;
    }
  }

  /**
   * Runs `task` after the earlier tasks for the same shape, so that each one starts from the
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
   * The newest state of a shape before a commit (brief, function 7): the subscription's live copy
   * if the shape is in the map's view, else read by id again, so that the update is based on the
   * newest version. A shape the subscription does not hold is read by id too.
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
        this.ctx.notify({ severity: 'error', message: `Could not read the shape from the server: ${error.message}` });
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
   * state at once (the shape's copy, and its subscription, which follows it if it moved far).
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

  /** Defence in depth: the tools and the panel are off without `objects.edit`, and the server checks anyway. */
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
}
