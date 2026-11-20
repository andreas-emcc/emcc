# Plugin template

**Building a plugin, or an LLM agent building one?** Start with [docs/plugins/for-agents.md](../../docs/plugins/for-agents.md) and [the SDK reference](../../docs/plugins/reference/README.md).

The plugin every PCA copies (owner: PDA). It is built and tested like every plugin, but never installed or run: the plugin host and the packaging skip folders whose names start with `_`. **How to copy, rename and register it:** `docs/plugins/design-pattern.md`, section 1.

This README is also the example of the README every plugin has (design pattern, section 11).

## What it does

Shows a greeting, and keeps the links of its `links` setting. The server part answers `GET /api/plugins/template/greeting` with the `greeting` setting. The web part adds a panel (default pane: right; SDK 1.1.0; with an icon and no heading of its own, SDK 1.8.0) that shows the setting and asks the server part, built from the SDK's shared components. It declares SDK `^1.9.0`.

The server part also holds the **transport pattern for in/out plugins** in its `transport` package: links over UDP, as a TCP client (with TLS if chosen) or as a TCP server, each receiving, sending or both, on connection tasks, with a worker that follows the `links` setting. **The template runs it end to end (M9, D3):** the manifest declares the `connections` and the whole `links` setting (a stable item id, groups with descriptions, hints, fields shown by the mode, the TLS credential field of SDK 1.9.0), the entry class starts the worker and subscribes it to the settings, and each link's state shows in the plugin's status. `LinkEndToEndTest` drives it through the plugin with a real peer on loopback; `TransportTest` runs every mode. An in/out plugin keeps it and follows `docs/plugins/in-out/playbook.md`; any other plugin deletes the package, the `links` setting and `connections` in `plugin.json`, the two lines in the entry class, and the tests.

**The manifest guard** (`web/test/manifest.test.ts`; ADR-0060): the manifest is valid against the data model's schema (`manifestProblem` from `@emc2/plugin-sdk/build`), every setting the form shows has a `title` and a `description`, every group a `description`, and the hints have the shape the SDK documents. Keep it in your copy: ECore and the shell do not check the texts.

**Built from the SDK, also outside this repository** (M9, D3, gap G1): the server part's parent is the SDK's stand-alone `dev.emcc:emc2-plugin-parent` (`server/plugin-sdk/plugin-parent/pom.xml`), which pins the SDK, the test kit, the libraries the tests use and every build plugin, and inherits nothing. In the repository its `relativePath` finds it; outside, Maven takes it from the local repository, where the SDK kit installs it (the MCA's B5).

## Settings

| Name | Default | Meaning |
|---|---|---|
| `greeting` | `Hello from the template` | The text the endpoint and the panel show |
| `links` | none | The links: `name`, `mode` (`tcp-client`, `tcp-server`, `udp`), `direction` (`in`, `out`, `both`), `host` and `port` (the peer), `tls` and `tlsCredential` (a TCP client's TLS; an empty credential means the link's name, ADR-0062), `listen` (`address`, loopback by default, and `port`), `idleSeconds` (120), `enabled` |

## Messages and services

- Server worker `greeter` (`GreeterMsg`): `Greet(EndpointRequest)`, from the endpoint `GET /greeting`. Mailbox 100, `dropNewest`.
- Web: one panel, id `template`, default pane right. Provides and requires no services; no topics.

## Permissions and internet

None.

## Known limits

- The web build needs the shell's import map (`web/shell/dist/importmap.json`): build the shell first, as `npm run build --workspaces` does.
