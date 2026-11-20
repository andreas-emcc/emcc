# Objects

Map objects and layers live in the **object store**, the only writer. A plugin changes them only by sending change requests, and reads them with queries and subscriptions. This page also covers what objects carry from the plugins' manifests (data types, declared fields, field sets, relation kinds), layers and workspaces as objects see them, and a plugin's own documents.

## Server part (Java)

### Change requests

[`Store`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/store/Store.java) (`context.store()`) has three calls; each returns at once, and the answers arrive later in a worker's mailbox. They are always delivered, never coalesced, and each `submit` and `query` counts as an outstanding ask (default cap 10 000 per plugin).

A [`Change`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/store/Change.java) is a change request without `requestId` and `source.plugin`, which ECore fills in:

```java
Change.createObject(UUID newId, MapObjectContent content).withExternalRef(new ExternalRef("cot", uid)).bySystem("tak-north")
Change.updateObject(MapObject current, MapObjectContent content)   // baseVersion = current.version()
Change.deleteObject(current)
Change.createLayer(newId, layerContent) / updateLayer(current, layerContent) / deleteLayer(current)

context.store().submit(change, Duration.ofSeconds(10), ctx.self(), outcome -> new Updated(uid, outcome));
```

- **Ids** are new UUID v7 for a create.
- **An update replaces the core content as a whole** (`type`, `dataType`, `dataSource`, `time`, `layerId`, `geometry`, `symbol`, `style`, `properties`, `label`, `relations`): a field left out is removed. Build it from the latest state you have. A layer's `workspace` and `locked`, and an object's `fieldSets`, are kept when absent.
- `withExternalRef(ref)`: the object's identity in an external system, only on a create. The store keeps it for the object's life and refuses a second object with the same `system` and `id` (`EXTERNAL_REF_EXISTS`).
- `bySystem(name)`: the external system the change comes from (`source.system`), 1 to 256 characters.
- `notSaved()`: an object update that is applied and sent but not written to disk, for a simulator's moves. It may change only `geometry`, `time` and the symbol's `direction` and `speed`, and carries no declared fields; anything else is `VALIDATION_FAILED`. Save the object's whole state with ordinary updates at your own saving moments ([ADR-0041](../../adr/0041-unsaved-simulation-moves.md)).
- Do not deconstruct `Change` or `ObjectQuery` with a record pattern: they may gain components.

**The outcome** ([`ChangeOutcome`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/store/ChangeOutcome.java)), exactly one:

```java
switch (outcome) {
  case ChangeOutcome.Applied a -> known.put(uid, (MapObject) a.event().state());
  case ChangeOutcome.Rejected r when r.rejection().code() == ChangeRejection.Code.EXTERNAL_REF_EXISTS -> lookUp(uid);
  case ChangeOutcome.Rejected r -> log.warn("rejected: {}", r.rejection().message());
  case ChangeOutcome.Unknown u -> retryWithSameId(uid);   // may or may not have been applied
}
```

- `Applied(event)`: the [`ChangeEvent`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/model/ChangeEvent.java), with the new state (`null` for a delete), version and sequence number.
- `Rejected(rejection)`: a [`ChangeRejection`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/model/ChangeRejection.java) with a `code`, a message in English and `details` (JSON Pointers into the request). Codes: `VALIDATION_FAILED`, `ENTITY_NOT_FOUND`, `ENTITY_EXISTS`, `EXTERNAL_REF_EXISTS`, `LAYER_NOT_FOUND`, `LAYER_NOT_EMPTY` (only empty layers can be deleted), `PERMISSION_DENIED`, `INTERNAL_ERROR`, `LAYER_LOCKED`.
- `Unknown(reason)`: no answer within the timeout (1 ms to 10 minutes). A create may be sent again with the same id; if the first arrived, the answer is `ENTITY_EXISTS`. With the reason `too many outstanding asks` it was not sent at all.

