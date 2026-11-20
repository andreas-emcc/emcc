# ADR-0054: A data type brings its field sets

- Status: Accepted (owner, NM A, 2026-11-10; from CR-0038, approved by the owner, NB A and NC A, 2026-11-09; T-165)
- Date: 2026-11-10
- Deciders: Owner (advised by the ACA)
- Supersedes: ADR-0050 points 4 and 5
- Extends: ADR-0023 (data types), ADR-0038 (declared fields) and ADR-0050 (field sets)

## Context
CR-0038 found, in M5:
- **Choosing a data type shows nothing new.** The editors' first group is the fields that name the object's data type (a field's `dataTypes`, ADR-0038), and no manifest has such a field.
- **Field sets are added by hand,** apart from the data type that says the same thing (ADR-0050 point 5).
- **The groups make a long list.**
- **The data type select offers types no user makes by hand:** `simulator.route`, `gmti.detection` and `gmti.platform`.
- **The SDK disagrees with itself** on a field without `dataTypes`: `fieldBelongsTo` counts it in every type, `DeclaredFields` in none.
- **A hand-placed object fades and is deleted** when it takes an in plugin's data type, because the expiry counts from the last change when the object has no observation time.

The owner approved CR-0038 as written (NB A), with its answers Q1 to Q4. Drawn shapes and tactical graphics carry no field sets in M6, as in M5 (NC A, HS). ADR-0050 is accepted and is not edited, so this ADR supersedes its points 4 and 5 and refines ADR-0023 point 7 and ADR-0038's `dataTypes` on a field.

## Decision
1. **A data type names its field sets.**
   - A `dataTypes` entry in the manifest gains an optional `fieldSets`: ids of sets that the same plugin declares, at most 8, each once.
   - ECore refuses a manifest that names a set it does not declare.
   - `core.general` has none.
   - Examples: `ais.vessel` names `ship`, `cot.cot` names `unit`, `gmti.detection` names `report`, and `adsb.aircraft` names `aircraft` (point 10).
2. **The SDKs expose it:** Java `DataType.fieldSets()` and the web SDK's `DataType.fieldSets`, as full ids `<plugin-id>.<id>`, empty when there are none.
3. **The store adds them** (Q2). This replaces ADR-0050 point 4.
   - On a create, and on an update that changes the data type, the store adds the data type's sets that the object does not carry yet, after the check of the sets.
   - A data type change keeps the sets already carried and their values (ADR-0050 point 8).
   - Every writer gets the same result: editors, in plugins, and the simulator's events.
   - An in plugin may still name its set itself; the store adds a set only once.
4. **Editors show the data type's sets at once.**
   - When the user chooses a data type, the editor shows its sets (point 5) before the create, from the plugin context's data types.
   - A data type change in "Symbol properties" sends one update with the new type, and the store adds its sets.
5. **One set at a time, chosen in a drop-down** (owner, 2026-11-09). This replaces ADR-0050 point 5. The web SDK's `DeclaredFields` editor, so every editor alike, shows after the core fields:
   - **a drop-down of the object's sets:** those it carries and, in the Symbols panel, those the new symbol will carry. Only the chosen set's fields are shown and edited. It opens on the data type's first set. A set the object lacks but has values for is in the list, read-only. **Without a set, the drop-down is not shown;**
   - **a "+"** next to it, which offers the declared sets the object does not carry. Choosing one adds it to the object and to the drop-down, chosen. With no set yet, the "+" makes the drop-down appear. It is not shown when no set is left to add. A placed symbol may carry more sets than its data type's (Q1).
6. **Data types a user does not choose** (owner, 2026-11-09).
   - A `dataTypes` entry gains an optional `manual`, `true` by default. `false` means that users do not make such objects by hand.
   - The editors leave such a type out of their data type select. So the declaring plugin keeps the list, and no editor names another plugin's types.
   - The simulator marks `simulator.route`; `gmti` marks `gmti.detection` and `gmti.platform`.
   - An object that already has such a type shows it in the select, so that an edit does not change it unseen.
   - The store does not check it, since the simulator and the in plugins write these types.
7. **Drawn shapes and tactical graphics** follow points 4 and 6 in their data type selects, and carry no field sets in M6 (NC A).
8. **A field's `dataTypes` is deprecated** (Q4). The sets replace it.
   - It stays valid in 1.x.
   - The editors stop showing a group for it.
   - `fieldBelongsTo` is deprecated with it.
9. **A data type's expiry counts from the observation only** (Q3). This refines ADR-0023 point 7.
   - The web SDK's `expiresAt` and ECore's removal use `time.expires`, else `time.observed` plus the data type's `expiresAfterSeconds`.
   - An object with neither does not expire by its data type, so a hand-placed `ais.vessel` symbol stays on the map.
   - In plugins set `time.observed` on every object, so their tracks fade and go as today.
10. **Every in plugin's data type has a set.** `adsb` declares `altitudeFt`, `verticalRateFpm`, `squawk`, `emergency` and `onGround`, and a set of them, as ADR-0050 point 1 already asks. This is a brief edit in the same release.

## Alternatives considered
- **Do nothing:** the data type select keeps no visible effect, and users add sets by hand.
- **The editors add the sets** (Q2's other answer): no store change, but the same rule in every writer.
- **Fields name their data types** (ADR-0038's `dataTypes`): already possible, unused by every plugin, and a field could belong to several types without a group label.
- **A list in each editor's settings** instead of `manual`: an admin could change it, but every editor would name other plugins' types and keep its own copy.
- **No data type select in the Symbols panel:** it avoids the expiry trap, but a hand-placed object could then never be a ship or a CoT unit.

## Consequences
- **Data model and SDKs 1.5.0 (PDA), the M6 plan's part 1:**
  - the schema and its two model rules;
  - `DataType` in both SDKs;
  - `DeclaredFields` with the drop-down and the "+";
  - the deprecations and `sdk-v1.md`;
  - the briefs of `draw-symbols`, `draw-shapes`, `draw-tactical`, `cot`, `ais`, `gmti`, `adsb` and the simulator.
- **ECore (CDA):** the manifest checks, the store's added sets, and the expiry's base.
- **The PCAs:**
  - the three editors;
  - `cot`, `ais` and `gmti` name their sets;
  - `gmti` and the simulator set `manual: false`;
  - `adsb` declares its fields and its set.
- **The index:** ADR-0050's row notes points 4 and 5 as superseded; ADR-0023's and ADR-0038's rows note the refinements.
- **Stored data:** unchanged. Objects keep the sets they carry; nothing is migrated.
- **ITA:**
  - a create by data type;
  - the drop-down and the "+";
  - a data type change;
  - the select without the three types;
  - a hand-placed `ais.vessel` that does not fade.
