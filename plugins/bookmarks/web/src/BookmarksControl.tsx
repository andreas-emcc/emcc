import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type SyntheticEvent } from 'react';
import { Bookmark, BookmarkPlus, Folder, FolderPlus, Pencil } from 'lucide-react';
import { Button, ConfirmDialog, IconButton, Menu, Notice, Popover, TextField, Tree, type TreeNode } from '@emc2/plugin-sdk';
import type { BookmarksController, Draft, SaveResult } from './controller.ts';
import { findItem, type Contents, type TreeItem } from './tree.ts';

function toNodes(items: readonly TreeItem[]): readonly TreeNode[] {
  return items.map((item): TreeNode => (item.type === 'folder' ? { id: item.id, label: item.name, icon: Folder, children: toNodes(item.children) } : { id: item.id, label: item.name, icon: Bookmark }));
}

/** What the menu shows below its buttons: the tree, or one small form or choice that replaces it. */
type Panel =
  | { readonly kind: 'list' }
  | { readonly kind: 'add'; readonly draft: Draft }
  | { readonly kind: 'folder' }
  | { readonly kind: 'rename'; readonly id: string }
  | { readonly kind: 'move'; readonly id: string };

const LIST: Panel = { kind: 'list' };

const plural = (n: number, noun: string) => `${String(n)} ${noun}${n === 1 ? '' : 's'}`;

/** "This also deletes 3 bookmarks and 1 folder." */
function describeContents(contents: Contents): string {
  const parts = [contents.bookmarks > 0 ? plural(contents.bookmarks, 'bookmark') : null, contents.folders > 0 ? plural(contents.folders, 'folder') : null].filter((p) => p !== null);
  return `This also deletes ${parts.join(' and ')}.`;
}

