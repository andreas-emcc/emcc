# bookmarks

Map bookmarks in a folder tree, for each user (brief: `docs/plugins/briefs/bookmarks.md`). **State: all four parts built.** The control, the folder tree, arrow keys and drag and drop are in; going to a bookmark restores its projection and background through `map-view-2d`'s `setMapType`.

## What it does

A bookmark remembers the map type (projection and background), the centre and the zoom, and takes the user back there in one click. Bookmarks are the user's own, follow the user to any browser, and are not shared (ADR-0027). A bookmark is lighter than a setup: no panel layout, layer visibility, dim level or clock.

**Workspaces (M3, ADR-0039 point 8):** there is one set of bookmarks for every workspace. The control is a top bar item, which the shell shows in View and in Simulation alike. "Add bookmark" saves the map type, centre and zoom of the workspace shown when it is pressed; going to a bookmark sets them on the map of the workspace shown, and on no other. The plugin keeps nothing per workspace and does nothing on a switch, so it needed no code for them (tests: `test/workspaces.test.tsx`). Checked once in the real shell in View and in Simulation (2026-10-28, integration `ddd98d7`): the control and the same tree in both, and a bookmark added in one and opened in the other sets that workspace's map type, centre and zoom and leaves the other workspace's map as it was.

Built so far (`web/src/`):
- `tree.ts`: the tree as plain data and every operation on it as a pure function: add (to the end of a folder), rename, delete with the contents it takes along, move (to the end, or before a given position, the others keeping their order), the places "Move to…" offers, and the rules: names of 1 to 100 characters, folders up to 5 levels deep, a limit on the items per user, a centre in longitude, latitude order.
- `store.ts`: the tree in the user's document `tree` (namespace `bookmarks`). Every change reads the document again first, by listing the user's documents and reading `tree` only if it is there (a user without bookmarks makes no request that answers 404); a document that is damaged or written by a newer version is never overwritten except by `startEmpty`, which the control calls after the user has confirmed.
- `settings.ts`: the `maxItems` setting, validated where it is read; it applies at once when an admin changes it.
- `controller.ts`: what the control does apart from React: reads the tree each time the menu opens, takes the current view for "Add bookmark", goes to a bookmark (map type first, then centre and zoom, and a notification when the centre cannot be shown; the map view announces a gone projection or background), and says in words why something failed.
- `BookmarksControl.tsx`: the control in the top bar (first plugin item): a button and a menu with "Add bookmark" (a name field with the centre proposed, in the coordinate service's format when there is one, else as decimal degrees) and the tree. Escape closes the menu (or the form or choice first), and so does a press outside or choosing a bookmark. The menu is the shared `Popover` in the top layer, placed under the button and kept inside the window.
  - **New folder** creates an empty folder in the folder that is open in the menu (the last one opened), up to five levels deep.
  - **Edit** (the pencil) turns edit mode on: choosing a row selects it instead of going to it, and a bar offers **Rename**, **Move to…** and **Delete** for the selected row. A bookmark and an empty folder are deleted without a question; a folder that holds anything asks first and states how many bookmarks and folders go with it. **Move to…** lists the folders the row may go to (by their path, the top level first), puts it at the end of the one chosen and leaves the others in order.
  - At the limit, or at level 5, the buttons that cannot work are off and the reason is shown once.
  - **The tree** is the shared `Tree`: one Tab stop, the arrow keys (Up and Down, Home and End, Right and Left to open, close and go up), Enter to go to a bookmark or open a folder. **Drag and drop** (mouse and pen) moves a bookmark or a folder before or after a row, or into a folder (its middle half), keeping the order of the others; the tree marks places that would put a folder deeper than level 5 as not allowed. "Move to…" is the way without a mouse.

## Settings

| Name | Default | Meaning |
|---|---|---|
| `maxItems` | `1000` | Most bookmarks and folders one user may keep together. ECore's limit of 256 KiB per document applies as well |

## Messages and services

- Provides no service and requires none. `uses` `emc2.map-view` (to read and set the map type, centre and zoom; without it the control is switched off and the plugin reports `DEGRADED`) and `emc2.coordinates` (the proposed name; without it, decimal degrees).
- Stores one user document, `tree` (format version 1: `{ version, items }`; an item is a folder with `children`, or a bookmark with `mapType`, `center` as `[longitude, latitude]` and `resolution` in metres per pixel).
- Provides the top bar item `bookmarks` (order 0, the first plugin item).
- No topics, no endpoints, no server part, nothing in browser storage.

## Permissions and internet

No permissions: every user keeps their own bookmarks. No internet access.

## Known limits

- **A projection or background that is gone** falls back in the map view (`setMapType`), which tells the user itself; the plugin adds no second notice. The centre and the zoom still apply. Only a centre that the projection cannot show is told by the plugin, because `goTo` says nothing about it.
- A centre that the projection cannot show is replaced by the nearest point it can show, as `MapView.goTo` does for every caller (brief function 3, CR-0016 option B); a notification says so.
- Reordering inside one folder is done with drag and drop (mouse and pen); "Move to…" always puts the item at the end of a folder and never offers the folder it is in, so a keyboard-only user cannot change the order inside a folder.
- The question before deleting a folder states the counts of the newest tree, read when "Delete" is pressed; another browser can still add to the folder between the question and the answer (the last write wins, ADR-0027).
- Edit mode is the plugin's way to act on a row (the `Tree` has no row actions); it is a toggle in the menu, off each time the menu opens.
- The last write wins when one user changes bookmarks in two browsers at once (ADR-0027 point 6). Reading before every change keeps the window small, but there is no merge.
- A document holds at most 256 KiB, whatever `maxItems` says. A bookmark takes about 200 to 300 bytes, so a thousand bookmarks with long names and long ids do not fit; such an add is refused with a message that the room is used up, and nothing is written.
- A folder's level counts only folders: a bookmark may sit in a folder on level 5.
- A notification from "Go to" is the shell's (`ctx.notify`), because the menu has closed by then.
- The menu was checked in all three looks, light and dark, in both densities (2026-10-21, twice, the second time on integration `8cf0793`): text contrast, no clipped buttons or fields, the edit bar, the forms and the delete question. The menu is a top bar item, so the panes do not change where it opens.
