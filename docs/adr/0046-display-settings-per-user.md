# ADR-0046: Display settings per user, on the server

- Status: Accepted (owner, GR, 2026-11-05; its decision points approved with the M5 plan, GQ)
- Date: 2026-11-05
- Deciders: Owner (advised by the ACA; T-137, GC and GD; `docs/architecture/m5-plan.md`, A4)
- Extends: ADR-0027 (each user's own data)

## Context
The owner wants each user to set how symbols are drawn for them (T-137, 2026-11-05):
- the symbol size;
- the speed vector's length, as the distance covered in N minutes at the unit's speed and heading (GD);
- which labels show next to a symbol.

The settings are kept **on the server, per user** (GC), so they follow the user to every browser.

Two plugins need them: `map-view-2d` and `symbology`. ADR-0027 gives each plugin only its own namespace of a user's documents, so neither plugin can read settings that the other stores. They need a service of their own.

## Decision
1. **The settings:**
   - **the symbol size**, within limits that the CR sets;
   - **the speed vector's minutes, N:** the vector is as long as the distance covered in N minutes at the object's speed, along its direction (GD). It is drawn only for objects with a speed and a direction, and N = 0 hides it;
   - **the labels shown next to a symbol,** chosen from a list that the CR sets.
2. **They apply per user, the same in every workspace and browser** (A4). ECore stores them as the user's own documents in the `core` namespace (ADR-0027). In the no-login mode they are the single local user's.
3. **The admin sets the defaults** in ECore's settings. A user without values of their own gets the defaults, and can go back to them.
4. **Every user may change their own display settings,** with no permission beyond being the user. An entry for them is open to every user, not only in the admin's Settings list; the CDA places it within the top bar (ADR-0031).
5. **Plugins read the settings through an SDK service** and are told when they change. No plugin writes them.
6. **A change applies at once** in all of the user's open browsers. When two browsers write, the last write wins (ADR-0027 point 6).
7. **They change the drawing only.** They never change objects, or what other users see.

## Alternatives considered
- **Per browser, in local storage:** no server work, but the settings would be lost on another browser (GC).
- **Per workspace or per setup:** more control, but more choices than the owner asked for.
- **In `map-view-2d`'s own namespace:** no new service, but `symbology` could not read them (ADR-0027 point 2).

## Consequences
- **SDK 1.4.0, part 5 (PDA):**
  - the display settings service, in the web SDK, where the drawing happens;
  - its fake in the test kit.
- **ECore and the shell (CDA):**
  - the storage and the service;
  - the admin's defaults;
  - the entry where each user changes them.
- **Plugins:**
  - `symbology` draws with the size and the labels;
  - `map-view-2d` draws the speed vector, under the symbol (T-138).
- **ITA:**
  - one user's settings follow them to a second browser, and do not change another user's map;
  - the no-login mode uses the local user's settings.
