// The route editor's model (brief functions 4 to 9 and 22; the owner's Q10, Q13 and A35 to A47).
// It draws new routes, reshapes them and, from M7, appends to them (function 49) with the map
// view's drawing and editing service, inserts and deletes points itself (the map view's editing
// does neither), and saves every value the user commits at once, with a change request built from the newest route object. A change of the line
// on a route with objects waits for the move-or-disconnect question (Q10, A40).
import { changeRequests, MANUAL_DATA_SOURCE, NotOnMapError, OutcomeUnknownError, parseFieldNumber } from '@emc2/plugin-sdk';
import type { LineString, MapObject, MapObjectContent, MapView, Overlay, PanelHandle, PluginContext, Style, Unsubscribe, Uuid } from '@emc2/plugin-sdk';
import {
  appendPoints, copiedEntry, deletePoint, extensionOf, insertPoint, isJson, lineOf, listedObjects, MAX_ALTITUDE, MAX_POINTS, MAX_SECONDS, MAX_SPEED, MIN_ALTITUDE, MIN_POINTS,
  newRouteExtension, parseTime, pointEntries, pointValues, withEditChoice, without, withPoint,
} from './definition.ts';
import type { From, Json, Kind } from './definition.ts';
import { Model, READ_EVERY_MS, Watched } from './model.ts';
import type { Failure } from './model.ts';
import { PLUGIN_ID, ROUTE_TYPE, SIMULATION } from './picture.ts';
import type { SimulationPicture } from './picture.ts';
import { contentOf, parseRoute, rejectionMessage } from './routes.ts';
import type { RouteInfo } from './routes.ts';
import { lockedHint } from './permissions.ts';
import type { SimulatorServer } from './server.ts';
import { ALTITUDE_LABELS, lengthIn, lengthToMetres, SPEED_LABELS, speedIn, speedToMps } from './units.ts';
import type { UnitsModel } from './unitsModel.ts';

/** A new route's look (A36): a dashed line with circle markers at its points (brief function 4). */
export const DEFAULT_ROUTE_COLOUR = '#1f3a93';
export const ROUTE_STYLE: Style = { strokeColor: DEFAULT_ROUTE_COLOUR, strokeWidth: 2, strokeDash: 'dash', pointMarkers: 'circle' };

/** The point shown in the editor, highlighted on the map (T-088, A59): a contrasting ring. */
export const HIGHLIGHT_STYLE: Style = { strokeColor: '#ff8c00', strokeWidth: 3, fillColor: '#ff8c00', fillOpacity: 0.3 };

export const NO_SIMULATION_LAYER = 'Choose a Simulation layer in the layer panel';
export const NO_MAP = 'No map view';
/** SDK 1.6.0 part B: `MapView.append` is optional until `map-view-2d` provides it (its function 44). */

export type Interaction = 'draw' | 'reshape' | 'append' | 'pick';

export interface EditorState {
  readonly open: boolean;
  /** The route shown; null while a new one is drawn. */
  readonly routeId: Uuid | null;
  /** The route shown was deleted or is no longer a route, so nothing more will come for it. */
  readonly gone: boolean;
  /** The server part's values for the route (`GET /routes/{id}`), shown when `version` is the version shown (function 6). */
  readonly computed: RouteInfo | null;
  readonly readError: string | null;
  readonly interaction: Interaction | null;
  /** A line change waiting for the move-or-disconnect answer (Q10), described for the question. */
  readonly pendingLine: string | null;
  readonly busy: boolean;
  readonly failure: Failure | null;
  /** The map's active layer, which "New route" draws into (A36). */
  readonly activeLayer: Uuid | null;
  /** Raised by every change the server did not apply, so that a value box stops showing an unsaved value as saved. */
  readonly rejections: number;
  /** The point shown in the one-point pane (T-088, A58), 0-based; `shownPoint` keeps it within the route. */
  readonly point: number;
}

