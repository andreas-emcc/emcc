// The terrain tools' state and the work behind the panel. It lives outside React, so the results
// and the overlay survive the panel being unmounted (moved to another pane, another workspace).
import { overlayProblem, type DrawnGeometry, type MapView, type Overlay, type OverlayItem, type Position, type Style } from '@emc2/plugin-sdk';
import { getHeightStatus, postHeightMap, postRange, postViewshed, TerrainError, type HeightMapResult, type HeightStatus, type RangeResult, type ViewshedResult } from './api.ts';
import { heightMapItems, heightMarkerItems, metresPerPixelAt, pendingItems, rangeItems, viewshedItems } from './overlay.ts';

/** The viewshed's fields as the user typed them. */
export interface ViewshedForm {
  readonly observerHeight: string;
  readonly targetHeight: string;
  readonly maxRange: string;
}

/** What the range tool is waiting for: nothing (off), the first point or the second. */
export type RangeTool = 'off' | 'first' | 'second';

export interface ShownViewshed {
  readonly observer: Position;
  readonly maxRange: number;
  readonly result: ViewshedResult;
}

export interface ShownHeightMap {
  readonly center: Position;
  readonly radius: number;
  readonly result: HeightMapResult;
}

export interface TerrainState {
  readonly rangeTool: RangeTool;
  /** The pair's first point while the second is awaited. */
  readonly rangePending: Position | null;
  readonly rangeFrom: Position | null;
  readonly rangeTo: Position | null;
  readonly range: RangeResult | null;
  readonly rangeBusy: boolean;
  readonly rangeError: string | null;
  readonly form: ViewshedForm;
  /** The observer's point is awaited. */
  readonly picking: boolean;
  readonly computing: boolean;
  readonly viewshed: ShownViewshed | null;
  readonly viewshedError: string | null;
  /** The circle of the height map is awaited: the user presses on the centre and drags to the radius. */
  readonly drawing: boolean;
  /** A height map is being computed. */
  readonly mapComputing: boolean;
  readonly heightMap: ShownHeightMap | null;
  readonly heightMapError: string | null;
  /** Why the map view would not draw the overlay, if it would not. */
  readonly overlayError: string | null;
  readonly heights: HeightStatus | null;
  /** The admin's longest range, from the settings. */
  readonly maxRange: number;
}

/** The limits the form checks, the brief's function 3; the range's upper limit is the admin's. */
export const HEIGHT_MIN = 0;
export const HEIGHT_MAX = 1000;
export const RANGE_MIN = 100;
export const DEFAULT_MAX_RANGE = 50_000;
/** The smallest circle of a height map, metres (the brief's function 10). */
export const RADIUS_MIN = 100;

/** The admin's longest range in kilometres as the field's message writes it: `50`, `12.5`. */
function kilometres(metres: number): string {
  return String(Math.round(metres / 10) / 100);
}

/** Why a circle of this radius is not asked for, in words for the user, or `null` when it is usable. */
export function radiusProblem(radius: number, maxRange: number): string | null {
  if (radius > maxRange) return `At most ${kilometres(maxRange)} km.`;
  if (radius < RADIUS_MIN) return `At least ${String(RADIUS_MIN)} m.`;
  return null;
}

