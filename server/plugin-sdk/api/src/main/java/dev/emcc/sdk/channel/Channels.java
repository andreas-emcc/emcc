package dev.emcc.sdk.channel;

import dev.emcc.sdk.Cancellable;
import dev.emcc.sdk.Message;
import dev.emcc.sdk.worker.SendResult;
import dev.emcc.sdk.worker.WorkerRef;
import java.util.function.Function;

/**
 * SDK 1.2.0: output channels (ADR-0037). An output plugin offers one channel per output link;
 * other plugins' server parts watch the list and send to the channels they choose.
 *
 * <pre>{@code
 * // the output plugin, for each output link:
 * ChannelRef ch = context.channels().offer(
 *     ChannelSpec.of("tak-north", "TAK North (out)", "cot").can(ChannelCapability.DELETE),
 *     linkWorker, LinkMsg.FromChannel::new);           // each ChannelItem, as a message
 *
 * // a sender:
 * context.channels().watch(simWorker, SimMsg.Channels::new);   // the current list, then each change
 * SendResult r = context.channels().send(channelId, new ChannelItem.Update(id, content));
 * }</pre>
 *
 * <p><b>Delivery:</b> ECore keeps one inbox per channel that keeps only the latest item per object
 * id: a later update replaces a pending one, and a removal replaces a pending update. It hands the
 * items to the offering plugin's worker one at a time, each as a message through the mapper, with
 * at most {@link #MAX_IN_FLIGHT} handed over and not yet handled, so a slow protocol never builds a
 * growing queue (ADR-0037 point 6). The worker usually posts them on to its connection task's
 * inbox, which coalesces by the same key.
 *
 * <p>A plugin offers at most {@link #MAX_OFFERED} channels (an ECore setting).
 *
 * <p><b>SDK 1.9.0 (CR-0048 point 4): declared kinds.</b> A channel may also take kinds its own
 * plugin declares ({@link ChannelSpec#declaredKinds}); their items are {@link DeclaredItem}s, sent
 * with {@link #send(ChannelId, DeclaredItem)} and delivered through the {@code toDeclared} mapper of
 * {@link #offer(ChannelSpec, WorkerRef, Function, Function)}. The inbox and its limits are the same.
 */
public interface Channels {

  /** The default cap on the channels one plugin offers. */
  int MAX_OFFERED = 100;

  /** How many items of one channel may wait in the offering worker's mailbox; the rest wait, coalesced, in the channel's inbox. */
  int MAX_IN_FLIGHT = 16;

  /** How many objects one channel's inbox holds; beyond it, the oldest pending item goes and is counted in the monitor view. */
  int MAX_PENDING = 10_000;

  /**
   * Offers a channel for one of the plugin's output links. Each item sent to it reaches {@code
   * worker}, converted by {@code toMessage} (plugin code: pure, non-blocking, run in that worker).
   * Watchers get the new list.
   *
   * @throws IllegalArgumentException if the plugin offers a channel for that link already
   * @throws IllegalStateException if the plugin already offers {@link #MAX_OFFERED} channels, or once the plugin has stopped
   */
  <M extends Message> ChannelRef offer(ChannelSpec spec, WorkerRef<M> worker, Function<ChannelItem, ? extends M> toMessage);

  /**
   * Delivers the current {@link ChannelList} to {@code target}, then a new one at each change,
   * converted by {@code toMessage} (plugin code: pure, non-blocking, run in that worker). Always
   * delivered, whatever the overflow policy; when several are undelivered only the latest is kept.
   * The list holds every plugin's channels, the watcher's own included.
   *
   * @throws IllegalStateException once the plugin has stopped
   */
  <M extends Message> Cancellable watch(WorkerRef<M> target, Function<ChannelList, ? extends M> toMessage);

  /**
   * Puts {@code item} into the channel's inbox and returns at once (rule C5): {@link
   * SendResult#ACCEPTED}, also when it replaced a pending item of the same object; {@link
   * SendResult#CLOSED} when no channel has that id now (never offered, or withdrawn). Callable
   * from any worker, and in ECore from any thread, connection tasks included.
   *
   * @throws IllegalArgumentException SDK 1.4.0: if the channel exists and does not take the item's
   *     {@link ChannelItem#kind() kind} ({@link ChannelInfo#kinds()}), a sender's mistake: senders
   *     send a channel only the kinds it takes (ADR-0048 point 4)
   */
  SendResult send(ChannelId channel, ChannelItem item);

  /**
   * SDK 1.9.0 (CR-0048 point 4): offers a channel that may take declared kinds. Items of the
   * {@link ChannelKind}s reach {@code worker} through {@code toMessage}, as with {@link
   * #offer(ChannelSpec, WorkerRef, Function)}; {@link DeclaredItem}s through {@code toDeclared} (both
   * plugin code: pure, non-blocking, run in that worker).
   *
   * <p>Abstract since the 1.9.0 freeze (a default method that threw until ECore gave it, C8). The
   * test kit's {@code FakeChannels} gives it.
   *
   * @throws IllegalArgumentException as {@link #offer(ChannelSpec, WorkerRef, Function)}, and if the
   *     spec names a declared kind that is not its own plugin's, or that its manifest does not declare
   * @throws IllegalStateException as {@link #offer(ChannelSpec, WorkerRef, Function)}
   */
  <M extends Message> ChannelRef offer(
      ChannelSpec spec, WorkerRef<M> worker, Function<ChannelItem, ? extends M> toMessage, Function<DeclaredItem, ? extends M> toDeclared);

  /**
   * SDK 1.9.0 (CR-0048 point 4): puts {@code item} into the channel's inbox and returns at once, as
   * {@link #send(ChannelId, ChannelItem)} does: {@link SendResult#ACCEPTED}, also when it replaced a
   * pending item of the same {@link DeclaredItem#id()}; {@link SendResult#CLOSED} when no channel has
   * that id now.
   *
   * <p>Abstract since the 1.9.0 freeze (a default method that threw until ECore gave it, C8). The
   * test kit's {@code FakeChannels} gives it.
   *
   * @throws IllegalArgumentException if the channel exists and does not take the item's kind ({@link
   *     ChannelInfo#takesDeclared}), if the payload is larger than {@link
   *     DeclaredItem#MAX_PAYLOAD_BYTES} as compact UTF-8 JSON, or if it does not match the kind's
   *     {@code payload} schema; the message names the first problem. Each is a sender's mistake
   */
  SendResult send(ChannelId channel, DeclaredItem item);
}