/** What "All points" sets (T-088, Q16): null kinds and empty texts leave the points' values alone. */
export interface AllPointsInput {
  readonly speedKind: Kind | null;
  readonly speed: string;
  readonly altitudeKind: Kind | null;
  readonly altitude: string;
}

/** A change of the line: what it does to the newest line and extension. */
interface LineChange {
  readonly label: string;
  readonly apply: (line: LineString, ext: Json) => { readonly line: LineString; readonly ext: Json } | string;
  /** The point the one-point pane shows once the change is applied (A58). */
  readonly showPoint: number;
}

/** "Route N", one more than the highest number among the routes (brief function 4). */
export function nextRouteName(names: readonly string[]): string {
  let highest = 0;
  for (const name of names) {
    const m = /^Route (\d+)$/.exec(name.trim());
    if (m !== null) highest = Math.max(highest, Number(m[1]));
  }
  return `Route ${String(highest + 1)}`;
}

export class RouteEditorModel extends Model<EditorState> {
  private map: MapView | null = null;
  private overlay: Overlay | null = null;
  /** The highlighted position as set, so that a tick of a running simulation sets nothing (A59). */
  private highlighted = '';
  private handle: PanelHandle | null = null;
  /** Ends the running interaction (CR-0020, CR-0025 part 1; A42). */
  private tool: AbortController | null = null;
  /** The layer the running interaction draws into or edits in, so that its lock ends it (A80). */
  private interactionLayer: Uuid | null = null;
  private pending: LineChange | null = null;
  private readonly watched: Watched;
  private readonly cleanup: Unsubscribe[] = [];
  /** Updates go one after another, each built from the state the previous one left (the review of C2). */
  private chain: Promise<unknown> = Promise.resolve();
  /** The route as the last applied update left it, until the live picture has caught up. */
  private applied: MapObject | null = null;

  constructor(
    private readonly ctx: PluginContext,
    private readonly server: SimulatorServer,
    private readonly picture: SimulationPicture,
    private readonly units: UnitsModel,
    /** Adds the editor panel and returns its handle; called each time it opens (it is removed when it closes). */
    private readonly addPanel: () => PanelHandle,
    /** The colour a new route gets (T-088, A62). */
    private readonly routeColour: () => string = () => DEFAULT_ROUTE_COLOUR,
    intervalMs = READ_EVERY_MS,
  ) {
    super({ open: false, routeId: null, gone: false, computed: null, readError: null, interaction: null, pendingLine: null, busy: false, failure: null, activeLayer: null, rejections: 0, point: 0 });
    this.watched = new Watched(() => this.read(), intervalMs);
    this.cleanup.push(
      picture.onChange(() => {
        this.endIfLocked();
        const id = this.getState().routeId;
        if (id === null) return;
        const live = this.liveRoute(id);
        const gone = this.getState().gone;
        // Once per loss: a running simulation changes the picture every tick, and a dismissed
        // notice must stay dismissed. A route that becomes a route again is shown again.
        if (picture.ready && live === undefined && this.everSeen.has(id) && !gone) this.routeGone(id);
        if (live !== undefined) {
          this.everSeen.add(id);
          if (gone) this.update({ gone: false, failure: null });
        }
        this.highlight();
      }),
      this.subscribe(() => {
        this.highlight();
      }),
    );
    this.cleanup.push(ctx.workspace.onChange(() => {
      this.endInteraction();
      this.highlight();
    }));
  }

  /** Routes this editor has seen in the picture, so that one still being created is not taken for deleted. */
  private readonly everSeen = new Set<Uuid>();

  setMap(map: MapView): void {
    this.map = map;
    this.overlay = map.createOverlay();
    this.update({ activeLayer: map.activeLayer.value });
    this.cleanup.push(map.activeLayer.onChange((activeLayer) => {
      this.update({ activeLayer });
    }));
  }

  get hasMap(): boolean {
    return this.map !== null;
  }

  /** For the panel's effect: reads `GET /routes/{id}` while it is mounted (A45). */
  readonly watch = (): (() => void) => this.watched.watch();

