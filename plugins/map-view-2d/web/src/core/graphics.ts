/**
 * Tactical graphics (brief functions 29 to 32; SDK 1.4.0, ADR-0043): what the map view asks the
 * symbology service to draw, and when. A `core.multipoint` object is a draw item of kind `graphic`
 * (`drawData.ts`); {@link GraphicRenderer} asks `renderGraphic` for the ones in view, again after a
 * zoom, when the view leaves the drawn extent, and when the object changes, drops an answer for an
 * older state, and hands the answers on a slice at a time so that no task on the main thread takes
 * long (spike S1). Pure: the service, the view and the way an answer reaches the engine are given.
 */
import type { GraphicRenderRequest, Position, SymbolService, SymbolStandard, Uuid } from '@emc2/plugin-sdk';
import type { Clock } from './cadence.ts';
import type { DrawItem, GraphicParts } from './drawData.ts';
import { withUsableImages } from './graphicImages.ts';

/** West, south, east, north in longitude and latitude; west is greater than east across the antimeridian. */
export type LonLatExtent = readonly [west: number, south: number, east: number, north: number];

/**
 * At most this many requests are in flight at once. The symbology service hands the requests of one
 * frame to its worker in one message, so a number of them cost one round trip: 1 000 graphics are drawn
 * again within a second after a zoom (browser check, criterion 70); six at a time took three.
 */
export const MAX_IN_FLIGHT = 200;

/**
 * Whether the symbology service draws graphics of a symbol standard: APP-6 D and E only. An APP-6B or a
 * `vessel` symbol never goes to the graphics path (it keeps the marker; vessels are drawn later, T-139).
 */
export function drawsGraphics(standard: SymbolStandard): standard is GraphicRenderRequest['standard'] {
  return standard === 'APP-6D' || standard === 'APP-6E';
}
/** The extent asked for is this many times the view's (brief function 29). */
export const EXTENT_SCALE = 1.5;
/** A slice of answers is handed on for at most this long (the main thread's task budget is 50 ms). */
export const SLICE_MS = 20;
/** The first chunk of answers handed on, before it is known what the engine takes; the most in one. */
const INITIAL_CHUNK = 4;
const MAX_CHUNK = 200;
/** A resolution that differs by less than this (relative) is the same: a pan changes it a little in some projections. */
const SAME_RESOLUTION = 0.005;

type Graphic = Extract<DrawItem, { readonly kind: 'graphic' }>;

/** The view as the renderer needs it. */
export interface GraphicView {
  /** The visible area in longitude, latitude. */
  readonly extent: LonLatExtent;
  /** Metres per screen pixel at the centre, for the service. */
  readonly groundResolution: number;
  /** Projected units per pixel, to tell a zoom from a pan. */
  readonly resolution: number;
}

export interface GraphicHost {
  /** The symbology service, or null while there is none (the markers stay). */
  symbols(): SymbolService | null;
  /** The view, or null while the map has no size. */
  view(): GraphicView | null;
  /** The drawn graphics, a slice at a time: items with their `parts` set, by layer. */
  deliver(layerId: Uuid, items: ReadonlyMap<Uuid, DrawItem>): void;
  log: { readonly warn: (message: string, ...details: unknown[]) => void };
  clock: Clock;
}

interface Entry {
  item: Graphic;
  /** What the object is: standard, SIDC, amplifiers and points. A new key is a changed object. */
  key: string;
  parts: GraphicParts | null;
  /** The request in flight, and what it was asked for. */
  pending: { readonly token: number; readonly key: string } | null;
  /** What `parts` (or its refusal) was drawn for. */
  drawn: { readonly resolution: number; readonly extent: LonLatExtent } | null;
  /** The refusal's reason that was logged last, so that it is logged once per object and state. */
  logged: string | null;
}

export class GraphicRenderer {
  private readonly entries = new Map<Uuid, Entry>();
  private readonly ready = new Map<Uuid, GraphicParts | null>();
  private readonly queue: Uuid[] = [];
  private inFlight = 0;
  private token = 0;
  private slicing: unknown = null;
  /** How many answers go in one chunk to the engine. */
  private chunk = INITIAL_CHUNK;
  private disposed = false;

  constructor(private readonly host: GraphicHost) {}

