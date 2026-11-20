# ADR-0037: Data in and out: links with layers, and output channels

- Status: Accepted (owner, 2026-10-22)
- Date: 2026-10-22
- Deciders: Owner (advised by the ACA; the owner's answers Q3 to Q7, Q30, A6 and A8 in `docs/architecture/m3-simulator-decisions.md`)
- Extends: ADR-0023 (data types and data sources)

## Context
ADR-0036 lets a plugin receive and send over any kind of connection. The owner also wants a standard way for the rest of emc2 to send and receive data through such plugins, at least once a second, without limiting the transports (owner, 2026-10-22). The first users in M3 are `cot`, which gains a sending side, and the simulator, whose tracks leave emc2 through the outputs it finds in the plugins: CoT now, and ADatP-36, AIS, ADS-B and plugins from third parties later.

Today `cot` receives over **streams**: each makes and owns its own layer, and its name is the data source of its objects (ADR-0023). Its README describes how a sending side would work, and nothing sends yet.

The owner chose two ways, used side by side (Q3): **layers** as the main way, and **direct channels** for data that should not go on the map. The simulator sends through channels chosen in its own panel (Q3b).

## Decision
1. **A link is one configured connection of an in or out plugin**, in that plugin's settings (`settings.admin`). It has a name, which is the data source of what it receives (ADR-0023), its transport (the plugin's, ADR-0036) and a direction: in, out or both (A6). "Both" uses one connection, as TAK clients do.
2. **An input link writes into one target layer** (Q6). The admin picks an existing layer from a list, or "New layer" with a name. Several links may share a layer. A deleted target layer is made again at the next data. In M3 the list holds View's layers (ADR-0039).
3. **An output link sends the objects of its source layers**, one or more, chosen in its settings. It sends creates and updates, and a delete where its protocol has one. **An object is never sent back to the link it came from** (A6): an output skips objects whose data source is its own link.
4. **Every output link is also an output channel.** Other plugins' server parts find the channels through the SDK and send to them directly, without a layer (Q3).
   - A channel describes itself: its plugin and link, a display name, its output type (for example `cot`), what it can do (for example **"can send a delete"**), and the declared fields its protocol uses (ADR-0038), so that a sender can offer them.
   - The list follows the settings: channels come and go as links do, and senders are told.
   - A sender sends **updates** (an object's content with its id) and **removals** (an id), never blocking (rule C5). On a removal, a channel that cannot send a delete stops sending the object.
   - A link's source layers may be empty: it then sends only what senders give it.
5. **Input channels are the counterpart:** another plugin's server part may subscribe to what an input link receives, as objects, without a layer. They are defined with output channels, and built when a first plugin needs them; no plugin does in M3.
6. **Rate** (Q4). An output sends at its protocol's pace. When it is slower than its input, it keeps only the **latest update per object** (coalescing by object id), never a growing queue. The monitor view shows each link's real rate. Missing 1 Hz on a slow protocol is accepted; the simulation engine's 1 000 tracks at 1 Hz is not affected by it.
7. **Objects an output cannot carry are skipped and counted** (Q7), per link and reason, in the link's status and the monitor view, and logged at most once a minute per link.
8. **Each output link has a highest classification**, a setting whose default is the classification of the server's default label. Objects above it, by the order of classifications in configuration (ADR-0031), are skipped and counted. Access by label comes later; this keeps an output from sending what its admin did not mean to release.
9. **`cot` in M3:**
   - links instead of streams, in and out, over a TCP client (TAK Server, TLS as today), UDP and multicast (Q5), on connection tasks (ADR-0036);
   - symbols only (Q7): APP-6 is mapped to the CoT type, and a function CoT lacks falls back to its parent, then to its dimension's generic symbol; shapes as TAK drawings come later;
   - the uid is the external id for objects that came from CoT, and the object id for the others; a delete is an event that is stale at once;
   - the stale time comes from the object's expiry, or from a setting per link; for tracks the simulator sends each second, it is short, so that a paused simulation's tracks go stale in TAK (A8).

## Alternatives considered
- **Layers only** (the ACA's first recommendation): one mechanism for every source, but data that should not show on the map would need a hidden layer, and the simulator could not choose its outputs itself (owner, Q3 and Q3b).
- **Channels only:** an admin could not send a layer out without a plugin that feeds it.
- **A queue in front of a slow output:** nothing is lost, but the delay grows without limit and the receiver sees old positions; for tracks, the latest position is what matters.
- **Send objects that cannot be mapped as a generic point:** nothing disappears on the other side, but the receiver gets wrong symbols (owner, Q7).
- **No limit by classification until access by label:** simpler, but any admin mistake in the source layers would release everything in them.

## Consequences
- **SDK 1.2.0 (PDA, through a change request):** the output channel API on the server side (list, changes, update, removal, what a channel can do, its fields), input channels defined; a settings field type that lets the admin pick a layer, or name a new one, in the settings form; the brief for `cot`'s M3 side.
- **ECore and shell (CDA):** the layer picker in the settings form; nothing else, since links are plugin settings and channels are messages between plugins.
- **`cot` (PCA-cot):** streams become links, with settings migrated from the existing `streams` entries (each becomes an input link with its current layer as the target); the sending side; UDP and multicast; connection tasks. Its README's "Designed for sending, later" is the starting point.
- **ITA:** the TAK test double sends and receives; flows for a round trip through TAK Server (Q20), and for skipped objects and the classification limit.
- **Monitor view:** per link, its direction, state, rates in and out, and the objects skipped and why.
- The simulator's use of channels, and who may choose them, is in ADR-0040.