  /** The route shown, newest state. */
  route(): MapObject | undefined {
    const id = this.getState().routeId;
    if (id === null) return undefined;
    const live = this.liveRoute(id);
    const applied = this.applied?.id === id ? this.applied : null;
    if (live === undefined) return this.everSeen.has(id) ? undefined : (applied ?? undefined);
    return applied !== null && applied.version > live.version ? applied : live;
  }

  /** Opens the editor for a route (A35); one route at a time. */
  open(routeId: Uuid): void {
    if (this.getState().routeId !== routeId) {
      this.endInteraction();
      this.pending = null;
      this.update({ routeId, gone: false, computed: null, readError: null, pendingLine: null, failure: null, point: 0 });
    }
    if (this.liveRoute(routeId) !== undefined) this.everSeen.add(routeId);
    this.show();
    this.watched.readNow();
  }

  close(): void {
    this.endInteraction();
    this.pending = null;
    this.handle?.remove();
    this.handle = null;
    this.update({ open: false, routeId: null, gone: false, computed: null, readError: null, pendingLine: null, failure: null, busy: false, point: 0 });
  }

  /** The point the one-point pane shows (A58): the chosen one, within the route's points. */
  shownPoint(): number {
    return Math.max(0, Math.min(this.getState().point, this.pointCount() - 1));
  }

  /** The up and down buttons (A58): `step` -1 or +1, round from the last point to the first and back. */
  stepPoint(step: number): void {
    const count = this.pointCount();
    if (count === 0) return;
    this.update({ point: (((this.shownPoint() + step) % count) + count) % count });
  }

  private pointCount(): number {
    const route = this.route();
    return route === undefined ? 0 : (lineOf(route)?.coordinates.length ?? 0);
  }

  dismissFailure(): void {
    this.update({ failure: null });
  }

  /** Why "New route" cannot start, or null (A36; a locked layer, function 25, A79). */
  newRouteProblem(): string | null {
    if (this.map === null) return NO_MAP;
    const layer = this.map.activeLayer.value;
    if (layer === null || !this.picture.isSimulationLayer(layer)) return NO_SIMULATION_LAYER;
    const locked = this.picture.lockedLayer(layer);
    return locked === null ? null : `The active layer "${locked.name}" is locked`;
  }

  /** Why the route shown is read only for everyone, or null: its layer is locked (function 25, A81). */
  lockHint(): string | null {
    const route = this.route();
    const locked = route === undefined ? null : this.picture.lockedLayer(route.layerId);
    return locked === null ? null : lockedHint(locked.name);
  }

  /** A drawing, reshape or pick whose layer became locked is ended with its signal, and sends nothing (A80). */
  private endIfLocked(): void {
    const layer = this.interactionLayer;
    if (this.getState().interaction === null || layer === null) return;
    const locked = this.picture.lockedLayer(layer);
    if (locked === null) return;
    this.endInteraction();
    this.update({ failure: { message: lockedHint(locked.name), retry: null } });
  }

  /** "New route": draws a line into the active Simulation layer and creates the route (A36). */
  async newRoute(): Promise<void> {
    const map = this.map;
    const problem = this.newRouteProblem();
    if (map === null || problem !== null) {
      this.update({ failure: { message: problem ?? NO_MAP, retry: null } });
      return;
    }
    const layerId = map.activeLayer.value;
    if (layerId === null) return;
    const before = this.getState().routeId;
    this.endInteraction();
    this.pending = null;
    this.update({ routeId: null, gone: false, computed: null, pendingLine: null, failure: null, point: 0 });
    this.show();
    const style: Style = { ...ROUTE_STYLE, strokeColor: this.routeColour() };
    const signal = this.startInteraction('draw', layerId);
    const geometry = await this.interact(signal, () => map.draw('line', { style, signal }));
    if (geometry === undefined) return;
    if (geometry === null) {
      // Cancelled: back to the route that was open, if any.
      if (before === null) this.close();
      else this.open(before);
      return;
    }
    if (geometry.type !== 'LineString' || geometry.coordinates.length < MIN_POINTS) {
      this.update({ failure: { message: 'A route needs at least two points', retry: null } });
      return;
    }
    if (geometry.coordinates.length > MAX_POINTS) {
      this.update({ failure: { message: `A route has at most ${String(MAX_POINTS)} points`, retry: null } });
      return;
    }
    const id = this.ctx.newId();
    const content: MapObjectContent = {
      type: 'core.shape',
      dataType: ROUTE_TYPE,
      dataSource: MANUAL_DATA_SOURCE,
      layerId,
      geometry,
      style,
      properties: { name: nextRouteName(this.picture.routes().map((r) => r.name)) },
      label: this.ctx.defaultLabel,
      extensions: { [PLUGIN_ID]: newRouteExtension(geometry.coordinates.length) },
    };
    if (await this.send(changeRequests.createObject(id, content))) this.open(id);
  }

