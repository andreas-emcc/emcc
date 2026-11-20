# What you may bring yourself

emcc runs on infrastructure that you already have. This chapter says what you may bring, and what emcc needs from it: your own Java, your own ffmpeg, Keycloak or another OpenID Connect identity system for the login, and a TAK Server to exchange objects with.

**Draft.** Written from the M9 plan, the server's documentation and, for Java and ffmpeg, the server's code (M9 C5). Checked against a release built from commit c60fea19 and run without administrator rights. Text with CHECK in square brackets waits for a later check.

## Java

The release comes with a Java runtime in `runtime/`, so that nothing needs to be installed. If your organisation wants to run emcc on a Java that it provides and patches itself, that is possible.

- It must be **Java 25 or later**. The server is built for Java 25 and does not start on an older one. Any vendor's Java will do.
- It must have the Java modules that the server needs. These are the modules of the release's runtime, and a full JDK has them all: `java.base`, `java.compiler`, `java.datatransfer`, `java.desktop`, `java.instrument`, `java.logging`, `java.management`, `java.naming`, `java.net.http`, `java.prefs`, `java.scripting`, `java.security.jgss`, `java.security.sasl`, `java.sql`, `java.transaction.xa`, `java.xml`, `jdk.charsets`, `jdk.crypto.ec`, `jdk.jfr`, `jdk.localedata`, `jdk.management`, `jdk.naming.dns`, `jdk.net`, `jdk.unsupported` and `jdk.zipfs`. The command `runtime\bin\java --list-modules` shows the release's own.
- **Tell the start script and the service which Java to use with the environment variable `EMCC_JAVA_HOME`**: the home folder of the Java, the one with `bin` in it. Without it they use the `runtime` folder next to them. `start.bat` prints `Java: ... (EMCC_JAVA_HOME)` when it uses yours, and stops with a message if there is no `bin\java.exe` in it. For the service, set the variable in the window where you run `service-install.bat`: the install script takes the Java from it, and the service keeps to that Java until you remove it and install it again. See [The Windows service](08-05-service.md).

When the server starts, the log has a line that names the Java that runs it: its version, its vendor and its folder. Look there when you are not sure which Java the start script or the service picked.

The release's own runtime is made from the Eclipse Temurin JDK. Its licence is in the `runtime/legal/` folder.

## ffmpeg

emcc uses ffmpeg only to turn MPEG-2 video from a camera into H.264, which a browser can play. See [FMV: full motion video](03-19-fmv.md). The release has a small ffmpeg in `tools/ffmpeg/`, built for this one job, under the LGPL. emcc starts it as a program of its own and talks to it through pipes.

You may use an ffmpeg of your own: set `emc2.conversions.ffmpeg` in `emcc.properties` to the path of its `ffmpeg.exe`. A path that starts with `%emcc%/` is below the emcc folder. Left empty, the setting means the release's. The ffmpeg you bring needs three things, and emcc asks for each **by name**:

- the `h264_mf` encoder, which is Windows' own H.264 encoder. An ffmpeg with another H.264 encoder, such as `libx264`, is not enough;
- the `mpeg2video` decoder;
- the `mpegts` format, both to read it and to write it.

### The check at the start

emcc checks the converter **once, when the server starts**. It runs it with `-version`, `-encoders`, `-decoders` and `-formats`, with no environment variables at all, in a folder of its own, and waits at most 10 seconds for each answer. A converter that hangs therefore delays the start by 40 seconds at the most. The result is in `logs/emcc.log` only: **the Monitor has no entry for it.**

| In the log | It means |
|---|---|
| `Converter <path>: ffmpeg version ...` | The converter is there and has all three. Nothing to do |
| `No converter at <path>: every conversion fails as unavailable` | There is no file at the path. Check `emc2.conversions.ffmpeg`, or that the release's `tools/ffmpeg/` is there |
| `Conversions unavailable: the converter <path> has no ...` | It lists what is missing: the encoder, the decoder, or the demuxer or muxer of `mpegts`. Use an ffmpeg that has them |
| `Conversions unavailable: the converter <path> did not answer ...` | It did not run, did not answer in 10 seconds, or is not ffmpeg |

Because the converter gets **no environment variables**, an ffmpeg that needs `PATH` or `LD_LIBRARY_PATH` to find its libraries does not run, and the check says that it did not answer. Use a build that carries its libraries, such as a static build. Each conversion later runs the same way, and in a working folder of its own, named `emcc-conversion-` and a number, in the system's temporary folder. emcc removes the folder when the conversion ends.

### On Linux

`h264_mf` is part of Windows. An ffmpeg on Linux has no such encoder, so **every conversion is unavailable on Linux**, whatever ffmpeg you bring, until a Linux release chooses its own encoder. Cameras that send H.264 are not affected. The converter runs under `/usr/bin/nice`, which must be there.

### What goes wrong

If ffmpeg is not there or does not work, only the conversion fails: the FMV panel says "No converter installed", for every reason in the table above, and nothing else stops. The log tells which reason it is. The ffmpeg in the release has no GPL parts, and its licence ships with it. An ffmpeg that you bring has the licence you chose when you got or built it. You may replace the release's `tools/ffmpeg/ffmpeg.exe` with your own build of it, or leave it and point `emc2.conversions.ffmpeg` at yours, as above; the release's `README.txt` names the build and says the same. The exact source of the release's ffmpeg is in the zip next to the release, the one with `-ffmpeg-source` in its name.

### The settings for conversions

These are in `emcc.properties`. Restart the server after a change.

