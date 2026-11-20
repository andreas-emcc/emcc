# ACA review of CR-0031: relations between objects (T-150)

- **Reviewed:** `docs/change-requests/CR-0031-relations-between-objects.md` on `pda/cr-0031` at `00a0750`, status Proposed, nothing built.
- **Against:** ADR-0051 and ADR-0052 (owner HG, 2026-11-05), ADR-0046 and ADR-0048 point 3; CR-0030 as approved (parts 3 and 5, unchanged); `model/README.md` rules 5, 13, 14 and 16 on `main` at `28008355`.
- **By:** the ACA, 2026-11-05.

## Verdict

**Approve, with the owner's answers to questions 1 to 3.** The CR implements ADR-0051's Consequences for the contracts and ADR-0052's setting per kind, as compatible additions to 1.4.0. The ACA agrees with the PDA's three recommendations, with one addition to question 2 (R1). The other remarks are for the CR's text, the model's README and the briefs, and block nothing.

## The owner's answers (2026-11-05)

The owner took the three recommendations below, asked one at a time by the ACA:
1. **the limit is 1 024 per object,** with `gmti`'s default cap per dwell at 1 000;
2. **on update a stored entry passes, per entry** (R1): an entry the stored object already carries passes, declared or not; every other entry's kind must be declared;
3. **relations are built in CR-0030's part 3, the switch in part 5.**

The ACA's follow-up to answer 2 is done on this branch: ADR-0051's index row says how point 2's "rejected on update" reads with point 3. The PDA puts the answers and R2 to R6 into the CR's text before the owner's approval word.

## The owner's questions (the ACA's recommendation first)

| | Question | ACA |
|---|---|---|
| 1 | The limit per object | **1 024, with `gmti`'s default cap per dwell at 1 000,** as the CR proposes. It meets ADR-0051 point 1, since the limit takes a dwell at the default cap. 65 535 would let one object grow to about 5 MB, sent to every browser at each revisit, for dwells that ADR-0048 point 3 caps anyway; 256 would cut a 200-track convoy's dwell for no gain. The simulator's own default for detections per dwell is the brief's choice and may be lower: see R4. |
| 2 | The kind's check on update | **A stored entry passes, declared or not,** as the CR proposes, **but per entry, not per kind** (R1): an entry (kind and id) that the stored object already carries passes; every other entry's kind must be declared. |
| 3 | Where it fits | **In CR-0030's part 3 beside field sets, with the switch in part 5,** as the CR proposes. `MapObjectContent` and the store's declared-list check then change once. CR-0030's text is not changed by it: part 3 and part 5 build two approved CRs in one step, and the board says so. If CR-0031 is not decided when part 3 is built, the CR's fallback, a part 7, holds. |

## Against the ADRs and CR-0030

| Source | Result |
|---|---|
| ADR-0051 point 1 | Matches: a reference in the content, kind and id, nothing else; the limit named by the CR takes a dwell at the default cap; `uniqueItems` and the UUID and name patterns are the schema's form checks, not checks against the other object, so point 3's "nothing else" stands. |
| ADR-0051 point 2 | Matches: `relationKinds` with id, label, line (colour, width, dash, arrowhead) and the switch's default; built at start-up; refused outside the namespace; undeclared kinds rejected on create; stored data never checked. On update the CR reads point 2 with point 3: see R1 and question 2. |
| ADR-0051 point 3 | Matches: any plugin writes, as content; the store checks the kind and the limit and nothing about the other object. Rule 5 unchanged for `relations` is the right reading of "updates carry the whole content": see R2. |
| ADR-0051 point 4 | Matches: never cascaded, stated as the model's text. |
| ADR-0051 points 6 and 7 | Matches: change events carry the list with the content; `DisplaySettings.relations` with a value for every declared kind, filled by the shell, read-only for plugins; the admin's defaults in ECore's settings. |
| ADR-0051 point 8 | In the briefs, as it should be: `gmti.pairing` off by default, the cap of 1 000, the simulator's 1 024. See R4. |
| ADR-0051 point 9 | Matches: editors forward the list; the build checks `draw-symbols` and the simulator. |
| ADR-0052 points 2 and 5 | Matches: the window and its absent section are the shell's; the admin's defaults beside the other display defaults. |
| ADR-0046 points 3, 5 and 6 | Matches: defaults by the admin, no plugin writes, the shell provides. |
| ADR-0048 point 3 | Matches: a cap per dwell, set per link; its default is the brief's. |
| CR-0030 part 3 | Consistent: the same shape as field sets (a declared list in the manifest, a list in the context, a check that lets stored ids pass). The two lists differ on update: see R2. |
| CR-0030 part 5 | Consistent: `ctx.display` gains a member; still read-only; `createFakeContext` and `setDisplay()` extend the existing fakes. |

## R1, question 2: let stored entries pass, not stored kinds

The CR lets "a kind that the stored object already carries" pass on update. Read per kind, an update may add a **new** id under an orphan kind, which nothing declares and nothing draws. ADR-0051 point 3 asks only that a writer "keeps the relations of other kinds that it finds", that is the same entries. So the rule is tighter and as cheap when it is per entry: **an entry that the stored object already carries passes; any other entry's kind must be declared.** A set of the stored entries decides it. The CR's rule 17 text and `sdk-v1.md` say "entry"; the fake store does the same.

The owner chose it (answer 2), and ADR-0051's index row carries the note.

## Remarks for the CR's text, the README and the briefs (no approval needed)

| | Remark | For |
|---|---|---|
| R2 | **Write the asymmetry down.** `fieldSets` keeps the stored list when absent (CR-0030, rule 5's third exception); `relations` is replaced as a whole and removed when absent. Both are right for their reasons, and a writer meets them side by side. Rule 5's first bullet lists `relations` among the core fields replaced as a whole, with one sentence why there is no exception (the simulator must be able to empty the list, and rule 13 makes `[]` absent). | PDA (CR text, `model/README.md`) |
| R3 | **An invalid-by-rule example for rule 17**, `rule-17-object-relation-unknown-kind.json`, beside `rule-14-object-unknown-data-type.json`. The CR's invalid examples are all schema failures; the store's rule has none. | PDA |
| R4 | **The simulator's platform re-sends its list at every tick.** The platform moves on a route (ADR-0048 point 7), so the simulator writes its content each tick, and rule 5 means the content carries the current list every time, about 70 bytes per entry to every browser. At 1 024 entries that is about 70 KB per tick per sensor. ADR-0041 keeps the moves off the disk, but not off the socket. The simulator's brief sets the sensor's default detections per dwell lower than the limit, as a setting, and the build measures the rate with one sensor and 200 tracks. | PDA (brief), PCA-simulator |
| R5 | **A removed plugin's switch.** A user's saved choice for a kind that no loaded plugin declares stays in their document and is shown nowhere, as the CR implies. One sentence in part 5 saying that the shell drops nothing and shows only declared kinds, so the CDA does not have to ask. | PDA (CR text) |
| R6 | **A self-relation** (an entry whose id is the object's own) is possible on update and draws nothing. Not worth a rule; `map-view-2d`'s brief says a zero-length line is skipped. | PDA (brief) |
