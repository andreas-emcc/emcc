# For agents

Instructions for an LLM agent that builds an emcc plugin with the SDK kit, outside the emcc repository. Follow them in order. Every rule you must keep has an id in [rules.md](reference/rules.md); cite it when you explain a choice.

## 1. Read, in this order

1. [README.md](reference/README.md): the map of this reference.
2. [rules.md](reference/rules.md): all of it. These rules are not optional.
3. [manifest.md](reference/manifest.md): every field of `plugin.json` and every settings hint.
4. The concept pages your plugin needs, and nothing else yet:

   | Your plugin… | Read |
   |---|---|
   | has a server part | [workers.md](reference/workers.md) |
   | creates or changes objects or layers | [objects.md](reference/objects.md), [permissions-and-labels.md](reference/permissions-and-labels.md) |
   | talks to another system (sockets, HTTP, local files) | [connections.md](reference/connections.md); for links and outputs also [channels.md](reference/channels.md) |
   | sends video or other streams to the browser | [streams.md](reference/streams.md) |
   | reports its state | [monitor.md](reference/monitor.md) (every plugin does) |
   | has settings | [settings.md](reference/settings.md) |
   | draws on the map or adds menu items | [map.md](reference/map.md), [actions.md](reference/actions.md) |
   | has panels or top-bar items | [panels-and-workspaces.md](reference/panels-and-workspaces.md) |
   | offers or uses web services, or depends on another plugin | [services-and-dependencies.md](reference/services-and-dependencies.md) |

5. [testing.md](reference/testing.md) and [build-and-install.md](reference/build-and-install.md).
6. The [cookbook](cookbook/README.md) recipes for what your plugin does: each puts the pages above together for one job, with a test.
7. The template's `README.md` (`plugins/_template/README.md` in the kit), then its code and tests: they are the working example of every rule.
8. The Javadoc and TSDoc of each SDK type you use. They are the detail; this reference is the summary.

Do not guess an API. If a method, parameter or limit is not in the Javadoc or TSDoc, it does not exist.

## 2. Start from the template

1. **Choose the id** (R1 to R3): a vendor prefix and a hyphen, then your name, lowercase: `acme-tracks`. Never `emc2-…` or `emcc-…`.
2. **Copy** the template folder to a folder named exactly the id. Delete what you do not need:
   - the server part (`server/`) or the web part (`web/`), and its `server` or `web` entry in `plugin.json`;
   - unless your plugin exchanges objects with another system over its own connections: the server part's `transport` package with its tests, the `links` setting and `connections` in `plugin.json`, and the lines in the entry class that start the link worker and subscribe it to the settings.
3. **Rename everywhere.** Search the copy for `template` and `Template` until nothing is left:

   | Where | Template | Your copy |
   |---|---|---|
   | `plugin.json` | `"id": "template"`, `"name"`, `server.entryClass`, `web.css: ["template.css"]` | your id, your name, your class, `["<id>.css"]` |
   | `server/pom.xml` | `<artifactId>emc2-plugin-template</artifactId>`, `<name>` | `emc2-plugin-<id>` |
   | Java packages (main and test) | `dev.emcc.plugins.template` | `dev.emcc.plugins.<id without hyphens>` (move the folders too) |
   | Entry class | `TemplatePlugin` | your class, named in `server.entryClass` |
   | `web/package.json` | `@emc2/plugin-template` | `@emc2/plugin-<id>` |
   | CSS | `src/template.css`, its import in `src/index.tsx`, `.template-…` classes | `src/<id>.css`, `.<id>-…` |
   | Panel id | `'template'` | your id, or `<id>-…` |

   Most forgotten renames fail a guard: `InstalledLayoutTest`, `ArchitectureTest` or the web part's tests (package name, CSS file). Forgotten CSS classes fail `checkLookCss` once you add it (section 3).
4. **Keep** the parent POM (`dev.emcc:emc2-plugin-parent`) and its `relativePath`. Outside the repository Maven does not find that path and takes the parent from your local Maven repository, where the SDK kit installs it.
5. **Point the web build at the kit's import map.** `web/vite.config.ts` reads the shell's import map from `../../../web/shell/dist/importmap.json`. Outside the repository, change that path to the import map the SDK kit ships.
6. **Keep the version in step:** `plugin.json`'s `version`, `server/pom.xml`'s `<version>` (as `-SNAPSHOT` while you work) and `web/package.json`'s `version`.
7. **Rewrite every text** the template's manifest and UI show, for your plugin (R68, R70, R74).
8. **Write the plugin's `README.md`** with these headings: What it does; Settings (name, default, meaning); Messages and services; Permissions and internet; Known limits.

## 3. The loop

For each acceptance criterion you were given:

