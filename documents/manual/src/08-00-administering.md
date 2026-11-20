# Administering emcc

This part is for the person who installs and runs emcc on an organisation's own computers, and who keeps it running. It is the guide to a product installation: where the settings are kept, how to serve emcc over HTTPS, how to let your own identity system log users in, how to connect to a TAK Server over TLS, how to run emcc as a Windows service, how to limit the threads that plugins compute on, and how to add a plugin.

**Draft.** This part is written from the accepted decisions of milestone M9 and checked against a release built from the integration branch (commit c60fea19, run on a computer where the author has no administrator rights). Text with CHECK in square brackets says what is still to check against the release before this part is final: above all the Windows service, which needs administrator rights, and a few messages. The pictures are not taken yet. Chapters [Running emcc](01-02-running.md) and [Users and permissions](01-03-permissions.md) still describe the M8 way (`application-local.properties`); they are brought in line with this part when the release is there.

## What this part assumes

- **Windows on the server.** The M9 release is for Windows x64 only. A Linux release, with its own service unit, comes later.
- **Administrator rights** on that computer, for certificates, folder permissions and the service.
- **A new release.** Upgrading an installed release to a newer one is not described here: it comes in a later release of this manual.
- **The users** need only a browser and the address of the server. See [Running emcc](01-02-running.md).
- **Your own infrastructure.** emcc runs on what you already have: your own Java if you prefer, your own ffmpeg, Keycloak or another OpenID Connect identity system, and the TAK Server you run. See [What you may bring yourself](08-03-infrastructure.md).

## The folders of an installation

The release is a folder that you unpack. These are the parts that matter to an administrator.

| Folder or file | What it holds |
|---|---|
| `start.bat` | Starts the server in a command window. `start.bat -standalone` starts it without login, on this computer only, and is the first test. Without `-standalone` it follows the settings, the login too. Stop it with Ctrl+C |
| `service-install.bat`, `service-uninstall.bat` | Install and remove the Windows service. See [The Windows service](08-05-service.md) |
| `readme.md`, `README.txt` | The release's own notes: the start command, the settings, the service, and what to do when it does not start |
| `settings/emcc.properties` | The installation's settings, with a comment on every setting. See [The settings files](08-01-settings-files.md) |
| `settings/credentials/` | One file for each secret: the login's client secret, the HTTPS certificate's password, the TLS credentials. The release has a template for each. Each can have its own permissions |
| `settings/terrain/` | Height data for the terrain tools and the simulated cameras. See [Terrain](05-20-terrain.md) |
| `settings/imagery/` | Photographs for the simulated cameras: one subfolder for each set. See [FMV output links, imagery and terrain](05-24-fmv-output.md) |
| `plugins/` | The installed plugins, one folder each. See [Plugins from others](08-07-plugins.md) |
| `data/` | What emcc keeps: the live map, and the settings you make in the Settings workspace (`ecore-config.json`). Back it up |
| `logs/` | `emcc.log`, and procrun's log of the service, `procrun.<date>.log`. A new `emcc.log` is begun at 20 MB; older ones are kept 14 days, at most 280 MB |
| `service/` | procrun, which runs emcc as a service |
| `tools/ffmpeg/` | The converter that turns MPEG-2 video into H.264 |
| `runtime/` | The Java runtime that comes with the release |
| `manual/` | This manual, as web pages. The server serves it at `/manual/`, and the help menu opens it. See "Which release is running" below |
| `version.properties` | Names the release: its name, the day it was built, its build number and the version of the plugin SDK. It is written when the release is built. Do not edit it |

Back up `settings/` and `data/`. The rest of the folder is the release, and you can unpack it again.

## Which release is running

When you report a problem, or before you replace a release with a newer one, you need to know which release runs. There are two ways to read it.

- **The help menu.** Click the `?` button at the right end of the top bar. The line under Manual names the release, for example `emcc M9-RC1 · 2026-11-18 · ea32e90f`: the name, the build day and the build number. See [The user interface](02-00-ui-overview.md). Every user has it.
- **The address `/api/health`.** Open `/api/health` on the server's address in a browser, or ask for it with any tool that fetches a web page. It needs no login, so it works also when the login is down or you do not have an account. The answer is one line of JSON. For a release it looks like this, here laid out over several lines:

```
{
  "status": "UP",
  "ecore": "RUNNING",
  "version": {
    "name": "M9-RC1",
    "date": "2026-11-18",
    "commit": "ea32e90f",
    "dirty": false,
    "sdk": "1.9.0"
  },
  "manual": true
}
```

| Field | What it says |
|---|---|
| `status` | `UP` when the server runs, `DOWN` when it does not |
| `ecore` | The state of the core of the server. `RUNNING` is the normal state |
| `version.name` | The name of the release, as it is in the release's zip file |
| `version.date` | The day the release was built |
| `version.commit` | The build number: the short form of the project's commit that the release was built from. It tells exactly which source it is |
| `version.dirty` | `true` when the release was built from source files that were changed after they were saved in the project's history. A release you were given is `false` |
| `version.sdk` | The version of the plugin SDK that this release implements. A plugin made for another SDK version is refused. See [Plugins from others](08-07-plugins.md) |
| `manual` | `true` when the release has its manual in `manual/`, and the help menu can open it |

The server reads `version.properties` once, when it starts. If you replace the files of a release, restart the server before you read the version, or you read the one that started. A server without the file, such as a developer's run, answers `"name": "dev"` and only the SDK version, and one that cannot read the file answers `"name": "unknown"` and says so in `logs/emcc.log`. In a report, give the name, the date and the build number, and the log, `logs/emcc.log`.

## The order of the work

A first installation goes in this order. Each step can be tested before the next one.

1. **Unpack the release** in a folder of its own, with a short path, for example a folder directly under the root of a drive. Start it with `start.bat -standalone` and open the address in the line `emcc ready at ...` that it prints. This is the no-login mode on this computer only. If it works, the installation is sound.
2. **Look through `settings/emcc.properties`.** Set the address the server listens on and the names that users will use for it. See [The settings files](08-01-settings-files.md).
3. **Serve over HTTPS.** Make or get a certificate, and put it in `settings/credentials/`. See [HTTPS](08-02-https.md).
4. **Let your identity system log users in.** Make the client, map its groups to permissions, and keep the client secret in the credentials folder. See [What you may bring yourself](08-03-infrastructure.md).
5. **Connect to the systems you exchange objects with.** For a TAK Server over TLS, set up a TLS credential. See [TLS credentials](08-04-tls-credentials.md) and [Cursor on Target](05-10-cot.md).
6. **Install the service**, so that emcc starts with the computer. See [The Windows service](08-05-service.md).
7. **Add the plugins** you need, and map their permissions to groups. See [Plugins from others](08-07-plugins.md).
8. **Open the Monitor** and look at what it says about the certificates and the plugins, and **read the log** for warnings about the credentials files. See [The Monitor workspace](06-00-monitor.md).

## Before you let users in

- The server is reached over HTTPS, and plain HTTP is off.
- Login is on, and the no-login mode is not. In the no-login mode everyone who reaches the server has every permission.
- The files in `settings/credentials/` can be read only by the account that runs emcc and by administrators. The log shows no warning about them at the start.
- Only the people who administer emcc are in the group that has the permission **Settings: administer**.
- Every plugin in `plugins/` is one you chose to run. A plugin is trusted code. See [Plugins from others](08-07-plugins.md).
- You have tried a stop and a start of the service, and a restart of the computer.
