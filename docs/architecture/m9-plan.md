# M9 plan: productification, and the UAV camera

- **Status:** proposed by the ACA (2026-11-16), for the owner's approval. The owner answered Q1 to Q11 the same day (the table below; section 4 keeps the questions as asked). The ADRs it names, ADR-0059 to ADR-0064, are **accepted** (owner, YK A, 2026-11-16).
- **Third-party plugins** (2026-11-16): [the plugin gap analysis](plugin-gap-analysis.md) checks whether an outsider can write a plugin on today's contracts. The owner answered its questions GQ1 to GQ3 the same day (A, A and A); its follow-up tasks are in section 5.
- **The UAV camera's rendering** (owner, YG A, 2026-11-16, through the MCA): `fmv` renders and muxes on compute threads it declares ([ADR-0064](../adr/0064-compute-tasks.md)), and ECore's conversion service encodes raw pictures. ECore's rendering service is dropped; ADR-0059 is amended (section 6).
- **Not in M9** (owner, 2026-11-16, Q4, Q5, Q10): PostgreSQL/PostGIS with spike S8, OpenTelemetry, GeoTIFF height data, Linux (the release bundle, the tests, a `systemd` unit, the Linux H.264 encoder), the WinTAK S1 to S5 fixtures, T-129's ATAK phone check and gmti's "dwells sent a minute" note: all on to **M10**, with **an export and import of cameras** (Q8). **The M9 release is Windows x64 only.**
- **The theme** (owner, through the MCA, 2026-11-16): **"productification"**. emcc should be installed and run as a product on an organisation's own infrastructure:
  - HTTPS;
  - TLS client certificates;
  - a Windows service;
  - settings files with the credentials apart and every setting explained;
  - an admin guide;
  - a developer cookbook and instructions for LLM agents that build plugins.
- **Two tracks:**
  - **P, productification:** the milestone's core;
  - **U, the UAV camera** (ADR-0058, ADR-0059): its own track, which **can be cut to M10** without touching P (owner, XQ A).
- **The contracts:** SDK 1.9.0 through one CR by the PDA, in **two separable parts**:
  - **part P:** a settings field for a TLS credential, an annotation only;
  - **part U:** the camera pose, its output kind and the `fmv` link's rendering call, as first planned; changed below.

  Part U is frozen only with the track, so cutting U leaves 1.9.0 as part P. No object or layer schema changes.

  **Changed by the owner's GQ1 A and GQ2 A (2026-11-16; section 5):** part P also carries the version rule for web parts, web service keys of a plugin's own, and **a channel kind a plugin declares**. `fmv` declares the camera pose as such a kind, so part U shrinks to the `fmv` link's rendering call and a channel's state for its senders. **The declared kind fits** (CR-0048 point 4, approved, owner ZB A), so no pose type goes into the SDK, and since YG A (section 6) part U is raw pictures into the conversion service and a channel's state for its senders (D2).

  **Changed by the owner's YG A (2026-11-16; section 6):** part P also carries **compute tasks** (ADR-0064). Part U's rendering call becomes **raw pictures into the conversion service**, with the H.264 back to the plugin (ADR-0059 point 7).

## The owner's answers (2026-11-16)

| | Answer |
|---|---|
| Q1 | **A, procrun** is the Windows service wrapper (ADR-0063) |
| Q2 | **A:** a credentials file others can read gives a warning in the log and the Monitor; an admin may make it a refusal (ADR-0060). **The Monitor part is dropped** (owner, ZE A, 2026-11-16; CR-0049 part B) |
| Q3 | **A:** with HTTPS on, plain HTTP is off; the redirect port is optional and off by default (ADR-0061) |
| Q4 | **A:** PostgreSQL/PostGIS with S8, OpenTelemetry and GeoTIFF move on to M10 |
| Q5 | **B:** Linux moves on to M10 |
| Q6 | **A:** a track that carries the simulator's radar may also carry a camera (ADR-0059) |
| Q7 | **A:** a camera's platform is an object in the Simulation workspace in M9 (ADR-0059) |
| Q8 | **Not in M9; to M10**, so that the idea is kept: an export and import of cameras (ADR-0059) |
| Q9 | **A:** the cookbook's diagrams are editable `.drawio.svg` files |
| Q10 | **B:** the smaller carried items move on to M10 |
| Q11 | **A:** `.properties` for the admin's files, JSON with comments where JSON is edited by hand, and the manifests' titles and descriptions as the help for what emcc writes itself (ADR-0060) |

