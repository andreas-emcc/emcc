# Connections

A plugin's server part reaches outside emcc in five ways: its own sockets in **connection tasks**, **TLS** on those sockets with a named credential, **local folders** that ECore reads for it, **outbound HTTP** that ECore performs for it, and **HTTP endpoints** that browsers and other systems call. Use a connection task for any protocol over TCP, UDP or multicast, and outbound HTTP for HTTP. A plugin never opens a socket, a file or a process anywhere else.

## Server part (Java)

### Connection tasks (`dev.emcc.sdk.connection`)

A connection task is plugin code that ECore runs on a platform thread of its own. It is the only plugin code that may block, and the only place where a plugin opens sockets, with the JDK's classes (`Socket`, `ServerSocket`, `DatagramSocket`, `MulticastSocket`, the NIO channels). Workers start it, post it what to send, and get what it receives as messages ([ADR-0036](../../adr/0036-connection-tasks.md)).

| Type | What it is |
|---|---|
| `Connections` (`context.connections()`) | `start(spec, factory)` and `start(spec, factory, events, toMessage)`. At most `MAX_TASKS` (100) tasks per plugin that are not stopped, children included. `IllegalArgumentException` if a task of that name runs, `IllegalStateException` at the cap |
| `ConnectionSpec<I>` | `of(name, inboxType)`, `.inbox(capacity, overflow)`, `.restart(restart)`. The name is lowercase words joined by hyphens, at most 64 characters, unique in the plugin (a child's: among its parent's children). The inbox holds 1 to 100 000 items, default 1 000, with `Overflow.dropNewest()` (default), `dropOldest()` or `coalesceByKey()` |
| `ConnectionTask<I>` | `run(TaskContext<I>)`. Return to end the run, throw to fail it |
| `TaskContext<I>` | `take()`, `poll(timeout)`, `closeOnStop(resource)`, `send(worker, message)`, `startChild(spec, factory)`, `count`, `detail`, `listening`, `peer`, `lastActivity()`, `tls(name)`, `sslContext(name)`, `stopping()`, `log()`, `self()` |
| `ConnectionRef<I>` | A handle that may travel in messages: `name()`, `post(item)`, `count`, `detail`, `stop()` |
| `Restart` | `never()` (default), `onFailure(backoff)`, `always(backoff)` |
| `Backoff` | `exponential(initial, max)`: `initial` 100 ms to 1 h, doubling up to `max` (at most 1 h). A run that lasted at least `max` starts again from `initial` |
| `ConnectionEvent` | `Running`, `Restarting` (with `reason` and `retryAt`), `Stopped`, `Failed` (with `reason`) |
| `ListenAddress` | `from(link)` for a TCP server or UDP, `multicast(link)` for a group, `LOOPBACK` (`127.0.0.1`) |

```java
// In the links worker, for each enabled link. Host and port come from the link's settings only.
ConnectionSpec<LinkInbox> spec = ConnectionSpec.of(link.name(), LinkInbox.class)
    .inbox(10_000, Overflow.coalesceByKey())
    .restart(Restart.always(Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(60))));
ConnectionRef<LinkInbox> ref = context.connections().start(
    spec, () -> new TcpClientLinkTask(link, self, MAX_FRAME_BYTES), self, TransportMsg.LinkEvent::new);
if (ref.post(new LinkInbox.Send(key, frame)) != SendResult.ACCEPTED) { ref.count("skipped: inbox full", 1); }

final class TcpClientLinkTask implements ConnectionTask<LinkInbox> {   // a class, not a lambda
  @Override public void run(TaskContext<LinkInbox> task) throws IOException {
    Socket socket = task.closeOnStop(new Socket());                  // register before connect
    socket.connect(new InetSocketAddress(link.host(), link.port()), 10_000);
    task.peer(socket.getRemoteSocketAddress());
    OutputStream out = socket.getOutputStream();
    for (LinkInbox item; (item = task.take()) != null; ) {           // null: the task is stopping
      out.write(bytesOf(item));
      task.count("frames out", 1);
    }
  }
}
```

**A run's life:**
- For every run ECore takes a fresh task from the factory. The factory runs on the task's thread; a factory that throws counts as a run that threw.
- When `run` returns or throws, the spec's `Restart` decides: `never` ends the task, `onFailure` runs a fresh task after the back-off only when `run` threw, and `always` does so in both cases until the task is stopped.
- The events (`Running`, `Restarting`, `Stopped`, `Failed`) reach the `events` worker in order, whatever its overflow policy. When more than `MAX_PENDING_EVENTS` (100) wait undelivered, ECore keeps only the latest.
- `ref.stop()` closes the resources the task registered, so a blocked read ends; `take` returns `null`; the context is **fenced** (its later sends return `CLOSED`); its children stop; no restart follows. The name may then be used again. ECore stops every task when the plugin stops.
- Items posted while ECore restarts a task wait for the next run.

