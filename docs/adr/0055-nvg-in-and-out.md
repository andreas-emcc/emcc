# ADR-0055: NVG in and out, over files and the NVG web service

- Status: Accepted (owner, 2026-11-10, as written, with the answers to Q1 to Q9 below; for M7)
- Date: 2026-11-10
- Deciders: Owner (advised by the ACA)
- Extends: ADR-0007 (common data model), ADR-0036 (connection tasks), ADR-0037 (links and output channels) and CR-0026 (POST endpoints)

## Context
`requirements.md` names NVG among the formats for exchanging objects with other systems. The owner asked, on 2026-11-10, for one plugin that:
- **reads NVG** and places its objects on a layer;
- **writes NVG** from symbols, tactical graphics and shapes;
- **does both** over NVG files and the NVG SOAP web service, as consumer and as provider, for **NVG 2.0.x only**.

The sources, the format, the mapping and the gaps are in `docs/architecture/nvg.md`. Four facts shape this ADR:
- **The specification is not public.** The plugin is built from the public TIDE XSDs and WSDLs, and from NCI-Agency ANET's open-source provider. Points only the specification settles are marked **[spec check]**; the owner may have a `PCA-nvg` session on a local model check them (owner, 2026-11-10).
- **The NVG web service only pulls.** `GetCapabilities` and `GetNvg` return a whole document, and there is no push and no delete. So "In" over SOAP means emcc polls another system, and "Out" means emcc answers other systems' calls.
- **The SDK cannot do it today:**
  - outbound HTTP is GET only;
  - plugin endpoints take JSON from a browser session, at most 1 MiB;
  - no caller outside the browser is foreseen.
- **The data model has no `core.text`.** It was deferred until an NVG plugin is planned.

## Decision
Written with the owner's answers to Q1 to Q9 and accepted as written (2026-11-10). The 60 s interval, the 16 MiB limit and the permission's name are defaults the brief may refine.

1. **One plugin, `nvg`, in and out** (an in/out plugin, `docs/plugins/in-out/playbook.md`), built by `PCA-nvg`, with a server part and a web part.
   - It reads NVG 2.0.0 to 2.0.2 and writes 2.0.2.
   - It parses with the JDK's StAX, hardened: no DTDs, no external entities, and limits on size, depth and the number of items.
   - It adds no third-party library. JAXB and JAX-WS are not used: they bring their own threads (ADR-0004) and their own HTTP stack.
   - It parses a large document on a compute worker (rule C7), never on an ordinary worker.
   - Its manifest declares `internet`, because a `soap-consumer` link may reach an internet host (ADR-0030). It opens no socket of its own, so it declares no `connections`.
