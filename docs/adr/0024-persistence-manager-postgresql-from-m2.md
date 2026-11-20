# ADR-0024: Persistence manager with file store, and PostgreSQL/PostGIS from M2

- Status: Accepted (owner, 2026-10-10)
- Date: 2026-10-10
- Deciders: Owner (advised by the ACA)
- Supersedes: ADR-0011 (persistence manager with file store and PostgreSQL/PostGIS)

## Context
ADR-0011 put all storage behind a persistence manager, with a file store for the internal demo (M0) and PostgreSQL with PostGIS from the first demo (M1).

While planning M1, the owner moved PostgreSQL/PostGIS to M2 (2026-10-10), so that M1 concentrates on login, CoT and the polar map. The file store from M0 is enough for the M1 demo: one server, with the whole picture in memory.

Everything else in ADR-0011 is unchanged and is restated here, so that this ADR stands on its own.

## Decision
- The **persistence manager** in ECore is the only path to persistent storage, for core and plugins. Plugins access it through the SDK.
- It stores objects and layers (fed by change events), plugin documents (a namespaced key mapping to JSON) and settings. Later also an append-only event log.
- Two implementations, selected by configuration:
  - **File store** (JSON files): M0 and M1.
  - **PostgreSQL with PostGIS:** from **M2**. Geometries use geodesic semantics, for example the `geography` type (ADR-0019).
- Writes are **write-behind**: a change is done when applied in memory, and persistence follows asynchronously.

## Alternatives considered
- **PostgreSQL in M1, as ADR-0011 planned:** more work in M1, and a database to install on every test and demo machine before the login and CoT work is done.
- **SQLite:** a single file and simple, but weaker for concurrent writers and for scaling to several servers.
- **A document database (e.g. MongoDB):** flexible, but weaker spatial queries than PostGIS and a less familiar choice for self-hosted, disconnected sites.
- **Write-through:** no data lost on a crash, but every change waits for the database.

## Consequences
- **M1 keeps the file store.** The data model's major version 1.0.0 needs a migration of stored M0 data in the file store (ADR-0023: `dataType` and `dataSource`).
- **Area-of-interest queries in M1** (spike S3) run on the in-memory picture, not in a database.
- The second implementation, which proves that the abstraction is real, arrives in M2.
- **PostgreSQL/PostGIS runs as a separate local service.** It is not shipped with emc2: PostGIS is GPL-2.0, and the PostgreSQL licence is not on the list in `CLAUDE.md` section 4. The JDBC driver is BSD-2-Clause.
- A crash can lose the last moments of changes. This is acceptable now, and write-through can be added later per data type.
- ADR-0011 is superseded. ADR-0019's "PostGIS from M1" now reads M2. Its rule (geodesic semantics in storage and queries) is unchanged.
