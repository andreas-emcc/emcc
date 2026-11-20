# ADR-0016: Project license Apache 2.0 and dependency license policy

- Status: Accepted
- Date: 2026-10-05
- Deciders: Owner (advised by the ACA; change requests CR-0001 by the MCA, CR-0002 by the PDA, CR-0003 by the CDA and MCA)

## Context
The project needs a license of its own. Agents also add third-party dependencies all the time, and every dependency that ships with the product brings license obligations. The interim rule in `CLAUDE.md` allowed only MIT, BSD, Apache-2.0 and EPL-2.0. Real dependencies soon went beyond that list:
- The web build toolchain (Vite and its CSS tooling) uses MPL-2.0, CC-BY-4.0, BlueOak-1.0.0, CC0-1.0, MIT-0 and ISC, but only at build time.
- OpenLayers (ADR-0009), which ships to the browser, pulls in ISC, Zlib and CC0-1.0 packages.
- Spring Boot's default logging implementation, Logback (ADR-0002), is dual-licensed EPL-1.0 or LGPL-2.1 and ships in the server.

## Decision
1. **The project is licensed under the Apache License 2.0** (owner, 2026-10-04). The official text is in the root `LICENSE`, owned by the ACA.
2. **Dependency licenses**, with exact versions pinned:
   - **Shipped or linked into the product:** MIT, BSD-2-Clause, BSD-3-Clause, Apache-2.0, EPL-2.0, ISC, Zlib and CC0-1.0, and combinations of these (CR-0002).
   - **EPL-1.0:** allowed in shipped code only for unmodified binary dependencies, such as Logback. For dual-licensed libraries the project uses the EPL option, never the LGPL option (CR-0003).
   - **Dev-only tools** (build, lint, test; nothing shipped): additionally MPL-2.0, CC-BY-4.0, BlueOak-1.0.0 and MIT-0 (CR-0001).
   - **Anything else**, or a dev-only license in shipped code, needs the owner's approval through a change request.
3. **Attribution:** the copyright and license texts of every shipped dependency ship with the software, in a generated third-party notices file (task T-028).

The operative rule is in `CLAUDE.md` section 4. This ADR records why.

## Alternatives considered
- **MIT for the project:** simpler, but gives no explicit patent grant. Apache 2.0 includes one and is common in the Java ecosystem the project relies on.
- **A copyleft license for the project (e.g. GPL):** would restrict reuse of the showcase and complicate combining it with EPL-licensed dependencies.
- **Only the original four permissive licenses for dependencies:** would rule out OpenLayers (an accepted ADR), Vite's toolchain and Spring Boot's default logging.
- **Approving each package separately:** slow, and gives no extra safety for well-understood permissive licenses.
- **Replacing Logback with Log4j2 (Apache-2.0):** possible, but costs configuration work and takes the project off Spring Boot's default path. Rejected by the owner (CR-0003).

## Consequences
- All allowed licenses for shipped code can be used as dependencies of an Apache-2.0 project. EPL-licensed libraries stay unmodified binary dependencies and are never copied into the source tree.
- The deliverables need a third-party notices file (T-028), and a license check of the Maven and npm trees in `tools/` is needed so that shipped dependencies can be verified automatically.
- **GeoTools (LGPL-2.1) is not covered.** ADR-0001 named it as an advantage of Java, but using it needs a change request. The planned geospatial needs are covered by allowed libraries: Proj4J (Apache-2.0), NGA `mgrs-java` (MIT) and JTS (EPL-2.0 or EDL-1.0, a BSD-3-Clause license).
- New license questions are handled as change requests and, when the owner approves, added to `CLAUDE.md` section 4 and noted here as a superseding ADR if the policy itself changes.
