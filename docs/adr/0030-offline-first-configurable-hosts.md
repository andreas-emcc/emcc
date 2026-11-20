# ADR-0030: Everything works offline; settings may point to internet hosts

- Status: Accepted (owner, 2026-10-12, CR-0013)
- Date: 2026-10-12
- Deciders: Owner (advised by the ACA)
- Supersedes: ADR-0014 (no internet access at runtime)

## Context
ADR-0014 ruled that nothing is fetched from the internet at runtime. For plugins' server parts, SDK v0 made this an allow-list: ECore lets a server part reach only the hosts in its manifest's `internet.hosts`, fixed when the plugin is installed.

That is stricter than the owner wants (CR-0013). `basemap-osm` applies its settings live, including a new tile server, but ECore blocks every host its manifest does not list. An admin who points it at another tile server gets an error on every tile, and the only way out is to edit the manifest.

The owner's rule (2026-10-12): no internet host may be required for anything to work, and everything must have a way to work offline. Within that, settings may point to internet hosts.

The requirement stays as it is: emc2 must work in a disconnected environment, and internet access is available during development and demonstrations only (`requirements.md`).

## Decision
1. **Everything has a way to work offline.** No function of emc2, in the core or in a plugin, requires an internet service. Either the function works offline itself, or emc2 has an offline way to do the same. For background maps that is Natural Earth (`basemap-naturalearth`, ADR-0025, CR-0009). A plugin that needs the internet, such as `basemap-osm`, can be left out of a disconnected installation.
2. **Settings may point to any host**, internet hosts included. An admin (`settings.admin`) may change them at any time, without changing the manifest. A server part takes the outside hosts it reaches from its settings, whose defaults are in its manifest, never from a browser request, a message or an object's data.
3. **The manifest's `internet` field is a declaration, not an allow-list** (from M2, see "Consequences"). It says that the plugin's server part reaches outside hosts, why (`reason`), and its default hosts, so that admins and the monitor view can see which plugins go online. ECore no longer blocks a host because the manifest does not list it. Its other limits on outbound HTTP (`docs/plugins/sdk-v0.md`) stay.
4. **Only server parts reach outside hosts**, through the SDK's outbound HTTP (overview 4.2, rule C6). The browser loads and fetches only from the emc2 server: the Content-Security-Policy stays `'self'`, and a web part gets outside data through its plugin's server part, as `basemap-osm` proxies tiles. A link the user follows, such as a map attribution, is not a fetch.
5. **Kept from ADR-0014:**
   - Everything the browser needs is served by the emc2 server: no CDNs, web fonts, map styles, scripts or licence checks from the internet. Fonts, icons and symbol resources are bundled.
   - Deliverables are self-contained (Java runtime image, built web files, plugins, configuration). Installing them needs no network.
   - Builds use pinned dependency versions, so that the dependencies can be mirrored for building offline.

## Alternatives considered
- **Keep ADR-0014 and document the limit:** rejected by the owner.
- **An allow-list fed from the plugin's settings** (as the listeners' `network.endpoints`), **or an admin-edited host list in ECore's configuration:** rejected by the owner as stricter than needed.
- **Let the browser reach outside hosts directly:** not chosen. The browser keeps talking only to the emc2 server (CR-0013, option 2a).
- ADR-0014 rejected optional internet resources with offline fallbacks, because failures would only show in the field. This ADR accepts them, and answers that risk with the ITA's tests with the network blocked, which must pass through each function's offline way.

## Consequences
- **Built in M2** (T-058, overview section 6):
  - the PDA documents the `internet` field as a declaration, in the documents that describe it (`docs/plugins/sdk-v0.md`, `sdk-v1.md`, the manifest schema's description, the design pattern and the briefs);
  - the CDA removes ECore's host check and shows the declaration in the monitor view;
  - `basemap-osm` can then use any tile server its settings name.

  **Until then, ECore still enforces the manifest's `internet.hosts` as an allow-list**, as in M1.
- **Briefs and plugins:** a plugin that reaches outside hosts says so in its brief, which names the offline way for its function, and declares `internet` in its manifest. Internet addresses appear only as default setting values in its manifest, and in links the user follows. Web parts load nothing from them.
- **Tests:** the ITA tests with the network blocked, which now also proves that every function has its offline way. Plugins that reach internet hosts are tested separately, as before.
- **Security:** an admin can point the server at any host, including hosts on the local network. That is accepted: plugins are trusted (ADR-0003), and only admins change settings. The SRA reviews what it allows: redirects, loopback and private addresses, host name normalisation, whether any plugin takes a host from anywhere but its settings, and what tile or data requests to a third party reveal. In the no-login mode the one local user has all permissions (ADR-0022), which is one more reason that mode listens on loopback only.
- **Local services** (Keycloak, databases, WMS and TAK servers) must be available locally in a disconnected environment, as before.
- **Other ADRs** that cite ADR-0014 for the browser rule (ADR-0022, ADR-0025, ADR-0029) stay valid: this ADR keeps that rule.
