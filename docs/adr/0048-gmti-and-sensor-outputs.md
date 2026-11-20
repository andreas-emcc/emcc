# ADR-0048: GMTI (STANAG 4607) in and out, and Ground truth and Sensor outputs

- Status: Accepted (owner, GR, 2026-11-05; its decision points approved with the M5 plan, GQ). **Point 1 amended in place by the owner on 2026-11-20** (M9.1; without a CR, owner AEC A): an out link writes Edition 3 ("30", the default) or Edition 4 ("41"), as its setting `edition` names
- Date: 2026-11-05
- Deciders: Owner (advised by the ACA; T-141, GG; the M5 plan's Q2 and Q6, `docs/architecture/m5-plan.md`; the test data, owner 2026-11-05)
- Extends: ADR-0037 (links and output channels) and ADR-0040 (the simulator)

## Context
Ground moving target indicator (GMTI) radars report moving things on the ground and at sea. Each report belongs to a dwell: one look of the radar at an area, from a platform, usually an aircraft. NATO's exchange format for these reports is STANAG 4607.

The owner wants a `gmti` plugin with three parts (T-141, GG, 2026-11-05):
- **in:** over TCP or UDP, the sensor platform, the dwell area, and target reports as detections with a short history;
- **out;**
- **a GMTI sensor in the simulator,** whose detections of simulated tracks go out.

For the M5 plan the owner also decided (Q6):
- **two kinds of simulator output:** a **Ground truth output** sends every simulated track as it is, and a **Sensor output** sends what a simulated sensor detects;
- **CoT, AIS and ADS-B** are offered as both;
- **GMTI** is offered only as a Sensor output.

Today an output channel (ADR-0037 point 4) does not say what kind of data it takes. The simulator sends every track to each chosen channel at each tick (ADR-0040 point 10).

## Decision
1. **The edition:** STANAG 4607 Edition 4, written in **AEDP-4607 Edition A, Version 1** (February 2024), with its implementation guide **AEDP-4607.1 Edition A, Version 1** (owner, Q2).
   - Both are public documents from NATO's NSDD, in a local folder of the owner's.
   - Agents read them there. They are never copied into the repository, and the brief cites their sections.

   **Amended by the owner on 2026-11-20** (M9.1, decided in PCA-gmti's session and released; written here without a CR, because the decision is already the owner's: AEC A, 2026-11-20; board M9-R30; in place, no new ADR):
   - **What changed:** the text above has `gmti` write Edition 4 (AEDP-4607 Edition A, Version 1) only. An out link now writes the edition its setting `edition` names:
     - `edition-3`: `P1` "30", STANAG 4607 Edition 3 (2010). It is the default, also for links set up before M9.1;
     - `edition-4`: `P1` "41", AEDP-4607 Edition A, Version 1, with `P10` 0 in the packets that hold only the mission or the job definition, which happens when the link's `oneSegmentPerPacket` puts them in packets of their own (AEDP 3.1.10). Edition 3 keeps the job's `P10` in every packet.
   - **Why Edition 3 is the default:** the receivers in use expect it.
   - **In:** a link still reads every version by the existence mask, and logs a version other than "30" and "41".
   - **The job definition** goes out at least every 20 s, inside the standard's 30 s (owner, ADQ B).
   - **What stays:** AEDP-4607 Edition A is the format the reference describes, and AEDP-4607.1 stays the implementation guide for both editions. The two editions lay out every field alike, and the guide's Annex M.2 records what changed from Edition 3. The owner's copy of Edition 3 is outside the repository and is never copied. The details are in the reference (`docs/architecture/gmti-4607.md`, sections 1.2, 3.6, 4.1 and 4.3) and in `plugins/gmti/FORMAT-RULES.md` (G7 and G18).
2. **The `gmti` plugin** is an in/out plugin built by the playbook. Its links (ADR-0037) run on connection tasks (ADR-0036), as a TCP client, a TCP server or UDP.
3. **In:** a link writes into its target layer:
   - **the sensor platform** as a symbol at the platform's reported position, updated with each dwell. Its symbol and identity are set per link;
   - **the dwell area** as a shape, one per sensor, replaced by each new dwell;
   - **each target report as a detection object** of the data type `gmti.detection`, with the report's details in `gmti`'s namespace and the dwell's time as its time.

   Further rules for incoming data:
   - **Detections are not tracks.** Each report is its own object, and associating them into tracks is a tracker's job, later.
   - **Their short history** comes from the data type's expiry and fading (ADR-0023 point 7), with defaults that the admin can change.
   - **A dwell with very many reports:** a cap per dwell, set per link, keeps the live picture usable. Reports beyond it are skipped and counted (ADR-0037 point 7).
   - **The classification:** a packet's security classification becomes the objects' label classification (ADR-0020). Where it gives none, the link's default label applies.
   - **Coordinates and heights** are converted from the format's own order and units to the model's longitude, latitude and heights (ADR-0007). This is tested with a point where latitude ≠ longitude.
4. **Output kinds.** Every output channel says which kinds of data it takes (extends ADR-0037 point 4):
   - **ground truth:** objects as they are;
   - **sensor reports:** detections made by a sensor, each with its sensor's platform and dwell;
   - **or both.**

   `cot`, `ais` and `adsb` take both: they send a sensor report as an ordinary position of the detected object, with the sensor's errors in it. `gmti` takes sensor reports only, and sends them as dwells with target reports (Q6). A sender sends a channel only the kinds it takes.
5. **`gmti` out sends sensor reports only** (Q6). It takes them from senders, which in M5 is the simulator's GMTI sensor. It takes no objects from source layers. This replaces T-141's "emc2 tracks as target reports". Relaying received GMTI is later.
6. **The simulator's outputs** (extends ADR-0040 point 10):
   - **Ground truth outputs** work as today: every track, at each tick, to each chosen channel that takes ground truth.
   - **Sensor outputs** each belong to one simulated sensor, which sends its detections to its chosen channels that take sensor reports.
7. **The simulator's GMTI sensor:**
   - a simulated platform, which moves on a route like other units;
   - its settings: a revisit time, a dwell area, a probability of detection, position errors in range and cross-range, a minimum detectable speed and a maximum range;
   - at each revisit it detects the simulation's moving ground and sea tracks inside the area, with those errors. Hidden tracks are not detected;
   - users with `plugin.simulator.edit` set it up.
8. **Test data:** recorded open GMTI data that the owner has (2026-11-05), played back by the ESA from `external/`. The owner approves the source, and its licence is recorded in the service's sheet.
9. **Output links' highest classification** (ADR-0037 point 8) applies to `gmti` as to every output.

## Alternatives considered
- **Target reports as tracks:** fewer objects, but it means guessing associations, which is a tracker's job.
- **One object per dwell, holding all its reports:** fewer objects, but a single detection could not be selected, listed or faded on its own.
- **`gmti` out for ground truth too** (T-141's first wording): the owner decided that GMTI is a sensor output only (Q6).
- **Sensor outputs as a separate mechanism beside channels:** cleaner for GMTI, but CoT, AIS and ADS-B would then need two ways out.

## Consequences
- **SDK 1.4.0, part 1 (PDA):** a channel's output kinds, and the sensor report as a message to a channel.
- **Briefs (PDA):** `gmti`, and the simulator's GMTI sensor with its two kinds of output.
- **Plugins:**
  - **PCA-gmti** (new) builds `gmti`;
  - **PCA-simulator** builds the sensor and the two kinds of output;
  - **PCA-cot, PCA-ais and PCA-adsb** declare that they take both kinds, and map sensor reports.
- **ESA:** the playback of the owner's recorded GMTI data.
- **ITA:**
  - `gmti` in from the playback;
  - the simulator's sensor out through `gmti` and through `cot`;
  - the cap per dwell;
  - the classification of incoming packets.
