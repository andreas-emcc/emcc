# ADR-0036: Connection tasks: plugins open their own sockets inside ECore tasks

- Status: Accepted (owner, 2026-10-22); decision 2 amended in place by the owner on 2026-10-28 (CR-0027). **Amended by CR-0052** (owner, AAH A, 2026-11-17), after the owner's AAA A: point 7's first sentence and a new paragraph say that a connection's destination, set by an admin, is covered by the declared connection, not by `internet`
- Date: 2026-10-22
- Deciders: Owner (advised by the ACA; the owner's answers Q1, Q2, A4 and A5 in `docs/architecture/m3-simulator-decisions.md`)
- Extends: ADR-0004 (concurrency through core-managed workers and messages) and ADR-0030 (everything works offline; settings may point to any host)

## Context
M3 builds a simulator whose tracks leave emc2 through plugins, and a `cot` plugin that sends as well as receives (owner, 2026-10-22). The owner wants nothing in emc2 to stop a plugin from receiving or sending data in any of eight ways: as a UDP, multicast, TCP server or TCP client consumer, and as a UDP, multicast, TCP server or TCP client provider. More protocols will follow (ADatP-36, AIS, ADS-B), some from plugins written by third parties.

Today ECore opens every socket a plugin uses. A plugin asks for a **listener** (SDK v1, CR-0010): ECore connects as a TCP or TLS client to an endpoint that the plugin's settings name (the manifest's `network.endpoints`), and runs the plugin's loop on a virtual thread with the connection's streams. Rule C6 (overview 4.2, normative) says that plugins do no networking of their own. Only `cot` uses listeners. They cover one of the eight ways; a worker cannot write on a connection, and nothing can listen.

The owner decided that **the transport is always the plugin's**. ECore makes no helpers or wrappers for the kinds of connection: wrapping each kind would mean a redesign, felt by every plugin, every time a new kind appears. ECore provides what a long-lived connection needs to run, and monitors it.