2. **Two kinds of link** (ADR-0037):
   - **`soap-consumer` (in).** It calls a remote `GetNvg` at an interval, 60 s by default, with optional filter answers from its settings, and writes into its target layer.
     - Each document is the whole picture: an item is created or updated by its `uri` (`externalRef`, with the link's name as its system).
     - An object of the link whose `uri` is no longer in the document is deleted, but only after a complete document that parsed without a refusal. A failed call, a SOAP fault or a refused document changes nothing. An empty document clears the layer only when a link setting allows it (off by default), so a bad reply cannot wipe a layer.
     - The host comes from the admin's settings only (ADR-0030). A token the remote provider needs is local configuration, as TLS keys are, never the settings or the repository.
   - **`soap-provider` (out).** It answers `GetCapabilities` and `GetNvg` for its source layers and for the latest items senders give its output channel (coalesced by id; a removal drops the item).
     - Its filter offers the source layers to choose from.
     - An object's absence from the next document is its delete, so the channel "can send a delete".
     - An object that came in through a link is never sent back to that link (ADR-0037 point 3).
     - **The `uri` of an object** is its `externalRef` id when it came from NVG, else `urn:uuid:<object id>`, so it stays the same across documents.
   - **SOAP 1.1,** document/literal, as in the TIDE binding. Whether the provider must also accept SOAP 1.2 is a **[spec check]**.
3. **Files are user actions, not links.**
   - The plugin's web part has a panel with two actions:
     - **Import NVG…:** a file and a target layer of the current workspace, through the shell's layer picker;
     - **Export NVG…:** one or more layers, downloaded as an `.nvg` file.
   - The server part does the work through two endpoints:
     - **the import endpoint checks the user itself.** The edit permission differs per workspace (`objects.edit` in View, the workspace's own elsewhere; overview 4.4, ADR-0039), so one static `requires` is not enough. The handler checks `EndpointRequest.user().has(...)` for the target layer's workspace, as ADR-0053 point 5 asks of a copy;
     - **the export endpoint does the same** with the view permission for each layer it exports;
     - the plugin refuses an import into a locked layer (ADR-0042), since its own writes carry no user;
     - an export skips what the user may not see (ADR-0020, when access by label comes).
   - An import's `dataSource` is `nvg-file`, and its `externalRef` system is `nvg-file:<file name>`, so importing the same file again updates its objects instead of meeting `EXTERNAL_REF_EXISTS`. A renamed file makes new objects. Its objects keep the file's ids (owner, Q2); files are user actions, not a link kind (owner, Q9).
4. **Data model 1.6.0 (PDA): `core.text`**, a text placed at a point, with its rotation, drawn by the map view. The PDA designs it through a CR, as the data model's deferred list foresees.
5. **SDK 1.6.0 (PDA) and ECore (CDA):**
   1. **Outbound `POST`:** `HttpCall.post(uri, mediaType, bytes)`, with headers such as `SOAPAction` and the same limits as `GET`.
   2. **Raw bodies:** a `POST` endpoint may declare that it accepts XML media types instead of JSON, with a larger limit, up to 16 MiB, so that a file fits. The body reaches the worker as bytes.
   3. **Service endpoints for outside callers:**
      - a plugin may register an endpoint that systems call without a browser session, under its own path; each `soap-provider` link has its own path;
      - **authentication is configured per endpoint** (owner, Q1). Its setting has the value `none`, and later also `keycloak` (a client-credentials token checked by the edge, ADR-0022) and `token` (an access token per link, kept hashed in local configuration, never in the repository). **`none` stays available** whenever an admin configures it;
      - **in M7 only `none` is built** (owner, Q1): a `soap-provider` link answers every caller that reaches the server, also in the no-login mode (owner, Q8). An admin who turns a provider link on makes its source layers readable by any system that reaches the server; the link's highest classification still limits what it sends (point 6);
      - **later, an authenticated caller is a service, not a user.** `EndpointRequest` then gains a caller kind, `user` or `service`, with the service's name; a service has only the permissions configured for it, for example `nvg.serve`, and each link names the services it answers;
      - the edge logs each call as it logs a `POST` (CR-0026), with the caller's address.
6. **Labels.**
   - **In:** an item's STANAG 4774 label, inside its STANAG 4778 binding in `metadata` or `extension`, becomes the object's label. Otherwise the document's label, else the link's label, else the default label.
   - **Out:** every item carries its object's label the same way **[spec check of the placement]**. Objects above the link's highest classification are skipped and counted (ADR-0037 point 8).
   - **Vessel symbols** (ADR-0047) go out as the APP-6 sea surface symbol of their identity, the code given in the brief (owner, Q4).
   - **An export** has one `g` per source layer, named after it (owner, Q5).
7. **The mapping is the brief's** (playbook section 4, with the table in `docs/architecture/nvg.md` section 3).
   - Everything the model has no field for goes into `extensions.nvg`, so an emcc export carries it back (ADR-0007).
   - Every converter test uses a point where latitude ≠ longitude, and an ellipse with different axes.
8. **Testing:**
   - the ITA uses an NVG test double (`agents/ita.md`);
   - **the TIDE XSDs and WSDLs are copied from ANET into the plugin's test resources** (owner, Q6), with their origin and ANET's MIT licence noted beside them; they are dev-only and never shipped. The plugin's tests validate its own documents against them;
   - **the ESA runs ANET** (MIT, a real NVG 2.0.2 provider) as an external test service (owner, Q7), with its sheet in `external/`.
9. **Not in M7:**
   - NVG 1.x;
   - the experimental NVG streaming protocol;
   - MIL-STD-2525 and APP-6 A and C symbols, which are read as unknown symbols with the code kept;
   - serving a WSDL;
   - layer groups from `g`;
   - authentication of service calls (Q1): later milestones;
   - files as a link kind (Q9 B): later, if a system drops files in a folder.

## The owner's answers (2026-11-10)

| # | Question | Answer |
|---|---|---|
| Q1 | The provider's callers | No authentication in M7. Later both a Keycloak client-credentials token and an access token per link; an endpoint can always be configured with no authentication (point 5.3) |
| Q2 | An import's objects | A: they keep the file's `uri` as `externalRef`, so the same file imported again updates them (point 3) |
| Q3 | APP-6 D and E scheme names | Write `app6d:` and `app6e:`, also read `app06:`, until the spec check **[spec check]** |
| Q4 | Vessel symbols out | As the APP-6 sea surface symbol (point 6), not skipped |
| Q5 | The export layout | One `g` per source layer (point 6) |
| Q6 | The TIDE XSDs | Copied into the plugin's test resources (point 8) |
| Q7 | ANET as an ESA service | Approved (point 8) |
| Q8 | Service calls in the no-login mode | C: accepted from anywhere (point 5.3) |
| Q9 | Files as user actions or as links | A: user actions in the plugin's panel (point 3) |

## Alternatives considered
- **Two plugins, `nvg-in` and `nvg-out`:** more manifests and the same parser twice. ADR-0037 lets one plugin have both directions.
- **The provider on its own socket** (a `tcp-server` connection task with a small HTTP server in the plugin, ADR-0036): no ECore change, but each plugin would write its own HTTP, TLS and authentication, and the server would have a second HTTP front door.
- **JAX-WS and JAXB, as ANET uses them:** generated code that is quick to write, but it brings threads and an HTTP stack into a plugin (ADR-0004) and several dependencies.
- **Parsing a file in the browser:** no raw-body endpoint is needed, but the parser would then exist twice, once for files and once for SOAP, and untrusted XML would be checked in two places.
- **`text` as a shape with a name:** no model change, but the text would be a label on a point, not an annotation, and it would not come back as `text`.

## Consequences
- **PDA:**
  - the brief `docs/plugins/briefs/nvg.md`;
  - CRs for data model 1.6.0 (`core.text`) and SDK 1.6.0 (point 5).
- **CDA:**
  - the edge's outbound `POST`, raw bodies and service endpoints;
  - the map view's `core.text`.
- **PCA-nvg:** the plugin, following the playbook's work packages.
- **ESA:** ANET as an external test service, with its sheet (owner, Q7).
- **ITA:** the test double, and a round trip from file to layer to file.
- **SRA:** the XML parser and the service endpoints.
- **UDA:** the manual's import, export and links.
- **The M7 plan** takes this ADR's parts in order: model and SDK, then the edge, then the plugin.
