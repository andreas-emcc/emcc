# Streams, conversions and encoders

A **stream** carries endless binary data, such as live video, from a plugin's server part to its web part, through ECore. A **conversion** turns an MPEG-2 transport stream into H.264 straight into a stream. An **encoder** turns raw pictures that the plugin renders into H.264 access units that come back to the plugin. ECore owns every viewer's connection and runs every converter as its own process: a plugin never serves a browser connection and never starts a program ([ADR-0057](../../adr/0057-fmv-in-and-stream-channel.md)).

## Server part (Java)

All types are in `dev.emcc.sdk.stream`. Every handle (`StreamRef`, `ConversionRef`, `EncoderRef`) is immutable, equal by its `id()`, may travel in messages, and returns at once from every call.

### Streams

`context.streams().open(spec)` opens a stream from a worker, which hands the `StreamRef` to the connection task that receives the data.

| Type | What it is |
|---|---|
| `Streams` | `open(spec)`. `MAX_OPEN` 32 streams per plugin, `MAX_CHUNK` 64 KiB, `MAX_HEADER` 4 KiB, `MAX_RATE` 50 Mbit/s averaged over a second, `VIEWER_STALL` 30 s, `PATH` `/stream/` |
| `StreamSpec` | `of(name, mediaType, permission, label)`: the name `[a-z0-9][a-z0-9-]{0,63}`; the media type lower case without parameters, e.g. `video/mp2t`; the permission a viewer needs (required); the security label |
| `StreamRef` | `name()`, `write(chunk, startPoint)`, `header(bytes)`, `label(label)`, `viewers()`, `close()` |

```java
// In a worker: open, then hand the ref to the link's task.
StreamRef video = context.streams().open(
    StreamSpec.of("link-1", "video/mp2t", Permissions.ofPlugin("fmv", "view"), label));
task.post(new LinkInbox.Video(video));

// In the connection task, for each datagram:
if (video.write(Bytes.of(datagram), isRandomAccess(datagram)) == SendResult.DROPPED) {
  task.count("stream dropped", 1);
}
```

- `open` throws `IllegalStateException` when a stream of that name is open, or `MAX_OPEN` are. A closed name may be opened again. All of a plugin's streams close when it stops.
- `write(chunk, startPoint)`: 1 byte to `MAX_CHUNK` (else `IllegalArgumentException`). `startPoint` marks where a new viewer may start (for MPEG-TS, a random access point). It returns `ACCEPTED`; `DROPPED` past `MAX_RATE` or while a conversion writes to the stream; `CLOSED` once closed.
- `header(bytes)`: what each new viewer gets first, e.g. the latest PAT and PMT, until replaced; above `MAX_HEADER` it throws `IllegalArgumentException`.
- `label(label)` replaces the stream's label, e.g. when the source's classification changes. ECore keeps the label with the stream; it does not check a viewer's clearance against it yet.
- `viewers()` gives the viewers now, for the plugin's status.

**What ECore serves:** `GET /api/plugins/<plugin-id>/stream/<name>`, with the session's login and the origin check as every endpoint.
- `401` without a login, `403` without the stream's permission, `404` for a name that is not open, `503` with `Retry-After: 5` past the viewer limits.
- Else `200` at once: the spec's `Content-Type`, `Cache-Control: no-store`, chunked and endless. First the header, then the chunks since the last start point, then the live chunks. `GET` only, no ranges.
- **The start buffer** holds the chunks since the last start point, up to the ECore setting `emc2.streams.startBufferBytes` (default 16 MiB).
- **A slow viewer** never slows the plugin or the other viewers: past `emc2.streams.viewerQueueBytes` (default 4 MiB) its queue is emptied, and it resumes at the next start point, header first. A viewer that takes nothing for `VIEWER_STALL` is closed.
- **Limits:** `emc2.streams.viewersPerStream` (default 8) and `emc2.streams.viewers` (default 32 in all).
- A viewer's response ends when the stream closes, the plugin stops, the user logs out or the session ends, the viewer stalls, or the user's permissions, when ECore next reads them, lack the stream's.

### Conversions

`context.conversions().start(spec, events, toMessage)` starts ECore's conversion of an MPEG-2 video transport stream into an H.264 transport stream (the KLV and other data streams copied, the timing kept, no B-frames). The plugin writes the input to the `ConversionRef`; the output goes straight into the target stream, and ECore sets that stream's header and start points itself.

