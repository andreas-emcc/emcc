# Brief: layer-panel

- Status: **Approved (2026-10-05)** · Milestone: M0 · Task: T-024 · Agent: PCA-layer-panel (Sonnet)
- Updated 2026-10-10 for M1: permissions (function 10, criterion 8), approved by the owner (2026-10-10). Built against SDK v1 (T-034).
- Updated 2026-10-11: "Layer N" is one more than the highest number (function 5), decided by the owner.
- Updated 2026-10-12: a number freed by deleting or renaming the highest-numbered layer is used again (function 5), decided by the owner (2026-10-12).
- Updated 2026-10-10 for M1: layers and counts without objects (function 11, criterion 9; ACA review B2), approved by the owner at the SDK v1 freeze (2026-10-10).
- **Updated 2026-10-15 for M2 (T-048): functions 12 to 15, Interfaces, criteria 10 to 15, open question 1; approved by the owner (2026-10-15), with open question 1 decided as recommended; the conformance review's wording fixes of the same day (function 6, criterion 14) are confirmed by the owner (2026-10-15).** A double-click opens `object-list`; the eye stays and is part of a setup (ADR-0031).
- Updated 2026-10-21: the owner's decisions of 2026-10-17 (functions 4 and 12, criterion 10): Space on a layer's name makes it active and Enter opens `object-list`, so the keys match the shared `List`; without `object-list` the status stays `OK`, with a detail.
- **Updated 2026-10-27 for M3 (T-077, for T-085): functions 16 to 21, Interfaces, Permissions, criteria 16 to 22.** Reviewed by the ACA (T-078, `docs/architecture/reviews/m3-briefs.md`, U1 to U7 taken), with the owner's decisions of 2026-10-27, rechecked by the ACA, and **approved by the owner (2026-10-27)**. ADR-0039 (workspaces), the workspace rules in the briefs README ("M3: the reused plugins in a workspace").
- **Updated 2026-10-30 for M4 (T-090): functions 8 and 15, criterion 7, criterion 23, the CDA's line under "Depends on".** From the owner's M4 notes (2026-10-30: default layers BT, with BX; default panes BS). **For the owner's approval.**
- **Updated 2026-10-30 for M4 (CR-0028 step 1): function 22, Interfaces, criteria 24 to 26, the CDA's line under "Depends on", the layer lock** (ADR-0042, SDK 1.3.0), with the owner's answers to the PDA, 2026-10-30. **For the owner's approval.**
- **Updated 2026-11-11 for M6 (T-171; CR-0039 point 9, approved by the owner, OB A; SDK 1.5.0 part 4): functions 5 and 23, Interfaces, criteria 27 to 31, the CDA's line under "Depends on".** A new layer's classification chosen in a small dialog, with the owner's Q46 (2026-11-11, in the PDA's session: A, a dialog with the name and the classification). Labels stay cosmetic (owner, 2026-11-10). **Approved by the owner (2026-11-11, PR A), with Q46 A confirmed (PP A).**
- **Updated 2026-11-11 for M6 (T-154): function 24, Interfaces, criteria 32 to 35.** The active layer's name over the map, at the bottom left just above the coordinates, with the owner's Q47 and Q48 (2026-11-11, in the PDA's session: A, `layer-panel` shows it; A, the name and the lock only, not clickable). No SDK or model change. **Approved by the owner (2026-11-11, PR A), with Q47 A and Q48 A confirmed (PP A).**
- **Updated 2026-11-11 for the owner's PS A (from PCA-layer-panel's session, as built on `pca-layer-panel/m6-dialog-active` `1546239d`): function 23's name, criterion 28.** `ConfirmDialog` cannot disable its confirm button, so "Create" with an empty name sends nothing and shows "Enter a name". Decided by the owner, so approved.
- **Updated 2026-11-11 for the 1.5.0 freeze (owner, Q49 A and Q51 A): function 23, criteria 27 to 29.** The members that were optional until the freeze are required (`docs/plugins/sdk-v1.md`, "The freeze"), so the fallbacks for their absence go. Follows from the owner's decision, so approved.
- Read also: requirements ("View": layer structure similar to Photoshop), `model/schemas/layer.schema.json`, ADR-0022 (permissions). **(M2)** ADR-0031 (setups, panels in every pane, the Settings tab's Layers entry), ADR-0032 point 4 (the objects panel), ADR-0029 (design system), the `object-list` brief.

## Purpose

The Photoshop-like layer list: users see the layers, change their draw order, show or hide them, choose the active layer for drawing, and create, rename and delete layers.

## Kind and parts

- Kind: **general**. Properties: none.
- Parts in M0: **web only.**

## Functions (M0)

1. **Layer list** (Control Pane panel "Layers"): all layers, sorted by `drawOrder` with the top of the list drawn on top (as in Photoshop). Each row shows the name, the number of objects in the layer, the classification of its label, a visibility toggle (eye) and a marker for the active layer.
2. **Reorder:** by drag and drop, and with up and down buttons. A move changes only the moved layer: its new `drawOrder` is the midpoint between its new neighbours (the number type in the model allows that). If two neighbours are too close to split (floating-point limit), the plugin renumbers all layers, which is rare.
3. **Visibility:** the eye hides or shows the layer **in this browser only**, through `MapView` local visibility. It does not change the shared `visible` field, which is only the initial state for new sessions.
4. **Active layer:** clicking a row, or **Space** on a layer's name (owner, 2026-10-17), makes it the active layer (`MapView` shared state). `draw-symbols` places new symbols there. At start, the top layer is active. If the active layer is deleted, the next one down becomes active.
5. **Create:** "New layer" creates a layer named "Layer N", where N is one more than the highest number among the current layers named "Layer <number>" (1 when there is none; owner decisions, 2026-10-11 and 2026-10-12). So when the highest-numbered layer is deleted or renamed, its number is used again. The new layer is created on top, visible, with the default label, and becomes active. **From M6** "New layer" asks for the name and the classification first (function 23).
6. **Rename:** inline editing of the name, started with F2 on the row or the rename button (✎) (until M2 also with a double-click on the name; function 12); committed with Enter, cancelled with Escape.
7. **Delete:** only **empty** layers can be deleted (owner decision, 2026-10-05). The button is disabled while the layer has objects, and says why. The delete asks for confirmation. The object store enforces the same rule (data model v0), so a delete that races with a new object is rejected; the plugin then shows the reason as a notification.
8. **Default layer:** the server creates a layer named "Drawing" when View has no layers, also when another workspace has layers (ECore, CDA; owner decisions, 2026-10-05 and 2026-10-27; named "Default" before M4, BT and BX). The simulator creates "Simulation" in its own workspace in the same way (its function 2). The plugin treats it like any other layer. If all layers have been deleted, the panel shows a clear "Create first layer" action.
9. **Live updates:** changes by other users (new, renamed, reordered or deleted layers) show up without reload. Like all core fields, an update sends the complete layer content (`name`, `drawOrder`, `visible`, `label`) with `baseVersion`.
10. **Permissions (M1, ADR-0022):** the user's permissions come from SDK v1 (in the browser).
    - **Without `layers.edit`:** create, rename, reorder (drag and drop, up and down) and delete are switched off, with the hint "You may not change layers". The "Create first layer" action (function 8) says so too.
    - **Always allowed**, with or without it: the list, the object counts, the eye (local visibility) and choosing the active layer, which are local to the browser.
    - The server checks the permission anyway. A rejection (`PERMISSION_DENIED`) is shown as a notification, like any rejection.
    - Layers created by other plugins (e.g. one per `cot` stream) are listed and handled like any other layer.
11. **Subscription (M1, SDK v1):** the panel subscribes with `{ objects: false }`: it gets the layers and the object count per layer, kept by the server (`objectCounts`, then `counts`), and **no objects**. The counts are of the whole picture, not of the view. "Only empty layers can be deleted" (function 7) uses these counts.

## Functions (M2)

Built against SDK 1.x (T-049).

12. **Opening the objects of a layer:** a **double-click on a layer's row** opens `object-list` for that layer, **also for a hidden layer** (overview section 6, M2). The panel asks `object-list` through a service that `object-list` provides (planned in T-049, e.g. `emc2.object-list` with `open(layerId)`), declared under `uses` (CR-0011).
    - **Enter on a layer's name** opens `object-list` too (owner, 2026-10-17). With Space for the active layer (function 4), the keys match the shared `List`.
    - **Without `object-list`** (not installed, failed or disabled), the double-click and Enter do nothing, and no tooltip mentions them. The plugin's status stays `OK`, with a detail that says so, e.g. "ready; object-list not available: double-click opens nothing" (owner, 2026-10-17).
    - **Rename** no longer starts with a double-click on the name. It starts with F2 on the row or the rename button (✎); a double-click anywhere on the row opens `object-list` (open question 1).
13. **The eye stays** (owner, 2026-10-10): it is the layer's local visibility (function 3). From M2 it is also part of the user's **setup**: the map view saves and restores the layers' visibility (`map-view-2d` function 20, ADR-0031 point 5). When a setup is restored, the eyes follow the map view's visibility at once, through a visibility change event (planned in T-049).
14. **Active layer for every drawing plugin:** the active layer (function 4) is where `draw-symbols` and `draw-shapes` place new objects.
15. **Panel:** registers with a default pane (planned in T-049; from M4 the bottom pane, BS, and the left before) and works in every pane (ADR-0031 point 4), using the shell's design tokens and shared components (ADR-0029).

Not in this panel: changing a layer's **classification** and raising its objects is the Settings tab's **Layers** entry, the shell's (ADR-0031 point 3; T-051).

**Out of scope (M2):** the layer's classification (the shell's Layers entry), layer groups, per-layer opacity, locking layers (from M4: function 22), deleting non-empty layers.

