// What the control does, apart from React: it reads the tree when the menu opens, adds the current
// view, goes to a bookmark and says what went wrong. The component only draws its state.
import type { CoordinateService, MapView, Notification } from '@emc2/plugin-sdk';
import { distanceMetres, formatDecimalDegrees, wrapLongitude } from './geo.ts';
import type { BookmarkStore, UpdateResult } from './store.ts';
import {
  EMPTY_TREE,
  MAX_DEPTH,
  MAX_NAME_LENGTH,
  addBookmark,
  addFolder,
  countItems,
  findItem,
  folderLevel,
  move,
  moveTargets,
  parentOf,
  pathOf,
  remove,
  removalContents,
  rename,
  type BookmarkView,
  type Contents,
  type Outcome,
  type Refusal,
  type Tree,
  type TreeItem,
  type Unreadable,
} from './tree.ts';

export interface ControllerDeps {
  readonly store: BookmarkStore;
  readonly newId: () => string;
  /** The shell's notification: how a bookmark that was gone to tells the user what it could not do (the menu is closed by then). */
  readonly notify: (notification: Notification) => void;
  /** For what no one expected (a bug, not a lost connection): logged, and the menu says that something went wrong. */
  readonly logError: (message: string, error: unknown) => void;
  readonly maxItems: number;
}

/** What the stored document is, as far as the control knows. */
export type Document =
  | { readonly status: 'unknown' }
  | { readonly status: 'ok' }
  | { readonly status: 'unreadable'; readonly reason: Unreadable }
  | { readonly status: 'unavailable' };

export interface ControlState {
  /** `waiting`: the map view is not known yet. `none`: there is none, the control is switched off. */
  readonly map: 'waiting' | 'ready' | 'none';
  readonly loading: boolean;
  readonly document: Document;
  readonly tree: Tree;
  /** The folder open in the menu, where "Add bookmark" puts the new one; `null` is the top level. */
  readonly folderId: string | null;
  readonly expanded: ReadonlySet<string>;
  /** Edit mode: choosing a row selects it for Rename, Move to… and Delete, instead of going to a bookmark. */
  readonly editing: boolean;
  /** The row selected in edit mode. */
  readonly selectedId: string | null;
  /** A change is being saved: buttons that send one are off meanwhile. */
  readonly busy: boolean;
  /** Why the last change failed, shown in the menu. */
  readonly error: string | null;
  readonly maxItems: number;
}

/** What "Add bookmark" has taken from the map when the form opens. */
export interface Draft {
  readonly view: BookmarkView;
  readonly name: string;
  readonly folderId: string | null;
}

export type SaveResult = { readonly saved: true } | { readonly saved: false; readonly nameError: string | null };

type Listener = () => void;

/** Why a change was refused, in words. */
export function describeRefusal(reason: Refusal, maxItems: number): string {
  switch (reason) {
    case 'bad-name':
      return `A name has 1 to ${String(MAX_NAME_LENGTH)} characters.`;
    case 'bad-view':
      return 'The map view cannot be saved: its centre or zoom is not valid.';
    case 'limit':
      return `You can keep at most ${String(maxItems)} bookmarks and folders.`;
    case 'too-deep':
      return 'Folders can go five levels deep, no deeper.';
    case 'not-found':
      return 'That folder or bookmark is gone; it was probably removed in another browser.';
    case 'not-a-folder':
      return 'That is not a folder.';
    case 'into-itself':
      return 'A folder cannot be moved into itself.';
    case 'duplicate-id':
      return 'That bookmark already exists.';
  }
}

function describeFailure(result: Exclude<UpdateResult, { status: 'saved' | 'refused' }>, maxItems: number): string {
  if (result.status === 'unreadable') return 'Your bookmarks cannot be read, so nothing was changed.';
  switch (result.problem) {
    case 'too-large':
      return `Your bookmarks take up all the room that is allowed (and fewer than the ${String(maxItems)} you may keep); delete some to add more.`;
    case 'user-full':
      return 'The server has no room left for your documents.';
    case 'unavailable':
      return 'The server did not answer; nothing was saved. Try again.';
    case 'bad-name':
    case 'too-many':
      return 'The server refused the bookmarks.';
  }
}

