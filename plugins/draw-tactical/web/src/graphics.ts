// What the plugin knows about the catalogue of tactical graphics (brief, function 1): how a graphic is
// found again from an object's SIDC, how it is named, the short list of common graphics, the groups of
// all of them by the folders of their path, and the search over their names. Pure functions; the catalogue itself
// comes from the symbology service (`SymbolService.graphicCatalog`), which alone understands SIDCs.
import type { GraphicCatalogEntry, MilSymbol, SymbolService, TreeNode } from '@emc2/plugin-sdk';

/** The APP-6 standards with tactical graphics (APP-6B has none, ADR-0043 point 8). */
export const GRAPHIC_STANDARDS = ['APP-6D', 'APP-6E'] as const;
export type GraphicStandard = (typeof GRAPHIC_STANDARDS)[number];

export function isGraphicStandard(value: unknown): value is GraphicStandard {
  return value === 'APP-6D' || value === 'APP-6E';
}

/** The key of a graphic in a standard: its symbol set and entity, e.g. `25110100` for the boundary. */
export function keyOf(entry: Pick<GraphicCatalogEntry, 'symbolSet' | 'entity'>): string {
  return `${entry.symbolSet}${entry.entity}`;
}

/** The graphic of a catalogue by its key, or undefined. */
export function entryByKey(catalogue: readonly GraphicCatalogEntry[], key: string | null): GraphicCatalogEntry | undefined {
  return key === null ? undefined : catalogue.find((e) => keyOf(e) === key);
}

/**
 * The graphic an object's symbol is, or null if the catalogue lacks it: an APP-6B symbol, a SIDC the
 * service cannot describe, or a code it does not draw (brief, function 6).
 */
export function entryOfSymbol(symbols: SymbolService, catalogue: readonly GraphicCatalogEntry[], symbol: MilSymbol): GraphicCatalogEntry | null {
  if (!isGraphicStandard(symbol.standard)) return null;
  try {
    const parts = symbols.describe(symbol.standard, symbol.sidc);
    return catalogue.find((e) => e.symbolSet === parts.symbolSet && e.entity === parts.entity) ?? null;
  } catch (error) {
    if (error instanceof RangeError) return null;
    throw error;
  }
}

/** How many points a graphic takes, for a hint: "2 or more", "3 to 50", "exactly 4". */
export function pointCountText(entry: GraphicCatalogEntry): string {
  const { minPoints: min, maxPoints: max } = entry;
  if (max === null) return `${String(min)} or more points`;
  if (max === min) return min === 1 ? 'exactly 1 point' : `exactly ${String(min)} points`;
  return `${String(min)} to ${String(max)} points`;
}

/** The most points of a graphic the plugin lets the user place: a `points` graphic with no limit takes its minimum. */
export function maxPointsOf(entry: GraphicCatalogEntry): number | null {
  return entry.kind === 'points' && entry.maxPoints === null ? entry.minPoints : entry.maxPoints;
}

/** Whether a number of points is within what the graphic takes. */
export function pointCountFits(entry: GraphicCatalogEntry, count: number): boolean {
  const max = maxPointsOf(entry);
  return count >= entry.minPoints && (max === null || count <= max);
}

/**
 * What each point is, for the user (brief, function 1): the `points` texts in order, numbered. When the
 * graphic takes more points than are listed, the second-to-last text describes the points in between
 * and the last one the last point; one text describes them all (`GraphicCatalogEntry.points`).
 */
export function pointGuide(entry: GraphicCatalogEntry): readonly string[] {
  const texts = entry.points;
  const count = texts.length;
  const max = entry.maxPoints;
  if (count === 0) return [];
  // Every point has its own text, or the only text is for the only point.
  if (max !== null && max <= count) return texts.map((t, i) => `${String(i + 1)}: ${t}`);
  if (count === 1) return [`1 to n: ${texts[0] ?? ''}`];
  // More points than texts: the second-to-last text is for the points in between, the last one for point n.
  const lines = texts.slice(0, count - 2).map((t, i) => `${String(i + 1)}: ${t}`);
  lines.push(`${String(count - 1)} to n−1: ${texts[count - 2] ?? ''}`);
  lines.push(`n: ${texts[count - 1] ?? ''}`);
  return lines;
}

