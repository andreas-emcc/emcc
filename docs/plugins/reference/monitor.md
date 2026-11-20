# Status and the Monitor

The **Monitor** is the admin's live view of the server and of every plugin. A plugin feeds it in two ways: its **status**, a state and one short line that says what it does and why it does not, and the **counters and details** of its connection tasks and compute tasks. ECore adds the rest itself: workers, channels, folders, streams, conversions, and what the manifest declares ([ADR-0013](../../adr/0013-opentelemetry-monitoring.md)).

## Server part (Java)

### The plugin's status

```java
context.status().set(PluginState.DEGRADED, "feed-north [in tcp-client to 10.0.0.5:4001]: down: connection refused");
```

- `Status.set(state, detail)` sets the plugin's own status. It is cheap and may be called from any handler. The initial status is `OK` with an empty detail.
- `PluginState`: `OK` (working as intended), `DEGRADED` (working, but limited, e.g. an upstream is down), `FAILED` (not working). `PluginState.worse(a, b)` gives the worse.
- `PluginStatus(state, detail)`: the detail is English, at most `PluginStatus.MAX_DETAIL` (512) characters; a longer one throws `IllegalArgumentException`, so cut it yourself.
- **ECore keeps a second status** for the plugin, e.g. `DEGRADED` when a worker that is not restarted hangs. The Monitor and the health checks show the **effective status**, the worse of the two (`PluginStatus.worse`). A plugin cannot clear ECore's.

### Counters, details and peers

| Call | Where | What the Monitor shows |
|---|---|---|
| `TaskContext.count(name, delta)` | in a connection task | a counter of that task, with its rate, e.g. `frames in 1204 (20.0/s)` |
| `TaskContext.detail(key, value)` | in a connection task | a detail of that task, e.g. `mode: in tcp-client to 10.0.0.5:4001`; a new value replaces the old |
| `TaskContext.listening(address)` | in a connection task | the address it listens on (the reviews compare it with the settings) |
| `TaskContext.peer(address)` | in a connection task | the peer it is connected to |
| `TaskContext.lastActivity()` | in a connection task | when `count` was last called, or `null`; shown as the task's last activity |
| `ConnectionRef.count(name, delta)`, `ConnectionRef.detail(key, value)` | in a worker | the same, for what the worker did not hand the task: skipped, dropped, above the classification |
| `ComputeContext.count(name, delta)`, `ComputeContext.detail(key, value)` | in a compute task | a counter or detail of that task (at most 32 detail keys), e.g. `rendered`, `late` |

Counters only grow, and a worker cannot read a task's counters back. A rate that the plugin's status shows counts what the worker sees itself.

## Web part (TypeScript)

`ctx.status.set(state, detail)`, with `PluginState` `'OK' | 'DEGRADED' | 'FAILED'`. The web status is per browser session: the Monitor shows it in the "Web part here" column of the browser that looks, and it never affects the server's status or health.

## What the Monitor shows

**Per plugin, in its row:** the effective status of the server part with its detail; the web part's status in this browser; its workers, their messages per second, what is queued and how many asks and timers were refused; **Connections**, its connection tasks (and deprecated listeners) as "2 of 3 running"; **Internet**, "declared" or "–".

