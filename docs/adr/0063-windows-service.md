# ADR-0063: emcc as a Windows service

- Status: Accepted (owner, YK A, 2026-11-16, through the MCA; proposed by the ACA the same day; M9, "productification"). The owner chose procrun (2026-11-16, M9 plan Q1 A)
- Date: 2026-11-16
- Deciders: Owner (advised by the ACA)
- Extends: ADR-0016 (licences), ADR-0060 (settings and credentials files)

## Context
Today emcc runs from `start.bat` in a console window and stops with Ctrl+C:
- the server shuts down gracefully (`server.shutdown=graceful`);
- ECore closes its tasks and the simulator saves its state.

A product must start at boot, run with no user logged in, restart after a failure, and stop cleanly when Windows shuts down. The Java runtime cannot register itself as a Windows service, so a small wrapper does it. Two have licences the project allows (ADR-0016):
- **WinSW** (MIT):
  - one `.exe` with an XML file beside it, which can carry comments;
  - it runs the same `java` command as `start.bat`, as a child process;
  - **its stop:** by default it kills the process at once. With a stop timeout it first sends Ctrl+C, and kills the process when that fails or the process has no console. With a stop command it runs that command and waits for both processes to end;
  - its stable line is version 2, built on the .NET Framework that current Windows versions include. Version 3 is still a pre-release (alpha).
- **Apache Commons Daemon procrun** (Apache-2.0):
  - `prunsrv.exe`, a native Windows program, maintained by the Apache Software Foundation, with a security process;
  - its configuration is in the registry, written by an install command;
  - it can run the JVM in its own process (`jvm` mode) and stop it by calling a static method, or run `java` as a child process;
  - it kills the process tree after a stop timeout.

## Decision
1. **The release can install emcc as a Windows service** named `emcc`:
   - two scripts, `service-install.bat` and `service-uninstall.bat`, run as administrator;
   - automatic start (delayed), runs with no user logged in;
   - restart after a failure, with a back-off.

   `start.bat` stays for running in a window.
2. **The wrapper is procrun** (owner, 2026-11-16, M9 plan Q1 A), for its maintenance and security process, its native program and its graceful stop through a method. WinSW, with its readable XML file and its child process, was the alternative (below).
   - Whichever it is, its version is pinned, its licence is in the third-party notices, and the MCA's build fetches it.
   - With procrun, the install script holds the whole definition in one readable, commented file, so the registry is never edited by hand.
3. **One start path:**
   - the service runs the same Java, the same arguments and the same settings as `start.bat`;
   - its working directory is the emcc folder, so `%emcc%/` resolves as before;
   - **no secret is in its definition** (ADR-0060).
4. **A graceful stop:**
   - the service's stop runs the server's orderly shutdown, as Ctrl+C does today, within a stop timeout (default 60 s);
   - only after that is the process killed;
   - **a stop that needs no console:** neither wrapper can rely on Ctrl+C reaching a service's process. The CDA gives the edge a stop entry point, which runs the same orderly shutdown as the dev profile's `ServerStopper` does today: a static stop method that procrun calls. It is reachable only from the server's own computer and only by the service, never as an endpoint for users.
5. **The account:**
   - a virtual service account, `NT SERVICE\emcc`, with no password and no rights beyond what it needs;
   - read access to the emcc folder, write access to `data/` and `logs/`, and read access to `settings/credentials/` (ADR-0060), set by the install script;
   - an admin may choose another account.
6. **Logs:** emcc's log stays `logs/emcc.log`. The wrapper's own log also goes to `logs/`.
7. **Linux comes later:** a `systemd` unit with its own install script, in the milestone that brings the Linux release (M10: owner, 2026-11-16, M9 plan Q5 B). That is the Linux counterpart of the Windows scripts, not an exception to the cross-platform rule (`CLAUDE.md` section 4): a service is installed by each platform's own means.

## Alternatives considered
- **WinSW** (MIT): see the context. Its readable XML file was its strength; the owner chose procrun (Q1 A).
- **The Windows Task Scheduler at boot:** no stop, no restart policy, and no service controls for an admin.
- **A `jpackage` installer with `--launcher-as-service`:** it makes an MSI installer, which needs WiX at build time, and on Windows it still needs a service wrapper of our own choosing as its "service installer". It adds an installer beside the zip, not a different wrapper.
- **NSSM** (public domain): a capable wrapper, but unmaintained since 2017, and public domain is not on the project's licence list. That would need its own CR.
- **Our own wrapper in C# or C:** code to maintain and review, and a new toolchain.

## Consequences
- **CDA:** the edge's stop entry point for procrun, and the check that a service stop runs the same orderly shutdown as Ctrl+C.
- **MCA:**
  - the wrapper in the release, pinned and in the notices;
  - the two scripts, generated by `tools/release.mjs`;
  - the account's folder permissions.
- **ITA:** install, start at boot, stop, a restart after a killed process, and uninstall, on a Windows test machine with administrator rights.
- **UDA:** the admin guide's service chapter.
- **SRA:** the service account, the folder permissions, the wrapper's dependency.
