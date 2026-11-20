# NVG: sources, mapping and gaps (M7 preparation)

- Status: research note by the ACA, for the owner's decisions (2026-11-10). It prepared ADR-0055 (accepted by the owner, 2026-11-10) and prepares the brief the PDA writes for `PCA-nvg`.
- Scope (owner, 2026-11-10):
  - an `nvg` in/out plugin;
  - **In:** read NVG and place its objects on a layer;
  - **Out:** convert symbols, tactical graphics and shapes to NVG and send it;
  - **Transport:** NVG files (import and export) and the NVG SOAP web service, both as consumer and as provider;
  - **NVG 2.0.x only.**

## 1. Sources

**The NVG specification text is not public.** Neither the NVG 2.0.2 specification nor ADatP-4733 is in the owner's NSDD folder. The owner holds the specification, and it is not given to public models. This note uses only public sources. Every point that only the specification can settle is marked **[spec check]**. The owner can have those points checked by a `PCA-nvg` session on a local model (owner, 2026-11-10).

| Source | What it gives | Licence and use |
|---|---|---|
| NCI-Agency ANET, `src/main/resources/nato/common/nvg20/` ([github.com/NCI-Agency/anet](https://github.com/NCI-Agency/anet)) | The TIDE NVG 2.0 XSDs: `nvg.2.0.xsd`, `nvg.data.2.0.xsd`, `nvg.types.2.0.xsd`, `nvg.filter.2.0.xsd` and `nvg.capabilities.2.0.xsd`. Namespace `https://tide.act.nato.int/schemas/2012/10/nvg` | In an MIT repository, but written by NC3A and NCIA. Copied into the plugin's test resources only, with their origin noted (owner, Q6) |
| The same folder: `nvg2012.wsdl` and `common-ws.nvg20.wsdl` | The abstract port type `NVGPortType2012`, and its SOAP binding, `NVGBinding2012` | As above |
| ANET, `src/main/resources/nato/common/stanag4774/` and `stanag4778/` | The STANAG 4774 confidentiality label and STANAG 4778 binding XSDs, which ANET puts inside NVG | As above |
| ANET, `src/main/java/mil/dds/anet/ws/Nvg20WebService.java` | A working NVG 2.0.2 **provider** in Java (JAX-WS): access tokens, APP-6 B and D symbol prefixes, labels per document and per element, `ExtendedData` with a `Schema` | MIT. Reference only; not copied, and not usable as is (JAX-WS brings its own threads, ADR-0004) |
| NISP ([nhqc3s.hq.nato.int](https://nhqc3s.hq.nato.int/Apps/Architecture/NISP/volume3/ch01s02.html)) | NVG 2.0.2 in the FMN profile, beside SOAP 1.2 | Public web page |
| map.army ([NVG import](https://www.map.army/doc/en/data-exchange/nvg/)) | A public import of NVG 2.0.0 and 2.0.2, as a cross-check of what files look like | Public web page |

## 2. The format in brief (from the XSDs)

- **The document** is an `nvg` element. It has:
  - a required `version`, for example `2.0.2` in ANET;
  - optional `Schema`, `metadata` and `ExtendedData` elements;
  - its content;
  - an `extension` element. `anyAttribute` allows namespaced attributes of a community of interest.
- **Content:**
  - groups (`g`, which may nest);
  - `composite`, a symbolized shape made of basic shapes that may not be broken up;
  - 14 shapes: `text`, `point`, `multipoint`, `circle`, `ellipse`, `rect`, `polyline`, `arrow`, `corridor`, `orbit`, `polygon`, `arc`, `arcband` and `content-item`.
- **Every item** has:
  - a **required, immutable `uri`**, "constant across documents produced by the same source";
  - the optional `label`, `href`, `style` (inline CSS) and `textInfo` (long text);
  - `TimeStamp`, the last state change;
  - `TimeSpan` (`begin`, `end`), when the item is shown;
  - `metadata`, `ExtendedData` and `extension`.
- **Symbolized items** (all except `text`) have:
  - a `symbol`, `<scheme>:<code>`, with the default `unknown:unknown` and the example `app6b:G*C*MGPI--*****`;
  - `modifiers`, a string whose format the XSD does not give **[spec check]**.
- **Coordinates:**
  - WGS84 decimal degrees;
  - attributes `x` and `y`, or a `points` list of `lon,lat` pairs separated by spaces. Both are longitude first, as in emcc;
  - `z`, `minaltitude` and `maxaltitude` in metres;
  - `leg-type` is `great-circle` (the default) or `rhumb-line`.
- **Units and angles:**
  - speed in km/h, and a course clockwise from north;
  - `rotation` counter-clockwise: from north for a point, around the centre for an ellipse or a rect;
  - `startangle` and `endangle` clockwise from north;
  - radii and widths in metres.
- **Areas** (`polygon`, `circle`, `ellipse`, `rect`, `arcband`) may `exclude` rings (holes) of five kinds.
- **The web service** (SOAP 1.1, document/literal, as in `common-ws.nvg20.wsdl`) has two operations:
  - `GetCapabilities`, which returns `nvg_capabilities`: the filter items a provider offers, as input, select or matrix items with ids;
  - `GetNvg`, which takes an optional `nvg_filter` (the consumer's answers, by `refid`) and returns one `nvg` document.

  **There is no operation that pushes data.** The consumer always pulls. Whether SOAP 1.2 is also required **[spec check]**: NISP lists SOAP 1.2 with NVG in the FMN profile.
- **ANET's practice**, the only public provider found:
  - it reads an access token from the filter, or from a bearer header;
  - it offers the APP-6 version in its filter: `app6b:` with 15 characters, and for APP-6 D both `app6d:10…` and `app06:10…`. So the scheme name of APP-6 D and E is itself a **[spec check]**;
  - it puts a STANAG 4774 label, wrapped in a STANAG 4778 binding, in `metadata` or `extension`, both on the document and on each item.

## 3. Mapping to the data model (data model 1.5.0 as planned)

Shared rules:
- the `uri` becomes `externalRef` (the link's system and the `uri`, model rule 16);
- `label` becomes `properties.name`, and `textInfo` becomes `properties.description`;
- `TimeStamp` becomes `time.observed`. `TimeSpan` `begin` becomes `time.validFrom`, and `end` becomes `time.expires`;
- the label (4774 in `metadata` or `extension`, on the item, else on the document) becomes `label`. Otherwise the link's label, else the default label;
- `ExtendedData`, `href`, `z`, altitudes, `leg-type`, the group path and anything not mapped go to `extensions.nvg`, so that an export gives them back (ADR-0007).

| NVG | In (to emcc) | Out (from emcc) | Gap |
|---|---|---|---|
| `point` with an APP-6 `symbol` | `core.symbol` with a `Point`. The scheme gives `symbol.standard`: `app6b` gives APP-6B; APP-6 D and E as in Q3. `speed` km/h becomes m/s, `course` becomes `modifiers.direction` | The other way | The scheme names of APP-6 D and E, and the `modifiers` format **[spec check]** |
| `point` with another scheme (`2525b`, `app6a`, `app6c`, `unknown`) | `core.symbol`, the unknown symbol of its dimension; the code is kept in the extension | Not written | 2525 and APP-6 A and C are not in emcc (requirements) |
| `point` with `symbol="vessel…"` | No such NVG scheme | Vessel symbols (ADR-0047) go out as APP-6 sea surface (owner, Q4) | — |
| `multipoint`, and symbolized lines and areas whose code is a tactical graphic | `core.multipoint`: the `points` become the control points (model 1.4.0) | The other way | Which NVG element each of the graphics uses, and its point order compared with mil-sym-ts's **[spec check]** |
| `text` | — | — | **No `core.text`** (deferred in `model/README.md` until an NVG plugin is planned): data model 1.6.0 (ADR-0055 point 4) |
| `polyline` | `core.shape` `LineString` | The other way | `rhumb-line` is densified (ADR-0019) |
| `polygon` (with `exclude` linear rings) | `core.shape` `Polygon` with holes | The other way | Holes of other ring kinds are densified to linear rings |
| `circle` | `core.shape` `Circle` | The other way | — |
| `ellipse` | `core.shape` `Ellipse` | The other way | `rx`/`ry` along E/W and N/S, and rotation counter-clockwise; emcc has semi-axes (minor ≤ major) and a bearing. A conversion with a test where `rx` ≠ `ry` and latitude ≠ longitude |
| `rect` | `core.shape` `Polygon`, its 4 corners on the ground | `Polygon` only; no rect back | Its "true ground" sides: corners computed geodesically |
| `corridor` | `core.shape` `Corridor` | The other way | Altitudes go to the extension |
| `arcband` | `core.shape` `ArcBand` | The other way | Its angles are already bearings |
| `arc` | `core.shape` `LineString`, densified | Not written | — |
| `arrow` | `core.shape` `LineString` with `style.arrowhead: end` | The other way | Its `width` in metres has no counterpart: kept in the extension |
| `orbit` | `core.shape` `Polygon` (a racetrack), densified | Not written | Or a tactical graphic **[spec check]** |
| `g` | Flattened: each item becomes an object, with its group path in the extension | A `g` per source layer (owner, Q5) | Layer groups are deferred in emcc |
| `composite` | One object per part, linked by relations (ADR-0051) | Not written | Or only the first part **[spec check]** |
| `content-item` (no geometry) | Skipped and counted | — | — |
| `style` (CSS) | Its `stroke`, `stroke-width`, `stroke-opacity`, `stroke-dasharray`, `fill` and `fill-opacity` go to `style`; the rest to the extension | From `style` | Which CSS properties NVG defines **[spec check]** |

## 4. What emcc lacks today

| # | Gap | Owner |
|---|---|---|
| G1 | **Outbound HTTP is GET only** (`HttpCall`, SDK 1.x). A SOAP consumer needs `POST` with an XML body, `Content-Type` and `SOAPAction` | PDA (SDK), CDA (ECore) |
| G2 | **Plugin endpoints take JSON bodies only,** at most 1 MiB, from a browser session (CR-0026). A file import and a SOAP provider need an XML body, and a larger one for files | PDA, CDA |
| G3 | **Callers outside the browser.** The SOAP provider is called by other systems, without a browser session, so it needs a machine-to-machine credential and a permission check (overview 4.4) | ACA (ADR), CDA |
| G4 | **No file import or export in the shell.** A user must pick a file and a target layer, and download a file of chosen layers | CDA or the plugin's web part (ADR-0055 point 5) |
| G5 | **No `core.text`** | PDA (data model 1.6.0) |
| G6 | **XML safety:** NVG is untrusted XML (`agents/sra.md`): no DTDs, no external entities, limits on depth, size and items | PCA-nvg; SRA reviews |
| G7 | **A test service:** no NVG system is installed. ANET (MIT), a real NVG 2.0.2 provider, which the ESA runs (owner, Q7) | ESA |

## 5. Questions for the owner

They are in ADR-0055. The owner answered all nine on 2026-11-10; the answers are in ADR-0055's table "The owner's answers":
- Q1: the provider's callers;
- Q2: an import's objects;
- Q3: the APP-6 D and E scheme names **[spec check]**;
- Q4: vessel symbols out;
- Q5: the export layout;
- Q6: the TIDE XSDs in the repository;
- Q7: ANET as an ESA service (gap G7);
- Q8: service calls in the no-login mode;
- Q9: files as user actions or as links.
