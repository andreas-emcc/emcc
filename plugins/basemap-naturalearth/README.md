# basemap-naturalearth

An offline background map in every projection, polar ones included: land, Antarctic ice shelves, lakes, coastline and country borders from Natural Earth 1:50m. Web part only (brief: `docs/plugins/briefs/basemap-naturalearth.md`; ADR-0025; CR-0009).

## What it does

- Provides one `BackgroundMapProvider`, "Natural Earth", with a **vector source** (SDK v1). It declares `projections: 'any'`, so the map view offers it in EPSG:3857, EPSG:3413, EPSG:3031 and every other configured projection.
- Five layers, drawn in this order (first at the bottom), muted so that they do not compete with the symbols. Water is the source's background colour; there is no ocean layer and there are **no labels**.

  | Layer id | Natural Earth file | Drawn as |
  |---|---|---|
  | `land` | `ne_50m_land` | filled polygons, no outline |
  | `ice-shelves` | `ne_50m_antarctic_ice_shelves_polys` | filled polygons, lighter than land, no outline |
  | `lakes` | `ne_50m_lakes` | filled polygons, water colour |
  | `coastline` | `ne_50m_coastline` | lines |
  | `borders` | `ne_50m_admin_0_boundary_lines_land` | thin lines |

- The map view calls `load()` when the background is first shown, at most once per page. Until then nothing is fetched, and nothing is fetched while another background is shown. The browser caches the file for the session.
- The credit "Made with Natural Earth" is the provider's attribution, so the map view shows it whenever the background is shown (CR-0009).

## The data

The data is **Natural Earth** (naturalearthdata.com), **public domain**. Natural Earth asks for no credit; the project gives one anyway (CR-0009).

- **Version:** Natural Earth vector 5.1.2 (tag `v5.1.2`, 2022-05-13).
- **Source:** the official repository, <https://github.com/nvkelso/natural-earth-vector>, folder `geojson/`, e.g. `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_50m_land.geojson`.
- **Downloaded once** on 2026-10-11 with the owner's permission, and committed **unchanged** in `data/`. They are the source, not generated files. `data/.gitattributes` stops git from converting their line endings, so the checksums hold on every platform.

| File | Size (bytes) | SHA-256 |
|---|---|---|
| `ne_50m_land.geojson` | 1,636,166 | `e874b27a51d146452be360cafb3cc50c86001074a67d534113e6534682f9826b` |
| `ne_50m_antarctic_ice_shelves_polys.geojson` | 131,055 | `fedf866d20e20e37d037fa19968b6d3022fbe5323fd8728527b0f0ddb547e790` |
| `ne_50m_lakes.geojson` | 876,018 | `d350b75978b26fe839b797c2c529b2fb8f47fb3983c03f4964e36d5df9378a52` |
| `ne_50m_coastline.geojson` | 1,640,858 | `271f1c4c1908312bac6b29d158ea1356544beafc129f260005300913aa5ea283` |
| `ne_50m_admin_0_boundary_lines_land.geojson` | 760,189 | `2faac4f6b34386f3d21b6e018cf151f241f00e5c936d44dd17d7d9bfb147fa48` |

A test (`web/test/data.test.ts`) checks the checksums and sizes against this table.

**Conversion.** The web build (`web/vite.config.ts`) runs `web/scripts/convert.ts`, plain Node with no dependencies, and writes `data/natural-earth.json` into the built web part (`dist/` is never committed). Shaping only, never an edit of content (CR-0009):

- keep the geometry and its layer id; drop every attribute, `bbox` and the CRS member;
- round coordinates to 4 decimals (about 11 m);
- no simplification, no reordering, no clipping.

The originals are in lon/lat and already cut at ±180° (Antarctica runs along latitude −90°), which is what the SDK's vector source requires. The conversion is deterministic: the same originals give the same bytes. A test checks this, that the shipped data is at most 5 MB, that it holds only the five layers, and that no feature or coordinate is lost.

## Settings

| Name | Default | Meaning |
|---|---|---|
| `showBorders` | `true` | Draw the country borders on land. Read when the page loads (a provider is data; the map view reads its layers once), so a change shows after a reload. |

## Messages and services

- Provides `emc2.background-map` (`BackgroundMapProvider`, vector source). Requires and uses no service. No topics, no endpoints, no server part.
- Fetches one URL, and only when the map view calls `load()`: `${ctx.webBase}data/natural-earth.json`, a file of this plugin served by the emc2 server.

## Permissions and internet

None. No internet access: all data ships with the plugin (ADR-0014).

## Known limits

- **Coarse when zoomed in.** The scale of the data is 1:50m; WMS (M3) fills that gap.
- The `showBorders` setting applies at page load, not live (see Settings).
- Browser checks in EPSG:3857, EPSG:3413 and EPSG:3031 (acceptance criteria 1–4, 7) need `map-view-2d`'s vector drawing (T-042) and the shell runtime (T-038); see `docs/handover/pca-basemap-naturalearth.md` for what has been checked.