**Children:** `task.startChild(spec, factory)` starts a task that stops with its parent, e.g. one per client of a TCP server, or a reader beside a writer on one socket. Its name is the parent's, a slash and its own (`tak-in/client-1`). Children count toward the cap. `startChild` throws `IllegalArgumentException` for a name in use and `IllegalStateException` at the cap or while the task is stopping: a TCP server's accept loop catches it, closes the new client and counts it. A socket may pass to the task's own children, never to a worker.

**Listening:** `ListenAddress.from(link)` reads `address` (default `127.0.0.1`), `port` (required) and an optional `interface`, so a link that listens binds to loopback unless an admin sets another address (`0.0.0.0` or `::` for all interfaces). `ListenAddress.multicast(link)` requires the group in `address`, a `port` and an `interface`; without an interface it throws, and the link stays stopped with a status that says an admin must name one. Both only parse; the task resolves the name.

**Settings changes:** a running task keeps running. The plugin gets the new settings (`context.subscribeSettings`), stops the tasks of links that are gone or changed, and starts the new ones.

### The link pattern

Each connection is a **link**, one item of a `links` list in the plugin's settings. The template's `transport` package ([`plugins/_template/server/.../transport/`](../../../plugins/_template/server/src/main/java/dev/emcc/plugins/template/transport/package-info.java)) has the whole pattern, for UDP, a TCP client and a TCP server, each `in`, `out` or `both`:
- `Link` reads one item; `LinkWorker` starts one task per enabled link, named after the link, stops it when the link goes, and writes the status; `UdpLinkTask`, `TcpClientLinkTask` and `TcpServerLinkTask` hold the sockets; `LineFramer` cuts lines.
- The `links` setting gives each item a **stable id** with `"x-emc2": {"item": {"id": "id", ...}}` and a read-only `id` property. ECore fills it in and never changes it, so a renamed link stays the same link for the plugin's own state. See [settings.md](settings.md).
- [`docs/plugins/in-out/playbook.md`](../in-out/playbook.md) builds an in/out plugin on it step by step.

### TLS with a named credential

`task.tls(name)` gives an `SSLSocketFactory`, and `task.sslContext(name)` the `SSLContext` itself, e.g. for an `SSLEngine` with NIO. ECore builds them from the TLS credential of that name in the server's local configuration (one file per credential, `settings/credentials/tls-<name>.properties`: PKCS#12, JKS or PEM). The plugin never sees a key, a certificate file or a password ([ADR-0062](../../adr/0062-tls-credentials-for-connection-tasks.md)).
- Every socket from `tls(name)` checks that the peer's certificate names the host it connects to. A task that needs another check uses `sslContext(name)`.
- `IllegalArgumentException`: no credential of that name is configured.
- `IllegalStateException`: the credential's client certificate has expired, or its files cannot be read. The message says which.
- **The link picks its credential** in a string setting marked `"x-emc2": {"kind": "tls-credential"}` (no `enum`, no `pattern`). The settings form offers the names the server has, and nothing else of a credential. **An empty value means the link's name**: pass `value.isEmpty() ? linkName : value` (the template's `Link.credential()`).
- Call `tls` before you connect, so that a missing credential opens no connection, and report the exception's message in the link's status.
- ECore reads the credentials when it starts; a changed credential takes effect after a server restart.

### Local folders (`dev.emcc.sdk.folder`)

