# Brief: basemap-naturalearth

- Status: **Approved (2026-10-10)**, with the owner's answer to the open question (below) · Milestone: M1 · Task: T-041 · Agent: PCA-basemap-naturalearth (new)
- **Updated 2026-10-27 for M3 (T-077, for T-085): function 7, criterion 9; nothing to build.** Reviewed by the ACA (T-078, `docs/architecture/reviews/m3-briefs.md`, U1 to U7 taken), with the owner's decisions of 2026-10-27, rechecked by the ACA, and **approved by the owner (2026-10-27)**. ADR-0039 (workspaces), the workspace rules in the briefs README ("M3: the reused plugins in a workspace").
- Read also: **CR-0009** (Natural Earth may ship), **ADR-0025** (vector background maps), ADR-0030 (everything works offline; it superseded ADR-0014), ADR-0009, overview 4.7, `CLAUDE.md` sections 4 and 6.
- Built against **SDK v1** (T-034, CR-0010): its vector source for `BackgroundMapProvider`. SDK v1 is frozen (2026-10-10): where a name here differs, the SDK documentation wins.

## Purpose

An **offline background map in every projection, polar ones included**: land, water, coastlines and country borders from Natural Earth. It is the M1 polar map (`requirements.md`, First demo), and the background for portable use and quick demonstrations, because it needs no internet and no map server (ADR-0025). Detail is limited by the scale of the data: zoomed far in, it is coarse. WMS fills that gap in M4.

## Kind and parts

- Kind: **background map**. Properties: none (its data ships with it).
- Parts in M1: **web only.** The data files are part of the built web part, served by the emc2 server like every plugin file (CSP `'self'`).

## Functions (M1)

1. **Provider.** Registers one `BackgroundMapProvider` named "Natural Earth", with the SDK v1 **vector source**. It declares **every projection** (ADR-0025 point 4), so the map view offers it in EPSG:3857, EPSG:3413, EPSG:3031 and any other configured projection.
2. **Data: Natural Earth at 1:50m**, five layers:

   | Layer | Natural Earth file | Drawn as |
   |---|---|---|
   | Land | `ne_50m_land` | filled polygons, no outline |
   | Antarctic ice shelves | `ne_50m_antarctic_ice_shelves_polys` | filled polygons, lighter than land, no outline |
   | Lakes | `ne_50m_lakes` | filled polygons, water colour |
   | Coastline | `ne_50m_coastline` | lines |
   | Country borders on land | `ne_50m_admin_0_boundary_lines_land` | thin lines |

   - Water is the background colour of the source; there is no ocean layer.
   - **For the owner (CR-0009):** CR-0009 names land, coastlines and country borders. Lakes and the Antarctic ice shelves are added from the same data set, so that inland water and the Antarctic coast look right in the polar views. Both are approved with this brief, or left out.
   - **Why 1:50m:** 1:110m is too coarse at the default zoom over Scandinavia. 1:10m is about 28 MB as GeoJSON for these layers, too much to load once per browser session. The five 1:50m files are about 5 MB as distributed.
   - **Size budget:** the shipped data is **at most 5 MB** in total, checked by a test. The conversion (function 4) is expected to bring it well below that.
