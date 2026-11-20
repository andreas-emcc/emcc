# nvg

NVG 2.0.x in and out (ADR-0055; brief `docs/plugins/briefs/nvg.md`), built by PCA-nvg. Category: Data Links.

## What it does

- **Reads NVG 2.0.0 to 2.0.2 and writes 2.0.2**, with the JDK's StAX only: no DTDs, no external entities, and at most 16 MiB (the `maxDocumentMegabytes` setting), a depth of 64, 100 000 items, 1 000 000 points and 1 MiB per attribute or text. A document over a limit, with a DTD, of another version, not XML or not NVG is refused whole, with its reason.
- **Files** (the NVG panel, every workspace, right pane by default):
  - **Import NVG…** puts a file's items into a layer of the workspace shown, or into a new layer named after the file. The items become ordinary objects of data type `core.general` (texts `core.text`), `dataSource` `nvg-file`, `externalRef` `nvg-file:<file name>` + the item's `uri`. Importing the same file again updates its objects wherever users moved them, and creates or deletes nothing else. A new layer the panel made for the file is removed again when the import puts nothing into it: refused, answered 4xx before it started, or ended with no object created.
  - **Export NVG…** saves one or more layers as one file, one `g` per layer named after it, with every object in them.
- **The NVG web service** (SOAP 1.1, the TIDE binding `NVGBinding2012`), as links in the settings:
  - **`soap-consumer`** calls a provider's `GetNvg` every `intervalSeconds` and keeps its target layer equal to the answer. Each answer is the whole picture: items are created or updated by `uri`. The link's objects whose `uri` is gone are deleted, but only after a complete answer that was not refused. A failed call, a fault or a refused answer changes nothing. An empty answer clears the layer only with `clearOnEmpty`.
  - **`soap-provider`** answers other systems' `GetCapabilities` and `GetNvg` at `/api/services/nvg/nvg/<link>` with its source layers and the items senders give its output channel. A SOAP 1.2 request gets a SOAP 1.2 answer.
- **The mapping** (brief, section 3):

  | NVG | emcc |
  |---|---|
  | `point` | `core.symbol`; its `speed` (km/h) and `course` are the symbol's `modifiers.speed` (m/s) and `modifiers.direction`. The text amplifiers are not sent (known limits) |
  | `text` | `core.text`; its CSS `fill` is the text's colour, `style.strokeColor` (owner, 2026-11-12), and its other CSS, its `stroke` included, is kept |
  | `multipoint`, and `polyline`, `polygon`, `arrow` with a tactical graphic's code | `core.multipoint`, the points in the order sent |
  | the other shapes | `core.shape` |
  | `rect`, `arc`, `orbit` and rhumb lines | built geodesically (no `rect`, `arc` or `orbit` back) |
  | `g` | flattened; the path kept in `extensions.nvg.groupPath` |
  | `composite` | one object per part, the parts after the first related to it by `nvg.part` |

  Everything the model has no field for is kept in `extensions.nvg` and written back:
  - `href`, `ExtendedData`, `z`, `minaltitude`, `maxaltitude`, `leg-type`;
  - unknown CSS properties, the `modifiers` text, unmapped symbols;
  - other attributes, and elements of other namespaces.

## Settings

The form (SDK 1.8.0 part D, T-204) lists the links by name, with their kind and url; a link's side form shows its name, `enabled` and `kind`, then the groups Calls, Picture and Serving, each with the fields its kind uses. Every long description has a short hint. The plugin's icon is Network.

| Setting | Default | Meaning |
|---|---|---|
| `links[].name` | – | the link's name: its data source, the system of its objects' `externalRef`, its status entry, its channel, the last part of a provider's address. `manual` and `nvg-file` are reserved |
| `links[].enabled` | `true` | whether the link runs |
| `links[].kind` | `soap-consumer` | or `soap-provider`; the form shows the kind's fields only |
| `links[].url` | – | consumer: the provider's endpoint, `http` or `https` |
| `links[].credential` | empty | consumer: the name of a bearer token in the server's local configuration, `emc2.http.credentials.<name>.token` (never a setting) |
| `links[].intervalSeconds` | 60 | consumer: 10 to 3 600 |
| `links[].timeoutSeconds` | 30 | consumer: 5 to 55 |
| `links[].filter` | `[]` | consumer: `{refid, value}` answers sent as `input_response`s in `nvg_filter` |
| `links[].targetLayer` | a new layer named like the link | consumer: the layer picker |
| `links[].label` | the server's default label | consumer: the label of items without one, when the document has none |
| `links[].clearOnEmpty` | `false` | consumer: an empty document deletes the link's objects |
| `links[].sourceLayers` | `[]` | provider: existing layers only |
| `links[].highestClassification` | the default label's | provider: objects above it are not served |
| `links[].authentication` | `none` | provider: only `none` in M7; turning the link on makes its source layers readable by any system that reaches the server |
| `maxDocumentMegabytes` | 16 | 1 to 16, for files and both link kinds |