## 1. Decisions

| ADR | Decision | Track | The owner's open point |
|---|---|---|---|
| [ADR-0059](../adr/0059-uav-simulation-plugin.md) | The camera's logic in a new plugin, `uav-simulation`, reading the simulator's tracks; poses per frame on a channel kind `fmv` declares, to `fmv`'s output link; `fmv` renders and muxes on compute tasks, ECore's conversion service encodes. Supersedes ADR-0058 points 1 and 3 | U | Q6 A, Q7 A, Q8 M10; GQ2 A, YG A |
| [ADR-0060](../adr/0060-settings-and-credentials-files.md) | `settings/emcc.properties` with every key commented; one file per credential in `settings/credentials/`, with narrow permissions checked at start; hand-edited JSON with comments; the Settings form's help comes from every manifest setting's title and description | P | Q2 A, Q11 A |
| [ADR-0061](../adr/0061-https-on-the-server.md) | HTTPS by the edge itself: PKCS#12 (recommended), PEM or JKS; the password in `settings/credentials/https.properties`; one port; TLS 1.2 and 1.3; expiry in the Monitor | P | Q3 A |
| [ADR-0062](../adr/0062-tls-credentials-for-connection-tasks.md) | TLS credentials named apart from links, one file each, PKCS#12, JKS or PEM; a link picks one in Settings, falling back to its name; expiry in the Monitor. The SDK calls stay | P | – |
| [ADR-0063](../adr/0063-windows-service.md) | A Windows service through procrun, with install and uninstall scripts, a virtual service account, a graceful stop and a restart on failure | P | Q1 A |
| [ADR-0064](../adr/0064-compute-tasks.md) | Compute tasks: a plugin declares its compute threads in its manifest; ECore creates, caps (per plugin and in total) and stops them, and shows them in the Monitor; hand-over by immutable messages only. Extends ADR-0004 | P | YG A; YQ1 A, YQ2 A, YQ3 A |

## 2. Tasks

**Owners and tracks.** P is productification, U the UAV track. "M10" marks the tasks that were moved to M9 earlier (2026-11-11 and 2026-11-13) and that the owner moved on to M10 (Q4, Q5, Q10); they stay listed so that nothing is lost.

