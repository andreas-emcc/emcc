# Common data model

- **Version:** 1.9.0 (data model 1.9.0, for M9; CR-0048), in `package.json`. Owned by the PDA. First draft 0.1 by the ACA (T-004).
- **Status:** **1.9.0, frozen on 2026-11-18 at the merge of `pda/sdk-1.9-freeze-run` into `integration/sdk-v1.9` (from `237089b4`, sets 1 to 10; the run: owner ACH A); to `main` with M9 (tag `contracts-1.9.0`, MCA)** (part P: CR-0048, approved by the owner 2026-11-16, ZB A; PQ1 to PQ5 A; part U: CR-0050, approved 2026-11-16, ZL A, in it with the UAV track, ABO A) ("SDK 1.9.0" in `docs/plugins/sdk-v1.md`; the model's "Changes in 1.9.0"). **1.8.0, frozen on 2026-11-15 (owner XL A) at the merge of `pda/sdk-1.8-freeze-run` into `integration/sdk-v1.8` (from `f13baaa8`, with T-211); to `main` with M8 (tag `contracts-1.8.0`, MCA)** (CR-0043, approved by the owner 2026-11-13, UO A; with CR-0044 and CR-0047) ("SDK 1.8.0" in `docs/plugins/sdk-v1.md`; the model's "Changes in 1.8.0"). **1.7.0, frozen on 2026-11-12 at the merge of `pda/sdk-1.7` into `integration/sdk-v1.6` (from `30661b96`; its builders `cda/sdk-1.7` `5696e6de`, `pca-map-view-2d/m7` `4decd6d3` and `pca-gmti/m7` `086bf905` checked against it); to `main` with M7 (tag `contracts-1.7.0`, MCA)** (CR-0042, approved by the owner 2026-11-12, TC A; its version TD A) ("SDK 1.7.0" in `docs/plugins/sdk-v1.md`; the model's "Changes in 1.7.0"). **1.6.0, frozen on 2026-11-12 at the merge of `pda/sdk-1.6-freeze` into `integration/sdk-v1.6` (from `4c3de175`, after full runs 1 to 3 and the quick run m7q2 of parts A to H, with full run 4's plugin fixes `b7f9338a`); to `main` with M7 (tag `contracts-1.6.0`, MCA)** (CR-0041, approved by the owner 2026-11-11, RJ A; its version given 2026-11-12, RQ A) ("SDK 1.6.0" in `docs/plugins/sdk-v1.md`; the model's "Changes in 1.6.0"). **1.5.0, frozen by the owner on 2026-11-11 (Q51 A) at the merge of `pda/freeze-1.5.0` into `integration/sdk-v1.5` (from `7eae6708`, after the full run f23 of its five parts); to `main` with M6 (tag `contracts-1.5.0`, MCA)** ("Changes in 1.5.0") (CR-0038, approved by the owner 2026-11-09, NB A and NC A; parts 2 to 5 with CR-0039, approved by the owner 2026-11-10, OB A and OC A). **1.4.0, frozen by the owner on 2026-11-09 at `49c91962` (MG), after the ACA's reviews of its parts; on `main` since 2026-11-10 (`0ce6728f`, tag `contracts-1.4.0`, with M5)** (CR-0030, approved by the owner 2026-11-05, and CR-0031, approved 2026-11-06; given its version on 2026-11-06 after part 1) ("Changes in 1.4.0"); changes only through a change request. **1.3.0, frozen by the owner on 2026-10-31 at `461dd82`, after the ACA's review; on `main` since 2026-10-31 (`2a417da`, tag `contracts-1.3.0`, with M4)** (CR-0028, with CR-0023, approved by the owner 2026-10-30) ("Changes in 1.3.0"). **1.2.0, frozen by the owner on 2026-10-27 at `8c58da2` (with CR-0026), after the ACA's review; on `main` since 2026-10-29 (`f83cd70`, tag `contracts-1.2.0`, with M3)** (CR-0025, approved by the owner 2026-10-22) ("Changes in 1.2.0"). **1.1.0, frozen by the owner on 2026-10-15 at `a78aa83`, after the ACA's review; on `main` since 2026-10-22 (`fac299b`, tag `contracts-1.1.0`, with M2)**, with SDK 1.1.0 (T-064; CR-0014, approved by the owner 2026-10-15). **1.0.0:** frozen (2026-10-10, by the owner after the ACA's review T-035; frozen together with SDK v1, T-034; CR-0010). On `main` since 2026-10-12 (`1619e3c`, tag `contracts-1.0.0`). The rules of a freeze apply again:
  - changes only through a change request (`CLAUDE.md` section 5);
  - compatible additions become 1.0.x or 1.x;
  - no field or call may change its meaning in such a version;
  - anything incompatible is 2.0.0.
- **1.1.0 is a minor version:** three optional style fields (below, "Changes in 1.1.0"); every 1.0.0 document is valid 1.1.0, and nothing is migrated.
- **Before:** 0.1.0, frozen on 2026-10-06 with SDK v0 (T-005, tag `contracts-0.1.0`). What changed and how stored 0.1.0 data is migrated: "Changes in 1.0.0" and "Migration" below.
- **Normative:** the schemas in this folder and the rules below are the contract for Java and TypeScript (ADR-0007).

## Files

| File | Content |
|---|---|
| `schemas/common.schema.json` | Shared definitions: UUID, timestamp, plugin id, type name, version, actor, meta, extensions |
| `schemas/geometry.schema.json` | GeoJSON geometries (Point, MultiPoint, LineString, Polygon) plus Circle, Ellipse, Corridor, ArcBand |
| `schemas/security-label.schema.json` | Security label, JSON form of a STANAG 4774 confidentiality label |
| `schemas/map-object.schema.json` | Map object, including the APP-6 symbol and its modifiers. `$defs/content` is the part a change request carries |
| `schemas/layer.schema.json` | Layer. `$defs/content` is the part a change request carries |
| `schemas/change-request.schema.json` | Request to create, update or delete an object or layer |
| `schemas/change-event.schema.json` | Published by the object store after a change |
| `schemas/change-rejection.schema.json` | Sent to the requester when the object store does not apply a request |
| `schemas/plugin-manifest.schema.json` | A plugin's `plugin.json`. Not exchanged data, but a contract of the SDK, kept here so it is tested the same way. It is **versioned with the SDK**, not with the data model. Described in `docs/plugins/sdk-v1.md` |
| `examples/sdk-version-matching.json` | Shared cases for matching a manifest's `sdkVersion` (npm semver semantics). ECore and the shell must pass all of them; checked against npm's `semver` 7.8.4 |
| `examples/valid/` | Must pass their schema |
| `examples/invalid/` | Must fail their schema, each for one stated reason (listed in the test) |
| `examples/invalid-by-rule/` | Pass the schema but break a rule below (`rule-<n>-…`). For the contract tests of the object store and the SDKs |
| `examples/migration/0.1.0-to-1.0.0/` | Stored data before and after the migration to 1.0.0 (`before/`, `after/`, same file names). The contract test of the persistence manager's migration |
| `test/examples.test.mjs` | Validates every schema and example (`npm test`) |

The file name prefix of an example tells which schema applies: `object-` map object, `layer` layer, `change-request-`, `change-event-`, `change-rejection-`, `manifest-` plugin manifest.

Schemas use JSON Schema draft 2020-12. Their ids are URNs (`urn:emc2:schema:<name>`), so no tool ever tries to download them.

## Overview

