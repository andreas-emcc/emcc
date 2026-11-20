# ACA review of the SDK 1.2.0 build (T-078)

The ACA reviews the build of SDK 1.2.0 and data model 1.2.0 (CR-0025, approved by the owner on 2026-10-22 with CR-0020, CR-0022 and CR-0024) part by part, as each part lands on `integration/sdk-v1.2`, and then the whole before the owner freezes it. The review of the CR itself is `cr-0025-sdk-1-2-0.md`. This file grows with each part.

Owned by the ACA. Like the rest of this folder, it is not `docs/reviews/`, where the CRA's and SRA's reports stay with the reviewer (`CLAUDE.md` section 8).

## Part 1: M2's fixes, CR-0020, CR-0022, CR-0024 and the shared look check (2026-10-22)

- **Reviewed:** `pda/sdk-1.2-part1` `2404cda`, merged into `integration/sdk-v1.2` as `6e86667`. It is 14 files:
  - the web SDK's components and their CSS, `MapView`, the test kit and `checkLookCss`;
  - three test files: `part1.test.tsx`, `look.test.ts`, and `review.test.tsx`, which changed;
  - the manifest schema and an example;
  - `model/README.md`, `sdk-v1.md`, the design pattern and the PDA's handover.
- **Against:** CR-0025 part 1, CR-0020, CR-0022 and CR-0024 as approved; ADR-0029, ADR-0033 and ADR-0034; ADR-0030 for CR-0022; and the conformance reviewer's check 9 for `checkLookCss`.
- **Tests run by the ACA:**
  - the web SDK: its typecheck, and 198 tests in 16 files, all pass;
  - the data model: 65 tests pass;
  - the ITA's full run for the merge: 151 passed and 14 skipped (Keycloak), on `170ebb4`, which has the same tree as `6e86667`.

### Verdict

**Part 1 fits the CR and is accepted.** The points for the PDA (L1, L3, L4, L5 and D1) go into a later part, before the freeze. The ACA's own point (L2) is fixed in check 9 with this review. None of them blocks part 1. Below, L marks a point on the look check, and D one on the documentation.

### In line

- **Buttons:** `Button` and `IconButton` gain `expanded` and `hasPopup`, rendered as `aria-expanded` and `aria-haspopup`, and nothing without them. `IconButton`'s `title` is a tooltip apart from its `label`, which stays the accessible name (CR-0024).
- **`TextField`:**
  - it gains `readOnly`, `inputMode`, `autoComplete` and `spellCheck`;
  - its error sits outside the label and is linked with `aria-describedby`, as `ColorField` does it, so it is read once.
  - The `emc2-field` class moves from the `<label>` to a wrapping `<div>`, with `htmlFor` on the label. Lookups by label still work.
  - `TextField` now calls `useId`, so a test must render it rather than call it as a function; the SDK's own test moved for that. No plugin calls the shared `TextField` directly today.
- **Height:** text inputs and `ColorField`'s swatch are `border-box`, as high as `Select` and `Button`.
- **The popover:** a press inside an open dialog that is not around it is not a press outside; one in a dialog around its anchor still is. This covers any open dialog, slightly more than the CR's "a modal dialog that opened while the popover was open", and does no harm.
- **CR-0020:**
  - `InteractionOptions.signal` on `pickPoint`, `dragObject`, `draw` and `edit`;
  - an abort ends the interaction with `null`, as Escape does, and does not clear the selection. That differs on purpose from the CR's "exactly as for Escape": for a waiting `dragObject`, Escape also clears the selection (owner, 2026-10-20). It is a sensible refinement, which `map-view-2d` implements in T-085;
  - a signal aborted before the call starts nothing, and leaves another plugin's interaction alone;
  - a late abort changes nothing;
  - the fake map view does the same, and the tests show it.
  - The TSDoc of a waiting `dragObject` and Escape is as the owner decided (2026-10-20).
- **CR-0022:** `internet.hosts` may be empty, still required, with a valid example. The `internet` description states the owner's host rule (ADR-0030; 2026-10-18 and 2026-10-19). `model/README.md` starts "Changes in 1.2.0".
- **`checkLookCss`** follows check 9:
  - literal colours (hex, colour functions with numbers, named colours);
  - lengths in the token-sized properties, their logical variants included, with the 1 px hairlines;
  - `font-family`;
  - unknown custom properties, `--emc2-` definitions and the 1.0 aliases;
  - own classes;
  - a literal in a `var()` fallback;
  - grouping at-rules and nested rules.
  - It needs no new dependency, and inline styles and drawing stay with the reviewer, as the CR says.
  - It has an option beyond the CR's `{ pluginId, allow? }`: `allowClasses`, for a library's class prefixes (L2).
- **Versions:** the version stays 1.1.0 until the last part (owner, 2026-10-22), and `sdk-v1.md` maps the additions.

### Findings

