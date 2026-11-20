# ADR-0038: Declared plugin fields, set from any editor

- Status: Accepted (owner, 2026-10-22)
- Date: 2026-10-22
- Deciders: Owner (advised by the ACA; the owner's answer Q8 in `docs/architecture/m3-simulator-decisions.md`)
- Extends: ADR-0007 (common data model: blind-forwarded extensions) and ADR-0018 (change protocol)

## Context
Plugins keep their own data in an object's `extensions`, under their plugin id. Only the owning plugin writes its namespace; everyone else forwards it untouched (ADR-0007). The object store enforces this: on an update it applies only the requesting plugin's own namespace and keeps every other namespace as stored, whatever the request contains, because blind forwarding puts other plugins' data, possibly older, into every request (ADR-0018 point 4). On a create, all namespaces are accepted.

For M3 the owner wants editors to offer other plugins' fields (owner, 2026-10-22): when a symbol is created, the editor first offers the core fields, and a "+" button adds fields from other plugins' data models, for example what CoT needs. The simulator's events change such fields too (A12), and an output channel names the fields its protocol uses (ADR-0037). Plugins announce their fields in a standard way through the SDK. Today nothing describes a plugin's extension, so no editor can show it, and the store would ignore the values on an update.

The owner chose that any editor may write another plugin's declared, user-editable fields (Q8).

## Decision
1. **A plugin declares its fields in its manifest**, as it declares its data types (ADR-0023), so that ECore knows them at start-up and web-only plugins can declare them too. Each field has:
   - a name: a top-level key in the plugin's own namespace, `extensions.<plugin-id>.<name>`;
   - a type: text, number, integer, choice (with its values and their labels) or yes/no;
   - a label, an optional description and, for numbers, a unit (values are stored in SI units, as the core fields);
   - limits: minimum and maximum, the longest text, whether it is required;
   - **editable by others:** whether users may set it through any plugin's editor;
   - optionally the data types it belongs to; without them it belongs to every object.
2. **A change request names the declared fields it sets.** Next to the object's content, a request may carry a list of field values to set, each as plugin id, name and value. The store applies them on create and on update, **after checking them against the declaration**: the field exists, is editable by others (or the requester is its own plugin), and the value has the declared type and limits. A request with a field that fails is rejected with the reason, as other invalid requests are.
3. **Blind forwarding is unchanged.** Other namespaces carried in the object's content are still ignored on an update (ADR-0018). Only the named fields change, so an editor's older copy of another plugin's data cannot overwrite newer values. The owning plugin still writes its whole namespace on its own updates (ADR-0018); it builds them from the current object, so that a value set by others stays unless the plugin means to change it (as `cot` overwrites with the next event from its source, last write wins).
4. **The permissions are those of the change itself:** a user's request needs `objects.edit` as any edit does (overview 4.4). A server part may set declared fields too, for example the simulator's events.
5. **Editors show declared fields with their labels and units**, grouped by plugin: the core fields first, then a "+" that adds the fields of the object's data type and of other plugins. Where an object's fields are shown, declared fields show with their labels.
6. **When a plugin is removed**, its declarations go with it; its fields stay on the objects and are forwarded, but no editor offers them. ECore does not check stored values when it loads them (as for data types, ADR-0023 point 6).

## Alternatives considered
- **The owning plugin writes the value,** asked by the editor through a message: the namespace rule would stay as it is, but every plugin with fields needs a server part and must handle that message, and an edit would take two steps (owner, Q8).
- **Apply declared fields found anywhere in the request's extensions:** no new request element, but every editor's older copy of another plugin's data would overwrite newer values, which is why ADR-0018 ignores foreign namespaces.
- **A JSON Schema per plugin namespace:** the most expressive, but editors could not draw a form for every schema, and limits on a nested structure are hard to explain to users. Flat, typed fields cover the need.

## Consequences
- **The rule changes:** a plugin writes its own namespace, and other plugins' declared fields that are editable by others, by naming them in a change request; everything else is forwarded untouched. `CLAUDE.md` section 4 and overview 4.4 and 4.6 say so (the owner approves `CLAUDE.md` at the merge).
- **Data model 1.2.0 and SDK 1.2.0 (PDA, through a change request):** the manifest's field declarations; the list of fields to set in the change request, in both SDKs and in the live picture protocol; the declared fields in the plugin context, so that editors can list them; a shared editor component for declared fields in the web SDK.
- **ECore (CDA):** builds the list of declared fields from the manifests, checks and applies named fields in the object store, and rejects invalid ones with the reason.
- **Plugins:** `draw-symbols` adds the "+" to its create and edit dialog; the simulator uses the same component (ADR-0040); `cot` declares the fields its protocol uses, as its brief says.
- **ITA:** a field set through another plugin's editor survives a later update by a third plugin that carries an older copy; an invalid value is rejected with its reason.