A server part's changes carry no user: the store checks no user permission for them, and they pass a layer's lock. Last write wins; `baseVersion` is recorded but not checked.

### Extensions and other plugins' fields

`content.extensions()` ([`Extensions`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/model/Extensions.java)) maps plugin ids to JSON objects. A plugin writes only its own namespace, `extensions.<pluginId>`:

- **On update** the store applies only the requesting plugin's namespace: present replaces it, `{}` removes it, absent keeps it. Every other namespace is taken from the stored object, whatever the request holds; it is ignored, never rejected.
- **On create** every namespace in the request is accepted, so an imported object keeps what it was exported with.

```java
Extensions mine = object.content().extensions().with(context.pluginId(), JsonObject.builder()
    .put("placedWith", JsonString.of("symbol-palette")).build());
```

**Declared fields** are the fields a plugin declares in its manifest's `fields` (see below). To set another plugin's field, which it must declare `editableByOthers`, name it in the change; never write its namespace into the content:

```java
Change.updateObject(current, content)
    .withFields(List.of(new FieldValue("cot", "callsign", JsonString.of("ALPHA-1"))))   // null as the value removes it
```

`withFields` is only for the create and update of an object, at most 64 fields (`ChangeRequest.MAX_FIELDS`). The store checks each value against its declaration and applies it after the content. Check a value first with `DeclaredField.problem(value)`. Others may set your editable fields, so build your own namespace from the **current** object on your updates and keep their values unless you mean to change them.

### Queries and subscriptions

An [`ObjectQuery`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/store/ObjectQuery.java) selects objects. All criteria set must hold; none set matches every object. It filters by **layer, data type, data source, external system, external identity, area and workspace only**: there is no query by object id or by extension namespace.

```java
ObjectQuery.byExternalRef(new ExternalRef("cot", uid))
ObjectQuery.byDataSource("tak-north").ofDataType("cot-in.cot")
ObjectQuery.byExternalSystem("ais").inLayer(layerId)
ObjectQuery.all().within(Area.of(ring, centre).withMargin(new Area.Margin.Metres(5_000))).limit(10_000)
ObjectQuery.all().inWorkspaces(Workspace.VIEW)
```

- **Workspaces:** a query without `inWorkspaces(...)` covers **every** workspace. A server part that passes objects on, to outputs or to browsers through its endpoints, filters by workspace itself.
- **Area** ([`Area`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/store/Area.java)): a closed lon/lat ring (at least 4 positions, first equal to last) with geodesic edges, a position inside it, and a margin (`None`, `Metres`, `Share`). An object matches when its bound reaches into the grown ring.
- **Limit:** 1 to 100 000 (the default); a `query` that matches more fails.

`store().query(query, timeout, target, toMessage)` answers once with a [`QueryResult`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/store/QueryResult.java): `Found(objects, layers, sequenceNo)` (all layers), `Failed(reason)` or `TimedOut()`.

`store().subscribe(query, target, toMessage)` returns a `Cancellable` and delivers [`StoreUpdate`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/store/StoreUpdate.java)s: first a `Snapshot(objects, layers, sequenceNo)`, then `Changes(events)` in sequence order. `Changes` hold every layer event and every event of an object that matched before or after the change, so an object that stops matching arrives once more. A new snapshot may come at any time and replaces everything; when more than `Store.MAX_PENDING_UPDATES` (1 000) updates wait undelivered, ECore drops them and later sends a new snapshot. A query's `limit` does not apply to a subscription. After `cancel()`, queued updates may still arrive: ignore them.

**The object writer.** An input plugin that writes what it receives uses [`ObjectWriter`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/store/ObjectWriter.java), owned by one worker: it finds its objects again by external identity after a restart, keeps one change request in flight per external id (the latest wins), makes and keeps each link's target layer, and counts what it created, updated and was refused. See [connections.md](connections.md) and [`docs/plugins/in-out/playbook.md`](../in-out/playbook.md).