## Functions (M3)

Built against SDK 1.2.0 (T-076) and the shell's workspaces (CDA, T-080), with the workspace rules 1 to 9 in the briefs README ("M3: the reused plugins in a workspace").

16. **The layers of the workspace shown** (rules 1 and 2): the panel "Layers" is in every workspace and lists the layers of the workspace that the page shows. Its `{ objects: false }` subscription names no workspace, so it follows the shown one; on a switch the list shows the new workspace's layers and counts at once. Each layer carries its `workspace` (absent for View).
17. **New layers belong to the workspace shown** (ADR-0039 point 5, Q29): in a declared workspace, "New layer" and "Create first layer" create the layer with `workspace` set to its id, `simulator.simulation` in Simulation. In View the request carries no `workspace`, as before. An update (function 9: rename, reorder) carries the layer's own `workspace` as stored, or none, never another one; the store rejects a different one (data model 1.2.0). "Layer N" (function 5) counts the workspace's own layers only. ECore seeds "Default" when View has no layers (function 8; owner, 2026-10-27), and "Default" is a View layer. A declared workspace without layers shows "Create first layer".
18. **Who may change layers** (rule 4, ADR-0039 point 7): in a declared workspace, create, rename, reorder and delete need its `editPermission` (`plugin.simulator.edit` in Simulation) instead of `layers.edit`, which stays View's. Without it they are off, with the hint "You may not change layers in Simulation" (the workspace's name). The eye, the counts and the active layer are always allowed, as in function 10.
19. **Reorder** (function 2) moves a layer among the workspace's own layers: the new `drawOrder` is the midpoint between its neighbours in that list, and renumbering touches only those layers.
20. **View's layers as a reference** (rule 6; ADR-0039 point 6, A17): in a declared workspace, under the workspace's own layers, the panel shows a second group, "View (reference)", with View's layers in View's order. It comes from a second subscription, `{ objects: false, workspaces: ['core.view'] }`, held only while a declared workspace is shown.
    - Each row shows the name, the count, the classification and the eye. **The eye is off by default**; it is that workspace's local visibility of the layer (`map-view-2d` function 23), apart from the eye in View.
    - Nothing else: no active marker, no rename, reorder or delete, and a click or Space does not make it active. A double-click or Enter does nothing, since `object-list` lists only the workspace's own layers (its function 11).
    - The group has a heading and is read as one group by screen readers; it shows "No layers in View" when View has none.
