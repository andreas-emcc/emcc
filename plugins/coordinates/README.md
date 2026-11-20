# coordinates

Utility plugin (web part only), owned by PCA-coordinates. Brief: `docs/plugins/briefs/coordinates.md` (T-022). SDK `^1.8.0`; the manifest's icon is `Crosshair` (SDK 1.8.0 part D, T-204), shown in the Settings list.

## What it does

Lets users view and enter positions as decimal degrees (DD), degrees-minutes-seconds (DMS), UTM and MGRS. Everything inside the system stays WGS84 longitude/latitude (ADR-0007). Only text shown to or typed by the user is in another format.

- **`CoordinateService`** (web SDK key `emc2.coordinates`), which other plugins use:
  - `format(position, format?, options?)` turns a `[lon, lat]` position into text. Without `format` it uses the user's chosen format.
  - `parse(text)` returns `{ position: [lon, lat] }`, or `{ error }` with a short English message.
  - `chosenFormat` is the user's chosen format (`dd`, `dms`, `utm` or `mgrs`), with change events. It is kept in this browser's local storage (`emc2.coordinates.format`).
- **Formats:**

  | Format | Example | `options.precision` means | Default |
  |---|---|---|---|
  | DD | `60.123456° N 15.654321° E` | decimals, 0–9 | 6 |
  | DMS | `60°07'24.4" N 015°39'15.6" E` | seconds decimals, 0–4 | setting `dmsSecondsDecimals` |
  | UTM/UPS (`utm`) | `33V 536360 6665340` (zone, latitude band, easting, northing in metres, rounded); beyond 84° N and 80° S UPS: `Z 2000000 2000000` (letter, easting, northing) | metre decimals, 0–3 | 0 |
  | MGRS | `33VWG 36360 65340` (truncated, as NGA does); beyond 84° N and 80° S the polar form: `ZAH 06749 11929` | digits per axis, 1–5 | setting `mgrsPrecision` |

  A precision outside the range is clamped to it. UTM uses the Norway (32V) and Svalbard (31X, 33X, 35X, 37X) zone exceptions.
  - **UPS:** north of 84° N and south of 80° S the `utm` format shows UPS. Its letter is `Y` or `Z` in the north and `A` or `B` in the south; the second of each covers eastings from 2 000 000 m (0° to 180° E, the poles, and ±180°). A point exactly on 84° N or 80° S is UTM (brief, function 6).
  - **MGRS in the polar areas:** MGRS uses its polar form on the UPS grid there: the UPS letter, two letters for the 100 km square, then easting and northing in the square. The square letters follow NGA's polar lettering. This plugin implements them (`polarMgrs.ts`), because the `mgrs` library covers UTM only.
- **Parsing** recognises the format from the text:
  - **MGRS:** with or without spaces, 0 to 5 digits per axis. The result is the **south-west corner** of the square, as the MGRS standard defines it (owner decision, 2026-10-08).
  - **UTM:** zone and **latitude band** (as format writes it), easting, northing, optionally with `m`.
  - **Polar MGRS:** `ZAC 92054 79409`, with or without spaces, 0 to 5 digits per axis. The result is the south-west corner of the square, as for MGRS.
  - **UPS:** `Z 2092055 1579410`, the letter, easting and northing in metres, as the `utm` format writes them. The letter must fit the easting: west letters (`A`, `Y`) below 2 000 000 m, east letters (`B`, `Z`) from it.
  - **Limits:** the brief's limits hold, with a slack of about 10 m for rounded metres.
    - UTM and MGRS text up to and including 84° N and 80° S.
    - UPS text beyond them; for polar MGRS, it is enough that the square reaches beyond them.
    - Text on the wrong side gets a message that names the other grid.
  - **Latitude and longitude:** DD, degrees and decimal minutes, and DMS. Hemisphere letters (prefix or suffix, in either order) or signs; with or without °, ′ and ″ (also `'`, `"`, `''`, `º`); compact `600724.4N 0153915.6E`; a comma or semicolon between the two.
  - **Axis order:** text without hemisphere letters is read **latitude first**. A latitude beyond 90° is an error, never a silent swap.
  - **Signs:** `-` and `+`, and the Unicode minus sign (U+2212).
  - **Length:** text longer than 100 characters is refused before it is parsed.
- **Cursor position:** a Map Pane overlay (`coordinates-cursor`, bottom left) shows the position under the pointer in the chosen format.
  - **`–`** before the pointer first moves over the map, over a part of the map outside its projection's valid area, and after a workspace switch until the pointer moves.
  - **Leaving the map** keeps the last position: the map view sends no event then (SDK `MapPointerEvent`).