### What objects carry

| Concept | Java | From the manifest |
|---|---|---|
| **Data type**: what kind of information an object is | `context.dataTypes()`, [`DataType`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/DataType.java): `id`, `name`, `declaredBy`, `defaults`, `fieldSets`, `manual`, `sensorReport` | `dataTypes`: `<plugin-id>.<name>`, default expiry, fade and removal, field sets (at most 8), `manual`, `sensorReport`, `fadeSetting` |
| **Declared field**: a field of a plugin's namespace with a label and limits | `context.declaredFields()`, [`DeclaredField`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/DeclaredField.java), `FieldValue`, `FieldRef` | `fields`: `name`, `type` (`text`, `number`, `integer`, `choice`, `boolean`), `label`, `unit` (SI, `deg` for angles), `minimum`, `maximum`, `maxLength` (default 1 024), `required`, `choices`, `editableByOthers` |
| **Field set**: a named group of the plugin's own fields | `context.fieldSets()`, [`FieldSet`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/FieldSet.java) (`id()` is `<plugin-id>.<name>`); `MapObjectContent.withFieldSet(id)` | `fieldSets`: `id`, `label`, `fields` |
| **Relation kind**: a kind of link from one object to another | `context.relationKinds()`, [`RelationKind`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/RelationKind.java); `Relation(kind, objectId)`, `MapObjectContent.withRelations(...)` | `relationKinds`: `<plugin-id>.<name>`, `label`, `line`, `defaultOn` |
| **Workspace**: a tab beside View with its own layers | `context.workspaces()`, [`Workspace`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/Workspace.java) (`VIEW` is `core.view`) | `workspaces`: `<plugin-id>.<name>`, `name`, `viewPermission`, `editPermission`, `order` |

The lists are fixed while the server runs. The store checks:

