// The symbols in the data model's examples (model/examples/), wherever they appear in a document.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MilSymbol, SymbolStandard } from '@emc2/plugin-sdk';

// Plain paths: under jsdom the global URL is not the one node:fs accepts.
const model = join(fileURLToPath(import.meta.url), '../../../../../model');

export interface ExampleSymbol {
  readonly file: string;
  /** The type of the object that carries the symbol, e.g. `core.symbol` or `core.multipoint`. */
  readonly objectType: string;
  readonly symbol: MilSymbol;
}

function isSymbol(value: unknown): value is MilSymbol {
  if (typeof value !== 'object' || value === null) return false;
  const { standard, sidc } = value as { standard?: unknown; sidc?: unknown };
  return ['APP-6B', 'APP-6D', 'APP-6E', 'vessel'].includes(standard as SymbolStandard) && typeof sidc === 'string';
}

function collect(file: string, value: unknown, found: ExampleSymbol[]): void {
  if (typeof value !== 'object' || value === null) return;
  const { type } = value as { type?: unknown };
  for (const [key, child] of Object.entries(value)) {
    if (key === 'symbol' && isSymbol(child)) found.push({ file, objectType: typeof type === 'string' ? type : '', symbol: child });
    else collect(file, child, found);
  }
}

/** Every symbol in the JSON files of `model/examples/<folder>/`. */
export function exampleSymbols(folder: 'valid' | 'invalid'): ExampleSymbol[] {
  const dir = join(model, 'examples', folder);
  const result: ExampleSymbol[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
    collect(file, JSON.parse(readFileSync(join(dir, file), 'utf8')), result);
  }
  return result;
}

/**
 * The symbols of the `core.symbol` examples, which criteria 1 and 3 of the brief name. Multipoint
 * tactical graphics (`core.multipoint`) are out of scope (owner, 2026-10-08).
 */
export function exampleCoreSymbols(folder: 'valid' | 'invalid'): ExampleSymbol[] {
  return exampleSymbols(folder).filter((e) => e.objectType === 'core.symbol');
}

/** The modifier names the data model allows (`model/schemas/map-object.schema.json`). */
export function modelModifierNames(): string[] {
  const schema = JSON.parse(readFileSync(join(model, 'schemas', 'map-object.schema.json'), 'utf8')) as {
    $defs: { modifiers: { properties: Record<string, unknown> } };
  };
  return Object.keys(schema.$defs.modifiers.properties).sort();
}

export interface ExampleGraphic {
  readonly file: string;
  readonly symbol: MilSymbol;
  /** The control points: the geometry's positions (a Polygon's ring without its closing position). */
  readonly points: readonly (readonly [number, number])[];
}

/** The `core.multipoint` objects of `model/examples/valid/`, with their control points. */
export function exampleGraphics(): ExampleGraphic[] {
  const dir = join(model, 'examples', 'valid');
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((file) => {
      const object = JSON.parse(readFileSync(join(dir, file), 'utf8')) as { type?: string; symbol?: unknown; geometry?: { type: string; coordinates: unknown } };
      if (object.type !== 'core.multipoint' || !isSymbol(object.symbol) || object.geometry === undefined) return [];
      const { type, coordinates } = object.geometry;
      const points = (type === 'Polygon' ? (coordinates as [number, number][][])[0]?.slice(0, -1) : (coordinates as [number, number][])) ?? [];
      return [{ file, symbol: object.symbol, points }];
    });
}