`context.folders()` gives the folders the manifest declares, read by ECore for the plugin, read only and confined to each folder ([ADR-0049](../../adr/0049-terrain-analysis.md)).
- `folder(id)` (`IllegalArgumentException` for an id the manifest does not declare) and `ids()`.
- `LocalFolder.list(relativeDir, timeout, target, toMessage)` and `read(relativePath, offset, length, timeout, target, toMessage)`. ECore does the I/O on its own threads; exactly one `FolderResult` arrives later, always delivered: `Listing` (entries sorted by name), `Read` (the bytes and the file's whole size) or `Failed` with a `Reason`: `NOT_SET`, `MISSING`, `INVALID_PATH`, `OUTSIDE`, `NOT_FOUND`, `WRONG_KIND`, `TOO_LARGE`, `BUSY`, `TIMEOUT`, `IO`.
- **Limits:** a read of at most `MAX_READ_BYTES` (64 MiB), a listing of at most `MAX_ENTRIES` (10 000), at most `MAX_CONCURRENT_CALLS` (8) calls of the plugin at a time over all its folders.
- **Paths** are relative, with `/` on every OS; `""` is the folder itself. An absolute path, a drive letter, a backslash or a NUL is `INVALID_PATH` (`LocalFolder.isWellFormed`). A path that resolves outside the folder, links included, is `OUTSIDE`.
- **The folder** is the value of the setting the manifest points to, which only an admin sets: an absolute path, or one that starts with `%emcc%/` (`LocalFolder.EMCC_PREFIX`), which ECore resolves below the folder the server was started in. A changed setting applies to the next call. The plugin never resolves it itself.

### Outbound HTTP (`dev.emcc.sdk.http`)

`context.http().send(call, timeout, target, toMessage)` starts the call and returns at once. Exactly one `HttpResult` arrives later, always delivered: `Response(status, headers, body)` for any status, `Failed(reason)`, or `TimedOut`.
- `HttpCall.get(uri)` or `HttpCall.post(uri, mediaType, body)`, over `http` or `https`; `.header(name, value)`, `.credential(name)`, `.maxResponseBytes(bytes)`.
- **Limits:** no redirects; a `POST` body of at most `HttpCall.MAX_REQUEST_BODY_BYTES` (1 MiB); a response of at most `OutboundHttp.MAX_BODY_BYTES` (10 MiB) by default, or the call's own limit up to `HttpCall.MAX_RESPONSE_BYTES` (16 MiB); at most `OutboundHttp.MAX_CONCURRENT_CALLS` (16) calls per plugin at a time. A call beyond a limit fails at once with `Failed`.
- **Headers ECore sets itself:** `header` throws for `Authorization`, `Content-Type`, `Content-Length`, `Host` and `Transfer-Encoding`.
- **HTTP credentials by name:** `.credential("anet")` makes ECore add `Authorization: Bearer <token>` from the token of that name in the server's local configuration. The plugin never sees the token. A name that is not configured fails at once with `Failed("no credential anet")`.

```java
context.http().send(HttpCall.get(URI.create(baseUrl + "/5/17/9.png")).header("User-Agent", "emcc"),
    Duration.ofSeconds(5), self, result -> new TileMsg.Fetched(key, result));
```

### HTTP endpoints

`context.endpoints().register(endpoint, worker, toMessage)`, in `init`, serves a path under `/api/plugins/<plugin-id>/`. Each request reaches the worker as a message; the worker answers once through `request.response().respond(reply)`, now or from a later handler call.
- `Endpoint.get(path)` and `Endpoint.post(path)` (a JSON body); `.requires(permission)`, `.timeout(d)` (100 ms to 60 s, default 10 s), `.maxBody(bytes)`, `.accepts(mediaTypes...)` for a raw `POST` body, `.checksUserItself()`. `Endpoint.service(method, path)` serves `/api/services/<plugin-id>/...` to other systems without a browser session.
- A `POST` endpoint must name a permission (`register` refuses one without), unless it is a service endpoint or `checksUserItself()`. See [permissions-and-labels.md](permissions-and-labels.md).
- ECore answers itself: `404`, `405` (with `Allow`), `403` without the permission, `415`, `413` and `400` for a bad `POST` body, `504` when the worker does not answer in time, `503` when its mailbox refuses the request. ECore never repeats a request.
- `/stream` and `/stream/...` are ECore's, for the plugin's streams ([streams.md](streams.md)).
- `HttpReply.of(status, headers, body)`, `HttpReply.status(code)`, `HttpReply.json(status, value)`.

## In the manifest

- **`connections`** ([manifest.md#connections](manifest.md#connections)): one entry per group of links, with `kinds` (`tcp-client`, `tcp-server`, `udp`, `multicast`, `other`), `direction` (`in`, `out`, `both`), `settings` (a JSON Pointer to the links, e.g. `/links`) and `reason`. A declaration shown in the Monitor, not an allow-list. It covers every host an admin names in those links, internet hosts included.
- **`internet`** ([manifest.md#internet](manifest.md#internet)): `hosts` (the defaults, without scheme or path; empty when every host comes from the settings) and `reason`. It declares the SDK's outbound HTTP only. A plugin that opens its own sockets and also calls out over HTTP declares both.
- **`folders`** ([manifest.md#folders](manifest.md#folders)): at most 8, each `{ "id", "setting", "reason" }`, with `setting` a JSON Pointer to the string that holds the path.

```json
"connections": [{ "kinds": ["tcp-client", "tcp-server", "udp"], "direction": "both", "settings": "/links",
                  "reason": "Lines of text to and from the peers each link names." }],
"folders": [{ "id": "heights", "setting": "/heightDataFolder", "reason": "DTED height data for viewsheds" }]
```

## Rules

- Open sockets only in a connection task, written as a class that implements `ConnectionTask` (or a class nested in one). A helper outside the task takes the socket's streams, never the socket. `PluginRules` checks this.
- Register every socket with `task.closeOnStop` at once, before `connect` or `bind`. Return when `take()` gives `null` or `stopping()` is true. Never sleep: wait with `poll(timeout)`, and to retry, end the run and let its `Restart` back off.
- Hosts, ports, groups and URLs come only from the plugin's settings, never from a browser request, a message or an object's data ([ADR-0030](../../adr/0030-offline-first-configurable-hosts.md)). ECore checks no host; the reviews do.
- A connection that listens binds to loopback unless an admin chooses another address.
- Received data is untrusted: limit sizes, parse with safe parsers (no DTDs, no external entities), and pass CPU-heavy work to a compute worker or a compute task ([workers.md](workers.md)).
- Key material, passwords and tokens never appear in settings, the repository, a log or the browser. Name a credential; never pass a path.
- Read local files only through declared folders. No `java.io.File`, `java.nio.file.Files`, `HttpClient` or `URLConnection` in a plugin.
- Every function has a way to work offline: treat an unreachable host as normal and say so in the status.
- Answer every endpoint request once, also on errors.

## Testing

`FakePluginContext` runs connection tasks on real platform threads, so they may open real sockets on loopback. Their sends and events reach the workers at `ctx.runUntilIdle()`; restarts follow the back-off in virtual time (`ctx.advance`). `FakeTaskContext` runs one task alone on the test thread with a scripted inbox.

```java
var ctx = FakePluginContext.builder("myplugin").settings(links)
    .tlsCredentials("tak-north", testSslContext)       // what task.tls("tak-north") gives
    .expiredTlsCredentials("tak-south", LocalDate.of(2026, 1, 31))   // task.tls throws as ECore does
    .httpCredentials("anet")                             // names that HttpCall.credential accepts
    .folder("heights", tempDir).build();
FakeConnections.FakeTask<?> task = ctx.connectionTask("feed-north");
task.awaitIdle();                                        // waits in take(), or has ended
ctx.runUntilIdle();
task.fail("connection reset"); task.awaitIdle(); ctx.advance(Duration.ofSeconds(1));   // a fresh run
assertThat(task.counter("frames in")).isEqualTo(3);

var alone = FakeTaskContext.<LinkInbox>of("feed-north", new LinkInbox.Send("a", "x"));
alone.run(new TcpClientLinkTask(link, worker, 4_096));   // take() gives the items, then null
```

- `ctx.upstream().respond(uri, status, headers, body)`, `respondAfter`, `fail` and `never` script outbound HTTP by exact URI; `ctx.httpCalls()` lists every call.
- `ctx.folders().setPath(id, null)` empties a folder's setting; `hold()` keeps calls in progress, to test `BUSY` and `TIMEOUT`.
- `ctx.call(path)`, `ctx.post(path, body, user)` and `ctx.serviceRequest(...)` call the plugin's endpoints; the `FakeHttpExchange` gives the `reply()`.
- The fakes give `IllegalArgumentException` for an unknown TLS credential. `Builder.expiredTlsCredentials(name, date)` and `unreadableTlsCredentials(name, reason)`, and the same on `FakeTaskContext`, make `tls` and `sslContext` throw `IllegalStateException` with ECore's message (`the TLS credential <name>: its certificate expired on <date>`, `… cannot be read: <reason>`; ECore's expiry message also names the certificate's subject), so a test can check a link's failed start and its status.

See [testing.md](testing.md).

## See also

- [workers.md](workers.md), [settings.md](settings.md), [monitor.md](monitor.md), [channels.md](channels.md), [streams.md](streams.md), [permissions-and-labels.md](permissions-and-labels.md), [rules.md](rules.md)
- [ADR-0036](../../adr/0036-connection-tasks.md) (connection tasks), [ADR-0062](../../adr/0062-tls-credentials-for-connection-tasks.md) (TLS credentials), [ADR-0030](../../adr/0030-offline-first-configurable-hosts.md) (hosts and offline)
- Source: [`connection/`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/connection/TaskContext.java), [`folder/`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/folder/LocalFolder.java), [`http/`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/http/OutboundHttp.java)
