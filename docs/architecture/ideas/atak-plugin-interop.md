# Idea: ATAK plugins in emc2

- **Status:** Parked (owner, 2026-10-07). Resurrect after most or all milestones.
- **Author:** ACA. Research done on 2026-10-07.
- **Before resuming:** the facts below age quickly. Re-check the list in section 13 first.
- **Not a decision.** Nothing here is accepted. When the idea is resumed, it becomes ADRs, spikes and tasks through the normal process.
- **Renamed since (owner, 2026-10-11):** the CoT plugin is now one plugin, `cot`, ingoing in M1 and outgoing later. This answers the open question "One plugin or two" in section 6.3. Below:
  - read `cot-in` and `cot-out` as the two sides of `cot`, and PCA-`cot-in` and PCA-`cot-out` as PCA-cot;
  - "the `cot-in` extension" is the `cot` extension: one namespace for both directions, and the data type is `cot.cot`.

  Its brief is [`docs/plugins/briefs/cot.md`](../../plugins/briefs/cot.md).

## Contents

1. The idea
2. Verdict in short
3. What an ATAK plugin is, technically
4. Why a generic wrapper does not fit emc2
5. The TAK ecosystem, as far as it matters to us
6. The options
7. Draft mapping between CoT and the emc2 data model
8. Licences
9. Similar projects
10. Recommended plan when resumed
11. Keeping the door open meanwhile
12. Decisions needed from the owner when resumed
13. Re-check before resuming
14. How the research was done
15. Sources

---

## 1. The idea

The owner asked (2026-10-07): can ATAK plugins run in emc2? ATAK is a rich Android client and emc2 is web based, but both are Java. Could we wrap ATAK plugins, build a generic wrapper, or make a design rule for emc2 plugins based on ATAK plugins?

## 2. Verdict in short

- **An ATAK plugin cannot be lifted out of ATAK in a useful way.** It is an Android app that runs inside ATAK's process and calls ATAK's internal classes directly. "Both are Java" helps much less than it seems (sections 3 and 4).
- **What works instead:**
  - **ATAK in a box:** run the whole ATAK, with its plugins, in an Android emulator next to emc2 and show its screen in an emc2 panel (option 2).
  - **emc2 as a TAK participant:** exchange CoT with the TAK world without losing any plugin data. ATAK plugins on real devices then work *through* emc2 (option 3).
- **Where "both are Java" really pays off:** TAK Server plugins. They are plain Java 17 with a small API (option 4).
- **The design rule is worth having in any case:** model emc2's SDK extension points on ATAK's proven ones, so that porting an ATAK plugin, by hand or by an agent, becomes mechanical (option 5).
- **Nobody runs ATAK plugins outside ATAK** in any project found (section 9). Other web TAK clients either exchange CoT or rewrite the plugins.

| # | Option | Covers | Size | Verdict |
|---|---|---|---|---|
| 1 | Generic wrapper: rebuild Android and the ATAK API on a normal Java VM | A small subset of plugins | Open-ended, never finished | **No** |
| 2 | ATAK in a box: real ATAK in an Android emulator, streamed into an emc2 panel | Any plugin, unmodified | Spike-sized | **Spike it** |
| 3 | emc2 speaks TAK, losslessly | Every plugin that communicates through CoT | Mostly part of `cot-in` and `cot-out` | **Do it**, the foundation for the rest |
| 4 | TAK Server plugins | Server-side message plugins | Small | Only if a concrete need appears |
| 5 | Design rule: ATAK-style extension points in our SDK, plus porting | New emc2 plugins | Cheap | **Yes** |
| – | Reverse direction: emc2 web plugins inside ATAK | emc2 plugins on handhelds | Medium | Keep possible |

---

## 3. What an ATAK plugin is, technically

### 3.1 Structure

- **An Android app package (APK).** It is written in Java or Kotlin but compiled to Android bytecode (DEX) for the Android runtime (ART), not to normal Java bytecode.
- **Not a process of its own.** When installed, the plugin is a container that ATAK pulls into its own process. A special class loader joins the plugin's classes to ATAK's internal classes at run time. A plugin cannot run alone.
- **Entry points** are declared in `assets/plugin.xml`. The public examples declare a `transapps.maps.plugin.lifecycle.Lifecycle` (start-up and life cycle) and a `transapps.maps.plugin.tool.ToolDescriptor` (toolbar entry). The Android manifest carries `plugin-api` metadata, the ATAK API version the plugin was built for.
- **Typical classes:**
  - a `MapComponent` (the plugin's main component, created with ATAK's `MapView`);
  - `DropDownReceiver`s (the side panels);
  - broadcast receivers on ATAK's internal bus (`AtakBroadcast`);
  - `MapItem`s and `Marker`s on ATAK's map;
  - CoT handling (`CotMapComponent`, `CotEventDispatcher`, `CotEventListener`, `CommsMapComponent.sendCoT`);
  - OpenGL renderers for custom map graphics;
  - Android views from XML layouts for the user interface.
- **Two Android contexts:** the plugin context resolves the plugin's own resources; the map view's context is needed for dialogs and toasts. The HelloWorld README warns that mixing them up causes run-time errors.
- **Newer API (ATAK 4.5 and later, mainly 5.x):** platform-neutral interfaces in `gov.tak.api`, for example `gov.tak.api.plugin.IPlugin`, `IServiceController` and `IHostUIService` (`showPane()`). In ATAK, `IHostUIService.showPane()` is implemented by wrapping the pane in a drop-down receiver. The older `Lifecycle` path is deprecated for ATAK 4.5.1 and later.
- **No stable API:** the HelloWorld README says that private plugins "offer the most capability for utilizing the ATAK subsystem, but this interface will likely change from version to version". Plugins are built against one ATAK version.

