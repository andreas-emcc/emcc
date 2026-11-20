# Credits for the marketing material

Every third-party item and every tool used in `marketing/` and the root `README.md`, with its licence and where it is used (`agents/dma.md` rule 6 and 7; `CLAUDE.md` section 4, "Marketing material"). Updated 2026-11-19 (the UAV picture, M9; the one-file version of the site; the Pages workflow).

## Material

| Item | Source | Licence | Used in |
|---|---|---|---|
| Texts of the website and the readme | Written by the DMA from the repository (`website/content.md`) | Apache-2.0 (the project's) | `website/src/`, `/README.md` |
| The website's design | Chosen by the owner from six proposals that the DMA's helper agents (Claude Code sub-agents) wrote from `website/content.md`, then changed in the owner's rounds; inline CSS and SVG, no third-party code | Apache-2.0 (the project's) | `website/src/index.html` |
| The emcc logo | The owner's logo, copied unchanged from `web/shell/src/assets/logo.svg` (commit `57bcd383`) | Apache-2.0 (the project's) | `assets/logo/emcc-logo.svg`, the website's top bar |
| The favicon | Drawn by the DMA: a friendly infantry frame after APP-6 | Apache-2.0 (the project's) | `website/src/favicon.svg` |
| Screenshots | The real user interface of the emcc M8 release (`emcc-M8-RC2-2026-11-16-ab29d8f7`), and `uav.jpg` of the M9 release (`emcc-M9-2026-11-19-0575b37d`), taken by `assets/src/shots.mjs` | Apache-2.0 (the project's) | `assets/screenshots/`, the website, `/README.md` |
| The fictional exercise, simulation, GMTI scene and premade labels in the screenshots | Made up by the DMA, placed by `assets/src/scene.mjs`, `sim-scene.mjs`, `gmti-scene.mjs` and `uav-scene.mjs`; the release's own demo scenario stands beside it | Apache-2.0 (the project's) | `assets/screenshots/` |
| The archipelago chart behind the page | Drawn by the DMA with `assets/src/archipelago.mjs`: the coast after Natural Earth 1:50m land (public domain, the repository's copy in `plugins/basemap-naturalearth/data/`), smoothed; the islands placed by hand after the real archipelago, and seeded skerries. Stylised, not for navigation | Apache-2.0 (the project's); the Natural Earth part public domain, credited in the page's footer | `assets/maps/archipelago.svg`, the page's background |
| Map data in the screenshots | Natural Earth, as shipped in the release | Public domain ("Made with Natural Earth", shown on every map) | `assets/screenshots/` |
| The video in `fmv.jpg` | Our own test stream: a camera flying `assets/src/fmv/route.json`, rendered by spike S10's renderer (the project's code, `spikes/s10-uav-fmv/java/`, run unchanged) over a grey texture that `assets/src/fmv/FmvTexture.java` draws from the Sundsvall SRTM heights (hillshade, water, seeded noise). No imagery and no recording | Apache-2.0 (the project's); the heights public domain | `assets/screenshots/fmv.jpg`, the website |
| The video in `uav.jpg` | Drawn and encoded by the M9 release itself (uav-simulation and fmv's output link, the project's code) from the height data below and the orthophotos in the next row | Apache-2.0 (the project's); the sources as in their rows | `assets/screenshots/uav.jpg`, the website |
| Orthophotos in `uav.jpg` | Lantmäteriet, historical orthophotos of 2001 (OI.Histortho_bw_2001), open data; the set the owner fetched for spike S10, kept outside the repository and put into the release's `settings/imagery/` by hand. Credited as "Lantmäteriet" on the page | CC0-1.0 | `assets/screenshots/uav.jpg`, the website |
| Height data in `terrain.jpg`, `fmv.jpg` and `uav.jpg` | SRTM, the ESA's Sundsvall demo cells as the demo zip made for the release candidates has them (`emcc-demo-height-data-sundsvall-2026-11-10.zip`, CR-0037; not part of the public release, owner ADH, 2026-11-19), put in by hand, drawn by the release's height map | Public domain | `assets/screenshots/terrain.jpg`, the website |
| Symbols and graphics in the screenshots | Drawn by the release's own libraries, milsymbol (MIT) and mil-sym-ts (Apache-2.0, with its CC-BY-3.0 note, CR-0029), and the map by OpenLayers (BSD-2-Clause); their texts are in the release's `THIRD-PARTY-NOTICES.txt` | As named | `assets/screenshots/` |

No fonts are shipped: the website uses the reader's system fonts. No other brands' logos, no AI-generated media, no music.

## Tools

Installed outside the repository, or as the npm projects' own dependencies; none enters the product.

| Tool | Version | Licence | Used for |
|---|---|---|---|
| Node.js | 24.19.0 | MIT | `website/build.mjs`, `website/standalone.mjs`, `assets/src/*.mjs`; the same version in the Pages workflow |
| GitHub's actions `actions/checkout` v7.0.1, `actions/setup-node` v7.1.0, `actions/upload-pages-artifact` v5.0.0, `actions/deploy-pages` v5.0.1 | pinned to commit SHAs | MIT | `.github/workflows/website.yml`: build the site and deploy it to GitHub Pages (dev-only, nothing shipped; `CLAUDE.md` section 4, "GitHub's actions"). GitHub's runners and Pages are a hosting service |
| playwright-core (npm) | 1.63.0, pinned in `assets/src/package.json` | Apache-2.0 | Driving the browser for the screenshots |
| Chromium for Playwright | build 1243, installed by the integration tests in the user's profile | BSD-3-Clause and others (Chromium's) | Rendering the screenshots |
| Python `http.server` | 3.13 | PSF-2.0 | Serving `website/dist/` on 127.0.0.1 for the browser check only |
| Java (Eclipse Temurin JDK) | 25.0.4.1 | GPL-2.0 with the Classpath Exception | Running `FmvTexture.java` and spike S10's `LiveSender.java` |
| ffmpeg | 9.0.2 (n9.0.2-57-gd838f9f9ae), the LGPL build of spike S9, kept outside the repository | LGPL-2.1-or-later | Encoding the FMV picture's stream to H.264 (`h264_mf`) |
