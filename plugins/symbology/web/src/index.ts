// The entry module ("web.entry" in plugin.json, built to dist/index.js). The shell imports it and
// calls activate(ctx) once. It provides the SymbolService (emc2.symbols) and nothing else; it gets
// no service, so its manifest has no `requires` or `uses`.
import { definePlugin, SYMBOLS, type JsonValue, type PluginContext, type Settings } from '@emc2/plugin-sdk';
import { createSymbolService, DEFAULT_GRAPHIC_TIMEOUT_SECONDS, MAX_GRAPHIC_TIMEOUT_SECONDS, MIN_GRAPHIC_TIMEOUT_SECONDS, type Symbols } from './service.ts';
import { DEFAULT_SENSOR_REPORT, MAX_SENSOR_REPORT_SIZE, MIN_SENSOR_REPORT_SIZE, SENSOR_REPORT_COLOURS, SENSOR_REPORT_SHAPES, type SensorReportLook } from './sensorReport.ts';

/** The default of the `imageCacheSize` setting, as in plugin.json. */
const DEFAULT_CACHE_SIZE = 2000;

/** The `imageCacheSize` setting if it is a positive integer, else null. */
function cacheSizeOf(settings: Settings): number | null {
  const value = settings['imageCacheSize'];
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? value : null;
}

/** The `graphicTimeoutSeconds` setting: its default when it is missing, null when it is out of range. */
function graphicTimeoutOf(settings: Settings): number | null {
  const value = settings['graphicTimeoutSeconds'];
  if (value === undefined) return DEFAULT_GRAPHIC_TIMEOUT_SECONDS;
  return typeof value === 'number' && Number.isInteger(value) && value >= MIN_GRAPHIC_TIMEOUT_SECONDS && value <= MAX_GRAPHIC_TIMEOUT_SECONDS ? value : null;
}

/**
 * The sensor report settings (brief function 16): each missing one is its default; for each bad one,
 * a problem, and the current value is kept.
 */
function sensorReportOf(settings: Settings, current: SensorReportLook): { readonly look: SensorReportLook; readonly problems: readonly string[] } {
  const problems: string[] = [];
  const shapeValue = settings['sensorReportShape'] ?? DEFAULT_SENSOR_REPORT.shape;
  const colourValue = settings['sensorReportColor'] ?? DEFAULT_SENSOR_REPORT.color;
  const sizeValue = settings['sensorReportSize'] ?? DEFAULT_SENSOR_REPORT.size;
  const shape = SENSOR_REPORT_SHAPES.find((s) => s === shapeValue);
  const color = (Object.keys(SENSOR_REPORT_COLOURS) as SensorReportLook['color'][]).find((c) => c === colourValue);
  const size = typeof sizeValue === 'number' && Number.isInteger(sizeValue) && sizeValue >= MIN_SENSOR_REPORT_SIZE && sizeValue <= MAX_SENSOR_REPORT_SIZE ? sizeValue : undefined;
  if (shape === undefined) problems.push(`sensorReportShape ${describe(shapeValue)} is not one of ${SENSOR_REPORT_SHAPES.join(', ')}; using ${current.shape}`);
  if (color === undefined) problems.push(`sensorReportColor ${describe(colourValue)} is not one of ${Object.keys(SENSOR_REPORT_COLOURS).join(', ')}; using ${current.color}`);
  if (size === undefined) problems.push(`sensorReportSize ${describe(sizeValue)} is not a whole number from ${String(MIN_SENSOR_REPORT_SIZE)} to ${String(MAX_SENSOR_REPORT_SIZE)}; using ${String(current.size)}`);
  return { look: { shape: shape ?? current.shape, color: color ?? current.color, size: size ?? current.size }, problems };
}

function describe(value: JsonValue | undefined): string {
  return value === undefined ? 'missing' : JSON.stringify(value);
}

/**
 * Applies the settings: valid values are used and reported OK; a bad one keeps the current value and
 * reports DEGRADED.
 */
function apply(ctx: PluginContext, symbols: Symbols, settings: Settings): void {
  const problems: string[] = [];
  const size = cacheSizeOf(settings);
  if (size === null) {
    problems.push(`imageCacheSize ${describe(settings['imageCacheSize'])} is not a positive integer; using ${String(symbols.cacheSize)}`);
  } else if (size !== symbols.cacheSize) {
    symbols.resizeCache(size);
    ctx.log.info(`image cache size is now ${String(size)}`);
  }
  const timeout = graphicTimeoutOf(settings);
  if (timeout === null) {
    problems.push(`graphicTimeoutSeconds ${describe(settings['graphicTimeoutSeconds'])} is not a whole number from ${String(MIN_GRAPHIC_TIMEOUT_SECONDS)} to ${String(MAX_GRAPHIC_TIMEOUT_SECONDS)}; using ${String(symbols.graphicTimeoutSeconds)}`);
  } else if (timeout !== symbols.graphicTimeoutSeconds) {
    symbols.graphicTimeoutSeconds = timeout;
    ctx.log.info(`graphic draw timeout is now ${String(timeout)} s`);
  }
  const sensor = sensorReportOf(settings, symbols.sensorReport);
  problems.push(...sensor.problems);
  const before = symbols.sensorReport;
  symbols.sensorReport = sensor.look;
  if (symbols.sensorReport !== before) ctx.log.info(`sensor report symbol is now: ${sensor.look.color} ${sensor.look.shape}, ${String(sensor.look.size)} px`);
  if (problems.length === 0) {
    ctx.status.set('OK', 'ready');
    return;
  }
  const detail = problems.join('; ');
  ctx.log.warn(detail);
  ctx.status.set('DEGRADED', detail);
}

export default definePlugin({
  activate(ctx) {
    const symbols = createSymbolService({
      cacheSize: cacheSizeOf(ctx.settings) ?? DEFAULT_CACHE_SIZE,
      graphicTimeoutSeconds: graphicTimeoutOf(ctx.settings) ?? DEFAULT_GRAPHIC_TIMEOUT_SECONDS,
      // Read at each vessel render, so a new look gives new images (the old ones age out of the cache).
      ground: () => ctx.theme.tokens().colorGround,
    });
    ctx.services.provide(SYMBOLS, symbols.service);
    apply(ctx, symbols, ctx.settings);
    // Settings change at runtime (SDK v1): a new cache size, timeout or sensor report symbol applies at once, without a reload.
    ctx.onSettingsChange((settings) => {
      apply(ctx, symbols, settings);
    });
  },
});
