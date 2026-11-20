# The Windows service

With `start.bat`, emcc runs in a command window, and stops when you close it. As a **Windows service** it starts when the computer starts, runs with no one logged in, starts again after a failure, and stops in order when Windows shuts down.

**Draft.** Written from ADR-0063 and from the release's two scripts, which were read and not run: installing a service needs administrator rights. Text with CHECK in square brackets waits for a run on a Windows with those rights.

## What the service is

- It is named `emcc`.
- The release has two scripts in its top folder, `service-install.bat` and `service-uninstall.bat`. Run them as administrator.
- It starts automatically, a little after Windows has started (a delayed start).
- It runs the **same Java and the same settings** as `start.bat` without arguments. Its working directory is the emcc folder, so `%emcc%/` in the settings means the same folder. The service has no command line and no `-standalone`: `settings/emcc.properties` must name the login. See [How the start chooses the login](08-03-infrastructure.md).
- **No secret is in its definition.** It reads its secrets from `settings/credentials/`. See [The settings files](08-01-settings-files.md).
- It uses **procrun**, version 1.6.1, a program of Apache Commons Daemon (Apache License 2.0), which the release carries as `service/prunsrv.exe`, and its licence notice names. procrun runs the Java **inside its own process** (its `jvm` mode), so there is no second process. It starts and stops the server through a small class in `emcc-service.jar`, which lies next to `emc2-app.jar`. The class starts the same server as `start.bat` does.
- **`service-install.bat` is the definition of the service.** It is a readable file with a comment on every step. To change the service, for example to use another Java, remove it with `service-uninstall.bat` and install it again.
- `start.bat` stays: you can still run emcc in a window, but not at the same time as the service, because both use the same port.

## Installing it

1. Stop emcc if it runs in a window.
2. Make sure that `settings/emcc.properties` names the login: `emc2.login.oidc.issuer-uri`, or `emc2.login.mode=none` for no login on this computer only. With an identity system, the client secret must be in `settings/credentials/login.properties`. The install script stops and says so if one of them is missing, because the service cannot read your environment variables.
3. If you want a Java of your own, set `EMCC_JAVA_HOME` in the command window before the next step. See [What you may bring yourself](08-03-infrastructure.md).
4. Open a command window **as administrator**, in the emcc folder.
5. Run `service-install.bat`. It takes no arguments: the port and HTTPS are in the settings.
6. The script starts the service. It says *The service emcc is installed and starting*. When the server is ready, `logs/emcc.log` has the line `emcc ready at <address>`: open that address in a browser.

The script checks first that you are administrator, that the release is unpacked, and that no service `emcc` exists. If one of the later steps fails, it removes the service again and says that it was not installed.

To remove the service, run `service-uninstall.bat` as administrator. It stops the service, waits for the orderly shutdown (at most 60 seconds), takes back the account's rights to the folder and removes the service. The `settings`, `data` and `logs` folders stay, and `settings/credentials` stays readable by administrators only.

[CHECK: the whole procedure on a Windows with administrator rights: install, start, the ready line, stop, restart, remove (the ITA's test T1)]

## The account

By default the service runs as a **virtual service account**, `NT SERVICE\emcc`. It has no password, and no rights beyond what it needs. The install script gives it:

- read access to the emcc folder;
- change access to `data/` and `logs/`;
- read access to `settings/credentials/`, which the script limits to this account, the administrators and SYSTEM.

You may choose another account, for example a domain account that your organisation uses for services. The install script does not take an account: it installs the service with the virtual account. Change the account afterwards in the **Services** console, and give the new account the same access with `icacls`, as the install script does. The command for `settings/credentials` is in [The settings files](08-01-settings-files.md).

## Stopping and restarting

A stop of the service is the **orderly shutdown**, as Ctrl+C is in a window. procrun asks `emcc-service.jar` to stop, and the Java then ends with exit code 0 through its normal shutdown: the web server finishes the requests it is working on, and then ECore closes the plugins and the sessions, and the object store and the persistence manager write everything. The service waits for that for up to **60 seconds**, and only then ends the process. The 60 seconds are `--StopTimeout=60` in `service-install.bat`: change it there, and install the service again.

If the process ends by itself, for example because it was killed or the Java runtime failed, Windows **starts the service again**: after 10 seconds, after 30 seconds, and then after 60 seconds each time. The count starts again after a day without a failure. A server that **cannot start**, for example because its port is taken or the identity system cannot be reached, ends the Java with exit code 1, so the same rule applies: the service starts again and fails again until you correct the cause.

| To | Do |
|---|---|
| Stop | `net stop emcc`, or `sc stop emcc` |
| Start | `net start emcc`, or `sc start emcc` |
| See its state | `sc query emcc` |
| Restart after you changed a file in `settings/` | `net stop emcc`, then `net start emcc` |

## The log

emcc's log is `logs/emcc.log` as before. procrun has a log of its own, also in `logs/`: `procrun.<date>.log`, with the date in its name. When the service does not start, read procrun's log first: it says whether Java was found and started. Then read `logs/emcc.log`.

## HTTPS and the service

The account must be able to read `settings/credentials/https.properties` and the certificate files. The install script limits the folder to the account, so a file that you put there later has the folder's permissions. If the service does not start after you turned HTTPS on, look in the log for a message about the certificate, and check the account's access. See [HTTPS](08-02-https.md).

## Linux

A Linux release, with a service unit for `systemd` and its own install script, comes later.

## When something is wrong

| What you see | What to do |
|---|---|
| The install script says *Run this as administrator* | Open the command window **as administrator**: right-click the script and choose Run as administrator |
| The install script says that `settings\emcc.properties` sets no login, or that there is no client secret | Set the login in the settings and the secret in `settings/credentials/login.properties`, and install again. The service does not see environment variables |
| The install script says that the service is installed already | Remove it first with `service-uninstall.bat` |
| The install script says *There is no ... jvm.dll* | `EMCC_JAVA_HOME` must name a Java 25 or later, or be unset, to use the `runtime` folder |
| The service starts and stops at once, and starts again after 10 and 30 seconds | Read procrun's log and `logs/emcc.log`. The usual causes are a port that is taken, an unreadable file in `settings/credentials/`, and an identity system that cannot be reached when the server starts |
| The server does not reach the identity system when the computer starts | The service started before the network or the identity system was up. The restart after 10 and 30 seconds may be enough, or start it again, or make the identity system start first. [CHECK: whether the delayed start and the restarts are enough after a restart of the computer] |
| The service does not stop within the minute | Something holds the shutdown. The service then ends the process. Look at the end of `emcc.log` |
| The settings that you made in a command window are not used by the service | The service reads the same files, but its environment variables are its own, and `EMCC_JAVA_HOME` counts only when you install it. Use the files |