- **L1 (PDA, before the freeze): font names that are not tokens pass `checkLookCss`.** The ACA ran it on probe CSS:
  - `font: var(--emc2-size-text) Arial, sans-serif` gives no finding;
  - neither does `--p-font: "Comic Sans MS"`, used as `font-family: var(--p-font)`.

  Check 9 fails any font family that is not a token. So the check should fail:
  - a family in the `font` shorthand that is not a token;
  - a plugin's own custom property used for a font family whose definition is not a token.
- **L2 (ACA, fixed with this review): `allowClasses` lets a library's classes pass, which check 9 did not say.** The map view styles OpenLayers' `ol-` controls, so the exception is right. Check 9 now names it: a library's own classes that the plugin draws with pass when the plugin's look test names their prefix; the shared components' `emc2-` classes never do.
- **L3 (PDA, before the freeze): system colours pass.** `color: CanvasText; background: Canvas` gives no finding. They come from the browser, not from the looks.
  - Check 9 now counts the CSS system colours as literal colours: `Canvas`, `CanvasText`, `ButtonBorder`, `ButtonFace`, `ButtonText`, `Field`, `FieldText`, `Highlight`, `HighlightText`, `SelectedItem`, `SelectedItemText`, `GrayText`, `LinkText`, `VisitedText`, `ActiveText`, `Mark`, `MarkText`, `AccentColor`, `AccentColorText`, and the deprecated ones such as `Window`.
  - They pass only inside `@media (forced-colors: active)`, where the browser's high-contrast colours are meant to be used.
  - `checkLookCss` should do the same. Where `menu`, `window` and similar names are system font keywords (`font: menu`), they belong under the font rule (L1), not under colours.
- **L4 (PDA, before the freeze): a plugin's own custom property with a literal length passes.** `--p-pad: 12px; padding: var(--p-pad)` gives no finding: a definition is not length-checked, since it may be a width, and the use is a `var()`.
  - Check 9 lets an own property pass only when it is defined from tokens or measured at run time.
  - One change covers L4 and the second half of L1: where `var(--<id>-…)` appears in a token-sized property or in `font-family`, look up its definition in the same file, and apply the colour, length and font rules to it.
  - Widths stay unchecked.
- **L5 (PDA, possible false positive, not run): relative colours with a literal alpha.** From the code, `hsl(from var(--emc2-color-accent) h s l / 0.5)` would be reported for its `0.5`, although the colour comes from a token. Check it with the other look points.
- **D1 (nit, PDA): which comes first for `edit`.** For an object the map does not draw, with a signal already aborted, the fake rejects with `NotOnMapError` before it looks at the signal. The TSDoc says an aborted signal resolves with `null` at once. Either order is fine, but the TSDoc should say which wins, so that `map-view-2d` and the fake agree.

### Confirmed after part 1: the look fixes (2026-10-25)

- **Reviewed:** `pda/sdk-1.2-look` `d811034`, merged into `integration/sdk-v1.2` as `58e4f0c`.
- **Confirmed:** L1, L3, L4, L5 and D1 are fixed.
  - **The probes:** the ACA ran `checkLookCss` on twelve probe CSS cases, and every one came out as check 9 says.
  - **L1:** a literal family in `font`, a font name in an own custom property, and `font: menu` fail; an own property defined from a font token passes.
  - **L3:** `Canvas`, `CanvasText`, `ButtonBorder` and `SelectedItemText` fail. They pass inside `@media (forced-colors: active)`.
  - **L4:** an own property with `12px`, used for `padding`, fails; used for `width`, it passes.
  - **L5:** `hsl(from var(--emc2-color-accent) h s l / 0.5)` passes.
  - **Unchanged:** a hex value still fails, and tokens alone still pass.
  - **D1:** an already aborted signal wins over `NotOnMapError`, in the TSDoc and in the fake.

## Parts 2 and 3: connection tasks, output channels, classifications and the layer picker (2026-10-25)

- **Reviewed:**
  - `pda/sdk-1.2-part2` `c9e94d8`, merged as `94c8d02`: connection tasks;
  - `pda/sdk-1.2-part3` `add9bef2`, merged as `42e51cb`: output channels, classifications and the layer picker.
- **Against:** CR-0025 parts 2 and 3 with the points they carry, R4 to R7, N1 to N4, N7 and N8; ADR-0036 and ADR-0037; ADR-0030 for hosts; ADR-0039 point 6 for the links' layers; rules C4 to C7.
- **Tests run by the ACA,** on `integration/sdk-v1.2` at `42e51cb`, all pass:
  - the Java SDK's API, 68 tests, and its test kit, 231 tests (Maven, offline);
  - the data model, 70 tests;
  - the web SDK's typecheck and 209 tests.

  The ITA's full run on `9559a0a`, which has the same tree as `42e51cb`: 151 passed, 14 skipped (Keycloak).
