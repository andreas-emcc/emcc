# SDK 1.x requests: the PDA's view

- Owner: PDA · Date: 2026-10-16 · For the owner's decision on the collected SDK change requests (the MCA collects them).
- The CRs decide. This file only gives the SDK's view on each: whether it fits the frozen 1.1.0 contract, what it costs, and what the PDA recommends.
- **Decided by the owner (2026-10-16):** CR-0016 option B (the bookmarks brief changes); CR-0017 rejected (the object-list brief changes); CR-0018, CR-0019 (with `List`'s keys) and CR-0021 approved and folded into 1.1.0 before it reaches `main` (built on `pda/sdk-v1.1-additions`); CR-0020 decided on its own.

## Summary

| CR | From | Asks for | SDK change | PDA recommends |
|---|---|---|---|---|
| CR-0016 | PCA-bookmarks | A bookmark centre the projection cannot show | Option A: `MapView.canShow`; option B: none | **B** (brief edit only) |
| CR-0017 | PCA-object-list | `openMenu` returns which action ran, once it has finished | `openMenu(...)` returns `Promise<MenuOutcome>`; the fake's `closeMenu()` | **Approve**, with two details |
| CR-0018 | PCA-draw-shapes | A shared colour field | A new component | **Approve**, named `ColorField` |
| CR-0019 | PCA-bookmarks | Arrow keys in `Tree` and `Menu`, drag and drop in `Tree` | Keys: no API change; `onDrop` and `canDrop` on `Tree` | **Approve**, with `List`'s keys too |
| CR-0020 | PCA-draw-shapes | Written (Proposed) | – | In SDK 1.2.0: the route editor needs it (the ACA's view, 2026-10-22; CR-0025) |
| CR-0021 | PDA (the CDA's proposal) | Dialog and popover in the top layer | An optional `anchor` on `Popover` | **Approve** (written by the PDA) |

All are compatible: no prop, field or call changes its meaning, and a plugin built for `^1.1.0` keeps working. Behaviour that changes without a change of meaning: CR-0017's `openMenu` returns a promise (only its implementers, the shell and the fake, see it); CR-0019's tree becomes one Tab stop; CR-0021's dialog traps the focus.

## Version

**Recommended: one release for all approved CRs.** Both SDKs stay at one equal version, as before. The Java SDK gets the version only.

The choice is between:
1. **Fold them into 1.1.0 before it reaches `main`** (recommended if the timing fits). 1.1.0 is so far only on `integration/sdk-v1.1`, so no plugin outside that branch depends on it. This means no second version bump of both SDKs, every plugin's pin and the lock file. The owner freezes 1.1.0 again with the additions.
2. **1.2.0 after 1.1.0 is on `main`.** New props, a new component and a new return type are additions; by semantic versioning that is a minor version. A plugin that uses one declares `^1.2.0`.
3. **1.1.1:** possible, but a patch number then carries additions. That makes "1.1.x" less useful for fixes.

Decided: CR-0018, CR-0019 and CR-0021 were folded into 1.1.0 (owner, 2026-10-16); the next batch is 1.2.0 (owner, 2026-10-19), below.

## The SDK 1.2.0 batch (at the start of M3)

**Built as CR-0025** (approved by the owner 2026-10-22; `docs/change-requests/CR-0025-sdk-and-data-model-1-2-0.md`), in five parts, and given version 1.2.0 on 2026-10-26: `sdk-v1.md`, section "SDK 1.2.0", maps every addition. The list below is the batch as it was collected.

Owner, 2026-10-19: one release at the start of M3. **Owner, 2026-10-22: M3 is the Simulator** (ADR-0036 to ADR-0040, `docs/architecture/m3-simulator-decisions.md`). SDK 1.2.0 and data model 1.2.0 become one release through one change request, **CR-0025** (T-076; Proposed), which holds the items below and ADR-0036 to ADR-0039's additions: connection tasks (the listener deprecated), output channels (input channels defined), declared fields, workspaces and the layer's `workspace` field, and a settings field type for picking a layer (ADR-0037); and for ADR-0040, fade lists in `MapView` and geodesics in the Java SDK. CR-0020, CR-0022 and CR-0024 keep their own decisions. It holds:
- CR-0022 (an `internet` declaration without hosts; on `pda/cr-0022`, not yet merged): it stays in 1.2.0, since it is not tied to WMS (owner, 2026-10-19 and 2026-10-22);
- CR-0020 (cancel a map interaction): in the release, since the simulator's route editor needs it (the ACA's view, 2026-10-22, taken in CR-0025);
- **not CR-0023** (a WMS source and a plugin's own settings panel): it moves to M4 with WMS, in the release after 1.2.0 (owner, 2026-10-22);
- CR-0024 (written by PCA-layer-panel): an optional `title` on the shared `IconButton`, a tooltip apart from its `label`, as `Button` has; in the batch if the owner approves it;
- the collected points: `Button`'s `aria-expanded` and `aria-haspopup`; the popover's presses inside a dialog;
- **A shared look check in the test kit (owner, 2026-10-21):** one helper in `@emc2/plugin-sdk/testing` that implements the CSS part of the conformance reviewer's check 9 (`.claude/agents/conformance-reviewer.md`, since `9fa6439`), so that the plugins' token tests follow one rule instead of three (`layer-panel` criterion 14, `draw-symbols`' `tokens.test.ts`, `draw-shapes`' `css.test.ts`).
  - For example `checkLookCss(css, { pluginId })`, returning the findings, each with its line, property, value and rule; a plugin's test expects none.
  - It reports what check 9 fails in CSS: literal colours; lengths with a unit in the listed properties; a `font-family` that is not a token; a `var(--…)` that is neither in `TOKENS` nor the plugin's own `--<id>-…`; a definition of an `--emc2-` property; the 1.0 aliases (`TOKEN_ALIASES`); classes not starting with the plugin's id, and rules on the shared components' `emc2-` classes. It lets pass what check 9 lets pass, including the colours fixed in every look (the APP-6 affiliation colours, the selection highlight), which a plugin names in an `allow` option.
  - Inline styles and what a plugin draws itself stay with the reviewer's search (check 9), not the helper.
  - Test kit only, with no new dependency: a small CSS reader of its own, as the three tests have now. The SDK's own tests cover each rule with a passing and a failing case.
  - When check 9 changes, the helper follows in the next SDK release; the reviewer's text stays the rule;
- **`TextField`, from PCA-draw-symbols (its shared look, 2026-10-18; owner, 2026-10-21):** optional `readOnly`, `inputMode`, `autoComplete` and `spellCheck`, passed to the input; and its error text linked with `aria-describedby`, as `ColorField` does. Today it sets `aria-invalid`, and the error text sits inside the `<label>`, so it is read as part of the name; the text moves out of the `<label>` with the link, so that it is not read twice. Compatible additions. Until then `draw-symbols` uses `disabled` for its read-only fields;
  - **Its height, from PCA-coordinates (2026-10-21):** the input (`.emc2-input` in `components.css`) sets `height: var(--emc2-size-field)` but no `box-sizing`, so as a `content-box` it stands 2 px higher (its 1 px borders) than `Select` and `Button` beside it. `box-sizing: border-box` on `.emc2-input` fixes it. `ColorField`'s text input has the same class, and its swatch (`.emc2-color-swatch`) is `content-box` on purpose to match that input today, so the swatch becomes `border-box` with it; otherwise the two stand 2 px apart. `Select` has the same class, but a `<select>` is `border-box` already, which is why only the text inputs stand higher. A visual detail, no CR needed (owner, 2026-10-21). Until then `coordinates` keeps its own token-styled "Go to" field, also because `TextField` cannot turn spell check off;
- **TSDoc only, from PCA-map-view-2d (owner, 2026-10-20):** a waiting `dragObject` is no running interaction for Escape. In `MapView.dragObject`: "While it only waits, one Escape ends it (resolves with null) and clears the selection. Once the object is grabbed, Escape cancels only the drag." In `MapView.selection`, after the line on a waiting `dragObject`: "and one Escape still clears it (ending the waiting drag); a grabbed drag, `pickPoint`, drawing and editing take the first Escape." The behaviour is the map view's; the SDK's contract does not change.

## SDK 1.3.0 (M4)

**Built as CR-0028** (approved by the owner 2026-10-30, with CR-0023 folded in; `docs/change-requests/CR-0028-sdk-and-data-model-1-3-0.md`), in three steps on `integration/sdk-v1.3`, and given version 1.3.0 after the first (2026-10-30): `sdk-v1.md`, section "SDK 1.3.0", maps every addition.

## SDK 1.5.0 (M6)

**Built as CR-0038** (approved by the owner 2026-11-09, NB A and NC A; `docs/change-requests/CR-0038-a-data-type-brings-its-field-sets.md`) **and CR-0039** (parts 2 to 5, approved by the owner 2026-11-10, OB A and OC A; `docs/change-requests/CR-0039-sdk-and-data-model-1-5-0-parts-2-to-5.md`), in parts on `integration/sdk-v1.5`, and given version 1.5.0 after part 1 (2026-11-10, NP A): `sdk-v1.md`, section "SDK 1.5.0", maps every addition.

## SDK 1.4.0 (M5)

**Built as CR-0030** (approved by the owner 2026-11-05; `docs/change-requests/CR-0030-sdk-and-data-model-1-4-0.md`) **and CR-0031** (relations between objects, approved 2026-11-06), in parts on `integration/sdk-v1.4`, and given version 1.4.0 after part 1 (2026-11-06): `sdk-v1.md`, section "SDK 1.4.0", maps every addition.

## Per CR

### CR-0016: A bookmark centre the projection cannot show
- **Recommendation: option B.** `goTo` keeps its decided behaviour (owner, 2026-10-12: it centres on the nearest point it can show), and the bookmarks brief's function 3 says so. The brief is the PDA's, so this is a one-bullet edit to `docs/plugins/briefs/bookmarks.md`, with no SDK change.
- **Option A** (`MapView.canShow(position)`) fits the contract as an addition. It needs `map-view-2d` to implement it and the fake to script it. No other plugin has asked for it. It can come later if one does.

### CR-0017: `openMenu` tells the caller which action ran
- **Fits:** changing `void` to `Promise<MenuOutcome>` is compatible for every caller (they ignore the value). Only the shell (CDA) and the test kit implement `openMenu`.
- **Recommendation: approve,** with two details for the TSDoc:
  - **If the shell gives up on a handler** (for example a timeout of its own), the promise resolves then, with `ran` set. It must never stay pending for good.
  - **An action whose handler only starts an interaction** (for example `draw-shapes`' Edit starting `MapView.edit`) resolves when the handler's promise settles. Whether that is after the edit is up to that handler. `object-list` re-reads its page then, and a later change still shows at the next count change or Refresh.
- **The fake:** `runObjectAction` resolves the promise, and `closeMenu()` closes the menu without a choice.

### CR-0018: A shared colour field
- **Fits:** a new component, built from the tokens and controlled, as the other shared components are.
- **Recommendation: approve,** with three details:
  - **Name it `ColorField`,** matching the code's spelling elsewhere (`strokeColor`, `fillColor`, `--emc2-color-*`). The prose of the docs keeps "colour".
  - **`value`** takes `#RRGGBB` in either case, as the model's pattern allows. **`onChange`** always gives lower-case `#rrggbb`.
  - **`onCommit`** follows `TextField`: on Enter, on leaving the field, and once when the browser's colour picker closes. So one pick sends one change request.

### CR-0019: Arrow keys in `Tree` and `Menu`, drag and drop in `Tree`
- **Fits:**
  - **The keys** need no API change. The roving `tabIndex` means the tree is one Tab stop instead of one per item. That is the ARIA tree pattern, and a behaviour fix, not a change of meaning.
  - **`onDrop` and `canDrop`** are optional props. Without them, nothing changes.
- **Recommendation: approve,** and add arrow keys to `List` in the same release (no API change). The SDK's open points name it, and `object-list` uses `List`.
- **Tests:**
  - keyboard: each key;
  - drop: the three places and `canDrop`, with Testing Library's drag events in jsdom;
  - a browser check for the drop marker.

### CR-0020 (written; in SDK 1.2.0, CR-0025)
In the release as CR-0025 part 1 point 8: the simulator's route editor needs it (the ACA's view, 2026-10-22). Its own decision stays with it.

### CR-0021: The shared dialog and popover in the top layer
Written by the PDA from the CDA's proposal and the owner's decision 4 (the CDA's part 5 plan).
- `ConfirmDialog` becomes a modal `<dialog>`, and `Popover` gets `popover="manual"` and an optional `anchor`. Both stay controlled.
- It reuses the placement, the press-outside handling and the tests of `pda/popover-layer`, but not its portal. That branch is not merged as it is.
- `bookmarks`' part 4 waits for it.
