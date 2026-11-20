# ACA review of CR-0032: the user's time with a set time and an interval at once

- **Reviewed:** `docs/change-requests/CR-0032-user-time-with-a-time-and-an-interval.md` on `pda/cr-0032` at `a8c88965` (from `main` at `fa7dfda1`).
- **Against:** ADR-0045 (points 1, 2, 4 and 5) and the ADR index's rules on changing an accepted decision; CR-0030 part 4 as built on `pda/sdk-1.4-part4` `3f26d2e` (`UserTime.java`, `time.ts`, `Temporal.java`) and the ACA's review of it; the CDA's `cda/sdk-1.4-part4` `b6972852` (`SessionTimes.Picked`, `TimeControl.tsx`); overview 4.2 rule C3; the owner's wish of 2026-11-06 (weather at a time and tracks over an interval in one session, for M6) and Q10 and Q12.
- **By:** the ACA, 2026-11-06.

## Verdict

**Recommend approval,** with one correction to the Java shape before the PDA builds it (R1) and the ACA's answers to the two open points below: the interval's end following the clock stays out of 1.4.0, and ADR-0045 is changed by an index note, not superseded. The change is the right one for the owner's wish: two plugins in one session read two different parts of one value, and it costs nothing today, since no plugin is temporal and the 1.4.0 freeze has not come. Waiting for 1.5.0 would leave two ways to read the time for good, as the CR's first alternative says.

## The PDA's five points