/** A name that is shown beside others of the same name gets its place in the tree: "Block (Mission Tasks)". */
export function displayNames(catalogue: readonly GraphicCatalogEntry[]): ReadonlyMap<string, string> {
  const counts = new Map<string, number>();
  for (const e of catalogue) counts.set(e.name, (counts.get(e.name) ?? 0) + 1);
  const names = new Map<string, string>();
  for (const e of catalogue) {
    const parent = e.path[e.path.length - 1];
    names.set(keyOf(e), (counts.get(e.name) ?? 0) > 1 && parent !== undefined ? `${e.name} (${parent})` : e.name);
  }
  return names;
}

/** The tree the groups of "All graphics" are made from: the catalogue's `path` below the root all entries share; leaves are the graphics. */
export interface GraphicTree {
  readonly nodes: readonly TreeNode[];
  /** The graphic of a leaf's id. */
  readonly leaves: ReadonlyMap<string, GraphicCatalogEntry>;
}

const FOLDER = 'folder:';
const LEAF = 'graphic:';

/** The id of the tree leaf of a graphic. */
export const leafId = (entry: GraphicCatalogEntry): string => `${LEAF}${keyOf(entry)}`;

interface MutableFolder {
  readonly id: string;
  readonly label: string;
  readonly folders: Map<string, MutableFolder>;
  readonly leaves: TreeNode[];
}

/** Builds the tree of entries by their `path` (outermost first); entries may be filtered first (the search). */
export function buildTree(entries: readonly GraphicCatalogEntry[], names: ReadonlyMap<string, string>): GraphicTree {
  const root: MutableFolder = { id: FOLDER, label: '', folders: new Map(), leaves: [] };
  const leaves = new Map<string, GraphicCatalogEntry>();
  for (const entry of entries) {
    let folder = root;
    const path = entry.path;
    for (const part of path) {
      const id = `${folder.id}/${part}`;
      let next = folder.folders.get(part);
      if (next === undefined) {
        next = { id, label: part, folders: new Map(), leaves: [] };
        folder.folders.set(part, next);
      }
      folder = next;
    }
    folder.leaves.push({ id: leafId(entry), label: names.get(keyOf(entry)) ?? entry.name });
    leaves.set(leafId(entry), entry);
  }
  const convert = (folder: MutableFolder): TreeNode => ({
    id: folder.id,
    label: folder.label,
    children: [...[...folder.folders.values()].map(convert), ...folder.leaves],
  });
  // The root folder every graphic shares ("Control Measure") would be one pointless level: its children are the top level.
  const top = [...root.folders.values()];
  const nodes = top.length === 1 && root.leaves.length === 0 && top[0] !== undefined ? (convert(top[0]).children ?? []) : [...top.map(convert), ...root.leaves];
  return { nodes, leaves };
}

/** The graphics whose name, or whose place in the tree, contains every word of the query (case does not matter). */
export function searchEntries(entries: readonly GraphicCatalogEntry[], query: string, names: ReadonlyMap<string, string>): readonly GraphicCatalogEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter((w) => w !== '');
  if (words.length === 0) return entries;
  return entries.filter((e) => {
    const text = `${names.get(keyOf(e)) ?? e.name} ${e.path.join(' ')}`.toLowerCase();
    return words.every((w) => text.includes(w));
  });
}

/** One group of the short list (brief, function 1). */
export interface ShortGroup {
  readonly label: string;
  /** The keys (symbol set and entity) of the graphics, in the order shown. Both standards share them; one the catalogue lacks is not shown. */
  readonly keys: readonly string[];
}

/**
 * The short list of common graphics (owner, Q3, 2026-11-06; chosen by PCA-draw-tactical from the APP-6 D
 * catalogue, 40 graphics; the README lists them by name). The owner checks it in the browser.
 */
