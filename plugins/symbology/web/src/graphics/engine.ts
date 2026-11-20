// mil-sym-ts behind the catalogue and the drawing. Loaded only in the graphics worker (and by tests
// in Node): the main thread never imports this module, so it never loads mil-sym-ts's 9.6 MB.
import type { GraphicCatalogEntry, GraphicRenderRequest } from '@emc2/plugin-sdk';
import { DrawRules, MSLookup, WebRenderer } from '@armyc2.c5isr.renderer/mil-sym-ts-web';
import { withApp6Colours } from './colours.ts';
import { buildCatalogue, RENDERER_VERSIONS, type GraphicStandard, type LookupEntry } from './catalogue.ts';
import { byKey, parse, prepare, type Parsed, type RendererCall } from './render.ts';

/** mil-sym-ts's `ErrorLogger` level for severe messages only: refusals are reported, not logged. */
const SEVERE = 1000;

/** The names of mil-sym-ts's draw rules by their numbers. */
const RULE_NAMES: ReadonlyMap<number, string> = new Map(
  Object.entries(DrawRules)
    .filter((entry): entry is [string, number] => typeof entry[1] === 'number')
    .map(([name, value]) => [value, name]),
);

/** Every symbol of mil-sym-ts's lookup for a version, as the catalogue reads it. */
export function* lookupEntries(version: number): Generator<LookupEntry> {
  const lookup = MSLookup.getInstance();
  for (const basicId of lookup.getIDList(version)) {
    const info = lookup.getMSLInfo(basicId, version);
    yield {
      basicId,
      name: info.getName(),
      path: info.getPath(),
      geometry: info.getGeometry(),
      drawRule: RULE_NAMES.get(info.getDrawRule()) ?? String(info.getDrawRule()),
      minPoints: info.getMinPointCount(),
      maxPoints: info.getMaxPointCount(),
      modifiers: info.getModifiers(),
    };
  }
}

/** mil-sym-ts's `RenderSymbol` with GeoJSON output, for one prepared call. */
export function callRenderer(call: RendererCall): string {
  return WebRenderer.RenderSymbol('graphic', '', '', call.sidc, call.points, 'clampToGround', call.scale, call.bbox, new Map(call.modifiers), new Map(), WebRenderer.OUTPUT_FORMAT_GEOJSON);
}

export interface Engine {
  catalogue(standard: GraphicStandard): readonly GraphicCatalogEntry[];
  render(request: GraphicRenderRequest): Parsed;
}

/** The catalogue (built once per standard) and the drawing, with `renderer` replaceable in tests. */
export function createEngine(renderer: (call: RendererCall) => string = callRenderer): Engine {
  WebRenderer.setLoggingLevel(SEVERE);
  const catalogues = new Map<GraphicStandard, readonly GraphicCatalogEntry[]>();
  const keyed = new Map<GraphicStandard, ReturnType<typeof byKey>>();
  const catalogue = (standard: GraphicStandard): readonly GraphicCatalogEntry[] => {
    let entries = catalogues.get(standard);
    if (entries === undefined) {
      entries = Object.freeze(buildCatalogue(standard, lookupEntries(RENDERER_VERSIONS[standard])));
      catalogues.set(standard, entries);
    }
    return entries;
  };
  const keyedCatalogue = (standard: GraphicStandard): ReturnType<typeof byKey> => {
    let map = keyed.get(standard);
    if (map === undefined) {
      map = byKey(catalogue(standard));
      keyed.set(standard, map);
    }
    return map;
  };
  return {
    catalogue,
    render(request) {
      const call = prepare(request, keyedCatalogue);
      if ('ok' in call) return { rendering: call, transfer: [] };
      try {
        const parsed = parse(renderer(call));
        // APP-6 E's colours where mil-sym-ts's differ (section 8.1.4, owner YE B).
        return { ...parsed, rendering: withApp6Colours(parsed.rendering, request.sidc) };
      } catch (e) {
        return { rendering: { ok: false, reason: `the renderer failed: ${e instanceof Error ? e.message : String(e)}` }, transfer: [] };
      }
    },
  };
}
