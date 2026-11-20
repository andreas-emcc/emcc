# ADR-0007: Common data model: WGS84, mandatory labels, blind-forwarded extensions

- Status: Accepted
- Date: 2026-10-02
- Deciders: Owner (advised by ACA)

## Context
Objects are exchanged between core, plugins, browsers and external systems, in Java and TypeScript. Points are stored in one coordinate system and converted for display. Security labels (STANAG 4774) are required on all information from the first version. Plugins extend objects with their own fields, and information must not be lost when objects pass through plugins that do not understand those fields.

## Decision
- The common data model is specified in **JSON Schema** in `model/`, owned by the PDA (first draft by the ACA). It is the normative contract for both Java and TypeScript.
- All coordinates are **WGS84** geographic, always in **longitude, latitude** order (as in GeoJSON), in decimal degrees.
- Every object and layer has a **mandatory security label** with the STANAG 4774 structure.
- Plugin-specific data lives in `extensions`, keyed by plugin namespace. **Only the owning plugin writes its namespace. Everyone else forwards it untouched** (blind forwarding). ECore never drops unknown namespaces.
- Objects carry a `version` and metadata (who, when, source, external id).
- The shape of the model is summarized in [overview section 4.6](../architecture/overview.md#46-common-data-model-summary).

## Alternatives considered
- **Java classes as the source of truth:** natural for the server, but it makes the TypeScript side a second-class copy, and it is harder for future external parties to read.
- **Store coordinates in the user's chosen system:** makes every plugin handle many coordinate systems and invites conversion errors.
- **Extensions as typed sub-classes:** type-safe, but requires every plugin to know every other plugin's types, which breaks blind forwarding.

## Consequences
- One unambiguous coordinate system everywhere. Conversions only happen at display and input, and at format boundaries.
- Label-based access control can be added later without changing the model.
- The PDA decides whether Java and TypeScript types are generated from the schema or written by hand and verified by contract tests.
- Open for the PDA: the altitude reference, and geometry types that GeoJSON lacks (circle, ellipse, corridor, sector).