- **Not in these parts, carried forward:**
  - R3 and N6 come with the GeographicLib dependency in part 5: the `PluginRules` ban on `net.sf.geographiclib`, with its test; the pin to 2.1 with SHA-256 `1e85feac…`; and the jar kept off the plugins' class path.
  - R1, R2, N5 and N9 come in parts 4 and 5.

### Verdict

**Parts 2 and 3 fit the CR and are accepted.** The points below are remarks, and none blocks:
- P2-1 on multicast, which the ACA records in its own documents with this review;
- P2-2 and P3-1 for the PDA;
- P3-2 for the CDA;
- W1 for the review of the whole SDK.

P marks a point on a part, and W one on the whole before the freeze.

### Part 2 in line (ADR-0036)

- **The connection tasks.** `PluginContext.connections()` starts tasks with a fresh `ConnectionTask` per run, each on a virtual thread of its own.
  - The cap is 100 tasks, children included. `MAX_PENDING_EVENTS` keeps a hanging worker from collecting events.
  - The default method throws until ECore runs tasks (T-079), so ECore keeps building meanwhile.
- **`TaskContext`:**
  - `take` and `poll` wait without holding a lock (rule C4);
  - `closeOnStop` registers what ECore closes when the task stops;
  - `send` is fenced once the task stops;
  - `startChild` stops children with their parent; the `@throws` Javadoc of its cap gives the accept-loop advice (N2);
  - `count` and `detail` report the plugin's figures, and **`listening` and `peer` the addresses for the monitor view and the SRA (R5)**;
  - `tls` and `sslContext` work by name, with no key material for the plugin (ADR-0036 point 5).
- **The other types:**
  - `ConnectionSpec`: a bounded inbox with the mailboxes' overflow policies, and coalescing by key;
  - `Restart`: never, on failure, or always;
  - `Backoff`: at least 100 ms;
  - `ConnectionRef`: `post`, `count`, `detail` and `stop`, never blocking;
  - `ConnectionEvent`: `Running`, `Restarting` (with its reason and the time of the next run), `Stopped` and `Failed`.
- **`ListenAddress`:** it only parses (R6). `from` binds to loopback unless the settings name another address. `multicast` needs an interface an admin names (R4; P2-1).
- **`PluginRules`:**
  - **In connection tasks only:** sockets, socket factories, `SSLEngine`, the NIO network channels and selectors are allowed only in classes that implement `ConnectionTask`, and their nested classes. So are name lookups (`InetAddress.getByName`, `getAllByName`, `getLocalHost`, and the like) and `new InetSocketAddress(String, int)` (R6).
  - **Nowhere:** HTTP and file I/O, tasks included (N4).
  - **Not in messages:** the new services.
- **The manifest's `connections`** (kinds, direction, the pointer to the links, the reason) is a declaration (ADR-0036 point 7), with valid and invalid examples. `network` keeps its meaning for the deprecated listener.
- **The listener is deprecated** (`@Deprecated(since = "1.2.0")`) and kept in SDK 1.x (ADR-0036 point 8).
- **Tests and docs:**
  - the test kit's `FakeConnections` and `FakeTaskContext` cover restarts with the back-off, the cap with children, fencing, closing, a real socket on loopback, and TLS by name;
  - the design pattern gives the rules, the schemas to copy, N2 and N4.

### Part 3 in line (ADR-0037)

- **Channels** (`PluginContext.channels()`):
  - one channel per output link (`offer`, `withdraw`);
  - `watch` gives the whole list, then each change, keeping only the latest;
  - `send` never blocks, and returns `CLOSED` for a channel that is gone.
  - **The channel's inbox keeps only the latest item per object,** a removal replacing a pending update (ADR-0037 point 6).
  - **The build sets its own bounds:** at most 16 items handed over at a time, 10 000 objects waiting, and 100 channels per plugin. ADR-0037 sets no numbers.
  - **Beyond 10 000 pending objects** the oldest item goes, and is counted in the monitor view. If that item is a `Removal`, the receiver keeps the object until it goes stale.
- **What a channel says about itself:**
  - `ChannelSpec` and `ChannelInfo` give the output type, `DELETE` (with `canDelete`) and the declared fields as `FieldRef`.
  - `ChannelId` is `plugin/link`; a sender keeps it, and shows a renamed or removed link as missing (N8).
  - `ChannelItem.Update` carries the content, whose `dataSource` keeps an output from sending an object back to its own link (ADR-0037 point 3).
- **Classifications.** `Classifications` gives the configured order per policy: policy names match ignoring case, classifications exactly.
  - `ClassificationLimit` is `{policy, classification}` (R7), absent meaning the default label's.
  - Another policy, or a classification outside the order, counts as above the limit and is never sent.
  - `knows` lets a plugin report a limit that lets nothing through.
  - Classifications are in the Java SDK only (owner, 2026-10-24).
