# M7 plan

- **Status:** proposed by the ACA (2026-11-11), for the owner's approval. The owner answered the questions on 2026-11-11 (table below). Section 5 keeps the questions and recommendations as asked; where an answer differs (Q2, Q4, Q5, Q8), the answers table holds.
- **The aim** (owner, 2026-11-11): M7 is **the first release for outside users**, and it should come out quickly.
- **Scope:** the board's M7 section and rows (`docs/status.md`, 2026-11-11):
  - T-152, the Scenario button;
  - T-156, symbol palettes;
  - T-157, a general `settings/` folder;
  - T-166, terrain's height map, and T-167, the live-drag spike;
  - T-173, NVG in and out (ADR-0055);
  - T-174, categories in the Settings workspace;
  - T-175, listing and emptying a layer;
  - T-176, appending points to a line;
  - the sensor package T-177 to T-186.
- **Not in M7:** the board's M8 section. That is OpenTelemetry (T-060), PostgreSQL/PostGIS with spike S8, Linux tests, GeoTIFF, T-163, the WinTAK fixtures and T-129's ATAK phone check. **The M7 release is Windows x64 only.**
- **Contracts:** SDK and data model 1.6.0, in CR-0041. The PDA writes it together with every M7 brief on `pda/m7-briefs`.
- **The outside users** demonstrate and promote emcc in a controlled environment (owner, 2026-11-11).

## The owner's answers for this plan (2026-11-11)

| | Answer |
|---|---|
| Q1 | **A:** plugins declare palettes in their manifest; cot declares "CoT" (section 1) |
| Q2 | **Absolute paths stay,** so that height data can sit on storage shared with other apps. A path relative to emcc is marked with a prefix, `%emcc%/` (section 1) |
| Q3 | **A:** the PDA adds the `category` line to every plugin's manifest in one branch. This is a one-off exception to ownership for T-174, not a standing rule, so `CLAUDE.md` does not change. CR-0041 states it (the `category` line only, T-174 only), so that the PDA's branch has a written basis |
| Q4 | **Later:** T-167's spike runs in M7. Whether live drag ships in M7 is decided once the owner sees how quickly M7 moves |
| Q5 | **No security review in M7.** The SRA reviews after M7, before M8 |
| Q6 | **B:** the disclaimer goes in the readme only |
| Q7 | **A:** no promise that stored data carries over; the readme says so |
| Q8 | **Outside this project:** the owner hands out paper instructions made in Word. Nothing to do here |
| Q9 | **A (2026-11-12):** the release writes a log file by default (section 4, "The server log"). A diagnostics download and browser errors in the server log are not in M7 |

## 1. Decisions and ADRs

| Task | Form | Decision |
|---|---|---|
| T-173 | ADR-0055 (accepted, OM A) | No new decision. One correction, in a note on its index row: the Consequences give "the map view's `core.text`" to the CDA, but `map-view-2d` is PCA-map-view-2d's plugin |
| T-157 | Dated note on ADR-0049's index row (Q2) | Below |
| T-156 | Dated note on ADR-0010's index row (Q1 A); the field's name is CR-0041's | Below |
| T-174 | None | The owner decided QC A and QD A: a fixed list in the SDK and a manifest field. The PDA adds the line to every manifest (Q3 A) |
| T-152, T-175, T-176, T-177 to T-186 | None | Briefs and SDK 1.6.0 inside the existing ADRs (ADR-0032, 0037, 0040, 0046, 0048, 0051) |
| T-166, T-167 | None now | ADR-0049's note for the height map follows the terrain brief (T-166). T-167's outcome is Q4 |

