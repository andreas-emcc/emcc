# ACA review of SDK 1.3.0, the version step and build step 2 (T-091)

- **Reviewed:** on `integration/sdk-v1.3`:
  - the version step, `0c85c90` (the PDA's `3eab92c`, the MCA's pins `6008b54`, the CDA's version lines `5a0bbe2`);
  - build step 2, CR-0028 part 1 (WMS), `85ce6df`: the PDA's `70cca6a` with its briefs, the CDA's `provide` fix (`a459d68`), and `map-view-2d`'s "not supported" (`7377f19`).
- **Against:** CR-0028 and CR-0023 as approved, ADR-0035, and the owner's Q3 (`setSettingsPanel` optional until T-073).
- **By:** the ACA, 2026-10-30. Lean, as asked: findings with a fix owner.

## Verdict

**The version step: no findings.**
- Both SDKs, the test kit, the model and every schema's text are 1.3.0, and so are ECore's `DATA_MODEL` and SDK lines.
- All 12 plugin web packages (the template's included) and the shell pin `@emc2/plugin-sdk` 1.3.0, and no `1.2.0` pin is left. No plugin's `sdkVersion` changed.
- The shared version cases add `^1.2.0` against 1.3.0 (accepted) and `^1.3.0` against 1.2.0 (refused).
- The store reads a 1.2.0 snapshot, since it migrates only on a major version.
- ADR-0043's item for the PDA is done: the boundary example has a boundary's code (`110100`).

**Step 2: one finding, F1, which T-075 needs fixed; otherwise it matches CR-0023 items 1 to 4.**
- **`WmsSource`:** its TSDoc carries ADR-0035's contract and CR-0023 item 1's duties:
  - the plugin's endpoint, never the WMS server (ADR-0030);
  - codes, never `'any'`;
  - the parameters, each once;
  - the sizes, the axis order, the extent and the failures.
- **`provide`:** returns an `Unsubscribe`, which works once.
- **`setSettingsPanel`:** optional, as Q3 says, with its four types. The fake's `ui` is `Required<Ui>`.
- **The fake:** has `settingsPanel`, `settingsPanelProps()`, `settingsSaves`, `settingsPanelUnsaved` and `saveSettings`. It refuses a save by a user without `settings.admin`.
- **`wmsGetMapUrl`:** is tested in both versions, with a box where latitude ≠ longitude.
- **The shell's undo:** removes only its own `provide`.
- **`map-view-2d`:** refuses a `wms` source until T-072.
- **The briefs:** `basemap-wms` is built after T-072 and T-073, and `map-view-2d`'s function 3 and criteria 55 to 59 follow ADR-0035.

## Findings

- **F1 (medium; CDA, with a TSDoc line by the PDA): the shell lets a plugin provide a key only once.**
  - **What is wrong:** `ServiceRegistry.provide` throws "`<plugin>` already provides `<key>`" when a plugin provides a key it already provides. But `basemap-wms` needs one `BackgroundMapProvider` per background (its brief, function 5 and Interfaces), all on the one `many` key. The fake allows that, and so does the SDK's own test (`wms.test.tsx`, two backgrounds from `basemap-wms`).
  - **The effect:** `basemap-wms`' tests pass, and in the browser its second background throws.
  - **Fix:**
    - **CDA, with T-073 and before T-075:** the registry lets a plugin provide a `many` key several times. Each `provide` keeps its own entry and its own `Unsubscribe`, with a test of two providers from one plugin.
    - **PDA, in step 3:** `provide`'s TSDoc states it ("a plugin may provide a `many` key more than once; each call adds one implementation"). Then it is part of the frozen contract, not only of the fake.
- **F2 (low; PDA, text): the parameters' order.**
  - **What is wrong:** `wmsGetMapUrl` writes the parameters "in that order", and `map-view-2d`'s criterion 55 says each tile request "equals" its URL. But `WmsSource`'s contract fixes no order, and OpenLayers' WMS sources, which ADR-0035 has the map view use, write them in their own order.
  - **Fix, in step 3:**
    - `wmsGetMapUrl`'s TSDoc and criterion 55 say "the same parameters": tests compare the parameters, not the string;
    - `WmsSource`'s TSDoc says that a server part reads them by name, in any order.

## For the board (MCA)

The release freezes after T-073, when the PDA makes `setSettingsPanel` required, as W1 did for 1.2.0. If the owner wants the freeze earlier, the member stays optional in 1.3.0.

Step 1's F1 (`docs/architecture/reviews/sdk-1-3-0-step-1.md`) is still open, for step 3.