  /**
   * Takes the item of a graphic that is drawn now (faded or not) and gives it back with what is known
   * of its drawing: `parts` are set while an answer for this very object has come, else null (the
   * marker). Asks for the drawing when it is in view and not drawn for this view.
   */
  attach(item: Graphic): Graphic {
    const key = keyOf(item);
    let entry = this.entries.get(item.id);
    if (entry === undefined) {
      entry = { item, key, parts: null, pending: null, drawn: null, logged: null };
      this.entries.set(item.id, entry);
    } else if (entry.key !== key) {
      // A changed object: what was drawn belongs to the one before.
      entry.key = key;
      entry.parts = null;
      entry.drawn = null;
      entry.pending = null;
      entry.logged = null;
    }
    entry.item = { ...item, parts: null };
    this.request(item.id);
    return entry.parts === null ? { ...item, parts: null } : { ...item, parts: entry.parts };
  }

  /** The item as it is drawn now: with its `parts` while an answer for this very object is held; asks for nothing. */
  current(item: Graphic): Graphic {
    const entry = this.entries.get(item.id);
    return entry !== undefined && entry.key === keyOf(item) && entry.parts !== null ? { ...item, parts: entry.parts } : { ...item, parts: null };
  }

  forget(id: Uuid): void {
    this.entries.delete(id);
    this.ready.delete(id);
  }

  /** The view changed (a zoom, a pan, a resize), or the service came: asks for what is not drawn for it. */
  viewChanged(): void {
    for (const id of this.entries.keys()) this.request(id);
  }

  dispose(): void {
    this.disposed = true;
    if (this.slicing !== null) this.host.clock.clearTimeout(this.slicing);
    this.slicing = null;
    this.entries.clear();
    this.ready.clear();
    this.queue.length = 0;
  }

  /** The graphic's control points are in view and it is not drawn for it: puts it in the queue. */
  private request(id: Uuid): void {
    const entry = this.entries.get(id);
    const view = this.host.view();
    if (entry === undefined || view === null || this.host.symbols() === null) return;
    if (entry.pending !== null || this.queue.includes(id)) return;
    if (!needsDrawing(entry, view)) return;
    this.queue.push(id);
    this.pump();
  }

  private pump(): void {
    while (this.inFlight < MAX_IN_FLIGHT && this.queue.length > 0) {
      const id = this.queue.shift() as Uuid;
      this.send(id);
    }
  }

  private send(id: Uuid): void {
    const entry = this.entries.get(id);
    const view = this.host.view();
    const service = this.host.symbols();
    if (entry === undefined || view === null || service === null || entry.pending !== null) return;
    const { symbol } = entry.item;
    const { standard } = symbol;
    if (!drawsGraphics(standard)) {
      // APP-6B and vessel symbols keep the marker (the service draws APP-6 D and E graphics only).
      this.answered(id, entry, null, `${standard} graphics are not drawn`, { resolution: view.resolution, extent: view.extent });
      return;
    }
    const extent = scaled(view.extent, EXTENT_SCALE);
    const request: GraphicRenderRequest = {
      standard,
      sidc: symbol.sidc,
      points: entry.item.points,
      ...(symbol.modifiers === undefined ? {} : { modifiers: symbol.modifiers }),
      resolution: view.groundResolution,
      extent,
    };
    const token = ++this.token;
    const key = entry.key;
    entry.pending = { token, key };
    this.inFlight++;
    const done = (outcome: GraphicParts | { readonly ok: false; readonly reason: string }) => {
      this.inFlight--;
      const current = this.entries.get(id);
      if (!this.disposed && current !== undefined && current.pending?.token === token && current.key === key) {
        current.pending = null;
        this.answered(id, current, outcome.ok ? withUsableImages(outcome) : null, outcome.ok ? null : outcome.reason, { resolution: view.resolution, extent });
      }
      // An answer for an older state is dropped; what is still wanted is asked for again.
      if (!this.disposed) {
        this.pump();
        this.request(id);
      }
    };
    let answer: Promise<Awaited<ReturnType<NonNullable<SymbolService['renderGraphic']>>>>;
    try {
      answer = service.renderGraphic(request);
    } catch (error) {
      answer = Promise.resolve({ ok: false, reason: error instanceof Error ? error.message : String(error) });
    }
    answer.then(done, (error: unknown) => {
      done({ ok: false, reason: error instanceof Error ? error.message : String(error) });
    });
  }

  private answered(id: Uuid, entry: Entry, parts: GraphicParts | null, reason: string | null, drawn: { readonly resolution: number; readonly extent: LonLatExtent }): void {
    entry.drawn = drawn;
    entry.parts = parts;
    if (reason !== null) this.log(entry, reason);
    else entry.logged = null;
    this.ready.set(id, parts);
    this.flushSoon(0);
  }

  /** The reason a graphic is a marker, once per object and state (a changed object logs again). */
  private log(entry: Entry, reason: string): void {
    if (entry.logged === reason) return;
    entry.logged = reason;
    this.host.log.warn(`tactical graphic ${entry.item.id} is drawn as a marker: ${reason}`);
  }

