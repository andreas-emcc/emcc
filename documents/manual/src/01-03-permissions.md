# Users and permissions

What a user may do in emcc depends on the permissions the user has. The server checks the permissions of every change a user makes. The browser only hides what you may not use, so a button that is missing or switched off means that you do not have the permission, and the server would refuse it anyway.

## Without login

In the no-login mode everyone works as one local user, who has every permission. See [Running emcc](01-02-running.md).

## With login

When emcc runs with a Keycloak, each user logs in, and the user's Keycloak groups give the permissions. An administrator makes the groups in Keycloak and the server's settings say which group gives which permission. Everyone who logs in may see the map.

| Permission | What it lets you do | Groups in the demo setup |
|---|---|---|
| Objects: edit | Place, edit, move and delete symbols, shapes and tactical graphics | `drawers`, `editors`, `admins` |
| Layers: edit | Create, rename, reorder, lock and delete layers | `editors`, `admins` |
| Settings: administer | See and change Settings, and see the Monitor | `admins` |
| Simulation: view | See the Simulation tab, its layers and its objects | `sim-viewers` |
| Simulation: edit | Place, draw and edit in Simulation, put tracks on routes, choose outputs | `sim-editors` |
| Simulation: run | Start, pause and reset the simulation | `sim-runners` |
| Terrain: use | See the Terrain panel and use range and bearing, viewsheds and height maps | `drawers`, `editors`, `admins` |
| FMV: watch | Open the video window of a camera in the FMV panel | everyone who has logged in (`*`) |
| Cameras: view | See the Cameras panel in Simulation | `sim-viewers` |
| Cameras: edit | Make, change and remove simulated cameras | `sim-editors` |
| Cameras: run | Start and stop simulated cameras | `sim-runners` |

The FMV permission is `plugin.fmv.view`, and the three Cameras permissions are `plugin.uav-simulation.view`, `plugin.uav-simulation.edit` and `plugin.uav-simulation.run`. The Cameras panel is in Simulation, so a user needs Simulation: view as well. The release has a line for each of them in `settings/emcc.properties`, and they are given to groups the same way as the Terrain permission below. The Cameras permissions go to the same groups as the Simulation permissions: whoever may see, edit or run Simulation may see, edit or run the cameras. The FMV permission goes to `*`, which in the list of a permission means **everyone who has logged in**, with or without groups. Other groups on the same line add nothing: `*,admins` is the same as `*`. To keep the video windows to some groups, replace the `*` with their names, for example `emc2.login.oidc.permissions[plugin.fmv.view]=operators,admins`. The `*` counts only when login is on; in the no-login mode everyone has every permission anyway. The Terrain permission is `plugin.terrain.use`. Without it the Terrain panel is not shown. To give it to other groups, an administrator changes the line `emc2.login.oidc.permissions[plugin.terrain.use]=<group>` in `settings/emcc.properties`. In the no-login mode everyone has it.

The groups are set in `settings/emcc.properties`, where the release has the lines for the groups of the demo realm. To use other groups, change them there, for example `emc2.login.oidc.permissions[objects.edit]=mappers`, and restart the server. See [Administering emcc](08-00-administering.md).

## The demo users

The demo realm `emc2-demo` has five users that show what each set of permissions sees:

| User | Can |
|---|---|
| `viewer` | See the map and the objects, and watch FMV video. Changes nothing |
| `drawer` | Draw and edit objects |
| `editor` | Edit objects and layers. Sees the simulation |
| `operator` | As the editor, and edit and run the simulation |
| `admin` | Everything, including Settings and the Monitor |

## What you see without a permission

| Without | What changes on your screen |
|---|---|
| Objects: edit | Placing and drawing are switched off, with the hint "You may not edit objects". Edit and Delete are not in the right-click menu. Symbol properties and Edit shape are read only |
| Layers: edit | Creating, renaming, reordering, deleting and locking are switched off, with the hint "You may not change layers". You can still see the list, switch layers on and off for yourself and choose the active layer |
| Settings: administer | The Settings and Monitor tabs are not shown |
| Simulation: view | The Simulation tab is not shown |
| Simulation: edit | The panels in Simulation are read only |
| Simulation: run | The start, pause and reset buttons are switched off |
| Cameras: view | The Cameras panel is not shown |
| Cameras: edit | The cameras are read only, with the hint "You may look at the cameras, not change them" |
| Cameras: run | The cameras cannot be started or stopped |

## Classification

Every object and layer has a security label with a classification. For now the classification is a mark: it does not yet limit who sees what. See [Layers](05-04-layers.md).

## Logging in and out

The login and logout screens are not yet in this manual.
