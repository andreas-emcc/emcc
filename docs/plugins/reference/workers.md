# Workers, messages, timers and compute

A server part does all its work in **workers**: a mailbox and a handler that ECore runs one message at a time. Workers own their state and talk only through immutable messages. Timers send messages; topics fan them out; **compute workers** and **compute tasks** take CPU-heavy work. A plugin never creates a thread, never takes a lock and never waits without a timeout.

## The plugin context

[`PluginContext`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/PluginContext.java) is everything ECore offers a server part. `Plugin.init` gets it; the plugin may keep it.

| Member | What it gives | Page |
|---|---|---|
| `pluginId()` | The plugin's id, also its extension namespace | [manifest.md](manifest.md) |
| `log()` | The plugin's logger; ECore tags each entry with the plugin id | [monitor.md](monitor.md) |
| `status()` | Sets the plugin's own status | [monitor.md](monitor.md) |
| `settings()` | The current settings, validated against the manifest, an immutable snapshot | [settings.md](settings.md) |
| `subscribeSettings(target, toMessage)` | The complete new settings to a worker after each accepted change | [settings.md](settings.md) |
| `workers()` | Creates workers and compute workers | this page |
| `listeners()` | Deprecated: ECore-opened client connections; use `connections()` | [connections.md](connections.md) |
| `connections()` | Connection tasks, where the plugin opens its own sockets | [connections.md](connections.md) |
| `channels()` | Output channels: offer, watch, send | [channels.md](channels.md) |
| `classifications()` | The order of classifications per security policy | [permissions-and-labels.md](permissions-and-labels.md) |
| `topics()` | Typed publish and subscribe | this page |
| `timers()` | Messages sent once or periodically | this page |
| `http()` | Outbound HTTP, performed by ECore; the result arrives as a message | [connections.md](connections.md) |
| `endpoints()` | The plugin's HTTP endpoints under `/api/plugins/{pluginId}/` | [connections.md](connections.md) |
| `store()` | The object store: changes, queries, subscriptions | [objects.md](objects.md) |
| `documents()` | The plugin's own JSON documents | [objects.md](objects.md) |
| `dataTypes()` | The available data types, `core.general` first; fixed while the server runs | [objects.md](objects.md) |
| `declaredFields()` | The fields every loaded plugin declares | [objects.md](objects.md) |
| `workspaces()` | Every workspace, View first | [objects.md](objects.md) |
| `defaultLabel()` | The configured default security label | [permissions-and-labels.md](permissions-and-labels.md) |
| `fieldSets()` | The field sets every loaded plugin declares | [objects.md](objects.md) |
| `relationKinds()` | The relation kinds every loaded plugin declares | [objects.md](objects.md) |
| `folders()` | The local folders the manifest declares, read only | [connections.md](connections.md) |
| `streams()` | Streams to the plugin's web part | [streams.md](streams.md) |
| `conversions()` | ECore's conversion service, e.g. into a stream | [streams.md](streams.md) |
| `compute()` | The plugin's compute tasks | this page |

## Server part (Java)

### Workers and messages

A worker is made from a [`WorkerSpec`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/worker/WorkerSpec.java) with `context.workers().spawn(spec)`, usually in `init`; a handler may spawn workers too. ECore stops all of a plugin's workers when the plugin stops.

```java
sealed interface TileMsg extends Message {
  record Get(TileKey key, EndpointRequest request) implements TileMsg {}
  record Fetched(TileKey key, HttpResult result) implements TileMsg {}
}

WorkerRef<TileMsg> tiles = context.workers().spawn(
    WorkerSpec.of("tiles", TileMsg.class, TileWorker::new)
        .mailbox(1_000, Overflow.dropOldest())
        .budget(Duration.ofSeconds(5))
        .restartable(true));
```

