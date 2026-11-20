# The emc2 plugin SDK reference

The plugin SDK as it is today: **SDK 1.9.0** (Java and web) with **data model 1.9.0**. One page per concept, each with its rules and its tests. The Javadoc and the TSDoc hold the detail; these pages say which part to use, and how.

A plugin is a folder with a `plugin.json`, a server part in Java, a web part in TypeScript, or both. It depends on the SDKs only, and starts from the template, `plugins/_template/`.

**An LLM agent building a plugin** starts with [for-agents.md](../for-agents.md).

The links to ADRs and source files resolve inside the emcc repository. With the SDK kit alone, the Javadoc and TSDoc in the kit hold the same detail.

## Read first

| Page | What it holds |
|---|---|
| [rules.md](rules.md) | Every rule a plugin keeps (R1 …), in one list, with the check that catches each |
| [manifest.md](manifest.md) | The whole `plugin.json`, member by member, and every settings hint |
| [build-and-install.md](build-and-install.md) | The folder, the builds, the life cycle, installing |
| [testing.md](testing.md) | The Java and web test kits, the required tests, the guards |
| [The cookbook](../cookbook/README.md) | Worked recipes, with diagrams: a panel, settings, an input link, an output link, a stream |

## How do I …

**Start and build**
- … start a plugin? Copy the template: [for-agents.md](../for-agents.md), [build-and-install.md](build-and-install.md).
- … name my plugin and what follows from its id? [rules.md](rules.md) (the plugin id), [manifest.md#naming](manifest.md#naming).
- … check my `plugin.json`? `manifestProblem`, `settingsTextProblem`, `settingsHintsProblem`: [testing.md](testing.md), [manifest.md#the-texts-rule](manifest.md#the-texts-rule).
- … build outside this repository? [build-and-install.md](build-and-install.md).

**Run code on the server**
- … do work without my own threads? Workers and messages: [workers.md](workers.md).
- … do something every few seconds? Timers: [workers.md](workers.md).
- … run CPU-heavy work (rendering, parsing)? Compute tasks: [workers.md](workers.md).
- … ask another worker and wait for the answer? `ask` with a timeout: [workers.md](workers.md).

**Objects and data**
- … create, change or delete objects? Change requests: [objects.md](objects.md).
- … add my own fields to objects, or edit another plugin's? Extensions and declared fields: [objects.md](objects.md).
- … find or follow objects? Queries and subscriptions: [objects.md](objects.md).
- … declare a data type, a field set or a relation kind? [objects.md](objects.md), [manifest.md#data](manifest.md#data).
- … keep my own small state? Plugin documents: [objects.md](objects.md).
- … label what I create, and keep classified data in? [permissions-and-labels.md](permissions-and-labels.md).

**Talk to the outside**
- … listen on, or connect to, a socket (TCP, UDP, multicast)? Connection tasks: [connections.md](connections.md).
- … use TLS? A named TLS credential: [connections.md](connections.md).
- … call an HTTP service, such as a WMS? Outbound HTTP: [connections.md](connections.md).
- … read local files, such as imagery or height data? Declared folders: [connections.md](connections.md).
- … offer an HTTP endpoint to my web part? [connections.md](connections.md), [permissions-and-labels.md](permissions-and-labels.md).
- … send objects out to another system? Output channels: [channels.md](channels.md).
- … send to another plugin's output, or take a kind of data it declares? [channels.md](channels.md).
- … stream video or data to the browser, or convert video? [streams.md](streams.md).

**Settings**
- … give my plugin settings, with a form? [settings.md](settings.md), [manifest.md#settings](manifest.md#settings).
- … show or grey a field by another field's value, or group fields? [manifest.md#settings-hints](manifest.md#settings-hints).
- … let an admin define links (a list with stable ids)? [connections.md](connections.md), [manifest.md#hint-item](manifest.md#hint-item).
- … react to changed settings without a restart? [settings.md](settings.md).
- … have my own settings panel instead of the form? [settings.md](settings.md).

**The browser**
- … show a panel, a window or a workspace? [panels-and-workspaces.md](panels-and-workspaces.md).
- … use the shared components, icons and the look? [panels-and-workspaces.md](panels-and-workspaces.md).
- … draw on the map, or show temporary graphics? [map.md](map.md).
- … add to the right-click menu? [actions.md](actions.md).
- … show something only to users with a permission? [permissions-and-labels.md](permissions-and-labels.md).
- … use the map view, the symbols or the coordinates service? [services-and-dependencies.md](services-and-dependencies.md), [map.md](map.md).
- … offer a service of my own to other plugins, or depend on one? [services-and-dependencies.md](services-and-dependencies.md).

**Operate**
- … say how my plugin is doing? Status, counters, details: [monitor.md](monitor.md).
- … log? [rules.md](rules.md) (logging), [workers.md](workers.md).
- … test it all? [testing.md](testing.md).

## All pages

[rules.md](rules.md) · [for-agents.md](../for-agents.md) · [manifest.md](manifest.md) · [testing.md](testing.md) · [build-and-install.md](build-and-install.md) · [workers.md](workers.md) · [objects.md](objects.md) · [permissions-and-labels.md](permissions-and-labels.md) · [connections.md](connections.md) · [channels.md](channels.md) · [streams.md](streams.md) · [monitor.md](monitor.md) · [map.md](map.md) · [actions.md](actions.md) · [settings.md](settings.md) · [panels-and-workspaces.md](panels-and-workspaces.md) · [services-and-dependencies.md](services-and-dependencies.md)

The history of the SDK, version by version, is in [sdk-v1.md](../sdk-v1.md) and [sdk-v0.md](../sdk-v0.md); the design pattern in [design-pattern.md](../design-pattern.md); the pattern for links in [in-out/playbook.md](../in-out/playbook.md).