- **The layer picker:**
  - `"x-emc2": {"kind": "layer"}`, with `"allowNew": false` for source layers (N3), on `{id?, name}`;
  - `LayerChoice` only parses;
  - the plugin keeps a link's actual layer, two links naming the same new layer share one, and its status names the actual layer (N1);
  - settings reaching every browser is noted (N7).
  - **The model test compiles the example in strict mode,** with `x-emc2` declared as an annotation. The ECore side is the CDA's test in T-081.
- **Input channels** are specified in `sdk-v1.md` and reserved, outside the 1.2.0 API (ADR-0037 point 5).

### Findings

- **P2-1 (remark; ACA, recorded with this review): a multicast link that receives always needs an interface.** The build made no platform check of loopback multicast. So `ListenAddress.multicast` needs an interface that an admin names, and a link without one stays stopped.
  - **It is the strict form of R4,** which the owner approved for the case where loopback multicast is not shown to work on Windows and Linux.
  - **The ADR-0036 index note and overview 4.9 now say so.** The overview gives the rule; the index note gives how it came about.
  - **Scope:** R4 and `ListenAddress.multicast` are about receiving. A link that only sends to a group binds no listening address, and is not covered.
  - **Nobody made the check.** `docs/handover/cda.md` still expects the PDA to have done it, so the MCA tells the CDA. Relaxing the rule later is a change to the SDK contract.
  - **For the ITA:** its multicast test peers need an interface that carries multicast, named in the settings (T-086).
- **P2-2 (PDA): three slips in the design pattern's part 2 text.**
  - The listening-address schema to copy gives `address` the default `127.0.0.1`. For a multicast link `address` is the group, which `ListenAddress.multicast` requires explicitly, so the group needs no default there.
  - "Mark `address` and `interface` `settings.admin`" has no meaning: every setting needs `settings.admin`, and no marker per property exists.
  - The TLS line still names only `ListenerSpec.tls`. Add `task.tls`.
- **Where the build differs from the CR's sketch,** as the Javadoc, which is normative, now says:
  - events go through a second `start` overload, not a method of the spec;
  - the plugin names child tasks itself; ECore does not number them;
  - the test kit's accessor is `ctx.connectionTask(name)`;
  - `Classifications.compare` takes a `ClassificationLimit`, as R7 implies;
  - the manifest's `settings` pointer in `connections` is optional;
  - `connections()`, `channels()` and `classifications()` are default methods that throw (see W1).
- **P3-1 (nit, PDA): the model test names a source layer "Simulation".** The picked-layer data in `model/test/examples.test.mjs` (line 167) uses that name. In M3 links use View's layers only (ADR-0039 point 6), so a neutral name avoids suggesting a simulation layer as a source.
- **P3-2 (for the CDA, T-079 and T-081): the channel registry is shared between plugins.** `Channels.send` may be called from any thread, and `watch` serves many plugins. So under rule C4 and ADR-0021 any lock on the registry is a leaf lock, and the mappers (`toMessage`), which are plugin code, never run while it is held.
- **W1 (for the review of the whole SDK, before the freeze): the throwing default methods.** `PluginContext.connections()`, `channels()` and `classifications()` throw until ECore has them. Once frozen, they are part of the contract. Decide then whether they stay default methods or become abstract: only ECore and the fakes implement `PluginContext` (CR-0025, Compatibility).

## Part 4: declared fields and updates that are not saved (2026-10-26)

- **Reviewed:** `pda/sdk-1.2-part4` `ff5f223`, merged into `integration/sdk-v1.2` as `cfb48f6`. It covers:
  - the manifest's `fields`, and the change request's `fields`;
  - `DeclaredField`, `FieldValue`, `Change.withFields` and `Change.notSaved()`;
  - the web SDK's field helpers and the `DeclaredFields` component;
  - the test kit's `FakeStore`, the examples and the docs.