  /** "Reshape": the map view's editing service moves the line or its points (brief function 4). */
  async reshape(): Promise<void> {
    const map = this.map;
    const route = this.route();
    if (map === null || route === undefined) return;
    const signal = this.startInteraction('reshape', route.layerId);
    const geometry = await this.interact(signal, () => map.edit(route.id, { signal }));
    if (geometry === undefined || geometry === null) return;
    if (geometry.type !== 'LineString') {
      this.update({ failure: { message: 'The reshaped route is no longer a line', retry: null } });
      return;
    }
    const reshaped = geometry;
    this.lineChange({
      label: 'The route was reshaped.',
      showPoint: this.shownPoint(),
      apply: (line, ext) =>
        reshaped.coordinates.length === line.coordinates.length
          ? { line: reshaped, ext }
          : 'The route changed its points meanwhile; reshape it again',
    });
  }

  /** Why "Append" cannot start for anyone (function 49): no map view; null when it can (`append` is required since the 1.6.0 freeze). */
  appendProblem(): string | null {
    return this.map === null ? NO_MAP : null;
  }

  /**
   * "Append" (function 49, T-176; SDK 1.6.0 part B): the map view continues the route from its last
   * point, click by click. The new points copy the last point's entry, as "Insert point after" does
   * (its speed or, with only a time, the computed speed, and its altitude; no time, no events), so
   * the route stays valid; one update is sent, after the move-or-disconnect question when objects
   * are on the route (function 9, Q10).
   */
  async append(): Promise<void> {
    const map = this.map;
    const route = this.route();
    const line = route === undefined ? null : lineOf(route);
    if (map === null || route === undefined || line === null) return;
    const continueLine = map.append.bind(map);
    const signal = this.startInteraction('append', route.layerId);
    const style = route.style;
    const appended = await this.interact(signal, () => continueLine(route.id, { ...(style === undefined ? {} : { style }), signal }));
    if (appended === undefined || appended === null) return;
    const count = line.coordinates.length;
    const added = appended.coordinates.slice(count);
    if (added.length === 0) return;
    if (count + added.length > MAX_POINTS) {
      this.update({ failure: { message: `A route has at most ${String(MAX_POINTS)} points`, retry: null } });
      return;
    }
    const computed = this.getState().computed;
    const speed = computed !== null && computed.version === route.version ? (computed.points[count - 1]?.speed ?? null) : null;
    this.lineChange({
      label: added.length === 1 ? 'A point was added at the end.' : `${String(added.length)} points were added at the end.`,
      showPoint: count + added.length - 1,
      apply: (newest, ext) => (newest.coordinates.length === count ? appendPoints(newest, ext, added, speed) : 'The route changed its points meanwhile; append again'),
    });
  }