### 3.2 Measured: the public HelloWorld example

ATAK-CIV's `plugin-examples/helloworld` (source version 4.6.0.5), measured on 2026-10-07 (method in section 14):

| Measure | Value |
|---|---|
| Distinct imports | 378 |
| … from ATAK (`com.atakmap.*`) | 237, spread over **90 packages** |
| … from Android (`android.*`, `androidx.*`) | 97 + 13 |
| Java lines | about 11,000 |
| Own Android components | one `Activity` (camera), one `Service` (notifications) |
| Files that create threads (`new Thread`) | 2 |
| Files that use `synchronized` | 5 |
| Files that register broadcast receivers | 9 |
| Files with OpenGL map renderers | 5 |
| Layout XML files | 13 |

The most used ATAK packages: `com.atakmap.android.maps` (26 imports), widgets, menus (radial menu), contacts, routes, import/export, OpenGL, coordinates, drop-downs, the overlay hierarchy and CoT details. HelloWorld is a kitchen-sink sample, so a real plugin uses less. But it shows how wide the surface is that a wrapper would have to rebuild.

### 3.3 Where the platform-neutral direction is going

- `takkernel` is TAK's shared Java and C++ code. Its README describes modules `engine` (map engine), `shared` (data models and logic for TAK Java applications), `port` (a "portability API to reduce platform specific dependencies") and `annotation`.
- It builds for two targets, `android` and **`java`** (property `kernelBuildTarget`). The `java` target is used by **TAKX**, the Linux desktop client (successor of WinTAK and RaptorX on several operating systems).
- The public 4.6 source has `gov.tak.api` packages for widgets, contacts, marshalling and graphics, but not yet the plugin interfaces. Those come with the 5.x SDK from tak.gov.
- **Meaning for us:** TAK is slowly making plugins less dependent on Android. A plugin that uses only `gov.tak.api` could in principle run on a non-Android host, which would make a real wrapper (option 1) thinkable. That is not the case today: real plugins use Android directly.

### 3.4 Distribution and signing

- ATAK-CIV's core is published by the TAK Product Center (TPC). The GitHub source (`deptofdefense/AndroidTacticalAssaultKit-CIV`) is GPL-3.0, stops at version 4.6.0.5, and the repository was archived on 2025-05-02. Current versions (5.4–5.6) come as binaries and SDKs from tak.gov and the Play Store.
- Plugins built with the SDK run on the SDK's developer build of ATAK. The released ATAK loads only plugins that went through TPC's build and signing pipeline ("TAK Autobuilder", the third-party pipeline). Plugin signing uses RSA keys and SHA1withRSA.
- Many plugins are not open source and are only available from tak.gov, after accepting the US government's terms.

---

## 4. Why a generic wrapper does not fit emc2

| Topic | ATAK plugin | emc2 | Consequence |
|---|---|---|---|
| Runtime | Android bytecode on ART, inside ATAK's process | Normal Java 25 VM, in-process plugins with our SDK | Bytecode conversion plus a rebuilt Android framework |
| API surface | Android framework plus ATAK internals (90 packages in HelloWorld) | Small SDK (workers, topics, timers, endpoints; web: panels, map view, live picture) | A wrapper means re-implementing a large part of ATAK and Android, chasing every ATAK version |
| Map | ATAK's own OpenGL map engine (C++ native code); plugins draw into it | OpenLayers in the browser (ADR-0009) | Custom map renderers cannot carry over |
| User interface | Android views and XML layouts, drop-down panels | React in the browser (ADR-0008) | Views would have to be rendered remotely or rewritten |
| Users | One device = one user: own position, preferences, files, screen | Server plugins are shared by all users; web parts run per user | Even a perfect wrapper needs one plugin instance per user |
| Concurrency | Free use of threads, handlers, `synchronized` | Rules C1–C8: no threads, locks or blocking in plugins (ADR-0004) | In-process hosting is ruled out; out of process at least |
| Trust | Third-party code of any origin | Plugins are trusted (ADR-0003) | Another reason to keep it out of our process |
| Licence | ATAK-CIV is GPL-3.0; plugins linking its SDK inherit GPL obligations (as atak-reactive states) | Apache 2.0; GPL not allowed in shipped code (ADR-0016) | ATAK classes cannot ship inside emc2 |
| Hardware | GPS, camera, USB and Bluetooth radios | Server and browser | Device features have no counterpart |

**Precedent:** the closest general "Wine for Android", the Android Translation Layer (GPL-3.0), implements the Android API on desktop Linux. It states that almost no app works yet.

---

## 5. The TAK ecosystem, as far as it matters to us

### 5.1 Clients