## Messages and services

- **Endpoints** (`/api/plugins/nvg/`):
  - `POST /import?layer=<id>&name=<file>[&policy=&classification=]`: an `application/xml` or `text/xml` body of up to 16 MiB. It answers 202 with a job; 403 without the edit permission of the layer's workspace, 409 for a locked layer, 404 for an unknown layer, 400 for bad parameters;
  - `GET /import/{job}`: the job's state and counts, for the user who started it only. A job is kept for 10 minutes after it ends; an unknown, expired or other user's job answers 404. The panel polls it every second;
  - `GET /export?layer=<id>&layer=…`: an `application/xml` attachment; 403 without the view permission of a layer's workspace;
  - `GET /links` (`settings.admin`): each link's state and counters;
  - `POST /links/{name}/capabilities` (`settings.admin`): calls the consumer's provider's `GetCapabilities` once and lists its filter items.
- **Service endpoint** (`/api/services/nvg/`): `POST /nvg/{link}`, `text/xml` or `application/soap+xml`, up to 1 MiB, no authentication. An unknown or disabled link answers 404; a request that is not `GetCapabilities` or `GetNvg` gets a SOAP fault.
- **Output channel:** one per enabled provider link (`nvg/<link>`, output type `nvg`, can delete), ground truth only.
- **Relation kind:** `nvg.part`, "NVG composite", a 1 px grey line, off by default.
- **Plugin document:** `layers`, the consumer links' new layers by name.
- **Status:** per link, the last call and its counts (`<n> items, <c> created, <u> updated, <d> deleted`) and the next call; a provider's calls, last caller and items served. Counters per link, in `GET /links`:
  - `refused: <reason>`, `SOAP fault`, `HTTP <status>`, `call failed`, `skipped turn`;
  - `skipped: <reason>`, `label not understood`, `above highest classification`, `fault answered`.

## Permissions and internet

- No permission of its own (N11). Import checks the target workspace's edit permission; export checks each layer's view permission; the panel's links section needs `settings.admin`.
- `internet`, with no default hosts: a consumer link may reach any host its `url` names, never one from a request or a document (ADR-0030). No sockets of its own; all HTTP goes through the SDK.
- The provider has no authentication in M7 (owner, Q1 and Q8 C).

## Known limits

- **A symbol's or graphic's text amplifiers are not sent:** `symbol.modifiers`' texts (unique designation, higher formation, quantity, staff comments, additional information and the others) are not written to NVG, so a copy made over NVG, by another emcc included, has none (ITA mass test, 2026-11-20, finding 2; owner, 2026-11-21). Only speed and direction go. Where NVG carries them is its `modifiers` attribute, whose format is a spec check (point 3). An imported `modifiers` text is kept and written back as it came, but not read into the amplifiers.
- A consumer sends `input_response` answers only, no `select_response`.
- A document's `Schema` and the attributes of other namespaces on items are not kept. Content of an item's `metadata` other than its label is written back inside its `extension`.
- A polygon's closing point is not written (NVG lists the points once).
- Not in M7: NVG 1.x, the streaming protocol, serving a WSDL, authentication, files as a link kind, writing `rect`, `arc`, `orbit` and `composite` as such.

## Spec checks

The specification is not public (ADR-0055). These choices stand until a check against it (the owner's local-model session):

1. **Labels:** where they go, as ANET does it: a STANAG 4778 `BindingInformation` in `metadata`, with an `originatorConfidentialityLabel`. The plugin adds the `CreationDateTime` and `DataReference` (the item's `uri`; empty for the document) that the 4774 and 4778 schemas require.
2. **Symbols:**
   - the scheme names `app6d:` and `app6e:` (owner, Q3; `app06:` read too);
   - a code under any of the three schemes is read by its version digits (NV3);
   - a vessel goes out as APP-6D sea surface `100<identity>3000001400000000` (N7).
3. **The `modifiers` format:** kept as text and written back. Until it is checked, the text amplifiers are neither read from it nor written to it (known limits).
4. **CSS:** which properties NVG defines. Dashes and dots are told apart by the first mark (3 or less: dots). A text's colour is read from its `fill`, as in SVG (owner, 2026-11-12).
5. **Tactical graphics:** their point order, kept as sent (N6).
6. **Geometry:**
   - `arc` angles, read as polar angles on the ellipse before its rotation;
   - `orbit`'s `width`, read as the whole width, with half circles centred on its two points;
   - `rect`, built "true ground" from the centre along the rotated axes.
7. **SOAP 1.2 for the provider** (N5).
