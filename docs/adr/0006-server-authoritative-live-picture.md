# ADR-0006: Server-authoritative live picture over WebSocket

- Status: Accepted
- Date: 2026-10-02
- Deciders: Owner (advised by ACA)

## Context
All users share the same live picture. A change by one user must appear for all others quickly. The map must handle at least 100 000 objects, and aggregation is allowed when zoomed out. Sending every change of every object to every browser would not scale.

## Decision
- The **server holds the master copy** of all objects (in memory, backed by persistence). Browsers hold only a view of it.
- Each browser session has **one WebSocket** carrying versioned JSON messages.
- The browser subscribes to an **area of interest** (viewport plus a margin, and zoom level). The server sends a snapshot of that area, then deltas from change events, filtered by the user's permissions.
- Beyond a zoom threshold, the server sends **aggregates** (clusters with counts) instead of individual objects.
- Edits from the browser are sent as change requests over the same WebSocket.
- Plugin web parts talk to their server parts through plugin-scoped channels on the same WebSocket, and through plugin-scoped HTTP endpoints.
- The messages are plain JSON over standard WebSocket (no STOMP or similar sub-protocol), defined jointly by the PDA (plugin channels) and the CDA (core messages).

## Alternatives considered
- **Send all objects to every browser:** simple, but 100 000 objects plus frequent updates times many users would overload the network and the browsers.
- **Polling over HTTP:** simpler infrastructure, but adds delay and load.
- **Server-Sent Events:** works only from server to browser; we also need browser-to-server edits on the same connection.

## Consequences
- Network traffic scales with what each user sees, not with the total number of objects.
- The server must keep a spatial index and track each session's area of interest.
- Aggregation thresholds and message sizes are decided by spike S3.
- With several servers in the future, sessions on different servers will need to share change events. That is a later decision.
