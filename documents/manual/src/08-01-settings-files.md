# The settings files

An emcc installation is set up in two places. **The files in `settings/`** are what you edit by hand: the address the server listens on, the login, the log, the certificates. **The Settings workspace** is what emcc writes itself: the settings of the plugins and the defaults of the map. This chapter is about the files.

**Draft.** Written from ADR-0060, the owner's decisions of 2026-11-16 and the CDA's description of the files. Checked against a release built from commit c60fea19 and run without administrator rights. Text with CHECK in square brackets waits for a later check.

## What goes where

| You want to | Do it in |
|---|---|
| Change the port, the address the server listens on, the names it answers to, the login, the log | `settings/emcc.properties` |
| Keep a password, a secret or a key | A file in `settings/credentials/` |
| Add a link, choose a layer, set a colour, change a plugin's behaviour | The [Settings workspace](05-00-settings.md) |

The Settings workspace keeps its values in `data/ecore-config.json`. Do not edit that file by hand: emcc rewrites it at each change. The help for a setting there is the short line under the field and the **i** next to it, which every setting and every group has.

## settings/emcc.properties

The file is a list of lines `name=value`. It lists **every** setting that emcc reads from files, in groups with a heading in a comment: Server, Login, Credentials, Folders, Logging, The live picture, Security labels, Plugins' limits, Video streams and conversions, and Monitor. Each setting has comment lines: what it does, its unit, its default and an example. A setting that you have not set is in the file as a comment with its default, so that you can see all of them:

```
# The HTTP port, or the HTTPS port once a certificate is set. The start script sets it on its command line, which
# wins over this line.
# server.port=8080
```

A few lines in the release are already set, without a `#`: the login's client id, the claim with the groups and the permissions of the demo realm (see [What you may bring yourself](08-03-infrastructure.md)), the release's folders for `data`, `plugins` and `web`, and the log's file and size.

To change a setting, remove the `#` in front of its line and write the value. The server reads the file when it starts, so **restart the server** after a change.

The file replaces the files `application.properties` and `application-login.properties` of earlier releases.

Some settings you will need:

| Setting | What it does |
|---|---|
| `server.port` | The port. Default 8080 |
| `server.address` | The address the server listens on. Unset, it is every address of this computer with login, and this computer only without login. Use `0.0.0.0` to listen on every network interface so that other computers can reach it. Without login the server refuses this unless you also set `emc2.login.no-login.allow-network=true` |
| `emc2.allowed-hosts` | The names that users type for this computer, separated by commas. The server refuses requests for other names. `localhost`, `127.0.0.1`, `[::1]` and the server's own address are always allowed |
| `emc2.login.mode` | `oidc` (log in with OpenID Connect) or `none` (no login). See [What you may bring yourself](08-03-infrastructure.md) |
| `emc2.login.oidc.*` | The login: the identity system's address, the client's name, the claim with the groups and which group gives which permission |
| `logging.file.name` | Another log file than `logs/emcc.log` |
| `logging.level.plugin.<id>` | More detail in the log from one plugin, for example `logging.level.plugin.cot=DEBUG` |

### The order the files are read

The server reads these files when it starts, before it starts to serve, in this order:

1. `application-local.properties`, the old file, **deprecated**;
2. `settings/emcc.properties`;
3. every `.properties` file in `settings/credentials/`, by name.

**A later file wins over an earlier one.** So the new files win over the deprecated one. Environment variables and the command line win over all of them, and all of them win over the settings that come bundled with the server. The log names the files that were read, and the settings of `application-local.properties` that a later file also sets. It never writes the values.

The files are read as Java reads a `.properties` file: in Latin-1, with other characters written as `\uXXXX`. The settings `spring.profiles.active` and `spring.config.import` have no effect in them.

### Paths

A value in these files that starts with `%emcc%/` is a path below the emcc folder, wherever you unpacked it, so that the files can move with the folder. For example `%emcc%/settings/credentials/emcc.p12`. It works in every setting that holds a path: the key stores and trust stores, `emc2.conversions.ffmpeg`, `emc2.labeling.definitions` and `logging.file.name`.

