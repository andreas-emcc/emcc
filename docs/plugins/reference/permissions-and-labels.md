# Permissions and labels

Who may do what is decided by **permissions**, which the server enforces; the browser only hides what a user may not do. What may be seen and sent is described by the **security label** that every object and layer carries, and an output link sends nothing above its **highest classification**.

## Permissions

A permission is a name: lowercase words with hyphens, joined by dots, at least two parts, at most 128 characters ([`Permissions`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/Permissions.java)).

| Permission | Lets a user | Checked by |
|---|---|---|
| `objects.edit` | Create, change and delete map objects in View | The object store, on every user's change request |
| `layers.edit` | Create, rename, reorder and delete layers in View | The object store |
| `settings.admin` | Change ECore's and the plugins' settings, and see the Monitor | ECore, on every settings change |
| a workspace's `viewPermission` | See the workspace, its layers and their objects | The server, in subscriptions, queries and fetches by id |
| a workspace's `editPermission` | Change the workspace's layers and objects, instead of `objects.edit` and `layers.edit` | The object store |
| `plugin.<id>.<name>` | Whatever the plugin says | The plugin's endpoints (`requires`, or its handler) |

- **A plugin's own permissions** are `plugin.<id>.<name>` (`Permissions.ofPlugin(pluginId, name)`). Declare them, and every core permission the plugin checks, in the manifest's `permissions`.
- **Which users have which** is the server's configuration: with login, `emc2.login.oidc.permissions[<permission>]=<role>,<role>` gives a permission to the roles or groups named in the user's claim (`emc2.login.oidc.roles-claim`, default `groups`). An admin maps a new plugin's permissions after installing it. A user's permissions are fixed at login.
- **The no-login mode:** the local user (id `local`) has every permission.
- **A server part's own changes carry no user:** the object store checks no user permission for them. Changes it makes on a user's request still carry the plugin, so its endpoint checks the user first (below).

### An endpoint's permission (Java)

An endpoint that changes something, or shows what not everyone may see, names the permission it needs ([`Endpoint`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/http/Endpoint.java)); registering endpoints is covered in [connections.md](connections.md):

```java
Endpoint.get("/streams").requires(Permissions.SETTINGS_ADMIN)
Endpoint.post("/routes/{id}/start").requires(Permissions.ofPlugin("simulator", "run"))
Endpoint.post("/import").accepts("application/xml").checksUserItself()
```

- With `requires(permission)`, ECore answers `403` to a user without it and never delivers the request. Without it, every logged-in user may call a `GET`.
- **Every `POST` names a permission:** `register` refuses one without, unless it is marked `checksUserItself()`; then the handler checks `request.user().has(...)` before it changes anything. Use that when one static permission cannot say who may call it, e.g. when the edit permission depends on the target layer's workspace.
- `request.user()` ([`User`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/User.java)) is the browser session's user: `id` (the IAM's `sub`, or `local`), `name`, `permissions`, `noLogin`, and `has(permission)`, always true in the no-login mode.
- An endpoint that changes objects or layers on a user's request requires `objects.edit` or `layers.edit` itself, or the workspace's edit permission. Prefer a change request from the browser, which the server checks.
- A **service endpoint** (`Endpoint.service(method, path)`) is called by other systems without a browser session and has no authentication: it names no permission, and the plugin decides by its settings what it serves.

```java
case Msg.Import m -> {
  if (!m.request().user().has(workspace.editPermissionFor(false))) {
    m.request().response().respond(HttpReply.status(403));
    return;
  }
  ...
}
```

### The user in the browser (TypeScript)

`ctx.user` ([`context.ts`](../../../web/plugin-sdk/src/context.ts)) is the session's user, fixed for the session: `id`, `name`, `permissions`, `noLogin` and `has(permission)`. `PERMISSIONS` holds the core names (`objectsEdit`, `layersEdit`, `settingsAdmin`); a workspace's permissions are in `ctx.workspaces`.

```ts
const readOnly = !ctx.user.has(PERMISSIONS.objectsEdit);
ctx.actions.addObjectAction({ id: 'edit', label: 'Edit', group: 'edit', appliesTo: { types: ['core.symbol'] }, multiple: false, permission: PERMISSIONS.objectsEdit, run });
```

This **only decides what the page offers**: the server checks every request anyway. Without the permission, show the panel **read only** with a short hint; do not hide it. An action with a `permission` is offered only to users who have it. Show a `PERMISSION_DENIED` rejection like any other, and a `403` from your own endpoint likewise, keeping the control disabled.

## Security labels

Every object and every layer carries a `label`, a STANAG 4774 confidentiality label ([`SecurityLabel`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/model/SecurityLabel.java); the mapping to the ADatP-4774 XML is in [`model/README.md`](../../../model/README.md), "Security label"):

| Field | Holds |
|---|---|
| `policyIdentifier` | The policy: `name` (e.g. `NATO`) and an optional `uri` |
| `classification` | A classification of that policy, 1 to 64 characters |
| `categories` | Further categories, e.g. releasability: `tagName`, `type` (`permissive`, `restrictive`, `informative`), optional `uri`, at least one value |
| `creationDateTime`, `reviewDateTime` | Optional times |

```java
SecurityLabel label = context.defaultLabel();              // for everything the plugin creates
SecurityLabel.of("NATO", "UNCLASSIFIED");                  // a policy and a classification only
```

