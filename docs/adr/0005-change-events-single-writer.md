# ADR-0005: All object changes are change events through a single writer

- Status: Accepted
- Date: 2026-10-02
- Deciders: Owner (advised by ACA)

## Context
Many sources change objects at the same time: users in browsers, ingoing plugins, other plugins. Concurrent edits are resolved by "last write wins" for now, with locking possible later. History (audit and timeline playback) is required in a later phase and should not require a redesign.

## Decision
- Objects change **only** through a `ChangeRequest` sent to the **object store worker**, which is the single writer of the live picture.
- The object store validates the request, checks permissions, assigns a new `version` and a global `sequenceNo`, applies the change and publishes a `ChangeEvent` on the topic `objects.changed`.
- A change event contains: sequence number, object id, operation, new state, previous version, user, time, source and label.
- **Last write wins** in version 1. Change requests carry `baseVersion`, which is recorded but not yet enforced.
- Persistence, the live picture gateway and interested plugins all consume change events.

## Alternatives considered
- **Plugins write objects directly in a shared, thread-safe map:** simpler at first, but gives no global order, makes races possible and leaves nothing to build history on.
- **Full event sourcing from day one** (events as the only stored truth): ideal for history, but more work than the first milestones need. Our design keeps that path open.

## Consequences
- Race conditions on objects are impossible, and every change has a global order.
- History can be added by storing the change events in an append-only log. Timeline playback is replaying events up to a chosen time.
- Optimistic locking can be added by enforcing `baseVersion`.
- All changes pass through one worker. That is far above the expected load, and the store can be split by layer if needed.
