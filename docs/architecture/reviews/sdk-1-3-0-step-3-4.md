# ACA review of SDK 1.3.0, build steps 3 and 4, and the freeze (T-091)

- **Reviewed:**
  - **step 3,** CR-0028 parts 3 and 5 with the fixes, on `integration/sdk-v1.3` at `6d53923`: the PDA's `pda/sdk-1.3-part35`, merged as `0b74fea`, and its users (the CDA's `enabledWhen` form, T-106, T-107, T-102), so far as they carry the contract;
  - **step 4,** `setSettingsPanel` required, on `pda/sdk-1.3-step4` at `b0fc2f3`, not yet merged;
  - **the runtime items** that my reviews of steps 1 and 2 left open, as they stand at `6d53923`.
- **Against:** CR-0028 as approved, the owner's Q3 and Q4, my reviews of steps 1 and 2 (`sdk-1-3-0-step-1.md`, `sdk-1-3-0-step-2.md`).
- **By:** the ACA, 2026-10-31. Lean, as asked: findings with a fix owner, then the freeze.

## Verdict

**Step 3 and step 4 do what CR-0028 says. The earlier findings are closed, and one test-kit leftover remains before the freeze (F1).**

- **Part 3, the declared-fields list:**
  - `DeclaredFields` keeps its props and helpers;
  - "Other fields" is a disclosure button with `aria-expanded` and the count, open from the start when one of its fields has a value;
  - there is no "+" and no remove button;
  - a field the editor may not set is read only;
  - its two users moved with it in one run (T-106).
- **Part 5, `enabledWhen`:**
  - **docs:** `model/README.md` says what it is, an annotation that leaves validation unchanged and makes `kind` optional;
  - **example:** `manifest-layer-picker.json` carries it;
  - **test:** `examples.test.mjs` checks its shape and that a disabled field's value is still valid;
  - **the shell's form:** greys the field, keeps its value, and works inside a list's items.
- **The fixes:**
  - `FakeChannels.release()` is one new test-kit member, by the owner's Q4.
  - **Step 1's F1:** the lock's place against `ENTITY_EXISTS` and `EXTERNAL_REF_EXISTS` is in "Changes in 1.3.0".
  - **Step 2's F1:**
    - `provide`'s TSDoc lets a plugin provide a `many` key more than once;
    - the shell does so, each `provide` with its own undo, but a `one` key only once, and has a test for it.
  - **Step 2's F2:** the GetMap parameters have no fixed order, and tests compare parameters.
  - The owner's DY (a `'tiles'` source drawn as one image where an extent does not tile) is in `WmsSource.mode`.
- **Step 1's items for the board (T-098):**
  - **the codec:** ECore's codec maps `locked`, and ECore's own test round trips `layer-locked.json`;
  - **the layer update:** the store builds its layers with all seven parts, so a stored lock is kept. No call to the 1.2.0 constructor is left in `ObjectStore`.
- **Step 4:** `Ui.setSettingsPanel` is required, as Q3 and W1 have it, and the fake's `ui` is `Ui` again. No other member changes.
  - **Two callers outside the PDA's files still use `?.`:** `basemap-wms`' `web/src/index.tsx` and the shell's `loader.test.ts`. They fail lint once the member is required, so they change in the same run, as the PDA's notes say.

## Findings

- **F1 (low; PDA, the test kit): `CODEC_PENDING` still skips `layer-locked.json`.**
  - **What is wrong:** ECore's codec maps `locked` since T-098, but the SDK's `ModelCodecContractTest.CODEC_PENDING` still holds the example. `sdk-v1.md`, "What waits for ECore and the shell", still lists the codec and the store as open.
  - **The effect:** frozen this way, the SDK's own contract test would never check `locked` for any codec.
  - **Fix, in step 4:**
    - empty `CODEC_PENDING`, as W2 did for 1.2.0;
    - mark both items in that paragraph done.

  ECore's codec already round trips the example, so its test should stay green; the run of step 4 shows it.
- **F2 (low; CDA, the form): no warning for an `enabledWhen` the form cannot use.**
  - **What is wrong:** CR-0028 part 5 says such an `enabledWhen` (an unknown `property`, an empty `in`) leaves the field enabled "and logs a warning once". The form leaves it enabled, but logs nothing, so a plugin's typo goes unseen.
  - **Fix:** log one warning per plugin and property. It is runtime only, so it can come after the freeze. If the owner prefers no warning, the PDA drops the words from the CR's text instead.

## Recommendation on the freeze

**Freeze SDK 1.3.0 and data model 1.3.0 once step 4 is on `integration/sdk-v1.3` after a green run.** That run must hold three things:
- step 4 with F1;
- `basemap-wms`' change;
- the shell's `loader.test.ts` change.

Nothing else in the contracts is open:
- **step 1's F1:** closed;
- **step 2's F1 and F2:** closed;
- **CR-0028:** all five parts are built, with their docs, examples and tests;
- **the users:** the waiting users of every part run on 1.3.0.

F2 is not a contract change and need not hold the freeze.
