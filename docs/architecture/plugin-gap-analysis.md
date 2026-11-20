# Gap analysis: third-party plugins on today's contracts

- **Status:** the ACA's analysis (2026-11-16), for the owner, through the MCA's request. Read only: it proposes, and every proposal goes to a CR, not to code. **The owner answered GQ1 to GQ3 the same day: A, A and A** (section 6); the "when" column of section 3 follows the answers.
- **Base:** `main` `f6908a9e`; SDK and data model 1.8.0 (tag `contracts-1.8.0`); the M9 plan (`m9-plan.md`) and ADR-0059 to ADR-0063 (Proposed).
- **The goal tested:** someone outside the project can write a plugin with no change to ECore, the shell or the SDKs, as long as they follow today's contracts.
- **Method:** the contracts (`model/`, both SDKs, `docs/plugins/`, `plugins/_template/`), ECore and the shell where they load and serve plugins, and seven real plugins (simulator, gmti, fmv, cot, draw-tactical, map-view-2d, layer-panel) were read. Nothing was built or run. The ACA re-read the lines of gaps G1 to G12; the lines of the others come from three read-only audits and are as those reported them.

**Path prefixes used below:** `SDK-J` is `server/plugin-sdk/api/src/main/java/dev/emcc/sdk`, `ECORE` is `server/ecore/src/main/java/dev/emcc/ecore`, `SDK-W` is `web/plugin-sdk/src`, `SHELL` is `web/shell/src`, `MV` is `plugins/map-view-2d/web/src`, and `MAN` is `model/schemas/plugin-manifest.schema.json`.

## 1. The verdict

**The architecture holds: a plugin is installed by putting a folder in place, and neither ECore nor the shell knows any plugin by name.**
- ECore scans the plugins folder and loads every plugin it finds (`ECORE/plugin/PluginHost.java:907-918`). The shell reads the list from the server and imports each web part (`SHELL/plugins/loader.ts:82-84`).
- A search of ECore, the edge and the shell for every plugin id found comments only. The shell knows two service keys (`emc2.map-view`, `emc2.symbols`; `SHELL/boot.tsx:166`) and the manifest kind `map-view`, not the plugins behind them.
- Most extension concepts are open through the manifest: permissions, settings, data types, declared fields, field sets, relation kinds, workspaces, folders and connections.

**But the goal is not met today, for three reasons:**
1. **An outsider cannot build a plugin** (G1): the SDKs, the schemas and the template work only inside this repository.
2. **A built web part breaks at the next release** (G2): the shell demands the exact SDK and library versions the plugin was built with.
3. **Two plugins can share only what the SDK already defines** (G3, G7, G8): map objects, and the SDK's own types and service keys. A new kind of data or service between plugins needs a change to the SDK. `uav-simulation` is the first case (section 4).

The documents are a fourth obstacle (G5): they are a history of changes, written for the project's own agents, with no page that says what the SDK is today.

## 2. The extension concepts

"Alone" means: with no change to ECore, the shell, the SDKs or another plugin.

