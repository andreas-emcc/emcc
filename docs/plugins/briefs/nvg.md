# Brief: nvg

- Status: **Approved by the owner (2026-11-11, RJ A)**, with the owner's RK A, RL B and RM A: **NVG is input and output only** (an import becomes ordinary objects; a composite's parts stay linked by `nvg.part`; a re-import updates by `externalRef`; anything in a layer is written out). **The assumptions N1 to N12 were not accepted**; rewritten on 2026-11-12 against those answers (N8 and N9 dropped, N12 rewritten; "The assumptions") and **accepted by the owner (2026-11-12, RO A)**. **Updated 2026-11-12 with the owner's RU A on PCA-nvg's questions:** NV1 A ("Get capabilities" in the panel, for admins only), NV2 P1 (an import answers 202 and the panel polls its job) and P2 (the panel's own layer picker), NV3 A (ANET's `app06:` read as APP-6D); functions in section 4, criteria 12 and 14. Follows the M7 plan (`docs/architecture/m7-plan.md`, lane G): the codec first, then the links and the panel. · Milestone: M7 · Task: T-173 · Agent: PCA-nvg (new; worktree and browser-check port from the MCA)
- **Built by the playbook** `docs/plugins/in-out/playbook.md` (v3), work packages 1 to 5. This brief has the playbook's nine sections (its section 4).
- **Read first:**
  - ADR-0055 (NVG in and out; the owner's Q1 to Q9), the ACA's note `docs/architecture/nvg.md` (sources, format, mapping, gaps), ADR-0037 (links and output channels), ADR-0004 (workers, rule C7), ADR-0030 (offline, hosts only from settings), ADR-0007 (coordinates, labels, extensions), ADR-0042 (locked layers) and ADR-0053 point 5 (checking the user in an endpoint);
  - the ESA's sheet `external/anet/README.md`: ANET 3.9.0, an NVG 2.0.2 provider at `http://localhost:8380/cxf/nvg/20`, with its access token in the ESA's credentials folder.
- **Built against SDK 1.6.0** (`sdkVersion` `^1.6.0`): part A of CR-0041 (outbound `POST`, a named credential, raw bodies, service endpoints, `core.text`). Nothing can be built before part A, except the parser and the mapping (work package 1) against the test kit.
- **The specification is not public** (ADR-0055). The plugin is built from the TIDE XSDs and WSDLs and from ANET. **[spec check]** marks a point only the specification settles; the owner may have a `PCA-nvg` session on a local model check them (owner, 2026-11-10). Until then the brief's choice stands and is listed in the plugin's README, "Spec checks".

## 1. Purpose

One plugin, `nvg`, **in and out** (ADR-0055 point 1), for NVG 2.0.x:
- **In:** it reads NVG 2.0.0 to 2.0.2 and places the items on a layer, from a **file** the user imports, or from a remote **NVG web service** it polls (`soap-consumer` link).
- **Out:** it writes NVG 2.0.2 from symbols, tactical graphics, shapes and texts, to a **file** the user exports, or as an **NVG web service** other systems call (`soap-provider` link).
- A **server part** (parsing, writing, the links, the endpoints) and a **web part** (the NVG panel with Import and Export).
- **Category** (T-174): Data Links.

## 2. Specification

- **NVG 2.0.x**, the TIDE schemas, namespace `https://tide.act.nato.int/schemas/2012/10/nvg`: `nvg.2.0.xsd`, `nvg.data.2.0.xsd`, `nvg.types.2.0.xsd`, `nvg.filter.2.0.xsd` and `nvg.capabilities.2.0.xsd`. Also the WSDLs `nvg2012.wsdl` and `common-ws.nvg20.wsdl`, and the STANAG 4774 and 4778 XSDs, all from ANET's `src/main/resources/nato/` (owner, Q6).
  - **They are copied into the plugin's test resources** (`plugins/nvg/server/src/test/resources/nvg20/`), with a `SOURCE.md` naming ANET's repository, the commit, the path and ANET's MIT licence. They are dev-only and never shipped.
  - The plugin's tests validate every document it writes against them (the JDK's `javax.xml.validation`, in tests only).
