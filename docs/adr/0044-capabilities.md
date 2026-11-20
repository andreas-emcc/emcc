# ADR-0044: Capabilities, optional plugin interfaces

- Status: Accepted (owner, GR, 2026-11-05; its decision points approved with the M5 plan, GQ)
- Date: 2026-11-05
- Deciders: Owner (advised by the ACA; T-135; `docs/architecture/m5-plan.md`, A2)
- Extends: ADR-0003 (the plugin model)

## Context
A plugin gets ECore's and the shell's functions through the SDK's interfaces. Since W1 (2026-10-29), their members are required. A function that only some plugins need would then force every other plugin to carry an empty stub, and ECore could not tell a real implementation from a stub.

The owner wants optional plugin interfaces, detected when a plugin loads (T-135, 2026-11-05):
- a plugin implements only what it needs;
- ECore and the shell give each function only to the plugins that declare it.

The first one is temporal awareness (T-136, ADR-0045). Later interfaces use the same mechanism.

The manifest already tells ECore what a plugin brings before its code runs: its data types (ADR-0023), its fields (ADR-0038), its outside hosts and its connections. The shell needs the same kind of advance knowledge, for example to show the time control before any web part has loaded.

## Decision
1. **A capability is an optional interface defined by the SDK.** Each has an id, such as `temporal`. It says what the plugin implements: in its server part, its web part, or both. It also says what ECore and the shell then give the plugin.
2. **A plugin declares its capabilities in its manifest,** in a list `capabilities` of ids (A2):
   - ECore reads the list at start-up, before any plugin code runs;
   - the shell receives it with the list of plugins;
   - web-only plugins can have capabilities too.
3. **The plugin's code implements each declared capability:**
   - **Server part:** the plugin's class implements the capability's Java interface.
   - **Web part:** the module provides the capability's object, as the SDK defines it.
4. **Declaration and code must agree.** A capability that is declared but not implemented, or implemented but not declared, is a fault:
   - **Server part:** ECore does not start the plugin and states the reason in the Monitor, as for an incompatible `sdkVersion`.
   - **Web part:** the shell does not use the capability for that plugin and reports the mismatch to the server, which shows it in the Monitor.
5. **An unknown capability id,** for example one from a newer SDK, is a fault in the same way.
6. **No empty stubs from now on:** a new function that not every plugin needs comes as a capability, not as a new required member of an existing interface. The members that are required today stay as they are (W1).
7. **The Monitor lists each plugin's capabilities.**

## Alternatives considered
- **Detect by the code alone,** for example with `instanceof`: no manifest entry is needed. But the shell would know nothing before the web parts load, and web-only plugins would need a second mechanism.
- **Optional members with default implementations on the existing interfaces:** no new concept. But the defaults are stubs again, and ECore cannot tell whether a plugin really supports the function.
- **The manifest alone, without checking the code:** simple, but a mismatch would only surface when the function is first called.

## Consequences
- **SDK 1.4.0, part 4 (PDA, through the CR):**
  - the manifest's `capabilities`;
  - how a capability is defined in the Java SDK and the web SDK;
  - the test kit checks that a plugin's declaration matches its code.
- **ECore and the shell (CDA):**
  - the check at load in ECore, and the check in the shell;
  - the Monitor's list of capabilities and its faults.
- **ITA:** a plugin with a mismatch is refused with its reason.
- **The first capability** is `temporal` (ADR-0045).
