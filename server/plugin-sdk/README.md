# Java Plugin SDK

Owned by the PDA. **The SDK as it is today: [the SDK reference](../../docs/plugins/reference/README.md)**, one page per concept; the Javadoc of every public type is the detail. [sdk-v1.md](../../docs/plugins/sdk-v1.md) and [sdk-v0.md](../../docs/plugins/sdk-v0.md) are its history.

**Status: 1.1.0, frozen by the owner on 2026-10-15 at `a78aa83`, after the ACA's review; on `main` since 2026-10-22 (`fac299b`, tag `contracts-1.1.0`, with M2)** (CR-0014, CR-0015, approved by the owner 2026-10-15). **1.2.0, frozen by the owner on 2026-10-27 at `8c58da2` (with CR-0026), after the ACA's review; on `main` since 2026-10-29 (`f83cd70`, tag `contracts-1.2.0`, with M3)** (CR-0025, approved by the owner 2026-10-22): `docs/plugins/sdk-v1.md`, "SDK 1.2.0". **1.3.0, frozen by the owner on 2026-10-31 at `461dd82`, after the ACA's review; on `main` since 2026-10-31 (`2a417da`, tag `contracts-1.3.0`, with M4)** (CR-0028, with CR-0023, approved by the owner 2026-10-30): `docs/plugins/sdk-v1.md`, "SDK 1.3.0". **1.9.0, frozen on 2026-11-18 at the merge of `pda/sdk-1.9-freeze-run` into `integration/sdk-v1.9` (from `237089b4`, sets 1 to 10; the run: owner ACH A); to `main` with M9 (tag `contracts-1.9.0`, MCA)** (part P: CR-0048, approved by the owner 2026-11-16, ZB A; PQ1 to PQ5 A; part U: CR-0050, approved 2026-11-16, ZL A, in it with the UAV track, ABO A) ("SDK 1.9.0" in `docs/plugins/sdk-v1.md`; the model's "Changes in 1.9.0"). **1.8.0, frozen on 2026-11-15 (owner XL A) at the merge of `pda/sdk-1.8-freeze-run` into `integration/sdk-v1.8` (from `f13baaa8`, with T-211); to `main` with M8 (tag `contracts-1.8.0`, MCA)** (CR-0043, approved by the owner 2026-11-13, UO A; with CR-0044 and CR-0047) ("SDK 1.8.0" in `docs/plugins/sdk-v1.md`; the model's "Changes in 1.8.0"). **1.7.0, frozen on 2026-11-12 at the merge of `pda/sdk-1.7` into `integration/sdk-v1.6` (from `30661b96`; its builders `cda/sdk-1.7` `5696e6de`, `pca-map-view-2d/m7` `4decd6d3` and `pca-gmti/m7` `086bf905` checked against it); to `main` with M7 (tag `contracts-1.7.0`, MCA)** (CR-0042, approved by the owner 2026-11-12, TC A; its version TD A) ("SDK 1.7.0" in `docs/plugins/sdk-v1.md`; the model's "Changes in 1.7.0"). **1.6.0, frozen on 2026-11-12 at the merge of `pda/sdk-1.6-freeze` into `integration/sdk-v1.6` (from `4c3de175`, after full runs 1 to 3 and the quick run m7q2 of parts A to H, with full run 4's plugin fixes `b7f9338a`); to `main` with M7 (tag `contracts-1.6.0`, MCA)** (CR-0041, approved by the owner 2026-11-11, RJ A; its version given 2026-11-12, RQ A) ("SDK 1.6.0" in `docs/plugins/sdk-v1.md`; the model's "Changes in 1.6.0"). **1.5.0, frozen by the owner on 2026-11-11 (Q51 A) at the merge of `pda/freeze-1.5.0` into `integration/sdk-v1.5` (from `7eae6708`, after the full run f23 of its five parts); to `main` with M6 (tag `contracts-1.5.0`, MCA)** (CR-0038, approved by the owner 2026-11-09, NB A and NC A; parts 2 to 5 with CR-0039, approved by the owner 2026-11-10, OB A and OC A). `docs/plugins/sdk-v1.md`, section "SDK 1.5.0". **1.4.0, frozen by the owner on 2026-11-09 at `49c91962` (MG), after the ACA's reviews of its parts; on `main` since 2026-11-10 (`0ce6728f`, tag `contracts-1.4.0`, with M5)** (CR-0030, approved by the owner 2026-11-05, and CR-0031, approved 2026-11-06; given its version on 2026-11-06 after part 1): `docs/plugins/sdk-v1.md`, "SDK 1.4.0". Changes only through a change request again. **1.0.0 is frozen** (2026-10-10, tag `contracts-1.0.0`): changes only through a change request (`CLAUDE.md` section 5); compatible additions are 1.x; no field or call may change its meaning in such a version; anything incompatible is 2.0.0. History: 0.1.0 (2026-10-06), 0.1.1 (CR-0005). 1.1.0 changes only the model types here (`Style`, CR-0014). The test kit has the same version; it is not part of the contract plugins compile against.

