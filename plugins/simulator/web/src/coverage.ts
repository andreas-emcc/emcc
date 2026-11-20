// A sensor's coverage on the map (brief function 33, criterion 49; T-158; the owner's Q25 to Q29 A):
// the area function 28 looks at (from M6 a generic sensor's disc, function 38, and a job area,
// function 39), drawn by this web part as an overlay of its own round each platform's current
// position, in Simulation only. From M7: the job area's faint fill and 3 px dotted outline (function
// 41), the ground radars' dwells (function 43, dwells.ts), the bearing and range labels and a live
// preview of the sensor being edited (function 45), and the admin's colours (function 46). Nothing is
// stored or sent: the overlay is not an object, so no output and no scenario file sees it. The
// drawing is for the eye only; the server part decides what is detected (the ACA's R3 on CR-0035).
import type { ArcBand, CurrentWorkspace, DisplayClass, JsonValue, MapObject, MapView, MilSymbol, Overlay, OverlayItem, OverlayLabel, PluginLog, Position, Settings, Style, Unsubscribe, UserDocuments, Uuid } from '@emc2/plugin-sdk';
import type { DwellsModel } from './dwells.ts';
import { Model } from './model.ts';
import { SIMULATION } from './picture.ts';
import type { SimulationPicture } from './picture.ts';
import type { SensorSettings, SensorsModel } from './sensors.ts';

// ---- The WGS84 direct geodesic (Vincenty), within 1 m of the server's Geodesy (GeographicLib) ----

const A = 6_378_137;
const F = 1 / 298.257223563;
const B = A * (1 - F);
const RAD = Math.PI / 180;

/** Degrees in 0 to below 360. */
export function normal(degrees: number): number {
  const d = degrees % 360;
  return d < 0 ? d + 360 : d;
}

/**
 * The position `distance` metres from `from` along the geodesic that leaves it at `azimuth` degrees
 * clockwise from true north, on the WGS84 ellipsoid: Vincenty's direct formula, which converges for
 * every distance a sensor has (at most 1 000 km) and agrees with GeographicLib to well below 1 mm.
 */
export function direct(from: Position, azimuth: number, distance: number): Position {
  const [lon, lat] = from;
  if (distance === 0) return [lon, lat];
  const alpha1 = azimuth * RAD;
  const sinAlpha1 = Math.sin(alpha1);
  const cosAlpha1 = Math.cos(alpha1);
  const tanU1 = (1 - F) * Math.tan(lat * RAD);
  const cosU1 = 1 / Math.sqrt(1 + tanU1 * tanU1);
  const sinU1 = tanU1 * cosU1;
  const sigma1 = Math.atan2(tanU1, cosAlpha1);
  const sinAlpha = cosU1 * sinAlpha1;
  const cosSqAlpha = 1 - sinAlpha * sinAlpha;
  const uSq = (cosSqAlpha * (A * A - B * B)) / (B * B);
  const bigA = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const bigB = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const first = distance / (B * bigA);
  const cos2m = (sigma: number): number => Math.cos(2 * sigma1 + sigma);
  let sigma = first;
  for (let i = 0; i < 200; i++) {
    const c2m = cos2m(sigma);
    const sin = Math.sin(sigma);
    const cos = Math.cos(sigma);
    const deltaSigma = bigB * sin * (c2m + (bigB / 4) * (cos * (-1 + 2 * c2m * c2m) - (bigB / 6) * c2m * (-3 + 4 * sin * sin) * (-3 + 4 * c2m * c2m)));
    const next = first + deltaSigma;
    const done = Math.abs(next - sigma) < 1e-12;
    sigma = next;
    if (done) break;
  }
  const cos2SigmaM = cos2m(sigma);
  const sinSigma = Math.sin(sigma);
  const cosSigma = Math.cos(sigma);
  const x = sinU1 * sinSigma - cosU1 * cosSigma * cosAlpha1;
  const lat2 = Math.atan2(sinU1 * cosSigma + cosU1 * sinSigma * cosAlpha1, (1 - F) * Math.sqrt(sinAlpha * sinAlpha + x * x));
  const lambda = Math.atan2(sinSigma * sinAlpha1, cosU1 * cosSigma - sinU1 * sinSigma * cosAlpha1);
  const c = (F / 16) * cosSqAlpha * (4 + F * (4 - 3 * cosSqAlpha));
  const l = lambda - (1 - c) * F * sinAlpha * (sigma + c * sinSigma * (cos2SigmaM + c * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)));
  let lon2 = lon + l / RAD;
  lon2 = ((((lon2 + 180) % 360) + 360) % 360) - 180;
  return [lon2, lat2 / RAD];
}

