# ADR-0011: Persistence manager with file store and PostgreSQL/PostGIS

- Status: Superseded by ADR-0024 (owner, 2026-10-10)
- Date: 2026-10-02
- Deciders: Owner (advised by ACA)

## Context
All writes to persistent storage must go through a persistence manager, so that the storage technology can change (databases, local files and so on). The application is self-hosted on Windows and Linux, must work disconnected, and will later need history.

## Decision
- The **persistence manager** in ECore is the only path to persistent storage, for core and plugins. Plugins access it through the SDK.
- It stores objects and layers (fed by change events), plugin documents (a namespaced key mapping to JSON) and settings. Later also an append-only event log.
- Two implementations, selected by configuration:
  - **File store** (JSON files) for the internal demo (M0).
  - **PostgreSQL with PostGIS** from the first demo (M1).
- Writes are **write-behind**: a change is done when applied in memory, and persistence follows asynchronously.

## Alternatives considered
- **SQLite:** a single file and simple, but weaker for concurrent writers and for scaling to several servers.
- **A document database (e.g. MongoDB):** flexible, but weaker spatial queries than PostGIS and a less familiar choice for self-hosted, disconnected sites.
- **Write-through:** no data lost on a crash, but every change waits for the database.

## Consequences
- Two implementations early on prove the abstraction is real.
- PostgreSQL/PostGIS is free, runs on Windows and Linux, and has strong spatial support for area queries and future history.
- A crash can lose the last moments of changes. This is acceptable now, and write-through can be added later per data type.
