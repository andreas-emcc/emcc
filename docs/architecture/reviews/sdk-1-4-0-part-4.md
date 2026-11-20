# ACA review of SDK 1.4.0 part 4: capabilities and the user's time

- **Reviewed:** `pda/sdk-1.4-part4` at `3f26d2e` (from `pda/sdk-1.4-part3` `cb5df2b`): `b279bc8` (`ObjectWriter.objectId`), `9b098e6` (the contract), `c62040a` (the docs).
- **Against:** CR-0030 part 4 (owner GS, 2026-11-05) and its Decision's note of 2026-11-06 on `objectId` (IP); ADR-0044 and ADR-0045; the owner's Q10 and Q11 of 2026-11-06; the ACA's CR-0030 review (R3, R4) and its GMTI briefs review (R5); overview 4.2 rule C3.
- **By:** the ACA, 2026-11-06. The PDA reports the tests green (model 106, Java SDK 112, test kit 300, web SDK 293) and ECore and the app compiling against the branch; the ACA did not run them.

## Verdict

**Approve part 4 for `integration/sdk-v1.4`.** The contract is CR-0030 part 4 as written, with the owner's Q10 and Q11 and the ACA's R3 and R4 in it, and `objectId` does what the owner's IP asked: it answers from a key's first write, while the create waits or is in flight. Nothing a plugin built for 1.3.0 has to change. One remark, R1, asks for a sharper sentence in the text for the CDA on what ECore can decide at load and what only after the shell's report; the rest are small.

## The PDA's five points

| | Point | ACA |
|---|---|---|
| 1 | **Q11 and its split between ECore's load check and the shell's report** | **Right in substance; the timing wants one more sentence (R1).** The rule "every declared capability is implemented by at least one part, and a part implements only declared ones" means that for a plugin with both parts, ECore cannot know at load whether a declared capability its class lacks is the web part's: the shell reports that only when a browser loads the plugin. The build splits it the only way it can: at load ECore refuses a server part that implements an undeclared capability, and a declared one that no part can implement (no web part); the shell refuses a web part that implements an undeclared one, or lacks a declared one when there is no server part; the one case left, both parts declared and neither implementing, is found at the shell's report. `CapabilityCheck` and `capabilityMismatch` encode exactly that, with tests for each branch. ADR-0044 point 4's "does not start the plugin" cannot apply to that last case, since the plugin is already running: it is point 4's web rule (the shell does not use it, and reports it to the Monitor). |
| 2 | **Q10: `now` once at a session's end** | **Right,** and the simplest contract: a plugin that keeps only the sessions not at `now` forgets the session with the same code that handles a change, which `TemporalTestPlugin` shows. See R2 for one word. |
| 3 | **`UserTime` as a sealed SDK type inside messages** | **Allowed by rule C3.** C3 asks for immutable messages; `UserTime`'s three records hold `Instant`s, `SessionTimeChange` holds a `String`, a `User` record and a `UserTime`, and the SDK's own value types travel in messages already (`MapObject`, `ChannelItem`). The `switch` over the sealed type is exhaustive, so a later fourth kind is a compile error in every plugin, which is what a minor SDK change should be. |
| 4 | **No `ctx.time` (R4), with the test kit's `activatePlugin` and `setTime`** | **As recommended.** The web part learns the time only through `timeChanged`, once after `activate` and at each change; the fake's `currentTime` is the test's, on `FakeContext`, and the test checks that the context has no `time` member. `activatePlugin` does what the shell does, so a plugin's tests and the shell agree on the order. |
| 5 | **`objectId`'s reservation and release (IP)** | **Right, and the gap the ACA looked for is not there.** The id is reserved at a key's first `write` when no object is known, the create uses it, and the reservation goes when the store reports the object (`remember`, called from the applied reply before `finish`, so `objectId` never returns null between the reply and the subscription's event) or when the key has no object and no write left (a dropped write, a build that returns nothing, a target that went, a write given up). A key whose create was refused as existing is looked up and takes the stored id, as the Javadoc says. So `gmti`'s first dwell can pair its detections with the platform in the same handler call, and rule 17 never checks that the other object exists yet (ADR-0051 point 3). |

## Against CR-0030 part 4 and the ADRs

| Source | Result |
|---|---|
| CR part 4, the manifest | Matches: `capabilities`, a closed enum with `temporal`, unique, an unknown id failing the schema (ADR-0044 point 5) at `/capabilities/<i>`, so the Monitor can name it (R3 of the CR review, in the text for the CDA). At most 16 is the build's. |
| CR part 4, Java | Matches: the package `dev.emcc.sdk.capability` with one interface per capability on the plugin class (ADR-0044 point 3), `Capability.implementedBy` for ECore's load check, `Temporal.timeDelivery()` asked once after `init`, `SessionTimeChange(session, user, time)` at a session's start, at each change and `now` once at its end (Q10), `EndpointRequest.userTime()` with `now` for a non-temporal plugin and the 1.2.0 constructor kept. |
| CR part 4, web | Matches: the module's optional `capabilities` object with `temporal.timeChanged` (point 3), the shell's check and report (point 4) as `capabilityMismatch`, no `ctx.time` (R4). |
| CR part 4, `UserTime` | Matches in both languages: now, a time, an interval with its start not after its end, UTC in the data model's form; the web's `userTimeProblem` is the check ECore makes on the protocol (ADR-0045 point 4). |
| CR part 4, the test kit | Matches: `setSessionTime`, `CapabilityCheck.assertMatches`, `TemporalTestPlugin` (ADR-0045 point 7); `createFakeContext({ time })` with `setTime`, and a temporal test module for the shell's and the ITA's tests. |
| ADR-0044 point 6 | Kept: nothing is added to `Plugin` or `WebPlugin` as a required member; `capabilities` is optional. |
| ADR-0045 points 2 and 5 | Kept: each session starts at `now`, nothing is saved, and a plugin that is not temporal sees `now` everywhere. |
| Compatibility | Optional manifest key, optional module member, a new record component with the older constructor kept, a new `PluginContext`-free delivery (the plugin returns a worker; ECore sends). No required member for any plugin. |

## Remarks (no approval needed)

| | Remark | For |
|---|---|---|
| R1 | **Say what happens when both parts are declared and neither implements.** `sdk-v1.md`'s text for the CDA says ECore checks "with the shell's report for the web part the whole", and `Capability`'s Javadoc says ECore "does not start a plugin that breaks this, judged from its class and what the shell reports". By the time a shell reports, the plugin is running. One sentence settles it: at load ECore refuses what it can see (a server part implementing an undeclared capability; a declared one with no web part to implement it); when a shell reports that the web part does not implement a declared capability the server part also lacks, ECore records the fault in the Monitor against the plugin (ADR-0044 point 4's web rule), and the shell does not use the capability. That is also the ITA's flow for the mismatch. | PDA (text), CDA |
| R2 | **"Once" at a session's end, for every session.** `Temporal`'s Javadoc says ECore delivers `now` once when a session ends. Say that it does so for every session, also one that was at `now` already, so a plugin that counts sessions sees each end exactly once. | PDA |
| R3 | **`CapabilityCheck` reads the manifest file itself.** It is the test kit, so a plugin's test passing `Path.of("plugin.json")` is fine (the rule against a plugin's own file I/O is for the plugin's runtime, ADR-0049), but the Javadoc might say so, since the reviews grep for `Files.read` in plugin code. | PDA |
| R4 | **`objectId` and `object` side by side.** Both are right; one Javadoc line on `object(key)` pointing at `objectId(key)` for the id before the create is applied spares the next reader the question the ACA asked. | PDA |