  /** "Insert point after" (Q13): the user clicks the place on the map; the new point copies point `i`'s values. */
  async insertAfter(i: number): Promise<void> {
    const map = this.map;
    const route = this.route();
    const line = route === undefined ? null : lineOf(route);
    if (map === null || route === undefined || line === null) return;
    if (line.coordinates.length >= MAX_POINTS) {
      this.update({ failure: { message: `A route has at most ${String(MAX_POINTS)} points`, retry: null } });
      return;
    }
    const signal = this.startInteraction('pick', route.layerId);
    const at = await this.interact(signal, () => map.pickPoint({ signal }));
    if (at === undefined || at === null) return;
    const count = line.coordinates.length;
    // A point with only a typed time has no speed to copy: the server part's computed one is used (the review of C2).
    const computed = this.getState().computed;
    const speed = computed !== null && computed.version === route.version ? (computed.points[i]?.speed ?? null) : null;
    this.lineChange({
      label: i === count - 1 ? 'A point was added at the end.' : `A point was inserted after point ${String(i + 1)}.`,
      showPoint: i + 1,
      apply: (newest, ext) => (newest.coordinates.length === count ? insertPoint(newest, ext, i, at, speed) : 'The route changed its points meanwhile; insert it again'),
    });
  }

  /** "Delete point" (A41): never below two points; its events go with it. */
  deletePoint(i: number): void {
    const route = this.route();
    const line = route === undefined ? null : lineOf(route);
    if (line === null) return;
    if (line.coordinates.length <= MIN_POINTS) {
      this.update({ failure: { message: 'A route needs at least two points', retry: null } });
      return;
    }
    const count = line.coordinates.length;
    this.lineChange({
      label: `Point ${String(i + 1)} was deleted.`,
      showPoint: Math.min(i, count - 2),
      apply: (newest, ext) => (newest.coordinates.length === count ? deletePoint(newest, ext, i) : 'The route changed its points meanwhile; delete it again'),
    });
  }

  /** The answer to the move-or-disconnect question (Q10, A40); null undoes the change. */
  answer(objects: 'move' | 'disconnect' | null): void {
    const change = this.pending;
    this.pending = null;
    this.update({ pendingLine: null });
    if (change === null || objects === null) return;
    void this.applyLine(change, objects);
  }

  // ---------------------------------------------------------------- values (value edits never ask, Q10)

  /** The route's name (A47); returns why it cannot be saved, or null. */
  setName(text: string): string | null {
    const name = text.trim();
    if (name === '') return 'A route needs a name';
    if (name.length > 256) return 'A name has at most 256 characters';
    void this.valueEdit((route) => ({ ...contentOf(route), properties: { ...route.properties, name } }));
    return null;
  }

  setEnd(end: 'stop' | 'restart'): void {
    void this.valueEdit((route) => withExtension(route, { ...extensionOf(route), end }));
  }

  /** A typed speed in the user's unit; empty removes it. Typing a speed removes the point's time (A38). */
  setSpeed(i: number, text: string): string | null {
    const mps = this.parseSpeed(text);
    if (typeof mps === 'string') return mps;
    this.pointEdit(i, (entry) => (mps === null ? without(entry, 'speed') : { ...without(entry, 'time'), speed: mps }));
    return null;
  }

  /** A typed time; empty removes it. At a ramp point it replaces the speed; at a step point the speed stays (Q2, A38). */
  setTime(i: number, text: string): string | null {
    const seconds = parseTime(text);
    if (seconds !== null && !Number.isFinite(seconds)) return 'Type a time as h:mm:ss, m:ss or seconds';
    if (seconds !== null && seconds > MAX_SECONDS) return 'A time is at most 7 days';
    const unit = this.units.getState().speed;
    this.pointEdit(i, (entry) => {
      if (seconds === null) return without(entry, 'time');
      const v = pointValues(entry);
      const timed = { ...entry, time: { seconds, from: v.time?.from ?? 'previous', unit } };
      return v.speedKind === 'ramp' ? without(timed, 'speed') : timed;
    });
    return null;
  }

  /** What a typed time counts from. */
  setFrom(i: number, from: From): void {
    this.pointEdit(i, (entry) => {
      const time = entry['time'];
      return isJson(time) ? { ...entry, time: { ...time, from } } : entry;
    });
  }