| Concept | Alone today? | What works | Gaps |
|---|---|---|---|
| **Build and install** | **No** to build; yes to install | A folder with `plugin.json`, `server/*.jar` and `web/`, and a restart | G1, G2, G20, G24 |
| **Channels and their kinds** | **Partly** | Any plugin offers an output channel, watches the list and sends (`SDK-J/channel/Channels.java`) | G3 (the kinds and items are closed), G11 (no state back to the sender); input channels are specified but not in the API (`docs/plugins/sdk-v1.md:478`) |
| **Objects and extensions** | **Yes** | Its own namespace; other plugins' editable fields by naming them (`Change.withFields`; `ECORE/store/ObjectStore.java:689`); queries and subscriptions over every workspace (`SDK-J/store/Store.java:60`) | G14 (closed types), G26, G27; a query filters by layer, data type, data source, external system and reference, area and workspace only, not by id (G27) or namespace |
| **Drawing on the map** | **Partly** | Objects and layers through change requests; temporary overlays of points, lines, areas, labels and symbols; relation lines from the manifest | G6 |
| **Right-click menus** | **Yes** | Actions for objects (by type and data type, also other plugins') and for the map, with a permission and a workspace filter (`SDK-W/actions.ts:18-91`) | G16 |
| **Settings panels and forms** | **Yes** | A form generated from the manifest's schema and its hints, or the plugin's own panel | G9 |
| **Panels, windows, workspaces** | **Yes** | A panel in View or in any workspace, another plugin's included (`SDK-W/workspace.ts:44-45`); its own workspace; a top-bar item; a floating window | G21 |
| **Permissions and labels** | **Yes** | Its own permissions; an endpoint names the permission it needs and ECore checks it (`ECORE/plugin/PluginEndpoints.java:245-248`); `ctx.user.has(…)` in the browser; a label on everything, and an output link's highest classification | G12; the web SDK has no component that shows or edits a label; an admin must map each new permission to a role by hand |
| **Connections, timers, folders, outbound HTTP** | **Yes** | Connection tasks with the plugin's own sockets; timers down to 10 ms; read-only folders from the manifest; GET and POST | G15, G18. TLS only through a credential an admin names (by design, ADR-0062) |
| **The Monitor** | **Partly** | One status line; counters and details per connection task (`SDK-J/connection/TaskContext.java:66-69`) | G10 |
| **Reading and acting on another plugin's objects** | **Yes** | As "objects and extensions" above | – |
| **Offering or using a service** | **No** by rule in the browser; **no** on the server | The five keys the SDK defines | G7, G3 |
| **Depending on another plugin** | **Partly** | `dependsOn` gives a hard dependency and a start order; `requires` and `uses` for web service keys | G13 |
| **Offering other plugins a place to add to** | **No** | Only what the manifest schema names, such as `symbolPalettes` | G8 |

## 3. The gaps, ranked by impact

**Fix size:** S is an added API or manifest field, M a new mechanism in ECore, the shell or the map view, L a redesign. **When:** "M9" is a fix with no contract change; "1.9.0 P" and "1.9.0 U" are the parts of the SDK 1.9.0 CR; "later" is SDK 1.10 or after. Each "when" is the ACA's proposal, as the owner's answers GQ1 A, GQ2 A and GQ3 A set it (2026-11-16). The gap ids (G1 to G27; G27 added on 2026-11-17) are this document's; the M9 plan's task ids G1 and G2 are the UDA's tasks.

| # | Gap | Where | Why it blocks a third party | Fix | Owner | When |
|---|---|---|---|---|---|---|
| **G1** | **The SDKs, the schemas and the template cannot be used outside the repository** | `web/plugin-sdk/package.json:4,8-13` (private, TypeScript sources); `server/plugin-sdk/pom.xml:22` (a snapshot, published nowhere); `plugins/_template/server/pom.xml:13-18` (its parent by a relative path); `plugins/_template/web/vite.config.ts:11-17` (the shell's import map by a repository path); `tools/release.mjs` ships no SDK | Nobody outside can compile, test or package a plugin | **S to M:** an "SDK kit" zip next to the release: the SDK and test kit jars with sources and Javadoc, a stand-alone parent POM, the web SDK as an npm package with types, the shell's import map, the schemas and examples, and the template made to build from the kit | MCA (the kit), PDA (the template and the POMs), CDA (the import map as a file) | **M9** (owner, GQ1 A) |
| **G2** | **A web part is tied to the exact versions of the shell it was built with** | `SHELL/plugins/plan.ts:120-125` (equality); `SDK-W/version.ts:16-24` (the SDK itself is in the list); `SDK-W/build/index.ts:73-84` | A web part built against 1.8.0 is refused by a 1.9.0 shell, although its `^1.8.0` passes. Every release forces every outside plugin to be rebuilt and re-released | **S to M:** the SDK is checked by the range only; a shared library by a compatibility rule (the same major version). A rule in the SDK, a change in the shell | PDA (CR), CDA | **1.9.0 P** (owner, GQ1 A) |
| **G3** | **On the server, two plugins can exchange only the SDK's own types** | Channel items are sealed and the kinds are an enum (`SDK-J/channel/ChannelItem.java:28`, `ChannelKind.java:7`; `ECORE/plugin/ChannelRegistry.java:178`). A topic needs the same payload class on both sides (`ECORE/runtime/TopicBus.java:80-84`), and plugins share only `dev.emcc.sdk.*` classes (`ECORE/plugin/PluginClassLoader.java:31`). No request to another plugin's worker (`SDK-J/worker/Workers.java:16`); no service registry on the server | A new kind of data between two plugins needs an SDK release. `uav-simulation` to `fmv` is the first case | **M:** a channel kind a plugin declares, named `<plugin-id>.<name>`, with a JSON payload the offering plugin documents; later the same for topics | PDA (CR), CDA | **1.9.0 P** (owner, GQ2 A), with the camera pose as its first use, if the PDA's CR confirms that it fits; topics later |
| **G4** | **ECore does not check a plugin's code when it loads it** | "Plugins are trusted" (`ECORE/plugin/PluginClassLoader.java:22`); the rules live in the test kit only (`server/plugin-sdk/testkit/…/PluginRules.java:54`) | It does not stop the author. It stops **the admin** who must decide whether to install: no threads, no file I/O and "hosts only from settings" are checked by the template's tests and this project's reviews, which an outsider may skip | **Now:** the admin guide says that a plugin is trusted code. **M, later:** ECore runs the static rules on a plugin's jars at load and shows the result in the Monitor; signed plugins after that | UDA (the guide), CDA and PDA (the check), SRA | The guide **M9**; the check **later** (owner, GQ3 A) |
| **G5** | **No page says what the SDK is today** | `docs/plugins/sdk-v1.md` is 1 216 lines of changes per version over `sdk-v0.md`, with about 140 task ids, 150 CR ids and 100 owner-answer ids; the channel API is spread over nine sections; `sdk-v0.md` describes 10 of the context's 25 members; both SDK READMEs stop at 1.1.0 | An outsider, or an LLM agent without the project's history, cannot find the current API or tell a rule from its history | A current-state reference per concept, a "how do I" index and one worked example per concept: the M9 plan's D4 and D5, with section 5 below as their input | PDA | **M9** (D4, D5) |
| **G6** | **The map draws only what the SDK's neutral shapes allow** | "No escape hatch" (the owner's decision, `SDK-W/services.ts:1-3`); overlay kinds are closed, with no image (`:152-158`); an object type the map does not know gets a fallback marker (`MV/core/drawData.ts:124-181`); only the map-view plugin gets the Map Pane (`SDK-W/context.ts:160-165`); no longitude and latitude to pixel; pointer events are click and move only | A plugin cannot show a raster, a heat map, a video frame on the ground, a new symbol kind, or its own tool | **Within the owner's decision, step by step:** S: position to pixel, fit to an area, an image overlay; M: pointer down and up, and a click a tool can take; M to L: a layer a plugin draws through a neutral canvas | PDA, PCA-map-view-2d | **Later**; the S steps are candidates for 1.10 |
| **G7** | **A plugin may not define a web service** | The rule (`docs/plugins/design-pattern.md:44`; `SDK-W/services.ts:1-3`); the key constructor is not exported (`:22`). The shell would already accept any id (`SHELL/plugins/services.ts:50-56`; `MAN:405`) | Two outside plugins cannot offer and use a service of their own | **S:** allow keys named `<plugin-id>.<name>`, owned by the providing plugin; export the constructor; say how the interface is shared and versioned. `emc2.*` stays the SDK's. No shell change | PDA (CR) | **1.9.0 P** (owner, GQ1 A) |
| **G8** | **A plugin cannot offer other plugins a place to add to** | The manifest takes no unknown section (`MAN:207`); `symbolPalettes` is a section of the core schema made for one plugin's panel (`MAN:146`) | Each new extension point between plugins is a data model change | **M:** a generic `contributes` section, keyed by `<plugin-id>.<point>`, and a call to read the contributions to one's own points | PDA (CR), CDA | **Later** |
| **G9** | **The settings form's field kinds are closed** | `'layer' \| 'colour'` (`SDK-W/settings-form.ts:70`); a plugin's own panel replaces the whole form (`SDK-W/context.ts:113-130`) | No picker for a classification, an output channel, a data type or a credential; no single field of the plugin's own in the generated form | **S** per kind; **M** for a field the plugin draws | PDA (CR), CDA | **1.9.0 P** for the TLS credential (D1, planned); the rest **later** (owner, GQ1 A) |
| **G10** | **A plugin has counters in the Monitor only per connection task** | `SDK-J/connection/TaskContext.java:66-69`; `ECORE/monitor/MonitorSnapshot.java:67-71`; the Monitor's sections are fixed in the shell | A plugin without a connection, such as `uav-simulation`, shows one status line and nothing else | **S:** counters and details at plugin level, shown in the plugin's Monitor entry | PDA (CR), CDA | **Later** (owner, GQ1 A) |
| **G11** | **A sender learns nothing about a channel's link** | `send` answers accepted, dropped or closed only (`SDK-J/channel/Channels.java:74`); `ChannelInfo` has no state | A sender's panel cannot say why nothing goes out. ADR-0059 point 5 needs it | **S:** a state and a detail on the channel, set by the offering plugin | PDA (CR), CDA | **1.9.0 U** |
| **G12** | **A server part changes objects without the user** | "A server part's changes carry no user … no user permission is checked" (`SDK-J/store/Store.java:31-32`) | Each endpoint that changes objects for a user must check the workspace's permission itself, and the change names the plugin, not the user. An outside plugin that forgets it lets a user past the permissions | **S to M:** a change "on behalf of" the request's user, checked and recorded by ECore as a browser's change is | PDA (CR), CDA, SRA | **Later**, with G4 |
| G13 | Dependencies are by id only | `MAN:21`; `ECORE/plugin/StartOrder.java:41-43`; ids are one flat namespace (`model/schemas/common.schema.json:22`) | No version range, no optional server dependency, no list of loaded plugins; two vendors may pick the same id | S: a vendor prefix as a naming rule now (D4); the rest in a CR | PDA, CDA | The rule **M9**; the rest later |
| G14 | Lists in the SDK that a plugin cannot add to | Sensor types (`SDK-J/channel/SensorType.java:10`), capabilities (`SDK-J/capability/Capability.java:20`), display classes (`SDK-J/model/DisplayClass.java:17-23`), the manifest's category and kind (`MAN:12-13`), the icon list, the five declared field types (`SDK-J/DeclaredField.java:59`), geometries, symbol standards | A new sensor type, user switch, field type or Settings category needs an SDK release. An outside plugin uses "general" and the nearest value | S to M each, case by case, when a plugin needs one | PDA | Later |
| G15 | No storage for large or binary data | Documents are JSON, 1 MiB each, 1 000 per plugin (`SDK-J/document/Documents.java:29,32`); folders are read only (`SDK-J/folder/LocalFolder.java:41`) | No place for a recording or a cache | M | PDA, CDA | Later |
| G16 | Right-click and tools | No layer actions, no condition on a map action, no sub-menus, no keyboard shortcuts, no tool registry (`SDK-W/actions.ts:52-91`, `:120-127`) | Limits, not blockers | S to M | PDA, CDA | Later |
| G17 | A web part gets its own live data only by polling | The plugin's own endpoints with `fetch`, or a binary stream (`SDK-W/stream.ts:27`) | A panel that follows its server part polls | S to M | PDA, CDA | Later |
| G18 | HTTP is GET and POST only | `SDK-J/http/HttpCall.java:77` (outbound, bearer token by name only); `SDK-J/http/Endpoint.java:93` (inbound) | No PUT or DELETE, no basic authentication or client certificate through `http()` | S | PDA, CDA | Later |
| G19 | **One plugin can break another's topic** | The first subscriber fixes a topic's type (`ECORE/runtime/TopicBus.java:75-84`): a plugin that subscribes first with another class makes the owner's publish throw | An outside plugin can stop an existing one by mistake | S, ECore only: the publishing plugin's type decides | CDA | **M9** |
| G20 | The release's Java runtime holds a fixed list of modules | `tools/release.mjs:51-56` | A plugin that needs another JDK module works in development and fails in the release | S: the list in the SDK kit's readme; the admin's own Java (C5) is the way out | MCA | **M9** |
| G21 | A workspace is always the map and three panes | `SHELL/ui/Workspace.tsx:45-58`; Settings and the Monitor are fixed (`SHELL/ui/Views.tsx:15-16`) | No page of a plugin's own without the map | M | PDA, CDA | Later |
| G22 | Text is English only | `docs/plugins/design-pattern.md:132` | No translation | L | PDA, CDA | Later |
| G23 | A second map view must copy an unwritten agreement | One map view (`SHELL/plugins/plan.ts:144`); the workspace switch is "between the shell and `map-view-2d` … with no SDK member" (`SDK-W/workspace.ts:105-107`) | A 3D map can only replace the 2D one, and must find that agreement in the code | S for the agreement as an SDK member; L for two maps | PDA, CDA | Later |
| G24 | No check of the manifest in the template or the test kit | `server/plugin-sdk/testkit/…/FakePluginContext.java:660-661`; five plugins wrote their own check (for example `plugins/gmti/check/manifest.test.mjs`) | A wrong manifest is found only when ECore loads it | S: one manifest guard in the template (D3) | PDA | **M9** |
| G25 | One conversion, with Windows' encoder | `SDK-J/stream/ConversionSpec.java:22`; `ECORE/plugin/ConversionHub.java:156` | No other codec; Linux waits for M10 (L1) | M | PDA, CDA, MCA | M10 |
| G26 | "Not saved" updates | Any plugin may send them; "only the simulator" is text (`SDK-J/store/Change.java:141-150`); a subscriber cannot tell them from saved ones (`ECORE/plugin/StoreFeed.java:88`) | A policy nothing checks | S | PDA, CDA | Later |
| G27 | No query by object id | `ObjectQuery` filters by layer, data type, data source, external system and reference, area and workspace only (`SDK-J/store/ObjectQuery.java:35-43`) | A plugin that follows chosen objects, such as a camera's platform and target, must subscribe to a whole workspace and keep a record of every object in it (PCA-uav-simulation's finding 4, in its handover after phase 2, `pca-uav-simulation/cameras` `e64e9f63`; through the PDA, 2026-11-17) | S: `ObjectQuery.ids(Set<UUID>)`, at most a few hundred ids, for queries and subscriptions (the PDA's proposal) | PDA (CR), CDA | Later |

**Checked, no gap** (2026-11-17, through the PDA): a layer that leaves its workspace sends its subscribers no event (PCA-uav-simulation's finding 6, in the same handover). The data model and both stores refuse that change: a layer stays in its workspace (ADR-0039 point 5; the data model's rule R2, `model/README.md`).

## 4. The worked case: `uav-simulation`

ADR-0059: a new plugin reads the simulator's tracks and sends camera poses on a channel to `fmv`'s new output link. Read as if an outsider wrote it.

**What it can do today, alone:**
- **Read its platforms and targets.** A subscription to `ObjectQuery.all().inWorkspaces("simulator.simulation")` delivers every object of the Simulation workspace and every move, the simulator's not-saved moves included (`ECORE/store/ObjectStore.java:342`).
  - A track's position and altitude are its geometry, and its direction and speed are the symbol's modifiers (`plugins/simulator/…/Engine.java:1784`): core data, nothing from the simulator's namespace.
  - A paused or standing track has speed 0, so "hold the last position" follows from the data.
- **Compute the poses.** `Geodesy.direct` and `inverse` are in the SDK; a timer may tick every 10 ms or slower (`SDK-J/timer/Timers.java`). The timer keeps a fixed delay, not a fixed rate, so **the frame clock must be the renderer's**: it draws the newest pose it has, as ADR-0059 point 3 says.
- **Keep its cameras** as its own documents; declare **its own permissions**; serve its panel from its own endpoints.
- **Its web part:** a panel in the simulator's workspace, by naming `simulator.simulation`; "Add camera" in a track's right-click menu there; picking a ground point or a target on the map; a temporary overlay for the line of sight and the footprint (seen by that user only).
- **Find `fmv`'s link:** `channels().watch` lists every plugin's channels, with no compile-time tie.

**What it is missing:**

| | Missing | Gap | Who |
|---|---|---|---|
| 1 | **A way to send a pose.** The channel items are `Update`, `Removal` and `SensorReport` only, and the kinds are ground truth and sensor reports. A pose could ride in an `Update` with `fmv`'s `camera` field set, but the link would then be a ground-truth channel, and the simulator would offer it as an output for every track. **A kind of its own is what is missing** | G3 | PDA (D2), CDA |
| 2 | **`fmv`'s output link and ECore's rendering service.** `fmv` has no output today (its manifest: "ingoing" only). **Changed by the owner** (YG A, 2026-11-16): `fmv` renders on compute tasks (ADR-0064) and ECore's conversion service encodes; the M9 plan's section 6 | – | PCA-fmv (F1), CDA (C7, C10) |
| 3 | **Why nothing goes out.** The sender sees accepted, dropped or closed, not "the link has no destination" or "the renderer is at its limit" | G11 | PDA (D2), CDA |
| 4 | **Counters in the Monitor** (poses sent, held, dropped): it has no connection task to count on. Until G10 is fixed, its status line and its panel carry them | G10 | later |
| 5 | **A live panel:** the panel polls its server part for each camera's state | G17 | later |
| 6 | **A soft tie to the simulator:** the workspace is named by its id. Without the simulator the panel never shows, and nothing says why. `dependsOn` would be a hard tie, which ADR-0059 point 6 excludes | G13 | PDA (the brief says what the panel's absence means) |
| 7 | **For an outsider only:** it could not be built at all (G1), and its web part would be refused after the next release (G2) | G1, G2 | MCA, PDA, CDA |

**The lesson for the contract:** the plugin itself needs exactly **one** new thing, a kind of channel item. If that kind is added as a pose type in the SDK, the next pair of plugins needs the next SDK release. If it is added as a kind a plugin can declare (G3), `fmv` declares "camera pose", `uav-simulation` sends it, and the SDK's part U shrinks to what is truly ECore's: the rendering call. **The owner chose that** (GQ2 A, 2026-11-16), if the PDA's CR confirms that it fits. ADR-0059 (then Proposed) is amended so (the M9 plan's A4). With YG A the same day, the rendering call became raw pictures into ECore's conversion service. **It fits** (CR-0048 point 4, approved, owner ZB A): `fmv` declares `fmv.camera-pose`, and no pose type goes into the SDK. ADR-0059, accepted since (YK A), drops its fallback through CR-0049.

## 5. The template and the instruction files against SDK 1.8.0

Input for the PDA's D3 and D4.

**The template (`plugins/_template/`):**
- **It declares `^1.1.0`** (`plugin.json:5`) but uses the 1.2.0 connection API (`…/transport/LinkWorker.java:192`), and it breaks 1.8.0's "name once, icon always": no panel icon (`web/src/index.tsx:11-16`), and the panel repeats its title (`web/src/GreetingPanel.tsx:15`).
- **It uses no deprecated API.**
- **It shows:** one worker, a GET endpoint, a status, one panel from the shared components, and the transport pattern for links (not started).
- **It shows nothing of:**
  - the object store, the object writer, output channels, the highest classification, TLS, documents, folders, streams, timers and outbound HTTP;
  - a permission with a POST endpoint, settings that change while running (`subscribeSettings`, `onSettingsChange`), object actions and the live picture;
  - in the manifest: permissions, data types, fields, field sets, workspaces, connections, an icon, any settings hint, or a list item's stable id.
- **Its guards do not check the manifest against the schema** (G24). Nothing checks a title or a description on a setting: its own `greeting` has a description and no title (`plugin.json:13`).
- **It cannot be built outside the repository** (G1).

**The documents:**
- **Wrong today:**
  - `docs/plugins/in-out/playbook.md:90` tells the author to write `"links": "/links"` in `connections`; the schema's key is `settings`, so the manifest is refused;
  - `docs/plugins/sdk-v1.md:1206` lists a plugin's own settings panel under "Not in v1", though it exists since 1.3.0;
  - the heading "`setSettingsPanel` required" (`sdk-v1.md:592`) means the shell must offer it, not that a plugin must call it.
- **Stale:**
  - the status lines of `design-pattern.md:3` (1.4.0) and `sdk-v1.md:3` (1.5.0); `design-pattern.md:223` still asks for a listener test;
  - `sdk-v0.md:147` ("GET only") and `:304-310` (`objects().submit`, now `store().submit`);
  - both SDK READMEs and the Java `package-info.java` (listeners; no connections, channels or streams);
  - `docs/plugins/briefs/README.md:247,251` (listeners);
  - `agents/pca.md:34` names listeners as current, and its reading list leaves out `sdk-v1.md` and the playbook (the ACA's file).
- **Project-internal:** `w1-guards.md` and `sdk-1.x-requests.md` are work lists of past milestones; role names, branch and handover rules are mixed into the technical rules.
- **Rules an author must know that are stated only outside `docs/plugins/`:**
  - `CLAUDE.md` section 4: the licence list and exact versions, offline and the host rule, no secrets, both platforms, the name emcc;
  - the overview's 4.1, 4.2 (C1 to C8) and 4.4;
  - `model/README.md`'s "Rules the schema cannot express";
  - the conformance review's CSS and icon checks.

**What D3 and D4 should therefore do, in order:**
1. **D4: one current-state reference** of SDK 1.8.0 per concept (the concepts of section 2), with no version history and no task, CR or owner-answer ids. `sdk-v1.md` stays as the history.
2. **D4:** pull in the outside rules above; the whole manifest and every settings hint in one list; a "how do I" index; a naming rule for outside plugin ids (G13).
3. **D3:** the template at `^1.8.0`: icons, no repeated title, a title and a description on every setting.
4. **D3: one manifest guard** in the template: the schema, the settings hints, and the title and description rule of ADR-0060, also inside list items. It replaces the five plugins' own check scripts.
5. **D3: the link example end to end:** the links' schema in the manifest with hints and item ids, `connections` declared, the object writer for input, a channel with a highest classification for output.
6. **D3:** settings that change while running, and a permission with a POST endpoint.
7. **The PDA's fixes now:** `playbook.md:90`, `sdk-v1.md:1206`, the two SDK READMEs.
8. **D5:** one recipe per concept of section 2, the template being the first.

## 6. Questions for the owner

**All three are answered** (owner, 2026-11-16). The table keeps the questions as asked.

| # | Question | Options | The ACA recommended | The owner's answer |
|---|---|---|---|---|
| GQ1 | **How far does M9 go for outside plugin authors?** | **A** the minimum that lets an outsider build and keep a plugin: the SDK kit (G1), the version rule (G2), web service keys of a plugin's own (G7), the documents (G5, in D3 to D5), and the small fixes G19, G20 and G24; **B** only the documents (D3 to D5) in M9, the rest in M10; **C** A, and also the counters (G10) and more settings field kinds (G9) | **A**: without G1 and G2 the cookbook and the instructions of M9 describe something nobody outside can use | **A** |
| GQ2 | **The camera pose on a channel (G3)?** | **A** SDK 1.9.0 adds a channel kind a plugin can declare, with a JSON payload; `fmv` declares the camera pose. It goes in part P, so it stays when the UAV track is cut; **B** part U adds a camera pose type to the SDK, as planned, and the general mechanism comes later | **A**, if the PDA's CR confirms that it fits: the same work gives outside plugins a way to talk to each other | **A** |
| GQ3 | **An outside plugin's code (G4)?** | **A** in M9 the admin guide says that a plugin is trusted code, installed like any program; ECore's check at load comes later; **B** ECore's check at load in M9 | **A**: the CDA is M9's bottleneck (`m9-plan.md` section 3) | **A** |

## 7. Not examined

- Whether the layer lock applies to a server part's changes.
- How the labelling definitions reach a server part.
- The server's Origin and CSRF checks on a plugin's endpoints.
- Whether an icon component of a plugin's own renders in the shell.
- The plugins not named in the method. The search for names shared between plugins covered eight of them and found only declared names: the simulator's use of `gmti.pairing` and `cot`'s fields, and object-list's reading of `draw-shapes`' namespace.