**T-157, the note on ADR-0049** (Q2):
- **Absolute paths stay as they are.** A plugin's folder setting (the manifest's `folders`) may still be any absolute path, for example shared storage that other apps use too.
- **The `%emcc%/` prefix.** A value that starts with `%emcc%/` (or `%emcc%\`) is relative to the emcc folder: the folder the server was started in, which `start.bat` sets.
  - ECore replaces the prefix and resolves the rest below that folder.
  - A result whose real path, links included, lies outside the emcc folder is unusable, as a missing folder is today.
  - `%emcc%` is emcc's own marker, not an environment variable, and it is the same on Windows and Linux.
- **Any other value is unusable,** as today: a relative path without the prefix, or an absolute path with `%emcc%` inside it. The path still comes only from an admin's settings (point 4).
- **terrain's default** is `%emcc%/settings/terrain`, so the Sundsvall demo zip (CR-0037), unpacked into the emcc folder, works without a setting.
- **The release:**
  - `tools/release.mjs` makes an empty `settings/` folder with a short readme;
  - the Monitor shows the setting as typed and the folder it resolves to.
- **Who builds it:**
  - CR-0041: the manifest's description and the SDK's `LocalFolder` documentation;
  - ECore: the CDA;
  - terrain's default: PCA-terrain;
  - the release: the MCA.

**T-156, the note on ADR-0010** (Q1 A):
- **Palettes in the manifest.** A plugin may declare symbol palettes in its manifest (data model 1.6.0, `symbolPalettes`). Each palette has an id, a name and a list of symbols (standard and code, with an optional label), with limits for the brief.
- **draw-symbols** shows "General symbols", its catalogue as today, and then every enabled plugin's palettes, which the web SDK gives as `ctx.symbolPalettes` (as it gives `ctx.dataTypes`).
- **cot** declares "CoT" from its table of 147 rows, and a test keeps the manifest and the table in step.
- **No runtime API,** and no plugin writes another plugin's palette.

## 2. Lanes

The lanes run in parallel. Each needs only what its "Waits for" column names.

| Lane | Who | Tasks | Waits for |
|---|---|---|---|
| A. Briefs and CR-0041 | PDA | All M7 briefs; CR-0041 (`core.text`; outbound `POST`; raw XML bodies; service endpoints; `category`; the `%emcc%/` folders; a top-bar button per workspace; `symbolPalettes`; what T-176 and T-181 to T-184 need from the map view, if anything) | — (under way) |
| B. Contracts | PDA | SDK and data model 1.6.0, in parts on `integration/sdk-v1.6`, NVG's parts first | The owner's approval of CR-0041 |
| C. ECore and shell | CDA | T-175 at once (no contract change). Then: the edge for T-173 (`POST`, raw bodies, service endpoints); T-157; T-174's grouping; T-152's top bar; T-183 if ECore's subscription changes | B, per part |
| D. Map view | PCA-map-view-2d | `core.text` (T-173); Append mode (T-176); the display switches (T-182); off-screen relation ends (T-183); relation fade (T-186); relation colour (T-181) and overlay labels (T-184) if needed | Briefs; B for the contract parts. **The busiest lane:** it starts with T-186 and T-183, which change no contract |
| E. Simulator | PCA-simulator | T-177, T-178, T-180 at once (brief only); T-179, T-184, T-185; T-152's button; T-176's route check | Briefs; D for T-184's labels if the overlay needs them |
| F. gmti | PCA-gmti | T-181, T-182's marking, T-185 | Briefs; B if T-182 needs a marker |
| G. NVG | PCA-nvg (new) | The codec first: StAX, the mapping, tests against ANET's XSDs. Then the links and the panel | The brief for the codec; B and C for the links |
| H. Terrain | PCA-terrain | T-166; T-167, the spike only (Q4); T-157's default | The brief; C for T-157 |
| I. Drawing | PCA-draw-symbols, PCA-draw-shapes, PCA-cot | T-156 (with cot's palette); T-176's button | Briefs; B and D |
| J. Categories | PDA (Q3 A) | T-174's line in every manifest, in one branch | B's `category` part |
| K. Release | ITA, UDA, MCA, ESA | Section 4. The SRA follows after M7 (Q5) | The RC |

**Order:**
1. The owner's answers to section 5, then CR-0041 and the briefs approved.
2. Lanes C, D, E and H start at once on what needs no contract change.
3. SDK 1.6.0, NVG's parts first: NVG is the longest chain (contract, then the edge, then the plugin, then tests).
4. The rest of the tasks, as their parts land.
5. RC1: a full ITA run, the UDA's manual and the owner's test.
6. RC2 if needed, then the final release.
7. After M7 and before M8: the SRA's security review (Q5).

## 3. Risks for speed

- **NVG is the critical path.** Its codec can start before the SDK, and the ESA's ANET is ready (T-173).
- **Lane D carries seven tasks.** The briefs should keep map-view changes small and settle early which of T-181, T-182 and T-184 need a contract at all.
- **T-167 can grow:** if the spike passes, its follow-up is a CR and two plugins. The owner decides later, by M7's pace (Q4).

## 4. Release checklist for outside users

Beyond the tasks, before the final release:
- [ ] **The release readme** (`tools/release.mjs`, MCA), with the product name emcc throughout:
  - what emcc is;
  - Windows x64 only;
  - how to start it with and without login, and the network guard of the no-login mode;
  - the demo height zip;
  - the NVG provider, which is open to every caller when an admin enables it (ADR-0055 point 5.3);
  - the known limits;
  - the disclaimer "A demonstration mock-up, not for operational use" (Q6);
  - that stored data may not carry over to later releases (Q7).
- [ ] **The third-party notices** are complete for exactly what is zipped:
  - npm and Maven dependencies, mil-sym-ts's CC-BY-3.0 note, Temurin's `legal/`, Natural Earth;
  - the SRTM attribution in the demo zip;
  - a licence scan against ADR-0016, with dev-only tools left out;
  - nothing from ANET or the TIDE XSDs ships (ADR-0055 point 8).
- [ ] **`LICENSE`** (Apache-2.0) in the zip.
- [ ] **No secrets in the zip,** and no demo data other than what is intended. The `data/` folder is fresh.
- [ ] **The user manual for M7** (UDA), written against the RC and shipped with or beside the zip: NVG import, export and links, categories, Append, emptying a layer, the sensor package and palettes.
- [ ] **The server log** (Q9; `tools/release.mjs`, MCA). Today the server logs only to the console, so the log is lost when the window closes, and the readme wrongly promises a `logs/` folder.
  - The release writes `logs/emcc.log`, rolling at 20 MB and keeping 14 files.
  - The defaults sit where `application-local.properties` can change them, not on the command line. That way an admin can also set one plugin's level, e.g. `logging.level.plugin.cot=DEBUG`.
  - The readme says where the log is. The manual (UDA) says the same, and that the log is what to send with a problem report.
  - The ITA's run checks that the file is written.
- [ ] **A full ITA run** on the RC, with Keycloak, TAK Server and ANET running.
- [ ] **Release notes:** what is new since M6 and what is not in M7 (the M8 list). Handing the release out, and how users report problems, happens outside the project (Q8).
- [ ] **After M7, before M8:** the SRA's security review (Q5). It covers:
  - dependencies against public vulnerability databases;
  - NVG's XML parser;
  - the service endpoints without authentication;
  - the defaults: the no-login network guard, the bind address and loopback for listening connections.
- [ ] **The version** is shown in the UI and the readme, and the `m7` tag goes on the released commit.
- [ ] **The SDD and the presentation** (ACA): updated for M7 if the owner wants them for outside readers.

## 5. Questions for the owner

| # | Question | Options | ACA's recommendation |
|---|---|---|---|
| Q1 | T-156: where do palettes come from? | **A:** plugins declare them in their manifest (cot's "CoT"), in CR-0041. **B:** draw-symbols' own lists, with "CoT" as a copy of cot's table and no contract change | **A.** The list stays with the plugin that knows it, and a later plugin (nvg, ais) can add its own. It is one small field in a CR that is being written now. B is quicker only for draw-symbols, and its copy can drift from cot's table |
| Q2 | T-157: what is a relative folder relative to? | **A:** the `settings/` folder (terrain's default is `terrain`). **B:** the emcc folder (default `settings/terrain`), still confined to `settings/` | **A.** It is shorter, and a relative path can never point outside `settings/` |
| Q3 | T-174: who adds the `category` line to each manifest? | **A:** the PDA, in one branch, for every plugin: an ownership exception like a module's registration line. **B:** each PCA, in its own branch | **A.** It saves about 18 relayed prompts, and the categories are the owner's fixed list (QC A) |
| Q4 | T-167: if the spike passes, does live drag ship in M7? | **A:** the spike only in M7, and live drag in M8. **B:** live drag in M7 | **A.** It keeps M7 fast; the spike's numbers still decide M8 |
| Q5 | How much security review before the release? | **A:** the SRA reviews the whole release candidate, dependencies included. **B:** only NVG's parser and service endpoints | **A.** It is the first release for outside users |
| Q6 | A disclaimer? | **A:** "A demonstration mock-up, not for operational use" in the readme, the manual and the UI's About. **B:** in the readme only | **A** |
| Q7 | Stored data across releases | **A:** no promise. M7 starts with a fresh `data/`, and M8's PostgreSQL may need another fresh start; the readme says so. **B:** M7's data must carry over to M8 | **A.** B would make M8 build a migration from the file store |
| Q8 | How do outside users get emcc and report problems? | **A:** the owner hands out the zip and names a contact. **B:** a public release page with an issue tracker | **A** for M7: nothing new to set up. The owner may know better |
| Q9 | Logging (asked 2026-11-12): the server logs only to the console, and browser errors stay in the browser | **A:** a file log in the release by default, with per-plugin levels; the readme and manual say where it is (MCA, UDA). **B:** A, plus a diagnostics zip in the monitor view and browser errors sent to the server log (CDA). **C:** nothing in M7 | **A.** It is small, and it gives a log to analyse when tests with external systems go wrong. B adds to the CDA's busy lane |