| # | Task | Owner | Track | After |
|---|---|---|---|---|
| A1 | ADR-0059 to ADR-0063 and this plan (this branch) | ACA | P, U | – |
| D1 | **SDK 1.9.0 CR, part P:** the TLS credential settings field (ADR-0062); the rule that every setting and group has a title and a description (ADR-0060), checked in the build, not by the schema | PDA | P | the ADRs |
| D2 | **SDK 1.9.0 CR, part U**, changed by D8 (section 5) and YG A (section 6): raw pictures into the conversion service, with the H.264 back to the plugin (ADR-0059 point 7), and a channel's state for its senders (ADR-0059 point 5). **No pose type:** D8 found that the declared kind fits (CR-0048 point 4, approved, owner ZB A). It was: the camera pose and its output kind, and the `fmv` link's call to the rendering service | PDA | **U** | ADR-0059 |
| D9 | **SDK 1.9.0 CR, part P, added** (YG A, section 6): compute tasks: the manifest's `compute` declaration (threads and reason), the Java API with its inbox, counters and stop, the hand-over of a picture as an immutable value, the test kit's fake, and `PluginRules` for compute task code | PDA | P | ADR-0064 |
| D3 | **The template:** the TLS field's example, titles and descriptions, the manifest check that enforces them | PDA | P | D1 |
| D4 | **Instructions for LLM agents** that build a plugin: one file in `docs/plugins/` with the rules, the SDK's entry points and the checks, linked from the template's readme | PDA | P | D3 |
| D5 | **A developer cookbook** in `docs/plugins/cookbook/`: recipes (a panel, settings, an input link, an output link, a stream), with class and sequence diagrams drawn in draw.io and stored as editable `.drawio.svg` (Q9) | PDA | P | D3 |
| D6p | **`cot`'s brief:** the TLS credential field | PDA | P | D1 |
| D6u | **Briefs:** `uav-simulation` (new) and `fmv`'s output link, with the pose's shape (the `camera-pose` kind's payload schema, CR-0048 point 4), the rendering, the muxing, the folders and the WMS cache (ADR-0059 points 3, 7 and 8) | PDA | **U** | D2, D8, D9 |
| C1 | **The settings files** (ADR-0060): `settings/emcc.properties`, `settings/credentials/`, the permission check with its warning in the log (no Monitor entry, owner ZE A), `%emcc%/` in store paths, JSON with comments, the deprecation of `application-local.properties`, read first so that the new files win (ZE A) | CDA | P | ADR-0060 |
| C2 | **HTTPS** (ADR-0061): the SSL bundle, the redirect port, the certificate in the Monitor | CDA | P | C1 |
| C3 | **TLS credentials** (ADR-0062): named files, PEM, the Monitor's list and expiry, the names for the settings field | CDA | P | C1, D1 |
| C4 | **The service's stop entry point,** for the chosen wrapper, and the check that a service stop is the orderly shutdown (ADR-0063) | CDA | P | Q1 |
| C5 | **Existing infrastructure:** a setting for an ffmpeg of the admin's own (CR-0045 says a user may replace it); the server starting on a Java the admin provides | CDA | P | – |
| C6 | SDK 1.9.0 part P in ECore and the shell | CDA | P | D1 |
| C7 | **Compute tasks in ECore** (ADR-0064; replaces the rendering service, owner YG A): the threads, the per-plugin setting, the total cap, the stop and the fence, the Monitor's entries | CDA | P | D9 |
| C10 | **Raw pictures into the conversion service** (ADR-0059 point 7), with the H.264 back to the plugin; part U in ECore | CDA | **U** | D2, B4 |
| B1 | **The release's layout** (ADR-0060): `settings/`, the commented `emcc.properties` with every key, the credentials templates and their permissions; `start.bat` and `start.sh` without the `login` and `local` profiles | MCA | P | C1 |
| B2 | **The service in the release** (ADR-0063): the pinned wrapper, its notices, `service-install.bat` and `service-uninstall.bat` | MCA | P | Q1, C4 |
| B3 | **The start scripts:** `https://` addresses when HTTPS is on; an option to run on the admin's own Java | MCA | P | C2 |
| B4 | **The ffmpeg CR** for encoding raw frames (an amendment to CR-0045, or a new CR), and its build | MCA | **U** | ADR-0058 point 6 |
| K1 | **`cot`:** the TLS credential field on TLS links, with the link's name as the fallback (ADR-0062) | PCA-cot | P | D6p, C3 |
| F1 | **`fmv`'s output link:** poses in; **the rendering and the muxing on compute tasks**, after S10's renderer, with ST 0601 and ST 0102; the DTED reader and the two folders; the encoding through the conversion service; STANAG 4609 out over paced UDP to an admin's destination, with the release limit (ADR-0058 point 2, ADR-0059 points 7 and 8) | PCA-fmv | **U** | D6u; C7 and C10 to finish |
| F2 | **The WMS fetch** and `fmv`'s own tile cache (ADR-0059 point 8). **It stays in M9** (owner, YM B, 2026-11-16), though the imagery folder alone would keep the camera working offline | PCA-fmv | **U** | F1 |
| V1 | **`uav-simulation`:** the cameras, the four pointing modes, the poses per frame, its panel in Simulation (ADR-0059) | PCA-uav-simulation (new) | **U** | D6u |
| X1 | Titles and descriptions where a manifest lacks them (ADR-0060) | every PCA | P | D3 |
| G1 | **The admin guide** in the manual, written against the running release: running on existing infrastructure (your own Java, ffmpeg, Keycloak or another OIDC IAM, TAK Server), the settings and credentials files, HTTPS, TLS credentials for TAK, the Windows service, the compute threads' settings and cap (ADR-0064) | UDA | P | C1 to C5, C7, B1 to B3 |
| G2 | The manual's chapter on the simulated camera | UDA | **U** | V1, F1 |
| E1 | **A test CA** and a certificate for emcc's HTTPS test server; Keycloak's demo client with an `https://` redirect | ESA | P | ADR-0061 |
| E2 | **TAK Server's client certificate also as PEM**, and one that expires soon | ESA | P | ADR-0062 |
| T1 | **Specs:** HTTPS (login, WebSocket, cookie, HSTS, redirect port); TLS credentials to TAK (picked, renamed link, expired); the settings layout and the permission warning; the service on a Windows test machine (install, boot, stop, restart, uninstall) | ITA | P | C1 to C4, B1, B2, E1, E2 |
| T4 | **Compute tasks under load** (ADR-0064): tasks at the total cap, a task that will not stop, and the other plugins' workers kept responsive | ITA | P | C7 |
| T2 | The UAV end to end: a camera's stream to an outside receiver and back into emcc's FMV panel, with ST 0601 matching the scene | ITA | **U** | V1, F1 |
| S1 | **Security review of the productification:** HTTPS and TLS settings, the credentials files and their permissions, the service account and the wrapper; with M8's stream endpoint and ffmpeg | SRA | P | C1 to C4, B2 |
| S2 | The compute limits (ADR-0064), the conversion service's raw input, and `fmv`'s WMS cache | SRA | **U** | C7, C10, F2 |
| L1 | **Linux:** a Linux release bundle, the server and scripts tested on Linux, a `systemd` unit, and the Linux H.264 encoder (CR-0045). The encoder belongs here, not to the UAV track: M8's MPEG-2 conversion needs it on Linux too | MCA, ITA, CDA | **M10** (Q5 B) | – |
| L2 | **PostgreSQL/PostGIS** persistence with spike S8 and the event table question | CDA | **M10** (Q4 A) | – |
| L3 | **OpenTelemetry** and OTLP export (T-060) | CDA | **M10** (Q4 A) | – |
| L4 | **GeoTIFF height data** | PCA-terrain | **M10** (Q4 A) | – |
| L5 | **Smaller carried items:** the WinTAK S1 to S5 fixtures (ITA), T-129's ATAK phone check (owner, PCA-cot), gmti's "dwells sent a minute" note (PCA-gmti) | various | **M10** (Q10 B) | – |
| L6 | **An export and import of cameras** for `uav-simulation` | PDA, PCA-uav-simulation | **M10** (Q8) | V1 |

**The UAV track** is D2, D6u, C10, B4, F1, F2, V1, G2, T2 and S2. No P task waits on any of them, so cutting the track to M10 leaves every P task as it is. **Compute tasks (D9, C7, T4) are P** (owner, YG A): they stay when the track is cut, with no user in M9 then (owner, YQ2 A).

**Task ids:** A is the ACA, D the PDA, C the CDA, B the MCA's builds, K PCA-cot, F PCA-fmv, V PCA-uav-simulation, X every PCA, G the UDA, E the ESA, T the ITA, S the SRA, and L the carried tasks. The MCA gives them T-numbers on the board.

## 3. The CDA's load

**The CDA is M9's bottleneck.**
- It holds **six P tasks** (C1 to C6) in this section, and three more from sections 5 and 6 (C7 to C9). C1 must come first, since C2 and C3 build on it.
- The U track added **the rendering service**, the largest single piece of M9. **The owner replaced it** (YG A; section 6): ECore gets **compute tasks** (C7, now track P), on the model of the connection tasks it has, and **raw pictures into the conversion service** (C10, U), a new input for a service it has. The rendering, the muxing, the imagery and the terrain move to PCA-fmv (F1).
- The carried tasks would have added **PostgreSQL/PostGIS** (L2) and **OpenTelemetry** (L3), each a milestone-sized change to ECore, and Linux's server side (L1). **The owner moved them to M10** (Q4 A, Q5 B).
- **M8's own CDA work** comes first: the conversion service (T-211) and SDK 1.8.0's freeze.

**So for M9:**
- **L1 to L6 are M10's** (the owner's Q4, Q5, Q8, Q10);
- **the ACA recommends that the U track starts only once C1 to C3 are merged**, so that a cut of U is a clean decision at that point;
- C4 and C5 are small and can run beside C2 and C3.

