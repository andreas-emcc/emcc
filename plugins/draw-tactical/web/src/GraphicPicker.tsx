// Choosing the next graphic (brief, function 1; owner Q3, 2026-11-06; T-204, the UXA's finding P3): picture
// tiles in folding groups with one search field, in one TileGrid (one Tab stop, the arrow keys go through all
// of it). The short list of common graphics is its first groups; "All graphics", the whole catalogue of the
// standard by each entry's path, adds its folder groups below them when the user opens it, or by itself while
// a search finds something. The folders start closed (SDK 1.8.0 part G) unless a search is on. A graphic of
// the short list is also in its folder, so a tile's id says which group it is in and only the tile that was
// clicked shows as chosen.
import { useMemo, useState } from 'react';
import { TextField, TileGrid } from '@emc2/plugin-sdk';
import type { GraphicCatalogEntry, Tile, TileGroup } from '@emc2/plugin-sdk';
import type { GraphicsController } from './controller.ts';
import { GraphicThumb } from './GraphicThumb.tsx';
import { displayNames, folderGroups, keyOf, searchEntries, shortListOf } from './graphics.ts';

const SHORT = 'short/';
const ALL = 'all/';
const FOUND = 'found:';

const keyOfTile = (id: string): string => id.slice(id.indexOf('/') + 1);

export function GraphicPicker(props: {
  readonly controller: GraphicsController;
  readonly catalogue: readonly GraphicCatalogEntry[];
  readonly chosen: GraphicCatalogEntry | null;
  readonly onChoose: (key: string) => void;
}) {
  const { controller, catalogue, chosen } = props;
  const [query, setQuery] = useState('');
  const [openAll, setOpenAll] = useState(false);
  const [clicked, setClicked] = useState<string | null>(null);
  const names = useMemo(() => displayNames(catalogue), [catalogue]);
  const found = useMemo(() => searchEntries(catalogue, query, names), [catalogue, query, names]);
  const searching = query.trim() !== '';

  const { short, all } = useMemo(() => {
    const tileOf = (prefix: string, entry: GraphicCatalogEntry): Tile => ({
      id: `${prefix}${keyOf(entry)}`,
      label: names.get(keyOf(entry)) ?? entry.name,
      title: [...entry.path, entry.name].join(' › '),
      image: <GraphicThumb controller={controller} entry={entry} />,
    });
    const shortGroups: readonly TileGroup[] = shortListOf(found).map((g) => ({ id: `${SHORT}${g.label}`, label: g.label, tiles: g.entries.map((e) => tileOf(SHORT, e)) }));
    // The folders start closed (SDK 1.8.0 part G): a user opens the folder they want instead of meeting hundreds of tiles.
    // While a search is on they start open, showing the matches; that is another group id, so what the user opened or
    // closed before the search does not turn the matches shut.
    const allGroups: readonly TileGroup[] = folderGroups(found, names).map((g) => ({
      id: `${ALL}${searching ? FOUND : ''}${g.id}`,
      label: `${g.label} (${String(g.entries.length)})`,
      tiles: g.entries.map((e) => tileOf(ALL, e)),
      closed: !searching,
    }));
    return { short: shortGroups, all: allGroups };
  }, [found, names, controller, searching]);

  // The chosen tile: the one the user clicked if it is still the chosen graphic, else the first tile of that graphic.
  const chosenKey = chosen === null ? null : keyOf(chosen);
  const selected =
    chosenKey === null
      ? null
      : clicked !== null && keyOfTile(clicked) === chosenKey
        ? clicked
        : (short.flatMap((g) => g.tiles).find((t) => keyOfTile(t.id) === chosenKey)?.id ?? all.flatMap((g) => g.tiles).find((t) => keyOfTile(t.id) === chosenKey)?.id ?? null);
  const showAll = openAll || searching;
  const choose = (id: string) => {
    setClicked(id);
    props.onChoose(keyOfTile(id));
  };
  const groups: readonly TileGroup[] = showAll ? [...short, ...all] : short;
  return (
    <div className="draw-tactical-picker">
      <TextField label="Find a graphic" value={query} placeholder="For example phase" spellCheck={false} autoComplete="off" onChange={setQuery} />
      {found.length === 0 ? (
        <p className="draw-tactical-hint">No graphic matches.</p>
      ) : (
        <>
          {short.length === 0 && !searching && <p className="draw-tactical-hint">None of the common graphics is in this standard. Open All graphics.</p>}
          {groups.length > 0 && <TileGrid label="Graphics" groups={groups} selected={selected} onSelect={choose} />}
          <button
            type="button"
            className="draw-tactical-all-head"
            aria-expanded={showAll}
            onClick={() => {
              setOpenAll((open) => !open);
            }}
          >
            {`All graphics (${String(found.length)})`}
          </button>
        </>
      )}
    </div>
  );
}