```
 Layer 1 ─────── * MapObject
                    ├── type       (what it is on the map: core.symbol, …)
                    ├── dataType   (what kind of information: core.general, cot-in.cot, …)
                    ├── dataSource (where it came from: manual, tak-north, …; fixed)
                    ├── time?      (observed, validFrom, expires)
                    ├── geometry   (WGS84, lon/lat order)
                    ├── symbol?    (APP-6 B / D / E, with modifiers)
                    ├── style?     (for shapes)
                    ├── properties?(name, description)
                    ├── label      (STANAG 4774, mandatory)
                    ├── extensions (per plugin, blind-forwarded)
                    └── meta       (created, modified – set by the object store; externalRef – from the create request)

 ChangeRequest ──► object store (single writer) ──► ChangeEvent (topic objects.changed)
                                                └─► ChangeRejection (to the requester only)
```

## Conventions

- JSON in UTF-8, property names in camelCase.
- **Ids** are lowercase UUIDs, generated by whoever creates the entity (on create, the requester sends the new id). Use UUID version 7: its time ordering suits database indexes. The SDKs provide a generator.
- **Timestamps** are RFC 3339 in UTC with a trailing `Z`, millisecond precision.
- **Coordinates** are WGS84 `[longitude, latitude]` or `[longitude, latitude, altitude]` in decimal degrees. Altitude is metres above the ellipsoid (HAE). Distances are geodesic metres; bearings are degrees clockwise from true north.
- **Numbers** in the core fields (coordinates, radii, opacities, versions and so on) have **IEEE 754 double precision**, as the SDKs' model types hold them (Java `double`, TypeScript `number`), and are compared as doubles: a writer may write the nearest double for a longer decimal. **Only free-form JSON keeps exact decimals**: extension data, and a plugin manifest's settings (ADR-0007). (CR-0004, approved by the owner 2026-10-07.)
- **Plugin ids** are lowercase words separated by hyphens (`draw-symbols`). The plugin id is also the plugin's extension namespace.
- **Type names** are `<namespace>.<name>`, where the namespace is `core` or a plugin id. Core object types: `core.symbol`, `core.multipoint`, `core.shape`.
- **Data types** (ADR-0023) have the same form. The built-in one is `core.general`. Plugins declare theirs in their manifest (`dataTypes`), in their own namespace, e.g. `cot-in.cot`.
- **Data sources** are lowercase words separated by hyphens, at most 64 characters: `manual` for drawn objects, or a stream's name, e.g. `tak-north`.
- **SIDCs:**
  - APP-6B: 15 characters.
  - APP-6D: 20 digits, with version digits (1–2) 10, 11 or 12.
  - APP-6E: 30 digits, with version digits 13 or 14. **A 20-digit APP-6E SIDC means the 30-digit one with digits 21–30 all zero** (owner, 2026-10-05). Writers write the 20-digit form when digits 21–30 are all zero (as rule 13: omit what is empty); readers accept both; comparisons, including symbol caches keyed by appearance, treat them as equal.

  - **vessel** (1.4.0, ADR-0047): 4 digits: APP-6D's context (0 reality, 1 exercise, 2 simulation), APP-6D's standard identity (0 pending to 6 hostile), then the AIS ship and cargo type 00 to 99 (ITU-R M.1371; 00 "not available"). For example `0470` is a real neutral cargo ship.

  The version mapping follows milsymbol 3.0.4, the renderer chosen in ADR-0010. The meaning of digits 21–30 is not checked against the APP-6E text.
- **Symbol modifiers** are a closed list, named as in milsymbol's options. `direction` (degrees clockwise from true north) and `speed` (metres per second over ground) are numbers; all others are text, 1–128 characters, as displayed. The symbology plugin turns `speed` into display text.

## Rules the schema cannot express

These are normative for every implementation (object store, SDKs, plugins). The object store rejects a request that breaks rules 1–4, 11 or 14–18 with a change rejection (`VALIDATION_FAILED`, or the specific code named in the rule).

1. **Polygon rings are closed**: the first and last positions are equal. The object store rejects open rings. It accepts either ring orientation and normalizes to the right-hand rule: going along the exterior ring, **the inside lies to the left** (counter-clockwise), and holes run the other way. The orientation is determined **geodesically, not in longitude/latitude**: along the geodesic edges of rule 10, which may cross the antimeridian without a split. It is computed on the sphere, or with longitudes unwrapped along each shortest edge. So a ring that runs from 179° to −179° is a small ring, not one around the whole Earth, and it gets the right orientation.
2. **Geometry sanity:** for ArcBand, `innerRadius < outerRadius`. For Ellipse, `semiMinorAxis <= semiMajorAxis`.
3. **References:**
   - `layerId` must refer to an existing layer (`LAYER_NOT_FOUND`).
   - A create must use a new `entityId` (`ENTITY_EXISTS`).
   - A create's `externalRef` must not belong to another object (`EXTERNAL_REF_EXISTS`, rule 16).
   - An update or delete must refer to an existing entity (`ENTITY_NOT_FOUND`).
4. **Clients never send `version` or `meta`.** The object store sets them. The schema rejects them in change requests. An external identity is sent as the request's `externalRef` (rule 16), never in `meta`.
5. **Update semantics:**
   - The **core fields** (`type`, `dataType`, `dataSource`, `time`, `layerId`, `geometry`, `symbol`, `style`, `properties`, `label`, and from 1.4.0 `relations`) are replaced as a whole. (`relations` is no exception like `fieldSets`: a sensor must be able to empty its list, and rule 13 makes an empty list the same as an absent one.) A field missing from the request is removed from the object. A requester therefore sends the complete core content, based on the latest state it has, with `baseVersion` set to that state's version.
   - **Extensions on update:** the object store applies only the requesting plugin's own namespace (`source.plugin`). If present, it replaces the stored value; an empty object `{}` removes it; if absent, the stored value is kept. **All other namespaces are always taken from the stored object**, whatever the request contains. This enforces "only the owner writes" and makes blind forwarding automatic. (1.2.0: another plugin's declared fields that are editable by others change only when a change request names them in its `fields`, see "Changes in 1.2.0".)
   - **A layer's `workspace` (1.2.0, ADR-0039) is the exception:** on update an absent `workspace` keeps the stored one, so that a 1.1.0 plugin's rename keeps the layer where it is; an explicit one, `core.view` included, must equal the stored one, else `VALIDATION_FAILED`. **An object update that moves the object to a layer of another workspace is rejected** with `VALIDATION_FAILED` too (R1). See "Changes in 1.2.0".
   - **A layer's `locked` (1.3.0, ADR-0042) is the second exception:** on update an absent `locked` keeps the stored value, so that a writer built before 1.3.0 does not unlock a layer; `true` sets it and `false` clears it. See "Changes in 1.3.0".
   - **An object's `fieldSets` (1.4.0, ADR-0050) is the third exception:** on update an absent list keeps the stored one, and each listed set is added to it; **nothing removes a set** (ADR-0050 point 3). So a writer built for 1.3.0 never drops one. See "Changes in 1.4.0".
   - **Extensions on create:** all namespaces in the request are accepted. This lets an imported object keep the extensions it was exported with (for example an emc2 export read back through NVG), so nothing is lost.
