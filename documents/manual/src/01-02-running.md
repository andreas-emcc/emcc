# Running emcc (admins)

This chapter is for the person who runs the emcc server. Users only need a browser and the address of the server.

emcc comes as a folder (a zip file that you unpack) for Windows. Everything it needs is in the folder, including a Java runtime: you do not install anything.

This chapter is the short way to start. To run emcc as a product on your own infrastructure (HTTPS, your own identity system, TLS to a TAK Server, a Windows service), see [Administering emcc](08-00-administering.md).

The users need a modern browser with WebGL, for the map. A graphics card is only needed in the user's computer, not on the server. Without one the map still works, with limits: see [The map](03-02-map.md).

## Starting the server

Open a command window in the folder and run `start.bat -standalone`. Open the address in the line `emcc ready at ...` that it prints, in a browser. Stop the server with Ctrl+C.

| Command | Login | Port |
|---|---|---|
| `start.bat -standalone` | none, this computer only | 8080 |
| `start.bat -standalone 9090` | none, this computer only | 9090 |
| `start.bat` | as `settings/emcc.properties` says | as the settings say (8080) |
| `start.bat 9090` | as the settings say | 9090 |
| `start.bat 8080 8180 emc2-demo` | Keycloak on this computer, port 8180, realm `emc2-demo` | 8080 |
| `start.bat 8080 https://kc.example:8443 emc2` | Keycloak at that address, realm `emc2` | 8080 |

The arguments are, in order: `-standalone` or nothing, the port (default 8080), then the Keycloak and the realm, which are given together or not at all. What the command line sets wins over the settings files.

The script first checks a few things and says what it found. It prints which settings file it read, for example `Settings: "<the release folder>\settings\emcc.properties"`, so that you can see that the file you edited is the one that is used. It stops with a message if there is no `app` or `runtime` folder next to it, which means the zip was started from inside the zip and not unpacked: unpack the whole zip first, and start the script in the unpacked folder. It names a folder that is too deep for Windows, and it warns if it finds `settings\emcc.properties.txt`. See "The settings" below.

If you want to run emcc on a Java of your own, set the environment variable `EMCC_JAVA_HOME` to its home folder (Java 25 or later) before you start. See [What you may bring yourself](08-03-infrastructure.md).

The first start makes the `data` and `logs` folders if they are not there. A second browser window or tab on the same computer shares the same live map.

## Without login

With `-standalone` the server runs in the no-login mode: everyone who opens it works as one local user with every permission. A banner at the top of the page says so: "NO LOGIN: everyone who reaches this server works as Local user, with all permissions."

The server then listens on this computer only (127.0.0.1), so open `http://localhost:<port>/`. Other computers cannot reach it. Use this mode to try emcc, to demonstrate it, and for work that is not protected.

## With login

Without `-standalone` the server follows the settings, and the settings must name an identity system: `start.bat` without arguments and without a login in `settings/emcc.properties` makes the server stop and say that the login is missing. With a Keycloak and a realm, users log in with OpenID Connect, and their groups give their permissions. Open the address in the `emcc ready at` line. The browser goes to the Keycloak login page and comes back. See [Users and permissions](01-03-permissions.md) for the permissions.

It needs three things:

1. **A client `emc2` in the realm** that allows `<the address that the server prints>login/oauth2/code/emc2` as a redirect address, for example `http://localhost:8080/login/oauth2/code/emc2`. Otherwise Keycloak shows "Invalid parameter: redirect_uri".
2. **The client secret**, from Keycloak. Put it in the file `settings/credentials/login.properties`, which is in the release as a template: remove the `#` and write the secret after the `=`:

   ```
   emc2.login.oidc.client-secret=<the secret>
   ```

   or set the environment variable `EMC2_LOGIN_OIDC_CLIENT_SECRET`. Never put it on the command line. Without it the script stops and says so.
3. **Keycloak running** when the server starts. If it cannot be reached, the server does not start. It never falls back to no login by itself.

To log in without giving the Keycloak on the command line, set `emc2.login.oidc.issuer-uri` in `settings/emcc.properties`. See [What you may bring yourself](08-03-infrastructure.md).

## The settings

The settings are in `settings/emcc.properties`: every setting is there, commented out with its default and explained. Remove the `#` and change the value to set one, and restart the server. Each line is `name=value`. What the start script sets on its command line wins over the file. Passwords, secrets and tokens never go there but in `settings/credentials/`. See [The settings files](08-01-settings-files.md).

An `application-local.properties` next to the start script, as earlier releases used, is still read, but it is deprecated and the log says so: move its lines to `settings/emcc.properties` and its secrets to `settings/credentials/`.

