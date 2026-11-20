/**
 * The OpenLayers layers of a WMS background (brief function 3, M4; ADR-0035): a grid of `tileSize`
 * images in `'tiles'` mode, one image per view in `'image'` mode. OpenLayers draws the images;
 * the request URLs are the map view's own ({@link wmsRequestUrl}), because OpenLayers' WMS sources
 * take the axis order from the projection object and ask for fractional sizes, and the contract
 * with the plugin's server part names both.
 */
import type { WmsSource } from '@emc2/plugin-sdk';
import { decode, type Loader } from 'ol/Image.js';
import type ImageTile from 'ol/ImageTile.js';
import ImageLayer from 'ol/layer/Image.js';
import TileLayer from 'ol/layer/Tile.js';
import type BaseLayer from 'ol/layer/Base.js';
import { get as getOlProjection } from 'ol/proj.js';
import ImageSource from 'ol/source/Image.js';
import XYZ from 'ol/source/XYZ.js';
import TileGrid from 'ol/tilegrid/TileGrid.js';
import { clampBox, clipBox, DEFAULT_WMS_TILE_SIZE, imageSize, wmsGrid, wmsRequestUrl, type Box } from '../core/wms.ts';
import type { Projection } from '../core/projections.ts';

/** The deepest zoom level of a WMS tile grid. */
const MAX_ZOOM = 22;
/** A single image covers the view and half of it more on each side, so a small pan needs no new request. */
const IMAGE_RATIO = 1.5;

/** Loads an image from a URL; replaced in tests. */
export type LoadImage = (image: HTMLImageElement, src: string) => Promise<HTMLImageElement>;

const loadImage: LoadImage = (image, src) => decode(image, src) as Promise<HTMLImageElement>;

/**
 * The layer of a `wms` source in a projection, under all object layers; null if the projection's
 * extent cannot be cut into tiles that stay inside it (see {@link wmsGrid}).
 */
export function wmsLayer(source: WmsSource, projection: Projection, attribution: string, load: LoadImage = loadImage): BaseLayer | null {
  const code = projection.def.code;
  const extent: Box = projection.def.extent;
  const olProjection = getOlProjection(code);
  if (olProjection === null) return null;
  if (source.mode === 'image') {
    const loader = wmsImageLoader(source, code, extent, load);
    return new ImageLayer({ zIndex: 0, source: new ImageSource({ projection: olProjection, loader, attributions: attribution }) });
  }
  const grid = wmsGrid(extent);
  if (grid === null) return null;
  const tileGrid = wmsTileGrid(source, extent, grid.ground);
  const tileSize = source.tileSize ?? DEFAULT_WMS_TILE_SIZE;
  return new TileLayer({
    zIndex: 0,
    // The same source as the xyz backgrounds', with the grid and the URLs of the WMS.
    source: new XYZ({
      projection: olProjection,
      tileGrid,
      wrapX: projection.wrapsX,
      attributions: attribution,
      // Called with the tile's coordinates wrapped into the extent (OpenLayers wraps them for wrapX).
      tileUrlFunction: (tileCoord) => {
        const box = clampBox(tileGrid.getTileCoordExtent(tileCoord) as unknown as Box, extent); // a request never goes beyond the extent
        return wmsRequestUrl(source, code, box, tileSize, tileSize);
      },
      tileLoadFunction: (tile, src) => {
        // A failed image leaves its tile empty; the map stays usable.
        load((tile as ImageTile).getImage() as HTMLImageElement, src).catch(() => undefined);
      },
    }),
  });
}

/** The tile grid of a projection's extent: from its top left corner, `ground` map units per tile at the top level. */
export function wmsTileGrid(source: WmsSource, extent: Box, ground: number): TileGrid {
  const tileSize = source.tileSize ?? DEFAULT_WMS_TILE_SIZE;
  return new TileGrid({
    extent: [...extent],
    origin: [extent[0], extent[3]],
    tileSize,
    resolutions: Array.from({ length: MAX_ZOOM + 1 }, (_, z) => ground / tileSize / 2 ** z),
  });
}

/**
 * The loader of a single image: the view's box and half of it more around, cut at the extent, at
 * the view's resolution; a view too large for 4 096 pixels asks for a smaller image, which
 * OpenLayers draws scaled up: the image says its own resolution, the box over its whole-number size,
 * because OpenLayers sizes a drawn image from its resolution. A view wholly outside the extent asks for nothing.
 */
export function wmsImageLoader(source: WmsSource, code: string, extent: Box, load: LoadImage = loadImage): Loader {
  return (viewExtent, resolution) => {
    const [minX, minY, maxX, maxY] = viewExtent as unknown as Box;
    const growX = ((maxX - minX) * (IMAGE_RATIO - 1)) / 2;
    const growY = ((maxY - minY) * (IMAGE_RATIO - 1)) / 2;
    const box = clipBox([minX - growX, minY - growY, maxX + growX, maxY + growY], extent);
    if (box === null) return Promise.reject(new Error('the view is outside the projection extent'));
    const [width, height] = imageSize(box, resolution);
    return load(new Image(), wmsRequestUrl(source, code, box, width, height)).then((image) => ({ image, extent: [...box], pixelRatio: 1, resolution: [(box[2] - box[0]) / width, (box[3] - box[1]) / height] }));
  };
}