Most other tasks wait on the CDA's C1 only, so the PDA's D1 and D3 to D5, the ESA's E1 and E2 and the UDA's drafting can start at once.

## 4. Questions for the owner

| # | Question | Options | The ACA recommends |
|---|---|---|---|
| Q1 | Which Windows service wrapper (ADR-0063)? | **A** procrun (Apache-2.0, ASF-maintained, native, registry configuration); **B** WinSW (MIT, one exe with a readable XML file) | **A** |
| Q2 | A credentials file others can read (ADR-0060): what happens at start? | **A** a warning in the log and the Monitor; an admin may make it a refusal; **B** a refusal by default | **A** in M9 |
| Q3 | With HTTPS on, the plain HTTP port (ADR-0061)? | **A** off; an optional redirect port, off by default; **B** a redirect port on by default | **A** |
| Q4 | The CDA's load: PostgreSQL/PostGIS with S8, OpenTelemetry and GeoTIFF? | **A** on to M10; **B** keep in M9 | **A** |
| Q5 | Linux: a release bundle, tests, a `systemd` unit? | **A** in M9, as part of productification; **B** M10 | **A**: the server must run on Linux (`CLAUDE.md` section 4), and a product names its platforms |
| Q6 | May a track that carries a simulated radar also carry a camera (ADR-0059)? | **A** yes: the camera is `uav-simulation`'s, the radar the simulator's; **B** no, one sensor per track as ADR-0058 had it | **A** |
| Q7 | A camera's platform (ADR-0059)? | **A** an object in the Simulation workspace only; **B** also an object in View, such as a real ship | **A** in M9 |
| Q8 | Cameras in scenarios (ADR-0059)? | **A** not in M9: they are kept by `uav-simulation`, and an export of its own comes later; **B** an export and import in M9 | **A** |
| Q9 | The cookbook's diagrams? | **A** editable `.drawio.svg`: one file is both the drawing and the picture; **B** `.drawio` files with exported PNGs, which are generated files (`CLAUDE.md` section 6) | **A** |
| Q10 | The smaller carried items (L5)? | **A** stay in M9; **B** move on | **A** |
| Q11 | The settings files' formats (ADR-0060 point 2)? | **A** `.properties` for the admin's files, which take comments natively; JSON with `//` comments for hand-edited JSON; the Settings form's help from every manifest setting's title and description; **B** move the admin's files to YAML; **C** write comments into `data/ecore-config.json` too | **A**: no new format or parser, and what emcc writes itself keeps its help in the manifests |

