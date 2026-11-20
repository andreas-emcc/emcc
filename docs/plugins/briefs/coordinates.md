# Brief: coordinates

- Status: **Approved (2026-10-05)** · Milestone: M0 · Task: T-022 · Agent: PCA-coordinates (Sonnet)
- Updated 2026-10-10 for M1: UPS and polar MGRS (function 6, criteria 4 and 9), approved by the owner (2026-10-10).
- Updated 2026-10-11 for CR-0012 (approved by the owner, 2026-10-11): `MapView` is used, not required ("Interfaces"), and settings changes apply at once ("Settings").
- **Updated 2026-10-27 for M3 (T-077, for T-085): function 7, Interfaces, criterion 10.** Reviewed by the ACA (T-078, `docs/architecture/reviews/m3-briefs.md`, U1 to U7 taken), with the owner's decisions of 2026-10-27, rechecked by the ACA, and **approved by the owner (2026-10-27)**. ADR-0039 (workspaces), the workspace rules in the briefs README ("M3: the reused plugins in a workspace").
- **Updated 2026-10-30 for M4 (T-090): function 8, Interfaces, criteria 11 and 12.** From the owner's M4 notes (2026-10-30: coordinates as an icon over the map). No ADR, SDK member or model change: `addMapPaneOverlay` exists since SDK v0. **For the owner's approval.**
- **Updated 2026-11-10 for M6 (T-162): function 8, criteria 11 and 12.** As built in T-162 (`pca-coordinates/t162-window`; owner, 2026-11-09 and 2026-11-10): the window opens in the icon's place as map settings does, instead of the shared `Popover`, and a press outside closes it once the press has ended. No ADR, SDK member or model change. **For the owner's approval.**
- Read also: overview 4.7, ADR-0007 (WGS84, lon/lat order).

## Purpose

Lets users **view and enter** positions in decimal degrees (DD), degrees-minutes-seconds (DMS), UTM and MGRS, while everything inside the system stays WGS84 lon/lat (requirements: "View"). Other plugins format and parse coordinates through its `CoordinateService`.

## Kind and parts

- Kind: **utility**. Properties: none.
- Parts in M0: **web only.** A server part (Proj4J, mgrs-java; overview 4.7) is added when a server plugin needs it.

## Functions (M0)

1. **Format:** turns a WGS84 position into text in a chosen format: DD (e.g. `60.123456° N 15.654321° E`), DMS (the same point: `60°07'24.4" N 015°39'15.6" E`), UTM (layout only: `33V 536000 6664000`), MGRS (layout only: `33VWG 36000 64000`, precision 1–5 digit pairs).
2. **Parse:** turns user text back into a WGS84 position. It accepts the formats above with common variations (hemisphere letters or signs, spaces, degree and minute symbols or none). It returns a clear error for invalid text, and never guesses the axis order: DD text without hemisphere letters is read as latitude first, the way people write it, and the result is always stored as lon/lat.
3. **Cursor position:** contributes a small display, docked in the Map Pane through the `MapView` interface or as a Control Pane panel (as the design pattern decides), showing the position under the pointer in the user's chosen format.
4. **Format choice:** the user picks the display format. The choice is kept per browser (local storage), and other plugins can read it through the `CoordinateService`, so the whole UI shows one format.
5. **Go to:** a field where the user types a position in any supported format, and the map centres on it (`MapView` "go to").
6. **Polar areas (M1):** UTM and MGRS zones end at 84° N and 80° S. Beyond them the **Universal Polar Stereographic (UPS)** grid applies, so that the polar map has a grid in every format:
   - **The UTM format shows UPS there**: the zone letter (`Y` or `Z` in the north, `A` or `B` in the south), then easting and northing in metres, e.g. `Z 2000000 2000000` at the North Pole. Parse accepts UPS text in the same field.
   - **MGRS uses its polar letters there** (the UPS-based 100 km squares), with the same precision setting.
   - **The boundaries follow NGA's definition:** UTM up to and including 84° N and down to and including 80° S, UPS beyond. A point exactly on a boundary is UTM.
   - The format keeps its id `utm` in `CoordinateService`; its display name becomes "UTM/UPS". No SDK change is needed.
   - **How:** UPS north and south with proj4 (already shared). If the `mgrs` library cannot give the polar letters, implement them from NGA's definition and test them, or ask the owner for another library (exact version and licence).

   In M0, format showed "outside UTM" there, and parse rejected UPS text.

## Functions (M3)

Built against SDK 1.2.0 (T-076) and the shell's workspaces (CDA, T-080), with the workspace rules 1 to 9 in the briefs README ("M3: the reused plugins in a workspace").

7. **In every workspace** (rule 1): the cursor display and "go to" (functions 3 and 5) appear in every workspace (`workspaces: ['*']` on the overlay or panel). They act on the map of the workspace shown. `CoordinateService` and the format choice (function 4) are the same in every workspace.