6. **Delete** increases the version by one, like any other change. The change event has `state: null` and carries the label the entity had, so receivers can filter without the state.
7. **Sequence numbers** are global and gapless per server. (1.2.0: in the live sequence; a file store's journal may hold declared gaps for updates that are not saved, see "Changes in 1.2.0".)
8. **Actor:** `source.plugin` identifies the requesting plugin. `source.user` is set by the server from the login session; a value sent by a client is never trusted.
9. **Axis order:** the schema only catches swapped coordinates when the value in the latitude position is outside ±90. Every converter must still be tested with a point where latitude ≠ longitude.
10. **Edges are geodesic.** The edge between two consecutive positions of a LineString, Polygon ring or Corridor is the **shorter** geodesic between them, whatever the map projection. Renderers densify edges, so a shape looks the same in Web Mercator and polar projections. An edge may cross the antimeridian (e.g. from 179° to −179° is 2° long), so geometries are never split there. Limitation (since v0): a polygon that encloses a pole cannot be expressed. Draw it as a Circle or ArcBand around the pole instead.
11. **Only empty layers can be deleted.** The object store rejects deleting a layer that still has objects, with `LAYER_NOT_EMPTY` (owner decision, 2026-10-05).
12. **Every change request gets exactly one answer:** a change event on `objects.changed`, or a change rejection to the requester, both with the request's `requestId`. An update equal to the stored state is applied like any other (new version, change event), so the requester always knows the outcome. When optimistic locking is added later (`baseVersion`), a new rejection code such as `CONFLICT` is a minor change; it must also settle the reuse of version numbers after updates that are not saved (1.2.0, see "Changes in 1.2.0").
13. **Empty means absent** for optional objects and arrays: `extensions`, `symbol.modifiers`, `style`, `properties`, `time`, `label.categories`, `details`, a manifest's `dataTypes`, and from 1.4.0 an object's `fieldSets` and `relations`. An empty one (`{}` or `[]`) means the same as a missing one. **Writers omit** empty optional objects and arrays; **readers accept both** forms. Comparisons, including the codec round trip, treat them as equal. This does not apply to the value of one extension namespace: on update, `{}` there removes that namespace (rule 5).
14. **Data type and data source** (ADR-0023):
    - **Checking the data type:**
      - On create, and on an update that changes `dataType`, it must be one of the **available data types**: `core.general` and those declared in the loaded plugins' manifests. Otherwise the request is rejected with `VALIDATION_FAILED` and the path `/data/dataType`.
      - The check is never made when stored data is loaded. An object whose data type is no longer declared keeps it and gets the default behaviour; ECore warns once per such data type.
    - Any plugin may create objects of any available data type.
    - `dataSource` is `manual` for objects that users draw. A plugin that receives a stream uses the stream's configured name, never `manual`.
    - `dataSource` is fixed at creation: an update must carry the stored value. Otherwise it is rejected with `VALIDATION_FAILED` and the path `/data/dataSource`.
15. **Time attributes:**
    - When both are present, `time.validFrom` is not after `time.expires` (`VALIDATION_FAILED` otherwise).
    - An object is **expired** from `time.expires` on. Without it, it expires `expiresAfterSeconds` after `time.observed`; without `expiresAfterSeconds`, or (1.5.0, CR-0038 point 9) without `time.observed`, it does not expire by its data type. Before 1.5.0 an object without `time.observed` expired after its last change (`meta.modified.at`); so a symbol placed by hand with an in plugin's data type faded and went.
    - `expiresAfterSeconds`, `fadeWhenExpired` and `removeAfterExpirySeconds` are the data type's **configured** values in ECore's settings, with the defaults from the declaring manifest (ADR-0023 point 7). The web SDK gives the effective values (`DataType.behaviour`) and `expiresAt(object, behaviour)`.
    - **Expiry happens without a change event:** whoever shows it (the map view fades the object) compares the expiry with the clock.
    - ECore's later removal of an expired object is an ordinary delete change request, with its change event (owner, 2026-10-10).
16. **External identity:** only a create of an object may carry `externalRef`; the schema rejects it elsewhere. The object store copies it to `meta.externalRef` and keeps it for the object's life: updates never change it.
    - **Order of the checks:** the object store checks rule 3 first (the id, then the layer), then rules 14, 15 and 16, then (1.4.0) 17 and 18, then (1.5.0) adds the data type's sets (rule 21), then the declared fields. So a resent create whose id and external identity both exist gets `ENTITY_EXISTS`: it arrived the first time.
    - **Unique:** no two existing objects have the same `system` and `id` (`EXTERNAL_REF_EXISTS`). Deleting the object frees it, so the next report from that system creates a new object.
    - Plugins find objects by it through the SDK (Java object access).
17. **Relations** (1.4.0, ADR-0051, CR-0031):
    - **On create,** each entry's `kind` must be a declared kind: one in a loaded plugin's manifest `relationKinds`. Otherwise `VALIDATION_FAILED` at `/data/relations/<i>/kind`.
    - **On update, per entry:** an entry (its kind and its id) that the stored object already carries passes, declared or not; every other entry's kind must be declared. So a writer that keeps a removed plugin's entries is not rejected for them, and a new entry of an undeclared kind is, even when the stored object carries other entries of that kind.
    - **Never checked when stored data is loaded,** as rule 14's data type. A kind no longer declared is kept and forwarded, and drawn no more.
    - **The other object is never checked** (whether it exists, its layer, its workspace or its label), and **deleting an object never changes another object's relations.** A store that adds such a check breaks the contract.
    - **A manifest's kinds** start with the plugin's own id and a dot, each once; ECore refuses the plugin otherwise.
    - **Order of the checks:** after rule 16's, then rule 18's, then the declared fields (`fields`, 1.2.0).
18. **Field sets** (1.4.0, ADR-0050, CR-0030 part 3):
    - **A set that a request adds** (on create every listed set; on update every listed set the stored object does not carry) must be declared by a loaded plugin: `<plugin-id>.<id>` of an entry in that plugin's manifest `fieldSets`. Otherwise `VALIDATION_FAILED` at `/data/fieldSets/<i>`. Adding a set needs no more than the edit itself (`objects.edit`, or the workspace's edit permission).
    - **Sets already stored are not checked,** those of a removed plugin included: they are kept and forwarded (ADR-0050 point 3), as on loading stored data.
    - **A manifest's sets** name only the plugin's own declared `fields`, each id once; ECore refuses the plugin otherwise (example `invalid-by-rule/rule-18-manifest-field-set-unknown-field.json`).
19. **Local folders** (1.4.0, ADR-0049 point 4, CR-0030 part 6): ECore refuses a plugin whose manifest names a folder id twice, or whose folder's `setting` does not point to a property of type `string` in its settings schema. Every path the plugin passes to `LocalFolder` is relative to the folder; ECore resolves it, links included, and refuses one that lies outside the folder. It never writes there.
20. **A data type's field sets in the manifest** (1.5.0, CR-0038 point 1): each id in a `dataTypes` entry's `fieldSets` is the `id` of a set in the same manifest's `fieldSets`. ECore refuses the plugin otherwise (example `invalid-by-rule/rule-20-manifest-data-type-unknown-field-set.json`). `core.general` has none.
21. **The store adds a data type's sets** (1.5.0, CR-0038 point 3, the owner's Q2): on a create of a **`core.symbol`** object, and on an update of one that changes `dataType`, the object store adds to `fieldSets` each set of the (new) data type that the object does not carry yet, after those it carries and lists, in the data type's order. It does so after rule 18's check, so the sets it adds are not checked again: rule 20 made them declared. A change of data type keeps the sets already carried and their values (ADR-0050 point 8); nothing removes one. A request that lists a data type's set itself gets it once. Every writer gets the same result: editors, in plugins, the simulator's events. An update that does not change `dataType` adds nothing, and stored data is not migrated: objects keep the sets they carry. **Only `core.symbol` objects in 1.5.0** (owner, NO A, 2026-11-10): drawn shapes and tactical graphics carry no field sets in M6 (NC A), so the store adds none to a `core.shape` or `core.multipoint`, whatever its data type; a later version may widen this.
22. **A stepped fade's end** (1.7.0, CR-0042): in a value of the form `$defs/steppedFade`, `invisibleAtSeconds` is above `fromSeconds`. A value that breaks it gives no stepped fade (the web SDK's `steppedFadeOf`); a plugin's settings schema cannot say it, so its form should.
23. **Declared channel kinds** (1.9.0, CR-0048 point 4): in `channelKinds`, each `name` once. A kind's `payload` schema is **self-contained**: every `$ref` in it starts with `#` (a pointer inside the same schema), and ECore never fetches anything for it (offline, ADR-0030). ECore refuses a manifest that breaks either. A plugin's output channel takes only kinds its own manifest declares.
24. **Service keys of a plugin's own** (1.9.0, CR-0048 point 3): a key in `provides` starts with `emc2.` (the SDK's own keys) or with the plugin's own id and a dot. The shell refuses a plugin that provides a key of another plugin's id; `requires` and `uses` may name any key. A plugin's id is never `emc2` (`common.schema.json`'s `pluginId`).

