# The multi-instance mass test: plan

Status: **approved by the owner** (in the ITA's session, 2026-11-20), with cot through the ESA's TAK Server. Step 2:
the script, one run at a small scale (with the owner's approval of that run) and its first report.

Two or more emcc instances, each on its own ports with its own data folder, exchange a known set of objects over every
link that can carry them. The test counts what is sent, received, matched and mismatched per link and object type,
measures how long a change takes to arrive, and looks for losses, duplicates, echoes and loops.

## 1. Setup

**One build, N instances** (default 2, A and B; `--instances N` for more):

- **From the tree** (default): the server jar and the web shell the normal build makes (`node tests/integration/run.mjs`
  builds them; `--skip-build` uses what is there).
- **From a release zip** (`--release <zip>`, or `EMC2_RELEASE_ZIP`): unpacked once per instance into its own temporary
  folder, started with its own start script (as `lib/release.ts` does).
- Each instance gets:
  - a free HTTP port;
  - its own data, plugin and settings folders, under the run's output folder, removed after a passing run;
  - free UDP and TCP ports for its links;
  - no login (standalone).
- **Ports never used:** 8087 (WinTAK) and 18433 (the owner's M9.1 RC2 copy). A port helper refuses them, and every
  port is free when it is taken.
- **The links** are set through the settings API (`PUT /api/settings/plugins/<id>`), as the specs do today. Nothing is
  set by hand.

**Which links carry what**, from the plugins' manifests and readmes:

| Plugin | Link kinds | Out (what it sends) | In (what it writes) | In this test |
|---|---|---|---|---|
| cot | `udp`, `multicast`, `tcp-client`; `in`, `out`, `both` | `core.symbol` with a point, from the link's source layers, as a CoT atom with `__milsym` (2525C) and `unitmodifier`s. Shapes, tactical graphics and symbols without a CoT type are skipped and counted. The simulator's ground truth through its output channel. Objects above the link's `highestClassification` are not sent. | `cot.cot` symbols (APP-6D from `__milsym`), with the link's label | Phases 1, 2 and 3: symbols, both ways |
| nvg | `soap-provider` (serves its source layers and its output channel), `soap-consumer` (polls `GetNvg` every `intervalSeconds`, 10 s or more) | Every object of the source layers: `point` (symbols), `multipoint`, `polyline`, `polygon`, `arrow` (tactical graphics), other shapes, `text`. Each item's label as STANAG 4778 metadata. Objects above `highestClassification` are not served. | `core.symbol`, `core.multipoint`, `core.shape`, `core.text`, each with its own label | Phases 1 and 2: symbols and graphics, both ways; phase 3: ground truth |
| gmti | `udp`, `tcp-client`, `tcp-server`; `in`, `out` | Only the simulator's ground-radar reports, sent to its output channel (STANAG 4607) | The platform, dwell areas and `gmti.detection`s | Phase 3: A's radar to B (and B's to A) |
| fmv | `udp`, `multicast`; `in`, `out` | Only uav-simulation cameras' video (STANAG 4609), sent to an output link's channel | `fmv.camera`, its field of view, a stream | Phase 4: both ways |
| simulator | no links of its own | Its ground truth to cot's and nvg's channels, its ground radars to gmti's | – | Phase 3 |
| uav-simulation | no links of its own | Its cameras' poses to fmv's output channels | – | Phase 4 |
| ais, adsb | `in` only | Nothing | – | Not used: they cannot send |

**TAK between the instances** (owner, in the ITA's session, 2026-11-20: through the TAK Server):

- **By default, through the ESA's TAK Server:**
  - each instance has one cot `both` link, a TLS `tcp-client` on the server's 8089, using the client certificates named
    in the server's sheet in `external/tak-server/` and its credentials folder;
  - it is used only if the sheet's `status.mjs` says the server runs; otherwise the cot part is skipped with the reason;
  - the plain port 8087 is not used;
  - the TAK Server relays every event to every other client. It answers an event that carries its own flow tags as a
    duplicate (cot readme). cot's echo rule should ignore anything of an instance's own that still comes back, and the
    test checks that it does.
- **As an option, directly over UDP** (`--direct-cot`):
  - each instance has a cot `out` link to every other instance's `in` link, on loopback;
  - no TAK Server is needed, so this route runs offline.

## 2. Phase 1: the known set

**Made in each instance**, through the live API as change requests, in a layer of its own:

- **Symbols:**
  - **APP-6B** (the 2525C code), **APP-6D** and **APP-6E**;
  - friend, hostile, neutral and unknown;
  - land units, equipment, air and sea;
  - with amplifiers (unique designation, higher formation, speed, direction, staff comments, quantity) and a name
    (the label).
- **Positions:**
  - at least one point where latitude ≠ longitude in each quadrant (west and south included);
  - one point near the antimeridian;
  - one point near a pole.
- **Security labels:** several classifications of the default policy. One object is above each link's
  `highestClassification`, and must **not** arrive.
- **Tactical graphics, for nvg** (the draw-tactical kinds, `core.multipoint` with a graphic's code):
  - points;
  - lines: a phase line, a boundary and an axis of advance;
  - areas: an assembly area and a polygon;
  - plain `core.shape` lines and polygons too.
- **The defaults:** about 25 symbols and 10 graphics per instance; `--objects N` scales the symbols. The set is fixed
  data in the test, the same on every run. Each object's name carries its instance and number (`A-017`), so a copy can
  be traced to its source.

**Sending:**

- **cot:** each instance's set layer is the source layer of its `both` link to the TAK Server (or of its `out` links
  with `--direct-cot`).
- **nvg:** each instance's set layer is the source layer of its provider link, and each other instance has a consumer
  of it. The consumer's interval is 10 s, the smallest allowed.
- Received objects go into a layer of their own per link. That layer is **never** a source layer, so nothing is sent on.

**The check, per link and object, field by field, against the fixed set:**

| Field | cot | nvg |
|---|---|---|
| Arrived once, in the link's layer | yes | yes |
| Coordinates (lon, lat), within 1e-7° | yes | yes |
| SIDC | the expected APP-6D, after cot's conversion (2525C → APP-6D; fixed table in the test) | as sent |
| Amplifiers | those that CoT carries (`unitmodifier`), as sent | as sent |
| Label (name) | the CoT callsign: the name | as sent |
| Security label | the link's label (CoT carries none per object) | as sent (STANAG 4778) |
| Graphics' geometry | not sent: counted as skipped by cot's status | every point, in order, within 1e-7° |

**Also checked:**

- nothing is lost: received equals sent minus the skips the plugin documents;
- nothing is duplicated: one object per source object and link;
- the object above the highest classification did not arrive;
- **no echo:** no instance gets an object of its own back, and no instance's set layer changes from outside.

**An echo variant** (`--echo`): one received layer is also made a source layer, so A's objects go to B and back. The
check: cot's "echoes ignored" counter rises, and A gets no new object and no update of its own objects (cot readme,
"The echo of what emc2 sent is not an object").

## 3. Phase 2: moves

- **The moves:** every `--move-interval` (default 2 s) for `--duration` (default 2 min), each instance moves a share of
  its **own** set objects (default 20 %). Each move is a small, known step, and the order is fixed by a seed.
- **The measure:** the test listens to every instance's live stream. For each move it records:
  - the time it was applied at the source;
  - the time the change arrived at each receiver, per link.
- **The checks:**
  - every move reaches every receiver; cot may skip intermediate positions, since it keeps only an object's latest
    event, so for cot the check is that the last position arrives;
  - at the end every copy is at its source's last position (the last position wins);
  - **no loop and no ping-pong:** no receiver sends a received change on, no source object changes except through its
    own moves, and the number of updates a receiver writes per object is at most the number of moves.
- **Propagation time,** per link: the median, 95th percentile and maximum. For nvg it includes the consumer's polling
  interval (up to 10 s), so it is reported apart from cot.
- **An optional variant** (`--conflict`): an instance also moves its copy of another instance's object, to record what
  happens. The expected behaviour, from cot's and nvg's readmes, is that the next event from the source puts the copy
  back. This is recorded and not counted as a mismatch.

## 4. Phase 3: simulation

- **In A (and in B with `--both`):** a Simulation layer with:
  - a platform with a ground radar set to a known single look (as in `external/gmti-automated-external-verification`);
  - two tracks on routes, one of them still.
- **Outputs:** ground truth to cot's channel (and nvg's provider channel); the radar to a gmti `out` link (UDP) aimed at
  the other instance's gmti `in` link.
- **A tap** (as in the dissector spec) sits between the gmti links. It passes every datagram on unchanged and checks
  the 4607 structure: one segment per packet, the order mission, job definition, dwells, and the job definition's
  interval:
  - 20 s plus one revisit when the gmti manifest has the out link's `edition` setting (M9.1);
  - otherwise 30 s.
- **The checks:**
  - the tracks arrive (cot, nvg), and their positions follow the route, compared with the route's geodesic path at
    the event's time (as `m5-sim-sensors` does);
  - the platform, the dwell areas and the detections arrive through gmti, the detections at the tracks' positions;
  - nothing comes back to A.

## 5. Phase 4: video

- **The cameras:** a uav-simulation camera on a simulator track in A, and with `--both` in B too. Each sends through its
  fmv `out` link to the other instance's fmv `in` link, through a tap. It runs as `external/uav-end-to-end` does.
- **The imagery:** fmv's plugin-wide WMS settings point at the ESA's local GeoServer (its sheet in `external/geoserver/`,
  on loopback), over Sweden, where its data is. It is used only if `status.mjs` says GeoServer runs, so the test works
  offline. The DTED is optional (`EMC2_TERRAIN_DTED` or `EMC2_EXTERNAL_ROOT`); without it the terrain is flat.
- **The encoder:** ffmpeg, from `EMC2_FMV_FFMPEG`. Without it, phase 4 is skipped with the reason.
- **The checks:**
  - **at the tap:** 188-byte TS packets, no continuity gap, valid ST 0601 checksums, and no stall (a gap over 1 s)
    over `--duration`;
  - **at the receiver:** `GET /streams` lists the stream as H.264, live; its row exists in the FMV panel; and Watch
    plays it without a player error (in a browser, as the uav spec does).

## 6. Parameters

| Parameter | Default | Meaning |
|---|---|---|
| `--instances N` | 2 | Number of instances; links between every pair |
| `--release <zip>` | – | Use a release zip instead of the tree |
| `--phases 1,2,3,4` | 1,2,3 | Which phases (4 needs ffmpeg and GeoServer) |
| `--links cot,nvg,gmti,fmv` | all available | Which links |
| `--objects N` | 25 | Symbols per instance (the graphics stay 10) |
| `--move-interval s` | 2 | Phase 2's interval |
| `--duration s` | 120 | Phases 2, 3 and 4's length each |
| `--both` | off | Phases 3 and 4 in B too |
| `--direct-cot` | off | cot directly over UDP instead of through the ESA's TAK Server (TLS) |
| `--echo`, `--conflict` | off | The variants above |
| `--seed n` | fixed | The moves' order |

## 7. The report

Each run writes `report.json` and `report.md` to its output folder (`tests/integration/out/mass-<time>/`). A summary of
each run that the owner approved goes into `docs/test-reports/`, with no local paths. The report gives:

- the run: build (commit, or the zip's name), instances, parameters, duration, and the machine's load (CPU and memory per
  instance, sampled);
- **per link and object type:** sent, received, matched, mismatched (each with its object, field, expected and got),
  skipped (with the plugin's reason), lost, duplicated, echoed;
- **propagation per link:** count, median, 95th percentile and maximum, for phases 2 and 3;
- loops and ping-pong: updates that no move explains;
- phase 4: datagrams, gaps, stalls, checksum faults, and whether it played;
- the log check: error lines and stack traces in every instance's log.

The run fails when any count is not as expected, and the report says which. A product fault is reported to its owning
role, as a boxed prompt for the owner to relay, and is not worked around.

## 8. The run

- **Its own command:** `node tests/integration/mass/run.mjs [options]`. It is not part of the quick or the full run.
  `run.mjs`'s selection never picks the `mass/` folder, and its specs live outside `specs/`. It uses Playwright with a
  config of its own, `mass/playwright.config.ts`, for the browser check in phase 4. Everything else is Node.
- **No new dependency:** Node, Playwright, the `lib/` helpers and the built server, all there today.
- **Estimates:**

  | Run | Time | Load |
  |---|---|---|
  | The small run (2 instances, 25 symbols and 10 graphics each, phases 1 to 3, 2 min each) | about 12 min | 2 servers (about 1 GB each), little CPU |
  | With phase 4 | about 4 min more | 2 renders and 2 ffmpeg encodes (about 1 core each) |
  | 5 instances, 1 000 objects each | about 30 min | 5 servers (about 5 GB), cot's UDP at about 5 000 events/s |

- **Approval:** the owner approves each mass run before it starts; the ITA asks with the parameters and the estimate.
- **Keycloak:** not used (the instances run standalone). If a login variant is wanted later, it uses the ESA's
  `status.mjs` and credentials folder only.
- **External services:** only through their sheets in `external/`: GeoServer for phase 4, and the TAK Server with
  cot (unless `--direct-cot`).
- **Nothing is installed.** Nothing names a local folder; everything outside the repository comes from environment
  variables, as in `tests/integration/README.md`.