  private flushSoon(delay: number): void {
    if (this.slicing !== null || this.disposed) return;
    this.slicing = this.host.clock.setTimeout(() => {
      this.slicing = null;
      this.flush();
    }, delay);
  }

  /**
   * Hands on answers in chunks for at most {@link SLICE_MS}, then lets the main thread go and goes on.
   * What a chunk costs is the engine's: the next chunk is as many items as fit in half a slice at the
   * rate of the last one.
   */
  private flush(): void {
    const started = this.host.clock.now();
    while (this.ready.size > 0 && this.host.clock.now() - started < SLICE_MS) {
      const byLayer = new Map<Uuid, Map<Uuid, DrawItem>>();
      let count = 0;
      for (const [id, parts] of this.ready) {
        if (count >= this.chunk) break;
        this.ready.delete(id);
        const entry = this.entries.get(id);
        if (entry === undefined) continue;
        let layer = byLayer.get(entry.item.layerId);
        if (layer === undefined) byLayer.set(entry.item.layerId, (layer = new Map<Uuid, DrawItem>()));
        layer.set(id, { ...entry.item, parts });
        count++;
      }
      const before = this.host.clock.now();
      for (const [layerId, items] of byLayer) this.host.deliver(layerId, items);
      if (count > 0) {
        const perItem = Math.max(0.01, (this.host.clock.now() - before) / count);
        this.chunk = Math.max(1, Math.min(MAX_CHUNK, Math.floor(SLICE_MS / 2 / perItem)));
      }
    }
    if (this.ready.size > 0) this.flushSoon(0);
  }
}

/** Whether a graphic is in view and has not been drawn for it. */
function needsDrawing(entry: Entry, view: GraphicView): boolean {
  if (!reaches(entry.item.points, view.extent)) return false;
  const drawn = entry.drawn;
  if (drawn === null) return true;
  if (Math.abs(drawn.resolution - view.resolution) > SAME_RESOLUTION * view.resolution) return true;
  return !contains(drawn.extent, view.extent);
}

function keyOf(item: Graphic): string {
  return JSON.stringify([item.symbol.standard, item.symbol.sidc, item.symbol.modifiers ?? null, item.points]);
}

/** `extent` as large as `factor` times around its middle, across the antimeridian too; the world when it covers it. */
export function scaled(extent: LonLatExtent, factor: number): LonLatExtent {
  const [west, south, east, north] = extent;
  const width = lonSpan(west, east) * factor;
  const height = (north - south) * factor;
  const midLat = (north + south) / 2;
  const midLon = west + lonSpan(west, east) / 2;
  const s = Math.max(-90, midLat - height / 2);
  const n = Math.min(90, midLat + height / 2);
  if (width >= 360) return [-180, s, 180, n];
  return [wrap(midLon - width / 2), s, wrap(midLon + width / 2), n];
}

/** The width of an extent in degrees; an east below the west means it crosses the antimeridian. */
export function lonSpan(west: number, east: number): number {
  return east >= west ? east - west : east + 360 - west;
}

function wrap(lon: number): number {
  const l = ((((lon + 180) % 360) + 360) % 360) - 180;
  return l === -180 && lon > 0 ? 180 : l;
}

/** Whether `inner` lies within `outer`, across the antimeridian too. */
export function contains(outer: LonLatExtent, inner: LonLatExtent): boolean {
  if (inner[1] < outer[1] || inner[3] > outer[3]) return false;
  const outerSpan = lonSpan(outer[0], outer[2]);
  if (outerSpan >= 360) return true;
  const start = (((inner[0] - outer[0]) % 360) + 360) % 360;
  return start + lonSpan(inner[0], inner[2]) <= outerSpan + 1e-9;
}

/** Whether any of the points lies in the extent, widened by a margin for what a graphic draws beyond its points. */
export function reaches(points: readonly Position[], extent: LonLatExtent): boolean {
  const wide = scaled(extent, EXTENT_SCALE);
  return points.some(([lon, lat]) => lat >= wide[1] && lat <= wide[3] && inLon(lon, wide));
}

function inLon(lon: number, [west, , east]: LonLatExtent): boolean {
  return lonSpan(west, wrap(lon)) <= lonSpan(west, east) + 1e-9;
}

/**
 * The extent of a viewport's visible ring in longitude, latitude. The narrowest on the circle of
 * longitudes, so a ring across the antimeridian gives a west greater than the east; a ring that
 * goes round a pole gives all longitudes and reaches the pole.
 */
