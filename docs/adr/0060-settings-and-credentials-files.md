# ADR-0060: The installation's settings files, with credentials apart and a comment on every setting

- Status: Accepted (owner, YK A, 2026-11-16, through the MCA; proposed by the ACA the same day; M9, "productification"). **Amended by CR-0049 part B** (owner, ZH A, 2026-11-16), after the owner's ZE A in the CDA's C1: points 3 and 5 and the consequences say that a readable credentials file gives no Monitor entry, the check's limit on Windows, and the read order
- Date: 2026-11-16
- Deciders: Owner (advised by the ACA)
- Extends: ADR-0022 (login), ADR-0030 (offline, hosts from settings), ADR-0036 (connection tasks' TLS by name), ADR-0049 (folders, `%emcc%`)

## Context
An installation is configured in two places today:
- **Files an admin edits by hand**, all Spring `.properties` files:
  - the release's `application.properties` (the log file);
  - `application-login.properties` (the client id, the roles claim, the permission map);
  - `application-local.properties`, which holds everything local, **secrets included**: the OIDC client secret, the TLS key and trust stores' paths and passwords (`emc2.listeners.credentials.<name>.*`), and the HTTP tokens (`emc2.http.credentials.<name>.token`).
  - The labeling definitions are a JSON file an admin may write.
- **Settings an admin changes in the Settings workspace.** emcc writes them itself to `data/ecore-config.json`, validated against each manifest's JSON Schema. Their help is the schema's titles and hints, shown in the form.

**The problems for a product:**
- One file mixes ordinary settings with secrets, so it cannot get narrower permissions than the rest.
- Only some keys carry a comment, and a key that is not in the file is not seen at all.
- The tests and the start scripts pass some values on the command line.

## Decision
1. **The admin's files live in `settings/`** in the emcc folder, next to the `settings/terrain/` folder the release already has:
   - **`settings/emcc.properties`:** the installation's settings. It replaces the release's `application.properties` and `application-login.properties`; the server reads it at start.
   - **`settings/credentials/`:** a folder with **one file per credential**, so that each can get its own permissions (point 3):
     - `login.properties` (the OIDC client secret);
     - `https.properties` (ADR-0061);
     - one `tls-<name>.properties` per TLS credential (ADR-0062);
     - one `http-<name>.properties` per HTTP token;
     - and the key and trust store files they name.
   - **How the server reads them:** both the file and every file in the folder, with no list of files to keep up to date. The CDA names the mechanism (for example Spring's `spring.config.import`, or ECore reading the folder before the edge starts). The start scripts and the service pass no profile for them.
   - **Environment variables keep working** for every key (Spring's naming), for containers and for secret stores that inject them.
   - **No secret on the command line,** in the start scripts or the service's definition (ADR-0063). A Windows service keeps its environment in its definition, so **the service reads its secrets from the credentials files only**. Tests may keep passing secrets on their own computers.
2. **Every setting and every group has a comment.** The format stays `.properties`, which takes comments natively, so **no new format is needed for these files** (owner, 2026-11-16, M9 plan Q11 A):
   - the release writes `settings/emcc.properties` with **every** key emcc reads, grouped under a comment heading (Server, Login, Labels, Logging, Folders, and so on);
   - each key has one or more comment lines: what it does, its unit, its default and an example. Keys an admin does not set stay in the file as comments with their default (`# server.port=8080`), so that the file lists them all;
   - the credentials files are written the same way, as commented templates without values;
   - **hand-edited JSON files** (the labeling definitions, and any later one) **may carry comments** (`//` and `/* */`). ECore reads them with comments allowed; Jackson's reader already offers that, so it adds no dependency. Their example in the release is commented;
   - **the settings that emcc writes itself** (`data/ecore-config.json`) stay plain JSON and are not edited by hand. **Their "comments" are the manifests' titles, descriptions and hints:** every plugin setting and every group of settings has a title and a description, which the Settings form shows. The template and the design pattern make this a rule, and a manifest check in each plugin's build enforces it.
3. **Narrow permissions for credentials:**
   - the release and the service's install script (ADR-0063) give `settings/credentials/` read access only to the account emcc runs as and to administrators;
   - **at start ECore checks** every file it reads from `settings/credentials/`. Where others can read it (on Windows, an ACL entry that lets Everyone, Users or Authenticated Users read; on Linux, group or other read bits), it logs a warning naming the file. **There is no Monitor entry** (owner, ZE A, 2026-11-16): keeping the folder private is the admin's task, and the documentation says how (`server/README.md`, "Settings files", and the admin guide);
   - **an admin may make this a refusal to start** (`emc2.credentials.require-private=true`, default false; owner, 2026-11-16, M9 plan Q2 A);
   - **the check's limit on Windows:** Java's ACL view gives the groups' names, not their SIDs, so the check knows Everyone, Users and Authenticated Users by their English names only. **On a Windows in another language it finds nothing,** and `emc2.credentials.require-private` refuses nothing there; the folder's permissions then rest on the release, the install script and the admin.
4. **Paths in the settings files may start with `%emcc%/`** and are resolved below the emcc folder, as folder settings are since M7 (ADR-0049). The key and trust store paths get this too, which they do not have today.
5. **Compatible:**
   - the keys keep their names;
   - **the files are read in this order, a later one winning** (owner, ZE A, 2026-11-16): `application-local.properties`, still read with a warning that it is deprecated; then `settings/emcc.properties`; then `settings/credentials/*.properties`. So the new files win over the deprecated one. **Environment variables and the command line win over all the files;**
   - an installation keeps working unchanged until its admin moves the values.

## Alternatives considered
- **YAML** (Spring reads `.yml`): it has comments and nesting, but whitespace mistakes break it silently, and nothing an admin edits today is YAML.
- **TOML, JSON5 or HOCON:** each needs a new parser and a licence check, for a gain that `.properties` already gives.
- **Commented JSON (JSONC) for everything:** the admin's settings are flat keys, which `.properties` fits. Spring's binding works on `.properties` without extra code.
- **Comments written into `data/ecore-config.json`:** emcc rewrites that file on every change from the Settings form, so the comments would be generated copies of the manifests' text. The form already shows that text.
- **Secrets in an encrypted file, or in the Windows credential store:** encryption needs a key, which needs a place too; the file's permissions are the standard protection, and environment variables cover external secret stores. It can come later.

## Consequences
- **CDA:**
  - reading `settings/emcc.properties` and `settings/credentials/*.properties`;
  - the permission check, with its warning in the log (no Monitor entry, ZE A);
  - `%emcc%/` in store paths;
  - JSON with comments for the labeling definitions;
  - the read order (point 5) and the deprecation warning for `application-local.properties`;
  - the comments in the bundled `application.properties`;
  - **a test that every key the code binds appears in the release's commented `emcc.properties`,** so that the file cannot drift from the code.
- **MCA:** the release's `settings/` layout, the commented `emcc.properties` with every key, the credentials templates and their permissions, and `start.bat` and `start.sh` without the `login` and `local` profiles and the `application-local.properties` check (`tools/release.mjs`).
- **PDA:** the rule that every setting and group has a title and a description; the template's manifest check.
- **PCAs:** titles and descriptions where a manifest lacks them, checked by the template's rule.
- **UDA:** the admin guide's chapter on the settings files.
- **ITA:** a release started with the new layout; the warning for a readable credentials file.
- **SRA:** the credentials' permissions and the check.