| `WorkerSpec` | Default | Limits |
|---|---|---|
| `name` | | Lowercase words joined by hyphens, at most 64 characters, unique in the plugin (a second `spawn` with the name fails) |
| `mailbox(capacity, overflow)` | 1 000, `Overflow.dropNewest()` | Capacity 1 to 1 000 000 |
| `budget(perCall)` | 5 s; 30 s for a compute worker | 10 ms to 60 s |
| `restartable(value)` | `false` | |
| `compute(value)` | `false` | See "Compute workers" |

**The handler.** A [`Handler<M>`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/worker/Handler.java) has one method, `handle(M message, WorkerContext<M> context)`. Its fields are the worker's state: only that worker touches them, so they need no locks. The `WorkerContext` gives `self()`, `log()` and `ask(...)`. A handler that throws is logged, the message is dropped and the worker goes on with the same handler.

**The watchdog.** A handler call over its budget marks the worker HUNG (logged, counted, shown in the Monitor). A restartable worker gets a fresh handler from the factory on the same mailbox; the old context is fenced, so whatever it sends later is dropped, and the message that hung is not delivered again. A worker that is not restartable, or that passed the restart limit, makes the plugin DEGRADED.

**Messages.** A message implements [`Message`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/Message.java) and is a record (or an enum) with immutable fields only: strings, numbers, booleans, enums, other messages, `Bytes`, `JsonValue`, model types, and collections made with `List.copyOf`, `Map.copyOf` and the like. No arrays. Name one `sealed interface <Name>Msg extends Message` per worker, with one record per message.

**Sending.** `WorkerRef.send(message)` puts the message in the mailbox and returns at once with a [`SendResult`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/worker/SendResult.java): `ACCEPTED`, `DROPPED` (the mailbox was full and its policy refused it) or `CLOSED` (the worker is stopped). It never blocks. Messages from one sender to one receiver arrive in the order sent.

**Mailbox policies** ([`Overflow`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/worker/Overflow.java)), for when the mailbox is full:

| Policy | Does | Use for |
|---|---|---|
| `dropNewest()` (default) | Refuses the new message (`DROPPED`) | Requests |
| `dropOldest()` | Evicts the oldest queued message | "Latest wins" data |
| `coalesceByKey()` | A message that implements [`Coalescing`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/worker/Coalescing.java) with a non-null `coalesceKey()` replaces a queued one with an equal key, in its place; otherwise the oldest is evicted | Updates of the same thing, e.g. track positions |

The policy applies to the plugin's own sends and to ECore's deliveries: timer ticks, topic messages, endpoint requests (one that cannot be queued is answered `503` at once). **Always delivered, never coalesced:** replies and ask timeouts, outbound HTTP results, store, query and document answers, store subscription updates, and settings deliveries. Every drop is counted.

### Ask and reply

`WorkerContext.ask(target, request, timeout, toMessage)` returns at once. `request` builds the message from a fresh [`ReplyTo<R>`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/worker/ReplyTo.java); exactly one [`Reply<R>`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/worker/Reply.java) arrives later in the asker's mailbox, wrapped by `toMessage`:

- `Reply.Ok(value)`: the target answered with `replyTo.reply(value)`;
- `Reply.Failed(reason)`: the target called `replyTo.fail(reason)`, or it is stopped, refused or evicted the request, or the plugin already has the most outstanding asks (an ECore setting, default 10 000 per plugin; then at once, with the reason `too many outstanding asks`);
- `Reply.TimedOut()`: no answer within `timeout`, which is 1 ms to 10 minutes.

```java
record Get(TileKey key, ReplyTo<Tile> replyTo) implements CacheMsg {}
// in the cache worker:
case Get get -> get.replyTo().reply(tiles.get(get.key()));
// in the asking worker:
ctx.ask(cache, replyTo -> new CacheMsg.Get(key, replyTo), Duration.ofSeconds(2),
    reply -> new TileMsg.CacheAnswer(key, reply));
case TileMsg.CacheAnswer a -> {
  switch (a.reply()) {
    case Reply.Ok<Tile> ok -> respond(ok.value());
    case Reply.Failed<Tile> f -> fetchUpstream(a.key());
    case Reply.TimedOut<Tile> t -> fetchUpstream(a.key());
  }
}
```