| Client | Platform | Plugins |
|---|---|---|
| ATAK (CIV, GOV, MIL) | Android | Java/Kotlin APKs (section 3) |
| WinTAK | Windows | .NET (C#) plugins, own SDK |
| iTAK | iOS | Limited |
| TAKX | Linux desktop | Built on `takkernel`'s Java target |
| WebTAK | Browser, served by TAK Server | – |
| CloudTAK (community) | Browser | Own TypeScript plugin API (section 9) |

All of them speak the same protocol (CoT) to the same servers or directly to each other.

### 5.2 TAK Server

- **Open source** on GitHub (`TAK-Product-Center/Server`), GPL-3.0. Version 5.7 merged in April 2026.
- **Stack:** Java 17, Gradle, PostgreSQL with PostGIS, close to ours. Microservices for configuration, messaging and API.
- **Plugins run in a separate process**, the plugin manager (`takserver-pm.jar`, a Spring Boot application). Plugin JARs go in `/opt/tak/lib`, their dependencies in `/opt/tak/lib/deps`, configuration YAML in `/opt/tak/conf/plugins` and logs in `takserver-plugins.log`.
- **Plugin API** (`src/takserver-plugins`, package `tak.server.plugins`, about 1,300 lines in all):
  - Base classes `MessageSenderBase`, `MessageReceiverBase`, `MessageSenderReceiverBase` and `MessageInterceptorBase`, all extending `PluginBase`. Fields are injected with Spring's `@Autowired`.
  - Life cycle: `start()`, `stop()`, `selfStop()`.
  - Messages: `onMessage(Message)`, `Message intercept(Message)`, `send(Message)` and `send(Message, feedUuid)`. An interceptor sees a message after TAK Server receives it and before it is sent on, and may change it.
  - `Message` is protobuf `atakmap.commoncommo.protobuf.v1.Message`: a `TakMessage` (with the `CotEvent`) plus `source`, `clientId`, `groups`, `destClientUids`, `destCallsigns`, `provenance`, `archive`, `feedUuid`, `connectionId` and binary payloads. A converter turns CoT XML into this format (`getConverter().cotStringToDataMessage()`).
  - Optional services: `PluginMissionApi` (missions: read, create, delete, content, keywords, hierarchy, feeds, map layers), `PluginFileApi` (files by hash), `PluginDataFeedApi` (data feeds), `PluginCoreConfigApi`, `SystemInfoApi`.
  - Annotations `@TakServerPlugin(name, description)` and `@TakServerPluginVersion`.
- **Default ports** in `CoreConfig.example.xml`:

  | Port | Use |
  |---|---|
  | 8089 | CoT streaming over TLS (client certificates) |
  | 8090 | QUIC |
  | 8087, 8088 | TCP, UDP and streaming TCP without TLS (commented out by default) |
  | 239.2.3.1:6969 | Mesh SA multicast (proxy, commented out) |
  | 224.10.10.1:17012 | GeoChat multicast (proxy, commented out) |
  | 8443 | HTTPS API (client certificates) |
  | 8446 | HTTPS with password login, certificate enrollment |
  | 8444 | Federation HTTPS |
  | 9000 | Federation v1 (disabled by default) |
  | 9001 | **Federation v2 over gRPC** (enabled by default) |

- **Federation v2** is a gRPC service `FederatedChannel` (`fig.proto`, package `com.atakmap`), with event streams in both directions, binary blobs, group exchange and health checks. A gRPC federate is a clean, typed way for a server like emc2 to join a TAK federation.
- **Missions (DataSync):** named, subscribable collections of CoT items, files and map layers with change logs. Close to an emc2 layer.

### 5.3 Protocol

- **CoT (Cursor on Target):** an XML `<event>` with `uid`, `type`, `how`, `time`, `start`, `stale`, `access`, `qos` and `opex`, a `<point lat lon hae ce le>` and a free `<detail>`.
- **TAK Protocol v0** is plain XML. **v1** is protobuf (`TakMessage`):
  - Mesh (UDP) frames start with the static header `191 1 191`.
  - Stream (TCP/TLS) frames start with `191`, then a varint length, then the payload.
- **Mesh SA:** UDP multicast, 239.2.3.1:6969 by default. No server needed.
- **Security fields:** `CotEvent` has `access` (required in MIL-STD-6090), `caveat` and `releaseableTo`.
- **Detail in protobuf** (`detail.proto`): typed fields for `contact`, `__group`, `precisionlocation`, `status`, `takv` and `track`. **Everything else stays as raw XML text in `xmlDetail`**, and whole elements are never split. TAK itself treats unknown detail as opaque text, which supports option 3's approach.
- **Units:** `track` has `speed` (metres per second) and `course` (degrees from true north). `hae` is height above the ellipsoid.
- **Data packages:** ZIP files with a manifest (`MANIFEST/manifest.xml`), used to move files, overlays and CoT between clients.

---

## 6. The options

### 6.1 Option 1: generic wrapper (rejected)

**How it would be built:**
1. Convert the plugin's Android bytecode to Java bytecode (for example with dex2jar).
2. Provide the Android framework on a normal Java VM. Robolectric does this for tests: AOSP's framework built for the JVM ("android-all", Apache 2.0) plus "shadows" (MIT). Robolectric's native graphics mode, used by Roborazzi, and Android's `layoutlib`, used by Paparazzi, can render Android views to images without a device.
3. Write an ATAK facade: `MapView`, `MapGroup`, `MapItem`, `Marker`, CoT dispatchers, drop-downs, the broadcast bus and preferences, backed by emc2's object store and SDK.
4. Render the plugin's views to images, stream them to the browser and send clicks back.
5. Run it all out of process, one instance per user.

**Why rejected:**
- An open-ended compatibility project, like Wine, that never covers more than simple plugins.
- It has to follow every ATAK version.
- Custom OpenGL renderers and native code cannot work.
- ATAK's API classes are GPL-3.0.
- One instance per user anyway.
- Option 2 gets full compatibility for much less work.

**Revisit only if** TAK's platform-neutral plugin API (`gov.tak.api`, section 3.3) becomes what plugins really use, and is published under usable terms.

### 6.2 Option 2: ATAK in a box (spike candidate)

Run the real ATAK, unmodified, with its plugins, in an Android emulator in a container. Show its screen in an emc2 panel, and connect it to emc2 with CoT.

```
+------------------------------- browser -------------------------------+
|  emc2 shell: map, layer panel, other panels    |  atak-console panel  |
|                                                |  (WebRTC stream)     |
+---------------------+--------------------------+----------+-----------+
                      | WebSocket (live picture)            | WebRTC: video, touch, keys, GPS
                      v                                     v
+------------- emc2 server --------------+   +--- Android emulator container ---+
| ECore, object store                    |   | ATAK (CIV) + ATAK plugins        |
| cot-in / cot-out plugins <-------------+---+--> CoT (mesh SA or TAK stream)   |
+----------------------------------------+   +----------------------------------+
                      ^
                      | CoT stream (TLS 8089) or federation (gRPC 9001)
+------- TAK Server (external, optional) -------+ <---> real ATAK / WinTAK / iTAK devices
|  runs TAK Server plugins unmodified           |
+-----------------------------------------------+
```

**Building blocks:**
- **Android in a container:**
  - Google's official Android emulator with its container scripts, which stream to the browser over WebRTC through a gRPC endpoint and an Envoy proxy. They include a React component (`android-emulator-webrtc`), the same stack as our shell, and can set the emulator's GPS position.
  - Alternatives: **redroid** (Android in a Linux container, no KVM needed, with GPU support) with **ws-scrcpy** (H.264 to the browser), or **Cuttlefish** (Google's cloud Android device, with WebRTC streaming built in).
- **The emc2 side:** a plugin `atak-console`, with a web panel that shows the stream and passes input back. Two tricks:
  - **Crop the stream to ATAK's side panel**, so the user sees only the plugin's own interface next to emc2's map, while the plugin's map items arrive in emc2 over CoT.
  - **Set the emulator's GPS position**, to place the virtual ATAK user anywhere, for example where the emc2 user clicks.
- **The CoT link:** mesh SA multicast inside the container network, or a TAK Server between the two. Either way, emc2's `cot-in` and `cot-out` do the work (option 3).

**Variants:**

| Variant | Description | Cost | Value |
|---|---|---|---|
| Per user | Every emc2 user can open their own ATAK | One emulator per user: an estimated few GB of memory and a couple of CPU cores each, a GPU preferably | "Any ATAK plugin inside emc2" for each user |
| **Shared gateway** | One ATAK instance on the server whose data plugins feed emc2 over CoT. An admin configures it through the stream | One emulator in all | Vendors of drones, sensors and radios often ship their integration as an ATAK plugin first, so their whole ecosystem becomes an emc2 input. **Probably the most valuable variant** |
| Test harness | ATAK in a container as an integration-test peer for `cot-in` and `cot-out` (ITA) | Only for tests | Tests against a real TAK client instead of a simulator |
| Virtual operator | An ATAK instance that appears in emc2 as a unit with a position and a callsign, driven by an emc2 user | As per user | Demo effect: a field user inside the C2 picture |

**Risks to settle in the spike:**
- **OpenGL:** ATAK's map needs OpenGL ES. Software rendering is slow; ATAK has a known workaround (a file `/sdcard/atak/opengl.broken`, or the system property `USE_GENERIC_EGL_CONFIG`). A GPU host is better, which fits ADR-0017.
- **Processor architecture:** plugins with native code may be built for ARM only, while x86 emulators need x86 builds. Alternatives are an ARM host (redroid runs natively on ARM servers) or translation layers, which are mostly proprietary.
- **Signing:** use the SDK's developer build of ATAK with self-built plugins, or the released ATAK with TPC-signed plugins (section 3.4). Both have distribution terms.
- **Hardware:** USB and Bluetooth radios in a container need passthrough. Plugins that talk over IP (for example MAVLink to drones) are easy.
- **Internet:** some plugins call internet services. ADR-0030 (which superseded ADR-0014) requires every function of emc2 to have a way to work offline, so pick plugins that work offline or have an on-premises server, or leave the box out of a disconnected installation.
- **Our Content Security Policy** is `'self'` (overview 4.5). The stream must be proxied through emc2's edge, or the policy must allow the stream's origin. That is a CDA decision.
- **Host operating system:** redroid and Cuttlefish need Linux, while the official emulator also runs on Windows. Our rule "the server runs on Windows and Linux" applies to emc2's server; the box is an optional external component.
- **Resource use** per instance, and stream latency.

### 6.3 Option 3: emc2 as a TAK participant (the foundation)

emc2 exchanges CoT with the TAK world without losing anything. Most of this is the job of `cot-in` (M1) and `cot-out` (later) anyway.

**The key point:** ATAK plugins talk to each other through their own elements inside a CoT message's `<detail>`. If `cot-in` keeps the whole `<detail>` unchanged in its own extension namespace, emc2's existing rules carry it through untouched:
- ADR-0007: other plugins' extension data is forwarded untouched.
- ADR-0018: an update changes only the requesting plugin's own namespace. When an emc2 user moves an object, its `cot-in` data stays as it was.

`cot-out` then sends the object back out with the new position and the original `<detail>`. Plugin X on device A sends through emc2 to device B and still works there. For a C2 system, this is the kind of "running ATAK plugins" that matters.

**Acceptance test:** a plugin's private `<detail>` element survives the round trip ATAK → emc2 (stored, shown, possibly moved by a user) → ATAK.

**Our data model already fits CoT well** (mapping in section 7):
- altitude is height above the ellipsoid in both;
- `track` speed and course have the same units as our `speed` and `direction` modifiers;
- CoT atom types follow MIL-STD-2525B, close to APP-6B, which we support;
- `meta.externalRef` exists for exactly this purpose ("e.g. a CoT uid");
- `meta.created.by.system` carries the external system (for example `tak:server-1`).

**Connection choices:**
- Mesh SA (UDP multicast), with no server.
- A TAK Server stream client (TLS 8089 with client certificates): emc2 connects like a TAK client.
- **Federation v2 (gRPC 9001):** emc2 joins as a federated server. It is typed, server-to-server, and has group exchange.

**Open design questions** (for a future ADR "CoT interoperability"):
- **Authority:** can emc2 users edit objects that come from TAK? If yes, should `cot-out` send the change back? The next CoT update from the source overwrites it anyway (last write wins). Alternatively such objects could be read-only in emc2.
- **Expiry:** CoT's `stale`. The model has no time attributes yet ("Deferred" in `model/README.md`: in the `cot-in` extension until M1). Should `cot-in` delete stale objects, mark them, or should the model get expiry?
- **Labels:** map CoT `access`, `caveat` and `releaseableTo` to and from our STANAG 4774 labels (ADR-0020). Use the default label when they are missing. Map TAK groups too, or not?
- **Layers:** which layer do CoT objects go into: one per connection, per TAK group, or per mission? Should layers be mapped to missions both ways?
- **Symbol mapping:** CoT atom type ↔ APP-6B is close to direct. APP-6D and APP-6E ↔ CoT type loses information. Check whether newer ATAK versions carry 2525D/E codes in their own detail element, and use them if so.
- **Shapes:** ATAK drawings (`u-d-*` types with `<link point>` vertices) become our geometries. Our edges are geodesic (ADR-0019); check how ATAK interprets edges. The difference is small for small shapes.
- **Echo and loops:** `cot-in` must not take back what `cot-out` just sent. Use the uid and source, or TAK's `provenance`.
- **One plugin or two:** `cot-in` and `cot-out` as planned, or one `cot` plugin? One plugin would own the CoT data namespace for both directions.
- **XML or protobuf:** XML needs no extra licence. Generating code from TAK's `.proto` files needs a licence check, since they are part of GPL sources (section 8).

### 6.4 Option 4: TAK Server plugins

- TAK Server plugins are plain Java 17. They are the one place where "both are Java" really helps.
- **Simplest route:** put a real TAK Server between emc2 and the TAK world. Our requirements already treat TAK systems as external, set up by separate projects. Its plugins then run unchanged in TAK Server's own plugin manager, and their effect reaches emc2 over CoT.
- **Our own host,** only if we ever need a TAK Server plugin without a TAK Server:
  - A separate program implementing the small API in section 5.2 (life cycle, `onMessage`, `intercept`, `send`), backed by emc2.
  - It would include TAK's GPL plugin API, so it must be a separate program under GPL. It would connect to emc2 through the out-of-process stub that overview 4.1 and ADR-0003 already plan for.
  - The mission, file and data feed services would map onto emc2 layers, a file store and topics, or stay unsupported.
  - Base classes injected by Spring and plugins that create their own threads are fine there, because the program is not an emc2 plugin and our rules C1–C8 do not apply to it.

### 6.5 Option 5: design rule and porting

**Use ATAK's proven extension points as the vocabulary of emc2's SDK v1:**

| ATAK | emc2 today | Proposal |
|---|---|---|
| Drop-down panel (`DropDownReceiver`, `IHostUIService.showPane`) | Control panel (`ui.addControlPanel`) | Exists |
| Toolbar tool (`ToolDescriptor`) | Control panel entry | Exists, roughly |
| Map widgets and overlays | `ui.addMapPaneOverlay`, `MapView.createOverlay` | Exists |
| Map click tools | `MapView.pickPoint`, `onPointer` | Exists |
| Radial menu on a map item | – | **Add:** object actions contributed by plugins |
| CoT detail handlers (`CotDetailHandler`, per detail element) | Extension namespace per plugin (data only) | **Add:** views that show and edit a plugin's own extension data in an object's details |
| Overlay Manager (hierarchy) | `layer-panel` plugin | **Add:** plugin entries in the layer tree |
| Import and export (`importexport`, data packages) | – | **Add:** import and export handlers per file type |
| Preferences | Settings (planned for SDK v1) | Planned |
| Contacts and chat | – | Only if the requirements ask for them |

With these in place, an ATAK plugin's concepts map one-to-one onto emc2's, and porting becomes mechanical. They are useful for emc2 on their own merit too.

**Porting guide:** a concept table (as above, extended with the server side: `MapComponent` → plugin and workers, `AtakBroadcast` → topics, `CotEventListener` → subscription to `cot-in` events, `MapItem` → map object with an extension). It would live in `docs/plugins/` (PDA).

**Porting by agents** (a showcase for this project): a plugin agent ports an open-source ATAK plugin into an emc2 plugin, with a server part in Java and a web part in React.
- **Licence guardrail:** porting GPL code makes the port GPL, which conflicts with emc2's Apache 2.0. Only port plugins under compatible licences, or:
- **Clean-room porting with two agents:** a specification agent reads the plugin and writes a behaviour specification without any code. A plugin agent that never sees the source implements from that specification. Get a legal view first.
- **Candidates:** open-source plugins whose function makes sense without phone hardware and without internet access. Choose them when the idea is resumed.

### 6.6 Reverse direction: emc2 web plugins inside ATAK

- ATAK plugins can already show React screens inside ATAK. **atak-reactive** does it with a WebView and a JavaScript-to-Java bridge, with React hooks such as `useMapItems`, `useCotStream` and `useRadialMenu`, and functions such as `addMarker` and `sendCot`. Its bridge is GPL-3.0; its TypeScript SDK and command-line tool are MIT. It is a very small project (2 stars).
- **Idea:** a host plugin inside ATAK that implements emc2's web SDK (`PluginContext`, `MapView`, `LivePicture`, `Changes`, services) on ATAK's map items and CoT. Then emc2 web plugins run on handhelds as well: write once, run in emc2 and in ATAK.
- **Cheap design rule to adopt now:** keep emc2's web SDK independent of its host. Plugins get everything through `PluginContext` and services, and never assume the shell's DOM, global objects or server URLs beyond their mount points. A second host (an ATAK WebView, a desktop wrapper, a tablet) then stays possible.

---

## 7. Draft mapping between CoT and the emc2 data model

A starting point for the ADR. To be verified against the CoT schema and real ATAK traffic.

| CoT | emc2 | Notes |
|---|---|---|
| `event/@uid` | `meta.externalRef` `{system: "tak:<source>", id: uid}` | Repeated updates modify the same object (existing purpose of `externalRef`) |
| `event/@type`, atoms `a-…` (for example `a-f-G-U-C-I`) | `symbol`: APP-6B SIDC (for example `SFGPUCI-----` plus country and order-of-battle positions, 15 characters) | Affiliation, battle dimension and function follow 2525B. Keep the original type in the `cot-in` extension |
| `event/@type`, drawings `u-d-…` | `core.shape` with Polygon, LineString, Circle, … | Verify the drawing types and their `<link point>` vertices |
| `event/@type`, other (`b-…` bits such as chat and waypoints, `t-…` tasking) | Not objects, or plugin-specific | Decide per type |
| `event/@how` | `cot-in` extension | For example `h-e` (entered by a person), `m-g` (machine, GPS) |
| `event/@time`, `@start` | `meta` and `cot-in` extension | |
| `event/@stale` | `cot-in` extension until time attributes exist | Open question: delete or mark stale objects |
| `event/@access`, `caveat`, `releaseableTo` | Security label (classification, categories) | Needs a mapping policy; the default label when missing (ADR-0007, ADR-0020) |
| `event/@qos`, `@opex` | `cot-in` extension | |
| `point/@lat`, `@lon` | Point `[lon, lat]` | Named attributes in CoT, so no order confusion. Test with latitude ≠ longitude (CLAUDE.md) |
| `point/@hae` | Altitude (HAE) | Leave the altitude out when CoT marks it unknown with its sentinel value |
| `point/@ce`, `@le` | `cot-in` extension | Accuracy; could become a core field later |
| `detail/contact/@callsign` | `properties.name` | |
| `detail/remarks` | `properties.description` | |
| `detail/track/@course`, `@speed` | Modifiers `direction` (degrees from true north) and `speed` (m/s) | Same units |
| `detail/__group` (team colour, role) | `cot-in` extension | |
| `detail/link` | `cot-in` extension | Relations later |
| `detail/usericon`, `color` | `style` where it fits, otherwise the extension | |
| **All other detail elements** | **`cot-in` extension, as raw XML text** | Lossless and unchanged, like TAK's own `xmlDetail`. This is what makes ATAK plugins work through emc2 |

---

## 8. Licences

| Component | Licence | Under ADR-0016 |
|---|---|---|
| ATAK-CIV source (GitHub) | GPL-3.0, with extra permissions for linking listed third-party libraries | Not allowed in shipped code |
| ATAK binaries, SDK and plugins from tak.gov or the Play Store | Their own terms; **check** | – |
| Plugins that link the ATAK SDK | Inherit GPL-3.0 obligations (as atak-reactive states) | Do not port their code into emc2 |
| TAK Server, including its plugin API and `.proto` files | GPL-3.0 | External only. **Check** before generating code from the `.proto` files |
| CloudTAK | AGPL-3.0 | Reference only |
| GoATAK | AGPL-3.0 | Reference only |
| FreeTAKServer | EPL-2.0 | Allowed (on the list) |
| atak-reactive | Bridge GPL-3.0; TypeScript SDK and CLI MIT | MIT parts allowed |
| Android Translation Layer | GPL-3.0 | – |
| Robolectric | MIT; its Android framework jars come from AOSP (Apache 2.0) | Allowed, for tests |
| Android emulator and AOSP system images | Mostly Apache 2.0; images with Google Play have Google's terms | External component; **check** |
| redroid, ws-scrcpy, Cuttlefish | Not checked | **Check** when resumed |

**Rule of thumb:** everything GPL or AGPL stays a separate, external system that talks to emc2 over a network protocol, like the TAK systems in `requirements.md`. Shipping any of it with emc2 needs a change request under ADR-0016, and a legal view.

---

## 9. Similar projects

| Project | What it is | Relevance |
|---|---|---|
| **CloudTAK** (dfpc-coe, AGPL-3.0) | Browser TAK client and common operational picture (TypeScript, Vue, MapLibre, Node). ETL to bring non-TAK data into TAK | Closest to emc2. **Does not run ATAK plugins.** Has its own plugin API: plugins are compiled into the bundle and implement `install()`, `enable()` and `disable()` |
| **GoATAK** (kdudkov, AGPL-3.0) | TAK server and web client in Go. CoT XML and protobuf, TLS, data packages, DataSync. Web map with Leaflet and milsymbol | Uses the same symbol library as we do. No plugins |
| **WebTAK** (part of TAK Server) | TAK Server's browser client | Reference for a web TAK client |
| **FreeTAKServer** (EPL-2.0), **OpenTAKServer** | Open TAK servers in Python | Test peers; FreeTAKServer's licence is on our list |
| **atak-reactive** | React user interfaces inside ATAK plugins through a WebView bridge | Basis for the reverse direction (section 6.6) |
| **Android Translation Layer** | "Wine for Android" on Linux | Shows how hard option 1 is |
| **Google's android-emulator-container-scripts**, **Cuttlefish**, **redroid + ws-scrcpy** | Android in containers, streamed to browsers | Building blocks for option 2 |
| **node-tak**, **PyTAK**, **takproto** | Libraries for TAK connections and the TAK protocol | References for `cot-in` and `cot-out`; check licences before use |
| **WinTAK** | Windows TAK client with .NET plugins | Shows that even TPC's own clients do not share plugin binaries |

**Pattern:** every web or desktop TAK client found either exchanges CoT with ATAK or re-implements the functions. None hosts ATAK plugins.

---

## 10. Recommended plan when resumed

| Stage | What | Who | Result |
|---|---|---|---|
| 0 | Re-check the facts (section 13). Owner decisions (section 12) | ACA, owner | Go or no go, and the scope |
| 1 | ADR "CoT interoperability": lossless `<detail>`, the mapping (section 7), the open questions in 6.3 | ACA (owner approves) | Accepted ADR |
| 2 | Bring `cot-in` and `cot-out` up to the ADR; contract details in `model/` and `docs/plugins/` | PDA, PCA-`cot-in`, PCA-`cot-out` | The round-trip acceptance test passes |
| 3 | Spike "ATAK in a box" (below) | A spike agent (CDA or a dedicated one) | Spike report; ADR if adopted |
| 4 | SDK extension points in the style of ATAK (6.5), if not already in SDK v1 | PDA | SDK minor version |
| 5 | `atak-console` plugin (stream panel, cropping, GPS) and the gateway set-up | PCA-`atak-console`, CDA (Content Security Policy, proxy) | Demo |
| 6 | Optional: porting demo by agents, clean-room if the licence requires it | PCA, plus a specification agent | Ported plugin |
| 7 | Optional: TAK Server plugin host, or federation v2 as a federate | CDA or a PCA | Only on demand |

**The spike "ATAK in a box":**
- **Question:** can an unmodified ATAK with one plugin run in a container on a Linux host, be used from an emc2 browser panel, and share the live picture with emc2 over CoT?
- **Set-up:**
  - a Linux host with KVM, and a GPU if possible;
  - the Android emulator with Google's container scripts, or redroid;
  - the developer build of ATAK from the SDK, with HelloWorld built by us, plus one third-party plugin that talks over IP;
  - a CoT link by mesh SA in the container network, or through a TAK Server;
  - emc2 with `cot-in` (M1).
- **Measure:** start-up time; memory and CPU per instance; frame rate and latency with and without a GPU; how usable input is through the panel; CoT round-trip time.
- **Success criteria:**
  1. The plugin's interface is usable from an emc2 panel.
  2. A marker created in ATAK appears in emc2 within about two seconds.
  3. An object drawn in emc2 appears in ATAK.
  4. A plugin's private `<detail>` element survives ATAK → emc2 → ATAK, also after an emc2 user moves the object.
  5. Everything works without internet access.
- **Time box:** a few days of agent time.

---

## 11. Keeping the door open meanwhile

Cheap things that keep this idea possible without adding scope to the milestones:

1. **`cot-in` (M1) stores everything it does not map in its own extension, unchanged**, ideally the remaining `<detail>` as raw XML text. It uses `meta.externalRef` for the CoT uid and records the TAK source as `system`. (Brief: PDA and PCA-`cot-in`.)
2. **Time attributes** (deferred to M1 with `cot-in`): when designed, cover CoT's `time`, `start` and `stale`.
3. **SDK v1:** consider object actions and views of a plugin's extension data (6.5). They are useful for emc2 anyway.
4. **Keep the web SDK independent of its host** (6.6).
5. **ITA:** a real ATAK in an emulator, or a CoT simulator, is a good test peer for `cot-in`.

---

## 12. Decisions needed from the owner when resumed

1. **Goal:**
   - (a) a demo of "any ATAK plugin inside emc2" (option 2);
   - (b) real interoperability with TAK units (option 3);
   - (c) faster plugin development (option 5);
   - or a combination.
2. **Scope:** `requirements.md` treats TAK systems as external. ATAK in a box makes ATAK part of the demo environment, though not of the product. A requirements change?
3. **GPL:** may GPL and AGPL programs (ATAK-CIV, TAK Server) run next to emc2 as separate systems? Shipping them with emc2 needs a change request and a legal view.
4. **Host:** is a Linux host, ideally with a GPU, acceptable for the box?
5. **Editing:** may emc2 users edit objects that come from TAK (6.3, authority)?
6. **Porting:** is clean-room porting by two agents acceptable in principle?

---

## 13. Re-check before resuming

- ATAK's current version, and whether the `gov.tak.api` plugin interfaces are mature, public and used by real plugins (section 3.3). Whether the ATAK source is published again (the GitHub repository was archived in May 2025, at 4.6).
- The licence terms of the tak.gov SDK and the current plugin signing rules.
- TAK Server's version, plugin API, ports and federation v2.
- Whether CloudTAK, GoATAK or a new project now hosts ATAK plugins.
- The state of Google's emulator container scripts, redroid, Cuttlefish and the Android Translation Layer.
- atak-reactive's state and licence.
- emc2 itself: did SDK v1 get the extension points in 6.5? Does `cot-in` keep `<detail>` unchanged? What came of the time attributes?

---

## 14. How the research was done

1. Web searches on 2026-10-07 for ATAK plugin architecture, wrappers, TAK Server plugins, web TAK clients, Android in containers, Android on the JVM and the TAK protocol (sources in section 15).
2. Partial clones into a scratch folder:

   ```
   git clone --depth 1 --filter=blob:none --sparse https://github.com/deptofdefense/AndroidTacticalAssaultKit-CIV.git atak-civ
   git -C atak-civ sparse-checkout set takkernel/port takkernel/shared/src plugin-examples/helloworld plugin-examples/plugintemplate
   git clone --depth 1 --filter=blob:none --no-checkout https://github.com/TAK-Product-Center/Server.git takserver
   ```

3. HelloWorld measurement (in `plugin-examples/helloworld`):

   ```
   grep -rh "^import " app/src/main/java | sed 's/^import static /import /; s/^import //; s/;.*//' | sort -u | wc -l
   grep -rh '^import com.atakmap' app/src/main/java | sed 's/^import //; s/\.[A-Z].*//' | sort -u | wc -l
   grep -rl "new Thread" app/src/main/java | wc -l     # likewise: synchronized, registerReceiver, GLMapView
   ```

4. TAK Server facts were read from `src/takserver-plugins/src/main/java/tak/server/plugins/`, `src/takserver-protobuf/src/main/proto/` (`message`, `takmessage`, `cotevent`, `detail`, `track`, `fig`) and `src/takserver-core/example/CoreConfig.example.xml`.

**Not verified:** the resource use per emulator instance (an estimate); the licences of redroid, ws-scrcpy and Cuttlefish; the exact `u-d-*` drawing types; whether ATAK 5.x carries 2525D/E codes in its own detail element; the terms of the tak.gov SDK.

---

## 15. Sources

**ATAK:**
- ATAK-CIV source, GPL-3.0, archived 2025: <https://github.com/deptofdefense/AndroidTacticalAssaultKit-CIV>
- ATAK README (signing, emulator): <https://github.com/deptofdefense/AndroidTacticalAssaultKit-CIV/blob/4.5.1.13/atak/README.md>
- `takkernel`: <https://github.com/deptofdefense/AndroidTacticalAssaultKit-CIV/tree/main/takkernel>
- ATAK plugins with SDK 5.5 (RIIS): <https://www.riis.com/blog/plugins-with-atak-civ-sdk-5-5>
- ATAK and WinTAK plugin engineering: <https://corvusintell.com/blog/field-apps/atak-wintak-plugin-engineering/>
- Open-source TAK ecosystem: <https://corvusintell.com/blog/field-apps/open-source-tak-ecosystem-guide/>
- Android Team Awareness Kit (Wikipedia): <https://en.wikipedia.org/wiki/Android_Team_Awareness_Kit>

**TAK Server:**
- TAK Server source, GPL-3.0: <https://github.com/TAK-Product-Center/Server>
- TAK Server plugin SDK notes: <https://github.com/tobias-nix/tak-server-sdk-master>
- TAK Server plugin loading: <https://dev.to/tobiasnix/tak-server-plugin-smackxml-and-plugin-loader-errors-3m3g>

**TAK protocol:**
- TAK protocol description: <https://takproto.readthedocs.io/en/latest/tak_protocols/>

**Web TAK clients and servers:**
- CloudTAK: <https://github.com/dfpc-coe/CloudTAK>
- CloudTAK plugin documentation: <https://docs.cloudtak.io/plugin/>
- GoATAK: <https://github.com/kdudkov/goatak>
- FreeTAKServer: <https://github.com/freetakteam/freetakserver>

**React inside ATAK:**
- atak-reactive: <https://github.com/rixau/atak-reactive>
- `IHostUIService` note: <https://github.com/rixau/atak-reactive/issues/87>

**Android outside a device:**
- Android Translation Layer: <https://nlnet.nl/project/ATL/>
- Roborazzi (Robolectric native graphics): <https://github.com/takahirom/roborazzi/>
- Android cloud emulator: <https://source.android.com/docs/automotive/start/avd/cloud_emulator>
- Cuttlefish WebRTC streaming: <https://source.android.com/docs/devices/cuttlefish/webrtc>
- redroid + ws-scrcpy: <https://github.com/x1nx3r/redroid-ws-scrcpy>
- docker-android: <https://github.com/budtmo/docker-android>
