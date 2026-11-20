import ms from 'milsymbol';
import { canonicalSidc, parseVesselSidc, type GraphicCatalogEntry, type LabelId, type Modifiers, type SymbolImage, type SymbolService } from '@emc2/plugin-sdk';
import { AppearanceCache } from './cache.ts';
import { RENDERER_VERSIONS, type GraphicStandard } from './graphics/catalogue.ts';
import { createGraphicsClient, type GraphicsClient, type WorkerLike } from './graphics/client.ts';
import { CATALOG } from './catalog.ts';
import { drawnModifiers, drawnTexts, MODIFIER_NAMES, wholeDegrees } from './modifiers.ts';
import { compose, describe } from './sidc.ts';
import { validate } from './validate.ts';
import { drawVessel, VESSEL_GROUPS, type VesselLook } from './vessel.ts';
import { DEFAULT_SENSOR_REPORT, drawSensorReport, type SensorReportLook } from './sensorReport.ts';

/**
 * The sizes render accepts, in pixels (milsymbol's `size`: a land unit frame is about `size` high);
 * others are a RangeError. Map symbols are 20 to 100 pixels.
 * - Below 4 the image is a few pixels, and below 1 the canvas rounds down to nothing.
 * - At 256 a unit frame is about 256 pixels high, an image about 400 x 280 pixels without text.
 */
export const MIN_SIZE = 4;
export const MAX_SIZE = 256;

/**
 * The most pixels the cache holds, besides its number of entries: 16 Mi pixels, 64 MiB as RGBA.
 * 2 000 map symbols of size 30 take about 3 Mi pixels; the budget only matters for large images.
 */
export const MAX_CACHED_PIXELS = 16 * 1024 * 1024;

/** The default of the `graphicTimeoutSeconds` setting, and its bounds (brief, Settings). */
export const DEFAULT_GRAPHIC_TIMEOUT_SECONDS = 5;
export const MIN_GRAPHIC_TIMEOUT_SECONDS = 1;
export const MAX_GRAPHIC_TIMEOUT_SECONDS = 30;

/** The graphics worker: bundled with mil-sym-ts into its own file, loaded at the first graphic. */
function createGraphicsWorker(): WorkerLike {
  return new Worker(new URL('./graphics/worker.ts', import.meta.url), { type: 'module', name: 'symbology-graphics' });
}

/**
 * Makes a drawn canvas read-only, because one cached canvas is shared by every caller: `getContext`
 * returns null, and `width` and `height` (whose assignment would clear the canvas) cannot be
 * assigned. Drawing it elsewhere (`drawImage`) and reading it (`toDataURL`) still work.
 */
function readOnly(canvas: HTMLCanvasElement): HTMLCanvasElement {
  return Object.defineProperties(canvas, {
    getContext: { value: () => null },
    width: { value: canvas.width, writable: false },
    height: { value: canvas.height, writable: false },
  });
}

/**
 * The SIDC milsymbol draws, so that every identity takes `looks.md`'s affiliation colours.
 * milsymbol gives a version 13 SIDC whose fourth digit is 5 (suspect, or an exercise joker), which
 * it reads as 2525E, a colour of its own; with 10 and 14 both are hostile red. For milsymbol, 13 and
 * 14 differ only in that colour, so such a SIDC is drawn as version 14.
 */
export function drawnSidc(canonical: string): string {
  return canonical.startsWith('13') && canonical[3] === '5' ? `14${canonical.slice(2)}` : canonical;
}

/** An invalid vessel code is drawn as an unknown ship of unknown identity, as the mark or hull it would be. */
const UNKNOWN_VESSEL = Object.freeze({ context: 0, identity: 1, shipType: 0 } as const);

/**
 * What a vessel image shows (brief function 12) and its appearance key: moving (a `direction`, and a
 * `speed` absent or above 0) gives a hull at the whole degree, else the mark; the texts follow
 * `withText` and the labels (function 14), and the hull turns whatever the labels. The look's ground
 * colour (the gap round the fill) is part of the key, so each look has its own images.
 */
export function vesselLook(sidc: string, modifiers: Modifiers | undefined, withText: boolean, labels: readonly LabelId[] | undefined, ground: string): { readonly look: VesselLook; readonly key: string } {
  const direction = modifiers?.direction;
  const speed = modifiers?.speed;
  const moving = direction !== undefined && Number.isFinite(direction) && (speed === undefined || speed > 0);
  const heading = moving ? wholeDegrees(direction) : null;
  const texts = withText && modifiers !== undefined ? drawnTexts(modifiers, labels) : [];
  const look: VesselLook = { code: parseVesselSidc(sidc) ?? UNKNOWN_VESSEL, heading, texts: texts.map(([, text]) => text), ground };
  return { look, key: `${ground} ${heading === null ? 'mark' : `hull ${String(heading)}`}${texts.length === 0 ? '' : JSON.stringify(texts.flat())}` };
}

/** The SymbolService, and what only the plugin itself controls: the size of its cache and the graphics' timeout. */
export interface Symbols {
  readonly service: SymbolService;
  /** The cache's current capacity, in images. */
  readonly cacheSize: number;
  /** Changes the cache's capacity; a smaller one drops the least recently used images at once. */
  resizeCache(capacity: number): void;
  /** How long a graphic may take to draw, in seconds; applies to the next request. */
  graphicTimeoutSeconds: number;
  /** The sensor report symbol's settings; a change gives a new image at the next `sensorReportSymbol()`. */
  sensorReport: SensorReportLook;
}

