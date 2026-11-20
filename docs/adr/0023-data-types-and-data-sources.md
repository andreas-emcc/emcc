# ADR-0023: Objects carry a data type and a data source; plugins declare the data types

- Status: Accepted (owner, 2026-10-10)
- Date: 2026-10-10
- Deciders: Owner (advised by the ACA)
- Extends: ADR-0007 (common data model)

## Context
Behaviour such as expiry and fading will be configured per **type of incoming data**: CoT, friendly force tracking (FFT), friendly force information (FFI) and so on (owner, 2026-10-10).
- **Third-party plugins** must be able to add such types without any change in emc2's code.
- **The type also tells which plugin's extension applies** to an object.
- **A plugin may receive several incoming streams**, and it must be visible which stream an object came from.

Data model v0 already has a field `type`, but it means something else: what the object is on the map (`core.symbol`, `core.multipoint`, `core.shape`). The object's audit (`meta.created.by.system`) records who made each change, not what kind of information the object is.

## Decision
1. **Every map object has a `dataType`**: the kind of information it is, for example `cot-in.cot`. It is required from data model 1.0.0.
   - Names are `<plugin-id>.<name>`, like plugin-defined object types. ECore's own data types are `core.<name>`.
   - A plugin may declare data types only in its own namespace (owner: prefixes make third-party development easier).
2. **Plugins declare their data types in their manifest** (`dataTypes`, SDK v1): an id, a display name, a description, and default settings such as expiry and fading.
   - ECore builds the list of available data types at start-up from the manifests of the loaded plugins, before any plugin code runs.
   - The manifest also works for web-only plugins. A new data type needs no change in emc2's code.
3. **ECore has one built-in data type, `core.general`**, which is always available.
4. **Any plugin may create objects of any available data type**, not only its own.
   - Drawing plugins let the user pick one, with `core.general` as the default (a setting).
   - A user may change an object's `dataType` through a normal change request.
5. **Every map object has a `dataSource`**: where the object came from. It is required from data model 1.0.0 and set when the object is created.
   - `manual` for objects that users draw.
   - For incoming data, the name of the stream (the "contract") the plugin received it on, as configured in that plugin, for example `tak-north`. A plugin with several incoming streams uses one data source per stream.
   - `dataSource` cannot change after creation. The audit (`meta.created.by`, `meta.modified.by`) and the external identity (`meta.externalRef`) stay as they are.
6. **ECore checks `dataType` against the available list when an object is created, or when its data type changes.** It never checks when it loads stored data.
   - An object whose data type is no longer declared, because its plugin was removed, keeps it and gets the default behaviour.
   - ECore logs a warning once per such data type, and the monitor view shows it.
7. **Settings per data type:** expiry, fading and similar behaviour are configured per data type in the settings view (ECore settings). The defaults come from the declaring manifest.
   - **Groups** come later (owner): for example all CoT data types sharing settings, each with its own exceptions.
   - Groups will be a compatible addition (an optional group in the declaration).
8. **Extensions stay keyed by plugin id** (ADR-0007, ADR-0018, unchanged). The extension that belongs to a data type is the namespace of the plugin that declares it, i.e. the data type's prefix. There it keeps the type's own details.
9. Layers have no data type.

## Alternatives considered
- **Reusing `type`:** mixes what an object is on the map with what kind of information it is. A CoT report and a drawn unit can both be `core.symbol`.
- **A closed list in the data model:** every new kind of data would be a model change, so third-party plugins could not add one (owner).
- **Global names without a prefix:** two plugins could declare the same name with different meanings. Shared settings for related types come with groups instead (owner).
- **Registration by a call when a plugin activates:** a web-only plugin activates in each browser, never on the server, and ECore needs the list before plugin code runs.
- **`manual` as a data type:** mixes what the information is with where it came from (owner). That is what `dataSource` is for.

## Consequences
- **Data model 1.0.0 (PDA):** `dataType` and `dataSource` are required on map objects.
  - A name pattern is needed for `dataSource`.
  - Stored M0 data gets `core.general` and `manual` once, through the persistence manager's migration of the major version.
- **SDK v1 (PDA):**
  - the manifest field `dataTypes`;
  - the list of available data types for plugins, in Java and in the browser. It is fixed while the server runs, because plugins are loaded at start (ADR-0003).
- **ECore (CDA):**
  - the list of data types and the checks;
  - the settings per data type in the settings view;
  - the warning for undeclared data types.
- **Plugins:**
  - `draw-symbols` gets a data type picker, and sets `dataSource` to `manual`.
  - `cot-in` declares its data types and sets one data source per configured TAK connection.
  - It keeps everything of CoT that it does not map in its own extension (`docs/architecture/ideas/atak-plugin-interop.md`, section 11).
- **The time attributes of data model 1.0.0** (observation time, expiry) and the settings per data type together decide how expired objects are shown.
- Later, the live picture and its filters can select by data type and data source, for example to hide one stream.