| Module | Artifact | Use |
|---|---|---|
| `api/` | `dev.emcc:emc2-plugin-sdk` | The only code a plugin's server part depends on (ADR-0003). Depends on JSpecify only |
| `testkit/` | `dev.emcc:emc2-plugin-sdk-testkit` | Test scope only: `FakePluginContext` and its fakes, `PluginRules` (ArchUnit), `ModelCodecContractTest` for ECore's JSON codec |
| `plugin-parent/` | `dev.emcc:emc2-plugin-parent` | The parent POM of a plugin's server part: the SDK, the test kit and every build plugin pinned; no parent of its own, so a plugin builds outside this repository |

Packages in `api/`:

| Package | Content |
|---|---|
| `dev.emcc.sdk` | `Plugin`, `PluginContext`, `PluginLog`, `Status`, `PluginState`, `Message`, `Bytes`, `Cancellable`, `User`, `Workspace`, `Permissions`, `Classifications`, `DataType`, `DeclaredField`, `FieldSet`, `RelationKind` |
| `dev.emcc.sdk.worker` | Workers, mailbox policies, `ask` with `Reply` |
| `dev.emcc.sdk.compute` | Compute tasks: a thread of ECore's for CPU-bound work |
| `dev.emcc.sdk.connection` | Connection tasks: the plugin's own sockets, TLS by a named credential |
| `dev.emcc.sdk.channel` | Output channels, their kinds and declared kinds, and their state |
| `dev.emcc.sdk.store` | The object store: change requests, queries and subscriptions |
| `dev.emcc.sdk.document`, `dev.emcc.sdk.folder` | Plugin documents; read-only local folders the manifest declares |
| `dev.emcc.sdk.stream` | Streams to the browser; conversions and encoders (ffmpeg, run by ECore) |
| `dev.emcc.sdk.topic`, `dev.emcc.sdk.timer` | Publish and subscribe; timers |
| `dev.emcc.sdk.http` | Outbound HTTP and plugin endpoints, both answered through messages |
| `dev.emcc.sdk.json` | Immutable JSON values with exact numbers (extensions, settings) |
| `dev.emcc.sdk.model` | The data model's types (`model/`) |
| `dev.emcc.sdk.geo` | Geodesic paths and legs on WGS84 |
| `dev.emcc.sdk.capability` | Optional capabilities, e.g. a workspace's own time |
| `dev.emcc.sdk.listener` | **Deprecated** since 1.2.0: use connection tasks |

A plugin's server part starts from the template, `plugins/_template/server` (design pattern: `docs/plugins/design-pattern.md`). Its `pom.xml` inherits `dev.emcc:emc2-plugin-parent` (`plugin-parent/`); before SDK 1.9.0 it inherited `server/pom.xml`, which manages the versions of the SDK (`provided`: ECore supplies it at runtime) and of the test kit (`test`). Its `ArchitectureTest` runs `PluginRules.checkPlugin(id)` with the id from `plugin.json`.

Build and test from `server/`: `mvn -pl plugin-sdk/api,plugin-sdk/testkit -am verify`.
