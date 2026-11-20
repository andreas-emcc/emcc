# ADR-0050: Field sets, groups of declared fields that an object carries

- Status: Accepted (owner, GR, 2026-11-05; its decision points approved with the M5 plan, GQ)
- Date: 2026-11-05
- Deciders: Owner (advised by the ACA; T-132, FS to FW; the M5 plan's Q3, `docs/architecture/m5-plan.md`)
- Extends: ADR-0038 (declared plugin fields) and ADR-0037 (output channels)

## Context
ADR-0038 lets a plugin declare fields in its own namespace, which any editor can set. Since SDK 1.3.0 the editor shows:
- the fields of the object's data type;
- then every other plugin's fields in a collapsible list, "Other fields" (BO).

The owner's RC2 test found this too loose. For example, there was no Callsign field: `cot` sends the Name.

The owner wants field sets instead (T-132, FS to FW, 2026-11-03):
- each in/out plugin declares its set of protocol fields through the SDK, for example CoT, ADS-B, AIS, and later Friendly Force Targeting;
- in Symbol properties, a dropdown with a "+" adds a set to an object;
- an object can carry several sets, and the "+" is grey for a set it already has;
- an object that a plugin receives carries that plugin's set from the start;
- "Other fields" goes;
- they are mainly for simulator tracks sent out in several formats, but are used in the View workspace too.

ADR-0038 is accepted and is not edited, so field sets are a new ADR that extends it.

## Decision
1. **A field set is a named group of one plugin's declared fields,** declared in that plugin's manifest, with an id, a label and its fields. A plugin may declare several. Each in/out plugin declares the set its protocol uses.
2. **An object carries a list of the field sets it has.** The PDA's CR names that list's place in data model 1.4.0. The fields' values stay where ADR-0038 puts them, in `extensions.<plugin-id>.<name>`.
3. **A change request may add a set,** with values for its fields or without. This takes `objects.edit`, as any edit does (ADR-0038 point 4). The store checks that the set is declared, and checks the values as ADR-0038 point 2 says.
   - **Removing a set** from an object is not in M5.
   - **When a plugin is removed,** its set stays listed on objects and is forwarded, but no editor offers it (as in ADR-0038 point 6).
4. **An object received by an in plugin carries that plugin's set from the start.**
5. **Editors show each set as a group,** after the core fields and the fields of the object's data type:
   - a dropdown with a "+" adds a set, and the "+" is grey for a set the object already has;
   - "Other fields" goes.

   This replaces ADR-0038 point 5's "+" for other plugins' fields, and SDK 1.3.0's collapsible list.
6. **`cot`'s set has a Callsign,** separate from the generic Name (FS to FW):
   - incoming CoT fills both;
   - outgoing CoT sends the Callsign, else the Name;
   - a Name that depends on the outgoing format comes in a later milestone.

   T-131's CoT unit fields belong to `cot`'s set.
7. **An output channel names the field set its protocol uses** (this refines ADR-0037 point 4's "the declared fields its protocol uses"). A sender such as the simulator offers that set.
8. **An object's data type stays changeable** after creation (Q3; ADR-0023 point 6). A change keeps the object's sets and their values.

## Alternatives considered
- **Sets bound to data types:** no list on the object, but a simulator track sent out as CoT and as AIS would need two data types at once.
- **Free choice of single fields** (SDK 1.3.0's "Other fields"): flexible, but users could not see which fields a protocol needs. The owner's test found it too loose.
- **One set per object:** simpler, but a track sent out in several formats needs several sets.

## Consequences
- **Data model and SDK 1.4.0, part 3 (PDA):**
  - the manifest's sets;
  - the list on the object;
  - adding a set in a change request;
  - the editor component with the dropdown;
  - a channel's set.
- **ECore (CDA):** the list of declared sets, and the store's checks.
- **Plugins:**
  - **`cot`:** its set, the Callsign and T-131's fields;
  - **`adsb` and `ais`:** their sets;
  - **the simulator:** adds a set when a track is sent out, and offers the set in its panels;
  - **`draw-symbols`:** the dropdown in Symbol properties.
- **ITA:**
  - a received object carries its plugin's set;
  - a set added in Symbol properties;
  - the grey "+";
  - the Callsign in and out of CoT.
