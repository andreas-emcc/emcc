# ADR-0053: Move and copy to layer

- Status: Accepted (owner, NM A, 2026-11-10; from the M6 plan, approved by the owner, NJ A, with Q1 to Q6 all A, NK A, NL A; T-155)
- Date: 2026-11-10
- Deciders: Owner (advised by the ACA)
- Extends: ADR-0005 (change events through a single writer), ADR-0032 (selection and object actions) and ADR-0042 (the layer lock)

## Context
The owner wants two items in the right-click menu of one or more selected objects, "Move to layer" and "Copy to layer", each opening a choice of layer, so that data is easier to restructure (T-155, 2026-11-09). The server checks the user's permissions on both layers.

The store already knows a move. Model rule 5 replaces an object's core fields, `layerId` among them, on update, and refuses an update into a layer of another workspace. ADR-0042 point 3 refuses a user's move into or out of a locked layer. What is not decided:
- whether a move is one update or a delete and a create;
- what a copy carries;
- who offers the actions;
- what happens when an in plugin's next report arrives for a moved track.

Every label stays cosmetic in M6 (owner, 2026-11-10).

## Decision
1. **Two shared object actions from the shell,** "Move to layer…" and "Copy to layer…", as Delete is (ADR-0032 point 6):
   - the map's right-click menu and the objects panel show them with no work of their own (ADR-0032 point 4);
   - they take one object or a selection, at most 1 000 (ADR-0032 point 1);
   - each opens a choice of layer: the shell's layer picker, without its "+".
2. **A move is an update,** never a delete and a create:
   - the browser sends one update per object with the new `layerId` and the complete core content (model rule 5);
   - the id stays, relations to the object hold (ADR-0051), and the store keeps every extension (rule 5);
   - each move is one change event.
3. **A copy is a snapshot** (owner, Q2 A): a create of a new object in the chosen layer, with a new id.
   - **It carries** the original's core content, its data type, its field sets and its namespaces, as an import does (rule 5).
   - **It is a hand-made object:** its `dataSource` is `manual` (ADR-0023 point 5), and its `time` has no observation and no expiry. So it stays on the map and does not fade with the original's data type (CR-0038 point 9).
   - **It never carries the `externalRef`** (rule 16), so it is never taken for the original's external track.
4. **Only the current workspace's layers** (owner, Q3 A). The store already refuses a move into another workspace's layer (rule 5). A copy to another workspace is a later decision.
5. **Permissions are the server's,** with no new permission:
   - a move needs the edit permission for the workspace's objects: `objects.edit` in View, the workspace's edit permission elsewhere (overview 4.4);
   - a copy needs the same for its target;
   - a move is refused with `LAYER_LOCKED` when its source or its target layer is locked;
   - a copy is refused only when its target is locked, since copying out of a locked layer changes nothing there (ADR-0042 point 3);
   - the picker lists only the current workspace's layers that are not locked and that the user may add objects to. The browser only hides; the store decides.
6. **Labels:** the object keeps its own label, and a copy takes the original's.
   - ADR-0020 point 3 sets no rule between an object's label and its layer's.
   - When access by label comes, the target layer must be one the user is cleared for (ADR-0020 point 4).
7. **Not atomic.** Each object is its own request. The shell reports the outcome once, for example "8 of 10 moved; 2 refused: layer locked". No confirmation is asked: a move is undone by moving back, and a copy by deleting it.
8. **A moved live object stays where the user put it** (owner, Q1 A).
   - The object writer of in and out plugins (T-147) takes an existing object's layer from the stored object.
   - The link's layer is where new objects appear.
   - The simulator's server part does the same for a moved simulated track.
   - This is an SDK 1.5.0 change, the M6 plan's part 5.

## Alternatives considered
- **A move as a delete and a create:** the id would change, relations to the object would break, and other plugins' extensions would need re-sending. It also takes two change events and two requests that can fail apart.
- **A server endpoint that moves or copies a selection at once:** atomic, but a second way to change objects beside change requests (overview 4.4 prefers change requests from the browser), and a new permission check outside the store.
- **A copy that is an exact copy** (Q2 B): it would fade and go with the original's data type, which makes a copy useless for keeping something.
- **A moved live track going back to its link's layer** (Q1 B): no SDK change, but a move of a live track would last only until its next report.
- **Moving and copying across workspaces** (Q3 B): the store refuses a move there today, and a copy from Simulation into View raises its own questions (a simulated track as a real object). Later, if the owner asks.

## Consequences
- **The shell (CDA):** the two actions, the picker without "+", and the one outcome message. `map-view-2d` and `object-list` show them through ADR-0032's list, with no change of their own.
- **SDK 1.5.0 (PDA):** part 5, the object writer keeping an existing object's layer; the briefs of `cot`, `ais`, `adsb`, `gmti` and the simulator follow. No other contract change: the store's rules already cover moves.
- **In plugins and the simulator (their PCAs):** use the writer's stored layer for existing objects.
- **UDA:** the manual describes both actions.
- **ITA:**
  - a move and a copy of one object and of a selection;
  - a refusal for a locked layer, and for a user without the edit permission;
  - a copy out of a locked layer;
  - a moved CoT track that stays after its next report;
  - a copy of an AIS vessel that does not fade.
