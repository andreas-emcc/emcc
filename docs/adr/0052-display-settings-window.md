# ADR-0052: One display settings window, opened from the Map Pane

- Status: Accepted (owner, HG, 2026-11-05; the owner's decision HC; T-150)
- Date: 2026-11-05
- Deciders: Owner (advised by the ACA)
- Extends: ADR-0046 (display settings per user) and ADR-0031 (the workspace)

## Context
ADR-0046 gives each user display settings on the server: the symbol size, the speed vector's minutes and the labels shown (T-137). Its point 4 says that the CDA places the entry where a user changes them within the top bar.

The owner decided otherwise with T-150 (HC, 2026-11-05): **a visualisation settings icon next to the map and coordinates opens one window with all display settings**, T-137's and a "GMTI Pairing" check box. "Next to the map and coordinates" is the Map Pane's top-right corner, where `map-view-2d`'s "Map controls" icon (its function 21, order 10) and the `coordinates` plugin's icon (its function 8, order 15) sit in every workspace.

ADR-0046 is accepted and is not edited, so this ADR extends it and replaces its point 4's placing.

## Decision
1. **One icon button, "Display settings",** in the Map Pane's top-right corner after the Coordinates icon (order 20), in every workspace. **The shell owns it** (CDA): the shell owns the display settings service, and no plugin writes the settings (ADR-0046 point 5). It is a Map Pane overlay like the plugins' icons, so that the three sit and behave alike.
2. **It opens one window** with every display setting, in the shared `Popover` with the look's heading style and a close button, as the Coordinates icon does; the focus goes to the first control:
   - **Symbols:** the symbol size, the speed vector's minutes and the labels shown (ADR-0046 point 1);
   - **Relations:** one check box per declared relation kind (ADR-0051 point 7), labelled with the kind's label, "GMTI Pairing" for the first; the section is absent when no loaded plugin declares a kind;
   - **"Use defaults"**, which returns every setting to the admin's defaults (ADR-0046 point 3).
3. **A change applies at once** to the map and is saved per user on the server (ADR-0046 points 2 and 6; HD). Closing the window saves nothing more; there is no Save button.
4. **Every user may open it**, with no permission beyond being the user (ADR-0046 point 4). In the no-login mode it changes the single local user's settings.
5. **The admin's defaults** stay in the Settings tab, in an entry the CDA places among the general entries (ADR-0031 point 2; ADR-0046 point 3), behind `settings.admin`.
6. **Plugins add nothing to the window in M5.** A plugin's own per-user display setting, shown in the same window, is a later SDK addition; until then a plugin keeps such a choice in its own per-user documents (ADR-0027) and its own panel.

## Alternatives considered
- **An entry within the top bar** (ADR-0046 point 4): the owner wants it with the map's own controls, where the user is looking (HC).
- **An entry in the Settings tab:** needs `settings.admin`, which every user does not have.
- **A panel in a pane:** always open and takes room from the map, for settings a user changes rarely.
- **A separate window per plugin** (`map-view-2d`'s and `symbology`'s): the settings are one service and one user choice; the owner wants one window (HC).

## Consequences
- **ADR-0046 point 4's placing is replaced:** the index row says so. The rest of ADR-0046 stands.
- **ECore and the shell (CDA, with part 5 of the 1.4.0 plan):** the icon, the window and the admin's entry.
- **SDK 1.4.0 (PDA):** nothing beyond ADR-0046's service and ADR-0051's setting per kind; the web SDK's Map Pane overlay is already there (SDK 1.3.0).
- **Briefs:** `coordinates` keeps order 15; `map-view-2d` keeps order 10.
- **UDA:** the manual describes the window instead of a top-bar entry.
- **ITA:** a change in the window changes the map at once and follows the user to a second browser; another user's map is unchanged; "Use defaults" returns to the admin's values.