/** A number typed in a field, or `null` when it is not a finite number. A comma is a decimal point. */
export function parseNumber(text: string): number | null {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** The reason each field is not usable, in words for the user; an empty object when all are. */
export function formProblems(form: ViewshedForm, maxRange: number): { observerHeight?: string; targetHeight?: string; maxRange?: string } {
  const problems: { observerHeight?: string; targetHeight?: string; maxRange?: string } = {};
  const observer = parseNumber(form.observerHeight);
  if (observer === null || observer < HEIGHT_MIN || observer > HEIGHT_MAX) problems.observerHeight = `A height from ${String(HEIGHT_MIN)} to ${String(HEIGHT_MAX)} m.`;
  const target = parseNumber(form.targetHeight);
  if (target === null || target < HEIGHT_MIN || target > HEIGHT_MAX) problems.targetHeight = `A height from ${String(HEIGHT_MIN)} to ${String(HEIGHT_MAX)} m.`;
  const range = parseNumber(form.maxRange);
  if (range === null || range < RANGE_MIN || range > maxRange) problems.maxRange = `A range from ${String(RANGE_MIN)} to ${String(maxRange)} m.`;
  return problems;
}

/** How the circle looks while the user draws it. */
const DRAW_STYLE: Style = { strokeColor: '#ffb000', strokeWidth: 1, fillOpacity: 0 };

function messageOf(error: unknown): string {
  if (error instanceof TerrainError) return error.message;
  return error instanceof Error ? error.message : 'Something went wrong.';
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export interface TerrainControllerOptions {
  readonly mapView: MapView;
  readonly overlay: Overlay;
  /** The height map's own overlay: the overlay's caps are per overlay, so the two tools' results do not share them. */
  readonly heightMapOverlay: Overlay;
  /** The cross and its label: their size is in pixels, so they are drawn again when the map is zoomed. */
  readonly heightMarkerOverlay: Overlay;
  readonly serverBase: string;
  readonly maxRange: number;
  readonly log: { warn(message: string, ...rest: unknown[]): void };
}

export class TerrainController {
  private readonly map: MapView;
  private readonly overlay: Overlay;
  private readonly mapOverlay: Overlay;
  private readonly markerOverlay: Overlay;
  /** The metres per pixel the cross was drawn for, and the end of the watch on the map's zoom while a height map is shown. */
  private markerScale: number | null = null;
  private unwatchViewport: (() => void) | null = null;
  private readonly serverBase: string;
  private readonly log: TerrainControllerOptions['log'];
  private readonly listeners = new Set<() => void>();
  private state: TerrainState;
  private rangeAbort: AbortController | null = null;
  private viewshedAbort: AbortController | null = null;
  private drawAbort: AbortController | null = null;
  /** Counts clears, so that an answer that comes after "Clear" is not shown. */
  private epoch = 0;

  constructor(options: TerrainControllerOptions) {
    this.map = options.mapView;
    this.overlay = options.overlay;
    this.mapOverlay = options.heightMapOverlay;
    this.markerOverlay = options.heightMarkerOverlay;
    this.serverBase = options.serverBase;
    this.log = options.log;
    this.state = {
      rangeTool: 'off',
      rangePending: null,
      rangeFrom: null,
      rangeTo: null,
      range: null,
      rangeBusy: false,
      rangeError: null,
      form: { observerHeight: '2', targetHeight: '2', maxRange: '10000' },
      picking: false,
      computing: false,
      viewshed: null,
      viewshedError: null,
      drawing: false,
      mapComputing: false,
      heightMap: null,
      heightMapError: null,
      overlayError: null,
      heights: null,
      maxRange: options.maxRange,
    };
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getState = (): TerrainState => this.state;

  private patch(changes: Partial<TerrainState>): void {
    this.state = { ...this.state, ...changes };
    for (const listener of [...this.listeners]) listener();
  }

  setForm(changes: Partial<ViewshedForm>): void {
    this.patch({ form: { ...this.state.form, ...changes } });
  }

  /** The admin changed the longest range. */
  setMaxRange(maxRange: number): void {
    this.patch({ maxRange });
  }

  /** Asks the server what its index of height data says. */
  async refreshStatus(): Promise<void> {
    try {
      this.patch({ heights: await getHeightStatus(this.serverBase) });
    } catch (error) {
      if (!isAbort(error)) this.log.warn('the status of the height data could not be read', error);
    }
  }

  // ---------------------------------------------------------------- the overlay

  private showOverlay(): void {
    const items: OverlayItem[] = [];
    const { range, rangeFrom, rangeTo, rangePending, viewshed } = this.state;
    if (range !== null && rangeFrom !== null && rangeTo !== null) items.push(...rangeItems(rangeFrom, rangeTo, range));
    if (rangePending !== null) items.push(...pendingItems(rangePending));
    if (viewshed !== null) items.push(...viewshedItems(viewshed.observer, viewshed.maxRange, viewshed.result));
    const problem = overlayProblem(items);
    if (problem !== null) {
      // the server keeps its areas under the caps, so this is a bug or a changed SDK limit: say so, draw nothing
      this.log.warn(`the overlay would not be drawn: ${problem}`);
      this.overlay.clear();
      this.patch({ overlayError: `The map cannot show this result: ${problem}.` });
      return;
    }
    if (this.state.overlayError !== null) this.patch({ overlayError: null });
    if (items.length === 0) this.overlay.clear();
    else this.overlay.set(items);
  }

  /** The height map's own overlay: its bands and the circle, and above it the cross and its label in theirs. A problem is the height map's own message. */
  private showMapOverlay(): void {
    const shown = this.state.heightMap;
    if (shown === null) {
      this.mapOverlay.clear();
      this.clearMarker();
      return;
    }
    const items = heightMapItems(shown.center, shown.radius, shown.result);
    const problem = overlayProblem(items);
    if (problem !== null) {
      this.log.warn(`the height map would not be drawn: ${problem}`);
      this.mapOverlay.clear();
      this.clearMarker();
      this.patch({ heightMapError: `The map cannot show this result: ${problem}.` });
      return;
    }
    // The map view draws its overlays in the order in which they were first set (the SDK promises no order), a later
    // one above an earlier one. The cross and its label must be above the bands (owner, SN A, 2026-11-12), so the
    // cross's overlay is cleared, which takes it out of that order, and set again after the bands', whatever was
    // shown before: it comes last. A zoom sets it again later and keeps its place (drawMarker).
    this.markerOverlay.clear();
    this.mapOverlay.set(items);
    this.markerScale = null;
    this.drawMarker(true);
    this.unwatchViewport ??=this.map.onViewportChange(() => {
      this.drawMarker(false);
    });
  }

  /**
   * The cross and its label at the highest point, 16 pixels across at the map's present zoom. While the map is
   * zoomed it is drawn again, but only when the scale has changed by more than half a percent.
   */
  private drawMarker(force: boolean): void {
    const shown = this.state.heightMap;
    if (shown === null) return;
    const scale = metresPerPixelAt(this.map.viewport, shown.result.highestPosition);
    if (!Number.isFinite(scale) || scale <= 0) return;
    if (!force && this.markerScale !== null && Math.abs(scale / this.markerScale - 1) < 0.005) return;
    this.markerScale = scale;
    this.markerOverlay.set(heightMarkerItems(shown.result, scale));
  }

  private clearMarker(): void {
    this.unwatchViewport?.();
    this.unwatchViewport = null;
    this.markerScale = null;
    this.markerOverlay.clear();
  }

  // ---------------------------------------------------------------- range and bearing

  /** Turns the range tool on, or off when it is on. While on, every two points picked are a pair. */
  async toggleRange(): Promise<void> {
    if (this.rangeAbort !== null) {
      this.rangeAbort.abort();
      return;
    }
    this.endViewshedPick();
    this.drawAbort?.abort();
    const abort = new AbortController();
    this.rangeAbort = abort;
    this.patch({ rangeTool: 'first', rangeError: null });
    try {
      while (!abort.signal.aborted) {
        const first = await this.map.pickPoint({ signal: abort.signal });
        if (first === null) break;
        this.patch({ rangeTool: 'second', rangePending: first });
        this.showOverlay();
        const second = await this.map.pickPoint({ signal: abort.signal });
        if (second === null) break;
        await this.measure(first, second, abort.signal);
        this.patch({ rangeTool: 'first', rangePending: null });
      }
    } finally {
      if (this.rangeAbort === abort) this.rangeAbort = null;
      this.patch({ rangeTool: 'off', rangePending: null });
      this.showOverlay();
    }
  }

  private async measure(from: Position, to: Position, signal: AbortSignal): Promise<void> {
    const epoch = this.epoch;
    this.patch({ rangeBusy: true, rangeError: null });
    try {
      const range = await postRange(this.serverBase, from, to, signal);
      if (epoch === this.epoch) this.patch({ range, rangeFrom: from, rangeTo: to, rangePending: null });
    } catch (error) {
      if (!isAbort(error) && epoch === this.epoch) this.patch({ rangeError: messageOf(error) });
    } finally {
      this.patch({ rangeBusy: false });
    }
    if (epoch === this.epoch) this.showOverlay();
  }

  // ---------------------------------------------------------------- the viewshed

  private endViewshedPick(): void {
    this.viewshedAbort?.abort();
  }

  /** Lets the user pick the observer's point, then asks the server for the viewshed. */
  async startViewshed(): Promise<void> {
    if (this.state.computing || this.state.mapComputing) return;
    if (Object.keys(formProblems(this.state.form, this.state.maxRange)).length > 0) return;
    if (this.viewshedAbort !== null) {
      this.viewshedAbort.abort(); // pressed again while picking: cancels the pick
      return;
    }
    this.rangeAbort?.abort();
    this.drawAbort?.abort();
    const abort = new AbortController();
    this.viewshedAbort = abort;
    this.patch({ picking: true, viewshedError: null });
    let observer: Position | null;
    try {
      observer = await this.map.pickPoint({ signal: abort.signal });
    } finally {
      if (this.viewshedAbort === abort) this.viewshedAbort = null;
      this.patch({ picking: false });
    }
    if (observer === null) return;
    await this.compute(observer);
  }

  private async compute(observer: Position): Promise<void> {
    const epoch = this.epoch;
    const form = this.state.form;
    const observerHeight = parseNumber(form.observerHeight);
    const targetHeight = parseNumber(form.targetHeight);
    const maxRange = parseNumber(form.maxRange);
    if (observerHeight === null || targetHeight === null || maxRange === null) return;
    this.patch({ computing: true, viewshedError: null });
    try {
      const result = await postViewshed(this.serverBase, { observer, observerHeight, targetHeight, maxRange });
      if (epoch === this.epoch) {
        this.patch({ viewshed: { observer, maxRange, result } });
        this.showOverlay();
      }
    } catch (error) {
      if (epoch === this.epoch) this.patch({ viewshedError: messageOf(error) });
      if (error instanceof TerrainError && error.status === 503) void this.refreshStatus();
    } finally {
      this.patch({ computing: false });
    }
  }

  // ---------------------------------------------------------------- the height map

  /**
   * Lets the user draw the circle (press on the centre, drag to the radius), then asks the server
   * for the height map. A radius over the admin's longest range, or under 100 m, is refused here
   * with the field's message; the server checks it too. Pressed again while drawing, it cancels.
   */
  async startHeightMap(): Promise<void> {
    if (this.state.mapComputing || this.state.computing) return;
    if (this.drawAbort !== null) {
      this.drawAbort.abort();
      return;
    }
    this.rangeAbort?.abort();
    this.viewshedAbort?.abort();
    const abort = new AbortController();
    this.drawAbort = abort;
    this.patch({ drawing: true, heightMapError: null });
    let shape: DrawnGeometry | null;
    try {
      shape = await this.map.draw('circle', { style: DRAW_STYLE, signal: abort.signal });
    } finally {
      if (this.drawAbort === abort) this.drawAbort = null;
      this.patch({ drawing: false });
    }
    if (shape === null || shape.type !== 'Circle') return;
    const problem = radiusProblem(shape.radius, this.state.maxRange);
    if (problem !== null) {
      this.patch({ heightMapError: problem });
      return;
    }
    await this.computeMap(shape.center, shape.radius);
  }

  private async computeMap(center: Position, radius: number): Promise<void> {
    const epoch = this.epoch;
    this.patch({ mapComputing: true, heightMapError: null });
    try {
      const result = await postHeightMap(this.serverBase, { center, radius });
      if (epoch === this.epoch) {
        this.patch({ heightMap: { center, radius, result } });
        this.showMapOverlay();
      }
    } catch (error) {
      if (epoch === this.epoch) this.patch({ heightMapError: messageOf(error) });
      if (error instanceof TerrainError && error.status === 503) void this.refreshStatus();
    } finally {
      this.patch({ mapComputing: false });
    }
  }

  // ---------------------------------------------------------------- clear

  /** Removes this plugin's overlays: the three tools' results, and ends a tool that is waiting for a point or a circle. */
  clear(): void {
    this.epoch++;
    this.rangeAbort?.abort();
    this.viewshedAbort?.abort();
    this.drawAbort?.abort();
    this.patch({
      range: null,
      rangeFrom: null,
      rangeTo: null,
      rangePending: null,
      rangeError: null,
      viewshed: null,
      viewshedError: null,
      heightMap: null,
      heightMapError: null,
      overlayError: null,
    });
    this.overlay.clear();
    this.mapOverlay.clear();
    this.clearMarker();
  }
}
