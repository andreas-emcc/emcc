# W1: the guards to drop (web round)

- Written by the PDA on 2026-10-29 for W1's web round (owner, 2026-10-29: AN; T1, 2026-10-28), on `pda/w1-web` after merging `integration/sdk-v1.2` at `7c26f1d` (the lines were found at `89bb40b`; nothing since then changed web code).
- **What changed:** four web members are required since W1: `ctx.declaredFields`, `ctx.workspace`, `ctx.workspaces` and `MapView.createFadeList` (`docs/plugins/sdk-v1.md`, "Before the freeze"). Code that still guards them is now dead, and most of it fails lint (`@typescript-eslint/no-unnecessary-condition`, from `strictTypeChecked`). Typecheck and every test still pass.
- **How to use this list:** each owner drops their guards on a branch from `pda/w1-web`. The MCA merges `pda/w1-web` together with every owner's branch, then one full run (V1). Paths are from the repository root; "(2)" is two lint errors on one line. Line numbers are those on `pda/w1-web`.
- **Found by:** `eslint .` and `tsc --noEmit -p .` in every web workspace (`web/plugin-sdk` has no lint config; its own guards are gone), and a search for `?.`, `??`, `=== undefined`, `typeof`, `in` and Proxies on the four members. List A is complete (lint finds exactly these); B and C come from a search and cannot be: look near each listed line for code that exists only because a member was optional, and drop it too.

## A. Lint fails: drop these in the same run (56)

| Owner | Count | Where |
|---|---|---|
| CDA | 8 | `web/shell/src/boot.test.tsx:201`, `:208`; `web/shell/src/plugins/loader.test.ts:149`, `:163`, `:164`, `:166`, `:167`, `:169` |
| PCA-bookmarks | 2 | `plugins/bookmarks/web/test/workspaces.test.tsx:46` (2) |
| PCA-coordinates | 1 | `plugins/coordinates/web/test/plugin.test.tsx:609` |
| PCA-draw-shapes | 7 | `plugins/draw-shapes/web/src/controller.ts:175`; `src/workspace.ts:11` (2), `:16`; `test/harness.tsx:72`, `:101`, `:102` |
| PCA-draw-symbols | 15 | `plugins/draw-symbols/web/src/controller.ts:197`, `:209` (2), `:214`, `:218`, `:219`, `:361` (2), `:384`, `:428` (2), `:717`; `src/index.tsx:64`; `test/fakeServer.ts:151` (2) |
| PCA-layer-panel | 4 | `plugins/layer-panel/web/src/controller.ts:105`, `:114` (2); `test/workspaces.test.tsx:399` |
| PCA-map-view-2d | 10 | `plugins/map-view-2d/web/src/activate.tsx:131` (2), `:150`, `:151`, `:161`; `test/workspaces.test.ts:75`, `:76`, `:116`, `:280`, `:571` |
| PCA-object-list | 3 | `plugins/object-list/web/src/controller.ts:128`, `:135` (2) |
| PCA-simulator | 6 | `plugins/simulator/web/src/editor.ts:106`; `src/fade.ts:15` (2), `:17`; `src/index.tsx:43`, `:88` |

All 56 are on the four members, or on a value read from them: `?.`, `??` with a fallback (View, `[]`, `null`), or `=== undefined` and `!== undefined`. Since 2026-10-28 (50, plus 5 for `createFadeList`) the count rose to 56 by coordinates' test (`:609`, from its T-085 work); map-view-2d's and the simulator's lines moved, and the CDA's switch fix (`6326a24`) changed none of the shell's. basemap-naturalearth, basemap-osm, symbology and the template lint clean.

## B. No lint error, but dead: drop these too (same branches)

Lint cannot see these, since the type still allows `undefined` or a Proxy hides the member. Each tests or handles a case that can no longer happen.

