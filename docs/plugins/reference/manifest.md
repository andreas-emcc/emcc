# The manifest (plugin.json)

Every plugin has one `plugin.json` in its folder, `plugins/<id>/plugin.json`. It says who the plugin is, which parts it has, what it declares (data types, fields, permissions, connections and more) and the JSON Schema of its settings. ECore reads it at start before any plugin code runs; the shell reads it before it loads the web part. This page describes every member of the schema [`plugin-manifest.schema.json`](../../../model/schemas/plugin-manifest.schema.json) (SDK 1.9.0), every settings hint, and the rules the schema cannot express.

## At a glance

The manifest is a JSON object. Members not listed here are refused (`additionalProperties: false`). It has a `server` part, a `web` part or both.

| Member | Type | Required | Section |
|---|---|---|---|
| [`id`](#id) | string | yes | Identity |
| [`name`](#name) | string | yes | Identity |
| [`version`](#version) | string | yes | Identity |
| [`sdkVersion`](#sdkversion) | string | yes | Identity |
| [`kind`](#kind) | enum | yes | Identity |
| [`category`](#category), [`icon`](#icon), [`properties`](#properties), [`required`](#required) | | no | Identity |
| [`server`](#server), [`web`](#web) | object | at least one | Parts |
| [`capabilities`](#capabilities) | array | no | Parts |
| [`dependsOn`](#dependson), [`provides`](#provides), [`requires`](#requires), [`uses`](#uses) | array | no | Dependencies and services |
| [`dataTypes`](#datatypes), [`fields`](#fields), [`fieldSets`](#fieldsets), [`relationKinds`](#relationkinds), [`channelKinds`](#channelkinds), [`symbolPalettes`](#symbolpalettes) | array | no | Data |
| [`permissions`](#permissions) | array | no | Access |
| [`internet`](#internet), [`connections`](#connections), [`network`](#network), [`folders`](#folders), [`compute`](#compute) | | no | Reach |
| [`workspaces`](#workspaces) | array | no | UI |
| [`settings`](#settings) | object | no | Settings schema |

There is no top-level `description` member. Panels, windows and top-bar items are not declared in the manifest either: the web part adds them at run time through `ctx.ui` ([panels-and-workspaces.md](panels-and-workspaces.md)).

Patterns used below:
- **plugin id:** `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`, at most 64 characters, never `emc2`.
- **type name:** `<namespace>.<name>`, each part lowercase words joined by hyphens, at most 129 characters.
- **semver:** `MAJOR.MINOR.PATCH` with an optional `-prerelease`, at most 64 characters.
- **JSON Pointer into the settings:** `^(/[A-Za-z0-9_-]+)+$`, at most 256 characters, e.g. `/links`.
- **name:** `^[a-z][a-z0-9]*(-[a-z0-9]+)*$`, at most 64 characters (field set ids, palette ids, channel kind names).

## Identity

### id
Plugin id, string, **required**, the plugin id pattern. Reserved: `emc2`, `emcc`, and every id that starts with `emc2-` or `emcc-` (the schema refuses them); `core` and every id that starts with `core-` (ECore refuses them at load, and `manifestProblem` in the build). An outside plugin's id starts with its vendor's prefix and a hyphen, e.g. `acme-tracks` ([rules.md](rules.md) R2). It is also the plugin's extension namespace (`extensions.<id>`) and the prefix of every id the plugin declares ([Naming](#naming)). The folder must have the same name.

### name
Display name, string, **required**, 1 to 128 characters.

### version
The plugin's version, semver, **required**. The server part and the web part share it ([ADR-0003](../../adr/0003-plugin-model.md)).

### sdkVersion
The SDK versions the plugin works with, string, **required**: an exact version, or a range with `^`, `~` or `>=`, npm semver semantics (pattern `^(\^|~|>=)?MAJOR.MINOR.PATCH(-pre)?$`). Write `^1.9.0` to run on 1.9.0 and later 1.x. ECore and the shell each refuse a plugin whose range their SDK does not satisfy. Shared test cases: [`sdk-version-matching.json`](../../../model/examples/sdk-version-matching.json).

### kind
Enum, **required**, no default:
- `map-view`: the map engine in the Map Pane. Only one is active; the shell refuses a second one's web part.
- `background-map`: provides a background map to the map view.
- `utility`: provides services to other plugins and places no objects.
- `general`: places and edits objects, or anything else.

### category
Enum, optional, default `general`: where the Settings workspace lists the plugin. Values, in the order shown: `data-links`, `geometoc`, `map-and-symbols`, `drawing`, `simulation`, `general`. Not the same as `kind`.

### icon
The plugin's icon in the Settings list, also for a plugin without a web part. String, optional, pattern `^[A-Z][A-Za-z0-9]*$`, at most 64 characters: a name from the web SDK's `PLUGIN_ICONS` ([`settings-form.ts`](../../../web/plugin-sdk/src/settings-form.ts)): `Anchor`, `Antenna`, `Bookmark`, `Cable`, `Car`, `Clock`, `Cloud`, `CloudSun`, `Compass`, `Crosshair`, `Database`, `Flag`, `Globe`, `Hexagon`, `Layers`, `List`, `Map`, `MapPin`, `Mountain`, `Navigation`, `Network`, `Plane`, `Play`, `Puzzle`, `Radar`, `Radio`, `Route`, `Satellite`, `Server`, `Shapes`, `Ship`, `Swords`, `Target`, `Truck`, `Users`, `Video`, `Waves`, `Waypoints`, `Wind`. The shell shows a name it does not know, or none, as a neutral icon.

### properties
Array of `ingoing` (consumes external data) and `outgoing` (sends data out), each once, optional. A plugin may be both.

### required
Boolean, optional, default `false`. `true`: the application does not start when this plugin fails to start.

## Parts

### server
The server part, object, optional (but `server` or `web` is required). One member:
- `entryClass` (**required**): the fully qualified name of the class that implements `dev.emcc.sdk.Plugin`, pattern `^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*\.[A-Z][A-Za-z0-9_]*$`, at most 256 characters, e.g. `dev.emcc.plugins.template.TemplatePlugin`.

### web
The web part, object, optional. Members:
- `entry` (**required**): the ES module the shell imports, relative to the plugin's web folder, e.g. `index.js`. Pattern `^(?!/)(?!.*\.\.)[A-Za-z0-9._/-]+$`, at most 256 characters.
- `css`: style sheets loaded before `entry`, same pattern, each once.
- `shared`: the shared library versions the web part was built against, `{ "<npm package>": "<semver>" }`. **The SDK's build plugin writes it into the built `plugin.json`; never write it by hand.** The shell refuses a web part built against a library it does not share, or against a newer version or another major version than its own ([build-and-install.md](build-and-install.md)).

### capabilities
The optional capabilities the plugin implements, array, optional, each once, at most 16. Only value: `temporal` (the user's time; the Java interface `dev.emcc.sdk.capability.Temporal` on the plugin class, the object `capabilities.temporal` in the web module). An unknown id fails the schema. Declaration and code must agree: every declared capability is implemented by at least one part, and a part implements only declared ones. ECore does not start a plugin that breaks this, and the Monitor names the capability ([ADR-0044](../../adr/0044-capabilities.md)).

## Dependencies and services

See [services-and-dependencies.md](services-and-dependencies.md) for how services are offered and used.

### dependsOn
Plugin ids that must start before this one, array of plugin ids, each once, optional. ECore leaves a plugin out when a dependency is not installed, is left out, did not start, or forms a cycle; the shell does not load its web part when a dependency's web part is not loaded.

### provides
Web service keys this plugin provides, array, each once, optional. A key is `emc2.<name>` (the SDK's own, e.g. `emc2.map-view`) or `<plugin-id>.<name>` with this plugin's own id. Pattern `^[a-z][a-z0-9]*(-[a-z0-9]+)*(\.[a-z][a-z0-9]*(-[a-z0-9]+)*)+$`, at most 128 characters. The shell refuses a plugin that lists another plugin's key here, and a web part's offer of a key not listed here.

### requires
Web service keys the plugin needs, same form, each once, optional. The shell activates the providers first, and does not load the plugin when no loaded plugin provides one; it reports why. ECore also starts the providers first.

### uses
Web service keys the plugin uses when a provider is there, same form, each once, optional. The shell activates loaded providers first and notes a missing one, but always loads the plugin; `ctx.services.get` on a missing key then rejects at once. **A key is never in both `requires` and `uses`** (the shell refuses the plugin).

## Data

See [objects.md](objects.md) for how objects use these declarations.

### dataTypes
The data types the plugin declares ([ADR-0023](../../adr/0023-data-types-and-data-sources.md)), array, each entry once, optional. ECore builds the available data types from them at start, plus the built-in `core.general`. Each entry:

| Member | Type | Required | Default, limits |
|---|---|---|---|
| `id` | type name | yes | `<plugin-id>.<name>`, e.g. `cot.cot` |
| `name` | string | yes | 1 to 128 characters, e.g. `CoT` |
| `description` | string | no | 1 to 1024 characters |
| `defaults` | object | no | `expiresAfterSeconds` (integer ≥ 1: objects without `time.expires` expire this long after `time.observed`), `fadeWhenExpired` (boolean: draw expired objects faded), `removeAfterExpirySeconds` (integer ≥ 0: ECore deletes expired objects this long after expiry). Absent: never expires, not faded, never removed. An admin's settings per data type override them |
| `fadeSetting` | JSON Pointer | no | to a stepped fade in the plugin's settings, e.g. `/detectionFade`; the map view then draws the type at the stepped opacity instead of the expiry fade. The value's form: `{ "on": boolean, "fromSeconds": 0–86400, "stepPercent": 1, 2, 4, 5, 10, 20, 25 or 50, "invisibleAtSeconds": 1–86400 }`, all required. Missing, off or of another form: no stepped fade |
| `fieldSets` | array | no | ids of field sets this plugin declares, each once, at most 8. The object store adds them to a `core.symbol` object of this type on create and on a change of data type |
| `manual` | boolean | no | default `true`. `false`: editors leave the type out of their data type choice, except for an object that has it |
| `sensorReport` | boolean | no | default `false`. `true`: the map view draws these objects with the sensor report symbol instead of their APP-6 symbol |

### fields
The fields the plugin declares in its own namespace ([ADR-0038](../../adr/0038-declared-plugin-fields.md)), so editors show them with labels and units, and other plugins may set those editable by others. Array, optional, at most 256, each `name` once. A value is stored in `extensions.<plugin-id>.<name>`: a string for `text` and `choice`, a number for `number` and `integer`, `true` or `false` for `boolean`.

| Member | Type | Required | Default, limits |
|---|---|---|---|
| `name` | string | yes | `^[a-z][a-zA-Z0-9]*$`, at most 64 characters |
| `type` | enum | yes | `text`, `number`, `integer`, `choice`, `boolean` |
| `label` | string | yes | 1 to 128 characters, e.g. `Callsign` |
| `description` | string | no | 1 to 1024 characters |
| `unit` | string | no | number and integer only; 1 to 16 characters; an SI unit where one exists (`m`, `m/s`, `s`), `deg` for angles |
| `minimum`, `maximum` | number | no | number and integer only |
| `maxLength` | integer | no | text only; 1 to 4096; default 1024 |
| `required` | boolean | no | the value may not be removed (set to null); it does not demand the field on existing objects |
| `choices` | array | choice only, and required there | 1 to 256 `{ "value": 1–64 characters, "label": 1–128 characters }` |
| `editableByOthers` | boolean | no | default `false`: only the plugin itself sets it |
| `dataTypes` | array | no | type names, at least 1, each once. Editors ignore it; a data type names its field sets instead. Leave it out |

### fieldSets
Named groups of the plugin's own declared fields ([ADR-0050](../../adr/0050-field-sets.md)), e.g. the fields a protocol uses. Array, each once, optional, at most 32. Each entry: `id` (**required**, the name pattern; full id `<plugin-id>.<id>`, e.g. `cot.unit`), `label` (**required**, 1 to 128 characters: the group's heading in editors), `fields` (**required**, 1 to 256 names of the plugin's own `fields`, each once, in the order editors show them).

### relationKinds
The kinds of relations between objects the plugin declares ([ADR-0051](../../adr/0051-relations-between-objects.md)). Array, each once, optional, at most 16. Each entry:
- `id` (**required**): type name `<plugin-id>.<name>`, e.g. `gmti.pairing`.
- `label` (**required**): 1 to 64 characters, shown at the user's switch.
- `line` (**required**): how the map view draws the line to the other object: `strokeColor` (**required**, `#RRGGBB`), `strokeWidth` (0.5 to 10 screen pixels, default 1), `strokeDash` (`solid`, `dash`, `dot`; default `solid`), `arrowhead` (`none`, `end`; default `none`), `strokeColorSetting` (a JSON Pointer to a `#RRGGBB` string in the plugin's settings; `strokeColor` is used while it is missing or not a colour).
- `defaultOn`: boolean, default `false`: the default of the user's switch.

### channelKinds
Channel kinds the plugin declares, each with a JSON payload ([ADR-0059](../../adr/0059-uav-simulation-plugin.md)). Array, optional, 1 to 16. A kind's id is `<plugin-id>.<name>`, e.g. `fmv.camera-pose`. The plugin's own output channels may take them (`ChannelSpec.declaredKinds`); other plugins send `DeclaredItem`s of them. ECore checks each item's size (at most 64 KiB) and its payload against the schema at send ([channels.md](channels.md)). Each entry, all **required**:
- `name`: the name pattern; each name once.
- `title`: 1 to 64 characters, e.g. `Camera pose`.
- `description`: 1 to 512 characters: what one item carries and when it is sent.
- `payload`: a JSON Schema (draft 2020-12) of an object (`"type": "object"`), **self-contained**: every `$ref` in it starts with `#`.

### symbolPalettes
Symbol palettes the plugin offers the Symbols panel of `draw-symbols`. Array, optional, 1 to 8, each `id` once. Each entry, all **required**:
- `id`: the name pattern; full id `<plugin-id>.<id>`.
- `name`: 1 to 64 characters, shown in the panel's drop-down.
- `symbols`: 1 to 2000 `{ "standard", "code", "label"? }`, in the order shown. `standard` is `APP-6B` (`code` 15 characters `^[A-Z0-9*-]{15}$`), `APP-6D` (`^1[0-2][0-9]{18}$`) or `APP-6E` (`^1[34][0-9]{18}([0-9]{10})?$`); `label` (1 to 128 characters) is shown instead of the catalogue's name.

## Access

### permissions
The permissions the plugin declares or checks ([permissions-and-labels.md](permissions-and-labels.md)). Array, each once, optional. Each a string, pattern `^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$`, at most 128 characters. A plugin's own permission is `plugin.<id>.<name>` (Java `Permissions.ofPlugin(id, name)`); it also lists the core permissions it checks, e.g. `objects.edit`, `layers.edit`, `settings.admin`. The server part checks them on its endpoints; the permissions of a declared workspace are enforced by ECore.

## Reach

See [connections.md](connections.md) for the calls behind these declarations.

### internet
Declares that the server part reaches hosts outside the emcc server, why, and its default hosts ([ADR-0030](../../adr/0030-offline-first-configurable-hosts.md)). Object, optional; absent: none. A declaration shown in the Monitor, not an allow-list: ECore does not check the hosts. Members, both **required**:
- `hosts`: the hosts the plugin contacts with its default settings, without scheme, port or path; lowercase, at least one dot, each at most 253 characters, each once. `[]` when every outside host comes from settings an admin fills in.
- `reason`: 1 to 512 characters: why, and in which environments.

### connections
The server part's own connections, opened in connection tasks ([ADR-0036](../../adr/0036-connection-tasks.md)). Array, optional, at least 1 entry when present. A declaration shown in the Monitor, not an allow-list. Each entry:
- `kinds` (**required**): 1 or more of `tcp-client`, `tcp-server`, `udp`, `multicast`, `other`, each once; one link uses one of them.
- `direction` (**required**): `in`, `out` or `both`.
- `settings`: a JSON Pointer to the links in the settings, e.g. `/links`.
- `reason` (**required**): 1 to 512 characters.

### network
For the deprecated listener API only; a new plugin uses `connections`. Object, optional: `endpoints` (**required**, 1 or more JSON Pointers into the settings, each once, each to an object with `host` and `port` or to an array of them) and `reason` (**required**, 1 to 512 characters). A listener connects only to the endpoints found there in the current settings.

### folders
The local folders the server part reads, through the SDK's `LocalFolder` only (`context.folders().folder(id)`; [ADR-0049](../../adr/0049-terrain-analysis.md)). Array, each once, optional, at most 8. Each entry, all **required**:
- `id`: `^[a-z][a-z0-9-]*$`, at most 64 characters.
- `setting`: a JSON Pointer to a property of type `string` in the settings, e.g. `/heightDataFolder`. Its value is an absolute path, or a path that starts with `%emcc%/` (or `%emcc%\`), resolved below the folder the server was started in. Empty: not set.
- `reason`: 1 to 256 characters, shown in the Monitor.

### compute
The compute threads the server part may run at once, at most ([ADR-0064](../../adr/0064-compute-tasks.md); [workers.md](workers.md)). Object, optional; absent: none. Members, both **required**: `threads` (integer 1 to 64) and `reason` (1 to 512 characters, shown in the Monitor). An admin may lower the number in the plugin's Settings entry, or switch it off with 0; ECore also caps the compute tasks of all plugins together.

## UI

### workspaces
The workspaces the plugin declares, shown as tabs next to View to users with their `viewPermission` ([ADR-0039](../../adr/0039-workspaces.md); [panels-and-workspaces.md](panels-and-workspaces.md)). Array, each once, optional, at most 16. Each entry:
- `id` (**required**): type name `<plugin-id>.<name>`, e.g. `simulator.simulation`.
- `name` (**required**): 1 to 64 characters, the tab's name.
- `viewPermission` (**required**): who sees the workspace, its layers and their objects.
- `editPermission` (**required**): who changes its layers and their objects, instead of `objects.edit` and `layers.edit`.
- `order`: integer, default 100; lower comes first after View.

## Settings schema

### settings
The JSON Schema (draft 2020-12) of the plugin's settings ([settings.md](settings.md)). Object, optional; when present it has `"type": "object"` and `properties`. Users with `settings.admin` change the values at run time in the plugin's Settings entry, in a form the shell generates from this schema ([ADR-0031](../../adr/0031-workspace-settings-list-and-setups.md)); ECore validates every change against it before the plugin sees it.
- Give every top-level setting a `default`. The defaults are the plugin's first settings, and ECore refuses the plugin when they do not validate.
- Every setting the form shows has a `title` and a `description` ([the texts rule](#the-texts-rule)).
- **The settings reach every logged-in browser, so they never hold secrets.** A TLS credential is named, never included ([Hint `kind`: `tls-credential`](#hint-kind-tls-credential)).
- The schema is self-contained: `$ref` and `$dynamicRef` start with `#`, there is no `$id`, and `$schema`, if present, is `https://json-schema.org/draft/2020-12/schema`.
- `x-emc2` carries the hints below. It is an annotation: validation does not change.

## Settings hints

A settings schema may carry `"x-emc2": { ... }` on any of its schemas. Its keys: `kind`, `allowNew`, `enabledWhen`, `visibleWhen`, `groups`, `hint`, `item`, `width`, `unit`; every key is optional, and any other key is wrong. The shell's form ([`schema.ts`](../../../web/shell/src/ui/settings/schema.ts), with the SDK's rules in [`settings-form.ts`](../../../web/plugin-sdk/src/settings-form.ts)) reads them; ECore ignores them. `settingsHintsProblem` checks their shape ([below](#the-hints-check)).

### Hint `kind`: `layer`
- **Where:** on an object `{ "id"?: string, "name": string }`, or on the item schema of an array of such objects.
- **Value:** `"layer"`.
- **The form:** a layer picker; on an array's items, a set of picked layers. A "+" button creates a layer at once and saves it picked, with its id. The Java SDK reads the value as `LayerChoice`.
```json
"targetLayer": { "type": "object", "properties": { "id": { "type": "string" }, "name": { "type": "string" } },
  "x-emc2": { "kind": "layer" } }
```

### Hint `allowNew`
- **Where:** beside `"kind": "layer"`.
- **Value:** boolean, default `true`.
- **The form:** `false` hides the "+" button: existing layers only.
```json
"items": { "type": "object", "properties": { "id": { "type": "string" }, "name": { "type": "string" } },
  "x-emc2": { "kind": "layer", "allowNew": false } }
```

### Hint `kind`: `colour`
- **Where:** on a string with the pattern `^#[0-9A-Fa-f]{6}$`.
- **Value:** `"colour"`.
- **The form:** the browser's colour picker beside the text; both edit the same value. The field is short.
```json
"colour": { "type": "string", "pattern": "^#[0-9A-Fa-f]{6}$", "default": "#1E90FF",
  "x-emc2": { "kind": "colour" } }
```

### Hint `kind`: `tls-credential`
- **Where:** on a string without `enum` or `pattern` ([ADR-0062](../../adr/0062-tls-credentials-for-connection-tasks.md)).
- **Value:** `"tls-credential"`.
- **The form:** a select of "(the link's name)" (the empty value: the credential named like the link), the names of the TLS credentials the server's local configuration holds, sorted, and, for a stored name the server lacks, "<name> (missing)". Only names: never a path, a password or a certificate is in the settings or the browser.
```json
"tlsCredential": { "type": "string", "default": "",
  "x-emc2": { "kind": "tls-credential" } }
```

### Hint `enabledWhen`
- **Where:** on a property of an object (also an array's item schema).
- **Value:** `{ "property": <a sibling property in the same object>, "in": [1 to 32 strings, numbers or booleans] }`, no other keys.
- **The form:** while the sibling's value is not in `in`, the field is greyed and read only; its value is kept, saved and validated. An absent sibling counts as its `default`; with neither, the field is enabled. A condition the form cannot use (no such sibling, the field itself, no usable value) is ignored, and the shell logs a warning in the browser console.
```json
"tlsCredential": { "type": "string",
  "x-emc2": { "enabledWhen": { "property": "tls", "in": [true] } } }
```

### Hint `visibleWhen`
- **Where, value:** as `enabledWhen`.
- **The form:** hides the field unless the sibling's value is in `in`; the value is kept, saved and validated. Same rules for an absent sibling and an unusable condition (the field shows). With both, the field is hidden first, then greyed. A setting needed only in some cases is required by the schema's own `if`/`then`.
```json
"host": { "type": "string",
  "x-emc2": { "visibleWhen": { "property": "mode", "in": ["tcp-client", "udp"] } } }
```

### Hint `groups`
- **Where:** on an object: the settings page, a nested object directly on it, an array's item schema, or a nested object directly on that. Not deeper.
- **Value:** at most 32 `{ "id", "label", "properties", "description"?, "folded"?, "advanced"? }`: `id` unique, `label` not empty, `properties` 1 or more of the object's own properties, each in at most one group, `description` 1 to 512 characters, `folded` and `advanced` booleans.
- **The form:** sections in this order: the properties in no group, without a heading; the groups that are not advanced, as declared, each `description` under its heading; each nested object in no group, under its `title`; the advanced groups, folded. `folded` starts a group folded. Every group needs a `description` ([the texts rule](#the-texts-rule)).
```json
"x-emc2": { "groups": [{ "id": "timing", "label": "Timing", "description": "When a quiet link reconnects.",
  "properties": ["idleSeconds"], "advanced": true }] }
```

### Hint `hint`
- **Where:** on any property.
- **Value:** string, 1 to 80 characters.
- **The form:** the line under the field; the `description` goes behind an info button. Without a `hint`, a `description` of up to 80 characters is the hint.
```json
"host": { "type": "string",
  "x-emc2": { "hint": "A host name or address" } }
```

### Hint `width`
- **Where:** on any property.
- **Value:** `"short"` or `"full"`.
- **The form:** short fields stand side by side; a full one takes the row. Default: short for a number, integer, boolean, `enum`, colour, or string with `maxLength` 24 or less; full otherwise. Objects and lists always take the row.
```json
"callsign": { "type": "string", "maxLength": 64,
  "x-emc2": { "width": "short" } }
```

### Hint `unit`
- **Where:** on a `number` or `integer` property.
- **Value:** string, 1 to 8 characters, e.g. `s`, `m`, `%`.
- **The form:** shown after the number.
```json
"idleSeconds": { "type": "integer", "minimum": 0,
  "x-emc2": { "unit": "s" } }
```

### Hint `item`
- **Where:** on an array whose items are objects with properties.
- **Value:** `{ "name", "noun", "state"?, "columns"?, "id"? }`:
  - `name`: a string property of the items; its value names the row and the side form's head; while it is empty the form says "New link", or "Link 3" for a saved item.
  - `noun`: a lowercase letter, then lowercase letters, spaces and hyphens, at most 32 characters; the form says "Add link", "Delete link?", "New link".
  - `state`: a boolean property of the items, shown as an On or Off chip.
  - `columns`: up to 6 properties of the items, each once, shown after the name. Default: up to 3 short properties, in schema order.
  - `id`: a string property of the items that holds each item's **stable id**, a lowercase UUID v7. Not the name, the state or a column, and in none of the items' groups. The form makes it with a new item and does not show it; ECore fills in a missing or empty one when it loads the settings and at every change, before it validates, and refuses a change that puts two items of one id in a list. A rename keeps the id. Declare the property `"type": "string", "readOnly": true`; it may be in the items' `required`.
- **The form:** a table with a side form; each item has its own Save. An array of objects without `item` is a table too, its rows named by the items' or the list's `title`.
```json
"links": { "type": "array", "items": { "type": "object", "properties": { "...": {} } },
  "x-emc2": { "item": { "name": "name", "noun": "link", "state": "enabled", "columns": ["host", "port"], "id": "id" } } }
```

### Standard keywords the form reads
`title` (the label; else the key in words), `description`, `default`, `enum` (a choice), `minimum`, `maximum`, `minLength`, `maxLength`, `pattern`, `minItems`, `maxItems`, `required`, and `examples[0]`, which the form names when a value breaks the `pattern`. `readOnly` has no meaning for the form. A schema with `$ref`, `oneOf`, `anyOf`, `not`, `const` and similar gets a JSON text box for that value. An object's `if`/`then`/`else`, or an `allOf` of only these, is left to the server's validation.

## The texts rule

`settingsTextProblem(schema)` (web SDK, [`settings-form.ts`](../../../web/plugin-sdk/src/settings-form.ts); [ADR-0060](../../adr/0060-settings-and-credentials-files.md)) returns the first setting or group that does not explain itself, as `"<JSON pointer>: <problem>"`, or `null`. It checks:
- every property the form shows, at every depth, inside an array's `items` too, has a `title` of 1 to 64 characters and a `description` of 1 to 512 characters;
- every group in `x-emc2.groups` has a `description` of 1 to 512 characters.

Exempt: the property an `item.id` names, and the properties inside a field whose own `x-emc2` has a `kind` (a layer's `id` and `name`). The settings object itself needs no title. It is a build rule: the plugin's manifest guard runs it ([Testing](#testing)). ECore and the shell do not; a plugin without the texts still loads, and the form shows the property's key.

## The hints check

`settingsHintsProblem(schema)` (web SDK, same file) returns the first wrong `x-emc2`, as `"<JSON pointer>/x-emc2: <problem>"`, or `null`. It checks:
- `x-emc2` is an object with no key outside the list above;
- `kind` is `layer`, `colour` or `tls-credential`; `layer` sits on an object of `{id?, name}`; `colour` on a string with the pattern `^#[0-9A-Fa-f]{6}$`; `tls-credential` on a string without `enum` or `pattern`;
- `allowNew` is a boolean, and only with `kind` `layer`;
- `enabledWhen` and `visibleWhen` have only `property` and `in`; `property` names a sibling (when the hint is under `properties`), never the field itself; `in` has 1 to 32 strings, numbers or booleans;
- `groups` sit on an object with `properties`, no deeper than one nested object below the page or an item schema; at most 32; each has a unique `id`, a `label`, only known keys, a `description` of 1 to 512 characters if any, boolean `folded` and `advanced`, and 1 or more of the object's own properties, each in one group only;
- `hint` is 1 to 80 characters;
- `item` sits on an array of objects with properties; `name` is a string property and `state` a boolean property of the items; `noun` matches `^[a-z][a-z -]{0,31}$`; `columns` has at most 6 properties of the items, each once; `id` is a string property, not the name, the state or a column, and in none of the items' groups;
- `width` is `short` or `full`;
- `unit` is 1 to 8 characters, on a number or integer.

## Naming

Many names derive from the plugin id. With the id `buoy-feed`:

| What | Form | Example | Checked by |
|---|---|---|---|
| Folder | `plugins/<id>/` | `plugins/buoy-feed/` | ECore: the folder name equals `id` |
| Extension namespace | `extensions.<id>` | `extensions.buoy-feed.station` | the object store |
| Data type | `<id>.<name>` | `buoy-feed.buoy` | ECore |
| Declared field | `<name>` in `extensions.<id>` | `station` | — |
| Field set | `<id>.<set id>` | `buoy-feed.buoy` | ECore, the object store |
| Relation kind, workspace | `<id>.<name>` | `buoy-feed.nearest` | ECore |
| Channel kind | `<id>.<name>` | `buoy-feed.wave-sample` | ECore |
| Symbol palette | `<id>.<palette id>` | `buoy-feed.buoys` | — |
| Own service key | `<id>.<name>` | `buoy-feed.readings` | the shell |
| Own permission | `plugin.<id>.<name>` | `plugin.buoy-feed.replay` | convention (`Permissions.ofPlugin`) |
| Topic | `<id>.<name>` | `buoy-feed.report-received` | the SDK |
| Endpoints | `/api/plugins/<id>/…` | `/api/plugins/buoy-feed/status` | ECore |
| Web files | `/plugins/<id>/web/<file>` | `/plugins/buoy-feed/web/index.js` | ECore |
| Logger, log level setting | `plugin.<id>`, `logging.level.plugin.<id>` | `logging.level.plugin.buoy-feed=DEBUG` | — |
| Java package | `dev.emcc.plugins.<id without hyphens>` | `dev.emcc.plugins.buoyfeed` | the Java test kit's `PluginRules` |
| npm package of the web part | `@emc2/plugin-<id>` | `@emc2/plugin-buoy-feed` | npm workspaces |

Not prefixed: the plugin's settings keys (its own property names; ECore keeps the settings per plugin), its plugin documents (keys `[a-z0-9][a-z0-9.-]*`, at most 128 characters, in the plugin's own namespace) and its users' documents (in the plugin's namespace as well).

## Rules

The schema cannot express these. ECore or the shell refuses a plugin that breaks one, unless stated.
- The folder name equals `id`. `core` and ids starting with `core-` are ECore's; `emc2` is the SDK's. Folders whose names start with `_` or `.` are skipped.
- `sdkVersion` must be satisfied by ECore's SDK version and by the shell's.
- Every `dataTypes[].id`, `relationKinds[].id` and `workspaces[].id` starts with the plugin's own id and a dot, and comes once.
- Every `fields[].name`, `fieldSets[].id`, `symbolPalettes[].id`, `folders[].id` and `channelKinds[].name` comes once.
- A field set names only the plugin's own declared `fields`. A data type's `fieldSets` names only sets of the same manifest.
- A workspace's `viewPermission` and `editPermission` are among the plugin's own `permissions`.
- A channel kind's `payload` is self-contained (every `$ref` starts with `#`) and compiles. A plugin's output channel takes only kinds its own manifest declares.
- A key in `provides` starts with `emc2.` or with the plugin's own id and a dot. `requires` and `uses` may name any key, but never the same key in both.
- Every `dependsOn` id is installed, and there is no cycle through `dependsOn`, `requires` and `uses`.
- The settings schema compiles, refers only within itself, and its defaults validate against it.
- A folder's `setting` points, through `properties`, to a property of type `string`. A `network` pointer leads to an object with `host` and `port`, or to an array of them.
- `capabilities` matches what the parts implement.
- `web.entry` and `web.css` stay inside the web folder (no `.` or `..` segments).
- In a stepped fade, `invisibleAtSeconds` is above `fromSeconds`. A value that breaks it gives no stepped fade; the settings schema cannot say it, so its form should.
- An empty optional array (e.g. `"dataTypes": []`) means the same as a missing one; omit it.
- Hosts and ports come only from settings an admin sets, never from a browser request, a message or an object's data. A listening connection binds to loopback unless an admin chooses otherwise. Every function still works offline.

## Example

A small, complete manifest. It passes `manifestProblem`, `settingsTextProblem` and `settingsHintsProblem`, and keeps the rules above.

```json
{
  "id": "buoy-feed",
  "name": "Buoy feed",
  "version": "0.1.0",
  "sdkVersion": "^1.9.0",
  "kind": "general",
  "category": "data-links",
  "icon": "Anchor",
  "properties": ["ingoing"],
  "server": { "entryClass": "dev.emcc.plugins.buoyfeed.BuoyFeedPlugin" },
  "web": { "entry": "index.js" },
  "permissions": ["plugin.buoy-feed.replay"],
  "dataTypes": [
    {
      "id": "buoy-feed.buoy",
      "name": "Buoy",
      "description": "A buoy's last report.",
      "defaults": { "expiresAfterSeconds": 600, "fadeWhenExpired": true },
      "fieldSets": ["buoy"],
      "manual": false
    }
  ],
  "fields": [
    { "name": "station", "type": "text", "label": "Station", "maxLength": 32 },
    { "name": "waveHeight", "type": "number", "label": "Wave height", "unit": "m", "minimum": 0, "maximum": 30 }
  ],
  "fieldSets": [{ "id": "buoy", "label": "Buoy", "fields": ["station", "waveHeight"] }],
  "connections": [
    { "kinds": ["udp"], "direction": "in", "settings": "/links", "reason": "Receives buoy reports, one per datagram, on the ports the links name." }
  ],
  "settings": {
    "type": "object",
    "properties": {
      "links": {
        "title": "Links",
        "description": "The UDP ports buoy reports arrive on, one entry per link.",
        "type": "array",
        "default": [],
        "maxItems": 8,
        "x-emc2": { "item": { "name": "name", "noun": "link", "state": "enabled", "columns": ["port"], "id": "id" } },
        "items": {
          "type": "object",
          "required": ["name", "port"],
          "x-emc2": {
            "groups": [{ "id": "timing", "label": "Timing", "description": "When a quiet link counts as down.", "properties": ["quietSeconds"], "advanced": true }]
          },
          "properties": {
            "id": { "title": "Id", "description": "The link's stable id; a rename keeps it.", "type": "string", "readOnly": true },
            "name": { "title": "Name", "description": "Lowercase words joined by hyphens; also the data source of what the link receives.", "type": "string", "pattern": "^[a-z][a-z0-9]*(-[a-z0-9]+)*$", "maxLength": 64 },
            "enabled": { "title": "Enabled", "description": "Whether the plugin runs this link.", "type": "boolean", "default": true },
            "port": { "title": "Port", "description": "The local UDP port to receive on.", "type": "integer", "minimum": 1, "maximum": 65535 },
            "quietSeconds": { "title": "Quiet after", "description": "A link that receives nothing for this long shows as down; 0: never.", "type": "integer", "minimum": 0, "maximum": 3600, "default": 300, "x-emc2": { "unit": "s" } }
          }
        }
      },
      "colour": {
        "title": "Colour",
        "description": "The colour of the buoys' wave height labels.",
        "type": "string",
        "pattern": "^#[0-9A-Fa-f]{6}$",
        "default": "#1E90FF",
        "x-emc2": { "kind": "colour", "hint": "# and six hexadecimal digits" }
      }
    }
  }
}
```

The template's manifest, [`plugins/_template/plugin.json`](../../../plugins/_template/plugin.json), is a larger example with TCP and UDP links, a TLS credential and `visibleWhen`.

## Testing

Keep the template's manifest guard, [`web/test/manifest.test.ts`](../../../plugins/_template/web/test/manifest.test.ts), when you copy the template. `manifestProblem` (from `@emc2/plugin-sdk/build`, Node only) validates the manifest against the schema of the SDK you build against, and names at most ten problems with their JSON Pointers; it throws when the schemas are missing or of another SDK version. It does not check the rules above.

```ts
import { settingsHintsProblem, settingsTextProblem } from '@emc2/plugin-sdk';
import { manifestProblem } from '@emc2/plugin-sdk/build';
import manifest from '../../plugin.json' with { type: 'json' };

it('is valid', () => { expect(manifestProblem(manifest)).toBeNull(); });
it('explains every setting', () => { expect(settingsTextProblem(manifest.settings)).toBeNull(); });
it('has well-formed hints', () => { expect(settingsHintsProblem(manifest.settings)).toBeNull(); });
```

See [testing.md](testing.md) for the other guards.

## See also
- [settings.md](settings.md): the generated form, the plugin's own settings panel, settings at run time
- [services-and-dependencies.md](services-and-dependencies.md), [objects.md](objects.md), [connections.md](connections.md), [channels.md](channels.md), [panels-and-workspaces.md](panels-and-workspaces.md)
- [build-and-install.md](build-and-install.md): the build that writes `web.shared`
- [rules.md](rules.md): every rule a plugin keeps
- [ADR-0003](../../adr/0003-plugin-model.md): the plugin model