function NameForm(props: {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly error: string | undefined;
  readonly hint: string;
  readonly submitLabel: string;
  readonly busy: boolean;
  readonly onSubmit: () => void;
  readonly onCancel: () => void;
}) {
  const submit = (event: SyntheticEvent) => {
    event.preventDefault();
    props.onSubmit();
  };
  return (
    <form className="bookmarks-form" onSubmit={submit}>
      <TextField label="Name" value={props.value} onChange={props.onChange} {...(props.error === undefined ? {} : { error: props.error })} />
      <p className="bookmarks-hint">{props.hint}</p>
      <div className="bookmarks-form-buttons">
        <Button onClick={props.onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={props.busy}>
          {props.submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** The bookmarks control in the top bar (brief function 1): a button and, below it, a menu with the tree and the actions on it. */
export function BookmarksControl(props: { readonly controller: BookmarksController }) {
  const { controller } = props;
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const [open, setOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>(LIST);
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ readonly id: string; readonly name: string; readonly contents: Contents } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const off = state.map !== 'ready';
  // Without a map view the control is off and its menu is not shown, whatever was open.
  const shown = open && !off;

  const toList = () => {
    setPanel(LIST);
    setNameError(undefined);
  };

  const close = useCallback(
    (returnFocus: boolean) => {
      setOpen(false);
      setPanel(LIST);
      setNameError(undefined);
      controller.setEditing(false);
      if (returnFocus) rootRef.current?.querySelector<HTMLElement>(':scope > button')?.focus();
    },
    [controller],
  );

  // The focus moves into the menu when it opens, and stays in it when a form comes or goes, so that
  // the keyboard (Escape above all) works at once: the name field for a form, else the first button.
  const needsInput = panel.kind === 'add' || panel.kind === 'folder' || panel.kind === 'rename';
  const documentStatus = state.document.status;
  useEffect(() => {
    if (!shown) return;
    const target = bodyRef.current?.querySelector<HTMLElement>(needsInput ? 'input' : 'button, input');
    target?.focus();
    // The proposed or old name is selected, so that typing replaces it (found in the browser: typing added to it).
    if (needsInput && target instanceof HTMLInputElement) target.select();
  }, [shown, needsInput, panel.kind, documentStatus]);

  /** The focus back into the menu, on its first enabled button, after something that held it went away (a dialog, a button that turned off). */
  const focusMenu = () => {
    bodyRef.current?.querySelector<HTMLElement>('button:not(:disabled), input')?.focus();
  };

  const toggle = () => {
    if (open) {
      close(true);
      return;
    }
    setOpen(true);
    void controller.opened();
  };

  /** Back to the list when a change was saved; otherwise the form stays, with the name's problem if it was the name. */
  const finished = (result: SaveResult) => {
    if (result.saved) toList();
    else setNameError(result.nameError ?? undefined);
  };

  const beginAdd = () => {
    const draft = controller.beginAdd();
    if (draft === null) return;
    setName(draft.name);
    setNameError(undefined);
    setPanel({ kind: 'add', draft });
  };

  const beginFolder = () => {
    setName('');
    setNameError(undefined);
    setPanel({ kind: 'folder' });
  };

  const selected = controller.selectedItem();

  const beginRename = () => {
    if (selected === null) return;
    setName(selected.name);
    setNameError(undefined);
    setPanel({ kind: 'rename', id: selected.id });
  };

  const beginDelete = () => {
    if (selected === null) return;
    const { id, name: itemName } = selected;
    // The newest tree first, so that the counts in the question are the newest (another browser may have added to the folder).
    void controller.refreshTree().then(() => {
      const contents = controller.contentsOf(id);
      if (contents === null) return; // gone: refreshTree has shown it
      if (contents.bookmarks + contents.folders > 0) setConfirmDelete({ id, name: itemName, contents });
      else void controller.remove(id).then(focusMenu); // a bookmark or an empty folder: no question
    });
  };

  const blocked = controller.addBlockedReason();
  const folderBlocked = controller.folderBlockedReason();
  const hints = [blocked, folderBlocked].filter((h, i, all) => h !== null && all.indexOf(h) === i);
  const path = controller.folderPath();
  const where = path.length === 0 ? 'In: top level' : `In: ${path.join(' / ')}`;
  const doc = state.document;
  const readable = doc.status === 'ok' || doc.status === 'unknown';

  const renaming = panel.kind === 'rename' ? panel : null;
  const moving = panel.kind === 'move' ? panel : null;
  const movingItem = moving === null ? null : findItem(state.tree, moving.id);
  const targets = moving === null ? [] : controller.targetsFor(moving.id);

  return (
    <div className="bookmarks-control" ref={rootRef}>
      <Button icon={Bookmark} disabled={off} title={off ? 'No map view' : 'Bookmarks'} onClick={toggle}>
        Bookmarks
      </Button>
      {state.map === 'none' ? <span className="bookmarks-hint">No map view</span> : null}
      <Popover
        open={shown}
        label="Bookmarks"
        onClose={() => {
          // Escape inside the menu and a press outside it and its anchor (this wrapper, which holds our questions too).
          close(true);
        }}
      >
        <div
          className="bookmarks-popover"
          ref={bodyRef}
          onKeyDown={(event) => {
            // Escape leaves a form or a choice first; the menu stays.
            if (event.key !== 'Escape' || panel.kind === 'list') return;
            event.stopPropagation();
            toList();
          }}
        >
          {doc.status === 'unreadable' ? (
            <>
              <Notice severity="error">
                {doc.reason === 'newer'
                  ? 'Your bookmarks were saved by a newer version of emc2 and cannot be read here. They have been left as they are.'
                  : 'Your bookmarks are damaged and cannot be read. They have been left as they are.'}
              </Notice>
              <Button
                variant="danger"
                disabled={state.busy}
                onClick={() => {
                  setConfirmEmpty(true);
                }}
              >
                Start an empty tree…
              </Button>
            </>
          ) : null}
          {doc.status === 'unavailable' ? (
            <>
              <Notice severity="error">Your bookmarks could not be loaded: the server did not answer.</Notice>
              <Button
                onClick={() => {
                  void controller.opened();
                }}
              >
                Try again
              </Button>
            </>
          ) : null}
          {state.error === null ? null : <Notice severity="error">{state.error}</Notice>}
          {readable && panel.kind === 'add' ? (
            <NameForm
              value={name}
              onChange={setName}
              error={nameError}
              hint={where}
              submitLabel="Save"
              busy={state.busy}
              onSubmit={() => {
                void controller.saveAdd(panel.draft, name).then(finished);
              }}
              onCancel={toList}
            />
          ) : null}
          {readable && panel.kind === 'folder' ? (
            <NameForm
              value={name}
              onChange={setName}
              error={nameError}
              hint={where}
              submitLabel="Create folder"
              busy={state.busy}
              onSubmit={() => {
                void controller.addFolder(name).then(finished);
              }}
              onCancel={toList}
            />
          ) : null}
          {readable && renaming !== null ? (
            <NameForm
              value={name}
              onChange={setName}
              error={nameError}
              hint={`Renaming “${findItem(state.tree, renaming.id)?.name ?? ''}”`}
              submitLabel="Rename"
              busy={state.busy}
              onSubmit={() => {
                void controller.rename(renaming.id, name).then(finished);
              }}
              onCancel={toList}
            />
          ) : null}
          {readable && moving !== null ? (
            <>
              <p className="bookmarks-hint">{`Move “${movingItem?.name ?? ''}” to:`}</p>
              {targets.length === 0 ? (
                <p className="bookmarks-hint">There is nowhere else to move it.</p>
              ) : (
                <Menu
                  label="Move to"
                  items={targets.map((t, i) => ({ id: String(i), label: t.label }))}
                  onChoose={(choice) => {
                    const target = targets[Number(choice)];
                    if (target === undefined) return;
                    void controller.moveTo(moving.id, target.parentId).then(finished);
                  }}
                />
              )}
              <div className="bookmarks-form-buttons">
                <Button onClick={toList}>Cancel</Button>
              </div>
            </>
          ) : null}
          {readable && panel.kind === 'list' ? (
            <>
              <div className="bookmarks-toolbar">
                <Button icon={BookmarkPlus} disabled={blocked !== null || state.busy} {...(blocked === null ? {} : { title: blocked })} onClick={beginAdd}>
                  Add bookmark
                </Button>
                <Button icon={FolderPlus} disabled={folderBlocked !== null || state.busy} {...(folderBlocked === null ? {} : { title: folderBlocked })} onClick={beginFolder}>
                  New folder
                </Button>
                <IconButton
                  icon={Pencil}
                  label="Edit bookmarks"
                  pressed={state.editing}
                  onClick={() => {
                    controller.setEditing(!state.editing);
                  }}
                />
              </div>
              {hints.map((hint) => (
                <p className="bookmarks-hint" key={hint}>
                  {hint}
                </p>
              ))}
              {state.editing ? (
                <div className="bookmarks-toolbar" role="group" aria-label="Edit the selected row">
                  <span className="bookmarks-hint" role="status">
                    {selected === null ? 'Choose a bookmark or a folder' : `Selected: ${selected.name}`}
                  </span>
                  <Button disabled={selected === null || state.busy} onClick={beginRename}>
                    Rename
                  </Button>
                  <Button
                    disabled={selected === null || state.busy}
                    onClick={() => {
                      if (selected !== null) setPanel({ kind: 'move', id: selected.id });
                    }}
                  >
                    Move to…
                  </Button>
                  <Button variant="danger" disabled={selected === null || state.busy} onClick={beginDelete}>
                    Delete
                  </Button>
                </div>
              ) : null}
              {state.loading && state.tree.items.length === 0 ? <p className="bookmarks-hint">Loading…</p> : null}
              {!state.loading && state.tree.items.length === 0 ? <p className="bookmarks-hint">No bookmarks yet</p> : null}
              {state.tree.items.length > 0 ? (
                <Tree
                  label="Bookmarks"
                  nodes={toNodes(state.tree.items)}
                  expanded={state.expanded}
                  selected={state.editing ? state.selectedId : state.folderId}
                  onToggle={(id) => {
                    controller.toggleFolder(id);
                  }}
                  onChoose={(id) => {
                    if (state.editing) {
                      controller.select(id);
                      return;
                    }
                    controller.goTo(id);
                    close(true);
                  }}
                  onDrop={(drop) => {
                    void controller.moveTo(drop.id, drop.parentId, drop.index);
                  }}
                  canDrop={(id, parentId) => controller.canMove(id, parentId)}
                />
              ) : null}
            </>
          ) : null}
        </div>
      </Popover>
      <ConfirmDialog
        open={confirmEmpty}
        title="Start an empty tree?"
        message="Your stored bookmarks cannot be read. Starting an empty tree replaces them, and they cannot be brought back."
        confirmLabel="Start empty"
        danger
        onCancel={() => {
          focusMenu();
          setConfirmEmpty(false);
        }}
        onConfirm={() => {
          focusMenu();
          setConfirmEmpty(false);
          void controller.startEmpty();
        }}
      />
      <ConfirmDialog
        open={confirmDelete !== null}
        title={`Delete folder “${confirmDelete?.name ?? ''}”?`}
        message={confirmDelete === null ? '' : describeContents(confirmDelete.contents)}
        confirmLabel="Delete"
        danger
        onCancel={() => {
          focusMenu();
          setConfirmDelete(null);
        }}
        onConfirm={() => {
          focusMenu();
          if (confirmDelete !== null) void controller.remove(confirmDelete.id).then(focusMenu);
          setConfirmDelete(null);
        }}
      />
    </div>
  );
}
