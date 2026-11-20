# ADR-0002: Spring Boot only at the edge; ECore and plugins in plain Java

- Status: Accepted
- Date: 2026-10-02
- Deciders: Owner (advised by ACA)

## Context
The server needs HTTP, WebSocket, OIDC token validation and serving of static web files. Spring Boot provides all of these, is well known by agents, and integrates easily with Keycloak. But Spring's dependency injection, annotations and life cycle would compete with our own plugin host and threading model if used everywhere. Plugins should also stay simple and independent of any web framework.

## Decision
- **Spring Boot** is used only in the `server/app` module: the "edge" that handles HTTP, WebSocket, security and static files.
- The edge is thin. It translates incoming requests into ECore messages and outgoing messages into responses.
- **ECore** and the **Plugin SDK** are plain Java with no Spring dependency.
- **Plugins depend only on the Plugin SDK.** They never see Spring. Plugin HTTP endpoints and WebSocket channels are routed by ECore (overview 4.5).

## Alternatives considered
- **Spring everywhere, with plugins as Spring beans:** less code at first, but ties plugins to Spring, mixes Spring's life cycle with our plugin life cycle and threading rules, and makes out-of-process plugins harder.
- **Quarkus or Micronaut:** fast and light, but they resolve much at build time, which works against loading plugin jars at start-up.
- **A minimal HTTP library (e.g. Javalin, Helidon SE):** explicit and small, but we would build security and WebSocket support ourselves.

## Consequences
- The core's threading and plugin rules are fully under our control.
- Spring could be replaced later by changing only the edge module.
- Some routing code in ECore is needed to expose plugin endpoints without Spring.