**Per plugin, opened:**
- **Internet:** "Reaches outside hosts:" with the manifest's `reason`, and its default `hosts`, or that the hosts come from its settings.
- **Declared connections:** one sentence per `connections` entry: its kinds, which way, where in the settings (the `settings` pointer), and the `reason`.
- **Workers:** state, queue, messages per second, handler times, failures, hangs, restarts, lost messages.
- **Connection tasks:** name (a child's as `parent/child`), state (`starting`, `running`, `restarting at` a time with the reason, `stopping`, `stopped`, `failed:` with the reason), for how long, restarts, listening address, peer, counters and details, inbox (queued, lost, replaced) and last activity.
- **Output channels:** per link, what it sends and the declared kinds it takes; the items received, handled, replaced, dropped and waiting ([channels.md](channels.md)).
- **Local folders:** per folder, its id, its state (`readable`, `not set`, `cannot be read`, `being checked`), the path as typed with its setting, the folder a `%emcc%/` path resolves to, and the manifest's `reason`.
- **Streams:** viewers, bytes in and out, dropped chunks, viewer losses and the start buffer. **Conversions:** state, bytes in and out, dropped input, CPU time and detail ([streams.md](streams.md)).
- **Compute:** "Compute threads: 1 running of 2 allowed (declares 2: …)", the refusals by reason, and per compute task its state, for how long, restarts, busy share, CPU time, counters and details, and inbox. A task that did not end after its stop shows as such.

**For the server:** among the tiles, **Compute threads**, the compute tasks of all plugins against the server's cap. The **TLS credentials** list shows each credential the server has, with its identity's and trust store's certificates: subject, issuer, expiry date, and whether it is valid, expires within 30 days, or has expired. Never a path or a password.

## How to word the status

The status is one line an admin reads to learn what each part of the plugin does and, above all, why it does not. The template's `LinkWorker.refreshStatus` and [`docs/plugins/in-out/playbook.md`](../in-out/playbook.md) (work package 4) show the pattern.

- **One part per link**, joined by `; `: the link's name, where it is in brackets, its state, and what it received or sent.

  ```
  feed-north [in tcp-client to 10.0.0.5:4001]: up, 1204 received; tak-out [out tcp-server on 127.0.0.1:8087]: listening, 2 clients, 0 received
  ```

- **The states, in plain words:** `up`, `connecting`, `listening, 2 clients`, `starting`, `down: <reason>`, `switched off`, and a settings problem an admin can act on (`link feed-south: needs a port from 1 to 65535`).
- **The reason is the cause,** in words: the exception's message, the `ConnectionEvent`'s `reason`, a `FolderResult`'s reason, a failed TLS credential, "Waiting for a conversion slot". Never a stack trace.
- **The state:** `OK` when every enabled link or part runs; `DEGRADED` when some do not, or the settings have a problem; `FAILED` only when the plugin cannot work at all. A switched-off link is not a fault.
- **Keep it under 512 characters:** cut the end and add `...`, as the template does. Say "no links" when there are none.
- **Report what the settings do not show:** the actual layer each input link writes to, a highest classification that the server's order does not know, a multicast link that waits for an admin to name an interface.
- **Name counters** by what they count, short and lower case: `frames in`, `frames out`, `dropped: <reason>`, `skipped: <reason>`. Count each drop reason apart.
- **Rates:** for "per minute", keep a ring of 60 one-second samples in a worker with a one-second timer ([workers.md](workers.md)).
- **Warnings in the log:** at most one a minute per link and reason. Received data goes to the log at `debug` at most, and never whole objects or secrets.
- **The channel's state** is apart from the status: set `ChannelRef.state` for the senders ([channels.md](channels.md)).

## In the manifest

The Monitor shows what these declare: `internet`, `connections`, `folders` ([connections.md](connections.md)) and `compute` (`threads` and `reason`; [workers.md](workers.md)). See [manifest.md](manifest.md).

## Rules

- Set a status at start and after every change of what the plugin does; never leave a fault only in the log.
- Every expected error ends in the status, an HTTP status, a reply or a notification; never swallow one.
- Count what a task or a worker drops or skips, per reason.
- Keep the detail at most 512 characters, in English, with no secrets, tokens, paths of credentials or whole objects.
- Never try to hide ECore's status: the Monitor shows the worse of the two.

## Testing

```java
var ctx = FakePluginContext.builder("myplugin").settings(links).build();
plugin.init(ctx); plugin.start(); ctx.runUntilIdle();
assertThat(ctx.pluginStatus().state()).isEqualTo(PluginState.DEGRADED);
assertThat(ctx.pluginStatus().detail()).contains("feed-north", "down: connection refused");
ctx.setEcoreStatus(PluginState.FAILED, "worker hung");
assertThat(ctx.effectiveStatus().state()).isEqualTo(PluginState.FAILED);

FakeConnections.FakeTask<?> task = ctx.connectionTask("feed-north");
assertThat(task.counter("dropped: too long")).isEqualTo(1);
assertThat(task.details()).containsKey("mode");
assertThat(task.peer()).isNotNull();
```

- `FakeTaskContext` (one task alone): `counter(name)`, `counters()`, `details()`, `listeningAddress()`, `peerAddress()`, `clock(instant)` for `lastActivity()`.
- `FakeComputes.FakeCompute` (`ctx.computeTask(name)`): `counter(name)`, `counters()`, `details()`.
- Web: `createFakeContext()`'s `statusHistory` holds every status the web part set, in order.

See [testing.md](testing.md).

## See also

- [connections.md](connections.md), [channels.md](channels.md), [streams.md](streams.md), [workers.md](workers.md), [manifest.md](manifest.md), [testing.md](testing.md)
- [ADR-0036](../../adr/0036-connection-tasks.md) (what a task reports), [ADR-0037](../../adr/0037-links-and-output-channels.md) (skips counted per link and reason), [ADR-0064](../../adr/0064-compute-tasks.md) (compute in the Monitor), [ADR-0062](../../adr/0062-tls-credentials-for-connection-tasks.md) (credentials' expiry)
- Source: [`Status`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/Status.java), [`PluginStatus`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/PluginStatus.java), [`TaskContext`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/connection/TaskContext.java), [`ComputeContext`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/compute/ComputeContext.java)
