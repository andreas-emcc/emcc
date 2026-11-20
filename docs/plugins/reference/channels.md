# Output channels

An **output channel** carries data out of emcc without a layer. Every output link of a plugin (for example a link to a TAK Server) is also an output channel: the plugin **offers** it, and other plugins' server parts **watch** the list of channels and **send** objects, sensor reports or items of a declared kind to the ones they choose, never blocking. Use it to send to another system, and to let other plugins, such as a simulator, send there too ([ADR-0037](../../adr/0037-links-and-output-channels.md)).

## Server part (Java)

`context.channels()` gives `Channels` (`dev.emcc.sdk.channel`).

| Type | What it is |
|---|---|
| `Channels` | `offer(spec, worker, toMessage)`, `offer(spec, worker, toMessage, toDeclared)`, `watch(target, toMessage)`, `send(id, ChannelItem)`, `send(id, DeclaredItem)`. `MAX_OFFERED` 100 channels per plugin, `MAX_IN_FLIGHT` 16, `MAX_PENDING` 10 000 |
| `ChannelSpec` | What a plugin offers: `of(link, name, outputType)`, `.can(...)`, `.kinds(...)`, `.fieldSet(...)`, `.maxAreaDepth(metres)`, `.sensorTypes(...)`, `.declaredKinds(...)` |
| `ChannelId` | The offering plugin and the link: `new ChannelId("cot", "tak-north")`, shown and parsed as `cot/tak-north` |
| `ChannelRef` | The offered channel: `id()`, `withdraw()`, `state(state, detail)` |
| `ChannelInfo` | A channel as senders see it: the spec's values, `state()`, `stateDetail()`; `takes(kind)`, `takesDeclared(kind)`, `takesSensorType(type)`, `canDelete()` |
| `ChannelList` | The channels offered now, sorted by plugin, then link: `channels()`, `find(id)`, `ofType(outputType)` |
| `ChannelItem` | `Update(id, content)`, `Removal(id)`, `SensorReport(...)` |
| `ChannelKind` | `GROUND_TRUTH` (updates and removals), `SENSOR_REPORTS` |
| `DeclaredItem` | `(kind, id, label, payload)`: an item of a kind a plugin declares |
| `ChannelState` | `READY`, `DEGRADED`, `NOT_SENDING` |

### Offering a channel

```java
// The output plugin, when an output link appears in its settings:
ChannelRef ch = context.channels().offer(
    ChannelSpec.of(link.name(), "TAK North (out)", "cot")
        .can(ChannelCapability.DELETE)
        .kinds(Set.of(ChannelKind.GROUND_TRUTH, ChannelKind.SENSOR_REPORTS))
        .fieldSet("cot.unit"),
    linkWorker, LinkMsg.FromChannel::new);      // each ChannelItem, as a message
// ... when the link goes:
ch.withdraw();
```

- **The link-name rule:** `link` names the channel within the plugin: lowercase words joined by hyphens, starting with a letter, at most 64 characters, unique among the plugin's channels. A sender keeps a channel by its `ChannelId` (`<plugin-id>/<link>`). **Two choices:** the link's name (a rename gives a new channel, and senders show the old one as missing), or a name from the link's stable item id, such as `"out-" + id` (an item id may start with a digit, so it needs the prefix), which keeps the channel through a rename. The display name (`name`) is the link's name either way.
- `name` is the display name (1 to 128 characters); `outputType` what it sends, e.g. `cot` (lowercase words joined by hyphens).
- `can(ChannelCapability.DELETE)`: the channel can send a delete. Without it, a `Removal` only stops the channel sending the object.
- `kinds`: what it takes, `GROUND_TRUTH` by default. `maxAreaDepth(metres)` and `sensorTypes(...)` need `SENSOR_REPORTS`, so set the kinds first.
- `fieldSet("<plugin-id>.<set>")`: the field set its protocol uses; a sender adds it to the objects it sends ([objects.md](objects.md)).
- `offer` throws `IllegalArgumentException` when the plugin already offers a channel for that link, and `IllegalStateException` at `MAX_OFFERED` or once the plugin has stopped.