## Decision
1. **A plugin's server part opens its own sockets, with the JDK's classes, inside a connection task.** Any kind: `DatagramSocket`, `MulticastSocket`, `Socket`, `ServerSocket`, `SSLSocket` or the NIO channels. There is no factory in ECore. Sockets are opened nowhere else: not in a worker, a timer or the plugin's start.
2. **A connection task is plugin code that ECore runs on its own platform thread** (rule C1 still holds: the plugin creates no thread). It is the only place where plugin code may block, in I/O or while it waits for data to send. ECore:
   - starts it when the plugin asks, and stops it when the plugin asks or stops; the plugin stops the tasks whose settings are gone;
   - restarts it with a back-off when it fails, or also when it ends, as the plugin asks;
   - caps the tasks per plugin, child tasks included (an ECore setting);
   - lets a task start **child tasks**, for example one per client of a TCP server, stopped with their parent;
   - closes the sockets a task registers when it stops, so that a blocked read ends;
   - gives a task a bounded **inbox**, so that workers can hand it data to send without blocking, with an overflow policy (`DROP_OLDEST`, `DROP_NEWEST`, `COALESCE_BY_KEY`, as for mailboxes);
   - fences a stopped task: what it sends to workers afterwards is dropped.

   A task sends what it receives to workers as immutable messages, as a listener does. A socket may pass to the task's own child tasks (for example one reads and one writes), never to a worker. No watchdog budget applies; CPU-heavy work goes to a compute worker (rule C7).

   **Amended by the owner on 2026-10-28** (CR-0027, Y1 and Y2a; in place, no new ADR):
   - **What changed:** decision 2 said "virtual thread". Each run of a connection task now has a platform thread of its own, on every OS.
   - **Why:** JDK 25 on Windows has [JDK-8334574](https://bugs.openjdk.org/browse/JDK-8334574). When one virtual thread waits to write on a socket and another waits to read the same socket, one of them can miss its wake-up and never resume; in `cot`'s case it was the writer. A task that writes while its child task reads, as `cot`'s `out` and `both` links do, then stalls for good under load. A platform thread blocks in the operating system's own socket calls, so it is not affected.
   - **What stays on virtual threads:** workers and the deprecated listener.
   - **Later:** once the project's JDK has [JDK-8394217](https://github.com/openjdk/jdk/pull/33297) (no write pollers on Windows) or a real fix, connection tasks may return to virtual threads. The owner decides then.
3. **ECore checks no endpoint.** The host rule of outbound HTTP applies to every connection (ADR-0030; owner, 2026-10-18 and 2026-10-19): a plugin may connect to any host, and takes the hosts, ports and multicast groups from its settings, never from a browser request, a message or an object's data. Keeping to this is the plugin's duty, which the reviews check.
4. **A connection that listens binds to loopback by default** (owner, Q2). The link's settings name the address or network interface and the port; an admin (`settings.admin`) chooses an interface address, or all interfaces, to receive from the network.
5. **TLS certificates and their passwords come from local server configuration**, by name, through the SDK, as they do for listeners today. They are never in the settings, the repository, a log or the browser. In M3, TLS is for TCP clients; for TCP servers it comes later (A5).
6. **Monitoring** (A4). ECore knows each task's state itself: starting, running, restarting (and when next), stopped or failed with the reason, since when, and how many restarts. The plugin reports its own counters and details through the SDK: messages and bytes in and out, the last activity, errors, the peer or the address it listens on. The monitor view shows both, for every plugin, including the addresses each plugin listens on.
7. **The manifest declares the plugin's connections**, as `internet` declares its outbound HTTP to outside hosts (ADR-0030): what it connects to or listens on, and why. For connection tasks it is a declaration, not an allow-list. The `network` field keeps its allow-list meaning for the deprecated listener only.
   **A connection's destination is covered by its declared connection, not by `internet`** (owner, AAA A, 2026-11-17; CR-0052): the address, group and port of a plugin's own socket, UDP, multicast or TCP, come from its settings, which an admin sets, and the declared connection covers them, even when an admin names an internet host there. `internet` declares the SDK's outbound HTTP to outside hosts only. A plugin that both opens its own sockets and calls out over HTTP, such as `fmv` with its WMS fetch, declares both.
8. **Today's listener stays in SDK 1.x, deprecated** (owner, Q1). `cot` moves to connection tasks in M3, with its sending side (ADR-0037). The listener is removed in the next major version of the SDK, whenever that comes for other reasons.

A sketch of the shape, not the API (the PDA designs it):
```java
ConnectionRef<Outgoing> out = context.connections().start("tak-out", Outgoing.class, task -> {
  try (var socket = new Socket()) {
    socket.connect(new InetSocketAddress(host, port), 10_000);
    task.closeOnStop(socket);
    var stream = socket.getOutputStream();
    for (Outgoing m; (m = task.take()) != null; ) { stream.write(m.bytes()); task.count("sent"); }
  }
}, Restart.backoff(Duration.ofSeconds(1), Duration.ofSeconds(60)));
// in a worker, never blocking:
out.post(new Outgoing(bytes));
```

## Alternatives considered
- **ECore opens every kind of socket** and gains UDP, multicast and TCP server listeners: ECore would check endpoints and own the sockets, but every new kind of transport, option or protocol detail becomes an SDK change that all plugins feel. The owner rejected wrappers for this reason.
- **A socket factory in ECore,** handing plain JDK sockets to the task: ECore would see every address and could close every socket. It needs one method per kind, plus the NIO and TLS variants, and grows with each new kind: a thinner wrapper.
- **Remove the listener now:** that makes the release SDK 2.0, and every plugin re-pins and is tested again, while only `cot` uses it and moves over in M3 anyway (owner, Q1).
- **Plugins start their own threads for their connections:** simplest for the plugin, but ECore could not attribute, stop, restart, cap or monitor them, which is why ADR-0004 forbids it.
- **Listen on all interfaces by default:** easier to set up, but a new link would be open to the network at once (owner, Q2).

## Consequences
- **Rule C6 changes** (overview 4.2, normative): long blocking I/O belongs in a connection task (or the deprecated listener), or for HTTP in the SDK's non-blocking outbound HTTP; plugins open sockets only inside connection tasks, and do no file I/O of their own. Rule C1 and the table of mechanisms name connection tasks. `CLAUDE.md` section 4 says the same in its offline rule (the owner approves it at the merge).
- **SDK 1.2.0 (PDA, through a change request):** the connection task API (start, child tasks, inbox, registered sockets, restarts, status and counters, TLS credentials by name), the manifest's declaration of connections, the test kit's fake tasks, and `PluginRules` allowing socket classes only in connection task code. The listener is marked deprecated. The design pattern (`docs/plugins/design-pattern.md`) shows how to write a task, and that received data is untrusted: size limits, safe parsers.
- **ECore (CDA):** runs the tasks with their caps, restarts, inboxes and fencing, closes registered sockets, and reports state and counters to the monitor view.
- **Trust:** ECore can no longer stop a plugin from listening wider or connecting elsewhere than its settings say. Plugins are trusted (`requirements.md`); the monitor view shows what each plugin listens on and connects to, the conformance review checks the default bind and the host rule, and the SRA compares the listening ports with the settings.
- **ITA:** tests with UDP, multicast and TCP test peers on loopback; the TAK test double gains a sending side where `cot` needs it.
- A task that does not register its socket, or never blocks, cannot be stopped cleanly; its thread is reported and remains until a restart, as ADR-0004 states for stuck workers.