// ---- The area ----

/** The most degrees between two positions of an arc (function 33). */
export const MAX_STEP = 1;

/** Positions on the circle of `radius` round `centre`, clockwise from `start` over `span` degrees, at most {@link MAX_STEP} apart, both ends included. */
function arc(centre: Position, radius: number, start: number, span: number): Position[] {
  const n = Math.max(1, Math.ceil(span / MAX_STEP - 1e-9));
  const out: Position[] = [];
  for (let i = 0; i <= n; i++) out.push(direct(centre, normal(start + (span * i) / n), radius));
  return out;
}

/** A closed circle, clockwise from north. */
function circle(centre: Position, radius: number): Position[] {
  const ring = arc(centre, radius, 0, 360).slice(0, -1);
  return [...ring, direct(centre, 0, radius)];
}

/**
 * The rings of a band round `centre` between `min` and `max` metres, clockwise from the true bearing
 * `start` over `span` degrees: with a span of 0 (all round) the ring between the two circles, the
 * inner circle a hole (the disc when `min` is 0); otherwise one exterior ring, the outer arc and the
 * inner arc back, or the centre in place of the inner arc when `min` is 0. Null when there is no
 * area: a `max` of 0, or a `min` not below it.
 */
export function bandRings(centre: Position, start: number, span: number, min: number, max: number): Position[][] | null {
  const c: Position = [centre[0], centre[1]];
  if (max <= 0 || min >= max) return null;
  if (span === 0) return min === 0 ? [circle(c, max)] : [circle(c, max), circle(c, min)];
  const outer = arc(c, max, start, span);
  const inner = min === 0 ? [c] : arc(c, min, start, span).reverse();
  return [[...outer, ...inner, direct(c, start, max)]];
}

/**
 * The rings of a sensor's area round `platform` turned to `heading` (function 33): the disc of the
 * max range with "Detect all in range"; with equal bearings (0° and 360° too, function 42) the ring
 * between the two circles; otherwise the band between the bearings (see {@link bandRings}).
 */
export function coverageRings(platform: Position, heading: number, s: SensorSettings): Position[][] | null {
  const centre: Position = [platform[0], platform[1]];
  if (s.type === 'GENERIC') return s.range > 0 ? [circle(centre, s.range)] : null; // function 38: the disc of its range
  if (s.maxRange <= 0) return null;
  if (s.detectAll) return [circle(centre, s.maxRange)];
  return bandRings(centre, normal(heading + s.startBearing), normal(s.endBearing - s.startBearing), s.minRange, s.maxRange);
}

/** Function 43: a dwell's `ArcBand` as rings, densified as the coverage is. */
export function arcBandRings(band: ArcBand): Position[][] | null {
  return bandRings(band.center, normal(band.startBearing), normal(band.endBearing - band.startBearing), band.innerRadius, band.outerRadius);
}

// ---- The labels (function 45) ----

export const LABEL_SIZE = 12;

/** A distance in km with at most one decimal, e.g. "50 km" or "12.5 km". */
export function km(metres: number): string {
  return `${String(Math.round(metres / 100) / 10)} km`;
}

/**
 * Function 45's labels on the coverage: the start and end bearing as set (from the heading, M7-S6),
 * in whole degrees, each at the middle of its straight edge, none when the sensor looks all round;
 * the max and min range at the middle of their arcs, none for a min range of 0. Looking all round,
 * the range labels are ahead: at the heading plus the start bearing (owner, 2026-11-12). In the
 * coverage's colour, size 12, with the map view's own halo.
 */
export function coverageLabels(platform: Position, heading: number, s: SensorSettings, colour: string): OverlayLabel[] {
  const centre: Position = [platform[0], platform[1]];
  const style = { color: colour, size: LABEL_SIZE };
  const at = (bearing: number, distance: number, text: string): OverlayLabel => ({ kind: 'label', position: direct(centre, normal(bearing), distance), text, style });
  if (s.type === 'GENERIC') return s.range > 0 ? [at(heading, s.range, km(s.range))] : [];
  if (s.maxRange <= 0 || (!s.detectAll && s.minRange >= s.maxRange)) return [];
  const start = heading + s.startBearing;
  const span = s.detectAll ? 0 : normal(s.endBearing - s.startBearing);
  const labels: OverlayLabel[] = [];
  if (span !== 0) {
    const edge = (s.minRange + s.maxRange) / 2;
    labels.push(at(start, edge, `${String(Math.round(s.startBearing))}°`), at(heading + s.endBearing, edge, `${String(Math.round(s.endBearing))}°`));
  }
  const middle = start + span / 2;
  labels.push(at(middle, s.maxRange, km(s.maxRange)));
  const min = s.detectAll ? 0 : s.minRange;
  if (min > 0) labels.push(at(middle, min, km(min)));
  return labels;
}