  setSpeedKind(i: number, kind: Kind): void {
    this.pointEdit(i, (entry) => ({ ...entry, speedKind: kind }));
  }

  setAltitudeKind(i: number, kind: Kind): void {
    this.pointEdit(i, (entry) => ({ ...entry, altitudeKind: kind }));
  }

  /** An altitude in the user's unit; empty keeps the object's own (open question 7, A39). */
  setAltitude(i: number, text: string): string | null {
    const metres = this.parseAltitude(text);
    if (typeof metres === 'string') return metres;
    this.pointEdit(i, (entry) => (metres === null ? without(entry, 'altitude') : { ...entry, altitude: metres }));
    return null;
  }

  /**
   * "Copy from previous point" (T-088, A61): what an inserted point copies (speed change, speed or
   * the computed one, altitude change, altitude), not the time or the events. A copied speed
   * removes the point's time, as a typed one does (A38).
   */
  copyFromPrevious(i: number): void {
    if (i < 1) return;
    const computed = this.getState().computed;
    const route = this.route();
    const speed = computed !== null && computed.version === route?.version ? (computed.points[i - 1]?.speed ?? null) : null;
    void this.valueEdit((newest) => {
      const line = lineOf(newest);
      if (line === null || i >= line.coordinates.length) return 'The point no longer exists';
      const ext = extensionOf(newest);
      const copied = copiedEntry(pointEntries(ext, line.coordinates.length)[i - 1], speed);
      return withExtension(newest, withPoint(ext, line.coordinates.length, i, (entry) => {
        const kept = ['speedKind', 'speed', 'altitudeKind', 'altitude'].reduce(without, entry);
        return { ...('speed' in copied ? without(kept, 'time') : kept), ...copied };
      }));
    });
  }

  /** Why "All points" cannot set `input`, or null (T-088, Q16): checked as for one point. */
  allPointsProblem(input: AllPointsInput): string | null {
    const change = this.allPointsChange(input);
    return typeof change === 'string' ? change : null;
  }

  /** "All points", after its confirmation (T-088, Q16, A60): one update that sets `input` on every point. */
  setAllPoints(input: AllPointsInput): string | null {
    const change = this.allPointsChange(input);
    if (typeof change === 'string') return change;
    void this.valueEdit((route) => {
      const line = lineOf(route);
      if (line === null) return 'The route is no longer a line';
      const ext = extensionOf(route);
      return withExtension(route, { ...ext, points: pointEntries(ext, line.coordinates.length).map(change) });
    });
    return null;
  }

  private allPointsChange(input: AllPointsInput): ((entry: Json) => Json) | string {
    const speed = this.parseSpeed(input.speed);
    if (typeof speed === 'string') return speed;
    const altitude = this.parseAltitude(input.altitude);
    if (typeof altitude === 'string') return altitude;
    if (input.speedKind === null && speed === null && input.altitudeKind === null && altitude === null) return 'Choose or type a value to set';
    return (entry) => {
      let next = entry;
      if (input.speedKind !== null) next = { ...next, speedKind: input.speedKind };
      if (speed !== null) next = { ...without(next, 'time'), speed };
      if (input.altitudeKind !== null) next = { ...next, altitudeKind: input.altitudeKind };
      if (altitude !== null) next = { ...next, altitude };
      return next;
    };
  }

  /** A speed typed in the user's unit, in m/s; null for empty, or why it is wrong. */
  private parseSpeed(text: string): number | null | string {
    const unit = this.units.getState().speed;
    const value = parseFieldNumber(text);
    if (value !== null && !Number.isFinite(value)) return 'Type a number';
    const mps = value === null ? null : speedToMps(value, unit);
    if (mps !== null && (mps < 0 || mps > MAX_SPEED)) return `A speed must be from 0 to ${formatLimit(speedIn(MAX_SPEED, unit))} ${SPEED_LABELS[unit]}`;
    return mps;
  }