## Decisions for v0

The ACA's draft decisions, all **confirmed** by the PDA for v0:

| Decision | Reason |
|---|---|
| Layers change through the same change requests as objects (`entityType: layer`) | One single writer and one event stream for everything on the map. ADR-0005 only mentions objects; **the ACA records this** |
| Update replaces core fields as a whole, and merges extensions per namespace (rule 5) | Simple last-write-wins without losing other plugins' data |
| Altitude is HAE | Matches WGS84 and CoT; conversion to mean sea level happens only at display and format boundaries |
| Extra geometries: Circle, Ellipse, Corridor, ArcBand | Needed for shapes and for NVG and CoT exchange; GeoJSON lacks them |
| Layers are flat (no groups) | Simplest start; see "Deferred" |
| `drawOrder` is a number, not an integer | Moving a layer changes only that layer (layer-panel brief) |
| Ids are generated by the requester | The requester knows the id at once, which makes retries safe |

New in v0 (PDA):

| Decision | Reason |
|---|---|
| **Change rejection** message with fixed codes | The briefs need the reason for a refused change (`draw-symbols`, `layer-panel`); the draft had no answer for failures |
| Closed modifier list; `direction` and `speed` as numbers | Catches misspelt names; machine values instead of display text, which `cot-in` needs |
| SIDC version digits checked per standard | Catches a SIDC labelled with the wrong standard |
| Geodesic edges (rule 10) | Shapes must not change with the projection; no antimeridian splitting |
| Only empty layers can be deleted (rule 11) | Owner decision, 2026-10-05 |
| **Types are written by hand** in both SDKs (Java records and sealed interfaces; TypeScript types), and checked by contract tests with these examples: every valid example must parse and serialize back to the same JSON, and the SDKs' validation must reject every invalid example | Generators produce poor Java for `oneOf` and `if`/`then`, and records and sealed interfaces are the agreed Java style (`agents/pda.md`). The examples keep both sides honest |

## Changes in 1.0.0

Data model 1.0.0 implements CR-0010 (approved 2026-10-10) for ADR-0023 and `cot-in`. It is a major version because `dataType` and `dataSource` are required, so stored 0.1.0 data needs the migration below.

| Change | Reason |
|---|---|
| `dataType` required on map objects (rule 14) | Behaviour such as expiry and fading is configured per kind of information, and plugins add their own kinds without changes to emc2 (ADR-0023). `type` keeps its meaning: what the object is on the map |
| `dataSource` required, fixed at creation (rule 14) | Shows which stream an object came from; `manual` for drawn objects (ADR-0023) |
| Optional `time`: `observed`, `validFrom`, `expires` (rule 15) | CoT's `time`, `start` and `stale` (`cot-in`); the item deferred in v0 |
| `externalRef` in the create request, unique (rule 16), with the rejection code `EXTERNAL_REF_EXISTS` | In v0 only the object store set `meta`, so no plugin could give an object its external identity. The separate code lets a plugin that resends a create after "outcome unknown" tell a duplicate from a real error |
| No new rejection code for an unavailable data type or a changed data source | They are validation errors like any other: `VALIDATION_FAILED` with the path |
| Plugin manifest (SDK 1.0.0): `dataTypes` with their default behaviour, and `network` for listeners' endpoints from the settings | ECore needs the list of data types before any plugin code runs (ADR-0023 point 2). Listeners reach only configured hosts (CR-0010 point 7) |
| Layers, labels, geometries and symbols unchanged | Not needed for M1 |

## Changes in 1.1.0

Data model 1.1.0 implements CR-0014 (approved by the owner 2026-10-15) for ADR-0033 point 5: the drawn shapes of `draw-shapes`. Three optional fields in `style`; the default of each is what 1.0.0 draws, so a 1.0.0 document means the same in 1.1.0.

| Field | Values | Meaning |
|---|---|---|
| `fillPattern` | `solid` (default), `hatch` | `hatch`: diagonal lines in `fillColor` and `fillOpacity` across the area, the rest transparent. One pattern in M2 (owner, 2026-10-15); another one later is a new enum value, again a minor change. For areas: `Polygon`, `Circle`, `Ellipse`, `Corridor`, `ArcBand` |
| `arrowhead` | `none` (default), `end` | `end`: an arrowhead at a `LineString`'s last point, along its last segment, in `strokeColor` |
| `pointMarkers` | `none` (default), `circle` | `circle`: a small filled circle at every point of a `LineString`, in `strokeColor` |

- Where a field does not apply (an arrowhead on a polygon, a hatch on a line), it is valid and not drawn, as `fillColor` on a line already is.
- Sizes (the hatch spacing and angle, the arrowhead and the markers) are the map view's, in screen pixels relative to `strokeWidth`.
- Examples: `object-shape-hatched-polygon.json`, `object-shape-arrow.json`, `object-shape-route.json` (valid); `object-style-unknown-fill-pattern.json`, `object-style-unknown-arrowhead.json`, `object-style-unknown-point-markers.json` (invalid).
- **ECore** validates with the 1.1.0 schemas, and its codec carries the three fields (`ModelCodecContractTest` round-trips the new examples); it must have 1.1.0 before any plugin writes them.

## Changes in 1.2.0

Data model 1.2.0 comes with SDK 1.2.0 (CR-0025, approved by the owner 2026-10-22), built in five parts and given its version in one step (2026-10-26). Every 1.1.0 document stays valid.

- **CR-0022** (approved with CR-0025): a manifest's `internet.hosts` may be empty. `hosts` stays required, so `"hosts": []` states "no default host" (every outside host comes from settings an admin fills in), while a manifest that leaves `hosts` out stays invalid. The `internet` description states the owner's rule of 2026-10-19: any host, never one taken from a browser request, a message or an object's data. Examples: `manifest-internet-no-default-hosts.json` (valid); `manifest-internet-without-hosts.json` stays invalid.
- **Connections** (CR-0025 part 2, ADR-0036 point 7): a manifest's optional `connections` declares the server part's own connections, opened in connection tasks: their `kinds` (`tcp-client`, `tcp-server`, `udp`, `multicast`, `other`; one link uses one), their `direction` (`in`, `out`, `both`), an optional JSON Pointer to the links in the settings, and the `reason`. A declaration shown in the monitor view, not an allow-list; `network` keeps its meaning for the deprecated listener. Examples: `manifest-connections.json` (valid); `manifest-connections-without-kinds.json`, `manifest-connections-unknown-kind.json` (invalid).
- **The layer picker** (CR-0025 part 3, ADR-0037 point 2): in a plugin's settings schema, the annotation `"x-emc2": {"kind": "layer"}` on an object `{"id"?: <uuid>, "name": <string>}` asks the shell's form for a layer, existing or "New layer" (saved without an id); `"allowNew": false` allows existing layers only. One keyword with a `kind` leaves room for later kinds. It is an annotation that validators ignore, and the schema stays draft 2020-12; the manifest schema does not look inside `settings`. Example: `manifest-layer-picker.json` (valid), whose settings compile in strict mode with `x-emc2` declared as an annotation (`examples.test.mjs`).
- **Declared fields** (CR-0025 part 4, ADR-0038):
  - A manifest's optional `fields` declares fields in the plugin's own namespace: `name` (`^[a-z][a-zA-Z0-9]*$`, at most 64 characters, each once per plugin, which ECore checks), `type` (`text`, `number`, `integer`, `choice`, `boolean`), `label`, optional `description`, for numbers `unit`, `minimum` and `maximum`, for text `maxLength` (default 1 024), `required`, for choices `choices`, `editableByOthers` (default false) and `dataTypes` (absent: every object). A value is stored in `extensions.<plugin-id>.<name>`: a string for text and choice, a number for number and integer, a boolean for boolean.
  - A change request's optional `fields` (`[{plugin, name, value}]`, 1 to 64, only on the create and update of an object) names the declared fields to set. The object store checks each against its declaration (it exists; it is editable by others, or the requester is its own plugin; the type and limits hold; each field once) and applies them **after** the content: a value sets the key, `null` removes it unless the field is required, and a namespace left empty goes (rule 13). A failing field rejects the request with `VALIDATION_FAILED` at `/fields/<i>`. **Rule 5's blind forwarding is unchanged:** other plugins' namespaces in `data` are still ignored on an update; only named fields change.
  - Examples: `manifest-fields.json` and `change-request-update-object-with-fields.json` (valid); `manifest-field-choice-without-choices.json`, `manifest-field-unit-on-text.json`, `manifest-field-bad-name.json`, `change-request-update-layer-with-fields.json` and `change-request-fields-object-value.json` (invalid).