- **The default label** comes from the server's configuration: `context.defaultLabel()` in Java, `ctx.defaultLabel` in the browser. Use it for everything the plugin creates, unless the data brings its own label.
- **An object's label** covers the object; **a layer's label** covers the layer's own data (its name, order and existence). The store does not relate the two.
- **Labels are stored, shown and forwarded.** Reading is not yet restricted by label: it needs a login, and for a declared workspace its view permission. Keep the label on everything you forward, so that a receiver can decide.
- A delete's change event carries the label the entity had, so receivers can filter without the state.

## Classifications and the highest classification

[`Classifications`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/Classifications.java) (`context.classifications()`) is the configured order of classifications per policy, lowest first, fixed while the server runs. The default is NATO's: `UNCLASSIFIED`, `RESTRICTED`, `CONFIDENTIAL`, `SECRET`, `COSMIC TOP SECRET` (`Classifications.NATO`). Policy names match ignoring case; classifications match exactly. In the browser, `ctx.classifications` gives the same orders, with `classificationOrder(orders, policy)` and `NATO_CLASSIFICATIONS`.

**An output link's highest classification.** Every output link has the setting `highestClassification`, a [`ClassificationLimit`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/ClassificationLimit.java) `{policy, classification}`. Its schema, with **no default** (a manifest cannot know the server's default label):

```json
"highestClassification": {
  "type": "object",
  "properties": { "policy": { "type": "string" }, "classification": { "type": "string" } },
  "required": ["policy", "classification"]
}
```

```java
ClassificationLimit limit = ClassificationLimit.from(link.get("highestClassification"), context.defaultLabel());
if (!context.classifications().knows(limit)) {
  status("highest classification " + limit.classification() + " is not in the " + limit.policy() + " order: nothing is sent");
}
if (!context.classifications().within(content.label(), limit)) {
  ref.count("skipped: above the highest classification", 1);
  return;
}
```

- Absent or `null`, `from` gives the default label's policy and classification; a value of another shape throws `IllegalArgumentException`.
- `compare(label, limit)` gives `LOWER`, `SAME`, `HIGHER` or `OUTSIDE`. `within` is true for `LOWER` and `SAME` only.
- **What is skipped:** an object whose label is above the limit, of **another policy** than the limit's, or with a classification outside its policy's order (`OUTSIDE` counts as above).
- **A limit `knows(limit)` does not know** (its classification is not in its policy's order) lets nothing through: say so in the plugin's status.
- The offering plugin applies the limit itself: ECore does not filter what a channel receives. Compare the label of what each item describes (an `Update`'s content, a sensor report's detections, a `DeclaredItem`'s `label`) ([channels.md](channels.md)).
- **Count every skip**, per link and reason, with `ConnectionRef.count` and in the status, and log it at most once a minute per link.

## In the manifest

- `permissions`: the plugin's own `plugin.<id>.<name>` permissions and the core ones it checks.
- `workspaces[].viewPermission` and `editPermission`: both must be listed in the plugin's `permissions`; ECore refuses the plugin otherwise.
- `settings`: each output link's `highestClassification`, as above.

See [manifest.md](manifest.md).

## Rules

- The server enforces every permission ([ADR-0022](../../adr/0022-server-side-login-and-no-login-mode.md)): every endpoint that changes something declares its permission, or checks the user itself before it changes anything. The browser only hides.
- Every `POST` endpoint names a permission or is marked `checksUserItself()`.
- Show a panel without the permission read only, with a hint; never treat hiding as protection.
- Every object and layer has a security label ([ADR-0007](../../adr/0007-common-data-model.md), [ADR-0020](../../adr/0020-object-and-layer-labels.md)); forward labels untouched.
- An output link sends nothing above its highest classification, of another policy, or with an unknown classification, and counts what it skips ([ADR-0037](../../adr/0037-links-and-output-channels.md)).

## Testing

**Java.** Call an endpoint as a user; one that `requires` a permission the user lacks answers `403`:

```java
var ctx = FakePluginContext.builder("simulator")
    .defaultLabel(SecurityLabel.of("NATO", "RESTRICTED"))
    .classifications(new Classifications(Map.of("NATO", Classifications.NATO)))
    .build();
FakeHttpExchange call = ctx.post("/routes/r1/start", body, User.of("u1", "Ann", Set.of()));
ctx.runUntilIdle();
assertThat(call.reply().status()).isEqualTo(403);
```

`FakeStore.applyAs(actor, user, change)` applies a user's change with ECore's checks: the permission (per workspace), then the layer lock. `User.noLoginUser()` has every permission.

**Web.** `createFakeContext({ user: createFakeUser({ permissions: ['objects.edit'] }) })`; without `user`, the fake gives the no-login user, who has every permission. `classifications` and `defaultLabel` are options too. See [testing.md](testing.md).

## See also

- [connections.md](connections.md) for endpoints, [channels.md](channels.md) for output channels, [objects.md](objects.md) for workspaces and change requests, [settings.md](settings.md)
- [ADR-0020](../../adr/0020-object-and-layer-labels.md), [ADR-0022](../../adr/0022-server-side-login-and-no-login-mode.md), [ADR-0037](../../adr/0037-links-and-output-channels.md), [ADR-0039](../../adr/0039-workspaces.md)