Answer once: later answers, and answers after the asker's timeout, are ignored. After a restart, a new handler may receive answers to the old one's asks; it must tolerate them (e.g. ignore unknown keys). Every mapper the plugin hands the SDK (`toMessage`, a subscription's or an endpoint's mapper) is plugin code: pure, non-blocking, run inside the target worker under its budget.

### Topics

A [`Topic<T>`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/topic/Topic.java) is a name and a payload type. The name is dot-separated lowercase words with hyphens, at least two parts, at most 128 characters; a plugin's own topics start with its id.

```java
static final Topic<TileFetched> FETCHED = Topic.of("basemap-osm.tile-fetched", TileFetched.class);
context.topics().subscribe(FETCHED, statsWorker, StatsMsg.Fetched::new);   // returns a Cancellable
context.topics().publish(FETCHED, new TileFetched(key, millis));
```

`publish` never blocks; each subscriber's mailbox applies its own policy (with `coalesceByKey`, the key comes from the original payload). A plugin may publish only to topics that start with its own id; any other throws `IllegalArgumentException`. It may subscribe to any plugin's topic. Messages from one publisher reach a subscriber in the order published. To follow changes of objects, use a store subscription ([objects.md](objects.md)).

### Timers

[`Timers`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/timer/Timers.java) send a message to a worker; they never run plugin code.

```java
Cancellable retry = context.timers().once(Duration.ofSeconds(30), self, new Retry(key));
Cancellable tick = context.timers().every(Duration.ofMinutes(1), statsWorker, new StatsMsg.Report());
tick.cancel();
```

- `every` has a **fixed delay** between deliveries, and skips a tick while the previous one is still undelivered, so a slow worker never collects a queue of ticks.
- The shortest delay and period is `Timers.MIN_PERIOD`, 10 ms; a shorter one throws `IllegalArgumentException`.
- A plugin has at most 1 000 **active timers** (an ECore setting): a `once` that has neither fired nor been cancelled, or an `every` not cancelled. One more throws `IllegalStateException`. Thrown in a handler, ECore logs it and drops the message; thrown in `init` or `start`, the plugin is disabled.

### Compute workers

`WorkerSpec…compute(true)` makes a **compute worker**: an ordinary worker that runs on ECore's bounded pool of platform threads instead of a virtual thread, with a default budget of 30 s. Use it for CPU-heavy **jobs that end** (a tile render, a terrain analysis), so they cannot starve other work. It must not block on I/O either.

### Compute tasks

A **compute task** ([`dev.emcc.sdk.compute`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/compute/package-info.java)) is plugin code with its own loop that holds a core as long as it is needed, e.g. a renderer of simulated video. ECore runs it on a compute thread that it creates, caps and shows in the Monitor.

**Declare** compute threads in the manifest, `"compute": { "threads": n, "reason": "…" }` (1 to 64, `Computes.MAX_DECLARED`). An admin may lower the number for the plugin, or switch it off (0), in the plugin's Settings entry. The server setting `emc2.compute.max-threads` caps the running compute tasks of all plugins together (by default the computer's cores minus one, at least one).

**Start** one from a worker with `context.compute().start(spec, factory, events, toMessage)` (or without the events target). It returns a [`ComputeRef<I>`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/compute/ComputeRef.java) at once; workers hand it items with `ref.post(item)`, which never blocks and gives a `SendResult`, and stop it with `ref.stop()`. A `ComputeRef` is a value and may travel in messages.

```java
ComputeRef<Pose> render = context.compute().start(
    ComputeSpec.of("camera-north", Pose.class)
        .inbox(16, Overflow.coalesceByKey())        // the newest pose per camera
        .restart(Restart.onFailure(Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(60)))),
    () -> new Renderer(linkWorker), linkWorker, LinkMsg.Compute::new);
render.post(pose);
```

