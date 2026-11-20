# ADR-0017: Client rendering needs a GPU for the full object count

- Status: Accepted
- Date: 2026-10-05
- Deciders: Owner (advised by the ACA; findings from spike S2 by the PDA)

## Context
The requirements say the map must handle at least 100 000 objects, with aggregation allowed when zoomed out. ADR-0009 chose OpenLayers with WebGL rendering for this, to be proven by spike S2. ADR-0006 lets the server send aggregates instead of individual objects beyond a zoom threshold.

Spike S2 (`spikes/s2/README.md`, 2026-10-05) measured 100 000 and 200 000 APP-6 symbols in EPSG:3857, 3413 and 3031:

| | With a GPU (RTX 4070 Ti SUPER) | Without a GPU (development VM, software WebGL) |
|---|---|---|
| Frame rate at 100 000 symbols | 223–240 fps (the display's limit) | about 4.5 fps |
| First complete render | 0.13–0.16 s | 0.9–1.0 s |
| Memory | about 2 KB per symbol | about 2 KB per symbol |

Live updates block the browser's main thread even on the fast machine: 46 % of the time when changes are applied every 100 ms, 6 % when applied once per second.

Without a GPU, which is typical for virtual machines, VDI and remote desktops, the browser falls back to software WebGL and the full object count is not usable. The owner decided on 2026-10-05 that aggregation comes in a later milestone, not in M0.

## Decision
1. **The 100 000-object requirement applies to clients with hardware-accelerated WebGL** (a GPU). The test machine has a high-end GPU; the margin to 30 fps is about eight times, so an ordinary office GPU is expected to be enough, but that is still to be confirmed.
2. **Clients without hardware acceleration have a budget of about 10 000 individually drawn symbols.** Above that they need aggregates (ADR-0006, spike S3). Until aggregation exists, such clients are supported only up to that budget.
3. **The map view detects whether WebGL runs hardware-accelerated** (for example with `failIfMajorPerformanceCaveat` or the WebGL renderer information) and reports software rendering to the user and to the monitor view. It never fails silently with an unusable map.
4. **Live updates reach the map in batches.** Object layers in the web SDK take a snapshot and then batches of changes, never per-object calls. The map view merges changes by object id (latest wins) and applies them at its own cadence, by default about once per second. The cadence is configurable, but must not be set so fast that it blocks the main thread.

## Alternatives considered
- **Canvas 2D instead of WebGL:** works without a GPU but is far slower at this object count, and would fail the requirement on every machine.
- **Aggregation in M0, so that every client stays under the budget:** possible, but the owner moved aggregation to a later milestone; M0 is an internal demo with a small number of objects.
- **Requiring a GPU on every client, without a fallback:** simple, but excludes virtual desktops, which are common in disconnected and C2 environments.
- **Per-object updates applied immediately:** simplest for plugin authors, but blocks the main thread at realistic update rates even with a GPU.

## Consequences
- **Hardware:** demos and operational clients that must show the full object count need a GPU. This is a client hardware requirement the owner may want to state in `requirements.md`.
- **Testing:** browser tests usually run without a GPU (headless or virtual machines). The ITA's functional tests use small object counts; the M1 performance test runs on a machine with a GPU, and on a typical office machine to confirm point 1.
- **Web SDK v0 (PDA):** batch-oriented object layers and a map-view-owned cadence, as in point 4. Symbols are drawn from images cached by appearance (SIDC plus graphic modifiers). Per-object text such as unique designations is drawn separately, and only where it stays readable, so that 100 000 objects do not become 100 000 images.
- **`map-view-2d` (PCA):** implements the detection and reporting in point 3, and the cadence in point 4.
- **Aggregation stays required** before non-GPU clients can show the full picture. It is planned for a later milestone (spike S3 decides thresholds and message sizes).
- **Polar projections** work with WebGL when both `extent` and `worldExtent` are defined; without `worldExtent` OpenLayers' graticule fails. This is a note for the map view, not a separate decision.
