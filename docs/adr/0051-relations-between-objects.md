# ADR-0051: Relations between objects, drawn as pairing lines

- Status: Accepted (owner, HG, 2026-11-05; the owner's decisions HB and HD, and the owner's answers to the ACA's three questions, confirmed as HF; T-150)
- Date: 2026-11-05
- Deciders: Owner (advised by the ACA)
- Extends: ADR-0007 (common data model), ADR-0046 (display settings per user) and ADR-0048 (GMTI and sensor outputs)

## Context
The owner wants a thin yellow line between two paired symbols, switched on per user (T-150, 2026-11-05). The first use is GMTI: each detection is paired with the sensor platform that reported it, in the View workspace (`gmti` in, ADR-0048 point 3) and in the Simulation workspace (the simulator's GMTI sensor, ADR-0048 point 7). Later the same mechanism serves Link 16 pairings and engagements, in other colours.

Today nothing in the data model ties one object to another. `meta.externalRef` is an object's identity in an external system, not a link between objects; `extensions` belong to one plugin each (ADR-0007), so nothing generic can be drawn from them.

The owner decided (2026-11-05):
- **HB:** a generic relation in the data model. An object carries relations to other objects, each with a kind; the GMTI pairing is the first kind. Any plugin can write and read them.
- **HD:** the switches that show them are per user, on the server, as ADR-0046.
- The ACA's questions: in Simulation the line connects the sensor platform with the true tracks it detected, and the platform carries those relations; in View each detection carries its relation to the platform; a user sees no line to an object they may not see, and the reference stays in the data.

## Decision
1. **A relation is a reference inside an object's content**, not an object. The content gets a list `relations`; each entry has a **kind** and the **other object's id**, nothing else in M5. The PDA's CR for data model 1.4.0 names the list's place and its limit per object, which must take a dwell's detections at `gmti`'s default cap per dwell (ADR-0048 point 3). The line that users see is drawn from the reference (point 6) and is itself nothing: it cannot be selected, has no label, is not in the object list, has no security label of its own and is sent by no output.
2. **Kinds are declared in plugin manifests**, as data types are (ADR-0023): `relationKinds`, each with
   - an id `<plugin-id>.<name>`, in the declaring plugin's namespace only;
   - a label, shown at the user's switch (point 7), for example "GMTI Pairing";
   - how its line is drawn: a colour, a width, a dash and an optional arrowhead at the other object, for the directed kinds to come (an engagement points at its target);
   - the default of the user's switch, on or off.

   ECore builds the list of kinds at start-up from the manifests. **A change request with a kind that is not declared is rejected** with the reason, on create and on update, as an unknown data type is (model rule 14). Stored data is never checked when it loads: a kind whose plugin was removed stays on the objects, is forwarded, and is drawn no more, since nothing declares its line. ECore declares no kinds of its own.
3. **Any plugin writes relations**, as part of an object's content, like `properties`. A user's request needs `objects.edit`, as any edit does (overview 4.4); a server part writes as its plugin. The store checks the kind (point 2) and the limit (point 1), and **nothing else**: not that the other object exists (it may come in the same batch, later, or sit in a layer the writer cannot see), nor its layer, workspace or label.
   - **Updates carry the whole content** (ADR-0018), so a writer that updates an object keeps the relations of other kinds that it finds on the current object, as it keeps the other core fields. In M5 one plugin writes the relations of each object that has any (`gmti` in View, the simulator in Simulation). Adding and removing single relations by naming them in a request, as ADR-0038 does for fields, comes when two plugins write relations on the same objects, for example Link 16.
   - **The writer puts the relation on the object whose life bounds it.** A short-lived object that depends on a long-lived one carries the reference (a detection to its platform); a long-lived object that is told what it is related to at the moment carries a list that is replaced each time (a sensor platform to the tracks it saw in its last dwell).
4. **ECore never cascades.** When the other object is removed, or expires and ECore removes it (ADR-0023 point 7), the reference stays on the carrying object and draws nothing; the writer's next update drops it, or it goes with its own object. A relation keeps no object alive, and deleting an object touches no other object's relations.
5. **Labels and permissions (owner, 2026-11-05):** a line is drawn only when **both objects are in the user's own live picture**. The server already leaves out what the user may not see (ADR-0020); the client never has the hidden object, so no line, and nothing of the hidden object shows. The reference id stays in the data the user receives: a UUID reveals nothing on its own. The server does not strip relations per user in M5; that is reconsidered when access by label comes (ADR-0020). A relation adds nothing to either object's label.
6. **`map-view-2d` draws the lines**, as it draws the speed vector (T-138): for every relation whose kind the user has switched on, a geodesic line from the drawn position of the carrying object to the drawn position of the other, in the kind's colour, width, dash and arrowhead, **under the symbols**, in every workspace. The drawn position of a point object is its point; of any other object, the position the map view uses for its label. Lines are not picked and not selected (ADR-0031's selection is of objects). A faded object's line takes the lower opacity of its two objects. When both objects carry a relation of one kind to each other, one line is drawn. A relation to an object the map view does not hold draws nothing (point 5).
7. **The switch is per user, on the server (HD):** one display setting per declared kind, in the display settings service (ADR-0046), with the kind's default from its declaration, which the admin can change (ADR-0046 point 3). The display settings window (ADR-0052) shows one check box per declared kind, labelled with the kind's label. A change applies at once in all of the user's browsers (ADR-0046 point 6) and is the same in every workspace (A4).
8. **The first use, GMTI (ADR-0048):**
   - `gmti` declares the kind **`gmti.pairing`**, "GMTI Pairing", a thin solid yellow line, no arrowhead, **off by default** (the owner: switched on per user).
   - **In View**, `gmti` in creates each detection with one relation of that kind to the sensor platform's object, whose id is stable per link and platform (ADR-0048 point 3). The detection is never updated for it, and the pairing ends with the detection's expiry.
   - **In Simulation**, the simulator's GMTI sensor puts on its platform the relations to the true tracks it detected in its last dwell, replaced at each revisit, and empty when it saw nothing. `ChannelItem.Dwell` already carries the platform's id as `sensorId`, and each `Detection` the track's id, so the sensor has everything it writes.
   - **No M5 output sends relations.** STANAG 4607 carries the pairing in its dwell structure, and `gmti` out builds dwells from `ChannelItem.Dwell`, not from relations; `cot`, `ais` and `adsb` have no field for them.
9. **No editor shows or edits relations in M5.** Symbol properties, the object list and the drawing plugins ignore the list, and forward it as they forward the rest of the content. Showing "Paired with" in Symbol properties, and pairing by hand, are later.
10. **Later kinds** are declared by their plugins: Link 16 pairings and engagements, each with its own colour, an engagement with an arrowhead at the target. Nothing about them is decided here.

## Alternatives considered
- **A line object of its own, with two ends:** selectable and labelled, but thousands of extra objects for GMTI, each with a label and a lifetime of its own, and each end's position would need an update whenever the paired object moves.
- **The pairing in an extension, as declared fields (ADR-0038):** no model change, but a Link 16 plugin pairing two `cot` tracks would have to write in another plugin's namespace, and nothing generic could be drawn from a field that each plugin names differently.
- **A fixed list of kinds in ECore:** simpler, but no plugin could add Link 16's kinds, and plugins declare their data types and fields in the same way already.
- **Lines drawn by `symbology`:** it draws one symbol at a time, from one object; a line needs two.
- **The server strips relations to hidden objects:** a per-user filter on every object sent, for an id that reveals nothing; the owner chose the client rule (point 5), to be reconsidered with access by label.

## Consequences
- **Data model 1.4.0 and SDK 1.4.0 (PDA, in the CR):** `relations` in the object content with its limit, a model rule for the declared kind, examples valid and invalid; `relationKinds` in the manifest; the declared kinds in the plugin context of both SDKs, so that the map view knows how to draw each; one display setting per kind in the display settings service (ADR-0046, part 5 of the plan).
- **ECore and the shell (CDA):** the list of kinds from the manifests and the check in the store; the setting per kind with the admin's defaults; the window with the check boxes (ADR-0052).
- **Briefs (PDA):** `map-view-2d` (the lines, point 6); `gmti` and the simulator's GMTI sensor (point 8).
- **Plugins:** PCA-map-view-2d draws; PCA-gmti and PCA-simulator write.
- **ITA:**
  - a detection from the playback carries its pairing, and the line shows only after the user switches it on, in that user's browsers only, with the switch following them to a second browser;
  - in Simulation the sensor's platform carries its last dwell's tracks, and the lines move with the tracks;
  - a removed platform, or an expired detection, leaves no line, and the dangling reference breaks nothing;
  - a request with an undeclared kind, or over the limit, is rejected with the reason;
  - the line's two ends are at the objects' positions for a pair whose latitudes and longitudes differ from each other.
- **`docs/architecture/overview.md`** section 4.6 lists `relations`.