```java
ConversionRef mpeg2 = context.conversions().start(
    ConversionSpec.mpeg2ToH264(video).bitrate(6_000_000).keyframeSeconds(0.5), self, LinkMsg.Conversion::new);
task.post(new LinkInbox.Convert(mpeg2));                 // the task writes the datagrams to it
// in the task:
if (mpeg2.write(Bytes.of(datagram)) == SendResult.DROPPED) { task.count("conversion dropped", 1); }
```

- `ConversionSpec`: `kind` (`MPEG2_TS_TO_H264_TS`), `target` (a `StreamRef`), `bitrate` (`MIN_BITRATE` 500 000 to `MAX_BITRATE` 20 000 000 bit/s, default 4 000 000), `keyframeSeconds` (0.5 to 10, default 1); the keyframes are the output's start points.
- `start` throws `IllegalStateException` when the target is closed, is already the target of a conversion that has not ended, or its last conversion failed less than `RETRY_AFTER` (1 min) ago.
- `ConversionRef`: `target()`, `write(chunk)`, `stop()`. `write` returns `ACCEPTED`; `DROPPED` while it waits for a slot, past the ECore setting `emc2.conversions.inputQueueBytes` (default 2 MiB) or past `Streams.MAX_RATE`; `CLOSED` once it has ended. While a conversion runs, the plugin's own writes to its target are `DROPPED`.
- **`ConversionEvent`**, always delivered and in order: `Waiting` (no slot free; its input is dropped), `Running`, `Stopped(reason)` (e.g. "stopped", "stream closed", "plugin stopped"), `Failed(failure, detail)`. `Stopped` and `Failed` are the last.
- **Failures:** `UNAVAILABLE` (no converter installed: then it is the only event), `START` (no output `START_TIMEOUT`, 10 s, after the first input), `STALLED` (no output for `STALL_TIMEOUT`, 5 s, while input arrives), `EXITED`. ECore never restarts a failed conversion; the plugin may start one again after `RETRY_AFTER`.
- **Conversion slots:** the ECore setting `emc2.conversions.max` (default 2) caps the conversions and encoders that run. One that finds no free slot gets `Waiting`, takes the next slot that frees in the order they asked, then gets `Running`.
- **The process:** ffmpeg from the ECore setting `emc2.conversions.ffmpeg` (by default the release's `tools/ffmpeg/`), with fixed arguments, pipes only, no network and no files. At a stop ECore closes its input and kills it after `STOP_GRACE` (2 s).

### Encoders

`context.conversions().encode(spec, output, toItem, events, toMessage)` starts an encoder: raw I420 pictures in, H.264 access units out, into one of the plugin's **compute tasks** ([workers.md](workers.md)). A typical use is a compute task that renders a simulated camera, writes each picture to the encoder, and gets the access units back in its inbox.

```java
EncoderRef encoder = context.conversions().encode(EncoderSpec.of("uav-north", 1280, 720, 25),
    render, LinkItem.Encoded::new, self, LinkMsg.Encoder::new);   // render: a ComputeRef<LinkItem>
render.post(new LinkItem.Start(encoder));
// in the compute task, for each picture:
if (encoder.write(new RawPicture(now, Bytes.of(i420))) == SendResult.DROPPED) { task.count("frames dropped", 1); }
```

- `EncoderSpec.of(name, width, height, frameRate)`, `.bitrate(...)`, `.keyframeSeconds(...)`: the name as a stream's, unique among the plugin's encoders that have not ended; width even, `MIN_WIDTH` 160 to `MAX_WIDTH` 1920; height even, `MIN_HEIGHT` 120 to `MAX_HEIGHT` 1080; frame rate 1 to `MAX_FRAME_RATE` 30; bit rate and keyframe interval as a conversion's. `pictureBytes()` is `width × height × 3 / 2`.
- `RawPicture(time, data)`: YUV 4:2:0 planar (I420), the Y plane, then U, then V, exactly `pictureBytes()` bytes. One format only.
- `EncoderRef`: `name()`, `write(picture)`, `stop()`. `write` returns `ACCEPTED`; `DROPPED` while it waits for a slot, or when `MAX_WAITING` (2) pictures already wait for the process (a later one is dropped, not queued); `CLOSED` once it has ended. A picture of the wrong size throws `IllegalArgumentException`. A worker or a compute task may call it.
- `EncodedPicture(sequence, time, keyframe, accessUnit)`: one H.264 access unit in Annex B form, one per picture and in order (no B-frames); `sequence` counts from 0 per encoder, `time` is the picture's, `keyframe` marks an IDR picture.
- **The output:** each `EncodedPicture`, through `toItem`, is posted to the compute task's inbox with its overflow policy, never blocking. `EncodedPicture` is not `Coalescing`: give each item its own key (e.g. the `sequence`), and leave room in the inbox for `MAX_WAITING` pictures in flight.
- **The events** are `ConversionEvent`s, as for a conversion; their `stream()` is the encoder's name. A running encoder takes a conversion slot. The timeouts and `RETRY_AFTER` are a conversion's.
- `encode` throws `IllegalArgumentException` when `output` is not a compute task of this plugin, and `IllegalStateException` when an encoder of that name has not ended or its last one failed less than `RETRY_AFTER` ago.

## Web part (TypeScript)

`streamUrl(ctx, name)` from `@emc2/plugin-sdk` gives the URL of the plugin's stream, `${ctx.serverBase}stream/<name>`. It throws for a name that does not match `STREAM_NAME_PATTERN`. The web part plays it with its own player, bundled in its own build.

```ts
import { streamUrl } from '@emc2/plugin-sdk';

const player = mpegts.createPlayer({ type: 'mpegts', isLive: true, url: streamUrl(ctx, 'link-1') });
```

The response ends when the stream closes, for example when its link restarts: open the URL again. A new viewer starts at the last start point, so the picture is never cut.

## In the manifest

- The stream's permission, when it is the plugin's own (`plugin.<id>.view`), is declared in `permissions` ([permissions-and-labels.md](permissions-and-labels.md)).
- An encoder's output is a compute task, which needs `compute` ([manifest.md#compute](manifest.md#compute)).
- Streams, conversions and encoders need no declaration of their own.

## Rules

- Never start a program: no `ProcessBuilder`, `Process` or `ProcessHandle` (`PluginRules`). Conversions and encoders are ECore's.
- Never hold a browser connection: write chunks to a `StreamRef`, and let ECore serve the viewers.
- Name a permission for every stream, usually the plugin's own.
- Count every `DROPPED` write, and tell the user when a conversion or an encoder waits for a slot or failed: in the plugin's status, and for an output channel in its state ([channels.md](channels.md)).
- Close a stream when its link stops, and open it again under the same name.
- Start a failed conversion or encoder again only after `Conversions.RETRY_AFTER`.

## Testing

```java
var ctx = FakePluginContext.builder("fmv").settings(links).compute(2).build();
FakeStreams.FakeStream video = ctx.stream("link-1");
assertThat(video.startPoints()).containsExactly(0, 12);
FakeStreams.FakeViewer viewer = video.join();          // gets what ECore would send a new viewer

ctx.conversions().holdNew(true);                         // no slot free: the next start is Waiting
FakeConversions.FakeConversion c = ctx.conversions().conversion("link-1");
c.run();                                                 // a slot freed: Running
c.fail(ConversionEvent.Failure.STALLED, "");

FakeConversions.FakeEncoder e = ctx.conversions().encoder("uav-north");
ctx.computeTask("render").awaitIdle();                   // the task wrote its pictures
e.emit(true, Bytes.of(new byte[] {0, 0, 0, 1, 9, 16})); // an IDR for the oldest waiting picture
```

- `FakeStream`: `chunks()`, `startPoints()`, `header()`, `label()`, `dropped()`, `isClosed()`, `join()`. It does not measure `MAX_RATE`, has no viewer queues and serves no HTTP.
- `FakeConversion` runs no program: while running, it copies its input to the target unchanged, marking start points by the random access indicator. `input()`, `dropped()`, `state()`.
- `FakeEncoder` runs no program either: `pictures()`, `waiting()`, `dropped()`, `emitted()`, `run()`, `fail(...)`, and `emit(keyframe, accessUnit)`, which posts to the compute task's inbox through `toItem` at once. `stopEncoders()` stops them as ECore does when the plugin stops.

See [testing.md](testing.md).

## See also

- [connections.md](connections.md), [workers.md](workers.md) (compute tasks), [channels.md](channels.md), [monitor.md](monitor.md), [permissions-and-labels.md](permissions-and-labels.md)
- [ADR-0057](../../adr/0057-fmv-in-and-stream-channel.md) (streams and conversions), [ADR-0059](../../adr/0059-uav-simulation-plugin.md) (encoders), [ADR-0064](../../adr/0064-compute-tasks.md) (compute tasks)
- Source: [`Streams`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/stream/Streams.java), [`Conversions`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/stream/Conversions.java), [`EncoderRef`](../../../server/plugin-sdk/api/src/main/java/dev/emcc/sdk/stream/EncoderRef.java), [`stream.ts`](../../../web/plugin-sdk/src/stream.ts)