export class BookmarksController {
  readonly #deps: ControllerDeps;
  readonly #listeners = new Set<Listener>();
  #map: MapView | null = null;
  #coordinates: CoordinateService | null = null;
  #state: ControlState;

  constructor(deps: ControllerDeps) {
    this.#deps = deps;
    this.#state = { map: 'waiting', loading: false, document: { status: 'unknown' }, tree: EMPTY_TREE, folderId: null, expanded: new Set(), editing: false, selectedId: null, busy: false, error: null, maxItems: deps.maxItems };
  }

  getState = (): ControlState => this.#state;

  subscribe = (listener: Listener): (() => void) => {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  };

  #set(change: Partial<ControlState>): void {
    this.#state = { ...this.#state, ...change };
    for (const listener of [...this.#listeners]) listener();
  }

  // -- what the control gets from the plugin ------------------------------------------------

  /** The map view, or null when there is none (the control then stays, switched off). */
  setMap(map: MapView | null): void {
    this.#map = map;
    this.#set({ map: map === null ? 'none' : 'ready' });
  }

  setCoordinates(coordinates: CoordinateService | null): void {
    this.#coordinates = coordinates;
  }

  setMaxItems(maxItems: number): void {
    this.#set({ maxItems });
  }

  #unexpected(error: unknown): void {
    this.#deps.logError('the bookmarks control failed', error);
    this.#set({ loading: false, error: 'Something went wrong, and nothing was changed. Try again.' });
  }

  // -- the menu --------------------------------------------------------------------------------

  /** The menu opens: the newest tree is read again, and the last failure is forgotten. */
  async opened(): Promise<void> {
    this.#set({ loading: true, error: null });
    let loaded;
    try {
      loaded = await this.#deps.store.load();
    } catch (error) {
      this.#unexpected(error);
      return;
    }
    if (loaded.status === 'ok') {
      this.#set({ loading: false, document: { status: 'ok' }, ...this.#following(loaded.tree) });
    } else if (loaded.status === 'unreadable') {
      this.#set({ loading: false, document: { status: 'unreadable', reason: loaded.reason }, tree: EMPTY_TREE, folderId: null, selectedId: null, editing: false });
    } else {
      this.#set({ loading: false, document: { status: 'unavailable' } });
    }
  }

  /** A folder is opened or closed in the menu. The one just opened is where new bookmarks go; closing one goes back to the folder above it. */
  toggleFolder(id: string): void {
    const expanded = new Set(this.#state.expanded);
    const selection = this.#state.editing ? { selectedId: id } : {};
    if (expanded.has(id)) {
      expanded.delete(id);
      this.#set({ expanded, folderId: parentOf(this.#state.tree, id) ?? null, ...selection });
    } else {
      expanded.add(id);
      this.#set({ expanded, folderId: id, ...selection });
    }
  }

  /** What the open menu keeps of its place after the tree changed: the open folder, the open folders and the selected row, as far as they still exist. */
  #following(tree: Tree): Pick<ControlState, 'tree' | 'folderId' | 'expanded' | 'selectedId'> {
    const { folderId, expanded, selectedId } = this.#state;
    const folderStays = folderId === null || findItem(tree, folderId)?.type === 'folder';
    return {
      tree,
      folderId: folderStays ? folderId : null,
      expanded: new Set([...expanded].filter((id) => findItem(tree, id)?.type === 'folder')),
      selectedId: selectedId !== null && findItem(tree, selectedId) !== null ? selectedId : null,
    };
  }

  // -- edit mode -------------------------------------------------------------------------------

  /** Edit mode on or off; leaving it forgets the selection. */
  setEditing(editing: boolean): void {
    this.#set({ editing, selectedId: null });
  }