- **Workspaces** (CR-0025 part 5, ADR-0039):
  - A layer's optional `workspace` (a type name such as `simulator.simulation`) says which workspace it belongs to. Absent means View (`core.view`); **the store keeps `core.view` as absent**, so View's layers carry no `workspace`, and readers treat both alike, as with rule 13's empty values (R2). The creating plugin sets it on create; creating a layer in a workspace needs the workspace's `editPermission`.
  - **On update** an absent `workspace` keeps the stored one (rule 5's exception); an explicit one is compared with the stored one, and a different one is rejected with `VALIDATION_FAILED`: in 1.2.0 a layer stays in its workspace (R2). **An object's move to a layer of another workspace is rejected** with `VALIDATION_FAILED` (R1); moving or copying between workspaces comes later.
  - A change to a workspace's layers or their objects needs the workspace's `editPermission` instead of `objects.edit` and `layers.edit`, which stay View's; without it the server answers `PERMISSION_DENIED` (overview 4.4).
  - A manifest's optional `workspaces` declares the plugin's workspaces: `id` (the plugin's id and a dot), `name`, `viewPermission`, `editPermission` (both among the plugin's own `permissions`) and an optional `order`.
  - Examples: `layer-in-workspace.json`, `layer-in-view.json` (an explicit `core.view`, equal to `layer.json`), `change-request-create-layer-in-workspace.json` and `manifest-workspaces.json` (valid); `layer-bad-workspace.json` and `manifest-workspace-without-edit-permission.json` (invalid).
- **Updates that are not saved** (CR-0025 part 8, ADR-0041) are a Java SDK call (`Change.notSaved()`), not part of the change request schema, so a browser cannot send one.
  - **Rule 7:** the live sequence (change events, batches, subscriptions) stays gapless; only a file store's journal may hold declared gaps, for unsaved updates, which is storage, not the data model.
  - **Rule 12:** after a restart, a version or sequence number that an unsaved update used may be issued again. That is acceptable while `baseVersion` is recorded but not enforced; enforcing it later must settle this reuse.

## Changes in 1.3.0

Data model 1.3.0 comes with SDK 1.3.0 (CR-0028, approved by the owner 2026-10-30), built in steps on `integration/sdk-v1.3` and given its version after step 1 (2026-10-30). Every 1.2.0 document stays valid.

- **The layer lock** (CR-0028 part 2, ADR-0042):
  - A layer's optional `locked` (boolean). Absent or `false`: not locked. **The store keeps `false` as absent**, as it keeps `core.view`, and readers treat both alike.
  - **On update an absent `locked` keeps the stored value** (rule 5's second exception); `true` sets it and `false` clears it. Setting or clearing it needs the layer's edit permission (overview 4.4).
  - **A layer may be created locked.** A layer's create is never refused for the lock: nothing is stored yet, so only its permission is checked.
  - **While a layer is locked, the store refuses a user's change request** (overview 4.4: every request from a browser session) that would change the layer's content, with `LAYER_LOCKED`:
    - an object's create, update or delete in the layer, and an object's move into or out of it;
    - the layer's update or delete, except an update whose result differs from the stored layer only in `locked` and `drawOrder`. The result is compared after an absent `locked` and `workspace` are kept.

    Changes without a user pass: plugins' server parts and ECore's own. Nothing changes and no change event is sent.
  - **Its details:** one item, whose `problem` is `layer <id> is locked`. Its `path` is `/data/layerId` when the request carries the locked layer's id there (an object's update in the layer, a create in it, a move into it), else `""` (a move out of it, an object's delete, the layer's update or delete).
  - **Its place among the store's answers:** after the permission check, and after `ENTITY_NOT_FOUND` and `LAYER_NOT_FOUND` have found the entity and the layers it names; before the rule checks (`VALIDATION_FAILED`), the declared fields and `LAYER_NOT_EMPTY`. A create's `ENTITY_EXISTS` comes before it, and `EXTERNAL_REF_EXISTS` after it, as in ECore's create (the ACA's F1). The schema's `VALIDATION_FAILED` when a request is decoded stays first. So a request to a locked layer gets one answer, whatever else is wrong with it.
  - Examples: `layer-locked.json` and `change-rejection-layer-locked.json` (valid); `layer-locked-not-boolean.json` (invalid).
- **A settings field enabled by another field's value** (CR-0028 part 5): in a plugin's settings schema, `x-emc2` on a property may carry `enabledWhen`: `{"property": <a sibling in the same object's properties, also inside an array's items>, "in": [1 to 32 strings, numbers or booleans]}`. The shell's form shows the field greyed and read only unless the sibling's value is in `in`, and keeps its value; an absent sibling counts as its `default`, and with neither the field is enabled. An `enabledWhen` the form cannot use (an unknown `property`, an empty `in`) leaves the field enabled. `x-emc2` may now carry `enabledWhen` without `kind`, so `kind` is optional; `kind: "layer"` and `allowNew` keep their meaning. **Validation does not change:** it is an annotation, validators ignore it, and a disabled field's value is still validated and stored; the plugin ignores it itself. Example: `manifest-layer-picker.json` (valid; `examples.test.mjs` checks the annotation's shape).

## Changes in 1.4.0

Data model 1.4.0 comes with SDK 1.4.0 (CR-0030, approved by the owner 2026-11-05; CR-0031, approved 2026-11-06), built in parts on `integration/sdk-v1.4` and given its version after part 1 (2026-11-06). Every 1.3.0 document stays valid. **Frozen by the owner on 2026-11-09 at `49c91962` (MG).**

- **The layer picker's button** (CR-0030 part 1a; ADR-0037 point 2 as noted, T-133): the annotation does not change, but the shell's form now has a "+" button instead of the "New layer" entry. It creates the layer at once and saves it picked, with its id. `"allowNew": false` hides the button. A value without an id ("New layer" before 1.4.0) is still read; none were stored (owner, T-133).
- **Tactical graphics** (CR-0030 part 2, ADR-0043 point 9):
  - **Amplifiers:** `modifiers` gains the ones that `core.multipoint` graphics use beyond milsymbol's names, as in mil-sym-ts's amplifier table for the APP-6 D and E graphics: `distances` (AM, metres, 0 to 20 000 000) and `azimuths` (AN, degrees from true north, 0 to 360), arrays of 1 to 64 numbers in the order the graphic defines; and the text amplifiers `targetNumber` (AP), `uniqueDesignation1` (T1), `uniqueDesignation2` (T2, APP-6 E) and `dtg1` (W1). Single-point symbols ignore them. An azimuth may be 360, unlike `direction` (0 ≤ d < 360, a heading kept normalised): an azimuth is a sector's limit as the operator writes it, and a sector from 270 to 360 ends at north written as 360; mil-sym-ts takes both. `distances` and `azimuths` are not optional arrays in rule 13's sense: an empty one is invalid (1 to 64 values), so writers omit the key when there are none, and the codec omits an empty list. CR-0030's tentative `H1`, `H2` and `X1` are not in that table, so they are not added; `AP` and `T2` are.
  - **Control points:** the points of a `core.multipoint` object are its geometry's positions: a `LineString`'s, a `MultiPoint`'s (one point for a circle or a range fan), or a `Polygon`'s exterior ring without its closing position. **Their order and meaning are the graphic's,** as APP-6 defines it; the symbology service's catalogue says, for each graphic, which geometry type it stores and what each point is (`GraphicCatalogEntry` in the web SDK). A `Polygon` holds only an area whose points have no fixed roles, since rule 1 may reverse a ring.
  - Examples: `object-multipoint-range-fan-sector.json`, `object-multipoint-axis-of-advance-with-amplifiers.json` and `object-multipoint-boundary-two-units.json` (valid); `object-modifiers-azimuth-over-360.json` and `object-modifiers-distances-not-numbers.json` (invalid).