21. **The active layer is the workspace's own** (rule 5): it is always one of the workspace's layers, never a reference layer. When the active layer is deleted from the workspace's list, the layer below it becomes active, as in function 4, or the top layer when none is below. **Otherwise, whenever the active layer is none, or is not one of the workspace's layers** (those of the panel's main subscription, not the reference one: another workspace's layer, a reference layer, or an id the panel does not hold), the panel makes the workspace's top layer active, as at start, **at any time**: when the active layer changes and when its layer list changes (a fresh snapshot, a change batch). With no layer at all none is active. So the order of the plugins' `onChange` listeners on a switch, which the SDK does not set, does not matter: the map view brings back the one last active in that workspace (`map-view-2d` function 22), and that layer stands; the top layer only fills a gap, on a first visit or when the remembered layer was deleted meanwhile.

## Functions (M4)

22. **The lock** (ADR-0042; BP; the owner's answers to the PDA, 2026-10-30). Each row of the workspace's own layers has a **lock button beside the eye**: an `IconButton` with Lucide `Lock` while the layer is locked and `LockOpen` while it is not, labelled "Unlock layer" or "Lock layer". The lock is the layer's stored `locked` (SDK 1.3.0), one value for every user and browser, and the button follows it in the live picture.
    - **A click** sends one layer update with the complete content, `baseVersion` set, and `locked: true` or `false`. Every other layer update the panel sends (rename, reorder) leaves `locked` out, so that the stored lock stays.
    - **Who may switch it:** whoever may edit the layer (`layers.edit` in View, the workspace's `editPermission` elsewhere, function 18). Without it the button shows the state, disabled, with the title "You may not change this layer".
    - **A locked row:** Rename and Delete are disabled with the title "The layer is locked". Reorder (drag and keys) stays, since a locked layer's draw order may change (ADR-0042 point 3). The eye and making the layer active stay too, since both are local; the editors then do not place into it (their briefs).
    - **A `LAYER_LOCKED` rejection** (another user locked the layer in between) is shown like any other, with the layer's name.
    - **Reference layers** (function 20) get no lock button.

## Functions (M6)

23. **A new layer's classification** (T-171; SDK 1.5.0 part 4, CR-0039 point 9; the owner's Q46 A). "New layer" and "Create first layer" open a small dialog, the SDK's `ConfirmDialog` titled "New layer" with the confirm label "Create":
    - **The name:** a `TextField` "Name", filled with function 5's "Layer N", 1 to 256 characters after trimming. **While the name is empty** (after trimming) the field shows "Enter a name", and "Create" sends nothing and leaves the dialog open, since `ConfirmDialog` cannot disable its confirm button (owner, PS A, 2026-11-11).
    - **The classification:** a `Select` "Classification" listing `classificationOrder(ctx.classifications, ctx.defaultLabel.policyIdentifier.name)`, lowest first, with `ctx.defaultLabel.classification` chosen. Every classification of the order is offered, whatever the user's own: labels are cosmetic in M6 (owner, 2026-11-10).
    - **Create** sends one `createLayer` as function 5 does (on top, visible, active; `workspace` as function 17), with the label `ctx.defaultLabel` with the chosen classification: its policy, categories and every other part as the default's. The store checks the permission (`layers.edit`, or the workspace's `editPermission`, function 18), and a rejection is shown as before. **Cancel** or Escape sends nothing.
    - **Without an order** (a default policy without an order, or a default classification outside it) the dialog has no select, and the layer gets `ctx.defaultLabel` as before. `ctx.classifications` is always there since the 1.5.0 freeze (the shell gives the NATO order without a configuration).
    - **Changing it later** stays in Settings › Layers (ADR-0031); the panel shows no label.