**Delivery:** ECore keeps one inbox per channel that keeps only the latest item per key: the object's id (a sensor report's sensor, and its dwell number when it has a sequence). A later update replaces a pending one, and a removal replaces a pending update. ECore hands the items to the offering worker one at a time through the mapper, with at most `MAX_IN_FLIGHT` handed over and not yet handled. Past `MAX_PENDING` objects, the oldest pending item goes and is counted. The worker usually posts each item on to its link's connection task, whose inbox coalesces by the same key ([connections.md](connections.md)).

### Declared channel kinds

A plugin that needs data the SDK's items do not carry declares its own **channel kind**, with a JSON payload whose shape its manifest gives. The kind's id is `<plugin-id>.<name>`, e.g. `fmv.camera-pose`.

```java
// The declaring plugin's channel takes its own kind, and nothing else:
ChannelRef ch = context.channels().offer(
    ChannelSpec.of("uav-north", "UAV North (out)", "stanag-4609")
        .declaredKinds(Set.of("fmv.camera-pose")).kinds(Set.of()),
    linkWorker, LinkMsg.FromChannel::new, LinkMsg.Pose::new);   // toMessage, toDeclared

// A sender:
if (info.takesDeclared("fmv.camera-pose")) {
  context.channels().send(info.id(), new DeclaredItem("fmv.camera-pose", cameraId, platformLabel, pose));
}
```

- A channel takes at least one kind of either sort; with declared kinds, `kinds` may be empty. At most `ChannelSpec.MAX_DECLARED_KINDS` (16).
- `offer` throws `IllegalArgumentException` for a declared kind that is not its own plugin's, or that its manifest does not declare.
- `DeclaredItem(kind, id, label, payload)`: `id` (a UUID) is what the receiver keeps the newest of, and the inbox coalesces by it. `label` is the security label of what the item describes, for the receiver's highest classification.
- `send` checks the item: it throws `IllegalArgumentException` when the channel does not take the kind, when the payload is larger than `DeclaredItem.MAX_PAYLOAD_BYTES` (64 KiB) as compact UTF-8 JSON, or when it does not match the kind's schema. The message names the first problem.

### Watching and sending

```java
context.channels().watch(simWorker, SimMsg.Channels::new);   // the current list, then each change
// in the handler:
for (ChannelInfo c : list.ofType("cot")) {
  if (c.takes(ChannelKind.GROUND_TRUTH) && c.state() == ChannelState.READY) { chosen.add(c.id()); }
}
SendResult r = context.channels().send(channelId, new ChannelItem.Update(id, content));
```

- `watch` delivers the whole `ChannelList` at once, then a new one at each change, always delivered; when several wait undelivered, only the latest is kept. The list holds every plugin's channels, the watcher's own included. It returns a `Cancellable`; it throws `IllegalStateException` once the plugin has stopped.
- `send` puts the item into the channel's inbox and returns at once: `ACCEPTED` (also when it replaced a pending item), or `CLOSED` when no channel has that id now. It throws `IllegalArgumentException` when the channel exists and does not take the item's kind. It may be called from any worker and from a connection task.
- A `SensorReport` goes only to channels that take `SENSOR_REPORTS` and the sensor's type (`takesSensorType`). A sender warns about detections beyond the near edge plus `maxAreaDepth`, since the channel leaves them out.

### The highest classification

Every output link has a `highestClassification` setting, `{ "policy": ..., "classification": ... }`, whose absence means the server's default label's.

```java
ClassificationLimit limit = ClassificationLimit.from(link.get("highestClassification"), context.defaultLabel());
if (!context.classifications().knows(limit)) { /* nothing passes: say so in the status */ }
if (!context.classifications().within(content.label(), limit)) { ref.count("skipped: above the classification", 1); }
```

An object above the limit, of another policy, or with a classification outside the configured order is skipped and counted. Policy names match ignoring case; classifications match exactly. See [permissions-and-labels.md](permissions-and-labels.md).

### The channel's state for its senders

The offering plugin tells senders how its channel is, so that a sender can show it to its user, e.g. "No destination".