// ---- The colours (function 46; Q26 A, Q27 A) ----

const YELLOW = '#FFFF00';
const BLUE = '#00A8DC';
const GREEN = '#00E200';
const RED = '#FF3031';

/** APP-6D and APP-6E's standard identity digit, and the vessel code's (SDK 1.4.0), to its colour. */
const BY_DIGIT: Readonly<Record<string, string>> = { '0': YELLOW, '1': YELLOW, '2': BLUE, '3': BLUE, '4': GREEN, '5': RED, '6': RED };
/** APP-6B's identity letter, exercise ones included; joker and faker are drawn hostile. */
const BY_LETTER: Readonly<Record<string, string>> = {
  P: YELLOW, G: YELLOW, U: YELLOW, W: YELLOW, A: BLUE, M: BLUE, F: BLUE, D: BLUE, N: GREEN, L: GREEN, S: RED, H: RED, J: RED, K: RED,
};

/** The platform's standard identity colour: APP-6's medium frame colours, as `gmti`'s dwell area; yellow (unknown) when it has none. */
export function identityColour(symbol: MilSymbol | undefined): string {
  if (symbol === undefined) return YELLOW;
  const sidc = symbol.sidc;
  switch (symbol.standard) {
    case 'APP-6B':
      return BY_LETTER[sidc.charAt(1).toUpperCase()] ?? YELLOW;
    case 'vessel':
      return BY_DIGIT[sidc.charAt(1)] ?? YELLOW;
    default:
      return BY_DIGIT[sidc.charAt(3)] ?? YELLOW;
  }
}

/** One of function 46's settings: the platform's identity colour, or a fixed `#RRGGBB` (from M8 the default, T-189). */
export type ColourUse = { readonly use: 'identity' } | { readonly use: 'fixed'; readonly colour: string };

export interface Colours {
  readonly jobArea: ColourUse;
  readonly coverage: ColourUse;
  readonly dwell: ColourUse;
}

export const IDENTITY: ColourUse = { use: 'identity' };
const HEX = /^#[0-9A-Fa-f]{6}$/;

/** T-189 (owner SU A, SV A): each setting's fixed colour, its default from M8, as `gmti`'s in View. */
export const DEFAULT_JOB_AREA = '#BDCF3D';
export const DEFAULT_COVERAGE = '#FD0909';
export const DEFAULT_DWELL = '#7EF26A';
export const DEFAULT_COLOURS: Colours = {
  jobArea: { use: 'fixed', colour: DEFAULT_JOB_AREA },
  coverage: { use: 'fixed', colour: DEFAULT_COVERAGE },
  dwell: { use: 'fixed', colour: DEFAULT_DWELL },
};

