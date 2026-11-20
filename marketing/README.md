# marketing/

The DMA's folder (`agents/dma.md`): the product website, contest entries, decks, print and video, with their sources and build scripts. Build output goes to ignored `dist/` folders or outside the repository. Every third-party item and tool is in [CREDITS.md](CREDITS.md).

| Folder | What | Build |
|---|---|---|
| `website/` | The site for www.emcc.dev: `src/index.html` (one self-contained page, inline CSS and SVG, no JavaScript) and `src/favicon.svg`; `content.md` is its copy with the sources. The six earlier proposals are in git history (`fde9330b`) | `cd marketing/website && node build.mjs` writes `dist/` (with `CNAME` and `.nojekyll`) and checks: no scripts, nothing loaded from other servers, no missing files, nothing over 5 MB. `node standalone.mjs` writes the same page as one file to send, `standalone/dist/emcc.html` (about 4.3 MB, every picture inside it), with the same checks. On `main` in the public repository, `.github/workflows/website.yml` runs `build.mjs` and deploys `dist/` to GitHub Pages; the built site never enters git |
| `assets/screenshots/` | JPEGs of the real UI, 1600 × 900 | See below |
| `assets/logo/` | The owner's logo, from `web/shell/src/assets/logo.svg` | – |
| `assets/maps/` | `archipelago.svg`: the stylised chart (Stockholm archipelago to Gotland) behind the page | `cd marketing/assets/src && node archipelago.mjs` |
| `assets/src/` | `scene.mjs` places the fictional exercise in View and the premade security labels, `sim-scene.mjs` places and starts the fictional simulation, `gmti-scene.mjs` the fictional GMTI picture (a radar aircraft, three columns, two gmti links on loopback 47617), `fmv-scene.mjs` the fmv link for the FMV picture, `fmv/` the FMV picture's own stream (`FmvTexture.java`, `route.json`), `uav-scene.mjs` the UAV picture (M9: a UAV track, its simulated camera and two fmv links on loopback 15610), `shots.mjs` takes the screenshots | Own npm project (`playwright-core` 1.63.0) |

## Retaking the screenshots

1. Unpack a release zip into a short folder outside the repository, near the drive's root (a path over 260 characters breaks `start.bat`), and unpack the Sundsvall height-data demo zip (`emcc-demo-height-data-sundsvall-*.zip`, the ESA's SRTM cells made for the release candidates; not part of the public release, owner ADH, 2026-11-19) into the same folder, so that `settings/terrain/` holds its DTED cells. Keep a copy of the release's `data` folder: each run below starts from it.
2. Start it without login on the DMA's port: `start.bat 18103` (M9 and later: `start.bat -standalone 18103`).
3. `cd marketing/assets/src && npm ci` (first time, online; later `npm ci --offline` works from the cache).
4. On fresh data: `node scene.mjs http://127.0.0.1:18103`, then `node sim-scene.mjs http://127.0.0.1:18103` (a second run adds everything again); wait about 20 s so that the convoys spread out.
5. `node shots.mjs http://127.0.0.1:18103 --skip=gmti,fmv,uav` writes `../screenshots/*.jpg`: `arctic`, `view-light`, `view-dark`, `view-select`, `simulation`, `settings`, `terrain`, `labeling`, `monitor`. `--only=<name>` takes the steps whose name holds the text. It exits with 1 if a step fails.
6. For `gmti.jpg`: stop the server, put the copied `data` folder back, start it again, run `node gmti-scene.mjs http://127.0.0.1:18103` alone (nothing else moving), wait about four minutes until the columns are strung out, then `node shots.mjs http://127.0.0.1:18103 --only=gmti`. The step changes the Local user's own display settings (no pairing lines, no names), which the next reset puts back.
7. For `fmv.jpg` (M8 or later; our own stream, since the FMV sample recordings have no licence):
   - once: `java -Xmx3g fmv/FmvTexture.java <release>/settings/terrain/e017/n62.dt2 <texture-folder>` draws the ground texture from the public-domain SRTM heights (outside the repository; about 25 MB of PNG);
   - `node fmv-scene.mjs http://127.0.0.1:18103` sets up the fmv link "Demo UAV" on 127.0.0.1:15609;
   - from `spikes/s10-uav-fmv/java/` (run unchanged): `java -Xmx2g LiveSender.java <repo>/marketing/assets/src/fmv/route.json <texture-folder>/imagery.json <release>/settings/terrain/e017/n62.dt2 <ffmpeg.exe> 127.0.0.1:15609 900 4 h264_mf`, with an LGPL ffmpeg that has `rawvideo` in and `h264_mf` out (S9's build, kept outside the repository; the release's own ffmpeg is too minimal), left running;
   - after about a minute, `node shots.mjs http://127.0.0.1:18103 --only=fmv`; then stop the sender.
8. For `uav.jpg` (M9 or later; the release draws the video itself):
   - put an imagery set into the release's `settings/imagery/<name>/` (`imagery.json` and its tiles; manual chapter "FMV output links, imagery and terrain"): the picture uses Lantmäteriet's historical orthophotos of 2001 round Sundsvall (CC0), the set the owner fetched for spike S10, kept with the ACA's spike data outside the repository; the heights come from the demo zip (step 1);
   - `node uav-scene.mjs http://127.0.0.1:18103` sets up the fmv links "UAV out" and "UAV 1 video" on 127.0.0.1:15610, the track "UAV 1" on its orbit and its camera, and starts them;
   - wait until `GET /api/plugins/fmv/streams` lists "UAV 1 video" as live (M9 RC1 and the release: the first encoder start can fail with START while the large imagery set loads; the link starts it again after 60 s), then `node shots.mjs http://127.0.0.1:18103 --only=uav` when the UAV is on the orbit's east-to-south leg (from about 2 to 4 minutes after the scene starts, every 7.5 minutes), so that it and its label are in the frame.
9. Look at every picture at full size, then `cd ../../website && node build.mjs`. The build copies only the pictures that the page uses, and refuses a placeholder such as `__M9_DATE__` (`node build.mjs --draft` builds anyway, for a check in the browser only). `node standalone.mjs` (and `--draft`) does the same for the one-file version to send.