24. **The active layer over the map** (T-154; the owner's Q47 A and Q48 A, 2026-11-11), so that it is clear which layer new objects go to:
    - **Where:** a Map Pane overlay (`ctx.ui.addMapPaneOverlay`) at `bottom-left` with `order` 110, so the shell stacks it just above `coordinates`' cursor display (100) and the simulator's sensor warnings (100), in every workspace (`workspaces: ['*']`). Framed as the design pattern's icon over the map (border, radius, pane background, card shadow, text colour), one line of small text, no wider than 40 % of the Map Pane: a longer name ends with "…" and shows whole in its `title`.
    - **What:** "Active layer: <name>", the name of `MapView.activeLayer`'s layer from the panel's own live picture; with Lucide `Lock` before the name, labelled "Locked", while the layer is locked (function 22: the editors then do not place into it); "No active layer" when there is none, or its layer is not (yet) in the picture.
    - **Follows at once** a change of the active layer (from the panel, a switch, or another plugin), a rename, a lock or unlock (also by another user) and the active layer's deletion (function 21's next active layer), without a new subscription.
    - **Only shows:** not clickable, not focusable, and never covers the map's own controls; making another layer active stays in the panel (Q48 A). Without a map view (`requires`), no overlay, as the panel.

## Out of scope (M0)

