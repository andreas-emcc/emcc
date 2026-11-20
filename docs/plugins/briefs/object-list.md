# Brief: object-list

- Status: **Approved (2026-10-15)**, with the owner's answers to the three open questions (below). The conformance review's fixes of the same day (the 1 000 limit, without a map view, the kind key, criteria 9, 12 and 13) are confirmed by the owner (2026-10-15). After the ACA's check (2026-10-15), confirmed by the owner (2026-10-15): the double-click zooms through `MapView`'s zoom to objects by id (function 6). Function 7 changed after CR-0017 was rejected (owner, 2026-10-16). · Milestone: M2 · Task: T-053 · Agent: PCA-object-list (new)
- **Updated 2026-10-27 for M3 (T-077, for T-085): functions 10 to 12, Interfaces, criteria 14 to 17.** Reviewed by the ACA (T-078, `docs/architecture/reviews/m3-briefs.md`, U1 to U7 taken), with the owner's decisions of 2026-10-27, rechecked by the ACA, and **approved by the owner (2026-10-27)**. ADR-0039 (workspaces), the workspace rules in the briefs README ("M3: the reused plugins in a workspace").
- Read also: **ADR-0032 (selection, object actions; point 4: the objects panel)**, ADR-0031 (panels in every pane), ADR-0029 (design system), overview section 6 (M2: the server query for a layer's objects) and 4.4 (permissions), the `layer-panel` brief (function 12) and the `map-view-2d` brief (functions 14 to 16).
- Built against **SDK 1.x** (T-049) and the server query for a layer's objects (T-051). Where this brief names an SDK addition, it is "planned in T-049"; the names there win.

## Purpose

Shows **the objects of one layer as a list**, page by page, also for a hidden layer and also for objects the map does not hold (outside the view, inside clusters). The rows share the map's selection and its object actions (ADR-0032 point 4; owner, 2026-10-14), so a user can find an object in the list and act on it as on the map.

## Kind and parts

- Kind: **general**. Properties: none.
- Parts in M2: **web only.** The paging is the server's (the query for a layer's objects, CDA).

## Functions (M2)

1. **The panel "Objects"**, registered with the bottom pane as its default (planned in T-049); it works in every pane (ADR-0031 point 4). It shows one layer at a time: the layer's name, its object count, and a layer chooser to switch to another.
2. **Opening:** other plugins open the panel for a layer through the service the plugin provides (planned in T-049, e.g. `emc2.object-list` with `open(layerId)`). The `layer-panel` does so on a double-click on a row (its function 12). Opening shows the panel, expands it, and brings it to the front of its pane. A layer that is hidden on the map is listed like any other.
3. **Pages:** the plugin reads the layer's objects through the **server query for a layer's objects** (planned in T-049; the server side is T-051), independent of the map's area of interest. One page holds 100 objects (setting); the panel shows "1–100 of 12 345" and buttons for the next, the previous, the first and the last page.
   - **Order:** the server's order, which is the order of creation (UUID v7 ids) in M2 (open question 1).
   - **What the user may see** is the server's to filter; in M2 every logged-in user sees every object of the layer (labels later, overview section 6).
