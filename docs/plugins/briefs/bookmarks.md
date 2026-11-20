# Brief: bookmarks

- Status: **Approved (2026-10-15)**, with the owner's answers to the two open questions (below). The conformance review's wording fixes of the same day (function 7, criterion 11) are confirmed by the owner (2026-10-15). Function 3 changed with CR-0016 option B (owner, 2026-10-16). · Milestone: M2 · Task: T-053 · Agent: PCA-bookmarks (new)
- **Updated 2026-10-27 for M3 (T-077, for T-085): function 9, criteria 13 and 14; nothing to build.** Reviewed by the ACA (T-078, `docs/architecture/reviews/m3-briefs.md`, U1 to U7 taken), with the owner's decisions of 2026-10-27, rechecked by the ACA, and **approved by the owner (2026-10-27)**. ADR-0039 (workspaces), the workspace rules in the briefs README ("M3: the reused plugins in a workspace").
- Read also: **ADR-0031 (top bar, setups; point 5: bookmarks are lighter than setups)**, **ADR-0027 (each user's own data)**, ADR-0029 (design system), ADR-0022 (users, the no-login mode), `map-view-2d` brief functions 3 and 20.
- Built against **SDK 1.x** (T-049). Where this brief names an SDK addition, it is "planned in T-049"; the names there win.

## Purpose

Lets each user keep **map bookmarks** in a folder tree and go back to them in one click: a bookmark remembers the **map type** (projection and background), the **centre** and the **zoom** (ADR-0031 point 5). Bookmarks are the user's own, follow the user to any browser, and are not shared (ADR-0027).

A bookmark is lighter than a setup: it holds no panel layout, no layer visibility, no dim level and no clock choice. Those belong to setups, which the shell keeps (ADR-0031).

## Kind and parts

- Kind: **utility** (it places no objects). Properties: none.
- Parts in M2: **web only.**

## Functions (M2)

1. **The bookmarks control** in the top bar, the first plugin item on the right (ADR-0031 points 1 and 6; the top bar item slot is planned in T-049). It opens a menu with the folder tree and the actions of function 2. It is a small control; the menu closes when a bookmark is chosen, on Escape, or on a click outside.
2. **Add the current view:** "Add bookmark" saves the map view's current map type, centre and zoom (read through `MapView`, planned in T-049), under a name and in a folder. The zoom is stored as the resolution at the centre in metres per pixel (open question 1).
   - The name is proposed as the centre in the user's coordinate format (`CoordinateService`, when installed; otherwise decimal degrees), and can be changed before saving (open question 2).
   - The folder is the one open in the menu, the top level by default.
3. **Go to a bookmark:** a click on a bookmark sets the map type, then the centre and the zoom (through `MapView`, planned in T-049).
   - A projection or background that is no longer available falls back as the map view does (`map-view-2d` function 3), and a notice says so; the centre and the zoom still apply.
   - A centre outside what the projection can show is replaced by the nearest point it can show, as `MapView.goTo` does for every caller (owner, 2026-10-12); a notice says so ("… cannot be shown in EPSG:3413; the map shows the nearest point it can"), and the zoom still applies (CR-0016 option B, owner, 2026-10-16).
4. **The folder tree:**
   - folders inside folders, up to 5 levels deep;
   - create, rename and delete folders; rename and delete bookmarks;
   - move bookmarks and folders by drag and drop, and with "Move to…", which works without a mouse;
   - the order is the user's own: new items go to the end of their folder, and moving keeps the rest in place.
   - Deleting a folder that holds anything asks for confirmation, stating how many bookmarks and folders go with it. Deleting one bookmark asks nothing.
5. **Storage:** the tree is the user's own document in the plugin's namespace `bookmarks` (ADR-0027; user documents planned in T-049).
   - It follows the user to another browser and computer; a reload shows the newest state.
   - **The last write wins** when the same user changes bookmarks in two browsers at once (ADR-0027 point 6). The menu reads the document again each time it opens, so it rarely shows an old tree.
   - **Limits:** at most 1 000 bookmarks and folders per user (setting), names of 1 to 100 characters, and ECore's own limits per document (ADR-0027 point 4). At the limit, "Add" and "New folder" are switched off with the reason.
   - A document that cannot be read (damaged, or written by a newer version) is not overwritten: the control shows an error and offers to start an empty tree, after confirmation.
6. **Users:** each logged-in user has their own bookmarks; in the no-login mode the single local user has them (ADR-0022). A user never sees another user's bookmarks (ADR-0027 point 2).
7. **Without a map view:** the control stays in the top bar, switched off, with the hint "No map view", and the plugin reports `DEGRADED`. `emc2.map-view` is declared under `uses` (CR-0011).
8. **Look:** the control and its menu use the shell's design tokens, shared components and icons (ADR-0029), and work with the keyboard: arrow keys move through the tree, Enter opens a bookmark or folder, Escape closes the menu.

## Functions (M3)

Built against SDK 1.2.0 (T-076) and the shell's workspaces (CDA, T-080), with the workspace rules 1 to 9 in the briefs README ("M3: the reused plugins in a workspace").

9. **One set of bookmarks for every workspace** (ADR-0039 point 8, A16): the control stays in the top bar, which is the same in every workspace. "Add bookmark" saves the map type, centre and zoom of the workspace shown, and going to a bookmark sets them on the map of the workspace shown. Nothing else changes: **no code change is expected**, only the criteria below and `sdkVersion` if the plugin starts to use an SDK 1.2.0 addition.

## Out of scope (M2)

Sharing bookmarks or folders with other users (ADR-0027 point 5, a later decision), importing and exporting, bookmarks of a selection or of objects, layer visibility and dim level in a bookmark (those are setups), searching bookmarks.

## Interfaces

| Direction | What |
|---|---|
| Provides | The bookmarks control in the top bar (planned in T-049: the top bar item slot) |
| Requires | Planned in T-049: user documents (web part, own namespace); reading and setting the map type, centre and zoom through `MapView`. Uses `emc2.map-view` and `emc2.coordinates` when present (`uses`, CR-0011) |
| Objects | None |

## Dependencies

None beyond the SDK and React (shared).

## Settings

| Setting | Default |
|---|---|
| Most bookmarks and folders per user | 1 000 |

Changes made in the plugin's entry in the Settings tab apply at once (ADR-0031).

## Permissions

None. Every user may keep bookmarks; they are the user's own data. The server lets a plugin reach only its own namespace for the current user (ADR-0027 point 2).

## Internet access

**Not allowed.**

## Acceptance criteria

1. "Add bookmark" saves the current projection, background, centre and zoom. Going to it later restores all four (the centre within 1 pixel, tested with latitude ≠ longitude), also after switching to another projection in between.
2. A bookmark saved in EPSG:3413 with Natural Earth and one saved in EPSG:3857 with OpenStreetMap each restore their own projection and background.
3. A bookmark whose background is no longer installed opens with the map view's fallback background and a notice; centre and zoom apply.
4. Bookmarks appear in a second browser of the same user after a reload, and never for another user (tested with two users).
5. Folders: create, rename, move and delete work, up to 5 levels; deleting a folder with contents asks first and states the counts; deleting one bookmark does not ask.
6. Moving items by drag and drop and with "Move to…" keeps the order of the others.
7. At 1 000 items, "Add" and "New folder" are off and say why.
8. A damaged document is not overwritten without the user's confirmation.
9. In the no-login mode, bookmarks are kept for the local user and survive a server restart.
10. Without a map view, the control is shown switched off with its hint, and the plugin reports `DEGRADED`.
11. The control and its menu can be used with the keyboard alone, and are checked in both densities, and in a light and a dark look (ADR-0034).
12. The plugin stores nothing in browser storage and nothing outside its namespace.

From M3 (with SDK 1.2.0 and the shell's workspaces; tested with the test kit's `switchWorkspace`, and once in the browser):

13. The control is in the top bar in View and in Simulation, with the same tree.
14. A bookmark added in Simulation and opened in View sets View's map to its map type, centre and zoom, and the reverse (latitude ≠ longitude); the other workspace's map is unchanged.

## Open questions for the owner

Both answered by the owner on 2026-10-15, as recommended.

1. **The zoom as stored** (function 2). **Decided by the owner, 2026-10-15, as recommended: the resolution at the centre.** The recommendation was: the resolution at the centre in metres per pixel, as `MapView`'s viewport already gives it; it means the same scale in every projection and on every screen size. Alternative: the zoom level of the map, which depends on the projection's tiling and shows a different scale in a polar projection.
2. **The proposed name** (function 2). **Decided by the owner, 2026-10-15, as recommended: the centre in the user's coordinate format.** The recommendation was: the centre in the user's coordinate format (e.g. `62°00′N 015°00′E`), editable before saving. Alternative: "Bookmark N", like "Layer N", which says nothing about the place.