## Functions (M4)

8. **An icon over the map instead of a panel** (the owner's M4 notes, 2026-10-30). The panel "Coordinates" goes. Its content, the format choice (function 4) and "Go to" (function 5), moves to a Map Pane overlay at the top right (`ctx.ui.addMapPaneOverlay`, in every workspace as in function 7), next to the map view's "Map controls" (`map-view-2d` function 21), and works like them:
   - **One icon button, "Coordinates",** after the map view's in the corner (`order`: the map view's controls use 10, this one 15). It opens a window with the format choice and "Go to", headed in the look's heading style, with a close button; the focus goes to the format choice.
   - **The window opens as the map view's map settings window does** (T-162; owner, 2026-11-09 and 2026-11-10): in the icon's place in the corner, growing to the left over the map, with the icon hidden while it is open. It has map settings' frame (the pane colour, a hairline, the look's corners, the card shadow) and is part of the overlay, not the browser's top layer; it is not the SDK's shared `Popover`.
   - **The close button, Escape in the window, or a press outside it** closes it, and the focus goes back to the button. A press outside closes it once the press has ended, so that a click on an icon below it lands (owner, 2026-11-10). That Escape does not clear the selection.
   - **Open or closed is remembered per browser,** as the format is (function 4).
   - The cursor display (function 3) stays at the bottom left.
   - If the icons cannot line up in the corner with the map view's own, PCA-coordinates tells the PDA, who raises it in SDK 1.3.0 (CR-0028 part 4).

## Out of scope (M0 and M1)

Other grids or datums, a server part.

## Interfaces

| Direction | What |
|---|---|
| Provides | `CoordinateService` (web SDK): format, parse, chosen format and change events. **(M3)** The cursor display and "go to" in every workspace. **(M4)** "Go to" and the format choice in an icon over the map, no panel (function 8) |
| Uses | `MapView` (pointer events, go to); without it the service and the format choice still work, there is no cursor display and no "go to", and the plugin reports `DEGRADED` |
| Objects | None |

## Dependencies

- `proj4` (MIT), shared through the import map (also used by `map-view-2d`; T-007).
- `mgrs` (MIT, npm), pinned and bundled with the plugin.

## Settings

| Setting | Default |
|---|---|
| Default display format | DMS (owner decision, 2026-10-05) |
| Default MGRS precision | 5 (1 m) |
| DMS seconds decimals | 1 |

Changes made in the plugin's entry in the Settings tab apply at once (ADR-0031).

## Permissions

None.

## Internet access

**Not allowed.**

## Acceptance criteria

1. Format and parse are tested against at least ten reference points from an independent source (e.g. NGA GEOTRANS or published examples), covering northern and southern, eastern and western hemispheres, with latitude ≠ longitude.
2. Round trips (format → parse) return the original position within the precision of the format (MGRS 5 digits: 1 m; DMS with 0.1": 3 m).
3. UTM zone exceptions are correct: the Norway zone 32V and the Svalbard zones 31X–37X.
4. Points north of 84° N and south of 80° S, the poles included, format and parse as UPS (UTM format) and polar MGRS (function 6), without exceptions or wrong values.
5. Swapped input is caught where it can be: a DD latitude above 90 gives an error, not a silent swap.
6. The cursor display follows the pointer and switches format immediately when the user changes it.
7. "Go to" with an MGRS text centres the map within 1 m of the expected position.
8. No network request is made.
9. **UPS and polar MGRS** are tested against at least six reference points from an independent source (e.g. NGA GEOTRANS), three in each polar area, with latitude ≠ longitude. Round trips return the original position within the precision of the format. Points just inside and just outside 84° N and 80° S switch between UTM and UPS as function 6 says.

From M3 (with SDK 1.2.0 and the shell's workspaces; tested with the test kit's `switchWorkspace`, and once in the browser):

10. **Every workspace:** the cursor display and "go to" are there in View and in Simulation; "go to" in Simulation centres the map of the workspace shown (latitude ≠ longitude), and the cursor display shows positions there.

From M4:

11. **The icon:** there is no "Coordinates" panel. The icon at the top right of the Map Pane, after the map view's, opens the format choice and "Go to" in View and in Simulation. "Go to" centres the map (latitude ≠ longitude); a changed format shows at once in the cursor display; the close button, Escape, or a press outside once it has ended closes it with the focus back on the icon and the selection kept. Open or closed is the same after a reload.
12. **The look:** the icon and its window are checked in both densities, and in a light and a dark look. Since T-162 the window opens in the icon's place and grows to the left, with the icon hidden, and its frame matches map settings'.

## Open questions for the owner

None. Decided 2026-10-05: the default display format is DMS.