- **Data type and source:** on create, and when `dataType` changes, the data type must be available (`core.general` or a loaded plugin's). Any plugin may use any available data type. `dataSource` is `manual` for objects users draw, otherwise the stream's name; it is fixed at creation.
- **Expiry** comes without a change event: an object expires at `time.expires`, else `expiresAfterSeconds` after `time.observed`. ECore deletes expired objects later as ordinary deletes.
- **Field sets:** a set an object adds must be declared by a loaded plugin; nothing removes a set. On a create of a `core.symbol`, and when its data type changes, the store adds the data type's sets.
- **Relations:** a new entry's kind must be declared; the other object is never checked, and deleting an object never changes another's relations.
- **Layers and workspaces:** a layer belongs to one workspace (`LayerContent.workspace`, `null` for View), set at its create; an object never moves to a layer of another workspace. Leave `workspace` out on a layer update. While a layer's `locked` is true, users' changes to it and its objects are refused; a server part's pass. Leave `locked` out on updates to keep it.

### Plugin documents

[`Documents`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/document/Documents.java) (`context.documents()`) keep the plugin's own small state that must survive a restart (e.g. which layer belongs to which link): a key maps to a `JsonObject`, in the plugin's namespace only.

```java
context.documents().put("layers", JsonObject.of(Map.of("tak-north", JsonString.of(layerId.toString()))), self, Saved::new);
context.documents().get("layers", self, LayersLoaded::new);
switch (result) {
  case DocumentResult.Found f -> layers = LayerIds.from(f.value());
  case DocumentResult.Missing m -> layers = LayerIds.empty();
  case DocumentResult.Written w -> {}
  case DocumentResult.Failed f -> log.warn("document {}: {}", f.key(), f.reason());
}
```

- **Keys:** lowercase letters, digits, `.` and `-`, starting with a letter or digit, at most 128 characters (`Documents.checkKey`).
- **Limits:** 1 MiB per document as UTF-8 JSON, 1 000 documents per plugin. ECore answers each call within 10 s, at the latest with `Failed`.
- **Write-behind:** `Written` means applied in memory; it is stored shortly after, and a crash can lose the last moments.

## Web part (TypeScript)

A web part has no store object. It uses ([`context.ts`](../../../web/plugin-sdk/src/context.ts), [`objects.ts`](../../../web/plugin-sdk/src/objects.ts)):

- **`ctx.changes.submit(request)`**, with the `changeRequests` helpers (`createObject`, `updateObject`, `deleteObject`, `createLayer`, `updateLayer`, `deleteLayer`, `withFields`, `withFieldSets`). The shell fills in `requestId` and `source`. It resolves with `{ outcome: 'applied', event }` or `{ outcome: 'rejected', rejection }`, and rejects only with `OutcomeUnknownError` (connection lost or timeout: it may have been applied). Show rejections to the user; never retry blindly. **Every request from a web part is a user's**: the server checks the user's permission and the layer lock first.
- **`ctx.livePicture.subscribe(listener, options)`**: a snapshot, then batches of change events; a new snapshot may come at any time. Options: `area` (`'viewport'` or a fixed `Area`), `budget` (above it, clusters), `objects: false` (layers and counts only) and `workspaces` (without it, the workspace shown). See [map.md](map.md).
- **`ctx.objects.get(ids)`**: objects by id, also those the browser does not hold, at most 1 000 ids (`MAX_FETCH_IDS`); gives `found` and `missing`. **`ctx.objects.queryLayer(layerId, { page, pageSize })`**: a layer's objects page by page, in order of creation, `pageSize` 1 to 500 (default 100). Both reject with `ObjectQueryError`: show it and offer Retry.
- **`ctx.dataTypes`** (with the effective `behaviour`, `onDataTypesChange`, `expiresAt`, `choosableDataTypes`), **`ctx.declaredFields`** (`fieldValuesOf`, `fieldProblems`, `changedFields`, `declaredFieldProblem`, `fieldEditableBy`, the shared `DeclaredFields` editor), **`ctx.fieldSets`** (`withDataTypeSets`), **`ctx.relationKinds`** and **`ctx.relationLines`** (`replaceRelations`), **`ctx.workspace`** and **`ctx.workspaces`** (`workspaceOf(layer)`, `VIEW_WORKSPACE`).

```ts
const outcome = await ctx.changes.submit(
  changeRequests.withFields(changeRequests.updateObject(object, content), changedFields(start, values)));
if (outcome.outcome === 'rejected') showProblem(outcome.rejection);
```

**User documents** ([`userDocuments.ts`](../../../web/plugin-sdk/src/userDocuments.ts)), `ctx.userDocuments`: JSON documents in the plugin's namespace for the logged-in user only, which follow the user to any browser. `get(name)` (or `null`), `put(name, value)`, `delete(name)`, `list()`. Names follow the plugin documents' key rule (`USER_DOCUMENT_NAME`). Limits (`USER_DOCUMENT_LIMITS`): 256 KiB per document, 200 documents per plugin and user, 4 MiB per user over all plugins. A failure rejects with `UserDocumentError`, whose `problem` is `bad-name`, `too-large`, `too-many`, `user-full` or `unavailable`. They are not shared, carry no security label, and must not hold copies of objects. Last write wins.

## In the manifest

`dataTypes`, `fields`, `fieldSets`, `relationKinds` and `workspaces`, as in the table above. The ids of data types, relation kinds and workspaces start with the plugin's id and a dot; a field's name and a field set's id are given without it, and a set names only the plugin's own fields. ECore refuses a plugin that breaks this or declares an id or a name twice. A data type names the field sets its objects carry (`dataTypes[].fieldSets`); prefer that to a field's own `dataTypes`. See [manifest.md](manifest.md).

## Rules

- Change objects and layers only through change requests ([ADR-0005](../../adr/0005-change-events-single-writer.md)); never keep a copy and call it the truth.
- Write only your own extension namespace; forward every other namespace untouched. Set another plugin's fields only by naming them with `withFields`, and only those it declares `editableByOthers` ([ADR-0038](../../adr/0038-declared-plugin-fields.md)).
- Every object and layer you create carries a security label (`context.defaultLabel()` unless you have a reason), an available `dataType` and a `dataSource` (never `manual` for received data).
- Give received objects their external identity, and find them again with `ObjectQuery.byExternalRef` or `byExternalSystem`.
- Send the complete core content on every update, built from the latest state.
- Handle every outcome: `Applied`, `Rejected` and `Unknown`; on the web, `applied`, `rejected` and `OutcomeUnknownError`.
- Filter by workspace yourself before passing objects on; a Java query without a workspace filter covers every workspace.
- Coordinates are WGS84, longitude then latitude.
- Keep state that must survive a restart in plugin documents, never in files of your own; keep a user's personal data in user documents, never in browser storage.

## Testing

**Java.** `FakePluginContext` has an in-memory [`FakeStore`](../../../server/plugin-sdk/testkit/src/main/java/dev/emcc/sdk/testkit/FakeStore.java) (`ctx.store()`) that checks changes as ECore does, and [`FakeDocuments`](../../../server/plugin-sdk/testkit/src/main/java/dev/emcc/sdk/testkit/FakeDocuments.java) (`ctx.documents()`).

```java
var ctx = FakePluginContext.builder("my-plugin")
    .dataTypes(myType).declaredFields(cotCallsign).fieldSets(unitSet).workspaces(simulation).build();
Layer layer = ctx.store().seedLayer("Tracks");
ctx.store().rejectNext(ChangeRejection.Code.VALIDATION_FAILED, "bad");
ctx.store().loseNextAnswer();                       // applied, but Unknown after the timeout
ctx.store().gap();                                  // subscribers get a new snapshot
ctx.documents().seed("layers", JsonObject.of(Map.of()));
ctx.runUntilIdle();
assertThat(ctx.store().objects()).hasSize(1);
```

Also `seed(layer)`, `seed(object)`, `requests()`, `applyAs(actor, user, change)` (a user's change, with permissions, workspaces and the lock), `restart()`, `snapshotNow()` and `unsaved()` for updates that are not saved, `timeOutNextQuery()`, `dropNextRequest()`, `areaMatcher(...)`; `FakeDocuments.failNext(reason)` and `stored()`.

**Web.** `createFakeContext(options)` from `@emc2/plugin-sdk/testing` records every request in `ctx.submitted` and answers with a default policy that checks declared fields and the layer lock; replace it with `ctx.answerWith(request => outcome | 'unknown')`. Drive the live picture with `ctx.live.snapshot(...)` and `ctx.live.changes(...)`, the server's objects with `setServerObjects`, `setServerLayers` and `failObjectQueries(true)`, and user documents with `storedUserDocuments` and `failUserDocuments(true)`. See [testing.md](testing.md).

## See also

- [permissions-and-labels.md](permissions-and-labels.md), [map.md](map.md), [connections.md](connections.md), [channels.md](channels.md), [manifest.md](manifest.md)
- [`model/README.md`](../../../model/README.md), "Rules the schema cannot express"
- [ADR-0005](../../adr/0005-change-events-single-writer.md), [ADR-0007](../../adr/0007-common-data-model.md), [ADR-0023](../../adr/0023-data-types-and-data-sources.md), [ADR-0038](../../adr/0038-declared-plugin-fields.md), [ADR-0039](../../adr/0039-workspaces.md), [ADR-0050](../../adr/0050-field-sets.md), [ADR-0051](../../adr/0051-relations-between-objects.md), [ADR-0024](../../adr/0024-persistence-manager-postgresql-from-m2.md), [ADR-0027](../../adr/0027-per-user-data.md)