Windows hides the file ending of known file types. A file you made in Notepad can be called `emcc.properties.txt` without showing it. The server does not read that file. The start script warns "Found settings\emcc.properties.txt": rename the file so that it ends in `.properties`.

| Setting | What it does |
|---|---|
| `server.address=0.0.0.0` | Listen on every network interface, so that other computers can reach the server |
| `emc2.allowed-hosts=<name>` | The name other computers use for this one. The server refuses requests for names it does not know |
| `emc2.login.no-login.allow-network=true` | Needed as well to listen on the network without login. Then everyone who reaches the server works as the local user, with every permission: use it only on a network you trust |
| `emc2.login.oidc.client-id=<id>` | Another client name than `emc2` (with login) |
| `emc2.http.credentials.<name>.token=<token>` | An access token that a link of a plugin sends to another system, for example an NVG link. The link names it in its **Access token**. It goes in a file in `settings/credentials/`. See [NVG](05-23-nvg.md) |
| `logging.level.plugin.<id>=DEBUG` | More detail in the log from one plugin, for example `logging.level.plugin.cot=DEBUG` |
| `logging.file.name=<file>` | Another log file than `logs/emcc.log` |

With login and other computers, the Keycloak client must also allow `http://<name>:<port>/login/oauth2/code/emc2`, and users open `http://<name>:<port>/`.

## The folders

| Folder | What it holds |
|---|---|
| `data` | The map's data. Delete it to start with an empty map. Unpack the zip again to get the demo scenario back |
| `logs` | The server's log, `logs/emcc.log`, made at the first start. A new file is begun at 20 MB. Older ones are kept 14 days, and at most 280 MB. Send `emcc.log` with a problem report |
| `manual` | This manual, as web pages. Open `manual/index.html` in a browser; it does not need the server. When the server runs, the help menu (`?`, at the right end of the top bar) opens it from the server too |
| `plugins` | The installed plugins |
| `settings` | The settings (`emcc.properties`), the credentials (`credentials`) and the folders `terrain` and `imagery`, each with a short readme. `terrain` is for height data, which the terrain tools and the simulated cameras read by themselves, and `imagery` is for the photographs that the simulated cameras draw their pictures from. See [Terrain](05-20-terrain.md) and [FMV output links, imagery and terrain](05-24-fmv-output.md) |
| `runtime` | The Java runtime. No Java needs to be installed |

## The log and problem reports

The server writes its log to `logs/emcc.log`. The log says what the server and the plugins do, and why a link does not connect or a request is refused. When something goes wrong, send the file `emcc.log` (and `emcc.log` files of earlier days, if the problem is older) with your report, together with what you did and what you saw.

The defaults are in `settings/emcc.properties`, as comments. A log file is rolled at 20 MB, and the older files are kept for 14 days, in all at most 280 MB.

## The demo scenario

At the first start emcc holds a demo scenario: fictitious units around Stockholm, near Gotland, in the Arctic and in Antarctica, each group on its own layer. The Simulation workspace has one empty layer.

## When it does not start

| What you see | What to do |
|---|---|
| "The port must be a number" or a port that is taken | Start with another port, for example `start.bat -standalone 9090` |
| "settings/emcc.properties sets no login" and the server stops | Set the login in the settings, give Keycloak on the command line, or start with `-standalone` |
| "Give the realm after the Keycloak" | The Keycloak and the realm come together |
| "No client secret" | See "With login", point 2 |
| The server stops at once with login | Keycloak is not running, or not at the address given, or the realm does not exist. The log says which |
| "Invalid parameter: redirect_uri" at Keycloak | The client does not allow the address you opened. See "With login", point 1 |
| "invalid_token_response" after you log in at Keycloak: an error page, and a 401 in the log | The client secret does not match the secret of the client in that realm. Copy the secret again from Keycloak (the client `emc2`, Credentials) into `settings/credentials/login.properties`, and start again |
| "There is no app folder (or runtime folder) next to this script" | The script was started from inside the zip, which unpacks only the script. Unpack the whole zip, then start the script in the unpacked folder |
| "EMCC_JAVA_HOME is set, but there is no ..." | It must name a Java's home folder, the one with `bin` in it, 25 or later. Remove the variable to use the release's runtime |
| The file `emcc.properties` seems not to be read | Look at the line `Settings:` that the script prints. It must name the folder where the file is. A file called `emcc.properties.txt` is not read: rename it |

More on problems is in [Known limits and troubleshooting](90-02-limits.md).