1. **Write the test first**, named after the criterion, with `FakePluginContext` (Java) or `createFakeContext` (web). See [testing.md](reference/testing.md).
2. **Write the code** until the test passes. Declare in `plugin.json` everything the code uses: permissions, `internet`, `connections`, `compute`, `folders`, `dataTypes`, `fields`, `provides`, `requires`, `uses`, settings with defaults, titles and descriptions. Raise `sdkVersion` to the lowest SDK version whose additions you use (R48).
3. **Build and run all tests** (section 5). Never move on with a failing test.
4. **Run the guards**, which are part of the tests; never weaken or delete one:
   - `manifestProblem(manifest)`: `plugin.json` is valid against the manifest schema;
   - `settingsTextProblem(manifest.settings)`: every setting has a title and a description, every group a description;
   - `settingsHintsProblem(manifest.settings)`: every `x-emc2` hint is well formed;
   - `PluginRules.checkPlugin(id)` in `ArchitectureTest`: the Java rules marked *PluginRules* in rules.md;
   - `InstalledLayoutTest` and `InstalledPluginIT`: names, entry class, `sdkVersion` and the packaged jar;
   - `checkLookCss(css, { pluginId })`: your CSS takes its look from the tokens. The template's `web/test/css.test.ts` does it; keep it, with your id and CSS file.
5. **Read your diff against [rules.md](reference/rules.md)**, topic by topic, for what no guard checks: hosts from data, permissions on endpoints, labels, coordinates in longitude, latitude order, inline styles, texts.

## 4. Never

- Never create threads, executors, timers of your own or parallel streams; never lock, sleep or wait (R5 to R7). Use workers, connection tasks, compute tasks and the SDK's timers.
- Never open a socket outside a connection task (R13), and never use an HTTP client of your own (R52).
- Never read or write files yourself, not even through a library that takes a path (R59, R60).
- Never use Spring, ECore internals or another plugin's code (R44).
- Never take a host, port or multicast group from a browser request, a message or an object's data (R53).
- Never put a password, token or key in code, tests, the manifest or settings (R65, R66).
- Never change an object except through a change request (R20), and never write another plugin's namespace (R41).
- Never load anything from the internet in the browser (R51).
- Never use a literal colour, a fixed size or a font of your own in CSS or inline styles (R77).
- Never write emc2 in a text a user sees (R68), and never a task, change or decision id, or a version history (R74).
- Never edit a lock file by hand, and never pin a dependency loosely (R61).
- Never work around a missing SDK feature (R49): stop and report it.

## 5. Check the result

| Part | Command, in the plugin's folder | What it runs |
|---|---|---|
| Server | `mvn verify` in `server/` | compiles, the unit tests (`ArchitectureTest`, `InstalledLayoutTest`, your behaviour tests), packages the jar, then `InstalledPluginIT` on it |
| Web | `npm install` once, then `npm test` in `web/` | ESLint, `tsc --noEmit`, Vitest (the manifest guard and your tests) |
| Web build | `npm run build` in `web/` | `tsc --noEmit`, then the Vite build into `dist/`: `index.js`, `<id>.css` and the built `plugin.json` |

Install the SDK kit first, as its readme says. Then check:

- every command ends without errors or warnings you did not expect, and no test is skipped;
- every acceptance criterion has a test that names it (R87);
- `plugin.json` declares what the code does (section 3, step 2);
- `grep` finds no `template` and no user-visible `emc2` left in the copy.

How to install the built plugin is in [build-and-install.md](reference/build-and-install.md).

## 6. Report

End with a short report:

1. **What it does**, in two or three sentences.
2. **Files**: the plugin folder's tree, one line per file you wrote or changed.
3. **Acceptance criteria**: each with the test that covers it, and its result.
4. **Commands run** and their results: the number of tests passed, failed and skipped, per part.
5. **The manifest's declarations**: permissions, `internet` hosts and reason, `connections`, `compute`, `folders`, services provided, required and used, and the `sdkVersion`.
6. **Dependencies** you added: exact version and licence each (R61 to R64).
7. **Open points**: what does not work yet, what you could not test, what the SDK lacked, and any rule you could not keep and why. State failures plainly.

## Checklist

- [ ] Read README, rules, manifest, the needed concept pages, testing, the template's README
- [ ] Id with a vendor prefix; folder named exactly the id
- [ ] Every `template` renamed: id, artifact, packages, entry class, npm name, CSS file and classes, panel id
- [ ] Parts you do not need deleted, with their manifest entries
- [ ] Import map path set to the SDK kit's
- [ ] A test per acceptance criterion, written first
- [ ] Manifest declares permissions, hosts, connections, compute, folders, services, settings
- [ ] Every setting has a default, a title and a description; every group a description
- [ ] Guards kept and green: manifest guard, `ArchitectureTest`, `InstalledLayoutTest`, `InstalledPluginIT`, package-name test, `checkLookCss`
- [ ] `mvn verify`, `npm test` and `npm run build` pass
- [ ] Diff read against every topic of rules.md
- [ ] Plugin README written
- [ ] Report written, with open points stated plainly