Layer groups (folders), per-layer opacity, locking layers (from M4: function 22), deleting non-empty layers (with or without their objects), moving objects between layers (that is `draw-symbols`), editing labels.

## Interfaces

| Direction | What |
|---|---|
| Provides | Control Pane panel "Layers" (from M2 a panel with a default pane, planned in T-049; **from M3** in every workspace). **(M6)** A Map Pane overlay naming the active layer (function 24) |
| Requires | `MapView` (local visibility, active layer; **from M2** its visibility change event, planned in T-049); **(M2)** uses the objects panel service of `object-list` (planned in T-049; `uses`, CR-0011); live picture subscription (layers, object counts per layer; from M1 `objects: false`); change requests; default label; notifications. **(M3)** `ctx.workspace` and `ctx.workspaces`, a layer's `workspace`, `LivePictureOptions.workspaces` (SDK 1.2.0); the shell's workspaces (T-080). **(M6)** `ctx.classifications` and `classificationOrder` (SDK 1.5.0 part 4), used when there (function 23) |
| Objects | Creates, updates and deletes layers. **From M3** only layers of the workspace shown; View's layers in another workspace only as a reference. **From M4** locks and unlocks them (`locked`, SDK 1.3.0, function 22) |

## Dependencies

None beyond the SDK and React (shared).

## Settings

None.

## Permissions

`layers.edit` (core) to create, rename, reorder and delete. Declared in M0; checked from M1 (function 10). Visibility and the active layer are always allowed, since they are local. **From M3** a declared workspace's layers need its `editPermission` instead (function 18); the plugin declares no permission of its own.

## Internet access

**Not allowed.**

## Acceptance criteria