export function extentOfRing(ring: readonly Position[], centre: Position): LonLatExtent {
  let south = 90;
  let north = -90;
  for (const [, lat] of ring) {
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  const lons = ring.map((p) => ((((p[0] + 180) % 360) + 360) % 360) - 180).sort((a, b) => a - b);
  if (lons.length === 0) return [-180, -90, 180, 90];
  let gap = -1;
  let gapAt = 0;
  for (let i = 0; i < lons.length; i++) {
    const a = lons[i] as number;
    const b = i + 1 < lons.length ? (lons[i + 1] as number) : (lons[0] as number) + 360;
    if (b - a > gap) {
      gap = b - a;
      gapAt = i;
    }
  }
  const west = lons[(gapAt + 1) % lons.length] as number;
  const east = lons[gapAt] as number;
  // A ring round a pole has no gap to speak of: every longitude, and the pole.
  if (gap < 120) return [-180, centre[1] >= 0 ? south : -90, 180, centre[1] >= 0 ? 90 : north];
  return [west, south, east, north];
}

/** A rendered graphic moved by a difference in longitude and latitude (the preview of a drag; latitudes clamped at ±90). */
export function translatedParts(parts: GraphicParts, dLon: number, dLat: number): GraphicParts {
  const move = (flat: Float64Array): Float64Array => {
    const moved = new Float64Array(flat.length);
    for (let i = 0; i + 1 < flat.length; i += 2) {
      moved[i] = (flat[i] as number) + dLon;
      moved[i + 1] = Math.max(-90, Math.min(90, (flat[i + 1] as number) + dLat));
    }
    return moved;
  };
  return {
    ok: true,
    lines: parts.lines.map((line) => ({ ...line, coordinates: move(line.coordinates) })),
    fills: parts.fills.map((fill) => ({ ...fill, rings: fill.rings.map(move) })),
    labels: parts.labels.map((label) => ({ ...label, position: [label.position[0] + dLon, Math.max(-90, Math.min(90, label.position[1] + dLat))] })),
    ...(parts.images === undefined ? {} : { images: parts.images.map((image) => ({ ...image, position: [image.position[0] + dLon, Math.max(-90, Math.min(90, image.position[1] + dLat))] as Position })) }),
  };
}

export interface PreviewHost {
  symbols(): SymbolService | null;
  view(): GraphicView | null;
  /** The drawing for the points last asked for, or null for none: the plain line shows then. */
  show(parts: GraphicParts | null, points: readonly Position[]): void;
}

/**
 * The preview of a tactical graphic while it is placed or edited (brief function 32): the graphic
 * itself, drawn through `renderGraphic` from the points as they are. One request at a time; when it
 * answers, the newest points are sent next, so the preview never lags behind by more than one
 * answer. A refusal, or no service, shows the plain line.
 */
export class GraphicPreview {
  private busy = false;
  private latest: readonly Position[] | null = null;
  private cleared = 0;
  private stopped = false;

  constructor(private readonly host: PreviewHost, private readonly symbol: { readonly standard: SymbolStandard; readonly sidc: string; readonly modifiers?: GraphicRenderRequest['modifiers'] }) {}

  /** The control points as they are now, in longitude, latitude. */
  update(points: readonly Position[]): void {
    this.latest = points;
    if (!this.busy && !this.stopped) this.next();
  }

  /** Too few points for the graphic: the plain line. */
  clear(): void {
    this.cleared++;
    this.latest = null;
    this.host.show(null, []);
  }

  stop(): void {
    this.stopped = true;
    this.latest = null;
  }

  private next(): void {
    const points = this.latest;
    const service = this.host.symbols();
    const view = this.host.view();
    const { standard } = this.symbol;
    if (points === null || service?.renderGraphic === undefined || view === null || !drawsGraphics(standard)) {
      if (points !== null) this.host.show(null, points);
      return;
    }
    this.latest = null;
    this.busy = true;
    const cleared = this.cleared;
    const request: GraphicRenderRequest = {
      standard,
      sidc: this.symbol.sidc,
      points,
      ...(this.symbol.modifiers === undefined ? {} : { modifiers: this.symbol.modifiers }),
      resolution: view.groundResolution,
      extent: scaled(view.extent, EXTENT_SCALE),
    };
    const done = (parts: GraphicParts | null) => {
      this.busy = false;
      if (this.stopped) return;
      if (cleared === this.cleared) this.host.show(parts, points);
      if (this.latest !== null) this.next();
    };
    service.renderGraphic(request).then(
      (answer) => {
        done(answer.ok ? withUsableImages(answer) : null);
      },
      () => {
        done(null);
      },
    );
  }
}