  /** Selects a row in edit mode (a folder is selected by opening or closing it). */
  select(id: string): void {
    if (this.#state.editing) this.#set({ selectedId: id });
  }

  /** The selected row, or null. */
  selectedItem(): TreeItem | null {
    const { tree, selectedId } = this.#state;
    return selectedId === null ? null : findItem(tree, selectedId);
  }

  /** The path of the folder that is open in the menu, for the form ("Top level" is the empty path). */
  folderPath(): readonly string[] {
    return pathOf(this.#state.tree, this.#state.folderId);
  }

  // -- adding the current view -------------------------------------------------------------

  /** Why "Add bookmark" is off, or null when it is on. */
  addBlockedReason(): string | null {
    const { map, document, tree, maxItems } = this.#state;
    if (map !== 'ready') return 'No map view';
    if (document.status === 'unreadable') return 'Your bookmarks cannot be read';
    if (document.status === 'unavailable') return 'Your bookmarks could not be loaded';
    if (countItems(tree.items) >= maxItems) return `The limit of ${String(maxItems)} bookmarks and folders is reached`;
    return null;
  }

  /** Why "New folder" is off, or null when it is on: the same reasons, and folders go no deeper than five levels. */
  folderBlockedReason(): string | null {
    const { map, document, tree, maxItems, folderId } = this.#state;
    if (map === 'ready' && document.status !== 'unreadable' && document.status !== 'unavailable' && countItems(tree.items) < maxItems) {
      return folderLevel(tree, folderId) + 1 > MAX_DEPTH ? `Folders go ${String(MAX_DEPTH)} levels deep, and this one is on level ${String(MAX_DEPTH)}` : null;
    }
    return this.addBlockedReason();
  }

  /** Takes the map's current view and proposes a name (function 2). Null when there is no map view. */
  beginAdd(): Draft | null {
    const map = this.#map;
    if (map === null) return null;
    const { center, resolution } = map.viewport;
    const centre = [wrapLongitude(center[0]), center[1]] as const;
    const proposed = this.#coordinates?.format(centre) ?? formatDecimalDegrees(centre);
    return {
      view: { mapType: map.mapType, center: centre, resolution },
      name: Array.from(proposed).slice(0, MAX_NAME_LENGTH).join(''),
      folderId: this.#state.folderId,
    };
  }

  /** Saves the draft under `name`, in the folder it was begun in, at the end of it. */
  saveAdd(draft: Draft, name: string): Promise<SaveResult> {
    const { maxItems } = this.#state;
    return this.#apply((tree) => addBookmark(tree, draft.folderId, { id: this.#deps.newId(), name, view: draft.view }, maxItems));
  }

  // -- folders, renaming, deleting, moving -----------------------------------------------------

  /** A new empty folder at the end of the folder that is open in the menu. */
  addFolder(name: string): Promise<SaveResult> {
    const { maxItems, folderId } = this.#state;
    return this.#apply((tree) => addFolder(tree, folderId, this.#deps.newId(), name, maxItems));
  }

  rename(id: string, name: string): Promise<SaveResult> {
    return this.#apply((tree) => rename(tree, id, name));
  }

  /** What goes with a folder when it is deleted, for the confirmation: null for an unknown id, nothing for a bookmark or an empty folder. */
  contentsOf(id: string): Contents | null {
    return removalContents(this.#state.tree, id);
  }

  /** Deletes a bookmark, or a folder with everything in it. The component asks first for a folder that holds anything. */
  remove(id: string): Promise<SaveResult> {
    return this.#apply((tree) => remove(tree, id));
  }

  /** The places an item may be moved to, for "Move to…". */
  targetsFor(id: string): readonly { readonly parentId: string | null; readonly label: string }[] {
    return moveTargets(this.#state.tree, id).map((t) => ({ parentId: t.parentId, label: t.path.length === 0 ? 'Top level' : t.path.join(' / ') }));
  }

  /** Whether an item may be dropped into a folder (`null`: the top level) at all, for the tree's "not allowed" mark while dragging. */
  canMove(id: string, parentId: string | null): boolean {
    return move(this.#state.tree, id, parentId).ok;
  }

  /** Moves an item to the end of a folder, or before a position in it (`index`, as the model's `move` defines it, for drag and drop). */
  moveTo(id: string, parentId: string | null, index?: number): Promise<SaveResult> {
    return this.#apply((tree) => move(tree, id, parentId, index));
  }

  /** One change to the newest tree: read again, changed, written. A change that is refused or fails says why in the menu and writes nothing. */
  async #apply(change: (tree: Tree) => Outcome): Promise<SaveResult> {
    if (this.#state.busy) return { saved: false, nameError: null };
    this.#set({ busy: true, error: null });
    try {
      const { maxItems } = this.#state;
      const result = await this.#deps.store.update(change);
      if (result.status === 'saved') {
        this.#set({ document: { status: 'ok' }, ...this.#following(result.tree) });
        return { saved: true };
      }
      if (result.status === 'refused') {
        if (result.reason === 'bad-name') return { saved: false, nameError: describeRefusal(result.reason, maxItems) };
        this.#set({ error: describeRefusal(result.reason, maxItems) });
        if (result.reason === 'not-found') await this.refreshTree();
        return { saved: false, nameError: null };
      }
      if (result.status === 'unreadable') this.#set({ document: { status: 'unreadable', reason: result.reason } });
      this.#set({ error: describeFailure(result, maxItems) });
      return { saved: false, nameError: null };
    } catch (error) {
      this.#unexpected(error);
      return { saved: false, nameError: null };
    } finally {
      this.#set({ busy: false });
    }
  }

  /**
   * Reads the newest tree again, keeping any message: after a change found that something is gone, and
   * before the question that a delete asks, so that its counts are the newest. It never rejects.
   */
  async refreshTree(): Promise<void> {
    try {
      const loaded = await this.#deps.store.load();
      if (loaded.status === 'ok') this.#set(this.#following(loaded.tree));
    } catch (error) {
      this.#unexpected(error);
    }
  }

  // -- going to a bookmark -----------------------------------------------------------------

  /**
   * Sets the map type, then the centre and the zoom (function 3). A projection or background that is gone falls back and is
   * announced by the map view (`setMapType`); `goTo` says nothing when it centres elsewhere, so the plugin tells that.
   */
  goTo(id: string): void {
    const map = this.#map;
    if (map === null) return;
    const bookmark = findItem(this.#state.tree, id);
    if (bookmark?.type !== 'bookmark') {
      this.#deps.notify({ severity: 'warning', message: 'That bookmark is gone; it was probably removed in another browser.' });
      return;
    }
    const applied = map.setMapType(bookmark.mapType);
    map.goTo(bookmark.center, bookmark.resolution);
    // goTo centres on the nearest point the projection can show, and the viewport tells where it went (owner, 2026-10-12);
    // the brief says the same and asks for the notice (function 3, CR-0016 option B).
    const shown = map.viewport.center;
    if (distanceMetres(shown, bookmark.center) > Math.max(1, bookmark.resolution)) {
      this.#deps.notify({
        severity: 'warning',
        message: `${bookmark.name}: The centre ${this.#name(bookmark.center)} cannot be shown in ${applied.projection}; the map shows the nearest point it can.`,
      });
    }
  }

  #name(position: readonly [number, number]): string {
    return this.#coordinates?.format(position) ?? formatDecimalDegrees(position);
  }

  // -- a document that cannot be read ----------------------------------------------------------

  /** Replaces an unreadable document with an empty tree. The component asks the user first. */
  async startEmpty(): Promise<void> {
    this.#set({ busy: true, error: null });
    try {
      const result = await this.#deps.store.startEmpty();
      if (result.status === 'saved') this.#set({ tree: result.tree, document: { status: 'ok' }, folderId: null, expanded: new Set(), selectedId: null, editing: false });
      else if (result.status === 'failed') this.#set({ error: describeFailure(result, this.#state.maxItems) });
    } catch (error) {
      this.#unexpected(error);
    } finally {
      this.#set({ busy: false });
    }
  }
}
