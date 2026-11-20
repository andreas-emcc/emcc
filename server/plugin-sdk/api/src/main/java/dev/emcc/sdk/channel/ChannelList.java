package dev.emcc.sdk.channel;

import java.util.HashSet;
import java.util.List;
import java.util.Optional;

/**
 * SDK 1.2.0: the output channels offered now, in a stable order (by plugin, then link). A watcher
 * gets the whole list at each change ({@link Channels#watch}), since channels come and go with
 * links.
 *
 * @param channels the channels, each id once; kept by plugin, then link
 */
public record ChannelList(List<ChannelInfo> channels) {

  public ChannelList {
    var sorted = new java.util.ArrayList<>(channels);
    sorted.sort(java.util.Comparator.comparing((ChannelInfo c) -> c.id().plugin()).thenComparing(c -> c.id().link()));
    channels = List.copyOf(sorted);
    var ids = new HashSet<ChannelId>();
    for (ChannelInfo c : channels) {
      if (!ids.add(c.id())) {
        throw new IllegalArgumentException("a channel is listed twice: " + c.id());
      }
    }
  }

  /** No channels. */
  public static ChannelList empty() {
    return new ChannelList(List.of());
  }

  /** The channel with {@code id}, if it is offered now. */
  public Optional<ChannelInfo> find(ChannelId id) {
    return channels.stream().filter(c -> c.id().equals(id)).findFirst();
  }

  /** The channels that send {@code outputType}, e.g. {@code cot}. */
  public List<ChannelInfo> ofType(String outputType) {
    return channels.stream().filter(c -> c.outputType().equals(outputType)).toList();
  }
}
