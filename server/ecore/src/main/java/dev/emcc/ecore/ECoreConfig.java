package dev.emcc.ecore;

import dev.emcc.ecore.live.LiveGateway;
import dev.emcc.ecore.plugin.ComputeHub;
import dev.emcc.ecore.plugin.ConversionLimits;
import dev.emcc.ecore.plugin.ListenerConfig;
import dev.emcc.ecore.plugin.PluginHost;
import dev.emcc.ecore.plugin.StreamLimits;
import dev.emcc.ecore.runtime.OwnerLimits;
import dev.emcc.ecore.runtime.RuntimeConfig;
import dev.emcc.sdk.model.SecurityLabel;
import java.nio.file.Path;
import java.time.Clock;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * Configuration of ECore. Immutable; the methods return a changed copy.
 *
 * @param runtime the worker runtime
 * @param dataDirectory where the file store keeps the live picture; {@code null} keeps it in memory
 *     only (tests)
 * @param defaultLabel the configured default security label (overview 4.9), e.g. for the seeded
 *     "Drawing" layer
 * @param clock wall-clock time for change events and meta data
 * @param compactEvery after how many journal events the persistence manager writes a new snapshot
 * @param pluginsDirectory the installed plugins ({@code <id>/plugin.json}, {@code <id>/server/*.jar},
 *     {@code <id>/web/}); {@code null} runs without plugins
 * @param liveSessions how many browser sessions the live picture gateway allows at a time
 * @param liveMaxBudget the most objects a live picture subscription gets individually; above, clusters
 * @param pluginLimits the caps of every plugin on outstanding asks and active timers (CR-0005)
 * @param listeners the caps on listeners and connection tasks, and the TLS credentials
 * @param classificationOrders the order of each policy's classifications, lowest first, as
 *     configured, for the plugins' {@code classifications()} (SDK 1.2.0; {@code
 *     emc2.classifications.order}); the plugin host checks it
 * @param maxChannelsPerPlugin the most output channels one plugin offers (SDK 1.2.0; {@code
 *     emc2.channels.max-per-plugin})
 * @param allocationSampling whether the monitor samples allocation with JFR for ECore's share
 *     (T-148; {@code emc2.monitor.allocation}); without, it shows the JVM's total only
 * @param streams the stream channel's limits (SDK 1.8.0, CR-0044 E1; {@code emc2.streams.*})
 * @param conversions the conversion service's settings (SDK 1.8.0, CR-0044 E2, T-211; {@code emc2.conversions.*})
 * @param computeCap the most compute tasks of all plugins together (SDK 1.9.0, ADR-0064 point 4; {@code
 *     emc2.compute.max-threads}), by default the cores minus one, at least one
 */
public record ECoreConfig(
    RuntimeConfig runtime, @Nullable Path dataDirectory, SecurityLabel defaultLabel, Clock clock, int compactEvery,
    @Nullable Path pluginsDirectory, int liveSessions, int liveMaxBudget, OwnerLimits pluginLimits, ListenerConfig listeners,
    Map<String, List<String>> classificationOrders, int maxChannelsPerPlugin, boolean allocationSampling, StreamLimits streams,
    ConversionLimits conversions, int computeCap) {

  public ECoreConfig {
    if (computeCap < 1) {
      throw new IllegalArgumentException("computeCap must be at least 1: " + computeCap);
    }
    Objects.requireNonNull(streams, "streams");
    Objects.requireNonNull(conversions, "conversions");
    Objects.requireNonNull(runtime, "runtime");
    Objects.requireNonNull(defaultLabel, "defaultLabel");
    Objects.requireNonNull(clock, "clock");
    Objects.requireNonNull(pluginLimits, "pluginLimits");
    Objects.requireNonNull(listeners, "listeners");
    Map<String, List<String>> orders = new LinkedHashMap<>();
    Objects.requireNonNull(classificationOrders, "classificationOrders").forEach((policy, order) -> orders.put(policy, List.copyOf(order)));
    classificationOrders = Collections.unmodifiableMap(orders); // in the configured order
    if (maxChannelsPerPlugin < 1) {
      throw new IllegalArgumentException("maxChannelsPerPlugin must be at least 1: " + maxChannelsPerPlugin);
    }
    if (liveSessions < 1) {
      throw new IllegalArgumentException("liveSessions must be at least 1: " + liveSessions);
    }
    if (liveMaxBudget < 1) {
      throw new IllegalArgumentException("liveMaxBudget must be at least 1: " + liveMaxBudget);
    }
    if (compactEvery < 1) {
      throw new IllegalArgumentException("compactEvery must be at least 1: " + compactEvery);
    }
  }

  /**
   * Default runtime, in-memory store, label NATO UNCLASSIFIED, system clock, compaction every 10 000
   * events, no plugins, at most 200 live sessions with a budget of at most 100 000, plugin caps of 10 000 outstanding asks and 1 000
   * active timers, NATO's order of classifications, 100 output channels per plugin, no allocation
   * sampling, CR-0044's stream limits.
   */
  public static ECoreConfig defaults() {
    return new ECoreConfig(
        RuntimeConfig.defaults(), null, SecurityLabel.of("NATO", "UNCLASSIFIED"), Clock.systemUTC(), 10_000, null,
        LiveGateway.DEFAULT_MAX_SESSIONS, LiveGateway.DEFAULT_MAX_BUDGET, PluginHost.DEFAULT_LIMITS, ListenerConfig.DEFAULT,
        PluginHost.DEFAULT_CLASSIFICATION_ORDERS, PluginHost.DEFAULT_MAX_CHANNELS, false, StreamLimits.DEFAULT, ConversionLimits.DEFAULT,
        ComputeHub.defaultCap());
  }

  public ECoreConfig runtime(RuntimeConfig newRuntime) {
    return new ECoreConfig(
        newRuntime, dataDirectory, defaultLabel, clock, compactEvery, pluginsDirectory, liveSessions, liveMaxBudget,
        pluginLimits, listeners, classificationOrders, maxChannelsPerPlugin, allocationSampling, streams, conversions, computeCap);
  }

  public ECoreConfig dataDirectory(@Nullable Path directory) {
    return new ECoreConfig(
        runtime, directory, defaultLabel, clock, compactEvery, pluginsDirectory, liveSessions, liveMaxBudget,
        pluginLimits, listeners, classificationOrders, maxChannelsPerPlugin, allocationSampling, streams, conversions, computeCap);
  }

  public ECoreConfig defaultLabel(SecurityLabel label) {
    return new ECoreConfig(
        runtime, dataDirectory, label, clock, compactEvery, pluginsDirectory, liveSessions, liveMaxBudget,
        pluginLimits, listeners, classificationOrders, maxChannelsPerPlugin, allocationSampling, streams, conversions, computeCap);
  }

  public ECoreConfig clock(Clock newClock) {
    return new ECoreConfig(
        runtime, dataDirectory, defaultLabel, newClock, compactEvery, pluginsDirectory, liveSessions, liveMaxBudget,
        pluginLimits, listeners, classificationOrders, maxChannelsPerPlugin, allocationSampling, streams, conversions, computeCap);
  }

  public ECoreConfig pluginsDirectory(@Nullable Path directory) {
    return new ECoreConfig(
        runtime, dataDirectory, defaultLabel, clock, compactEvery, directory, liveSessions, liveMaxBudget,
        pluginLimits, listeners, classificationOrders, maxChannelsPerPlugin, allocationSampling, streams, conversions, computeCap);
  }

  public ECoreConfig liveSessions(int limit) {
    return new ECoreConfig(
        runtime, dataDirectory, defaultLabel, clock, compactEvery, pluginsDirectory, limit, liveMaxBudget,
        pluginLimits, listeners, classificationOrders, maxChannelsPerPlugin, allocationSampling, streams, conversions, computeCap);
  }

  public ECoreConfig liveMaxBudget(int budget) {
    return new ECoreConfig(
        runtime, dataDirectory, defaultLabel, clock, compactEvery, pluginsDirectory, liveSessions, budget,
        pluginLimits, listeners, classificationOrders, maxChannelsPerPlugin, allocationSampling, streams, conversions, computeCap);
  }

  public ECoreConfig pluginLimits(OwnerLimits limits) {
    return new ECoreConfig(
        runtime, dataDirectory, defaultLabel, clock, compactEvery, pluginsDirectory, liveSessions, liveMaxBudget,
        limits, listeners, classificationOrders, maxChannelsPerPlugin, allocationSampling, streams, conversions, computeCap);
  }

  public ECoreConfig compactEvery(int events) {
    return new ECoreConfig(
        runtime, dataDirectory, defaultLabel, clock, events, pluginsDirectory, liveSessions, liveMaxBudget,
        pluginLimits, listeners, classificationOrders, maxChannelsPerPlugin, allocationSampling, streams, conversions, computeCap);
  }

  public ECoreConfig listeners(ListenerConfig config) {
    return new ECoreConfig(
        runtime, dataDirectory, defaultLabel, clock, compactEvery, pluginsDirectory, liveSessions, liveMaxBudget,
        pluginLimits, config, classificationOrders, maxChannelsPerPlugin, allocationSampling, streams, conversions, computeCap);
  }

  public ECoreConfig classificationOrders(Map<String, List<String>> orders) {
    return new ECoreConfig(
        runtime, dataDirectory, defaultLabel, clock, compactEvery, pluginsDirectory, liveSessions, liveMaxBudget,
        pluginLimits, listeners, orders, maxChannelsPerPlugin, allocationSampling, streams, conversions, computeCap);
  }

  public ECoreConfig maxChannelsPerPlugin(int max) {
    return new ECoreConfig(
        runtime, dataDirectory, defaultLabel, clock, compactEvery, pluginsDirectory, liveSessions, liveMaxBudget,
        pluginLimits, listeners, classificationOrders, max, allocationSampling, streams, conversions, computeCap);
  }

  public ECoreConfig allocationSampling(boolean on) {
    return new ECoreConfig(
        runtime, dataDirectory, defaultLabel, clock, compactEvery, pluginsDirectory, liveSessions, liveMaxBudget,
        pluginLimits, listeners, classificationOrders, maxChannelsPerPlugin, on, streams, conversions, computeCap);
  }

  public ECoreConfig streams(StreamLimits limits) {
    return new ECoreConfig(
        runtime, dataDirectory, defaultLabel, clock, compactEvery, pluginsDirectory, liveSessions, liveMaxBudget,
        pluginLimits, listeners, classificationOrders, maxChannelsPerPlugin, allocationSampling, limits, conversions, computeCap);
  }

  public ECoreConfig conversions(ConversionLimits settings) {
    return new ECoreConfig(
        runtime, dataDirectory, defaultLabel, clock, compactEvery, pluginsDirectory, liveSessions, liveMaxBudget,
        pluginLimits, listeners, classificationOrders, maxChannelsPerPlugin, allocationSampling, streams, settings, computeCap);
  }

  /** SDK 1.9.0 (ADR-0064 point 4): the cap on all plugins' compute tasks ({@code emc2.compute.max-threads}). */
  public ECoreConfig computeCap(int cap) {
    return new ECoreConfig(
        runtime, dataDirectory, defaultLabel, clock, compactEvery, pluginsDirectory, liveSessions, liveMaxBudget,
        pluginLimits, listeners, classificationOrders, maxChannelsPerPlugin, allocationSampling, streams, conversions, cap);
  }
}
