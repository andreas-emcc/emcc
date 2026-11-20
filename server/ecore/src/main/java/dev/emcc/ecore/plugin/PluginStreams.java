package dev.emcc.ecore.plugin;

import dev.emcc.sdk.stream.StreamRef;
import dev.emcc.sdk.stream.StreamSpec;
import dev.emcc.sdk.stream.Streams;

/**
 * One plugin's {@code streams()} (SDK 1.8.0, CR-0044 E1) over the server's {@link StreamHub}. The
 * plugin host releases it when the plugin stops ({@link #release}): its streams close, their
 * viewers' responses end, and {@code open} throws {@code IllegalStateException}.
 */
final class PluginStreams implements Streams {

  private final StreamHub hub;
  private final StreamHub.Member member;

  PluginStreams(String pluginId, StreamHub hub) {
    this.hub = hub;
    this.member = hub.member(pluginId);
  }

  void release() {
    hub.release(member);
  }

  @Override
  public StreamRef open(StreamSpec spec) {
    return member.open(spec);
  }
}