1. The list order equals the map's draw order. Moving a layer up or down changes the map in both browsers, and the change request touches only that layer's `drawOrder`.
2. Twenty consecutive moves between the same two neighbours keep a correct order (exercises the midpoint and the renumbering).
3. Hiding a layer hides its objects in this browser only; a second browser still shows them.
4. A new layer appears on top in both browsers, is active in the creating browser, and carries the default label (schema-valid change request).
5. Rename is visible in a second browser. Escape restores the old name and sends nothing.
6. A layer with objects cannot be deleted; an empty one can, after confirmation, and disappears in both browsers. A rejected delete (an object was added meanwhile) is shown as a notification.
7. On a fresh system, the "Drawing" layer is listed and active, and symbols can be placed at once. After all layers are deleted, the panel shows the "Create first layer" action.
8. **(M1)** Without `layers.edit`, the panel offers no create, rename, reorder or delete, and shows the hint; the eye and the active layer still work. A `PERMISSION_DENIED` rejection is shown as a notification. With `layers.edit` everything works as in criteria 1 to 7.
9. **(M1)** The panel's subscription receives no objects (`objects: false`), and its counts per layer match the store's, also after objects are created and deleted in another browser.

From M2 (with SDK 1.x):

10. **Double-click and Enter:** a double-click on a layer's row, or Enter on its name, opens `object-list` for that layer, also when the layer is hidden. Space on the name makes the layer active. Without `object-list` installed, the panel works as before, the double-click and Enter do nothing, and the status is `OK` with its detail.
11. **Rename** starts with F2 or ✎, not with a double-click; Enter commits and Escape cancels as before (criterion 5).
12. **Eye and setup:** the eye's state is restored after a reload and in another browser of the same user (through the map view's setup share), and the eyes follow at once when a named setup is picked.
13. A shape drawn with `draw-shapes` goes into the active layer, as a symbol does.
14. The panel works in the left, the right and the bottom pane (ADR-0031), in both densities, and in a light and a dark look (ADR-0034).
15. Without `layers.edit`, the double-click and Enter still open `object-list` (reading is always allowed); rename stays off as in criterion 8.

From M3 (with SDK 1.2.0 and the shell's workspaces; tested with the test kit's `switchWorkspace`, and once in the browser):

