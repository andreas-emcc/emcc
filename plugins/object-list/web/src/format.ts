// Plain functions of the list: paging arithmetic, the cells of a row and the setting. No React and
// no plugin context, so they are tested on their own.
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@emc2/plugin-sdk';
import type { MapObject, Settings } from '@emc2/plugin-sdk';

/** The key of the draw-shapes plugin's extension that names a shape's kind (brief, function 4). */
const SHAPES_NAMESPACE = 'draw-shapes';
const NO_BREAK_SPACE = ' ';

/** The setting `pageSize`, or the default when it is missing or not a whole number from 1 to the server's limit. `bad` says whether it was invalid. */
export function pageSizeOf(settings: Settings): { readonly size: number; readonly bad: boolean } {
  const value = settings['pageSize'];
  if (value === undefined) return { size: DEFAULT_PAGE_SIZE, bad: false };
  if (typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_PAGE_SIZE) return { size: value, bad: false };
  return { size: DEFAULT_PAGE_SIZE, bad: true };
}

/** The index of the last page (0-based); 0 for an empty layer. */
export function lastPageIndex(total: number, pageSize: number): number {
  return total <= 0 ? 0 : Math.ceil(total / pageSize) - 1;
}

/** A whole number with a no-break space between the thousands: 12 345. */
export function groupDigits(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, NO_BREAK_SPACE);
}

/** "1–100 of 12 345": the objects of a page among all of the layer's. */
export function rangeText(pageIndex: number, pageSize: number, shown: number, total: number): string {
  const first = pageIndex * pageSize + 1;
  return `${groupDigits(first)}–${groupDigits(first + shown - 1)} of ${groupDigits(total)}`;
}

/** "1 object", "12 345 objects". */
export function countText(n: number): string {
  return `${groupDigits(n)} ${n === 1 ? 'object' : 'objects'}`;
}

export const NO_NAME = '(no name)';

export function nameOf(object: MapObject): string {
  const name = object.properties?.name;
  return name === undefined || name.trim() === '' ? NO_NAME : name;
}

/**
 * What kind of object this is: "Symbol" for a symbol; for a shape the kind that `draw-shapes`
 * documents under its extension key `kind` (capitalised); otherwise the geometry type.
 */
export function kindOf(object: MapObject): string {
  if (object.type === 'core.symbol') return 'Symbol';
  const kind = object.extensions?.[SHAPES_NAMESPACE]?.['kind'];
  if (typeof kind === 'string' && kind !== '') return kind.charAt(0).toUpperCase() + kind.slice(1);
  return object.geometry.type;
}

/** An instant in UTC, to the second: 2026-10-16 12:00:00Z. Anything that is not an instant is shown as it is. */
export function modifiedText(timestamp: string): string {
  const t = new Date(timestamp);
  return Number.isNaN(t.getTime()) ? timestamp : t.toISOString().slice(0, 19).replace('T', ' ') + 'Z';
}

/** The cells of one row, all as text. */
export interface RowCells {
  readonly name: string;
  readonly kind: string;
  readonly dataType: string;
  readonly dataSource: string;
  readonly classification: string;
  readonly modified: string;
}

/** `dataTypeName` gives a data type's display name; a data type not in the list shows its id. */
export function cellsOf(object: MapObject, dataTypeName: (id: string) => string | undefined): RowCells {
  return {
    name: nameOf(object),
    kind: kindOf(object),
    dataType: dataTypeName(object.dataType) ?? object.dataType,
    dataSource: object.dataSource,
    classification: object.label.classification,
    modified: modifiedText(object.meta.modified.at),
  };
}

/** The tooltip of a row: everything the narrow layout hides (brief, function 4). */
export function tooltipOf(cells: RowCells): string {
  return `${cells.name}\nKind: ${cells.kind}\nData type: ${cells.dataType}\nData source: ${cells.dataSource}\nClassification: ${cells.classification}\nModified: ${cells.modified}`;
}