## 5. Follow-ups from the plugin gap analysis

**From [the plugin gap analysis](plugin-gap-analysis.md) (2026-11-16), with the owner's answers of the same day:**

| | Answer |
|---|---|
| GQ1 | **A:** M9 does the minimum that lets an outsider build and keep a plugin: the SDK kit, the version rule, web service keys of a plugin's own, the documents, and three small fixes |
| GQ2 | **A:** SDK 1.9.0 adds a channel kind a plugin declares, in part P; `fmv` declares the camera pose. The PDA's CR confirms that it fits |
| GQ3 | **A:** in M9 the admin guide says that a plugin is trusted code; ECore's check at load comes later |

**Two kinds of ids:** the task ids here continue section 2's (A, B, C, D, G, T, L). The "Gap" column holds the analysis's gap ids, G1 to G27, which are not the UDA's tasks G1 and G2. Every contract change goes through the PDA's CR.

| # | Task | Owner | Track | Gap | After |
|---|---|---|---|---|---|
| A2 | The plugin gap analysis (this branch) | ACA | P | – | – |
| A3 | `agents/pca.md`: listeners are no longer current, and the reading list lacks `sdk-v1.md` and the playbook | ACA | P | G5 | – |
| A4 | **ADR-0059 amended** (while it was Proposed): the camera pose is a channel kind that `fmv` declares, not an SDK type (its points 3 and 6, and its consequences). **Written with A5** (section 6), before D8: point 3 keeps the SDK type as the fallback if D8 finds that a declared kind does not fit. **D8 settled it** (CR-0048 point 4, approved, owner ZB A): the kind fits, so the fallback goes. ADR-0059 is accepted by then, so the change is **CR-0049** (ADR-0059 points 3 and 6 and the consequences, and ADR-0058's index row), proposed by the ACA, 2026-11-16, **approved** (owner, ZH A, 2026-11-16) | ACA | U | G3 | D8 |
| D3 | **Widened:** the template at `^1.8.0` (icons, no repeated title); **one manifest guard** (the schema, the hints, ADR-0060's title and description rule); the link example end to end; the template built from the SDK kit | PDA | P | G1, G24 | D1 |
| D4 | **Widened:** a **current-state reference** of the SDK per concept, without history; the rules now stated only outside `docs/plugins/`; a naming rule for outside plugin ids. The fixes to `playbook.md:90`, `sdk-v1.md:1206` and the two SDK READMEs come first | PDA | P | G5, G13 | D3 |
| D7 | **SDK 1.9.0 CR, part P, added:** a web part's shared versions by a compatibility rule, not equality; web service keys of a plugin's own | PDA | P | G2, G7 | – |
| D8 | **SDK 1.9.0 CR, part P, added:** a channel kind a plugin declares, with a JSON payload. The CR says whether it fits the camera pose; if it does not, the pose type stays in D2. **It fits** (CR-0048 point 4, approved, owner ZB A; PQ2 A: ECore checks the size, at most 64 KiB, and the schema at `send`) | PDA | P | G3 | – |
| D2 | **Changed by D8 and YG A:** part U is raw pictures into the conversion service, with the H.264 back to the plugin (ADR-0059 point 7), and a channel's state for its senders (ADR-0059 point 5). The pose's shape moves to `fmv`'s brief (D6u) | PDA | **U** | G11 | D8 |
| B5 | **The SDK kit** next to the release: the SDK and test kit jars with sources and Javadoc, a stand-alone parent POM, the web SDK as a package with types, the shell's import map, the schemas, the template; its readme lists the release runtime's Java modules | MCA, with the PDA and the CDA | P | G1, G20 | D3 |
| C8 | D7 and D8 in ECore and the shell: the version rule and declared channel kinds. Part of C6 | CDA | P | G2, G3 | D7, D8 |
| C9 | **The topic bus:** a topic's type is its publishing plugin's, so that another plugin's subscription cannot break it. No contract change | CDA | P | G19 | – |
| G1 | **Widened:** the admin guide says how to install an outside plugin, that it is trusted code, and how its permissions are mapped to roles | UDA | P | G4 | B5 |
| T3 | **A spec** that builds the template from the SDK kit outside the repository, installs it in the release and loads it | ITA | P | G1, G2 | B5, C8 |
| L7 | **The plugin contract's later gaps**, each through its own CR: ECore's check of a plugin's code at load (G4), the map's neutral drawing steps (G6), contribution points (G8), more settings field kinds (G9), counters at plugin level (G10), changes on behalf of a user (G12), and G13 to G18, G21 to G23, G26 and G27 (a query by object id, added 2026-11-17) | PDA, CDA, PCA-map-view-2d | **M10** | as listed | – |

**Every gap has a place:** G1 to G3, G5, G7, G11, G19, G20 and G24 are in the rows above for M9, with G4's admin guide and G13's naming rule; G25 (the Linux encoder) is L1's; the others, and the rest of G4 and G13, are L7's.

**The CDA's load:** C8 adds declared channel kinds to C6, a mechanism in ECore's channel registry. It replaces the pose type that part U would have added, but it moves that work from the U track into P, where the CDA is already the bottleneck (section 3). The version rule and C9 are small.

## 6. The UAV camera's rendering in `fmv` (owner, YG A, 2026-11-16)

**The owner's decision, through the MCA:** a plugin declares compute threads; ECore creates, caps and shows them; `fmv` renders and muxes on them and sends from its output link; ECore's conversion service encodes raw pictures (only ECore starts ffmpeg, CR-0045); `uav-simulation` only computes poses (XQ A). ECore's rendering service (the first C7) is dropped.

**Written in:** [ADR-0064](../adr/0064-compute-tasks.md) (new: compute tasks, extending ADR-0004 and ADR-0036) and [ADR-0059](../adr/0059-uav-simulation-plugin.md) (amended while Proposed: points 3, 6, 7 and 8, superseding ADR-0058 points 1 and 3 and point 4's parts that were ECore's). ADR-0058 is Accepted, so it stays as it is; its index row notes the change. **Both accepted** (owner, YK A, 2026-11-16).

| # | Task | Owner | Track | After |
|---|---|---|---|---|
| A5 | ADR-0064, ADR-0059 amended with A4, the index rows, this section (branch `aca/compute-threads`) | ACA | P, U | – |

The new and changed rows are in section 2: D2, D9 (new: the compute tasks' contract), D6u, C7 (now compute tasks, P), C10 (new), F1, F2, G1, T4 (new) and S2.

**The CDA's load, again:**
- **P grows by C7**, compute tasks. It is modelled on the connection tasks ECore has: a thread per task, start, stop, restart, fence, an inbox, counters. Compared with C1 to C6 it is a medium task, and it waits only on D9.
- **U shrinks:** C10 adds an input mode and an output back to the plugin to the conversion service of M8 (T-211). The renderer, the muxing, the DTED reader and the imagery are no longer the CDA's.
- **PCA-fmv's F1 becomes the U track's largest task.** It can start on the renderer and the muxer from S10 before C7 and C10 are merged, with the test kit's fakes.
- The ACA's recommendation of section 3 stands: the U track starts only once C1 to C3 are merged.

**F2 stays in M9** (owner, YM B, 2026-11-16): the WMS fetch and `fmv`'s tile cache are not cut, though the imagery folder alone would keep the camera working offline.

**Questions for the owner, answered** (owner, YL A, 2026-11-16: A, A and A; written into ADR-0064 point 4, overview 4.2 and `CLAUDE.md` section 4). The table keeps them as asked.

| # | Question | Options | The ACA recommended | The owner's answer |
|---|---|---|---|---|
| YQ1 | How does the total cap count (ADR-0064 point 4)? | **A** running compute tasks: a start above the cap is refused, and declared threads that are not running block nobody; **B** each plugin's allowed threads are reserved at its start, in load order, and a plugin that does not fit gets none | **A**: idle declarations cost nothing, and the refusal is shown where it happens | **A** |
| YQ2 | If the UAV track is cut to M10, do compute tasks (D9, C7, T4) stay in M9? | **A** yes, as part P: the contract is general and frozen in 1.9.0, with no user until M10; **B** they move with the track, and part P loses them | **A**, as YG A puts them in P: a contract frozen in P must be built in M9 | **A** |
| YQ3 | `CLAUDE.md` section 4's concurrency rule names compute tasks: when? | **A** when ADR-0064 is accepted, with overview 4.2; **B** now | **A**: a rule for agents follows the accepted decision | **A** |