- **Against:** CR-0025 part 4 and part 8 (as revised with the store's side), ADR-0038 and ADR-0041, ADR-0018 (blind forwarding), and model rules 5, 7, 12 and 13.
- **Tests run by the ACA,** on `integration/sdk-v1.2` at `cfb48f6`, all pass:
  - the Java SDK's API, 74 tests, and its test kit, 246 tests (Maven, offline);
  - the data model, 77 tests;
  - the web SDK's typecheck and 231 tests in 17 files.

  The ITA's full run on `713c905` (part 4 on top of `42e51cb`, with only review documents since): 151 passed, 14 skipped (Keycloak).
- **Still carried forward:**
  - to part 5: R1, R2 and N9 (workspaces), and the rest of N5 (`LayerContent`, `ObjectQuery`);
  - with GeographicLib in part 5: R3 and N6.

### Verdict

**Part 4 fits the CR and is accepted.** There are three nits for the PDA (P4-1 to P4-3), an addition to W1, and two new points for the freeze (W2, W3). None blocks.

### In line

- **Declared fields (ADR-0038):**
  - **The declaration.** The manifest's `fields` has the name (`^[a-z][a-zA-Z0-9]*$`), the type (text, number, integer, choice, boolean), the label and an optional description; for numbers a unit, a minimum and a maximum; for text a maximum length; `required`, `choices`, `editableByOthers` (false by default) and `dataTypes`. The schema refuses a choice field without `choices`, `choices` on another type, a unit or limits on a type that is not a number, and `maxLength` on a type that is not text (point 1).
  - **The request.** The change request's `fields` (1 to 64, each a plugin, a name and a value) is allowed only on an object's create and update, in the schema, in `ChangeRequest` and in `Change.withFields` (point 2).
  - **The store's checks,** in the SDK's contract and the fakes for now; ECore's store is the CDA's work (T-079, T-081). Each value is checked against its declaration: the field exists; it is editable by others, or the requester is its own plugin; the type and limits hold. It is applied after the content. A failure is `VALIDATION_FAILED` at `/fields/<i>`; `null` removes a field unless it is required; an emptied namespace goes (rule 13).
  - **Blind forwarding is unchanged** (point 3; rule 5, ADR-0018). The tests show that a third plugin's older copy of the namespace does not overwrite what was set.
  - **The web SDK's helpers.** `changedFields` names only the fields that changed, so an edit does not overwrite what another plugin set meanwhile. `fieldProblems` and `declaredFieldProblem` check as the store does.
  - **The editor.** `DeclaredFields` shows the fields of the object's data type, and a "+" that adds other plugins' editable fields with their labels and units, grouped by plugin. A field added with it can be removed again, unless it is required (point 5).
  - **Which fields the editor shows at once.** It shows the fields that name the object's data type, then the "+".
    - A field without `dataTypes` belongs to every object (ADR-0038 point 1), but the editor offers it through the "+", as the CR says.
    - The ACA reads ADR-0038 point 5 ("a '+' that adds the fields of the object's data type and of other plugins") the same way: the data type's own fields at once, everything else through the "+". It accepts that reading.
    - The `pluginId` prop goes beyond the CR's signature: it is the editing plugin's own id, for fields only that plugin may set.
  - **The list of fields.** `PluginContext.declaredFields()` in Java (a default method that throws until ECore has it), and `ctx.declaredFields?` in the web SDK, read as `?? []` until the shell gives it (T-081).
- **Updates that are not saved (ADR-0041):**
  - **`Change.notSaved()`** applies only to an object update, never with declared fields (point 1; CR-0025 part 8). It is not part of the change request, so a browser cannot send one (point 2).
  - **Moves only.** The store rejects any unsaved update that changes more than the geometry, the time, `direction` and `speed` (point 1): in the contract and `FakeStore` now, and in ECore's store with the CDA's work.
  - **Only the simulator** uses it in M3, as the Javadoc says (point 7).
  - **The fake store's restart** gives back the last saved state, or a later snapshot's, with moved positions (point 3). Creates and deletes are always saved.
  - **`model/README.md`** says that rule 7 holds for the live sequence while the journal holds declared gaps, and that enforcing `baseVersion` later must settle the reuse of version numbers (rule 12).
- **Compatibility (N5, part):** `Change` and `ChangeRequest` keep their 1.1.0 constructors, and a test checks their defaults: no fields, and saved.
- **The codec contract test skips the valid `fields` example** until ECore's codec maps `fields` (`CODEC_PENDING` in `ModelCodecContractTest`; owner, 2026-10-25). The two invalid `fields` examples are refused today by `ChangeRequest` and `FieldValue`, and the model's own tests check the schema in full. So CR-0025's "the contract test gains `fields`" is met only in part until then (W2).

### Findings

- **P4-1 (nit, PDA): the Javadoc of `notSaved()` says "save the object's whole state from time to time".** ADR-0041 point 4 names the moments instead: before a route runs; when it pauses, stops at its end or is reset; and when a user changes the simulation during a run. The owner chose those over periodic saves (2026-10-22). Point to ADR-0041 point 4, so that the simulator's PCA does not add periodic saves.
- **P4-2 (nit, PDA): rule 5 in `model/README.md` has no pointer to declared fields.** It still says that all other namespaces are "always taken from the stored object, whatever the request contains". Rules 7 and 12 got pointers; rule 5 needs one to the change request's `fields`.
- **P4-3 (nit, PDA): `belongsTo` and `fieldBelongsTo` return true for a field without `dataTypes`**, but the editor does not show such a field at once. Their docs should say what the editor does, so that plugin authors are not caught out.
- **W1, extended (for the review of the whole SDK):**
  - `PluginContext.declaredFields()` joins the throwing default methods. In the web SDK, `ctx.declaredFields` is optional until the shell gives it, unlike the CR's plain list; that is documented.
  - The PDA plans to make them plain at the version step (`sdk-v1.md`). Making the Java methods abstract needs ECore to implement them first (CDA, T-079 and T-081), or ECore stops compiling.
  - Decide both at the freeze.
- **W2 (for the freeze): the codec contract test's pending skip.** `CODEC_PENDING` must be empty, and the two invalid `fields` examples still refused, once ECore's codec maps `fields`. The MCA records the owner's decision of 2026-10-25 on the board, since it is written only in the PDA's files and the merge message.
- **W3 (at first use): `DeclaredFields` has only jsdom tests,** and no page uses it yet. Check it in a browser, in the three looks, light and dark (ADR-0034), when `draw-symbols` or the simulator first uses it.

## Part 5: workspaces, fade lists and geodesics (CR-0025 parts 5 to 7; 2026-10-26)

- **Reviewed:**
  - `pda/sdk-1.2-part5`, merged into `integration/sdk-v1.2` as `3a11140`;
  - GeographicLib-Java's licence text (`bf12769`);
  - the version step: `pda/sdk-1.2-version` `9de9fc7` with `mca/sdk-1.2-pins` `6f64e88`, merged as `b3edfb7`. It also took the ACA's nits P2-2, P3-1 and P4-1 to P4-3.
- **Against:** CR-0025 parts 5 to 7 with R1, R2, R3, N5, N6 and N9; ADR-0039, ADR-0040 and ADR-0019; and ADR-0016 for the dependency.
- **Tests run by the ACA,** on `integration/sdk-v1.2` at `b3edfb7`, all pass:
  - the Java SDK's API, 87 tests, and its test kit, 255 tests (Maven, offline);
  - the data model, 82 tests;
  - the web SDK's typecheck and 244 tests in 18 files.

  The ITA's full run for the version step: 151 passed, 14 skipped (Keycloak), on `395e73f`; `tools/test.mjs` on `6f64e88`, the tree of the merge.

### In line

- **A layer's `workspace` (ADR-0039 points 5 and 7).**
  - The store keeps `core.view` as absent.
  - On update an absent `workspace` keeps the stored one, and an explicit one, `core.view` included, must equal it (R2).
  - An object's move to a layer of another workspace is rejected (R1).
  - Creating a layer in a workspace needs the workspace's edit permission.
  - R2 and the create rule are in the schema, `LayerContent`, `model/README.md` (next to rule 5) and the test kit. R1 is in `model/README.md`, `sdk-v1.md`, the design pattern and the test kit; it is not in the schema, and `layerId`'s doc comments in both SDKs do not mention it yet. The test kit's tests show each case.
- **The declarations.** The manifest's `workspaces` (id with the plugin's prefix, name, view and edit permissions among the plugin's own, order) and `Workspace` in Java: View first, then the declared ones.
- **`ObjectQuery`'s workspace filter:** absent means every workspace, and the Javadoc says why it differs from every other default (N9). `inWorkspaces` refuses an empty list.
- **Compatibility (N5, complete):** `LayerContent` and `ObjectQuery` keep their 1.1.0 constructors, as `Change` and `ChangeRequest` do.
- **The web SDK:**
  - `workspaces` on panels, overlays and actions, with View by default (A15);
  - subscriptions that follow the workspace shown unless they name theirs;
  - `ctx.workspace` and `ctx.workspaces`;
  - a layer's `workspace`;
  - interactions ending on a switch.
- **The fade list** (`MapView.createFadeList`; ADR-0040 point 8): one list per handle; the map view fades their union; a switch clears it.
- **Geodesics** (`dev.emcc.sdk.geo`): `inverse`, `direct`, `path` and `at`, on the WGS84 ellipsoid as the data model's edges are (ADR-0019), in longitude, latitude order. A path point keeps its leg's starting altitude; altitude ramps are the simulator's (ADR-0040 point 5).
- **GeographicLib-Java 2.1 (R3, N6):**
  - it is pinned in `server/plugin-sdk/api/pom.xml`, with its MIT licence text in the third-party texts;
  - the jar the ACA's build used is 37 692 bytes with the SHA-256 `1e85feac761b436309a8d3d2ece07162129fd5670afbf1d2d435e38006da00dd` of the approved CR;
  - ECore's plugin class loader still shares only `dev.emcc.sdk.` and JSpecify, so the library is not visible to plugins at run time, although the SDK's dependency puts it on their compile class path;
  - `PluginRules` forbids `net.sf.geographiclib`.
- **Versions:** the SDKs and the data model are 1.2.0, ECore's pins are 1.2.0, the plugins pin `@emc2/plugin-sdk` 1.2.0, and the shell refuses `^1.3.0`.

### Verdict

**Part 5 fits the CR and is accepted,** with one finding for the PDA, before the freeze:

- **P5-1 (PDA, before the freeze): the codec contract test does not treat `core.view` and an absent `workspace` as equal.**
  - CR-0025's Compatibility section says it does. `TestJson`'s normalisation and `ModelCodecContractTest` have no such case, and no valid example has an explicit `core.view`.
  - So the test would fail a codec that writes `"workspace": "core.view"` for a layer read without one, although both mean View (R2); and with no example of an explicit `core.view`, a codec that misread one would pass. (Corrected on 2026-10-26: this line first said such a codec would pass. The fix asked for is the same.)
  - Add the normalisation, and a valid example with an explicit `core.view`. It is a compatible change to the test kit.

## The whole SDK before the freeze (2026-10-26)

- **Every part of CR-0025 is built, reviewed and accepted:** parts 1 to 8, with CR-0020, CR-0022 and CR-0024.
- **The nits the ACA gave the PDA are all fixed:** L1 to L5, D1, P2-2, P3-1 and P4-1 to P4-3.
- **The ACA's points R1 to R7** are in the contract.
  - R4 is the rule the owner approved on 2026-10-22. Its strict outcome follows from P2-1, which the ACA recorded on 2026-10-25: no check showed loopback carrying multicast.
  - The freeze fixes that rule; relaxing it later is a change to the contract.
- **N1 to N9** are in the contract or the design pattern. The `cot` and `simulator` briefs (T-077) still have to carry N1 and N8.
- **ADR-0036 to ADR-0041 are met** where they ask the SDK for something. The rest is ECore's, the shell's and the plugins' work (T-079 to T-086), built against the frozen contract.
- **Still open, carried forward:**
  - P5-1, before the freeze;
  - P3-2 (the channel registry's lock, rule C4) and P2-1's follow-up (`docs/handover/cda.md` still expects a loopback multicast check), for the CDA through the MCA;
  - W3, the browser check of `DeclaredFields` at its first use;
  - the owner's decision of 2026-10-25 on `CODEC_PENDING`, for the MCA to record on the board.
- **The earlier sections said "for the freeze" of W1 and W2.** That meant "to decide at this review"; the answer is below.

### W1 and W2: what must be real before the freeze

The items: the Java default methods that throw (`connections()`, `channels()`, `classifications()`, `declaredFields()`, `workspaces()`); the optional web members (`ctx.declaredFields`, `ctx.workspace`, `ctx.workspaces`, `MapView.createFadeList`); and `CODEC_PENDING` (three examples).

**None of them needs to be real before the freeze.**
- **A freeze fixes the contract, not its implementations.** Plugins build and test against the test kit, whose fakes implement every item. ECore, the shell and `map-view-2d` implement the rest against the frozen contract (T-080, T-081, T-085), as the requirements' work order says.
- **Waiting would hold up every PCA** for that work. `connections()` is real already (`4e30498`).
- **A contract problem found later** is a change request after the freeze. For example, ECore's work on the workspace filter (T-080) could find the contract cannot be met.

**One risk is not in the contract but in ECore today, and needs action now (for the CDA, through the MCA).**
- ECore already validates against the 1.2.0 schemas. But its mapping (`ModelJson`) still builds `LayerContent` and `ChangeRequest` with their 1.1.0 constructors.
- So a layer's `workspace` and a change request's `fields` pass validation and are dropped without an error. A layer meant for Simulation would become a View layer: the exposure ADR-0039 point 7 is meant to stop.
- The reads fail loudly through the throwing defaults; these two writes do not.
- **Until T-080 and T-081 implement them, ECore must refuse** a layer `workspace` other than `core.view`, and any `fields`, with `VALIDATION_FAILED`, rather than accept and drop them.
- Until the gate below is met, no integration build is demoed to users: ECore says SDK 1.2.0, and accepts a `^1.2.0` plugin that then fails at its first call to a missing service.

**All of them must be real before M3 reaches `main`.** That is the gate, not the freeze:
- no throwing default may be reachable in the server that ships, and no optional member may be missing in the shell or `map-view-2d`;
- ECore applies a layer's `workspace` and a change request's `fields`, or refuses them; it never drops them;
- the ITA's M3 flows show it, the workspace filter included (Q25);
- `CODEC_PENDING` is empty, P5-1's case is in the codec contract test, and the invalid `fields` and `workspace` examples are still refused (W2).

**For the MCA:** put this gate on the board as a condition of M3's merge into `main`.

### The owner's decision on the W1 items (2026-10-26)

**The PDA may tighten each W1 item once it is provided, without a new change request** (owner, 2026-10-26, on the ACA's recommendation). To tighten means:
- one of the five Java default methods above becomes abstract once ECore implements it;
- one of the four optional web members above becomes required once the shell or `map-view-2d` provides it.

The scope and the basis:
- **This is an exception** to `CLAUDE.md` section 5 and `agents/pda.md` rule 8, which send every change after a freeze through a change request. It is limited to exactly these nine members.
- **Its basis:** CR-0025's Compatibility section approved them as plain members, implemented only by ECore, the shell, the test kit and `map-view-2d`. The throwing defaults and the optional members were a step of the build, so tightening returns to what the owner approved.
- **Plugins only call these members,** so a plugin's code, such as `ctx.workspace?.current.id ?? 'core.view'`, compiles and runs unchanged.
- **`MapView`** is implemented by `map-view-2d` today, and by a later 3D map view; such a view is built against the SDK and provides `createFadeList` from the start.
- **The tag:** the freeze point is not what reaches `main`. The tag `contracts-1.2.0` goes on the merge into `main`, which carries the tightened members.
- **For the MCA:** record the owner's decision on the board. **For the PDA:** record each tightening in its handover and in `sdk-v1.md`.

### Verdict for the owner's freeze

**SDK 1.2.0 and data model 1.2.0 are ready to freeze once P5-1 is in** (`integration/sdk-v1.2`, `b3edfb7` with P5-1). Nothing else blocks. The owner has decided the tightening of the W1 items (above).

## Checks before the freeze (2026-10-26)

At the owner's request, the ACA checked the two branches that followed the whole-SDK review.

### `cda/refuse-unmapped` (merged as `056dfbd`)

**It does what the review asked of ECore:**
- `ModelJson` maps a layer's `workspace` and a change request's `fields` both ways; a JSON `null` value removes a field, as the schema says.
- `ObjectStore.refuseNotYetApplied` refuses any `fields` at `/fields`, and a layer `workspace` other than `core.view` at `/data/workspace`, with `VALIDATION_FAILED`, for browsers and plugins alike. It comes after the permission check, so a user without the permission still gets `PERMISSION_DENIED` first (overview 4.4).
- Nothing drops them on the way any more: the session's trusted copy of a browser's request keeps `fields`, and the store's extension merge keeps `workspace`. No other code in ECore or the edge builds a layer or a request with the 1.1.0 constructors, except ECore's default layer, which is a View layer, and its expiry deletes, which cannot carry `fields`.
- An explicit `core.view` is stored as absent (R2).
- P3-2 and P2-1's follow-up are in `docs/handover/cda.md`: P3-2 for the channels branch, and R4's strict form, since no loopback multicast check was made.

**Two notes for the CDA, neither blocking:**
- **C1, for T-080:** on update, the store turns an explicit `core.view` into an absent `workspace` before it builds the new state. That is right today, since every stored layer is in View. Once other workspaces exist, an absent `workspace` must keep the stored one, and an explicit one, `core.view` included, must be compared with the stored one before it is normalised (`model/README.md`, R2). Otherwise an update naming `core.view` would leave a Simulation layer where it is, instead of being refused.
- **C2, wording:** `server/README.md` still says that rule 3 is checked first. A create with `fields`, or with another workspace, now gets `VALIDATION_FAILED` even when its id is in use (`ObjectStoreTest` pins this). A request sent again still gets the same answer, so nothing breaks, but the line should name the exception. (`model/README.md` keeps its rule 3 sentence: the refusal is ECore's, until T-080 and T-081.)
- **C3, stale since `CODEC_PENDING` is empty:** `server/README.md` still says that ECore's codec test round trips the examples the contract test leaves out. `ModelJsonContractTest`'s `theCodecPendingExamplesRoundTrip` and its doc comment now repeat what the inherited contract test covers.

### `pda/codec-workspace` (merged as `15b66e8`, whose tree is the one the ACA tested)

**It closes P5-1 and W2:**
- `TestJson.normalize` removes `"workspace": "core.view"`, except in an update request's `data`, where an absent `workspace` keeps the stored one and `core.view` must equal it, as `model/README.md` says. Change events carry `state`, not `data`, so the exception touches only requests.
- `layer-in-view.json` is `layer.json` with an explicit `core.view`. `TestJsonTest` checks both cases, and that other workspaces are kept.
- `CODEC_PENDING` is empty. All 26 valid examples that are not manifests round trip in ECore's `ModelJsonContractTest`, among them the three that were pending and `layer-in-view.json`. The three invalid `fields` and `workspace` examples are still rejected.
- `sdk-v1.md` records it, and `model/README.md` lists `layer-in-view.json`.

### Tests

On `3e0d0d8`, the tree of `15b66e8`, offline: Java SDK 87, test kit 256, ECore 632 and model 83, all passing. The web SDK did not change.

### Verdict

**SDK 1.2.0 and data model 1.2.0 are ready for the owner's freeze at `integration/sdk-v1.2` `15b66e8`.** P5-1 is in, and nothing else blocks.

Of the gate for M3's merge into `main` (above), two items hold already: `CODEC_PENDING` is empty with P5-1's case, and ECore refuses `workspace` and `fields` rather than dropping them. The rest waits for T-079 to T-081, T-085 and T-086.