### Files with comments

A file that you edit by hand and that is not a `.properties` file, for example the file with the premade security labels, may have comments: `//` to the end of the line, and `/* ... */`. You name that file in `emc2.labeling.definitions`, for example `%emcc%/settings/labeling-definitions.json`. Without the setting, emcc uses `labeling-definitions.local.json` in the emcc folder if it is there, and otherwise its own definitions. The release has no such file: you make it. See [Labeling](05-22-labeling.md).

### Environment variables

Every setting can also be given as an environment variable, with Spring's names: the upper-case name with dots and hyphens made into underscores, for example `EMC2_LOGIN_OIDC_CLIENT_SECRET` for `emc2.login.oidc.client-secret`. Use them where a container or a secret store sets them for you. An environment variable wins over the files, the credentials files too.

## settings/credentials

A secret does not go in `emcc.properties`, because that file may be read by more people than the secrets should be. Each secret has **a file of its own** in `settings/credentials/`, so that each can have its own permissions.

| File | What it holds | See |
|---|---|---|
| `login.properties` | The client secret for the login | [What you may bring yourself](08-03-infrastructure.md) |
| `https.properties` | The place and the password of the HTTPS certificate | [HTTPS](08-02-https.md) |
| `tls-<name>.properties` | One TLS credential for connections to other systems, for example a TAK Server | [TLS credentials](08-04-tls-credentials.md) |
| `http-<name>.properties` | The access token that a link sends to another system, for example to an NVG service. The link names it in its **Access token** | [NVG](05-23-nvg.md) |

The key stores and trust stores that these files name are kept in the same folder, with the same permissions.

**The release ships templates**, not the files themselves: `login.properties`, `https-example.properties`, `tls-example.properties` and `http-example.properties`. Each has only comments: a comment on every key, with its default or an example path, and **no value**. The server reads them like the other files, and the log names each one (`Settings read from settings/credentials/login.properties`), but they give it no setting, and they are not checked for who may read them (below). To fill one in:

1. For HTTPS, TLS and tokens, **copy** the template to the name in the table: `https.properties`, `tls-<name>.properties` or `http-<name>.properties`. The templates are named `-example` so that they are never taken for the real file. The login's file is there already under its own name, `login.properties`: change it in place.
2. In your copy, remove the `#` from the lines that you need, and write the values. Put the key store, trust store or certificate files that the lines name in the same folder.
3. Give the folder its permissions (below), and **restart the server**. The files are read when it starts, except that a renewed HTTPS certificate is picked up without a restart ([HTTPS](08-02-https.md)).
4. Read `logs/emcc.log`: it names the files that were read, and it warns about a file that other users can read.

There is no list to keep up to date: a file that you add to the folder is read at the next start.

**No secret goes on the command line**, in `start.bat` or in the definition of the service. The service reads its secrets from this folder only.

### Who may read the folder

`settings/credentials/` must be readable only by the account that emcc runs as and by administrators. The service's install script sets that. **A release that you have just unpacked does not have it**: the folder has the permissions of the folder that you unpacked it in, so you set them yourself, with the command below, if you run emcc with `start.bat`.

When the server starts it **checks the files that hold something to protect**: every `.properties` file that has at least one setting in it, and every key store, trust store and certificate file. **A `.properties` file with only comments and blank lines is not checked**, and the templates of the release are such files: a release that you have just unpacked gives no warning for them. The first setting that you write in a file makes it count. If other users could read a file that is checked, for example if Everyone, Users or Authenticated Users have read access, the server writes a **warning to the log** for each such file:

```
settings/credentials/http-demo.properties can be read by other users of this computer: give read access only to the account emcc runs as and to administrators (server/README.md, "Settings files")
```

The line ends with a pointer to a document of the project that is not in the release; the rest says what to do.

