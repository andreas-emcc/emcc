// The kinds of shape this plugin draws (brief, function 1), and how a kind relates to the
// geometry the map view's drawing service returns (ADR-0033 point 4).
import type { DrawKind, Geometry } from '@emc2/plugin-sdk';

export const SHAPE_KINDS = ['circle', 'ellipse', 'square', 'rectangle', 'polygon', 'arrow', 'route'] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

export const KIND_LABELS: Readonly<Record<ShapeKind, string>> = {
  circle: 'Circle',
  ellipse: 'Ellipse',
  square: 'Square',
  rectangle: 'Rectangle',
  polygon: 'Area',
  arrow: 'Arrow',
  route: 'Route',
};

/** "a circle", "an ellipse", "an Area": the word with its indefinite article. */
export function withArticle(word: string): string {
  return `${/^[aeiou]/i.test(word) ? 'an' : 'a'} ${word}`;
}

export function isShapeKind(value: unknown): value is ShapeKind {
  return typeof value === 'string' && (SHAPE_KINDS as readonly string[]).includes(value);
}

/** The drawing service has one kind for lines: an arrow and a route differ in their style only. */
export function drawKindOf(kind: ShapeKind): DrawKind {
  return kind === 'arrow' || kind === 'route' ? 'line' : kind;
}

/** The geometry type the drawing service returns for a kind: squares and rectangles as polygons. */
export function geometryTypeOf(kind: ShapeKind): Geometry['type'] {
  switch (kind) {
    case 'circle':
      return 'Circle';
    case 'ellipse':
      return 'Ellipse';
    case 'square':
    case 'rectangle':
    case 'polygon':
      return 'Polygon';
    case 'arrow':
    case 'route':
      return 'LineString';
  }
}

/** Kinds that enclose an area, and so have a fill. */
export function hasArea(kind: ShapeKind): boolean {
  return geometryTypeOf(kind) !== 'LineString';
}

/** Geometries that have an area (a fill applies to them). */
export function isAreaGeometry(geometry: Geometry): boolean {
  return ['Polygon', 'Circle', 'Ellipse', 'Corridor', 'ArcBand'].includes(geometry.type);
}

/** Geometries the map view's editing service reshapes (brief, function 4). Others show their properties only. */
export function isReshapable(geometry: Geometry): boolean {
  return ['Circle', 'Ellipse', 'Polygon', 'LineString'].includes(geometry.type);
}

/** Geometries the map view's `append` continues: lines only (brief, function 19; owner, QH A). */
export function isAppendable(geometry: Geometry): boolean {
  return geometry.type === 'LineString';
}

/** The name of a geometry for a shape without a kind of ours (made by another plugin, or the kind no longer fits). */
export function geometryLabel(geometry: Geometry): string {
  switch (geometry.type) {
    case 'Point':
      return 'Point';
    case 'MultiPoint':
      return 'Points';
    case 'LineString':
      return 'Line';
    case 'Polygon':
      return 'Area';
    case 'Circle':
      return 'Circle';
    case 'Ellipse':
      return 'Ellipse';
    case 'Corridor':
      return 'Corridor';
    case 'ArcBand':
      return 'Arc band';
  }
}
