package dev.emcc.sdk.testkit.sample.good;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.document.DocumentResult;
import dev.emcc.sdk.http.EndpointRequest;
import dev.emcc.sdk.listener.Listener;
import dev.emcc.sdk.listener.ListenerConnection;
import dev.emcc.sdk.listener.ListenerContext;
import dev.emcc.sdk.listener.ListenerEvent;
import dev.emcc.sdk.listener.ListenerRef;
import dev.emcc.sdk.store.ChangeOutcome;
import dev.emcc.sdk.store.StoreUpdate;
import dev.emcc.sdk.worker.WorkerRef;
import java.io.IOException;
import java.io.InputStream;
import dev.emcc.sdk.worker.WorkerSpec;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** Follows every rule: a worker instead of threads, record messages with allowed component types, a listener that reads its connection. */
public final class GoodPlugin implements Plugin {

  public sealed interface Msg extends Message {}

  /** An own value record used inside messages; its components are checked too. */
  public record TileKey(int z, int x, int y) {}

  public record Data(String name, Bytes body, List<String> tags, Map<String, TileKey> keys, UUID id, Instant at) implements Msg {
    public Data {
      tags = List.copyOf(tags);
      keys = Map.copyOf(keys);
    }
  }

  public record Get(TileKey key, EndpointRequest request) implements Msg {}

  public enum Tick implements Msg { INSTANCE }

  /** SDK v1 values in messages: outcomes, updates, events and handles are allowed. */
  public record V1(ChangeOutcome outcome, StoreUpdate update, ListenerEvent event, ListenerRef listener, DocumentResult document) implements Msg {}

  public record Line(Bytes text) implements Msg {}

  /** SDK 1.2.0 values in messages: channel items, lists, ids and handles, classifications and picked layers are allowed. */
  public record V12(dev.emcc.sdk.channel.ChannelItem item, dev.emcc.sdk.channel.ChannelList list, dev.emcc.sdk.channel.ChannelId id, dev.emcc.sdk.channel.ChannelRef channel,
      dev.emcc.sdk.Classifications orders, dev.emcc.sdk.ClassificationLimit limit, dev.emcc.sdk.LayerChoice layer) implements Msg {}

  /** A listener loop: it reads the connection ECore opened (allowed) and sends what it reads to a worker. */
  public static final class Reader implements Listener {
    private final WorkerRef<Msg> target;

    public Reader(WorkerRef<Msg> target) {
      this.target = target;
    }

    @Override
    public void run(ListenerConnection connection, ListenerContext ctx) throws IOException {
      InputStream in = connection.input();
      byte[] buffer = new byte[1024];
      for (int n; (n = in.read(buffer)) >= 0 && !ctx.stopping(); ) {
        ctx.send(target, new Line(Bytes.of(java.util.Arrays.copyOf(buffer, n))));
      }
    }
  }

  private static final String WORKER = "main";

  @Override
  public void init(PluginContext context) {
    context.workers().spawn(WorkerSpec.of(WORKER, Msg.class, () -> (m, c) -> c.log().info("got {}", m)));
  }

  @Override
  public void start() {}

  @Override
  public void stop() {}
}
