# Plugins from others

emcc is made of plugins, and you may add one that someone else wrote, or that your own people wrote. This chapter says what you take on when you do, how to install one, and how to give its permissions to your groups. How a plugin is written is not in this manual: it is in the developer documentation of the project.

**Draft.** Written from the plugin gap analysis (question GQ3) and the server's documentation. Checked against a release built from commit c60fea19 and run without administrator rights. Text with CHECK in square brackets waits for a later check.

## A plugin is trusted code

**A plugin's server part runs inside the emcc server, with the rights of the account that runs emcc. emcc does not check a plugin's code when it loads it.** The rules that plugins follow are these: no threads of their own, no files read except through the declared folders, no hosts that do not come from the settings, no changes to objects except through emcc's checks. A plugin that was written with the project's tools is tested against these rules by its author, and a plugin of the release is reviewed by the project. **A plugin from another source may not have been, and emcc cannot tell.**

So install a plugin as you would install any program:

- **Choose its source.** Know who made it, and that it is the file that they made.
- **Run emcc as an account with narrow rights.** The service account of [The Windows service](08-05-service.md) is such an account. A plugin can do what that account can do.
- **Read its manifest**, `plugin.json`, before you install it. It says what the plugin declares:

  | In `plugin.json` | What it tells you |
  |---|---|
  | `permissions` | The permissions the plugin checks. You map them to groups, as below |
  | `connections`, `internet` | Which outside systems the plugin connects to and why. These are declarations: emcc does not check them |
  | `compute` | The compute threads it needs, as `{ "threads": 1 to 64, "reason": "..." }`. See [Compute threads](08-06-compute-threads.md) |
  | `dependsOn`, `required` | The plugins it needs, and whether the server must stop if it fails to start |
  | `workspaces` | A tab of its own in the top bar |

- **Know that a plugin's browser part runs in your users' browsers.** It can show only what the server gives it, and it cannot load anything from another host: the server's content policy allows only the emcc server.

A signed plugin, and a check of the code when it loads, may come in a later release.

## Where plugins are

Each plugin is a folder in `plugins/`, with the plugin's id as its name:

```
plugins/<id>/plugin.json     the manifest
plugins/<id>/server/*.jar    the server part, if it has one
plugins/<id>/web/            the browser part, if it has one
```

Folders whose names start with `_` or `.` are skipped.

## Installing a plugin

1. Stop emcc.
2. Copy the plugin's folder into `plugins/`. The folder's name must be the id in its `plugin.json`.
3. Start emcc.
4. Open the [Monitor workspace](06-00-monitor.md). The plugin must be in the list, with the state OK. If it is not, its row says why.

emcc reads the plugins when it starts, so a new plugin needs a restart.

A plugin is **refused** if its manifest is not valid, if its folder's name is not its id, if its id is `core` or starts with `core-`, if it needs a newer or older SDK than the server has, if a plugin that it depends on did not start, or if it fails when it starts. The plugin's row in the Monitor then has the state *Disabled* and a mark for a problem, the list's filter *Problems* counts it, and the same reason is in `logs/emcc.log` as an error, `Plugin <id> is disabled: <the reason>`. The reasons read, for example:

- *invalid plugin.json: ...*, with what the parser found;
- *the folder name differs from the plugin id bookmarks*;
- *the ids core and core-… are reserved for ECore*;
- *needs SDK 1.8.0, but ECore implements 1.9.0*;
- `depends on <id>, which did not start`;
- `no jar in plugins/<id>/server`;
- a message that names the part of the manifest that is wrong, for example a data type that does not start with the plugin's id.

A plugin that is marked `required` and fails stops the server from starting.

## Removing a plugin

Stop emcc, delete the plugin's folder, start emcc. The plugin is gone from the Monitor and from Settings, and nothing in the log says that it was removed.

- **The objects that the plugin made stay** on the map and keep their data. The log has one warning at the start for each data type that no plugin declares any more: `Stored objects have the data type adsb.aircraft, which no loaded plugin declares; they keep it and get the default behaviour`. The objects keep their data type's name and get the default behaviour of an object, and nothing describes the plugin's own fields any more. (Not tried: how they look on the map.)
- **The plugin's settings stay** in `data/ecore-config.json`, with their values. If you install the plugin again, it gets them back. Do not edit the file by hand while the server runs.
- Delete an object that you do not want in the map with the map's own delete, in the usual way.

## Permissions of a plugin

A plugin may check permissions of its own, named `plugin.<id>.<name>`. The release's plugins have these:

| Permission | What it lets a user do | Where it is described |
|---|---|---|
| `plugin.simulator.view` | See the Simulation tab, its layers and its objects | [Users and permissions](01-03-permissions.md) |
| `plugin.simulator.edit` | Place, draw and edit in Simulation | the same |
| `plugin.simulator.run` | Start, pause and reset the simulation | the same |
| `plugin.terrain.use` | Use the terrain tools | the same |
| `plugin.fmv.view` | Open the video window of a camera | [FMV: full motion video](03-19-fmv.md) |
| `plugin.uav-simulation.view` | See the Cameras panel in Simulation | [A simulated camera](04-06-camera.md) |
| `plugin.uav-simulation.edit` | Make, change and remove cameras | the same |
| `plugin.uav-simulation.run` | Start and stop cameras | the same |

The core permissions are `objects.edit`, `layers.edit` and `settings.admin`. Everyone who logs in may see the map.

**A permission is given to groups in `emcc.properties`**, as for the core permissions:

```
emc2.login.oidc.permissions[plugin.fmv.view]=viewers,admins
```

**`*` means everyone who has logged in.** In a permission's list, `*` gives it to every user who has logged in, with or without groups, for example `emc2.login.oidc.permissions[plugin.fmv.view]=*`. Other groups on the same line add nothing (`*,admins` is the same as `*`), and a group that is really named `*` gives nothing of its own. It counts only when login is on. A permission that you do not give to any group is held by no one, when login is on. In the no-login mode everyone has every permission. A plugin's manifest and its readme say which permissions it has. A group name is the name that your identity system puts into the user's groups claim. See [What you may bring yourself](08-03-infrastructure.md).

The permissions are read when the user logs in, so a change counts from the user's next login. The server checks every change that a user makes. The browser only hides what the user may not do.

The release's `emcc.properties` already has a line for every permission in the table above and for the core permissions, with the groups of the demo realm: `sim-viewers`, `sim-editors` and `sim-runners` for the three Cameras permissions, as for the Simulation permissions, and `*` for `plugin.fmv.view`. Change the groups to those of your identity system, and give `plugin.fmv.view` to chosen groups if not everyone may watch video. The lines are no longer in `application-login.properties`, which the release does not have any more.

## When something is wrong

| What you see | What to do |
|---|---|
| The plugin is not in the Monitor | The folder is not in `plugins/`, its name starts with `_` or `.`, or emcc was not restarted |
| The plugin's row says *Disabled*, with *invalid plugin.json* | The `plugin.json` is not valid or does not follow the project's schema. Ask the plugin's maker |
| The plugin's row says *the folder name differs from the plugin id* | Rename the folder to the id that the message names |
| The plugin's row says that it needs an SDK version, and which ECore has | It was made for another version of emcc than yours. Get the version that fits |
| A user says that a panel of the plugin is missing or read only | The user lacks the plugin's permission. Give it to a group that the user is in, and ask the user to log in again |
| The server does not start after you added the plugin | The plugin is marked `required` and fails. Read the log, and remove the plugin's folder |