  /** An altitude typed in the user's unit, in metres; null for empty, or why it is wrong. */
  private parseAltitude(text: string): number | null | string {
    const unit = this.units.getState().altitude;
    const value = parseFieldNumber(text);
    if (value !== null && !Number.isFinite(value)) return 'Type a number';
    const metres = value === null ? null : lengthToMetres(value, unit);
    if (metres !== null && (metres < MIN_ALTITUDE || metres > MAX_ALTITUDE)) {
      return `An altitude must be from ${formatLimit(lengthIn(MIN_ALTITUDE, unit))} to ${formatLimit(lengthIn(MAX_ALTITUDE, unit))} ${ALTITUDE_LABELS[unit]}`;
    }
    return metres;
  }

  /** Writes point `i`'s events as `events` (the Event panel's save, and Remove). */
  setEvents(i: number, change: (events: readonly Json[]) => readonly Json[]): Promise<boolean> {
    return this.pointEditAsync(i, (entry) => ({ ...entry, events: [...change(pointValues(entry).events)] }));
  }

  // ---------------------------------------------------------------- internals

  /**
   * The shown point on the map (A59), only while Simulation is shown: the map view keeps a
   * plugin's overlay in every workspace. Cleared when the editor closes or the route goes.
   */
  private highlight(): void {
    const overlay = this.overlay;
    if (overlay === null) return;
    const route = this.getState().open && this.ctx.workspace.current.id === SIMULATION ? this.route() : undefined;
    const at = route === undefined ? undefined : lineOf(route)?.coordinates[this.shownPoint()];
    const key = at === undefined ? '' : `${String(at[0])},${String(at[1])}`;
    if (key === this.highlighted) return;
    this.highlighted = key;
    if (at === undefined) overlay.clear();
    else overlay.set([{ kind: 'point', position: at, style: HIGHLIGHT_STYLE }]);
  }

  private show(): void {
    this.update({ open: true });
    // A panel added below others stays out of sight unless shown (part D, as draw-shapes does).
    this.handle ??= this.addPanel();
    this.handle.show();
  }

  private startInteraction(interaction: Interaction, layer: Uuid): AbortSignal {
    this.endInteraction();
    this.tool = new AbortController();
    this.interactionLayer = layer;
    this.update({ interaction, failure: null });
    return this.tool.signal;
  }

  /** Ends a running drawing, reshaping or pick (A42): the map view resolves it with null. */
  private endInteraction(): void {
    this.tool?.abort();
    this.tool = null;
    this.interactionLayer = null;
    if (this.getState().interaction !== null) this.update({ interaction: null });
  }

  /**
   * Runs a map interaction; undefined when it was ended by an abort (A42). An error the map view
   * raises is shown, never thrown (the review of C2).
   */
  private async interact<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T | undefined> {
    let result: T;
    try {
      result = await run();
    } catch (e) {
      if (signal.aborted) return undefined;
      const message = e instanceof NotOnMapError ? 'The route is not drawn on the map here; zoom to it first' : `The map could not do it: ${String(e)}`;
      this.update({ interaction: null, failure: { message, retry: null } });
      return undefined;
    }
    if (signal.aborted) return undefined;
    this.update({ interaction: null });
    return result;
  }

  /**
   * The route in the live picture, or undefined once it is deleted or no longer a route: another
   * plugin may change its data type, which counts as a deletion (brief function 9b; part D).
   */
  private liveRoute(id: Uuid): MapObject | undefined {
    const live = this.picture.object(id);
    return live?.type === 'core.shape' && live.dataType === ROUTE_TYPE && this.picture.isSimulationLayer(live.layerId) ? live : undefined;
  }

  private routeGone(id: Uuid): void {
    this.endInteraction();
    this.pending = null;
    const message = this.picture.object(id) === undefined ? 'The route was deleted' : 'This is no longer a route: its data type was changed';
    this.update({ gone: true, pendingLine: null, failure: { message, retry: null } });
  }

