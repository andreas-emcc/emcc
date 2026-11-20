# ACA review of SDK 1.4.0 part 5: each user's display settings

- **Reviewed:** `pda/sdk-1.4-part5` at `817e44f4` (from `pda/sdk-1.4-part4` `7fc4406c`): `0ab118bf` (the contract), `b9ab5c04` (the docs and the brief edits: `map-view-2d` function 35 and criteria 77 to 83; `symbology` function 14 and criteria 22 to 24).
- **Against:** CR-0030 part 5 and its question 5; CR-0031 section 3; ADR-0046 (points 1 to 7), ADR-0051 point 7, ADR-0052; the owner's Q13 (JD, 2026-11-07); the ACA's R5 on CR-0031; the data model's `speed` and `direction` (`map-object.schema.json`).
- **By:** the ACA, 2026-11-07. The PDA reports the web SDK's tests green; the ACA did not run them.

## Verdict

**Approve part 5 for `integration/sdk-v1.4`, and the two brief edits for the owner's approval.** The contract is CR-0030 part 5 with CR-0031 section 3 and the owner's Q13, and one deliberate departure from the CR's wording that the ACA supports: `ctx.display` is read-only in the type, not only by rule. One question goes to the owner before the briefs are approved (R1): with the CR's default labels, the direction arrow that APP-6 symbols show today disappears, because Q13 put `direction` on the labels' list. The rest are remarks.

## The PDA's five points

| | Point | ACA |
|---|---|---|
| 1 | **`ctx.display` as a `ReadonlyState`, not the CR's `SharedState`** | **Right, and better than the CR.** ADR-0046 point 5 says no plugin writes the settings; a type without `set` makes that a compile error instead of a rule to review. `SharedState` now extends `ReadonlyState`, so the selection and every 1.x reader are untouched. The MCA records the departure with a dated note in CR-0030's Decision, as for the earlier parts. |
| 2 | **Q13: `render`'s optional `labels`, passed by the map view; `symbology` reads no display settings** | **Right.** The settings stay in one reader per concern: the map view owns the size, the name and the speed vector, and hands the size and the labels to `render` as it hands the size today; `symbology` stays a pure drawing service, so palettes, legends and any other caller see no change. The image cache keys on the labels only when they change the drawing (symbology criterion 24), so shared images stay shared. See R1 on what the list does to today's arrow. |
| 3 | **`resolveDisplay`: `relations` holds exactly the loaded kinds; saved switches for absent kinds are kept** | **As CR-0031 section 3 and R5 say.** The resolved value has one switch per declared kind and no other (`displaySettingsProblem` checks both ways), the user's choice first, then the admin's, then `defaultOn`; a saved choice for a kind that is not loaded is left out of the value and never dropped from the document. The fake does the same with `setDisplay`. |
| 4 | **The labels' order: kept, but APP-6 amplifiers keep their places** | **Acceptable; say what it is for (R2).** With Q13 the order changes no drawing in M5: the amplifiers sit where APP-6 puts them, and `name` is the only label without a fixed place. An order that nothing reads is a trap for the next reader. |
| 5 | **The brief edits** | **Approve for the owner, after R1.** `map-view-2d` 35 reads the settings, applies no defaults, passes the size and the labels to every `render`, draws the name under the image below the text threshold as shape labels are drawn, and draws the speed vector as GD says: a geodesic line from the position along `direction`, `speed` × minutes × 60 metres, which is right because the data model's `speed` is metres per second; under the symbols, unwrapped at the antimeridian, faded with its object, never picked, inside the frame budget. Criterion 79's point has latitude ≠ longitude and the length within 1 m. `symbology` 14 filters only the ten amplifiers of the closed list, leaves the others as they are, ignores `name`, keeps `withText` for the text, and lets a vessel's hull turn whatever the labels. |

## Against the decisions

| Source | Result |
|---|---|
| ADR-0046 points 1 to 3 | Matches: the three settings with the CR's limits (16 to 96 pixels, 0 to 60 minutes with 0 hiding the vector, the closed list of labels), whole numbers, the admin's defaults in ECore's settings and the SDK's as their start (30, 0, `name` and `uniqueDesignation`). |
| ADR-0046 points 5 to 7 | Matches: read-only in the type, told at each change, the same in every workspace and browser, drawing only. |
| ADR-0051 point 7, ADR-0052 point 2, CR-0031 section 3 | Matches: one switch per declared kind, the window's section absent without kinds (the shell's), `defaultOn` as the last default. |
| ADR-0052 point 6 | Kept: the SDK adds nothing for plugins' own settings in the window. |
| CR-0030 part 5 | Matches, with the departure of point 1 above, and `ctx.display` optional until the shell has it, then required (question 5). The fake always has it, so a plugin's own tests never see the absent case; the map view's brief handles it by hand. |
| ADR-0047 point 9 | Matches: vessels take the size and the labels through `render` and the speed vector from the map view, as APP-6 symbols do. |
| Compatibility | A new optional context member, a new optional `render` field that an older service ignores, a new supertype of `SharedState`. Nothing a 1.3.0 plugin has to change. |

## Remarks

| | Remark | For |
|---|---|---|
| R1 | **The default labels hide today's direction arrow.** The data model's `direction` is "drawn as an arrow", and `symbology` draws it today for every APP-6 symbol that has one, text or no text. Q13 put `direction` on the labels' list, so with `labels` given the arrow is drawn only when `direction` is listed (symbology 14, criterion 23). The CR's default labels are `name` and `uniqueDesignation`, and the default speed vector is 0 minutes: so after part 5, with the SDK's defaults, a moving symbol shows neither an arrow nor a vector until a user or the admin changes a setting. That is a change of today's picture that the CR did not say. The ACA recommends `direction` in the default labels (`name`, `uniqueDesignation`, `direction`), which keeps today's picture and leaves the speed vector as the user's addition; the owner may instead prefer the vector on by default. One word from the owner settles it; the PDA changes `DEFAULT_DISPLAY` and the briefs' criteria accordingly, and the CDA's admin defaults follow. | Owner, PDA |
| R2 | **Say what the labels' order is for.** `DisplaySettings.labels`' doc says "in the user's order", and `sdk-v1.md` "kept for readers that stack labels". In M5 no reader stacks: the amplifiers keep APP-6's places and the map view draws `name` under the image. Say that the order is the window's and that drawing follows APP-6, so that nobody builds on it until a reader needs it. | PDA |
| R3 | **One rule set, in two languages.** ECore checks a user's and an admin's choices "with the same rules as `displayChoicesProblem`", but the Java SDK and the data model do not change, so the limits and the labels' list live in the web SDK and again in ECore. That is the precedent of the other `core` documents, and acceptable; the ITA's flow that saves a bad value (a size of 100, an unknown label) from the window and sees it refused is what keeps them aligned. Name that flow in the text for the CDA. | PDA (text), CDA, ITA |
| R4 | **`name` below the text threshold only.** Function 35 draws the name under the image "following the text threshold of function 6", so at a large picture the names go and the amplifiers go with them, as today. Right, and criterion 78 tests both sides. The name's position (under the image) is the map view's choice; APP-6 has no place for it. No change asked. | – |
