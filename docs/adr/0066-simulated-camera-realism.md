# ADR-0066: The simulated camera's realism and its field of view

- Status: Accepted (owner, AFL A, 2026-11-23; proposed by the ACA the same day, after the owner's answers to M10's plan: Q7 A, AEY, and Q8 A, AEZ; pulled ahead into M9.2, owner AFH A). **Point 2 amended in place by the owner** (AFV, 2026-11-23, in PCA-fmv's session; recorded in place as the owner asked through the MCA): the bit errors are drawn into the picture, and the stream is never damaged. The Context's point 2, the alternatives and the consequences follow
- Date: 2026-11-23
- Deciders: Owner (advised by the ACA)
- Extends: ADR-0058 point 2 (`fmv`'s output link), ADR-0059 points 1, 3 and 7 (`uav-simulation`'s poses, `fmv`'s rendering and muxing). Both stay as they are.

## Context
M9's simulated camera (ADR-0058, ADR-0059) sends a clean picture: a sharp image of the orthophoto, with exact metadata, from a camera that never shakes. The owner wants it **real enough to train with** (2026-11-23, M10's plan point 17), in three points:
1. **a degraded camera:** haze toward grey that grows with the distance, lower contrast and colour, a light blur or a lower drawing resolution, and sensor noise. With the link's bitrate, this gives a low-bitrate downlink's look;
2. **bit errors, option A** (owner): every 15 ± 3 s, settable and with a seed, a few transport-stream packets of the video are dropped or damaged. The receiver's decoder then shows real blocks until the next keyframe.
   **Amended (owner, AFV, 2026-11-23):** live, emcc's own player blacked out on every damaged frame instead of showing blocks. The owner chose "drawn only": `fmv` draws the damage into the picture, and the stream stays healthy;
3. **micro sway:** small irregular offsets to the camera's angles each picture. These are a few random slow sine waves of 0.5 to 3 Hz, and random jolts that die away. The amplitude, the frequency range, the jolts per minute, their strength, their decay and a seed are all settable. **The KLV's sensor angles include the sway** (owner), so the footprint moves with it.

The owner also wants **the camera's field of view on the map** in Simulation (2026-11-18), following the camera as it moves and points.

What the system has:
- `uav-simulation` sends **one pose per frame** on the channel kind `fmv.camera-pose`, which `fmv` declares (ADR-0059 point 3). The pose holds the platform's position and attitude, the pointing (`azimuth`, `depression` positive down, `roll`), the field of view and the frame's time.
- `fmv` renders each pose on a compute task, has ECore encode it, and muxes the H.264 with ST 0601 from the same pose (ADR-0059 point 7). Tags 18 and 19 come from the pointing.
- SDK 1.4.0's map overlays draw areas and lines that are not objects, as the simulator draws its coverage.

The owner answered M10's plan on 2026-11-23:
- **Q7 A (AEY):** the sway's settings are kept per camera;
- **Q8 A (AEZ):** the field of view is `uav-simulation`'s overlay on flat ground.

The owner then pulled points 1 to 3 into M9.2, for a demo on 2026-11-26 (AFH A).

## Decision
1. **The degraded camera is a setting of `fmv`'s output link** (extends ADR-0058 point 2):
   - **a checkbox, off by default**, so a link keeps today's picture until an admin turns it on;
   - **what it does:** `fmv`'s compute task renders the picture as it does today, and then applies the following before handing it to the encoder:
     - haze toward grey, which grows with each pixel's distance from the camera and goes beyond the link's present `haze`;
     - lower contrast and colour;
     - a light blur, or drawing at a lower resolution and scaling up;
     - sensor noise;
   - **the metadata is untouched:** ST 0601 and ST 0102 describe the pose as before;
   - **the strengths** are the brief's. M10's presets (plan point 4) set them together with the frame size, the rate and the bitrate. Until then the brief gives one set of fixed values;
   - **the cost:** it runs on the same compute task, within ADR-0064's budget. The brief measures it against S10's figure of about one core per 720p camera for the rendering.
2. **Bit errors are a setting of `fmv`'s output link, drawn into the picture** (extends ADR-0058 point 2; option A's interval and seed; **amended by the owner, AFV, 2026-11-23**):
   - **a checkbox, off by default**, with an interval (by default every 15 ± 3 s), the number of block runs per event, and a seed. The same seed gives the same events after the same start;
   - **where:** in `fmv`'s compute task, on the rendered picture before it goes to the encoder (ADR-0059 point 7). At each event, `fmv` draws runs of 16 × 16 blocks into the picture, as a decoder shows damaged macroblocks:
     - copies displaced from nearby, which smear as the picture moves; or
     - flat green.

     The damage stays in the following pictures until the next keyframe (`keyframeSeconds`), and then the picture is clean again, as a real decoder recovers. The brief fixes the shapes, the share of each kind and the order with point 1's look;
   - **the stream is never damaged:** the transport stream, the H.264, the KLV and ST 0102 are exactly as without errors. Every receiver decodes a healthy stream and shows damaged pictures;
   - **who sees it:** every receiver of that link, emcc's own input link included (ADR-0058 point 2: one way into emcc);
   - **counted:** the events, in `fmv`'s Monitor entry;
   - **the cost:** drawing the blocks runs on the same compute task as point 1, within ADR-0064's budget.