| `ComputeSpec` | Default | Limits |
|---|---|---|
| `name` | | Lowercase words joined by hyphens, at most 64 characters, unique among the plugin's running compute tasks (`start` throws `IllegalArgumentException` otherwise) |
| `inbox(capacity, overflow)` | 1 000, `dropNewest()` | 1 to 100 000. `coalesceByKey` needs items that implement `Coalescing` |
| `restart(...)` | `Restart.never()` | `Restart.onFailure(backoff)`, `Restart.always(backoff)` (`dev.emcc.sdk.connection`) |

**The task** is a class that implements [`ComputeTask<I>`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/compute/ComputeTask.java), not a lambda. ECore makes a new instance from the factory for every start and restart. Its `run(ComputeContext<I> task)` loops over `task.take()` and returns when it gives `null`:

```java
final class Renderer implements ComputeTask<Pose> {
  private final WorkerRef<LinkMsg> link;
  Renderer(WorkerRef<LinkMsg> link) { this.link = link; }

  @Override
  public void run(ComputeContext<Pose> task) {
    for (Pose p; (p = task.take()) != null; ) {
      if (task.stopping()) break;
      Bytes picture = Bytes.of(render(p));      // CPU only, on data the task owns
      task.send(link, new LinkMsg.Picture(p.time(), picture));
      task.count("rendered", 1);
    }
  }
}
```

[`ComputeContext<I>`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/compute/ComputeContext.java) gives `take()`, `poll(timeout)` (1 ms to 1 hour), `stopping()`, `send(worker, message)` to the plugin's own workers, `count(name, delta)` and `detail(key, value)` (at most 32 keys) for the Monitor, `folders()`, `log()` and `self()`. A task posts to its plugin's connection tasks with `ConnectionRef.post`. After the task stops or ends, or the plugin stops, the context is fenced: what it sends is dropped (`CLOSED`). Large values such as pictures cross as `Bytes`.

**Events** ([`ComputeEvent`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/compute/ComputeEvent.java)), sent to the events target:

| Event | Means |
|---|---|
| `Running` | The task runs, after its start or a restart |
| `Restarting(reason, retryAt)` | It failed or ended and restarts at `retryAt`, as its spec asks; it keeps its place under the limits |
| `Stopped(reason)` | It stopped; `reason` is `null` when the plugin stopped it or it ended, else why (e.g. the admin lowered the threads) |
| `Failed(reason)` | It failed and is not restarted |
| `Refused(refusal)` | The start was refused; the ref is stopped at once and `post` gives `CLOSED` |
| `Hung` | It had not returned `Computes.STOP_GRACE` (5 s) after its stop. The plugin is DEGRADED; the thread may stay until the server restarts |

**Limits and refusal.** A task counts against its plugin's `allowed()` and ECore's total cap from its start until it has stopped, its restarts' back-off included. A start above either is refused with a `Refusal`: `NOT_DECLARED` (no `compute` in the manifest), `SWITCHED_OFF` (allowed is 0), `PLUGIN_LIMIT` (the plugin already runs `allowed()` tasks) or `TOTAL_CAP`. ECore does not retry a refused start: say so in the plugin's status, and try again later (e.g. on a timer) if needed. `declared()` is the manifest's number (0 without a declaration); `allowed()` is what the admin allows now, 0 to `declared()`, and can change between calls. Lowering it while tasks run stops the newest first, each with `Stopped` and a reason. `start` throws `IllegalStateException` once the plugin has stopped.

**What a task may do:** CPU work on data it owns, wait on its inbox, read its plugin's declared folders, send immutable messages to its plugin's workers and post to its connection tasks, count and describe itself. **What it may not do:** open sockets, make HTTP calls, use the store, documents, channels, streams, topics, timers or workers, create threads, take locks, sleep, share mutable state, or start a program. No watchdog budget applies; a stop that does not end marks it `Hung`.