4. **Columns:** for a symbol its image (`SymbolService`, when installed); the name (`properties.name`, or "(no name)"); the kind (Symbol, or the shape's kind from the documented key `draw-shapes.kind` when there is one, otherwise its geometry type); the data type by its display name; the data source; the classification of its label; when it was last modified. Columns fit the pane: in a narrow pane the image, the name and the kind stay, and the rest moves into a tooltip.
5. **Shared selection** (owner, 2026-10-14): the rows read and set the map's selection (`MapView.selection`).
   - A click on a row selects that object and replaces the selection; **Ctrl+click** (Cmd on a Mac) adds or removes it, as on the map (`map-view-2d` function 14). At most 1 000 objects: a Ctrl/Cmd+click beyond that adds nothing, with a notice.
   - Rows of selected objects are highlighted, also when the selection was made on the map.
   - A selection may hold objects the map does not hold; the map highlights only those it draws (ADR-0032 consequences).
6. **Object actions on rows** (ADR-0032 point 4): a right click on a row opens the shell's object action menu (planned in T-049), with the map's rules: on a selected row the actions apply to the whole selection; an unselected row becomes the selection first. So Edit, the shared Delete, Centre on and Zoom to work from the list as on the map.
   - **A double-click on a row** zooms the map to that object (open question 2), through `MapView`'s zoom to objects by id (planned in T-049), the same call the map view's action Zoom to makes.
7. **Keeping the page current** (open question 3): the shown page is read again when the layer's object count changes (from a subscription with `{ objects: false }`, SDK v1), when the user presses **Refresh**, and after an action from the list that changes the count. A change to an object's fields on the page (e.g. Edit in `draw-symbols` or `draw-shapes`) shows at the next count change or on Refresh: `openMenu` does not report which action ran (CR-0017 rejected, owner, 2026-10-16).
8. **Edge cases:** without a map view (`uses` `emc2.map-view`), the list and its paging still work, but rows cannot be selected and the menu has no map actions; the plugin reports `DEGRADED`. An empty layer shows "No objects in this layer". A layer that is deleted while shown closes the list with a notice. A query that fails or times out shows the reason and a Retry button, and keeps the last page.
9. **Look:** the panel uses the shell's design tokens, shared components and icons (ADR-0029), and works with the keyboard: arrow keys move between rows, Space selects, Shift+F10 or the menu key opens the actions.

## Functions (M3)

Built against SDK 1.2.0 (T-076) and the shell's workspaces (CDA, T-080), with the workspace rules 1 to 9 in the briefs README ("M3: the reused plugins in a workspace").

10. **In every workspace** (rule 1): the panel "Objects" appears in every workspace. Its count subscription (function 7) names no workspace, so it follows the workspace shown (rule 2). The server's layer query returns only what the user may see (ADR-0039 point 7).
11. **The workspace's own layers only** (rule 6): the layer chooser lists the layers of the workspace shown. View's layers shown as a reference in another workspace are not listed. `open(layerId)` for a layer that is not in the workspace shown opens nothing and shows a notice, "That layer is not in the workspace shown": the plugin holds only that workspace's layers, so it does not know the layer's name.
12. **On a switch** (rule 3): the panel shows the layer it showed last in that workspace during this page; on the first visit, as at start. The map view clears the selection (`map-view-2d` function 22), so no row is selected. The object actions on rows are the shell's for the workspace shown, with its permissions (rule 4).

**Out of scope (M3):** reference layers in the list, several workspaces in one list.

## Out of scope (M2)

Sorting by a column and filtering (open question 1), searching across layers, several layers in one list, editing in the list, exporting, selecting more than 1 000 objects.

## Interfaces

| Direction | What |
|---|---|
| Provides | The panel "Objects"; the service that opens it for a layer (planned in T-049, e.g. `emc2.object-list`). **(M3)** In every workspace, for the workspace's own layers |
| Requires | Planned in T-049: panels with a default pane; the query for a layer's objects (page by page); the shell's object action menu. SDK v1: `MapView.selection` (uses `emc2.map-view`, CR-0011), the live picture with `{ objects: false }` for the layers and their counts, data types. Uses `emc2.symbols` when present. **(M3)** `ctx.workspace`, a layer's `workspace`, `workspaces` on panels (SDK 1.2.0); the shell's workspaces (T-080) |
| Objects | Reads objects through the layer query. Changes nothing itself; actions from the list change objects through their own plugins and the shell |

## Dependencies

None beyond the SDK and React (shared).

## Settings

| Setting | Default |
|---|---|
| Objects per page | 100 (at most the server's page limit) |

Changes made in the plugin's entry in the Settings tab apply at once (ADR-0031).

## Permissions

None to read: every logged-in user may list a layer's objects (overview section 6, M2). Actions carry their own permissions, and the shell does not show those the user may not use (ADR-0032 point 8).

## Internet access

**Not allowed.**

## Acceptance criteria

1. A double-click on a layer in `layer-panel` opens the list for that layer, also when the layer is hidden on the map.
2. A layer of 250 objects shows three pages of 100, 100 and 50, with "1–100 of 250" and the paging buttons; the objects include those outside the map's view and inside clusters.
3. Selecting a row selects the object on the map (highlighted when the map draws it); Ctrl/Cmd+click adds and removes; selecting on the map highlights the row.
4. A right click on a selected row of a selection of 3 offers the object actions for the 3 objects; on an unselected row it makes that row the selection first. Edit opens the right plugin's panel for a symbol and for a shape.
5. The shared Delete from the list removes the objects in both browsers, and the list's page and count follow.
6. Centre on and Zoom to from the list move the map to an object the map did not hold.
7. Creating or deleting an object of the layer in a second browser updates the count and the page within 2 s; Refresh shows a changed name.
8. An empty layer shows its message; a deleted layer closes the list with a notice; a failed query shows the reason and Retry.
9. The panel works in the left, the right and the bottom pane, with the narrow-pane columns of function 4, in both densities, and in a light and a dark look (ADR-0034).
10. The panel can be used with the keyboard alone.
11. The plugin sends no change request of its own.
12. **Double-click:** a double-click on a row zooms the map to that object, also when the map did not hold it.
13. Without a map view, the list pages and shows `DEGRADED`; with `draw-shapes` absent, a shape's kind shows its geometry type.

From M3 (with SDK 1.2.0 and the shell's workspaces; tested with the test kit's `switchWorkspace`, and once in the browser):

14. **Every workspace:** the panel is there in View and in Simulation; in Simulation its layer chooser lists Simulation's layers only, and in View View's layers only.
15. **Opening another workspace's layer:** `open` for a View layer while Simulation is shown opens nothing and shows the notice.
16. **Switch:** switching from View (layer A shown) to Simulation (layer S shown) and back shows A again, then S; no row is selected after a switch.
17. **Permissions:** in Simulation, with `plugin.simulator.edit` and without `objects.edit`, a right click on a row opens the shell's menu for the row's objects (`openMenu`), as in View. Which actions the menu offers is the shell's (rule 4); the shared Delete in Simulation is checked by the CDA (T-080) and the ITA.

## Open questions for the owner

All three answered by the owner on 2026-10-15, as recommended.

1. **The order of the list** (function 3). **Decided by the owner, 2026-10-15, as recommended: the order of creation in M2; sorting later.** The recommendation was: the order of creation in M2 (the server's order by id), with sorting by name and by last modified later; sorting needs the server query to sort, which is CDA work in T-051. Alternative: sort by name from M2, which adds that to the server query now.
2. **A double-click on a row** (function 6). **Decided by the owner, 2026-10-15, as recommended: Zoom to the object.** The recommendation was: Zoom to the object, the most common next step after finding it in a list. Alternative: open Edit, which a user without `objects.edit` could not use.
3. **Keeping the page current** (function 7). **Decided by the owner, 2026-10-15, as recommended: read the page again on a count change, on Refresh and after an action.** The recommendation was: read the page again when the layer's count changes, on Refresh and after an action, so that additions and deletions show at once and field changes at the latest on Refresh. Alternative: a live query that streams every change to the page, which needs a new server subscription (more T-049 and T-051 work).
