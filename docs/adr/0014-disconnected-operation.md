# ADR-0014: No internet access at runtime

- Status: Superseded by ADR-0030 (owner, 2026-10-12)
- Date: 2026-10-02
- Deciders: Owner (advised by ACA)

## Context
The system has internet access during development and demonstrations only. It must work in a disconnected environment. OpenStreetMap may be used in development and demos, while WMS servers are used when disconnected.

## Decision
- **Nothing is fetched from the internet at runtime**: no CDNs, web fonts, map styles, scripts or license checks. Everything the browser needs is served by the emc2 server.
- Internet-only sources (e.g. `basemap-osm`) are separate plugins that can simply be left out of a disconnected installation.
- Deliverables are self-contained (Java runtime image, built web files, plugins, configuration). Installing them requires no network.
- Builds use pinned dependency versions (Maven, npm lock file), so that a mirror of the dependencies can be set up for building offline later.

## Alternatives considered
- **Allowing optional internet resources with fallbacks:** easy to get wrong, and failures would only show up in the field.

## Consequences
- Agents must never add runtime references to external URLs. The ITA tests the application with network access blocked.
- Keycloak, the database and WMS servers must all be available locally in disconnected environments.
- Fonts, icons and symbol resources are bundled with the application.
