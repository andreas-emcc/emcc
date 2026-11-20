# ADR-0041: A running simulation's moves are not written to disk

- Status: Accepted (owner, 2026-10-22; the revised version, with a best-effort clean stop)
- Date: 2026-10-22
- Deciders: Owner (the owner's decision on spike S6, 2026-10-22; written by the ACA, with the CDA's store design)
- Extends: ADR-0024 (the persistence manager) and ADR-0040 (the simulator)

## Context
The simulator moves up to 1 000 tracks once per second with ordinary change requests (ADR-0040 point 3). Spike S6 (`spikes/s6/README.md`, T-082) found that the object store and the live picture carry that easily. The cost is persistence:
- the file store writes every move in full into its journal;
- it compacts the whole picture every 10 000 events, which at 1 000 moves a second is every 10 s;
- together that is 1 to 7 MB/s, or 82 to 620 GB a day, for positions that are stale a second later.

ADR-0024 makes every change durable. It is written to disk shortly after it is applied in memory (write-behind), so a crash loses only the last moments. ADR-0040 point 2 keeps the simulator's own state in its plugin documents, saved at each pause and at least every 10 seconds while running.

S6 proposed persisting moving objects at most once per window, for example every 10 s. The owner decided differently on 2026-10-22: **a running simulation's track moves are not saved at all.**
- They are applied and sent as usual, to the live picture and the output channels, but not written to disk.
- The tracks are saved before a run and when the simulation stops or pauses.
- After a crash mid-run, they come back at their last saved positions.

The file store's journal is a strict chain (`FileStore`, `PictureState.apply`): each event has the next sequence number, and each update or delete names the stored version as its previous one. An unsaved update still takes a sequence number and a version, because the live sequence is gapless (model rule 7). The CDA's view of the store's side (`docs/handover/cda.md`, "Unsaved moves: the store's side", on `integration/sdk-v1.2` at `c544b2d`) shows how the journal stays loadable without it.

## Decision
1. **Only moves can be unsaved.** A server part marks an object update as not saved (`Change.notSaved()`, proposed in CR-0025).
   - The store accepts the mark only on an update that changes nothing but the object's `geometry`, its `time`, and the symbol's `direction` and `speed` modifiers. Every other field must equal the stored object.
   - It refuses the mark otherwise, and on any create, delete or layer change.
   - So an object's existence, layer, label and fields always survive a restart, and the changes a simulator event makes (ADR-0040 point 8) are saved.
2. **Applied and sent, not journalled.**
   - An unsaved update is applied in memory and sent like any other change: a sequence number, a change event and an answer, through the live picture, the store subscriptions and the output channels.
   - The persistence manager does not write it.
   - The live sequence stays gapless (model rule 7); only the journal holds declared gaps.
   - The mark travels inside ECore. It is not in the change request or the change event, so browsers cannot set it, and nothing changes for the data model.
3. **The journal stays loadable.** Instead of the unsaved updates, the persistence manager writes short lines that declare what it skipped:
   - the runs of sequence numbers it skipped;
   - before a saved update or delete of a moved object, the version that object had reached.

   It writes no line per move, and loading stays strict except where such lines declare. Compaction, and the snapshot written after a lost event, take the picture as it is in memory, moved positions included; such a snapshot clears the declarations. The exact form is the CDA's.
4. **When the simulator saves.** It saves its tracks, as ordinary updates of their current state, and its own state (ADR-0040 point 2) together:
   - before a route runs;
   - when a route pauses, stops at its end, or is reset;
   - when a user changes the simulation while it runs: its routes, groups, events or outputs.

   Each save covers all its tracks and its whole own state, whichever route caused it. This replaces "at least every 10 seconds while running" in ADR-0040 point 2.
5. **After a restart, the simulator's own state is the source.** When the simulator starts, and when its worker restarts, it sets its tracks from its own saved state with ordinary updates, and the simulation is paused (ADR-0040 point 2). So tracks and state agree after a crash, after a snapshot that held moved positions, and after anyone's saved change that wrote a moved position.
6. **A clean server stop is best-effort.** The simulator pauses and saves in its `stop`, but ECore does not guarantee that those saves are applied before the store stops. After a clean stop or a crash during a run, the simulation comes back at its last saved moment.
7. **Who may use it.** In M3 only the simulator; its brief (T-077) will say so. Another plugin needs the owner's approval, since the mark trades durability for load.
8. **History.** Unsaved updates are not in the future event log (overview 4.4). A replay of the timeline sees simulated tracks only at their saved moments. If simulations should be replayed in full, that is decided with history.

## Alternatives considered
- **Persist moving objects at most once per window** (S6 proposal 1).
  - No mark in the SDK, and it helps every fast mover, CoT tracks included.
  - But it still writes about 0.1 MB/s, and it changes durability for every plugin. The owner chose not to save a running simulation's moves at all.
- **Persist every move,** as today: 82 to 620 GB a day in the file store (S6).
- **"Not saved" as a behaviour of a data type:** no mark per change. But the same tracks must be saved at a pause or a stop, so the choice belongs to the change, not the type.
- **A separate method on the store,** such as `submitUnsaved(change)`. It has the same effect, but a mark on `Change` combines with the other marks and keeps one way to submit. This is the PDA's choice in CR-0025.
- **The mark in the browser's change request:** no edit by a user should be lost in a crash.
- **The events' changes unsaved too** (this ADR's first version). A crash would then lose a status a simulator event set. Since the simulator restores its tracks from its own state, saving those changes costs little.
- **Snapshots holding each moved object's last saved state** (this ADR's first version). The store would have to keep a second copy of every moving object. The simulator restoring its tracks makes it unnecessary.
- **A snapshot whenever a saved change follows unsaved ones,** instead of declared lines. It needs no format change. But CoT tracks coming back from TAK at about 1 Hz (ADR-0040 point 11) would mean a full snapshot about every second during a run (CDA).
- **A guaranteed save at a clean stop:** ECore would drain a plugin's workers and the store's queue before stopping them. It is more ECore work for a case that loses only the run since the last save, and it can be added later.

## Consequences
- **ADR-0024:** write-behind holds for every change except unsaved updates, and the journal has declared gaps (overview 4.8).
- **ADR-0040 point 2:** replaced by points 4 and 5 above.
- **SDK 1.2.0 (PDA, CR-0025 part 8):**
  - the mark, its limits (point 1), and in its Javadoc who may use it;
  - the test kit's `FakeStore`.
  - Whether model rule 7's text names the live sequence is the PDA's to decide.
- **ECore (CDA):**
  - the mark inside ECore, and the store's check of point 1;
  - the declaration lines, and loading with them;
  - the drain at a stop counting unsaved numbers as accounted for;
  - the monitor's count of each plugin's unsaved updates;
  - in `server/README.md`: a journal with such lines needs this server version or later.
- **The simulator's brief (PDA, T-077):** the saving moments, restoring its tracks at start and after a worker restart, and the best-effort stop.
- **ITA:**
  - a server killed during a run, and one stopped cleanly during a run, come back paused at the last saved moment, with tracks and state agreeing;
  - an unsaved update that changes more than a move is refused;
  - a journal with declared gaps loads.
- **After a restart:**
  - sequence numbers and versions used by unsaved updates may be issued again, as CR-0025 says; browsers get a fresh snapshot;
  - an object's `meta.modified` comes back older, so expiry may come earlier for a data type that expires after its last change; the simulator's tracks use none.
- **The PostgreSQL store (M4)** keeps states, not a chain. It skips unsaved updates and needs no declaration lines.