| Owner | Where | What |
|---|---|---|
| PCA-coordinates | `plugins/coordinates/web/src/CoordinatesPanel.tsx:31`, `:32`, `:46`; `src/CursorPosition.tsx:11`, `:12`, `:31` | the prop `workspace: CurrentWorkspace \| undefined` and `workspace?.onChange`; `ctx.workspace` is never undefined |
| PCA-coordinates | `plugins/coordinates/web/test/plugin.test.tsx:712`, `:721`, `:739` | the helpers `panelWith` and `cursorWith` that take `CurrentWorkspace \| undefined`, and the test "works without ctx.workspace" that needs them |
| PCA-draw-symbols | `plugins/draw-symbols/web/src/controller.ts:320`, `:321`; `src/PropertiesPanel.tsx:218`; `src/SymbolsPanel.tsx:82` | the getter `declaredFields` typed `readonly DeclaredField[] \| undefined` ("or undefined until the shell provides them"), and its readers' `declaredFields !== undefined &&` |
| PCA-layer-panel | `plugins/layer-panel/web/test/workspaces.test.tsx:188`, `:191` | a Proxy that hides `workspace` and `workspaces` |
| PCA-object-list | `plugins/object-list/web/test/workspace.test.tsx:303`, `:305` | a Proxy that hides `workspace` and `workspaces` |
| PCA-simulator | `plugins/simulator/web/src/fade.ts:13`, `:14`, `:29`, `:36` to `:37`, `:43`; `src/index.tsx:152` | the fade tidy (A56): the constructor's `workspace: CurrentWorkspace \| undefined` and `if (workspace !== undefined)`, the comment "Optional until map-view-2d provides it", the getter `active` (nothing uses it), and `this.list?.clear()` while `list` stays `FadeList \| null` |
| PCA-simulator | `plugins/simulator/web/test/harness.tsx:124`, `:135` to `:138`; `test/actions.test.tsx:173`, `:174` | the option `withoutFade`, a Proxy that hides `createFadeList`, and its test "a map view without fade lists (before T-085)" |

**The shell's own wiring (the CDA's call).** The shell gives the members, so these are not guards on a `ctx` read, but they exist only because the members were optional: `web/shell/src/plugins/context.ts:97` (`NO_WORKSPACE`), `:196`, `:200` (`env.workspace?.…`; `boot.tsx` always passes `workspace`); `web/shell/src/actions/actions.ts:41`, `:50`; `web/shell/src/actions/deletion.ts:84`; `web/shell/src/layers/changer.ts:101` (`options.workspaces?.()`). Likewise `map-view-2d`'s `src/core/controller.ts:234` (`options.workspace ?? VIEW_WORKSPACE`; `activate.tsx` always passes it) may stay as a default for its tests: PCA-map-view-2d's call.

## C. Wording only: names and comments that say "optional" or "without"

These pass as they are; they read wrong after W1.

| Owner | Where |
|---|---|
| CDA | `web/shell/src/actions/actions.ts:35`, `web/shell/src/actions/deletion.ts:42` ("View until the shell has workspaces"); `web/shell/src/plugins/context.ts:64` ("without it View"); `web/shell/src/layers/changer.ts:43`; `web/shell/src/actions/registry.ts:6` |
| PCA-bookmarks | `plugins/bookmarks/web/test/workspaces.test.tsx:45` ("ctx.workspace is optional in SDK 1.2.0") |
| PCA-coordinates | `plugins/coordinates/README.md:52` ("absent until a shell has workspaces") |
| PCA-draw-shapes | `plugins/draw-shapes/web/src/workspace.ts:3` ("`ctx.workspace` is optional"), `src/controller.ts:597`; `test/workspace.test.tsx:85` (the test name; the fake context gives View) |
| PCA-draw-symbols | `plugins/draw-symbols/web/src/controller.ts:207`; `test/placefields.test.tsx:172`, `test/fields.test.tsx:256` (test names "without ctx.declaredFields": the fake context now gives an empty list, so they test that) |
| PCA-layer-panel | `plugins/layer-panel/web/src/controller.ts:112` |
| PCA-map-view-2d | `plugins/map-view-2d/web/src/core/controller.ts:72` |
| PCA-object-list | `plugins/object-list/web/src/controller.ts:133`; `plugins/object-list/README.md:29` ("Without `ctx.workspace` (a shell before T-080)") |
| PCA-simulator | `plugins/simulator/README.md:186` ("Without `createFadeList` (before T-085), nothing is faded") |