- **Reads:** a document's `version` 2.0.0, 2.0.1 or 2.0.2. Any other version is refused with "NVG <version> is not supported; 2.0.x only".
- **Writes:** `version="2.0.2"`.
- **Used:** the 14 shapes, `g` (flattened), `composite`, the items' common attributes, `metadata` and `extension` with a STANAG 4774 label in a 4778 binding, `ExtendedData`, `TimeStamp` and `TimeSpan`. From the web service: `GetCapabilities` and `GetNvg` with `nvg_filter`.
- **Ignored**, with a counter (section 6): `content-item` (no geometry); elements of another namespace outside `extension`, which are kept whole in `extensions.nvg` (section 3) when they are inside an item.
- **Not in M7** (ADR-0055 point 9; section 9): NVG 1.x, the streaming protocol, serving a WSDL, authentication of service calls, files as a link kind.

## 3. Mapping

`docs/architecture/nvg.md` section 3 is the starting table. This section decides what it leaves open. **Coordinates:** `x`, `y` and `points` are longitude first, as in emcc. Every converter test uses a point where latitude ≠ longitude, and an ellipse with different axes (ADR-0055 point 7).

**The rules for every item:**
- **Identity:**
  - **In:** `uri` → `externalRef` `{ system, id: uri }`. The system is the link's name for a `soap-consumer` link, and `nvg-file:<file name>` for an import (ADR-0055 points 2 and 3; owner, Q2).
  - **Out:** the `uri` is the `externalRef` id when the object came from NVG, else `urn:uuid:<object id>`. So it stays the same across documents.