- **Field sets** (CR-0030 part 3a, ADR-0050):
  - **The manifest's `fieldSets`:** named groups of the plugin's own declared fields, `{ id, label, fields }`, at most 32. A set's full id is `<plugin-id>.<id>`, e.g. `cot.unit`. Each in plugin declares the set its protocol uses.
  - **The object's `fieldSets`:** the full ids of the sets it carries, each once, at most 64. Rule 5's third exception: an absent list keeps the stored one, a listed set is added, nothing removes one. Rule 18 checks the sets a request adds. The values stay in `extensions.<plugin-id>.<name>`, set through a change request's `fields` (1.2.0).
  - **The data type stays changeable** (ADR-0050 point 8): a change of `dataType` keeps the object's sets and their values.
  - **Tactical graphics** (`core.multipoint`) carry no sets in M5 (owner, HS): the schema allows them, but no editor adds one.
- **Vessel symbols** (CR-0030 part 3b, ADR-0047): `symbol.standard` gains `vessel`, with a 4-digit `sidc` (Conventions; the owner's answer to CR-0030's question 2). Its drawing is `symbology`'s: a pointed hull along `modifiers.direction`, another mark without a direction or at no speed, filled by ship-type group. `modifiers` apply as to APP-6 symbols.
- **Relations** (CR-0031, ADR-0051): `content.relations`, entries `{ kind, objectId }`, each once, at most 1 024. Replaced as a whole on update (rule 5), checked by rule 17, never cascaded. The manifest's `relationKinds` (at most 16) declare each kind's `label`, its `line` (`strokeColor`, `strokeWidth` 0.5 to 10, `strokeDash`, `arrowhead` `none` or `end`) and `defaultOn`. The user's switch per kind is in the display settings (part 5).
- **Capabilities** (CR-0030 part 4, ADR-0044): the manifest's `capabilities`, the ids of the optional capabilities the plugin implements, each once; in 1.4.0 only `temporal` (ADR-0045, the user's time). An unknown id fails the schema. Every declared capability is implemented by at least one of the plugin's parts, and a part implements only declared ones (owner, Q11, 2026-11-06). The user's time travels with the live picture, not in the data model. Examples: `manifest-capabilities.json` (valid), `manifest-unknown-capability.json` (invalid).
- **Local folders** (CR-0030 part 6, ADR-0049 point 4): the manifest's `folders`, at most 8, each `{ id, setting, reason }`. `setting` is a JSON Pointer to the settings string that holds the folder's absolute path; only an admin sets it. The server part reads the folder only through the SDK's `LocalFolder`, read only and confined to the folder (rule 19). Examples: `manifest-folders.json` (valid); `manifest-folder-relative-setting.json` (invalid); `rule-19-manifest-folder-unknown-setting.json` (invalid by rule).
- Examples (part 3): `object-with-field-sets.json`, `object-vessel.json`, `object-with-relations.json`, `manifest-field-sets.json` and `manifest-relation-kinds.json` (valid); `object-vessel-bad-code.json`, `object-relations-over-limit.json`, `object-relation-bad-object-id.json` and `manifest-relation-kind-without-line.json` (invalid); `rule-17-object-relation-unknown-kind.json`, `rule-18-object-unknown-field-set.json` and `rule-18-manifest-field-set-unknown-field.json` (invalid by rule; CR-0030 listed the last as invalid, but the schema cannot check it).

## Migration

The file store holds 0.1.0 data from M0. **The persistence manager migrates it once**, at the first start with data model 1.0.0 (CDA, T-038; CR-0010):

- **Objects:** each gets `dataType` `core.general` and `dataSource` `manual`. **Nothing else changes**: not `version`, not `meta`, and there is no change event, because the information itself does not change.
- **Layers:** unchanged.
- **The journal first:** the file store's journal holds change events whose `state` is 0.1.0 data. Before migrating, the persistence manager folds the journal into the snapshot under 0.1.0, as at any start; then it migrates the snapshot, and the new journal starts at 1.0.0 (ACA review, T-035).
- **Exactly once:** the persistence manager records the data model version it stored, so the migration runs only once. It keeps a copy of the 0.1.0 data before writing, and logs how many objects it migrated.
- **Newer data is refused:** stored data of a newer major version than the server knows is refused at start, never rewritten.
- **Contract test:** `examples/migration/0.1.0-to-1.0.0/`.
  - Each `before/` file is valid 0.1.0 data.
  - The `after/` file with the same name is what the migration must produce, and it is valid 1.0.0 data.
  - `npm test` checks that the pairs differ only as described above.

## Security label

The JSON form maps to the XML of ADatP-4774 (STANAG 4774). The mapping was checked against a public ADatP-4774 example (Isode, "Isode Approach to Data Centric Security using NATO Confidentiality Labels").

| JSON (`security-label`) | ADatP-4774 XML |
|---|---|
| `policyIdentifier.name` | `ConfidentialityInformation/PolicyIdentifier` (element text) |
| `policyIdentifier.uri` | `ConfidentialityInformation/PolicyIdentifier/@URI` |
| `classification` | `ConfidentialityInformation/Classification` |
| `categories[].tagName` | `Category/@TagName` |
| `categories[].type` | `Category/@Type`: `permissive`, `restrictive`, `informative` ↔ `PERMISSIVE`, `RESTRICTIVE`, `INFORMATIVE` |
| `categories[].uri` | `Category/@URI` |
| `categories[].values[]` | `Category/GenericValue`, one element per value |
| `creationDateTime` | `CreationDateTime` |
| `reviewDateTime` | `ConfidentialityLabel/@ReviewDateTime` |

- **Before the real STANAG 4778 binding is built**, this mapping must be checked against the official ADatP-4774 XML schema, not only against a published example (ACA review, 2026-10-05).
- This JSON form is emc2's own. ADatP-4774 also defines other encodings; aligning with its JSON encoding is an open item for when the real STANAG 4778 binding is built. Further optional ADatP-4774 elements are not modelled; adding them later is a minor change.
- **Object and layer labels (ADR-0020):** an object's label covers the object; a layer's label covers the layer's own data (name, order, existence).
  - **Seeing an object:** a user sees an object only if cleared for **both** its label and its layer's label.
  - **Seeing a layer:** a user sees a layer only if cleared for its label.
  - **No constraint between them:** stored labels are not constrained against each other, so no validation rule relates them and existing data never needs a migration.
  - **When:** access control based on labels comes after M1 (owner, 2026-10-10; ADR-0022 point 8). Until then labels are stored, shown and forwarded.
- **Default label:** comes from the server configuration (ECore). The SDKs give it to plugins, which use it for everything they create.

## Changes in 1.9.0

**Frozen on 2026-11-18** with SDK 1.9.0 (`docs/plugins/sdk-v1.md`, SDK 1.9.0, "The freeze"); no schema changes at the freeze.

