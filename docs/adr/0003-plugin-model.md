# ADR-0003: Plugins: in-process, loaded at start, optional server and web part

- Status: Accepted
- Date: 2026-10-02
- Deciders: Owner (advised by ACA)

## Context
All functionality beyond the core is delivered as plugins. Some plugins need server-side code (e.g. listening for CoT over the network, which a browser cannot do); others need browser code (buttons, settings, drawing); many need both. Plugins are written within the project and are trusted. Loading or unloading plugins while running is not required. Some plugins may later need their own process (e.g. time-critical communication).

## Decision
- A plugin is **one package**: a `plugin.json` manifest plus an **optional server part** (Java jars) and/or an **optional web part** (ES modules). Both parts are versioned and released together.
- Server parts run **in the same process** as ECore. Each plugin gets its **own class loader**, which sees only the Plugin SDK and the plugin's own jars.
- Plugins are discovered, validated, ordered by dependencies and started **at application start-up only**. They are stopped at shutdown.
- A plugin that fails to start is disabled and reported. Others continue unless it is marked as required.
- Later, out-of-process plugins are connected through a **stub plugin** that implements the same SDK interfaces and forwards over inter-process communication.
- Plugins are trusted. The class loader is for dependency separation, not a security sandbox.

## Alternatives considered
- **Hot loading and unloading:** not required, and adds much complexity (class loader leaks, state migration).
- **Every plugin in its own process:** strong isolation and exact monitoring, but costly in overhead and complexity. Kept as an option for individual plugins later.
- **Plugins compiled into the core:** simplest, but every plugin change would require rebuilding the core, and the boundary between agents' work would be weaker.

## Consequences
- Adding or updating a plugin requires restarting the server.
- A misbehaving plugin can affect the process (memory, CPU). This is mitigated by the concurrency rules and watchdog ([ADR-0004](0004-concurrency-workers-and-messages.md)), but not prevented.
- Per-plugin memory can only be measured approximately.
- The PDA defines the manifest, the SDK interfaces and a design pattern that all plugins follow.