  private async read(): Promise<void> {
    const id = this.getState().routeId;
    // Only a route in the picture is read: a gone one would answer 404 once a second, each a
    // console error (part D).
    if (id === null || this.liveRoute(id) === undefined) return;
    const answer = await this.server.get(`routes/${encodeURIComponent(id)}`);
    if (this.getState().routeId !== id) return;
    if (!answer.ok) {
      if (answer.status === 403) this.watched.stop();
      this.update({ readError: answer.status === 404 ? null : answer.message, computed: null });
      return;
    }
    this.update({ computed: parseRoute(answer.body), readError: null });
  }

  private lineChange(change: LineChange): void {
    const route = this.route();
    if (route === undefined) return;
    if (listedObjects(extensionOf(route)).length === 0) {
      void this.applyLine(change, null);
      return;
    }
    this.pending = change;
    this.update({ pendingLine: change.label });
  }

  private async applyLine(change: LineChange, objects: 'move' | 'disconnect' | null): Promise<void> {
    const applied = await this.valueEdit((route) => {
      const line = lineOf(route);
      if (line === null) return 'The route is no longer a line';
      const result = change.apply(line, extensionOf(route));
      if (typeof result === 'string') return result;
      const ext = objects === null ? result.ext : withEditChoice(result.ext, objects);
      return { ...withExtension(route, ext), geometry: result.line };
    });
    if (applied) this.update({ point: change.showPoint });
  }

  private pointEdit(i: number, change: (entry: Json) => Json): void {
    void this.pointEditAsync(i, change);
  }

  private pointEditAsync(i: number, change: (entry: Json) => Json): Promise<boolean> {
    return this.valueEdit((route) => {
      const line = lineOf(route);
      if (line === null || i >= line.coordinates.length) return 'The point no longer exists';
      return withExtension(route, withPoint(extensionOf(route), line.coordinates.length, i, change));
    });
  }

  /** An update of the route from its newest state, after the updates before it; resolves whether it was applied. */
  private valueEdit(build: (route: MapObject) => MapObjectContent | string): Promise<boolean> {
    const next = this.chain.then(() => this.buildAndSend(build));
    this.chain = next;
    return next;
  }

  private async buildAndSend(build: (route: MapObject) => MapObjectContent | string): Promise<boolean> {
    const route = this.route();
    if (route === undefined) {
      this.update({ failure: { message: 'The route no longer exists', retry: null } });
      return false;
    }
    const content = build(route);
    if (typeof content === 'string') {
      this.update({ rejections: this.getState().rejections + 1, failure: { message: content, retry: null } });
      return false;
    }
    return this.send(changeRequests.updateObject(route, content));
  }

  private async send(request: Parameters<PluginContext['changes']['submit']>[0]): Promise<boolean> {
    this.update({ busy: true, failure: null });
    try {
      const outcome = await this.ctx.changes.submit(request);
      if (outcome.outcome === 'applied') {
        const state = outcome.event.state;
        if (state !== null && 'geometry' in state) this.applied = state;
        this.update({ busy: false });
        this.watched.readNow();
        return true;
      }
      this.update({ busy: false, rejections: this.getState().rejections + 1, failure: { message: rejectionMessage(outcome.rejection.code, outcome.rejection.message), retry: null } });
    } catch (e) {
      const message = e instanceof OutcomeUnknownError ? 'No answer from the server; the change may have been made' : `The change failed: ${String(e)}`;
      this.update({ busy: false, rejections: this.getState().rejections + 1, failure: { message, retry: null } });
    }
    return false;
  }
}

function withExtension(route: MapObject, ext: Json): MapObjectContent {
  return { ...contentOf(route), extensions: { ...route.extensions, [PLUGIN_ID]: ext } };
}

/** A limit in the user's unit, without needless decimals. */
function formatLimit(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/** The point entries of a route, for the panel. */
export function entriesOf(route: MapObject): Json[] {
  const line = lineOf(route);
  return line === null ? [] : pointEntries(extensionOf(route), line.coordinates.length);
}