- `ChannelState`: `READY` (it sends; the default), `DEGRADED` (it sends, with a fault, e.g. frames late), `NOT_SENDING` (it takes items but sends nothing, e.g. no destination, no render thread, or waiting for a conversion slot). It is the channel's own state, not per item.
- `ChannelRef.state(state, detail)` sets it. `detail` is plain text, 0 to `ChannelInfo.MAX_STATE_DETAIL` (128) characters, without control characters; otherwise `IllegalArgumentException`. Watchers get a new list at each change; the same state and detail again change nothing. A channel starts `READY` with an empty detail. It does nothing once withdrawn.
- Senders read `ChannelInfo.state()` and `stateDetail()`. `ChannelInfo.withState(state, detail)` gives the same channel with another state, as ECore lists it.

```java
ch.state(ChannelState.NOT_SENDING, "No destination");
```

## In the manifest

- **`channelKinds`** ([manifest.md#channelkinds](manifest.md#channelkinds)): 1 to 16 kinds, each with `name` (lowercase words joined by hyphens, at most 64 characters), `title`, `description` and `payload`, a JSON Schema of an object, self-contained (a `$ref` only inside it, `#/...`).
- The output link's own settings: the links list, `sourceLayers`, `highestClassification` ([settings.md](settings.md)).

```json
"channelKinds": [{
  "name": "camera-pose", "title": "Camera pose",
  "description": "Where a camera is and where it looks, sent at each change.",
  "payload": { "type": "object", "properties": { "camera": { "type": "string" } }, "required": ["camera"] }
}]
```

## Rules

- Offer one channel per output link, and withdraw it when the link goes.
- Never send an object back to its own link: skip an `Update` whose content's `dataSource` is the link itself.
- Send a channel only the kinds it takes; anything else throws.
- Skip what is above the link's highest classification, and count every skip per link and reason ([monitor.md](monitor.md)). Log skips at most once a minute per link.
- A receiver that switches over `ChannelItem` has a case for `SensorReport`, or a `default`.
- Change a declared kind compatibly only; an incompatible change is a new kind. Document its payload in the plugin's README.
- A sender keeps a chosen channel by its `ChannelId` and shows one that is gone as missing, never drops it silently.

## Testing

`FakePluginContext.channels()` is a `FakeChannels`: one inbox per offered channel, items handed to the worker at `ctx.runUntilIdle()`.

```java
var ctx = FakePluginContext.builder("simulator").build();
ctx.channels().addOther(ChannelInfo.of("cot", ChannelSpec.of("tak-north", "TAK North (out)", "cot")));
ctx.channels().setOtherState(new ChannelId("cot", "tak-north"), ChannelState.NOT_SENDING, "No destination");
plugin.init(ctx); plugin.start(); ctx.runUntilIdle();
assertThat(ctx.channels().sent(new ChannelId("cot", "tak-north"))).hasSize(1);

// an output plugin: drive its channel as a sender would
ctx.channels().deliver(new ChannelId("myplugin", "tak-north"), new ChannelItem.Removal(id));
ctx.runUntilIdle();
```

- `addOther`, `removeOther` and `setOtherState` script other plugins' channels; `sent(id)` and `sentDeclared(id)` record what was sent to them.
- `deliver(id, item)` drives the plugin's own channel; `pending(id)`, `pendingDeclared(id)`, `offered()` and `list()` show the state.
- `declare(kind, payloadSchema)` declares a kind for the test, the plugin's own or another's; `send` then checks items as ECore does.
- `release()` after the plugin's `stop()`: from then on `offer` and `watch` throw.
- `Builder.classifications(...)` sets the order (NATO by default); `Builder.maxChannels(n)` lowers the cap.
- The fake hands over one item at a time, so it coalesces more than ECore: never test that an item is replaced after it was handed over.

## See also

- [connections.md](connections.md), [streams.md](streams.md), [objects.md](objects.md), [permissions-and-labels.md](permissions-and-labels.md), [monitor.md](monitor.md), [testing.md](testing.md)
- [ADR-0037](../../adr/0037-links-and-output-channels.md) (links and output channels), [ADR-0048](../../adr/0048-gmti-and-sensor-outputs.md) (sensor reports), [ADR-0059](../../adr/0059-uav-simulation-plugin.md) (declared kinds, the channel's state)
- Source: [`channel/`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/channel/Channels.java), [`ClassificationLimit`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/ClassificationLimit.java), [`FakeChannels`](../../../server/plugin-sdk/testkit/src/main/java/dev/emcc/sdk/testkit/FakeChannels.java)
