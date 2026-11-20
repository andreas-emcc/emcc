# ADR-0045: Temporal awareness: the user's time, for temporal plugins

- Status: Accepted (owner, GR, 2026-11-05; its decision points approved with the M5 plan, GQ)
- Date: 2026-11-05
- Deciders: Owner (advised by the ACA; T-136, GE and GF; `docs/architecture/m5-plan.md`, A3)
- Extends: ADR-0044 (capabilities) and ADR-0006 (the live picture)

## Context
Some data depends on a chosen time, not only on the present. A weather forecast from GRIB files is one example: M6's GRIB plugin is the first such plugin. For it, the owner wants each user to choose a time (T-136, 2026-11-05):
- **GE:** each user picks "now", a time or an interval;
- **GF:** the shell shows the time control only when a loaded plugin declares the temporal capability.

M5 builds the framework only. No product plugin is temporal in M5.

emc2 keeps no history yet: the store holds the current state. History and playback are a later decision (`docs/architecture/data-platform.md`).

## Decision
1. **The user's time** is one of:
   - **now**, the default;
   - **a time**;
   - **an interval**, from a start to an end, with the start not after the end.
2. **The choice belongs to the browser session** (A3):
   - each page load starts at "now";
   - the choice is not saved;
   - two browser tabs may show different times.
3. **The time control** sits in the top bar beside the clock (ADR-0031). It shows only when at least one loaded plugin declares `temporal` (GF). Without one, the control is hidden and the time is always "now". It displays times as the clock does, in UTC or the user's local time.
4. **The choice goes to the server with the live picture,** as the area of interest does (ADR-0006).
   - ECore gives each temporal plugin's server part the session's time with the session's requests, and tells it when the time changes.
   - Temporal plugins' web parts read the time through the SDK and are told when it changes.
   - Picking a time changes nothing on the server, so it needs no permission. ECore checks that an interval is well formed.
5. **Only temporal plugins react.** Everything else shows the current state, whatever time is picked. The time control is not playback of history.
6. **Times are UTC** inside emc2, in the form the data model uses.
7. **Tests:** the test kit has a temporal test plugin, used by the SDK's own tests and by the ITA's flows.

## Alternatives considered
- **A saved choice per user:** it would be remembered, but a user who logs in on another day would see an old time without noticing.
- **One time for the whole server:** simpler, but one user's choice would change what every other user sees.
- **Always show the control:** consistent, but it would do nothing in most deployments, and users would expect it to replay history.
- **History playback now:** it needs the event log and storage of the past, which come later (`docs/architecture/data-platform.md`).

## Consequences
- **SDK 1.4.0, part 4 (PDA):**
  - the `temporal` capability (ADR-0044), with its Java and web interfaces;
  - the time in the live picture protocol;
  - the test plugin.
- **ECore and the shell (CDA):**
  - the time control in the top bar;
  - the protocol message, and its check;
  - delivering the time to temporal plugins.
- **ITA:** the control appears only with the test plugin loaded, and the test plugin sees each session's own time.
- **M6:** the GRIB plugin is the first temporal plugin.