16. **The workspace's layers:** in View the panel lists View's layers only; after a switch to a declared workspace, only that workspace's layers and the reference group; back in View, View's layers again. The counts follow each, also after changes in a second browser.
17. **New layers:** a layer created in Simulation carries `workspace` `simulator.simulation` (schema-valid change request) and is listed in Simulation only; a layer created in View carries no `workspace`. "Layer N" counts the workspace's own layers. A Simulation without layers shows "Create first layer".
18. **Permissions per workspace:** with `plugin.simulator.edit` and without `layers.edit`, the user can change layers in Simulation and not in View; with `layers.edit` only, the reverse. The hint names the workspace. A `PERMISSION_DENIED` is shown as a notification.
19. **Reorder** in Simulation sends one update with a `drawOrder` between the moved layer's Simulation neighbours, carrying the layer's own `workspace`, and changes no View layer; a rename carries it too.
20. **Reference group:** in Simulation it lists View's layers with their counts, eyes off at first, no active marker, no rename, reorder or delete; a click, Space, a double-click and Enter on it change nothing. Switching a reference layer's eye on draws it on Simulation's map only; View's eye for the same layer is unchanged.
21. **Active layer:** after a switch the active layer is one of the workspace's own; in Simulation it is never a View layer; a Simulation with no layers has none.
22. **A gap is filled, at any time** (function 21), tested for both triggers and both orders:
    - **the active layer changes:** set to none, to a View layer while Simulation is shown, or to an id the panel does not hold, it becomes the workspace's top layer at once;
    - **the layer list changes:** the active layer deleted in a second browser makes the layer below it active (the top layer when none is below); a fresh snapshot without it makes the top layer active;
    - **both orders of a switch** (the test kit's `switchWorkspace`, with the active layer set from an `onChange` listener as the map view does): with that listener registered first and last among the `onChange` listeners, the remembered layer is active at the end of a switch that has one, and on a first visit (none remembered) the top layer is.

From M4:

23. **Default pane:** in a fresh browser "Layers" opens in the bottom pane, next to "Objects".

With SDK 1.3.0 (tested with the test kit's default answer policy, which refuses as the store does, and once in the browser with two users):

24. **Lock and unlock:** a click on a row's lock sends one schema-valid update with the complete content, `baseVersion` and `locked: true`; a second click sends `locked: false`. The button follows a lock set in a second browser, and a rename or reorder sends no `locked`.
25. **A locked row:** Rename and Delete are disabled with the title "The layer is locked"; reorder sends one `drawOrder` update, which is applied; the eye and the active layer work as before.
26. **Without the permission:** the lock shows its state and is disabled, with its title. A `LAYER_LOCKED` rejection is shown with the layer's name.

From M6, SDK 1.5.0 part 4 (the test kit's `createFakeContext`, which gives the NATO order, and `{ classifications }` for another):

27. **The dialog:** "New layer" opens it with "Layer N" and the NATO order lowest first, `UNCLASSIFIED` chosen; Create sends one schema-valid `createLayer` with that name and `ctx.defaultLabel`; Cancel and Escape send nothing.
28. **A chosen classification:** with a default label that also has categories, choosing `SECRET` and a typed name sends the label with `classification` `SECRET` and the default's policy and categories unchanged, and the typed name, trimmed; with an empty or blank name the field shows "Enter a name", and "Create" sends nothing and leaves the dialog open (PS A).
29. **The policy's order:** a default label of policy `nato` with the orders `{ NATO: [...] }` lists the NATO order (ignoring case); with `{ classifications: {} }`, a policy without an order, or a default classification outside the order, there is no select and the layer gets the default label.
30. **As before:** in Simulation the request carries `workspace` `simulator.simulation` (criterion 17); "Create first layer" opens the same dialog; without the permission the buttons stay disabled (criterion 8).
31. **In the browser** (with the CDA's `ctx.classifications`): a layer made with `RESTRICTED` shows `RESTRICTED` in Settings › Layers, in a second browser too.

From M6, the active layer over the map (function 24; the test kit's fake map view and `ctx.ui` overlays):

32. **The overlay:** after activation one overlay `bottom-left` with `order` 110 and `workspaces` `['*']`; it shows "Active layer: Layer 2" for the active "Layer 2", and "No active layer" with `activeLayer` `null` or an id not in the picture.
33. **Follows:** setting `activeLayer` from outside the panel, renaming the active layer, locking it in a second browser (the lock icon and "Locked" appear, and go on unlock) and deleting it each change the text within one update, without a new subscription.
34. **Long names and no clicks:** a 200-character name is cut with "…" and whole in `title`; the overlay has no button, link or tab stop.
35. **In the browser** (with `map-view-2d` and `coordinates`): the box sits just above the cursor display at the bottom left in View and in Simulation, in a light and a dark look, and does not cover the map's controls; making another layer active in the panel changes it at once.

## Depends on

- **CDA:** ECore creates the "Drawing" layer ("Default" before M4), a View layer, when View has no layers (also when another workspace has layers; owner, 2026-10-27), with the configured default label.
- **PDA:** data model v0 rule "deleting a layer that still has objects is rejected"; the object store (CDA) enforces it.
- **(M4) CDA:** the store enforces the lock (T-098, ADR-0042); **PDA:** `locked` and `LAYER_LOCKED` in SDK 1.3.0 (CR-0028 step 1).
- **(M6) CDA:** `ctx.classifications` from the server's configuration (SDK 1.5.0 part 4); **PDA:** `ctx.classifications` and `classificationOrder` in SDK 1.5.0 part 4.

## Open questions for the owner

Decided 2026-10-05: the server seeds the default layer; only empty layers can be deleted.

1. **Rename without the double-click** (function 12). **Decided by the owner, 2026-10-15, as recommended: a double-click on the row opens `object-list`; rename with F2 and ✎.** Today a double-click on the name renames the layer (besides F2 and ✎). The recommendation was: a double-click anywhere on the row opens `object-list`, and rename keeps F2 and ✎, so one gesture means one thing. Alternative: a double-click on the name renames and elsewhere on the row opens `object-list`, which is easy to hit by mistake in a narrow pane.