There is no entry in the Monitor: keeping the folder private is your task, so read the log after the first start.

To make the warning a refusal to start, put this in `emcc.properties`:

```
emc2.credentials.require-private=true
```

The default is `false`. A file that holds no setting does not count for this either. The check recognises the names Everyone, Users and Authenticated Users as Windows gives them, so on a Windows in another language it stays silent. A file whose permissions cannot be checked counts as readable by others. With `emc2.credentials.require-private=true` the server stops instead, and says: `emc2.credentials.require-private is true and other users can read settings/credentials/<the file>`.

To take the permissions of the folder from the users yourself, run this in a command window as administrator in the emcc folder, **after you have installed the service**: the account `NT SERVICE\emcc` exists only then. Before that, give the administrators alone access, and add the service's account later. It removes what the folder inherits, gives read access to the account that emcc runs as and full control to the administrators and to SYSTEM (`*S-1-5-32-544` and `*S-1-5-18` are their fixed ids, the same on every language of Windows). Use the account's name instead of `NT SERVICE\emcc` if you run emcc under another account, and if you run it with `start.bat`, use the account that you start it with.

```
icacls settings\credentials /inheritance:r /grant:r "NT SERVICE\emcc:(OI)(CI)R" "*S-1-5-32-544:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F"
```

After the command the log has no warning. [CHECK: that this holds with the account `NT SERVICE\emcc`, after `service-install.bat` has run: it needs administrator rights, and the command was run here only with the account of the person who tried it, in its place]

## Moving from application-local.properties

Earlier releases kept everything local in `application-local.properties`, secrets too. That file **still works**. The server logs a warning at every start that it is deprecated (*application-local.properties is deprecated (ADR-0060): move its settings to settings/emcc.properties and its secrets to settings/credentials/. The settings files win over it.*), and a second warning that names the keys of the file that the new files also set, never their values (*application-local.properties: these keys are also in the settings files, whose values count: emc2.login.oidc.client-id*). It is read first, so **the new files win over it**: where `application-local.properties` and `emcc.properties` or a credentials file set the same key, the new file's value is used. The names of the settings did not change. An installation keeps working until you move its settings.

To move them:

1. Copy the settings that are not secrets into `emcc.properties`.
2. Move the client secret into `settings/credentials/login.properties`, the HTTPS certificate's password into `https.properties`, and each TLS credential into a `tls-<name>.properties` of its own. The old keys `emc2.listeners.credentials.<name>.*` are still read, with a warning; where the old and the new file name the same credential, the new file wins.
3. Move each access token (`emc2.http.credentials.<name>.token`) into `http-<name>.properties`.
4. Start the server, and read the log: it names the keys of `application-local.properties` that the new files also set. Remove `application-local.properties` when none is left.

The keys of each file are in its template: `emc2.login.oidc.client-secret` (login), `spring.ssl.bundle.jks.emcc.*` or `spring.ssl.bundle.pem.emcc.*` ([HTTPS](08-02-https.md)), `emc2.tls.<name>.*` ([TLS credentials](08-04-tls-credentials.md)) and `emc2.http.credentials.<name>.token` (a token). An old credential in `application-local.properties` with a trust store and no password for it stops the server, with `emc2.listeners.credentials.<name>.trust-store-password is missing`: move it to a `tls-<name>.properties`.

## When something is wrong

| What you see | What to do |
|---|---|
| A setting that you changed has no effect | You did not restart the server, or the line is still a comment, or the setting is one of the Settings workspace and not of the file |
| The server logs a warning that names a file in `settings/credentials/` | Other users can read it. Tighten the folder's permissions as above |
| The server does not start and the log names a file in `settings/credentials/` | `emc2.credentials.require-private` is `true` and the file can be read by others, or the file's content is not valid |
| The server logs that `application-local.properties` is deprecated | Move its settings, as above |
| A file you made in Notepad is not read | Windows hides the ending of known file types. Check that its name does not end in `.txt` |