export interface SymbolServiceOptions {
  readonly cacheSize: number;
  readonly graphicTimeoutSeconds?: number;
  /** The graphics worker; tests give a fake or one that runs mil-sym-ts in the same thread. */
  readonly createWorker?: () => WorkerLike;
  /** When the requests of a frame are sent (requestAnimationFrame by default). */
  readonly schedule?: (run: () => void) => void;
  /** The look's current ground colour (`ctx.theme.tokens().colorGround`), for vessels; black without it. */
  readonly ground?: () => string;
  /** The sensor report symbol's settings at the start (default: an orange dot, 10 px). */
  readonly sensorReport?: SensorReportLook;
}

/**
 * The SymbolService. Images are cached by appearance: standard, canonical SIDC, size, and the
 * modifiers that are drawn (only the direction, unless text is requested; with the user's labels,
 * only the listed ones). Vessel symbols are emc2's own drawing (`vessel.ts`), cached the same way. milsymbol's settings are
 * passed per symbol; its global state is never changed. The colours are the same in every look.
 */
export function createSymbolService(options: SymbolServiceOptions): Symbols {
  const cache = new AppearanceCache<SymbolImage>(options.cacheSize, MAX_CACHED_PIXELS, (image) => image.width * image.height);
  let timeoutSeconds = options.graphicTimeoutSeconds ?? DEFAULT_GRAPHIC_TIMEOUT_SECONDS;
  const graphics: GraphicsClient = createGraphicsClient({
    createWorker: options.createWorker ?? createGraphicsWorker,
    timeoutMs: () => timeoutSeconds * 1000,
    ...(options.schedule === undefined ? {} : { schedule: options.schedule }),
  });
  /** One catalogue per standard, asked for once; a failed one is asked for again next time. */
  const catalogues = new Map<GraphicStandard, Promise<readonly GraphicCatalogEntry[]>>();
  /** The sensor report symbol (brief function 16): one image, kept apart from `render`'s cache until the settings change. */
  let sensorLook: SensorReportLook = options.sensorReport ?? DEFAULT_SENSOR_REPORT;
  let sensorImage: SymbolImage | null = null;
  const service: SymbolService = {
    render({ standard, sidc, modifiers, size, withText = false, labels }) {
      if (!(size >= MIN_SIZE && size <= MAX_SIZE)) {
        throw new RangeError(`render: size must be from ${String(MIN_SIZE)} to ${String(MAX_SIZE)} pixels, not ${String(size)}`);
      }
      if (standard === 'vessel') {
        // Images are shared by code, size, heading in whole degrees (or the mark) and the drawn texts (spike S2).
        const { look, key } = vesselLook(sidc, modifiers, withText, labels, options.ground?.() ?? '#000000');
        const cachedVessel = cache.get(standard, sidc, size, key);
        if (cachedVessel !== undefined) return cachedVessel;
        const drawnVessel = drawVessel(look, size);
        const canvas = readOnly(drawnVessel.canvas);
        const image: SymbolImage = Object.freeze({ image: canvas, width: canvas.width, height: canvas.height, anchor: Object.freeze(drawnVessel.anchor) });
        cache.set({ standard, sidc, size, modifiers: key }, image);
        return image;
      }
      const canonical = canonicalSidc(standard, sidc);
      const drawn = drawnModifiers(modifiers, withText, labels);
      const cached = cache.get(standard, canonical, size, drawn.key);
      if (cached !== undefined) return cached;
      // An invalid SIDC still draws: milsymbol shows it with its "invalid" frame. Civilian symbols take
      // their identity's colour, not milsymbol's civilian purple from MIL-STD-2525 (`looks.md`).
      const symbol = new ms.Symbol(drawnSidc(canonical), { ...drawn.options, size, standard: 'APP6', civilianColor: false });
      const canvas = readOnly(symbol.asCanvas());
      const anchor = symbol.getAnchor();
      const image: SymbolImage = Object.freeze({ image: canvas, width: canvas.width, height: canvas.height, anchor: Object.freeze([anchor.x, anchor.y] as const) });
      cache.set({ standard, sidc: canonical, size, modifiers: drawn.key }, image);
      return image;
    },
    validate,
    compose,
    describe,
    catalog: () => CATALOG,
    modifierNames: MODIFIER_NAMES,
    vesselGroups: () => VESSEL_GROUPS,
    sensorReportSymbol() {
      if (sensorImage === null) {
        const canvas = readOnly(drawSensorReport(sensorLook));
        sensorImage = Object.freeze({ image: canvas, width: canvas.width, height: canvas.height, anchor: Object.freeze([sensorLook.size / 2, sensorLook.size / 2] as const) });
      }
      return sensorImage;
    },
    graphicCatalog(standard) {
      // APP-6B has no graphics (ADR-0043 point 8): no renderer needed.
      if (!(standard in RENDERER_VERSIONS)) return Promise.resolve([]);
      let entries = catalogues.get(standard);
      if (entries === undefined) {
        entries = graphics.catalogue(standard);
        catalogues.set(standard, entries);
        entries.catch(() => catalogues.delete(standard));
      }
      return entries;
    },
    renderGraphic(request) {
      // Refused before the worker starts: the renderer cannot change these answers.
      if (!(request.standard in RENDERER_VERSIONS)) return Promise.resolve({ ok: false, reason: `${request.standard} has no tactical graphics` });
      return graphics.render(request);
    },
  };
  return {
    service,
    get cacheSize() {
      return cache.capacity;
    },
    resizeCache: (capacity) => {
      cache.resize(capacity);
    },
    get graphicTimeoutSeconds() {
      return timeoutSeconds;
    },
    set graphicTimeoutSeconds(seconds) {
      timeoutSeconds = seconds;
    },
    get sensorReport() {
      return sensorLook;
    },
    set sensorReport(look) {
      if (look.shape === sensorLook.shape && look.color === sensorLook.color && look.size === sensorLook.size) return;
      sensorLook = look;
      sensorImage = null;
    },
  };
}