| | Point | ACA |
|---|---|---|
| 1 | **Independence: the set time may lie outside the interval** | **Right.** The two parts answer two questions, "as of when" and "over which span", and the owner's example needs them apart: weather at a time while the tracks show the last hours; or an interval last week with the set time at now. A coupling rule would make the control move one marker when the other moves, and would forbid the default (now) with any interval that does not reach the present. A plugin that reads both decides for itself what an outside set time means. The control shows the relation anyway: the set marker is drawn over the interval's band (the CDA's slider already has the three markers; only its rule that greys the set marker while the interval is on goes). |
| 2 | **"Now" at a session's end (Q10) means both parts at their defaults** | **Right.** ADR-0045's "now" is the state of a fresh page load (point 2): no time set and no interval. ECore delivers that value once at the session's end, as part 4 does; nothing else changes. See R2 on the name `isNow()`. |
| 3 | **A record replacing the sealed type** | **Right in shape, wrong in one detail (R1).** Two independent parts are a record with two optional components, not a sum type: a sealed type would need four cases that mean nothing as a set. Part 4's exhaustive `switch` goes, and that is fine, since a plugin reads the part it needs and ignores the other. The record is immutable with immutable components, so rule C3 still lets it travel in `SessionTimeChange`. But a record's own accessors return its components: with `@Nullable Instant time` the method `time()` is nullable, not `Optional`. The CR's text promises both. |
| 4 | **May the interval's end be "now", following the clock?** | **Not in 1.4.0; the shape allows it later.** See below. |
| 5 | **Amend or supersede ADR-0045** | **An index note.** See below. |

## The interval's end following the clock

The wish behind the question is a sliding window: "the last two hours" of tracks, which stays current while the user watches. It is a real wish, and the same holds for the start: a forecast plugin wants "the next six hours", from now. So if it comes, it comes for either end, not only the end.

The ACA recommends leaving it out of SDK 1.4.0, as the CR does, for three reasons:

- **No plugin needs it in M5,** and M6's first temporal plugin shows weather at a time. The tracks over an interval need a plugin that keeps the tracks' history, which emc2 does not have yet (ADR-0045's context, `data-platform.md`). The owner can decide the sliding window with that plugin.
- **It is a different kind of value.** A fixed interval is two instants, checked once by ECore. An end at "now" is resolved by whoever reads it, as the set time's "now" is today: no message per minute, but `contains` needs a clock, and ECore's check that the start is not after the end holds at the check and may stop holding (a start in the future with the end at now). Those rules deserve their own line in an ADR, not a sentence in a CR about a different change.
- **It can be added without breaking anyone.** A later version adds an optional component, or a flag per end, and ECore gives a 1.4.0 plugin the resolved instant at delivery, as `EndpointRequest` added `userTime()` with the older constructor kept. Reading an absent `to` as "now" later would instead change the meaning of a 1.4.0 value, so the CR is right not to leave the end optional now.

## Amend or supersede

The index's rule: an accepted ADR is never edited; a change that reverses a decision point needs a new ADR, unless the owner chooses an index note that names the date and where the change is described. CR-0032 changes the form of point 1 and nothing else: the user still picks now, a time or an interval, and may now pick a time and an interval together; points 2 to 7 stand as written. A superseding ADR would copy six unchanged points to change one. The ACA recommends the index note, with CR-0032 as the record, and the next ADR on the subject (history, playback or the sliding window) taking it in. The note the ACA will add to the index's line for ADR-0045 once the CR is approved:

> Owner, 2026-11-06 (CR-0032): point 1's user's time has two independent parts, the set time (now, the default, or a time) and an optional interval with its start not after its end; the set time may lie outside the interval; "now" is both parts at their defaults, also for the delivery at a session's end (Q10).

The overview's M5 row and `m5-plan.md`'s line on ADR-0045 ("now, a time or an interval") are planning text and stay; `requirements.md` has no sentence on the user's time.

## Against the rest of the CR

| Source | Result |
|---|---|
| ADR-0045 points 2, 4 and 5 | Kept: the session owns the choice, each page load starts with both parts at their defaults, nothing is saved; the choice travels with the live picture and ECore checks both parts; non-temporal plugins see "now". |
| CR-0030 part 4 as built | The CR names every place that changes: `UserTime`, `SessionTimeChange` (unchanged in shape), `EndpointRequest.userTime()` (unchanged in shape), the test kits' `setSessionTime`, `setTime`, `TemporalTestPlugin` and `createTemporalTestPlugin`, `time.ts`, `sdk-v1.md` and the design pattern's FAQ. Nothing of parts 1 to 3 is touched. |
| The CDA's half | `SessionTimes.Picked` refuses a time with an interval today ("an interval has a start and an end, and nothing else"); that rule goes, the control's three markers stay, as the CR's Impact says. |
| Compatibility | A breaking change of part 4 before the freeze, with no temporal plugin built: allowed by CR-0030's own rule for its build (dated notes in its Decision, as parts 2 to 4 have). The MCA records the CR's number there. |
| Alternatives | Complete: 1.5.0, do nothing, named times per plugin. The ACA adds none. |

## Remarks (for the PDA, in the CR's text or the build)

| | Remark |
|---|---|
| R1 | **One shape for the Java record.** The SDK's convention is JSpecify's `@Nullable` on components and no `Optional` components (`DeclaredField`, `LayerChoice`, `ClassificationLimit`). So: `record UserTime(@Nullable Instant time, @Nullable Interval interval)` with `time()` and `interval()` nullable, as ECore's `Picked` reads; drop "as `Optional`" from the CR, or add differently named `Optional` views if the PDA wants them. The factories `now()`, `at(time)`, `withInterval(from, to)` and `withoutInterval()` and the constant `NOW` are right; `Interval` keeps its check and `contains`. |
| R2 | **`isNow()` means the whole value.** With two parts, a weather plugin asks "is the set time now?" and a history plugin "is there an interval?". Keep `isNow()` for ADR-0045's "now" (both at their defaults), as the CR says, and let its Javadoc say that the set time alone is `time() == null`, so that nobody reads `isNow()` as the first question. |
| R3 | **The web value's absent parts.** `{ time?: string; interval?: {...} }` with `NOW` as `{}` is right. Say that an absent part is omitted, never `null`, and that `userTimeProblem` refuses a `null` member, so that the protocol's JSON and the SDK agree and ECore's check has one form to accept. |
| R4 | **One delivery per change of either part.** The CR says so; the control sends at a marker's release, so a drag of the set marker with an interval on is one message. Worth one sentence in `Temporal`'s Javadoc, where a plugin might otherwise expect a message per part. |