Data model 1.9.0 comes with SDK 1.9.0, part P (CR-0048, approved by the owner 2026-11-16, ZB A; PQ1 to PQ5 A). The manifest and the plugin id change; **no object or layer schema changes**. Every 1.8.0 manifest stays valid.

- **`channelKinds`** (point 4; ADR-0059 point 3, gap G3): channel kinds the plugin declares, at most 16, each `{ "name", "title", "description", "payload" }`, the payload a self-contained JSON Schema of an object (rule 23). The kind's id is `<plugin-id>.<name>`, e.g. `fmv.camera-pose`.
- **`compute`** (point 5; ADR-0064 point 1): `{ "threads": 1 to 64, "reason": 1 to 512 characters }`, the compute tasks the server part may run at once, at most. Absent means none.
- **`serviceKey`** (point 3, gap G7): the first part may be a plugin id with hyphens, e.g. `map-view-2d.layers`; rule 24 says who may provide it.
- **`pluginId`** (`common.schema.json`): `emc2` is reserved.
- **The settings form's annotations** (point 1, annotations only: validation does not change; the web SDK's `settingsHintsProblem` checks their shape):
  - a group's **`description`** (1 to 512 characters), shown under its heading;
  - **`"kind": "tls-credential"`** on a string property without `enum` or `pattern` (ADR-0062 point 3): a TLS credential's name, or empty for the link's name; the form lists the names ECore has and nothing else of a credential;
  - **the texts rule** (ADR-0060 point 2): every property the form shows has a `title` (1 to 64 characters) and a `description` (1 to 512), and every group a `description`; exempt are an `item.id`'s property and the properties inside a `kind` field. Checked in each plugin's build by the web SDK's `settingsTextProblem` (the template's manifest guard), **not by ECore or the shell**.

## Changes in 1.8.0

**Frozen on 2026-11-15** with SDK 1.8.0 (`docs/plugins/sdk-v1.md`, SDK 1.8.0, "The freeze"); no schema changes at the freeze.

Data model 1.8.0 comes with SDK 1.8.0 (CR-0043, approved by the owner 2026-11-13, UO A; part D 2026-11-14, UZ A). Its version moves with the SDK's, as ECore checks a plugin's `sdkVersion` against `Sdk.VERSION`. Parts A to C are the web SDK's (`docs/plugins/sdk-v1.md`, "SDK 1.8.0"). **Part D** adds one optional manifest member and the settings form's annotations; every 1.7.0 document stays valid. **Part E** (CR-0044: streams, conversions, a floating window and the `Video` icon) has **no schema change**; the manifest's `icon` may also be `Video`. **Part F** (CR-0047, approved by the owner 2026-11-15, WF A and WE A: a stable id for each item of a settings list) has **no schema change** either: it adds the annotation `item.id` below.