export const SHORT_LIST: readonly ShortGroup[] = [
  {
    label: 'Boundaries and lines',
    keys: [
      '25110100', // Boundary
      '25140100', // Forward Line of Troops
      '25140400', // Forward Edge of the Battle Area
      '25140200', // Line of Contact
      '25140300', // Phase Line
      '25141000', // Line of Departure
      '25140900', // Limit of Advance
      '25140700', // Final Coordination Line
      '25260100', // Fire Support Coordination Line
      '25260300', // No Fire Line
      '25330300', // Main Supply Route
    ],
  },
  {
    label: 'Areas',
    keys: [
      '25120100', // Area of Operations
      '25150200', // Assembly Area
      '25151700', // Objective
      '25151200', // Battle Position
      '25151300', // Engagement Area
      '25150800', // Landing Zone
      '25151600', // Attack Position
    ],
  },
  {
    label: 'Axes and tasks',
    keys: [
      '25151403', // Main Attack (axis of advance)
      '25151404', // Supporting Attack (axis of advance)
      '25140602', // Friendly Main Attack / Decisive (direction of attack)
      '25140603', // Friendly Supporting Attack (direction of attack)
      '25340700', // Counterattack by Fire
      '25340800', // Delay
      '25342400', // Withdraw
      '25340200', // Breach
      '25340100', // Block
    ],
  },
  {
    label: 'Fires and obstacles',
    keys: [
      '25240803', // Circular Target
      '25240802', // Rectangular Target
      '25240801', // Area Target
      '25242100', // Weapon/Sensor Range fan, Circular
      '25242200', // Weapon/Sensor Range fan, Sector
      '25240301', // No Fire Area, Irregular
      '25240302', // No Fire Area, Rectangular
      '25240201', // Free Fire Area, Irregular
      '25240202', // Free Fire Area, Rectangular
      '25241001', // Fire Support Area, Irregular
      '25270800', // Mined Area (a minefield)
      '25270100', // Obstacle Belt
      '25290100', // Obstacle Line
    ],
  },
];

/** The short list of a catalogue: its groups with the graphics the catalogue has, and no empty group. */
export function shortListOf(catalogue: readonly GraphicCatalogEntry[]): readonly { readonly label: string; readonly entries: readonly GraphicCatalogEntry[] }[] {
  const byKey = new Map(catalogue.map((e) => [keyOf(e), e]));
  return SHORT_LIST.map((group) => ({ label: group.label, entries: group.keys.flatMap((k) => byKey.get(k) ?? []) })).filter((g) => g.entries.length > 0);
}

/** One folder group of "All graphics" (T-204): the graphics under a folder of the catalogue's `path`, below the root all entries share. */
export interface FolderGroup {
  readonly id: string;
  readonly label: string;
  readonly entries: readonly GraphicCatalogEntry[];
}

/** A folder with more graphics than this is split into its own folders in "All graphics". */
export const BIG_GROUP = 40;

/**
 * The groups of "All graphics": one per top folder of the tree, in its order (below the root all entries share). A top
 * folder with more than {@link BIG_GROUP} graphics and folders of its own (the catalogue's symbol sets, such as Control
 * Measure) is split into those folders, named "Top › Folder", so that no group holds hundreds of tiles. Graphics outside
 * any folder form "Other graphics".
 */
export function folderGroups(entries: readonly GraphicCatalogEntry[], names: ReadonlyMap<string, string>): readonly FolderGroup[] {
  const tree = buildTree(entries, names);
  const below = (node: TreeNode): GraphicCatalogEntry[] => {
    if (node.children === undefined) {
      const entry = tree.leaves.get(node.id);
      return entry === undefined ? [] : [entry];
    }
    return node.children.flatMap(below);
  };
  const isFolder = (node: TreeNode): boolean => node.children !== undefined;
  const groups: FolderGroup[] = [];
  const loose: GraphicCatalogEntry[] = [];
  for (const node of tree.nodes) {
    if (!isFolder(node)) {
      loose.push(...below(node));
      continue;
    }
    const children = node.children ?? [];
    if (!children.some(isFolder) || below(node).length <= BIG_GROUP) {
      groups.push({ id: node.id, label: node.label, entries: below(node) });
      continue;
    }
    // A big folder: its folders are the groups, and the graphics straight under it form one of their own.
    const own = children.filter((c) => !isFolder(c)).flatMap(below);
    if (own.length > 0) groups.push({ id: node.id, label: node.label, entries: own });
    for (const child of children.filter(isFolder)) groups.push({ id: child.id, label: `${node.label} › ${child.label}`, entries: below(child) });
  }
  if (loose.length > 0) groups.push({ id: 'other', label: 'Other graphics', entries: loose });
  return groups.filter((g) => g.entries.length > 0);
}
