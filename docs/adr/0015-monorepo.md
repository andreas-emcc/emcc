# ADR-0015: One repository with one owning agent per folder

- Status: Accepted
- Date: 2026-10-02
- Deciders: Owner (advised by ACA)

## Context
Many agents work in parallel on the core, the SDK, the data model, plugins and tests. Their work must fit together and be tested as a whole. Version control starts with local git and moves to GitLab later.

## Decision
- All code and documentation live in **one git repository** (monorepo), laid out as in [overview section 5](../architecture/overview.md#5-repository-layout-normative).
- **Every folder has exactly one owning agent.** Other agents may read any folder, but only change their own. Changes needed elsewhere are requested through the MCA.
- Java parts are built with one Maven multi-module build. TypeScript parts are built with npm workspaces. A top-level script (owned by the MCA) builds and tests everything.
- Contracts (`model/`, `server/plugin-sdk/`, `web/plugin-sdk/`) are frozen per milestone. Changes after freezing go through change control.

## Alternatives considered
- **One repository per plugin and per core part:** strong separation, but versioning across repositories and integration testing become much harder, especially for agents.

## Consequences
- One commit can change a contract and all its users consistently, when approved.
- Integration tests run against the exact combination of parts in one commit.
- Ownership must be respected by convention and review. The MCA checks that commits only touch the author's folders.