- **An icon over the map** "Coordinates" (M4, brief function 8; a Map Pane overlay `coordinates-goto`, top right, `order` 15, after the map view's "Map controls" at 10; Crosshair icon). There is no panel any more. The icon opens a window headed "Coordinates" in the look's heading style, with a close button: the format choice above a "Go to" field that centres the map on a position typed in any format.
  - **Where it opens** (T-162; owner, 2026-11-10): as the map view's map settings window does, in the icon's place in the corner, so it grows to the left over the map; the icon is hidden meanwhile. It has the map settings frame: the pane colour, a hairline, the card shadow. It is part of the overlay, not the browser's top layer, and needs no scrolling: it holds two controls and a message.
  - **Focus:** opening puts the focus on the format choice. The close button, Escape in the window, or a press outside it closes it, and the focus goes back to the icon (unless the press outside took it). A press outside closes it once the press has ended, so that a click on the display settings icon below it lands before that icon moves up (owner, 2026-11-10). That Escape goes no further, so it does not clear the map's selection.
  - **Open or closed** is remembered per browser (local storage, `emc2.coordinates.open`), as the format is; refusing storage keeps it for the page.
  - **After "Go"** the window stays open and shows the message (owner, 2026-10-30).
  - **Without a map view** the icon is still there, for the format choice; "Go" is off, with a warning.
  - **Where the map went:** after "Go to" the window says where the map actually centred, read from `viewport.center`.
  - **When the map cannot show the point:** the map view then centres on the nearest point its projection can show (map-view-2d README; owner, 2026-10-12). The window says so: "Centred on …, the nearest point this map (EPSG:3413) can show to …".
  - **Tolerance:** a centre within 1 m of the requested point counts as that point.
  - **Contract:** this relies on map-view-2d's behaviour (clamping, and a viewport that is current when `goTo` returns), not on the SDK contract. `MapView.goTo` itself promises only to centre the map. A map view whose viewport lags behind would make the window report a move that did not happen.
- **Every workspace** (SDK 1.2.0, ADR-0039; brief function 7): the icon and the cursor display appear in every workspace (`workspaces: ['*']`), View, Simulation and any later one. The plugin names no workspace.
  - **One map view:** the map view is one map that always shows the workspace shown, with that workspace's own map state: "go to" centres the map of the workspace shown, and the cursor display shows positions on it. A switch does not change the plugin's status (owner, 2026-10-27).
  - **On a switch:** the shell mounts the icon and the cursor display again (SDK `CurrentWorkspace`; the shell's switch fix, 2026-10-29). The window opens or stays closed as remembered, and starts empty, without the "Go to" text or the last message, and the cursor display shows `–` until the pointer moves over the new map. The chosen format stays: it is the service's.
  - **In a shell that keeps them mounted**, as the shell did until 2026-10-29, both still drop what was of the other workspace's map (owner, 2026-10-28; kept as a guard, 2026-10-29):
    - the window clears its last message ("Centred on …" or an error) and keeps the "Go to" text;
    - the cursor display shows `–` until the pointer moves over the new map;
    - both listen through `ctx.workspace.onChange`.
- **Look** (T-054, ADR-0034): the icon, its window and the cursor display follow the user's look, light or dark, and density. The CSS takes every colour, font, size, space, corner radius and shadow from the `--emc2-` design tokens. The icon buttons, the format choice, the Go button and the messages are the SDK's shared components (`IconButton`, `Select`, `Button`, `Notice`), with Lucide icons. The icon is a map control like the map view's: the pane colour and the card shadow. The window is ten rows wide, so it grows with the density. The cursor display is a map control: the panel colour, the card shadow, the data font. The test checks the CSS with the SDK's `checkLookCss` (SDK 1.2.0), the CSS part of the conformance reviewer's check 9.
  - **The "Go to" field** is the plugin's own input, styled like the SDK's: it keeps the browser's spell check off for text like `33VWG`, which the SDK's `TextField` cannot (owner, 2026-10-21). Positions are typed in the data font.

## Settings

| Name | Default | Unit | Meaning |
|---|---|---|---|
| `defaultFormat` | `dms` | | The display format until the user picks one in this browser (owner decision, 2026-10-05) |
| `mgrsPrecision` | `5` | digits | MGRS digits per axis (5 = 1 m) |
| `dmsSecondsDecimals` | `1` | decimals | Decimals of the seconds in DMS (0–3) |

**The form** (SDK 1.8.0 part D, T-204): each description is at most 80 characters, so the shell shows it as the hint under the field; all three fields are short by their type, with no groups; the two numbers show their unit after the field (owner, 2026-11-15). The SDK's `settingsHintsProblem` finds nothing in the schema (tested).

Changes made in the settings view apply at once (SDK v1, CR-0012):
- **Precisions:** the new precisions apply at once, in the service and the cursor display.
- **Default format:** a new `defaultFormat` applies while the user has not picked a format. A pick wins over the default from then on, in this browser and in later sessions. It may come from the window, or from another plugin through `chosenFormat.set`.

A bad value, at start or in a change, is logged as a warning and replaced by the default. The plugin status is then `DEGRADED` with the reason, and `OK` again once the value is fixed.

## Messages and services

- **Provides:** `CoordinateService` (`emc2.coordinates`). It is provided at once in `activate`, before the map view is there.
- **Uses** (manifest `uses`, CR-0012): `MapView` (`emc2.map-view`) for pointer events and `goTo`. The shell loads `coordinates` without a map view too, so other plugins keep `CoordinateService`. Without it, the service and the format choice still work. There is no cursor overlay and no "go to", and the status is `DEGRADED` ("map view unavailable").
- **Topics, endpoints, objects:** none.
- **Libraries:**
  - `proj4` 2.22.0, shared through the shell's import map, for UTM. It is called with projection strings only and never registers a definition (design pattern, FAQ: only `map-view-2d` owns proj4's global state).
  - `mgrs` 2.2.0 (MIT), bundled, for MGRS in the UTM area. The polar MGRS letters are this plugin's own code.
  - `lucide-react` 1.49.0 (ISC), shared through the shell's import map, for the icons (owner, 2026-10-21).

## Permissions and internet

None. The plugin makes no network request.

## Known limits

- **No overlap between UTM and UPS:** parse keeps to the brief's limits. GeographicLib also accepts UPS up to 0.5° on the UTM side, and UTM up to 0.5° beyond the limits; this plugin rejects such text with a message that names the other grid. For example, GeographicLib's own example `YUB17770380` (83.6° N) is rejected.
- **Text right at a limit:** within about a metre of 84° N or 80° S, the rounded or truncated text can land on the other side of the limit. It then formats back in the other grid, still within the format's precision.
- **84° N differs from GeographicLib:** at exactly 84° N the `utm` format shows UTM, as the brief says. GeographicLib's GeoConvert answers UPS there (it uses UTM below 84°). At exactly 80° S both give UTM.
- **No hemisphere letters in UTM:** UTM text takes the latitude band after the zone, not N or S for the hemisphere. `33N 536360 6665340` means band N (0° to 8° N), so a northing outside that band is an error, not a southern or northern position.
- **MGRS is the south-west corner:** "go to" with an MGRS text centres on the south-west corner of its square, which is up to 1.4 m from the original point at 1 m precision, and further at lower precisions.
- **MGRS at exactly 84° N between 0° and 42° E** uses the normal zone, not the Svalbard zone, because the `mgrs` library applies the Svalbard rule only below 84°. UTM uses the Svalbard zone there, as GeographicLib does.
- **No zone check on parse:** parse does not check that an easting or a 100 km square lies inside the zone's longitudes (for example, zone 32X does not exist).
- **No decimal comma:** `60,5 15,25` is read as two numbers separated by a comma.
- **Import map:** until the shell writes its import map (T-014), the web build accepts every module of a shared library (design pattern, FAQ).

## Tests

`web/test/` (Vitest):
- **`conversions.test.ts`:** acceptance criteria 1–5 and the parse variations and errors.
- **`plugin.test.tsx`:** activation, criteria 6–8, 10 and 11, settings and storage, the settings form's hints, widths, units and the icon (T-204), and the shared look (`checkLookCss` on the CSS, with a broken case, and the shared components and icons). Criterion 10 uses the test kit's fake workspaces and switches in the shell's order, keeping the window and the cursor display mounted, as a shell might. Criterion 11 opens and closes the window with the close button, Escape and a press outside, and checks the focus, the remembered state, that the Escape stays in the window, that a press inside keeps it open, and (T-162) that it opens in the icon's place, not in the top layer. In the browser (criterion 12): how the icon and the window look in each look and density, whether the icon lines up with the map view's, and criteria 10 and 11 in View and Simulation.
- **`reference-points.ts`:** the 18 independent reference points from GeographicLib GeoConvert, with the source and date.
