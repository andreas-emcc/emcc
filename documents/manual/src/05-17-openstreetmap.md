# OpenStreetMap background

Settings for the OpenStreetMap background map. The emcc server fetches the map tiles from a tile server on the internet and passes them on to the browsers. Your browser never talks to the internet. The computer that runs emcc needs to reach the tile server. If it cannot, use another background: see [Map controls](03-03-map-controls.md).

| Setting | What it does | Default |
|---|---|---|
| Tile URL | The tile server's address, as a template with `{z}`, `{x}` and `{y}` | `https://tile.openstreetmap.org/{z}/{x}/{y}.png` |
| Highest zoom level | The highest zoom level that is served and offered to the map, from 0 to 19 | 19 |
| Tiles in the cache | How many tiles the server keeps in its memory. The least recently used are dropped. From 1 to 10 000 | 2 000 |
| Tile request timeout | How long one request to the tile server may take before it is cut off, from 1 to 30 | 5 |

The plugin goes to the internet: the Monitor shows "declared" in its Internet column. The credit "OpenStreetMap contributors" is always shown on the map when this background is in use.

The default tile server is the OpenStreetMap Foundation's. Its terms limit heavy use. If many users will use the map, point the setting at a tile server of your own.
