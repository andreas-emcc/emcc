# ADR-0008: Web client: TypeScript, React and Vite

- Status: Accepted
- Date: 2026-10-02
- Deciders: Owner (advised by ACA)

## Context
The client runs in a web browser. It consists of a shell (Map Pane, Control Pane, settings view, monitor view) plus web parts contributed by plugins, written by different agents. The map library, the symbol library and the coordinate libraries are JavaScript/TypeScript.

## Decision
- The web client is written in **TypeScript** (strict mode).
- The UI framework is **React**. The build tool is **Vite**. TypeScript packages are managed as **npm workspaces**.
- Plugin web parts are separate **ES modules**, loaded by the shell at start-up with dynamic `import()`.
- Shared libraries (React, OpenLayers, milsymbol, the web plugin SDK) are provided once by the shell through an **import map**. Plugin builds treat them as external (proven in spike S4).
- Plugin web parts use only the **web plugin SDK** to interact with the shell, the map and the server.

## Alternatives considered
- **Angular:** very structured, which helps consistency, but heavier, and sharing it between separately built plugin modules is harder.
- **Vue or Svelte:** good, but smaller ecosystems and somewhat less reliable output from agents.
- **Web components only:** framework-neutral plugin UI, but more low-level work for every plugin and fewer ready-made components.
- **Building all plugin web parts together with the shell:** simplest, but every plugin change would require rebuilding the shell, which conflicts with the plugin model.

## Consequences
- The largest ecosystem, and the most reliable code from agents.
- React's freedom means the PDA's design pattern must define how plugin UI is structured, so plugins look and behave alike.
- The import map setup needs care with versions: plugins must be built against the same shared library versions as the shell.