- `label` ↔ `properties.name`; `textInfo` ↔ `properties.description`.
- `TimeStamp` ↔ `time.observed`; `TimeSpan` `begin` ↔ `time.validFrom` and `end` ↔ `time.expires`.
- **The security label:**
  - **In:** the item's STANAG 4774 label in its 4778 binding, in `metadata` or `extension`, becomes the object's label. Otherwise the document's label, else the link's `label` (or the import dialog's), else the server's default label (ADR-0055 point 6).
    - A 4774 label maps to `policyIdentifier`, `classification` and `categories`.
    - A classification the policy's order does not know is refused for that item, counted as `label not understood`.
  - **Out:** every item and the document carry their label, in `metadata` as a 4778 binding of a 4774 label, the way ANET does it **[spec check of the placement]**.
- **`style`** (inline CSS): `stroke`, `stroke-width`, `stroke-opacity`, `stroke-dasharray` (dashes → `dash`, dots → `dot`), `fill` and `fill-opacity` ↔ `Style`. The other properties go to `extensions.nvg.style`, the CSS text kept **[spec check: the CSS properties NVG defines]**.
  - **A `text`** (owner, SG A, 2026-11-12): its `fill` ↔ `style.strokeColor`, both ways, as SVG colours a text's letters with `fill` and data model 1.6.0 takes a `core.text`'s colour from `strokeColor`. Its other CSS, its `stroke` included, stays in `extensions.nvg.style` and is written back **[spec check: a text's colour]**.
- **`extensions.nvg`** keeps everything the model has no field for, so an emcc export gives it back (ADR-0007):
  - `href`, `ExtendedData` (as XML text), `z`, `minaltitude`, `maxaltitude` and `leg-type`;
  - `groupPath`, the `g` labels from the root, as a list;
  - the original `symbol` when it was not mapped;
  - an arrow's `width`;
  - a `composite`'s `uri`.

**Per element:**

| NVG | In | Out |
|---|---|---|
| `point` with `app6b:` | `core.symbol`, standard `APP-6B`, the 15 characters | The other way |
| `point` with `app6d:` or `app06:` + 20 digits | `core.symbol`, `APP-6D` (`app06:`, as ANET writes it, is read as APP-6D: owner, NV3 A) | `app6d:` (owner, Q3) |
| `point` with `app6e:` + 30 digits | `core.symbol`, `APP-6E` | `app6e:` (owner, Q3) **[spec check of both scheme names]** |
| `point` with another scheme (`2525b`, `2525c`, `app6a`, `app6c`, `unknown`) | `core.symbol`, the APP-6D unknown symbol (`10000000000000000000`), the code kept in `extensions.nvg.symbol` | Written back with its kept code (owner, 2026-11-11: anything in a layer is written out) |
| `point`'s `speed` (km/h), `course` | `symbol.modifiers.speed` in m/s (÷ 3.6), `modifiers.direction` | The other way |
| `point`'s `modifiers` | Kept as text in `extensions.nvg.modifiers` **[spec check: its format]** | Written back as it came |
| Vessel symbols (ADR-0047) | – | `point` as the APP-6D sea surface symbol of its identity (owner, Q4): `app6d:` and the 20 digits `10`, `0`, the identity's digit, `30`, `0`, `0`, `00`, `140000`, `0000`: sea surface, civilian, `ais`'s generic vessel (its brief, section 3) **[spec check]** |
| `multipoint`, `polyline`, `polygon`, `arrow` whose `symbol` is an APP-6 tactical graphic | `core.multipoint`: the points are the control points in the order sent | The other way. The point order compared with mil-sym-ts's (`GraphicCatalogEntry.points`) is a **[spec check]**; until then the order is kept as it is |
| `text` | **`core.text`** (CR-0041 part A): `x`, `y` → its `Point`; the text → `text.value`; `rotation` (counter-clockwise from north) → `text.rotation` = (360 − rotation) mod 360 | The other way |
| `polyline` | `core.shape` `LineString`; `rhumb-line` is densified (ADR-0019), the leg type kept | The other way, great circle |
| `polygon` with `exclude` | `core.shape` `Polygon` with holes; holes of other ring kinds are densified to linear rings | The other way |
| `circle` | `core.shape` `Circle` | The other way |
| `ellipse` | `core.shape` `Ellipse`: `rx` and `ry` are the E/W and N/S semi-axes before the rotation. The larger becomes `semiMajor`, and `bearing` = (90 − rotation) mod 180 when `rx` ≥ `ry`, else (360 − rotation) mod 180 | The other way, `rx` = `semiMajor` along the bearing |
| `rect` | `core.shape` `Polygon` of its four corners, computed geodesically | – (written as `polygon`) |
| `corridor` | `core.shape` `Corridor` | The other way |
| `arcband` | `core.shape` `ArcBand` | The other way |
| `arc` | `core.shape` `LineString`, densified (at most 1° apart) | – (written as `polyline`) |
| `arrow` without a graphic | `core.shape` `LineString` with `style.arrowhead: end`; the width kept | The other way |
| `orbit` | `core.shape` `Polygon`, the racetrack densified | – (written as `polygon`) |
| `g` | Flattened: each item one object, its path in `groupPath` | One `g` per source layer, its `label` the layer's name (owner, Q5) |
| `composite` | One object per part, each part's `uri` its own (`<composite uri>#<n>` when a part has none), the parts related to the first by the relation kind `nvg.part` (ADR-0051; **owner, RL B**) | Each part as its own element; the composite is not built again (its `uri` kept in `extensions.nvg`) |
| `content-item` | Skipped, counted | – |

**Everything in a layer is written out** (owner, 2026-11-11), by its type and geometry:
- `core.symbol` → `point` with its scheme, and a vessel as above;
- `core.multipoint` → `multipoint` with its graphic's code, APP-6B as `app6b:`;
- `core.text` → `text`;
- `core.shape` and **any other object type** (a plugin's own, e.g. a route) by its geometry:
  - `Point` → `point` with `unknown:unknown`;
  - `MultiPoint` → `multipoint`;
  - `LineString` → `polyline`, or `arrow` with `style.arrowhead: end`;
  - `Polygon` → `polygon`;
  - `Circle`, `Ellipse`, `Corridor` and `ArcBand` → their elements.

Only the label limit holds an object back (section 4, `highestClassification`); an export skips nothing else.

**The relation kind** `nvg.part`, "NVG composite", with a 1 px grey line, `defaultOn` false (owner, RL B).

**Ordinary objects** (owner, RK A): what an import or a `soap-consumer` link writes has **the data type of hand-made objects, `core.general`** (the default of `draw-symbols`', `draw-tactical`'s and `draw-shapes`' "Data type for new …"), and texts are `core.text`. The plugin declares **no data type of its own**. So the objects are edited, moved, copied and deleted with the usual tools, like hand-made ones, and only their `dataSource` and `externalRef` say where they came from.

## 4. Transport

**Files** (ADR-0055 point 3; owner, Q9 A): user actions in the NVG panel, not links.
- **Import NVG…:**
  - **The dialog:** the user picks an `.nvg` or `.xml` file and a target layer of the current workspace (**the panel's own layer picker**, owner NV2 P2: the workspace's layers the user may edit, or a new layer named after the file), with the label to use for items without one (the default label).
  - **The request:** the web part posts the file's bytes to `POST /import?layer=<id>&name=<file name>&label=…` as `application/xml`, a raw body of at most 16 MiB (CR-0041 part A).
  - **The answer** (owner, NV2 P1): **202** with a job id as soon as the body is taken; the import runs on a compute worker (rule C7). The panel polls `GET /import/<job>` (every second) until it answers the counts (created, updated, skipped by reason) or the reason it was refused, and shows them. A job is kept for 10 minutes after it ends; an unknown or expired job answers 404, and only the user who started it may read it (else 404).
- **The import's checks** (ADR-0055 point 3):
  - **The user's right:** the handler checks the user's edit permission for the target layer's workspace (`objects.edit` in View, the workspace's `editPermission` elsewhere; `EndpointRequest.user().has`), else 403 "You may not edit this layer".
  - **A locked layer** is refused with 409 "The layer is locked" (ADR-0042), since the plugin's own writes carry no user.
  - **What is written:** ordinary objects of data type `core.general` (RK A), `dataSource` `nvg-file`, `externalRef` `nvg-file:<file name>` + `uri`, so **the same file again updates its objects** (owner, Q2 and RM A), wherever a user has moved them since. The objects of that file that are no longer in it are left as they are: a file is not the whole picture (N3).
- **Export NVG…:**
  - **The dialog:** the user picks one or more layers of the current workspace.
  - **The request:** `GET /export?layer=<id>&layer=<id>…` answers `application/xml` with `Content-Disposition: attachment; filename="<first layer's name>.nvg"`, and the web part saves it.
  - **Checks:** the view permission for each layer, else 403. An export skips what the user may not see (ADR-0020).
  - **Its layout:** one `g` per layer (owner, Q5), **every object in it** (section 3, "Everything in a layer"), each with its label.
- **Who sees the panel:** every user, in every workspace. Import is greyed with its reason without edit rights in the workspace.

**The web service** (SOAP 1.1, document/literal, the TIDE binding `NVGBinding2012`):
- **`soap-consumer`, in:**
  - **The call:** every `intervalSeconds` (default 60), `GetNvg` with the link's filter answers as `nvg_filter` (empty when none), by `HttpCall.post(url, "text/xml; charset=utf-8", envelope)` with the header `SOAPAction` as the WSDL gives it.
  - **The access token:** the link's `credential` names it (CR-0041 part A, local configuration, never the settings).
  - **The answer:** `maxResponseBytes` 16 MiB and the link's `timeoutSeconds`. The response is parsed on a compute worker (rule C7).
  - **The whole picture** (ADR-0055 point 2):
    - each item is created or updated by its `uri`;
    - an object of the link whose `uri` is no longer in the document is deleted, but **only after a complete document that parsed without a refusal**;
    - a failed call, a SOAP fault, an HTTP error or a refused document changes nothing, counted;
    - an empty document clears the link's objects only when `clearOnEmpty` is on (off by default).
  - **One call at a time** per link: a call that is still running when the next is due skips that turn, counted.
  - **"Get capabilities"** (owner, NV1 A): a button in the NVG panel, **shown to admins only** (the endpoint checks `settings.admin`, else 403), with a choice of the `soap-consumer` link. It calls `GetCapabilities` once and lists the provider's filter items (id, label, kind) in the panel, so that the admin can fill in the link's filter answers in its settings. No call is made at each poll.
- **`soap-provider`, out:**
  - **The endpoint:** a service endpoint `POST /nvg/{link}` (CR-0041 part A, at `/api/services/nvg/nvg/<link>`), raw `text/xml` and `application/soap+xml`, at most 1 MiB, the edge logging each call. It answers `GetCapabilities` and `GetNvg`.
  - **The link's source:** its `sourceLayers`, and the latest items senders give its output channel (`ChannelSpec`, kinds objects), coalesced by id; a removal drops the item.
  - **What is served:**
    - `GetCapabilities` offers one select item, `layers`, listing the source layers by name;
    - `GetNvg` with that answer serves those layers, and without it all of them;
    - an object's absence from the next document is its delete;
    - an object that came in through a link is never sent back to it (ADR-0037 point 3);
    - objects above the link's `highestClassification` are skipped and counted (ADR-0037 point 8).
  - **Its SOAP:** SOAP 1.1. A SOAP 1.2 request (`application/soap+xml`) is also answered, in SOAP 1.2 (N5) **[spec check: whether 1.2 is required]**. A request that is not one of the two operations gets a SOAP fault.
  - **No authentication in M7** (owner, Q1 and Q8 C): the link answers every caller that reaches the server, also in the no-login mode. **The link's settings say so** in their description: "Turning this link on makes its source layers readable by any system that reaches this server." An unknown or disabled link answers 404.
  - **Building the answer:** from the plugin's own copy of its source layers, kept from its subscription, written on a compute worker when large, at most 16 MiB (above that, a fault "document too large").

**Parsing untrusted XML** (ADR-0055 point 1; `nvg.md` G6; the SRA reviews it after M7, before M8: the plan's Q5):
- **The parser:** the JDK's StAX (`XMLInputFactory`) with `SUPPORT_DTD` false and `IS_SUPPORTING_EXTERNAL_ENTITIES` false. A document with a DTD is refused.
- **The limits:** at most 16 MiB, a depth of 64, 100 000 items, 1 000 000 points in all, and a `text` or attribute of 1 MiB. Over a limit, the document is refused with its reason.
- **No library:** no JAXB, no JAX-WS, no third-party library (ADR-0055 point 1). The writer uses `XMLStreamWriter`.

## 5. Links and settings

The `links` setting, from `Link`'s schema in the template, with `mode` replaced by the link's kind:

| Setting | Default | Notes |
|---|---|---|
| `links[].name`, `enabled` | – | the link's key: its data source, status entry, credential name and output channel id `nvg/<name>` |
| `links[].kind` | `soap-consumer` | or `soap-provider`. **The form shows only the kind's fields** (`visibleWhen`, SDK 1.5.0) |
| `links[].url` | – | consumer: the provider's endpoint, `http` or `https` (from the admin's settings only, ADR-0030) |
| `links[].credential` | empty | consumer: the name of a token in local configuration (CR-0041 part A); empty, no `Authorization` |
| `links[].intervalSeconds` | 60 | consumer: 10 to 3 600 |
| `links[].timeoutSeconds` | 30 | consumer: 5 to 55 |
| `links[].filter` | empty | consumer: a list of `{ refid, value }`, the answers sent in `nvg_filter` |
| `links[].targetLayer`, `links[].label` | a new layer named like the link; the server's default label | consumer: the layer picker and the label for items without one |
| `links[].clearOnEmpty` | off | consumer: an empty document clears the link's objects |
| `links[].sourceLayers` | – | provider: the layer picker for several layers |
| `links[].highestClassification` | the policy's highest | provider: ADR-0037 point 8 |
| `links[].authentication` | `none` | provider: only `none` in M7 (ADR-0055 point 5.3). Shown, not editable, with the warning above |
| `maxDocumentMegabytes` | 16 | 1 to 16, for files and both link kinds |

- **The manifest:**
  - `category` `data-links`;
  - `internet` with `hosts: []` (a consumer may reach an internet host, ADR-0030), and no `connections` (no socket of its own);
  - **no data types** (owner, RK A): it writes `core.general` objects;
  - the relation kind `nvg.part`.
- **Settings change at once:** a changed interval, filter, layer or label applies at the next poll, without a restart.
- **Permissions:** none of its own in M7. Import and Export check the user's workspace permissions (section 4). The provider has no permission (no authentication, owner Q1). `nvg.serve` comes with authentication, later.

## 6. Status and counters

Per link, in the Monitor, as the template's status:
- **consumer:** the last call's time and result, "<n> items, <c> created, <u> updated, <d> deleted", and the next call's time;
- **provider:** the calls answered, the last caller's address and time, and the items served.

Counters (dropped or refused, each by reason):
- `refused: version`, `refused: DTD`, `refused: limit <which>`, `refused: not XML`;
- `skipped: content-item`, `label not understood`, `above highest classification`;
- `call failed`, `SOAP fault`, `HTTP <status>`, `skipped turn`, `fault answered`.

Imports and exports report their counts in the panel, not in the Monitor.

## 7. Reference data

- **ANET** (the ESA's service, owner Q7, OQ A): NVG 2.0.2 SOAP at `http://localhost:8380/cxf/nvg/20`, with its access token in the ESA's credentials folder (`external/anet/README.md`). It has six Swedish demo reports dated at every start. ANET runs on Windows only and needs the ESA's Keycloak running at its start.
- **The live check** (work package 5, recorded in the handover):
  - a `soap-consumer` link to ANET with its token as the credential and the filter answer `pastDays=1` gets ANET's three youngest demo reports into a layer (with the default `pastDays`, the six and, for a week after ANET's first start, about sixteen development points; `external/anet/README.md`), as `core.symbol` with labels, and keeps them on the next poll;
  - an export of that layer, imported again into a new layer, gives the same objects;
  - a `soap-provider` link over one layer answers a `GetNvg` from a second emcc's consumer (or from a `curl` with ANET's request body) with those items.
- **A sample file:** `plugins/nvg/server/src/test/resources/samples/` holds a document the PCA writes by hand with every element of section 3, latitude ≠ longitude.

## 8. Acceptance criteria

1. **Versions:** documents of 2.0.0, 2.0.1 and 2.0.2 are read; 1.5 and 3.0 are refused with the reason; a written document has `version="2.0.2"` and validates against the TIDE XSDs of the test resources.
2. **Safety:** a document with a DTD, with an external entity, deeper than 64, with more than 100 000 items or over 16 MiB is refused with its reason, nothing written; no outside request is made (the test kit's `OutboundHttp` sees none).
3. **Points and symbols:** a `point` at `x="15.2" y="58.4"` with `app6b:SFGPUCI----D---`, `speed="36"` and `course="45"` gives a `core.symbol` at [15.2, 58.4], APP-6B, speed 10 m/s, direction 45; `app6d:` and `app06:` with 20 digits give APP-6D; `app6e:` with 30 digits APP-6E; `2525b:…` gives the unknown symbol with the code kept; and each goes out as it came, the unknown one with its kept `2525b:` code.
4. **Shapes:** a polyline, a polygon with one linear `exclude`, a circle, a corridor and an arcband, each latitude ≠ longitude, give their `core.shape` geometries and go out as the same elements with the same values within 1e-7° and 1 mm.
5. **The ellipse:** `rx="2000" ry="1000" rotation="30"` gives `semiMajor` 2 000, `semiMinor` 1 000, bearing 60; `rx="1000" ry="2000" rotation="30"` bearing 150; both go out with the same footprint (four points of each, compared within 1 m).
6. **Rect, arc, orbit:** each gives a `core.shape` whose corners or points lie on the element's geodesic outline within 1 m.
7. **Text:** a `text` at [15.2, 58.4] with `rotation="30"` gives a `core.text` with `text.rotation` 330, and goes back with `rotation="30"`.
8. **Graphics:** a `multipoint` with an APP-6D tactical graphic's code gives a `core.multipoint` with its points in the order sent, and goes back in that order.
9. **Groups and composites:** nested `g` labels "A"/"B" give `groupPath` ["A", "B"]; a `composite` of three parts gives three objects, the second and third related to the first by `nvg.part`.
10. **Common attributes:** `label`, `textInfo`, `TimeStamp`, `TimeSpan`, `href`, `ExtendedData`, `z` and an unknown CSS property come in to their fields or `extensions.nvg`, and an export of the result gives them back.
11. **Labels:** an item with its own 4774 label takes it; one without takes the document's, then the link's; an unknown classification is skipped and counted; out, each item and the document carry their label.
12. **Import:** importing a file of five items into a layer creates five objects of data type `core.general` (texts `core.text`) with `externalRef` `nvg-file:<name>`; the manifest declares no data type; importing it again with one item changed updates that one and creates nothing, also after a user moved it to another layer; without the edit right the endpoint answers 403; into a locked layer 409; otherwise it answers 202 with a job, whose poll gives the counts, which are shown; another user's job answers 404; the layer picker lists only layers the user may edit.
13. **Export:** two layers export as one document with two `g`, each named after its layer; every object in them is written, a `core.shape` `Point` as a `point` with `unknown:unknown` and a `simulator.route` as a `polyline`; without the view right 403; the browser saves `<layer>.nvg`.
14. **Consumer:** against a fake provider (the test kit's `OutboundHttp`), a poll creates its items; the next document without one item deletes it; a SOAP fault, an HTTP 500, a timeout and a refused document change nothing; an empty document changes nothing unless `clearOnEmpty`; the call carries `SOAPAction` and, with a credential, ECore's `Authorization` (the test kit's credential); "Get capabilities" lists a fake provider's filter items for an admin and answers 403 for a user who is not one.
15. **Provider:** a `GetCapabilities` lists the source layers; a `GetNvg` answers their objects, without an object above `highestClassification` and without one that came in through this link; after a delete, the next answer lacks it; an unknown link answers 404; a SOAP 1.2 request gets a SOAP 1.2 answer; any other body a fault.
16. **Rules:** `PluginRules` passes: no threads, no sockets, no file I/O, parsing large documents on a compute worker.
17. **Live check** (section 7).

## 9. Out of scope

NVG 1.x; the streaming protocol; serving a WSDL; layer groups from `g` (layer groups are deferred in emcc); authentication of service calls and `nvg.serve` (ADR-0055 Q1: later); files as a link kind (Q9 B: later); MIL-STD-2525 and APP-6 A and C symbols (read as unknown, the code kept); writing `rect`, `arc`, `orbit` and `composite` as such (they go out as the elements of section 3); drawing or editing a `core.text` by hand (N12).

## Open questions for the owner

- **Who draws `core.text`:** settled by the ACA's note on ADR-0055 (2026-11-11, the M7 plan): PCA-map-view-2d, in `map-view-2d` function 45. No owner question.
- **The assumptions N1 to N12** were not accepted (owner, RJ A, 2026-11-11). Re-checked on 2026-11-12 against RK A, RL B and RM A: N8 is now the owner's RL B and N9 contradicted RK A, so both are dropped; N12 is rewritten; the others still hold and are proposed again, for the owner.

**The assumptions, re-checked (2026-11-12), for the owner:**
- **N1:** the panel "NVG" is in every workspace (default pane: right); Import is greyed without edit rights there.
- **N2:** a new layer for an import is named after the file, without its extension.
- **N3:** importing a file again updates its objects by `externalRef` (RM A) and creates new ones, but deletes nothing (a file is not the whole picture; a consumer's document is).
- **N4:** the provider offers one filter item, `layers`; no time or area filter in M7.
- **N5:** the provider also answers SOAP 1.2, in SOAP 1.2, until the spec check says otherwise.
- **N6:** a tactical graphic's points keep the order they came in, until the spec check of the point order.
- **N7:** the vessel symbol goes out as the sea surface "civilian" symbol of its identity (section 3), until the spec check.
- **N8:** dropped: the owner's RL B decides it (the parts stay linked by `nvg.part`).
- **N9:** dropped: contradicted by RK A (ordinary objects, `core.general`; no `nvg.item`).
- **N10:** the limits: 16 MiB per document, depth 64, 100 000 items, 1 000 000 points; the consumer polls at most once per 10 s.
- **N11:** no permission of its own in M7 (section 5).
- **N12 (rewritten):** a `core.text` is an ordinary object (RK A): drawn by `map-view-2d`, moved, selected, copied and deleted with the usual tools. M7 has no tool that edits its text or draws a new one; that is outside `nvg`, which is input and output only.