| Setting | Default | What it does |
|---|---|---|
| `emc2.conversions.max` | 2 | How many conversions run at once, 1 to 64. The others wait their turn, first come, first served across the plugins |
| `emc2.conversions.input-queue-bytes` | 2 097 152 | The most input that waits for a conversion's process, 64 KiB to 64 MiB |
| `emc2.conversions.max-pixels` | 8 294 400 | The largest picture, in pixels. 8 294 400 is 3840 × 2160. Allowed: 307 200 to 35 000 000 |
| `emc2.conversions.restart-seconds` | 10 | The least time, in seconds, between two starts of the converter for one plugin's stream. 1 to 600 |

A start of a conversion that comes inside the restart time **waits**, and the input that arrives meanwhile is dropped. Other streams are not held up. The conversion then starts when the time is over. The time limits how often a stream that keeps failing can start the converter again.

## Keycloak or another identity system

Users log in with OpenID Connect. Their groups, or roles, give them permissions. emcc has been tested with Keycloak, the version that the project tested against was 26.8.0. Another OpenID Connect system will do if it can put the user's groups or roles into the ID token as a list of strings.

### What to make at the identity system

A **client** with these settings. The names are Keycloak's; other systems have similar ones.

| Setting | Value |
|---|---|
| Client ID | `emc2` (or another name, then set `emc2.login.oidc.client-id`) |
| Client authentication | On: emcc is a confidential client |
| Flow | The standard flow (authorization code). emcc always sends PKCE, with the method `S256` |
| Valid redirect URIs | `<server>/login/oauth2/code/emc2`, for example `https://emcc.example.org:8080/login/oauth2/code/emc2` |
| Valid post logout redirect URIs | `<server>/` |
| Backchannel logout URL | `<server>/logout/connect/back-channel/emc2`, with the session id required |
| A mapper for the groups | Puts the user's groups into the ID token as the claim `groups`. In Keycloak: "Group Membership", with the full path off. Realm roles may be used instead, as `realm_access.roles` |

Use `https://` in the addresses when HTTPS is on. See [HTTPS](08-02-https.md).

Copy the client's secret from the identity system (in Keycloak, the client's Credentials).

### What to set in emcc

In `settings/emcc.properties`:

```
emc2.login.mode=oidc
emc2.login.oidc.issuer-uri=https://keycloak.example.org/realms/emc2
emc2.login.oidc.client-id=emc2
emc2.login.oidc.roles-claim=groups
emc2.login.oidc.permissions[objects.edit]=editors,admins
emc2.login.oidc.permissions[layers.edit]=editors,admins
emc2.login.oidc.permissions[settings.admin]=admins
```

In `settings/credentials/login.properties`:

```
emc2.login.oidc.client-secret=<the secret>
```

The claim `roles-claim` may be a dotted name that reaches into an object, such as `realm_access.roles`. The brackets in a permission's name are needed, because the names contain dots. Each permission is given to one or more groups, separated by commas.

The release's `emcc.properties` already has the lines for `client-id`, `roles-claim` and the permissions, with the groups of the demo realm `emc2-demo` (`drawers`, `editors`, `admins`, `sim-viewers` and so on). Replace the group names with those of your identity system. The login mode `oidc` is the default, so a line for it is not needed.

### How the start chooses the login

- **`start.bat` without arguments** follows the settings, the login too. If the settings name no identity system, the script says so (`settings/emcc.properties sets no login`), and the server stops with the reason: *Login with OpenID Connect ... is missing emc2.login.oidc.issuer-uri, emc2.login.oidc.client-secret*. It never goes on without login by itself.
- **`start.bat -standalone`** is the no-login mode on this computer only.
- **`start.bat 8080 8180 emc2-demo`**, a port, a Keycloak and a realm, logs in with that Keycloak for this start. The Keycloak is a port on this computer or an address, and it must come with the realm. What the command line sets wins over the files. The script stops and says so if the client secret is in neither `settings/credentials/login.properties` nor the environment variable `EMC2_LOGIN_OIDC_CLIENT_SECRET`.
- **The service** has no command line and no environment variables of yours. The settings must name the login, and the secret must be in `settings/credentials/login.properties`. See [The Windows service](08-05-service.md).

When the login works, the log says `Login with OpenID Connect at <the realm's address> as client emc2`.

### What happens at the start

emcc reads the identity system's discovery document when it starts. If the identity system cannot be reached, **the server does not start**, and the log says why. It never goes on without login by itself. A user's permissions are read once, **when the user logs in**: a group that you give or take away at the identity system counts from the user's next login.

### Permissions

The permissions are in [Users and permissions](01-03-permissions.md). The plugins have permissions of their own: see [Plugins from others](08-07-plugins.md).

### The no-login mode

`emc2.login.mode=none` means no login: everyone who reaches the server works as one local user with every permission. The server then listens on this computer only. Letting it listen on the network without login needs `emc2.login.no-login.allow-network=true` as well, and is for a network you trust and for a demonstration. Do not use it on a product installation.

## TAK Server

emcc exchanges objects with a TAK Server through a **Cursor on Target** link, which you add in Settings. See [Cursor on Target](05-10-cot.md). The link connects as a client: emcc is a TAK client, and the TAK Server is the one you run.

| Link | Port of a TAK Server | What it needs |
|---|---|---|
| `tcp` | 8087 | Nothing. Not protected. Use it only on a network you trust |
| `tls` | 8089 | A TLS credential: the server's certificate authority, and a client certificate that your TAK administrator issued for emcc. See [TLS credentials](08-04-tls-credentials.md) |

The TAK Server's certificate must name the host that the link connects to. emcc checks that.