3. **Micro sway is `uav-simulation`'s, kept per camera** (extends ADR-0059 point 1; owner Q7 A):
   - **where:** in the step that makes each pose. The sway's offsets are added to the pose's pointing before the pose is sent:
     - the yaw to `azimuth`, modulo 360°;
     - the pitch to `depression`, kept within ±90°;
     - the roll to `roll`, kept within ±180°;
   - **so the KLV includes it** with no change in `fmv` (owner). Tags 18 and 19 are written from the pointing, so the frame centre, the footprint and point 4's overlay move with it. The pose's shape does not change;
   - **the motion:**
     - a few slow sine waves with random frequencies within the set range (0.5 to 3 Hz) and random phases;
     - jolts at random times, at the set rate per minute, each a step of the set strength that dies away with the set decay;
     - all from the camera's seed and the frame's time, so the same seed after the same start gives the same sway.

     The brief fixes the formula, the defaults and whether the sway runs on while the simulation is paused;
   - **the settings** are the camera's, stored with it (ADR-0059 point 4): an amplitude in degrees, the frequency range, the jolts per minute, their strength and decay, and the seed. A camera stored before has no sway. The cameras' export and import (M10's plan point 13) carries them;
   - **no threads:** the sway is computed in `uav-simulation`'s existing per-frame step, on its worker and timer (ADR-0004).
4. **The field of view is `uav-simulation`'s map overlay in Simulation** (owner Q8 A):
   - **drawn by `uav-simulation`'s web part** with SDK 1.4.0's overlay items `area` and `line`, as the simulator draws its coverage. It is not an object: it is never stored, never sent to an output and never seen in View;
   - **what it draws** for each running camera, from its latest pose with the sway included:
     - the footprint, the polygon where the four corner rays of the frame meet the ground;
     - the line of sight, from the camera to where the centre ray meets the ground;
   - **the ground is flat at 0 m HAE.** That is `fmv`'s ground where it has no height data (ADR-0059 point 8, CR-0051). The terrain is not used in M10. Over high ground the footprint therefore differs from the picture, and this is known and accepted;
   - **a ray at or above the horizon** never meets the ground. The footprint is then cut at a distance that the brief fixes, and is drawn so that it is plainly not a ground point;
   - **how often:** the web part gets the poses from its own server part at a lower rate than the frames, at most a few times a second. The brief fixes the rate and the endpoint. The server checks it as it checks the cameras' list: the permission to see cameras (ADR-0059 point 5), and only cameras whose platform object the user can read. Positions are WGS84 longitude, latitude (ADR-0007), tested with a point where latitude ≠ longitude;
   - **the look:** the UXA's (M10's plan, U1).
5. **What carries the settings:**
   - the degraded camera and the bit errors are output link settings, so M10's settings export carries them (ADR-0065, to be written);
   - the sway is a camera's, so the cameras' export carries it (M10's plan point 13).

## Alternatives considered
- **The sway in `fmv`'s per-picture step:** `fmv` would change the pointing it renders and writes to ST 0601. But the camera's settings are `uav-simulation`'s, and `fmv` would need settings per camera that it does not have. Point 4's overlay, which is drawn from the pose, would also miss the sway. Since `uav-simulation` sends a pose per frame, the board's condition for putting the sway there, a pose per picture, holds.
- **The sway's settings for the whole plugin** (Q7 B): one set for every camera. But a camera on a mast sways less than one on a small UAV.
- **The degraded camera as a camera setting in `uav-simulation`:** it is the downlink's look, so it belongs to the link that sends the video, beside its bitrate. `uav-simulation` knows nothing of pictures (ADR-0059).
- **Bit errors as lost UDP datagrams in the connection task:** a datagram holds several transport-stream packets, of the video and the KLV alike. Losing one would break the metadata, which the owner excluded, and the PAT and PMT with it.
- **Damage in the stream** (point 2 as first accepted): in `fmv`'s mux step, a few transport-stream packets of the video dropped or with payload bytes changed, never the packet headers, the PES headers and PCR, the PAT and PMT, the SPS and PPS, or the KLV. It would test a receiver's own recovery. But live, emcc's own player blacked out on every damaged frame instead of showing blocks, so the demo showed black pictures, not a damaged downlink. The owner chose the drawn errors (AFV). A drawn error does not test a receiver's recovery from a damaged stream.
- **The footprint from `fmv`'s corner points** (ST 0601 tags 26 to 33, from its renderer, terrain included; Q8 B): this is exact over high ground, and the same code could show a received video's footprint in View. It is a change of `fmv`'s and is left for later (M10's plan, Q8).
- **The footprint on the terrain** (Q8 C): this needs a height reader in `uav-simulation`, or an SDK one. It is not in M10.
- **The footprint as map objects:** these would be stored, versioned and sent to outputs at the frame rate, for something that only Simulation's users need to see.

## Consequences
- **PCA-fmv:** points 1 and 2, in the output link's settings and its compute task, with the events counted in the Monitor. Tests:
  - a seeded run draws the same blocks;
  - the stream is the same as without errors: it decodes without errors, and the KLV is whole;
  - the damage lasts until the next keyframe and is gone after it;
  - the cost of points 1 and 2 is measured.

  (M10's F4 and F5, pulled into M9.2.)
- **PCA-uav-simulation:** point 3, in the camera's settings, its stored document and the per-frame step, with tests that the same seed gives the same sway and that the pose stays within the kind's schema (V3). Point 4, the overlay in Simulation (V4).
- **PDA:** the `fmv` and `uav-simulation` briefs' parts: the settings, their defaults, the sway's formula, the overlay's cut distance and rate. No SDK change and no change to the pose's shape.
- **ITA:** bit errors against emcc's own player and the third-party receiver that M9's T2 used (M10's T4): a healthy stream with damaged pictures; the overlay in the flows (T1); the mass test's video phase (T5).
- **UDA, UXA:** the manual's pages for the link's two checkboxes, the camera's sway and the field of view; the overlay's look.
- **SRA:** nothing new reaches outside the server; the drawn bit errors leave the stream, the release limit and ST 0102 as they are.
- **Settings and cameras' exports:** they carry these settings through ADR-0065 and M10's plan point 13, with nothing extra.