- **The manifest's `icon`** (the one schema change): the plugin's icon in the Settings list, also for a plugin without a web part, a name from the web SDK's `PLUGIN_ICONS` (Lucide icons, e.g. `Radar`; pattern `^[A-Z][A-Za-z0-9]*$`, at most 64 characters). The list grows in a minor SDK; the shell shows a name it does not know, or none, as its neutral icon. Example `manifest-settings-form-hints.json`; refused: `manifest-icon-not-a-name.json`.
- **The settings form's annotations** in `x-emc2` (annotations, like `visibleWhen`: validation does not change; the web SDK's `settingsHintsProblem` checks their shape):
  - on an object, **`groups`**: `[{ "id", "label", "properties": [<its own properties, in order>], "folded"?: boolean, "advanced"?: boolean }]`, at most 32, each property in at most one. The free properties come first without a heading; an `advanced` group starts folded and goes last; a nested object is its own group under its `title` and may declare its own groups. In an array's item schema they are the side form's;
  - on a property, **`hint`** (1 to 80 characters, under the field; `description` goes behind an info button, and without a hint a description of up to 80 characters is the hint), **`width`** (`short` or `full`) and, on a number or integer, **`unit`** (1 to 8 characters, e.g. `s`, `m`, `%`);
  - on an array of objects, **`item`**: `{ "name": <a string property of the items>, "noun": <1 to 32 characters: a lower case letter, then lower case letters, spaces and hyphens>, "state"?: <a boolean property>, "columns"?: [<up to 6 properties of the items>] }`. Such an array is a table with a side form, each item its own Save; an array of objects without `item` is one too.
  - **`item.id`** (part F, CR-0047): `"id": <a string property of the items, not the name, the state or a column, and in none of the items' groups>`, which holds each item's **stable id**: a UUID v7 in lower case, made with the item (the shell's form, else ECore) and never changed by emcc, so a renamed item stays the same item to the plugin. ECore gives a missing or empty id a new one when it loads a plugin's settings and at every change, before it validates them, and stores the result; it refuses a change with two items of one id in a list (`400`, with the item's path). The form does not show the id. The items' schema names the property (a string, `readOnly`), and may list it in `required`, since ECore fills it in before validating. Example `manifest-settings-form-hints.json` (`links`).
  - **Meanings from 1.8.0, no new keys:** a false `enabledWhen` greys the field and makes it read only; the value is kept (`visibleWhen` hides). `readOnly` and `examples[0]` have no meaning for the form; `examples[0]` is named when a value breaks the `pattern`. (owner, 2026-11-17, AAT A: the shell's behaviour is the contract).

## Changes in 1.7.0

**Frozen on 2026-11-12** with SDK 1.7.0 (`docs/plugins/sdk-v1.md`, SDK 1.7.0, "The freeze"); no schema changes at the freeze.

Data model 1.7.0 comes with SDK 1.7.0 (CR-0042, approved by the owner 2026-11-12, TC A; its version TD A), for M7 RC2. Every 1.6.0 document stays valid.

- **A data type's stepped fade** (T-192, owner TA A and FC A): a manifest's `dataTypes[].fadeSetting` is a JSON Pointer into the declaring plugin's settings, e.g. `/detectionFade`, to a value of the form `$defs/steppedFade`: `on`, `fromSeconds`, `stepPercent` (a divisor of 100) and `invisibleAtSeconds` (rule 22). The map view draws objects of the type at the stepped opacity, counted from `time.observed`, in place of the expiry fade; off, missing or not of the form, there is none. The plugin's settings schema declares the value in that form.
  - **Examples:** `valid/manifest-data-type-fade-setting.json`; `invalid/manifest-data-type-fade-setting-not-pointer.json`.

## Changes in 1.6.0

**Frozen on 2026-11-12** with SDK 1.6.0 (`docs/plugins/sdk-v1.md`, SDK 1.6.0, "The freeze"); no schema changes at the freeze.

Data model 1.6.0 comes with SDK 1.6.0 (CR-0041, approved by the owner 2026-11-11, RJ A), built in parts on `integration/sdk-v1.6`. Every 1.5.0 document stays valid.

- **`core.text`** (part A; ADR-0055 point 4; T-173): a text placed at a `Point`.
  - **`text`:** `value`, 1 to 1 024 characters, a line break starting a new line; `rotation`, degrees clockwise from true north at the point, 0 to under 360, absent meaning 0; `size`, CSS pixels from 8 to 48, absent meaning 14.
  - **The rules:** required on a `core.text`, which has a `Point` and no `symbol`; absent on every other type.
  - **Its colour** is `style.strokeColor`, else the map view's label colour.
  - **Examples:** `valid/object-text.json`; `invalid/object-text-without-text.json`, `object-text-on-line.json`, `object-text-rotation-360.json` and `object-shape-with-text.json`.
- **A plugin's `category`** (part F; T-174, owner QC A and QD A): one of `data-links`, `geometoc`, `map-and-symbols`, `drawing`, `simulation` and `general`, which the Settings workspace shows in that order as Data Links, GeoMetoc, Map and Symbols, Drawing, Simulation and General. Absent means `general`. Examples: `valid/manifest-category-and-colour.json`, `invalid/manifest-unknown-category.json`.
- **Folders relative to emcc** (part H; T-157, the M7 plan's Q2): a folder setting (`folders[].setting`) may hold an absolute path, as before, or a value that starts with `%emcc%/`, which ECore resolves below the emcc folder; a result outside it is unusable. Only the description changes; settings values are the plugin's own schema.
- **Symbol palettes** (part G; T-156, the M7 plan's Q1 A): a manifest's `symbolPalettes`, 1 to 8, each an `id`, a `name` and 1 to 2 000 symbols (`standard` APP-6B, APP-6D or APP-6E, a whole `code` valid for it, an optional `label`), which `draw-symbols` offers. Each id once (ECore checks). Examples: `valid/manifest-symbol-palettes.json`, `invalid/manifest-palette-bad-code.json`, `invalid/manifest-palette-vessel.json`.
- **A map object's `displayClass`** (part D; T-182, owner QN B and Q58 A): optional, `dwell-area` or `sensor-coverage`, what the object is for the user's display filters ("Dwell areas", "Sensor coverage"); the map view hides it while that switch is off. Absent: no class. Editors forward it. Examples: `valid/object-with-display-class.json`, `invalid/object-unknown-display-class.json`.
- **A relation line's colour from a setting** (part C; T-181, owner QM A): a relation kind's `line.strokeColorSetting` is a JSON Pointer into the declaring plugin's settings to a `#RRGGBB` string, e.g. `/pairingColour`; `strokeColor` stays required and is used while that setting is missing or not a colour. Examples: `valid/manifest-relation-colour-setting.json`, `invalid/manifest-relation-colour-setting-not-pointer.json`.
- **A colour setting** (part F; owner Q60 A): in a settings schema, `"x-emc2": { "kind": "colour" }` on a string with the pattern `^#[0-9A-Fa-f]{6}$`, alone or with `visibleWhen` and `enabledWhen`. An annotation, like `visibleWhen`: validation does not change, and the shell's form shows a colour picker. Example: `valid/manifest-category-and-colour.json`.

## Changes in 1.5.0

Data model 1.5.0 comes with SDK 1.5.0 (CR-0038, approved by the owner 2026-11-09, NB A and NC A; the M6 plan, NJ A), built in parts on `integration/sdk-v1.5` and given its version after part 1 (2026-11-10, owner NP A). Every 1.4.0 document stays valid. **Frozen by the owner on 2026-11-11 (Q51 A)** with the SDK, at the merge of `pda/freeze-1.5.0` into `integration/sdk-v1.5`; the schemas do not change at the freeze.

- **A data type brings its field sets** (CR-0038, part 1):
  - **`dataTypes[].fieldSets`:** the ids of sets the same plugin declares, each once, at most 8 (rule 20). The store adds them to a `core.symbol` object on a create and on a data type change (rule 21; only symbols, owner NO A). E.g. `ais.vessel` names `ship`, `cot.cot` `unit`, `gmti.detection` `report`, `adsb.aircraft` `aircraft`.
  - **`dataTypes[].manual`:** `false` for a data type users do not make by hand (`simulator.route`, `gmti.detection`, `gmti.platform`). Editors leave it out of their data type select, except for an object that has it; the store does not check it. Default `true`.
  - **A field's `dataTypes` is deprecated** (point 8). It stays valid in 1.x; editors no longer show a group for it.
  - **The data type's expiry counts from the observation only** (rule 15, point 9; the owner's Q3). An object without `time.expires` and `time.observed` does not expire by its data type. The schema does not change; what the absence of `time.observed` means for the expiry does, by the owner's decision in a minor version, since it changes no stored value and only keeps objects that would have gone. In plugins set `time.observed` on every object, so their tracks fade and go as before.
  - **Drawn shapes and tactical graphics** carry no field sets in M6, as in M5 (the owner's NC A); their editors follow points 4 and 6 only.
  - Examples: `manifest-data-type-field-sets.json` and `manifest-data-type-not-manual.json` (valid); `manifest-data-type-field-set-bad-id.json` and `manifest-data-type-too-many-field-sets.json` (invalid); `rule-20-manifest-data-type-unknown-field-set.json` (invalid by rule).
- **Sensor report data types** (CR-0039 point 6, part 3; T-151, the owner's Q4): **`dataTypes[].sensorReport`**, `false` by default: objects of this data type are sensor reports, which the map view draws with the symbology service's sensor report symbol instead of their APP-6 symbol. No model rule; the store does not check it. `gmti` declares it for `gmti.detection`. Examples: `manifest-data-type-not-manual.json` (valid, now with it) and `manifest-data-type-sensor-report-not-boolean.json` (invalid).
- **A settings field shown by another field's value** (CR-0039 point 8, part 4; T-160): `x-emc2` on a property of a plugin's settings schema may carry `visibleWhen`, of `enabledWhen`'s shape (`{"property": <a sibling, also inside an array's items>, "in": [1 to 32 strings, numbers or booleans]}`), alone or with `enabledWhen` and `kind`. The shell's form hides the field unless the sibling's value is in `in`; an absent sibling counts as its `default`, and with neither the field shows; a `visibleWhen` the form cannot use shows the field. A field with both is hidden first, then greyed. **Validation does not change:** a hidden field keeps its value, which is still validated and stored. A field required only in some cases is required by the schema's own `if`/`then` (standard JSON Schema). Example: `manifest-settings-visible-when.json` (valid; `gmti`'s links by mode, the owner's Q45 A).

## Versioning

- The data model has one SemVer version for all its schemas, in `package.json`. Data model v0 is 0.1.0, frozen with SDK v0 for M0; data model 1.0.0 comes with SDK v1 for M1, and 1.1.0 with SDK 1.1.0 for M2 (a minor version). The plugin manifest schema is the exception: it follows the SDK version.
- **Minor** change: every document that was valid before is still valid, e.g. a new optional field, a new modifier name, a new enum value, a relaxed limit.
- **Major** change: anything else. Stored data then needs a migration through the persistence manager.
- **No field may change its meaning in a minor version**, even if the schema stays the same (e.g. a unit, or what an empty value means). That is always a major change.
- **History (later):** the event log is append-only and is **never rewritten**, not even by a major change. Old events are read through **upcasters** that turn an event of an older model version into the current form at read time. Timeline playback therefore always replays the events as they were written.
- **Before 1.0.0** the data model follows the same numbering as the SDKs: compatible additions during M0 are 0.1.x, 0.2.0 is breaking, and M1 brings 1.0.0.
- All parts of emc2 are built and released from one repository (ADR-0015), so the core, plugins and browsers always use the same model version. That is why the schemas can be strict (`additionalProperties: false`): a document never meets an older or newer schema in a running system. The compatibility rules protect **stored** data.
- Documents do not carry the model version. The WebSocket protocol and the persistence manager record which version they use.

## Deferred (not in 1.8.0)

| Item | When | Note |
|---|---|---|
| Layer groups (folders) | Later | An optional `parentId` on layers would be a minor change |
| Several servers: event ordering across servers | When more servers are added (ADR-0006) | Sequence numbers are per server (rule 7) |
| Polygons around a pole | When needed | Rule 10 limitation |

## Validation

```
cd model
npm ci
npm test
```

Ajv 8.20.0 (MIT) with `ajv-formats` 3.0.1, dev-only. All strict checks are on, except `strictTuples` (a position is deliberately a 2- or 3-item tuple) and `strictRequired` (the `if`/`then` rules require properties defined in the parent schema). The test also checks that each invalid example fails for its stated reason, and that each `invalid-by-rule` example passes the schema.

The SIDCs in the examples are syntactically valid, but their meaning has not been checked against the standards.
