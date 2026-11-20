package dev.emcc.ecore.plugin;

import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.channel.ChannelId;
import dev.emcc.sdk.channel.ChannelItem;
import dev.emcc.sdk.channel.ChannelList;
import dev.emcc.sdk.channel.ChannelRef;
import dev.emcc.sdk.channel.ChannelSpec;
import dev.emcc.sdk.channel.Channels;
import dev.emcc.sdk.channel.DeclaredItem;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import java.util.Map;
import java.util.Objects;
import java.util.function.Function;

/**
 * One plugin's {@code channels()} (SDK 1.2.0, ADR-0037) over the server's {@link ChannelRegistry}:
 * it offers channels as this plugin, at most {@code maxOffered} ({@code
 * emc2.channels.max-per-plugin}). The plugin host withdraws them and cancels its watches when the
 * plugin stops ({@link #release}); after that, {@code offer} and {@code watch} throw {@code
 * IllegalStateException}. SDK 1.9.0 (CR-0048 point 4): its channels may take the kinds its manifest
 * declares, and it sends declared items to any plugin's channel that takes them.
 */
final class PluginChannels implements Channels {

  private final ChannelRegistry registry;
  private final ChannelRegistry.Member member;
  private final int maxOffered;
  /** Its manifest's declared kinds' payload schemas, by kind id. */
  private final Map<String, PayloadSchema> declared;

  PluginChannels(String pluginId, ChannelRegistry registry, int maxOffered) {
    this(pluginId, registry, maxOffered, Map.of());
  }

  PluginChannels(String pluginId, ChannelRegistry registry, int maxOffered, Map<String, PayloadSchema> declared) {
    if (maxOffered < 1) {
      throw new IllegalArgumentException("maxOffered must be at least 1: " + maxOffered);
    }
    this.registry = registry;
    this.member = registry.member(pluginId);
    this.maxOffered = maxOffered;
    this.declared = Map.copyOf(declared);
  }

  /** When the plugin stops: its channels withdrawn, its watches cancelled; it can offer or watch no more. */
  void release() {
    registry.release(member);
  }

  @Override
  public <M extends Message> ChannelRef offer(ChannelSpec spec, WorkerRef<M> worker, Function<ChannelItem, ? extends M> toMessage) {
    return registry.offer(member, maxOffered, spec, PluginWorkers.handleOf(worker), toMessage);
  }

  @Override
  public <M extends Message> ChannelRef offer(ChannelSpec spec, WorkerRef<M> worker, Function<ChannelItem, ? extends M> toMessage,
      Function<DeclaredItem, ? extends M> toDeclared) {
    Objects.requireNonNull(toDeclared, "toDeclared");
    return registry.offer(member, maxOffered, spec, PluginWorkers.handleOf(worker), toMessage, toDeclared, declared);
  }

  @Override
  public <M extends Message> Cancellable watch(WorkerRef<M> target, Function<ChannelList, ? extends M> toMessage) {
    return registry.watch(member, PluginWorkers.handleOf(target), toMessage);
  }

  @Override
  public SendResult send(ChannelId channel, ChannelItem item) {
    Objects.requireNonNull(channel, "channel");
    Objects.requireNonNull(item, "item");
    if (WorkerRuntime.onFencedThread()) {
      return SendResult.DROPPED; // a worker the watchdog restarted: whatever its old thread sends is dropped
    }
    return registry.send(channel, item);
  }

  @Override
  public SendResult send(ChannelId channel, DeclaredItem item) {
    Objects.requireNonNull(channel, "channel");
    Objects.requireNonNull(item, "item");
    if (WorkerRuntime.onFencedThread()) {
      return SendResult.DROPPED; // as above
    }
    return registry.send(channel, item);
  }
}
