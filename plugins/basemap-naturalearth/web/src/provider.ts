import type { BackgroundMapProvider, VectorFeature, VectorLayer } from '@emc2/plugin-sdk';

/** The shipped data file, relative to the plugin's built files (`ctx.webBase`). Made by the build from the originals in `data/`. */
export const DATA_FILE = 'data/natural-earth.json';

/** Water: the colour under all layers. There is no ocean layer. */
export const WATER = '#d3dfe9';

/** The id of the borders layer: the "Show country borders" setting leaves it out. */
export const BORDERS_LAYER = 'borders';

/**
 * The layers in drawing order, first at the bottom, with the ids the build gives the features
 * (`scripts/convert.ts`). Muted on purpose, so the map does not compete with the symbols. Polygon
 * layers have a fill and no outline, so the cuts at ±180° do not show.
 */
const LAYERS: readonly VectorLayer[] = [
  { id: 'land', style: { fillColor: '#ebe7dc' } },
  { id: 'ice-shelves', style: { fillColor: '#f6f7f5' } },
  { id: 'lakes', style: { fillColor: WATER } },
  { id: 'coastline', style: { strokeColor: '#8d9aa5', strokeWidth: 0.8 } },
  { id: BORDERS_LAYER, style: { strokeColor: '#b9b3a6', strokeWidth: 0.5 } },
];

/**
 * The Natural Earth background as data: a vector source in every projection (ADR-0025). The
 * data is the plugin's own file, served by the emc2 server; no other host is reachable (ADR-0014).
 * The map view calls `load()` when the background is first shown, so nothing is fetched before.
 */
export function createProvider(webBase: string, showBorders: boolean): BackgroundMapProvider {
  const layers = showBorders ? LAYERS : LAYERS.filter((layer) => layer.id !== BORDERS_LAYER);
  const known = new Set(layers.map((layer) => layer.id));
  return {
    id: 'natural-earth',
    name: 'Natural Earth',
    projections: 'any',
    // The credit CR-0009 asks for, although the terms of use do not require it.
    attribution: { text: 'Made with Natural Earth', url: 'https://www.naturalearthdata.com/' },
    source: {
      type: 'vector',
      background: WATER,
      layers,
      async load() {
        const response = await fetch(`${webBase}${DATA_FILE}`);
        if (!response.ok) throw new Error(`Natural Earth data: HTTP ${String(response.status)}`);
        const data = (await response.json()) as { features: readonly VectorFeature[] };
        return { features: data.features.filter((feature) => known.has(feature.layer)) };
      },
    },
  };
}

/** The `showBorders` setting if it is a boolean, otherwise `null`. */
export function readShowBorders(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}