## In the manifest

- `compute`: `{ "threads": 1..64, "reason": "…" }`, only for a plugin that starts compute tasks. See [manifest.md](manifest.md).

## Rules

These are the concurrency rules C1 to C8 of the architecture ([ADR-0004](../../adr/0004-concurrency-workers-and-messages.md), [ADR-0064](../../adr/0064-compute-tasks.md)); the test kit's `PluginRules` checks what can be checked statically.

- **C1:** never create threads, executors or thread pools. Use workers, connection tasks, compute tasks and timers from ECore.
- **C2:** a worker handles one message at a time; only that worker touches its state.
- **C3:** workers communicate only through immutable messages: records with immutable fields, no arrays.
- **C4:** never use locks, monitors (`synchronized`) or blocking synchronizers. Each worker owns its state, so none is needed.
- **C5:** every request has a timeout: `ask`, `store().submit` and `query`, outbound HTTP. Prefer send-and-forget events to request and reply.
- **C6:** never block in a handler: no sleeping, no waiting, no blocking I/O. Sockets belong only in connection tasks; HTTP goes through the SDK's outbound HTTP; files only through declared folders and documents.
- **C7:** CPU-heavy work goes to a compute worker when it is a job that ends, or to a compute task when it is a loop.
- **C8:** no Java preview features.
- Never use parallel streams. A bundled library must not start threads or block either.
- Handle `DROPPED` and `CLOSED` where they matter, and count what you drop.
- After a worker restart, tolerate answers to asks the new handler does not know.

## Testing

[`FakePluginContext`](../../../server/plugin-sdk/testkit/src/main/java/dev/emcc/sdk/testkit/FakePluginContext.java) is deterministic and single-threaded: messages are delivered when the test calls `runUntilIdle()`, and virtual time moves only with `advance(duration)`. It enforces mailboxes and their policies, the ask and timer caps (`Builder.caps(asks, timers)` lowers them), the timer minimum and the ask timeout range. Unlike ECore, a handler that throws fails the test (`Builder.rethrowHandlerErrors(false)` turns that off).

```java
var ctx = FakePluginContext.builder("my-plugin").compute(2).build();
plugin.init(ctx);
plugin.start();
ctx.runUntilIdle();
ctx.advance(Duration.ofSeconds(30));          // fires timers due by then
assertThat(ctx.dropped(ctx.worker("tracks"))).isZero();

FakeComputes.FakeCompute<?> camera = ctx.computeTask("camera-north");
camera.awaitIdle();                            // the task waits on its inbox
ctx.runUntilIdle();                            // its sends and events reach the workers
assertThat(camera.counter("rendered")).isPositive();
ctx.compute().allow(0);                        // the admin switches the threads off
ctx.compute().refuseNext(ComputeEvent.Refusal.TOTAL_CAP);
```

Other hooks: `restart(ref)` (a fresh handler, the old context fenced), `stop(ref)`, `queued(ref)`, `outstandingAsks()`, `activeTimers()`, `publishAsCore(topic, message)`, `handlerErrors()`, `logEntries()`. Compute tasks run on real platform threads in the fake, as in ECore; a task's `send` returns `ACCEPTED` or `CLOSED` at once, and a task that does not end after its stop fails `awaitIdle()` instead of being marked `Hung`. See [testing.md](testing.md).

## See also

- [connections.md](connections.md) for connection tasks, endpoints and outbound HTTP
- [objects.md](objects.md), [settings.md](settings.md), [monitor.md](monitor.md), [rules.md](rules.md)
- [ADR-0004](../../adr/0004-concurrency-workers-and-messages.md), [ADR-0021](../../adr/0021-ecore-leaf-locks.md), [ADR-0064](../../adr/0064-compute-tasks.md)
