# ADR-0065: Settings export and import

- Status: Accepted (owner, AFO A, 2026-11-23, as written: Display and Labeling in the file, the compute threads out; proposed by the ACA the same day, after the owner's answers to M10's plan: Q1 A, AES, and Q2 A, AET)
- Date: 2026-11-23
- Deciders: Owner (advised by the ACA)
- Extends: ADR-0060 (settings and credentials files), ADR-0023 point 7 (data types' behaviour)

## Context
An admin sets up an installation in the Settings workspace:
- each plugin's settings;
- the General, Display, Data types, Layers and Labeling entries;
- a plugin's compute threads (ADR-0064 point 4).

emcc keeps these in `data/ecore-config.json` (ADR-0060 point 2), except the layers, which are data in the object store. The admin edits `settings/emcc.properties` and `settings/credentials/` by hand.

The owner wants **an installation's settings moved to another one** (M10, the board's list), for example from a test installation to the one in use, or onto a new server.

What the system has:
- **No setting is secret** (ADR-0060). A setting names a credential, for example a TLS credential by its name (SDK 1.9.0's `x-emc2.kind` `tls-credential`), and the credential lives in its own file in `settings/credentials/`.
- **ECore stores what users set.** A plugin that no admin has saved gets its manifest's defaults. A saved plugin's settings are stored whole, as the form sent them.
- **ECore checks a plugin's settings against its manifest's JSON Schema** before it stores them, and delivers them to the plugin through `subscribeSettings`.
- Every read and write of settings needs `settings.admin`, checked on the server.

The owner answered M10's plan on 2026-11-23:
- **Q1 A (AES):** no secret goes in the file;
- **Q2 A (AET):** the file has a format version, its unit is one top-level setting, and it holds what an admin set, not the defaults. The report is as the plan's point 2 says.

## Decision
1. **One JSON file, written and read by ECore:**
   - **its format:** `"format": "emcc-settings/1"`, with the emcc version, the export's time, and each exported plugin's version.
     - A reader of format 1 takes any file of format 1. A later version of format 1 may add optional members, and a reader skips members it does not know.
     - Anything else is a new format number. **A file with a newer format number is refused whole**, with one line that says so. So is a file of another format, such as `data/ecore-config.json` itself;
   - **what it holds is what an admin set:**
     - **each plugin's stored settings**, as stored. A plugin with no stored settings is not in the file, so the target uses its own version's defaults;
     - **General:** the default look;
     - **Display:** the users' display defaults;
     - **Data types:** each data type's stored behaviour;
     - **Labeling:** the premade security labels;
   - **what it does not hold:**
     - **the layers:** they are data, not settings;
     - **a plugin's compute threads:** they suit one computer's cores;
     - **`settings/emcc.properties` and `settings/credentials/`:** these are files an admin copies, and the credentials stay where their narrow permissions are (ADR-0060 point 3);
     - **any plugin's own documents,** such as `uav-simulation`'s cameras, which have their own export (M10's plan point 13);
   - **no secret is in it** (Q1 A). No setting is secret, so the file needs no encryption and no password;
   - **beyond the plan's list:** M10's plan (point 1) names General, Data types and the plugins. **The ACA adds Display and Labeling** and leaves out the compute threads, because the first two are set by an admin, are not secret, and are kept in the same file. The owner may change this when accepting the ADR.
2. **The unit is one top-level setting**, applied whole or skipped whole (Q2 A):
   - **the units:**
     - each top-level property of a plugin's settings. A list, for example a plugin's links, is one unit;
     - the default look;
     - the display defaults;
     - each data type's behaviour;
     - the premade labels, as one unit;
   - **each plugin's units:** ECore starts from the plugin's current values, stored or default. It applies the units one by one, and each is checked against the manifest's schema together with the units kept so far. A unit that fails is skipped, and the values stay as they were before it;
   - **each plugin gets its complete new settings once**, through `subscribeSettings`, as after a save in the form. A plugin whose units were all skipped gets nothing;
   - **the same checks as the form:** the import uses the checks that the Settings form's saves use: the item ids filled in, the schema check, the labeling check;
   - **one write, in a batch step of its own:** today each save stores and notifies on its own. The import instead decides every unit first, then stores the result in one change of `data/ecore-config.json`, which is replaced atomically as today, and only then sends the deliveries and live notices that the changed settings send today (a plugin's settings, data types, the look, the display defaults, the labels). A failure while writing leaves the old settings whole, and nothing is delivered;
   - **no second meaning:** an imported setting is stored and delivered as a saved one is. The import adds a way in, not another kind of change.
3. **The report** (point 2 of M10's plan):
   - **one line for each skipped unit:** where it is (General, Display, Data types, Labeling, or a plugin's id), the setting's name, and why it was skipped:
     - the plugin or the data type is not installed;
     - the setting is unknown to the installed version's schema;
     - the value is invalid, with the schema's message;
     - the server refused it, with the reason, for example the labeling check's problem when the premade labels name a policy or classification this installation lacks;
   - **then the warnings**, for what the applied settings name but this installation lacks:
     - a TLS credential (a field of kind `tls-credential`) with no file in `settings/credentials/`;
     - a layer (a field of kind `layer`) whose id does not exist here. Layer ids differ between installations, so the warning also says whether a layer of the same name exists. The import never rewrites the value; the admin chooses the layer in the form;
     - a plugin whose version differs from the file's, as a note only, since the schema check decides;
   - **where it goes:** the shell shows the report after the import, and the server log has it with the admin's name. The units applied are counted, not listed.
4. **The endpoints and their limits** (the CDA names the paths):
   - **an export** that returns the file as a download;
   - **an import** that takes the file and returns the report;
   - **both need `settings.admin`**, checked on the server before anything else (overview 4.4). The import is a change, so the Origin check applies;
   - **the import's limits:** a size limit on the body and a nesting depth limit on the JSON, both checked before the units are read. A file over either is refused whole. The CDA sets the values, as the display defaults' body limit does today, and the SRA checks them (M10's plan, S1);
   - **concurrency:** the import's decide-and-store step holds ECore's configuration lock, the one the form's saves take, so it is one change at a time. The lock stays a leaf lock (rule C4, ADR-0021): the deliveries and notices are sent after it is released, and no plugin code runs while it is held. The import starts no thread.
5. **No SDK hook:** the plugins see an import as a save. ECore checks each plugin's settings against its schema, and the plugins receive them through `subscribeSettings`. **No plugin and no SDK changes.** The warnings come from the hints that the schemas already carry.

## Alternatives considered
- **The credentials in the file, encrypted with a password the admin gives** (Q1 B): the file then needs a key handled safely, and the credentials would leave their narrow permissions. ADR-0060 already turned this down for the credentials themselves.
- **The credentials in clear** (Q1 C): secrets in a file that is mailed and copied about.
- **No version, a plugin's settings applied or skipped whole** (Q2 B): one invalid link would cost a plugin all its other settings, and a later format could not be told from this one.
- **The defaults in the file:** they would freeze one version's defaults into the target, which has its own.
- **The layers in the file:** a layer is data, with its objects, label and lock. Moving data is the job of an export of data, not of settings.
- **A preview before the import is applied:** the report says what happened, and a second import puts a skipped unit right. A preview may come later without changing the file.
- **An SDK hook, so a plugin adds its own documents to the file** (M10's plan, Q12 C): this is a contract change. `uav-simulation`'s cameras have a file of their own instead.

## Consequences
- **CDA:** the export and import in ECore and the edge, the Settings workspace's Export and Import, and the report (M10's C2). Tests:
  - an export and import between two installations;
  - every reason to skip, and the warnings;
  - a file of a newer format refused whole;
  - the size and depth limits;
  - `403` without `settings.admin`;
  - one write, and one delivery per plugin.
- **PDA, PCAs:** nothing. A plugin whose setting names a TLS credential or a layer gets the warnings by using the hints it already has.
- **ITA:** the specs (M10's T1): the skips, the warnings and the permission.
- **UDA:** the admin guide: what moves and what an admin copies by hand (`settings/emcc.properties`, `settings/credentials/`, the layers).
- **UXA:** the look of Export, Import and the report.
- **SRA:** the file holds nothing secret; the import's limits; the permission (M10's S1).
