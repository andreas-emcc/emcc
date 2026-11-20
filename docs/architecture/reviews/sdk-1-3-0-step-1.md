# ACA review of SDK 1.3.0, build step 1 (T-091)

- **Reviewed:** CR-0028 step 1, parts 2 and 4: the PDA's `1194c95` and its briefs `205bcf0`, on `integration/sdk-v1.3` at `7653c56`.
- **Against:** CR-0028 as approved (with R1 and N1 to N4, `cr-0028-sdk-1-3-0.md`), ADR-0042, and ECore's `ObjectStore` on `main`.
- **By:** the ACA, 2026-10-30. Lean, as asked: findings with a fix owner.

## Verdict

**No blocking findings.** Step 1 builds what CR-0028 parts 2 and 4 say:
- **The model:** `locked` in the layer's schema, with `false` kept as absent and an absent one kept on update (rule 5's second exception). Also `LAYER_LOCKED` with N1's texts, N2's paths, N3's create and R1's order in "Changes in 1.3.0".
- **Java:**
  - `LayerContent.locked`, `isLocked` and `withLocked`, with the 1.1.0 and 1.2.0 constructors kept, so the change is binary compatible;
  - `FakeStore` refuses only `applyAs(by, user, change)`. The lock comes after the permission, `ENTITY_NOT_FOUND` and `LAYER_NOT_FOUND`, and before the rules, the declared fields and `LAYER_NOT_EMPTY`. A server part's changes pass (ADR-0042 points 4 and 5).
- **Web:** the fake's default policy gives the same answers, with the same paths, before the declared fields. Its draw-order exception compares only the requester's namespace, as rule 5 keeps the others.
- **Part 4:** the right click is in the TSDoc of `pickPoint`, `draw`, `edit` and `dragObject`, and the fake map view has `rightClick()`. The TSDoc also covers picking by outline and the overlays' stacking.
- **The four briefs** follow ADR-0042 point 8: read-only editing, no placing into or drag in a locked layer, and the lock beside the eye in `layer-panel`.

Every case in ADR-0042 point 3 has a test in both test kits, and so do N2's paths and N3.

## Finding

- **F1 (low; PDA, text):** R1's order (my text) does not place `ENTITY_EXISTS` and `EXTERNAL_REF_EXISTS` against `LAYER_LOCKED`. The Java fake checks `ENTITY_EXISTS` before the lock and `EXTERNAL_REF_EXISTS` after it. That matches ECore's create, which checks `ENTITY_EXISTS` first and the external identity after the content.

  **Fix:** in a later step, the PDA adds half a sentence to "Changes in 1.3.0": `ENTITY_EXISTS` comes before the lock, and `EXTERNAL_REF_EXISTS` after it. Until then the CDA follows the Java fake in T-098.

## For the board (MCA)

T-098 has two clean-ups, which `sdk-v1.md` names under "What waits for ECore". They belong in its definition of done:
- ECore's codec maps `locked`, so `ModelCodecContractTest.CODEC_PENDING` is empty again;
- the store's layer update no longer goes through the 1.2.0 constructor, which drops a stored lock.

Until then nothing on the integration branch sets a lock. T-099 waits for T-098.
