# ADR-0042: The layer lock, stored with the layer and enforced by the server

- Status: Accepted (owner, 2026-10-30, CC)
- Date: 2026-10-30
- Deciders: Owner (advised by the ACA; the owner's BP and BW in `docs/status.md`, "Milestone M4"; `docs/architecture/m4-plan.md`)
- Extends: ADR-0005 (changes through a single writer) and ADR-0018 (the change protocol)

## Context
The owner wants a lock in the layer list (BP, 2026-10-30). A locked layer keeps users from changing it by mistake, for example a layer of reference objects while others draw.

The lock is to be:
- stored with the layer;
- enforced by the server for every user;
- set or cleared by anyone who may edit the layer.

Incoming data still updates a locked layer (BP), and so does every plugin's server part, the simulator's commands included (BW).

Today the layer panel's eye is the only per-layer switch. It is local to one browser, it hides the layer and it locks nothing. Who may change a layer and its objects is decided by permissions alone: `objects.edit` and `layers.edit` in View, a declared workspace's edit permission elsewhere (overview 4.4, ADR-0039 point 7). The store already tells a user's change request from changes without a user: a plugin's server part, and ECore's own (overview 4.4).

## Decision
1. **A layer has a lock:** an optional field `locked` on the layer, in data model 1.3.0. When it is absent the layer is not locked. It is one value for every user and every browser, stored and sent like the layer's other fields.
2. **Setting or clearing the lock** is an ordinary layer update. It needs the same permission as any other change to the layer: `layers.edit` in View, the workspace's edit permission in a declared workspace.
3. **While a layer is locked, the store refuses a user's change request that would change the layer's content.** That means:
   - creating, updating or deleting an object in the layer;
   - moving an object into or out of the layer;
   - updating or deleting the layer, except an update that changes nothing but `locked` and `drawOrder`.

   So the lock and the draw order stay changeable by anyone who may edit the layer.
4. **A user's change request** is meant as in overview 4.4: every change request from a browser session, in login and no-login mode alike, whatever its `source.plugin` says. ECore acting for a user, as in the Settings list's Layers entry, counts as that user's.
5. **Changes without a user pass the lock:**
   - **plugins' server parts,** with incoming data (BP) and the simulator's moves, events and saves. The simulator's commands are included (BW): they act through its server part;
   - **ECore's own changes,** such as removing expired objects.
6. **The check is the store's** (ADR-0005). It runs in the single writer, after the permission check, against the layer's stored state when the request is applied. So no change slips between a lock and the change that it should stop.
7. **A refused request gets its own rejection code, `LAYER_LOCKED`** (data model 1.3.0, the change protocol of ADR-0018). The details name the layer. Nothing changes and no change event is sent, as for `PERMISSION_DENIED`.
8. **The browser shows the lock.** The browser only hides what the server refuses (overview 4.4):
   - `layer-panel` shows and switches the lock;
   - the editors treat a locked layer's objects as read only, and do not place into a locked layer. Their briefs say how (PDA).

## Alternatives considered
- **A lock in the browser only, like the eye:** no contract change, but other users and other browsers could still change the layer. The owner wants it enforced for every user (BP).
- **The lock stops plugins too:** a locked target layer would stop an input link's data, and the simulator's moves. The owner wants incoming data to pass (BP), and plugins' server parts (BW).
- **The simulator checks the lock for its commands:** it would keep users from changing a locked layer through the simulator's endpoints, but each plugin with commands would have to check the lock itself. The owner chose that the simulator's commands pass (BW).
- **A permission of its own for the lock** (for example `layers.lock`): finer control, but the owner wants anyone who may edit the layer to set and clear it (BP).
- **The lock also stops the draw order:** stricter, but reordering the layer list is part of arranging the view, not of changing the layer's content.

## Consequences
- **Data model 1.3.0 and SDK 1.3.0 (PDA, CR-0028):**
  - the `locked` field on the layer;
  - the rejection code `LAYER_LOCKED`;
  - both SDKs' layer types;
  - the web test kit's fake store refuses a user's change to a locked layer, as the server does.
- **ECore (CDA, T-098):** the check in the store's single writer (point 6), for every path that carries a user's change, the Settings list's Layers entry included; the shell's shared Delete reports objects in a locked layer as refused.
- **Plugins:** `layer-panel` shows and sets the lock; `draw-symbols`, `draw-shapes` and the simulator's route editor treat a locked layer as read only (PDA's brief edits, then their PCAs).
- **Overview 4.4 (normative)** states the rule beside the permissions.
- **Trust:** a plugin's server part can change a locked layer, also through its own endpoints for a user (BW). Plugins are trusted (ADR-0003); the briefs and the reviews check that a plugin's commands change only what its purpose needs, as for ADR-0041 point 7.
- **ITA:** a flow with two users: a locked layer refuses the second user's create, update, delete and move with `LAYER_LOCKED`, takes a draw-order change and the unlock, and still takes incoming data and the simulator's moves.