3. **Style:** simple and muted, so that it does not compete with the symbols: land, ice, water, coastline and border colours, given as data in the vector source's style. No labels or place names.
4. **How the data enters the repository** (CR-0009, `CLAUDE.md` section 6):
   - **The original files are committed, unchanged,** in `plugins/basemap-naturalearth/data/`: the five GeoJSON files of one Natural Earth release, from the official Natural Earth vector repository (for example release 5.1.2, the latest when downloaded). They are the source, not generated files.
   - **The plugin's web build converts them** into the shipped files, with a script in the plugin (Node, no dependencies), so `dist/` is never committed:
     - keep only the geometry, plus the layer it belongs to;
     - round coordinates to 4 decimals (about 11 m, finer than the data's own accuracy);
     - no simplification, no edit of content. Dropping attributes and rounding coordinates count as shaping under CR-0009 (format and simplification), never as an edit of content.
   - The conversion is deterministic: the same originals always give the same bytes.
   - **The README records** the Natural Earth version, the source address, and the SHA-256 checksum of each original file. A test checks the checksums.
   - **The one-time download** needs the owner's permission when the PCA starts: the PCA names each file, its source and its size when asking (T-041).
5. **Loading:** the data is loaded when the background is first shown, once per browser session (the browser caches it), not at page load when another background is chosen.
6. **Credit:** "Made with Natural Earth" in the provider's attribution, always visible while the background is shown (CR-0009). The README and the third-party notices (MCA, T-044) name the data set as public domain.

## Functions (M3)

Built against SDK 1.2.0 (T-076) and the shell's workspaces (CDA, T-080), with the workspace rules 1 to 9 in the briefs README ("M3: the reused plugins in a workspace").

7. **Every workspace:** the provider is a service of the page, so the map view offers it in every workspace (`map-view-2d` function 22). Its data is loaded once per browser session, also when two workspaces show it. **No code change is expected.**

## Out of scope (M1)

Other scales or levels of detail, rivers, place names and other labels, roads, relief or raster layers, settings for colours and line styles, a server part.

## Interfaces

| Direction | What |
|---|---|
| Provides | `BackgroundMapProvider` with a vector source (web SDK v1) |
| Requires | Nothing from other plugins (the map view consumes it) |
| Objects | None |

## Dependencies

None beyond the SDK. The conversion script uses only Node's own modules. The data: Natural Earth, public domain (CR-0009).

## Settings

| Setting | Default |
|---|---|
| Show country borders | yes |

## Permissions

None.

## Internet access

**Not allowed.** All data ships with the plugin. The ITA's offline tests use it.

## Acceptance criteria

1. The background is offered and drawn in EPSG:3857, EPSG:3413 and EPSG:3031, with "Made with Natural Earth" visible.
2. **Polar views:** in EPSG:3413 the Arctic coasts (Greenland, Svalbard, the Russian coast across the antimeridian) and in EPSG:3031 Antarctica are drawn closed and in the right place, with no seam along 180° and no stray polygon across the map (with `map-view-2d`, T-042).
3. Positions are right: a coastline point read from the data (latitude ≠ longitude) appears at that place in each projection, checked by converting back from screen to lon/lat.
4. No request leaves the emc2 server's origin (browser test, offline).
5. The shipped data is at most 5 MB in total, and holds only the five layers.
6. The checksums of the committed originals match the README, and the build gives the same shipped bytes from them every time.
7. Without a GPU (the dev VM), pan and zoom with this background stay usable: no frame gap above 0.5 s (as `map-view-2d` criterion 8).
8. The data is not loaded while another background is shown.

From M3 (once in the browser, with the shell's workspaces):

9. Natural Earth can be chosen in Simulation, with "Made with Natural Earth" visible, and showing it in View and Simulation loads its data once (the browser's network log).

## Open questions for the owner

Answered by the owner on 2026-10-10, as recommended.

1. ~~**Committed originals or committed converted files**~~ **Decided by the owner, 2026-10-10:** commit the original files (one fixed Natural Earth version, with their checksums) and convert them in the build, as function 4 says. The converter is the plugin's own Node script without dependencies: **a converter tool from npm or elsewhere is a dependency and needs the owner's approval** (exact version and licence). The recommendation was: **commit the originals and convert in the build** (function 4). Generated files are not committed (`CLAUDE.md` section 6), and the build is offline anyway. The checksums prove that the data is Natural Earth's, and the conversion is code that can be reviewed. The cost is about 5 MB in the repository, once. Committing converted files instead would need an exception to section 6, and the shipped bytes could no longer be traced to the originals by a test.