function isRecord(value: JsonValue | null | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * A colour setting as saved: `identity` when it says so; otherwise fixed, in its own colour or, without
 * a valid one, the setting's default `fixed` (T-189: absent, the setting is its default, fixed).
 */
export function colourUse(value: JsonValue | undefined, fixed: string): ColourUse {
  if (isRecord(value) && value['use'] === 'identity') return IDENTITY;
  const colour = isRecord(value) ? value['colour'] : undefined;
  return { use: 'fixed', colour: typeof colour === 'string' && HEX.test(colour) ? colour : fixed };
}

export function coloursOf(settings: Settings): Colours {
  return {
    jobArea: colourUse(settings['jobAreaColour'], DEFAULT_JOB_AREA),
    coverage: colourUse(settings['coverageColour'], DEFAULT_COVERAGE),
    dwell: colourUse(settings['dwellColour'], DEFAULT_DWELL),
  };
}

/** The colour to draw with for a platform's symbol. */
export function colourFor(use: ColourUse, symbol: MilSymbol | undefined): string {
  return use.use === 'fixed' ? use.colour : identityColour(symbol);
}

/** Function 46: the admin's colours, the same for every user; a change applies at once (`ctx.onSettingsChange`), without a reload. */
export class ColoursModel extends Model<Colours> {
  constructor(settings: Settings, onChange: (listener: (settings: Settings) => void) => Unsubscribe) {
    super(coloursOf(settings));
    onChange((next) => {
      this.update(coloursOf(next));
    });
  }
}

// ---- The look ----

/** The outline: dashed, 1.5 px, no fill. */
export function coverageStyle(colour: string): Style {
  return { strokeColor: colour, strokeWidth: 1.5, strokeDash: 'dash', fillOpacity: 0 };
}

/** Function 41 (M7-S1): a job area's 3 px dotted outline and a faint fill of its colour, so that it differs from the dashed coverage. */
export function jobAreaStyle(colour: string): Style {
  return { strokeColor: colour, strokeWidth: 3, strokeDash: 'dot', fillColor: colour, fillOpacity: 0.15 };
}

/** Function 43: a dwell's 2 px solid outline, no fill, as `gmti` draws its dwell areas (T-181). */
export function dwellStyle(colour: string): Style {
  return { strokeColor: colour, strokeWidth: 2, fillOpacity: 0 };
}

interface Drawable {
  readonly platform: string;
  readonly missing: boolean;
  readonly settings: SensorSettings;
}

/** Function 47 (T-182, SDK 1.6.0 part D): the display class of the coverage, its labels and the job area. */
export const COVERAGE_CLASS: DisplayClass = 'sensor-coverage';
/** Function 47: the display class of the dwells. */
export const DWELL_CLASS: DisplayClass = 'dwell-area';

/**
 * The coverage's items, for each sensor whose platform is a point in the picture (none for a missing
 * one): first every job area (function 41: so the coverage's dashed line lies on top), then each
 * coverage area, then their labels (function 45). The sensor being edited is drawn from `preview`.
 */
export function coverageItems(
  sensors: readonly Drawable[],
  platformOf: (id: string) => MapObject | undefined,
  colours: Colours = DEFAULT_COLOURS,
  preview: Preview | null = null,
): OverlayItem[] {
  const jobs: OverlayItem[] = [];
  const areas: OverlayItem[] = [];
  const labels: OverlayItem[] = [];
  for (const s of sensors) {
    if (s.missing) continue;
    const platform = platformOf(s.platform);
    if (platform?.geometry.type !== 'Point') continue;
    const settings = preview !== null && preview.platform === s.platform ? preview.settings : s.settings;
    const direction = platform.symbol?.modifiers?.direction;
    const heading = direction !== undefined && Number.isFinite(direction) ? direction : 0;
    const position = platform.geometry.coordinates;
    const job = settings.jobArea?.coordinates[0];
    if (job !== undefined) jobs.push({ kind: 'area', rings: [job.map((p): Position => [p[0], p[1]])], style: jobAreaStyle(colourFor(colours.jobArea, platform.symbol)) });
    const rings = coverageRings(position, heading, settings);
    if (rings === null) continue;
    const colour = colourFor(colours.coverage, platform.symbol);
    areas.push({ kind: 'area', rings, style: coverageStyle(colour) });
    labels.push(...coverageLabels(position, heading, settings, colour));
  }
  // Function 47 (SDK 1.6.0 part D): the map view hides them while the user's "Sensor coverage" switch is off.
  return [...jobs, ...areas, ...labels].map((item) => ({ ...item, displayClass: COVERAGE_CLASS }));
}

// ---- The live preview (function 45) ----

/** The sensor being edited, drawn from its fields' values before saving. */
export interface Preview {
  readonly platform: Uuid;
  readonly settings: SensorSettings;
}

/** Only in this browser: nothing is sent until the user saves (function 27). */
export class PreviewModel extends Model<{ readonly preview: Preview | null }> {
  constructor() {
    super({ preview: null });
  }

  show(platform: Uuid, settings: SensorSettings): void {
    const now = this.getState().preview;
    if (now !== null && now.platform === platform && JSON.stringify(now.settings) === JSON.stringify(settings)) return;
    this.update({ preview: { platform, settings } });
  }

  /** Leaving the edit without saving brings back the saved sensor's drawing. */
  end(platform: Uuid): void {
    if (this.getState().preview?.platform === platform) this.update({ preview: null });
  }
}

// ---- "Show coverage" (Q28 A) and "Show dwells" (function 43): per user, in the user's own documents ----

export const COVERAGE_DOCUMENT = 'sensors-view';

export interface CoverageState {
  /** Null until the user's document has been read. */
  readonly show: boolean | null;
  /** Function 43: "Show dwells"; null until read, on by default. */
  readonly showDwells: boolean | null;
  /** A switch could not be saved; it still applies in this browser. */
  readonly saveError: string | null;
}

export class CoverageModel extends Model<CoverageState> {
  constructor(
    private readonly documents: UserDocuments,
    private readonly log: PluginLog,
  ) {
    super({ show: null, showDwells: null, saveError: null });
  }

  /**
   * Reads the switches; on by default, also when the document cannot be read. It lists the
   * documents first and reads them only when the document exists, as bookmarks does: a user who never
   * saved them would otherwise make a request that answers 404, which the browser logs as an error
   * (the MCA's q12).
   */
  async load(): Promise<void> {
    let show = true;
    let showDwells = true;
    try {
      const doc = (await this.documents.list()).includes(COVERAGE_DOCUMENT) ? await this.documents.get(COVERAGE_DOCUMENT) : null;
      if (isRecord(doc) && doc['showCoverage'] === false) show = false;
      if (isRecord(doc) && doc['showDwells'] === false) showDwells = false;
    } catch (e) {
      this.log.warn('"Show coverage" and "Show dwells" could not be read; they are on', e);
    }
    const now = this.getState();
    this.update({ show: now.show ?? show, showDwells: now.showDwells ?? showDwells });
  }

  setShow(show: boolean): Promise<void> {
    return this.save({ show });
  }

  setShowDwells(showDwells: boolean): Promise<void> {
    return this.save({ showDwells });
  }

  /** Both switches go in the one document. */
  private async save(patch: Partial<Pick<CoverageState, 'show' | 'showDwells'>>): Promise<void> {
    this.update({ ...patch, saveError: null });
    const s = this.getState();
    try {
      await this.documents.put(COVERAGE_DOCUMENT, { showCoverage: s.show !== false, showDwells: s.showDwells !== false });
    } catch (e) {
      this.log.warn('"Show coverage" or "Show dwells" could not be saved', e);
      this.update({ saveError: 'Not saved: it applies in this browser until you reload' });
    }
  }
}

// ---- The overlay ----

/**
 * Draws the coverage while Simulation is shown and "Show coverage" is on, whether the simulation
 * runs, is paused or is reset (Q29 A), and also while the Sensors panel is closed: it reads the
 * sensors itself then. With "Show dwells" on it draws the dwells too (function 43), which `dwells`
 * reads. Redrawn when a platform moves or turns, when a sensor, its preview, a dwell or a colour
 * changes; cleared in another workspace.
 */
export class CoverageOverlay {
  private readonly overlay: Overlay;
  /** What is drawn, as JSON; null while nothing is. */
  private last: string | null = null;
  private release: (() => void) | null = null;
  private readonly cleanup: Unsubscribe[] = [];

  constructor(
    map: MapView,
    private readonly picture: SimulationPicture,
    private readonly sensors: SensorsModel,
    private readonly coverage: CoverageModel,
    private readonly workspace: CurrentWorkspace,
    private readonly colours: ColoursModel | null = null,
    private readonly preview: PreviewModel | null = null,
    private readonly dwells: DwellsModel | null = null,
  ) {
    this.overlay = map.createOverlay();
    const redraw = (): void => {
      this.draw(false);
    };
    this.cleanup.push(picture.onChange(redraw), sensors.subscribe(redraw), coverage.subscribe(redraw));
    if (colours !== null) this.cleanup.push(colours.subscribe(redraw));
    if (preview !== null) this.cleanup.push(preview.subscribe(redraw));
    if (dwells !== null) this.cleanup.push(dwells.subscribe(redraw));
    this.cleanup.push(workspace.onChange(() => {
      this.draw(true);
    }));
    this.draw(true);
  }

  dispose(): void {
    for (const u of this.cleanup) u();
    this.release?.();
    this.release = null;
    this.dwells?.follow(false, false, null);
    this.overlay.clear();
  }

  private draw(force: boolean): void {
    const simulation = this.workspace.current.id === SIMULATION;
    const state = this.coverage.getState();
    const showCoverage = simulation && state.show === true;
    const showDwells = simulation && state.showDwells === true && this.dwells !== null;
    if ((showCoverage || showDwells) && this.release === null) this.release = this.sensors.watch();
    if (!(showCoverage || showDwells) && this.release !== null) {
      this.release();
      this.release = null;
    }
    const sensors = this.sensors.getState();
    this.dwells?.follow(showDwells, sensors.running, sensors.dwells);
    const colours = this.colours?.getState() ?? DEFAULT_COLOURS;
    const platformOf = (id: string): MapObject | undefined => this.picture.object(id);
    const items: OverlayItem[] = [];
    if (showCoverage) items.push(...coverageItems(sensors.sensors, platformOf, colours, this.preview?.getState().preview ?? null));
    if (showDwells) items.push(...this.dwells.items(platformOf, colours.dwell));
    if (items.length === 0) {
      if (this.last !== null) this.overlay.clear();
      this.last = null;
      return;
    }
    const key = JSON.stringify(items);
    if (!force && key === this.last) return;
    this.last = key;
    this.overlay.set(items);
  }
}
