# ADR-0018: Change protocol for objects and layers

- Status: Accepted (owner, 2026-10-05)
- Date: 2026-10-05
- Deciders: Owner (advised by the ACA; designed by the PDA in data model v0)
- Extends: ADR-0005 (single writer) and ADR-0007 (common data model)

## Context
ADR-0005 makes the object store the single writer of **map objects**: a change request goes in, a change event comes out. Data model v0 and SDK v0 (PDA, 2026-10-05) went further, and the CDA's object store (T-012) needs this written down as architecture:
- Layers change too (create, rename, reorder, delete), and ADR-0005 does not mention them.
- ADR-0005 only describes the success case. Plugins need to know why a change was refused (the `draw-symbols` and `layer-panel` briefs), and a requester must never wait for an answer that does not come.
- ADR-0007 says that only the owning plugin writes its extension namespace and that everyone else forwards it untouched. It does not say **where** this is enforced. The SDKs accept any namespace in a request, because blind forwarding means that requests routinely carry other plugins' data.

## Decision
1. **Objects and layers both change only through change requests** to the object store, the single writer (`entityType`: `object` or `layer`). Layer changes get sequence numbers and change events like object changes.
2. **Every change request gets exactly one answer**, matched by `requestId`:
   - a **change event**, published on `objects.changed` to everyone (ADR-0005), or
   - a **change rejection**, sent to the requester only, with a fixed code: `VALIDATION_FAILED`, `ENTITY_NOT_FOUND`, `ENTITY_EXISTS`, `LAYER_NOT_FOUND`, `LAYER_NOT_EMPTY`, `PERMISSION_DENIED`, `INTERNAL_ERROR`.

   An update equal to the stored state is applied like any other change. A requester that gets no answer at all (connection lost, timeout) learns it from its SDK as "outcome unknown", which is not a rejection code.
3. **The requester chooses the id** of a new entity (UUID version 7). Requests carry `baseVersion`, which is recorded but not enforced until optimistic locking is added (a new rejection code such as `CONFLICT` is then a minor change).
4. **The object store is the single place that enforces extension ownership** (ADR-0007), following model rule 5:
   - On **update**, it applies only the requesting plugin's own namespace (`source.plugin`): present replaces it, `{}` removes it, absent keeps it. **Every other namespace is taken from the stored entity, whatever the request contains.** Foreign namespaces in a request are **ignored, never a reason to reject**, because blind forwarding puts them there.
   - On **create**, all namespaces in the request are accepted, so that imported objects keep the extensions they were exported with.
   - The SDKs do not filter namespaces. They set `source.plugin` from the calling plugin's context, never from data the plugin supplies. The server sets `source.user` from the login session.
5. The normative details (the rules the schema cannot express, the codes, the examples) are in `model/README.md` and `model/schemas/`, owned by the PDA. The object store implements model rules 1–8 and 10–13; `model/examples/invalid-by-rule/` holds the cases for its tests.

## Alternatives considered
- **A separate writer for layers:** simpler per worker, but two event streams would have to be merged into one order for persistence, the live picture and later history.
- **Answer only failures, and let success be implied by the event on the topic:** the requester would have to watch the topic for its own `requestId` and could not tell a slow answer from a lost one.
- **Reject requests that carry changed foreign namespaces:** catches bugs, but a requester's copy of another plugin's data may simply be older than the stored one. Rejecting would turn normal concurrency into errors.
- **Enforce namespace ownership in the SDKs:** the SDKs would have to strip data they must forward. It would also leave the server without enforcement once a plugin runs in its own process.

## Consequences
- The CDA's object store (T-012) has one complete contract: it accepts change requests for objects and layers, answers each exactly once, and enforces extension ownership itself.
- Plugins always learn the outcome of their requests, and their user interfaces can explain refusals.
- Later security work (M1): rejections must not reveal entities the requester may not see, for example through `ENTITY_EXISTS`.
- Plugins are trusted (ADR-0003), so the create rule (all namespaces accepted) is acceptable. It must be revisited if untrusted or out-of-process plugins arrive.
