# ACA review of CR-0034: a GMTI sensor's mission, sent as STANAG 4607's mission plan

- **Reviewed:** `docs/change-requests/CR-0034-a-sensors-mission-in-a-dwell.md` on `main` at `f6d6832b` (PCA-gmti, for the owner; Q4, JQ, JR).
- **Against:** ADR-0048 point 7 and the ADR index's rules (`docs/adr/README.md`); CR-0033's `Sensor` record; `docs/architecture/gmti-4607.md` sections 1.4 (the mission segment), 1.1 (`P9`) and 4.3 (what `gmti` out sends); `gmti`'s `FORMAT-RULES.md` G2 and G6 on `integration/sdk-v1.4`; the simulator's functions 27, 29 and 32; the owner's Q2 (`gmti` out serves the simulator only) and JQ (sensor settings are generic).
- **By:** the ACA, 2026-11-07.

## Verdict

**Recommend approval.** The gap is real: the mission segment is mandatory, `M1` is the one field a receiver groups a platform's data by, and `gmti` out sends spaces and a `P9` that changes with every restart. The sender knows the mission, so the sender says it, as Q2 and CR-0033 reasoned; a generic text per sensor, fitted by each output, is JQ applied. **ADR-0048 point 7 gets a dated index note after the approval, not a new ADR** (R1). Three remarks for the build, none blocking.

## Against the decisions

| Source | Result |
|---|---|
| ADR-0048 point 7 | The decision stands: the simulator has a GMTI sensor with its own settings, which the outputs map. Point 7 lists the settings, and the list reads as complete; a mission is a new one. By the index's rules that is an owner's later decision on a detail, recorded as a dated note on the ADR's row that names the CR, not a superseding ADR (nothing is reversed). The ACA writes the note after the approval, and with it JQ, which is not yet noted: the settings are generic physical values in SI units, each output maps them, and a value a field cannot hold goes as "no statement". |
| CR-0033's `Sensor` | One more `@Nullable String` after `name`, blank passed as `null`, the same 1 to 64 characters as `name`. The CR says the Javadoc names it "the mission the sensor's platform flies": right, since 4607's mission is the platform's, and in the simulator one sensor is one platform. Built together with CR-0033 there is one constructor; built after, CR-0033's constructor stays. Compatible either way. |
| The reference's 1.4 and 1.1 | `M1` is twelve characters, spaces when none; `P9` is the platform's mission number, and a receiver keys the reference day by `P8` and `P9`. The CR's mapping is that: a cut and padded `M1`, a `P9` derived from the whole text so that the same mission keeps its id across restarts and links, and only the reference day moves when a restart falls on another day, which the standard allows and the owner's recordings do. `M2` stays spaces. |
| The simulator | A setting of the Sensors panel, edited with `plugin.simulator.edit`, saved with the state, exported and imported with a scenario, with older files importing without it: as every other sensor setting. No 4607 hint in the simulator is JQ. |
| Alternatives | Right to reject: a mission per `gmti` link would be typed apart from the scenario and cover every sensor on the link; the simulation has no name until named scenarios exist, and the CR rightly leaves "the scenario's name as the default" for then. |

## Remarks

| | Remark | For |
|---|---|---|
| R1 | **The ADR index and the reference.** After the approval the ACA adds the dated note on ADR-0048's row (JQ and CR-0034) and brings `gmti-4607.md` section 4.3 in line, where `M1` still reads "the scenario's name" and `P9` "a number fixed when the link starts". One documentation branch, as for ADR-0045 and CR-0032. | ACA |
| R2 | **`P9` is a contract between releases.** Say in the `gmti` brief which function derives it, for example CRC-32 of the text's UTF-8 bytes with 0 mapped to 1, so that a receiver's recordings and the ITA's assertions stay valid across releases. Two missions that differ only after their twelfth character then show the same `M1` with different `P9`s; that is right, since the receiver's key is `P9`, and `M1` is the text a human reads. No suffix on the cut, unlike `P8`. | PCA-gmti (brief), PDA |
| R3 | **The character set.** `M1` outside the basic character set is replaced as `P8` is (G2, CR-0033's R2); one rule in the brief for both, and the `mission cut` counter counts the cut only, not the replacement, so that a Swedish name does not count as a cut. | PCA-gmti (brief) |

## What the ACA checked beyond the CR

The mission segment's and `P9`'s fields in the reference (`M1` A 12, `P9` I32); G6's open point, which this CR closes; that `gmti-4607.md` 4.3 and the `gmti` brief's "Out" still carry the older words the CR replaces; and that ADR-0048's index row has no note yet for JQ.
