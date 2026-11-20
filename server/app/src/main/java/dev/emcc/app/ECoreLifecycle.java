package dev.emcc.app;

import dev.emcc.ecore.ECore;
import dev.emcc.ecore.ECoreConfig;
import dev.emcc.ecore.plugin.ComputeHub;
import dev.emcc.ecore.plugin.ConversionLimits;
import dev.emcc.ecore.plugin.ListenerConfig;
import dev.emcc.ecore.plugin.StreamLimits;
import dev.emcc.ecore.plugin.TlsCredentials;
import dev.emcc.ecore.runtime.OwnerLimits;
import dev.emcc.sdk.model.SecurityLabel;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.TreeMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.boot.web.server.context.WebServerApplicationContext;
import org.springframework.context.SmartLifecycle;
import org.springframework.stereotype.Component;

/**
 * Starts ECore together with the application context and stops it when the context closes.
 *
 * <p>ECore runs in an earlier phase than the web server, so it is running before the first
 * request arrives and keeps running until the web server has stopped.
 */
@Component
@EnableConfigurationProperties({ListenerProperties.class, TlsProperties.class, ClassificationProperties.class, LabelingProperties.class,
    HttpProperties.class})
class ECoreLifecycle implements SmartLifecycle {

  private static final Logger LOG = LoggerFactory.getLogger(ECoreLifecycle.class);

  static final int PHASE = WebServerApplicationContext.START_STOP_LIFECYCLE_PHASE - 1;

  private final ECore core;

  ECoreLifecycle(
      @Value("${emc2.data.directory}") String dataDirectory,
      @Value("${emc2.plugins.directory}") String pluginsDirectory,
      @Value("${emc2.live.max-sessions}") int liveSessions,
      @Value("${emc2.live.max-budget}") int liveBudget,
      @Value("${emc2.plugins.max-outstanding-asks}") int pluginAsks,
      @Value("${emc2.plugins.max-active-timers}") int pluginTimers,
      @Value("${emc2.connections.max-per-plugin}") int connectionTasks,
      @Value("${emc2.channels.max-per-plugin}") int channels,
      @Value("${emc2.default-label.policy}") String labelPolicy,
      @Value("${emc2.default-label.classification}") String labelClassification,
      @Value("${emc2.monitor.allocation}") boolean allocationSampling,
      @Value("${emc2.streams.start-buffer-bytes}") long streamStartBuffer,
      @Value("${emc2.streams.viewer-queue-bytes}") long streamViewerQueue,
      @Value("${emc2.streams.viewers-per-stream}") int streamViewersPerStream,
      @Value("${emc2.streams.viewers}") int streamViewers,
      @Value("${emc2.conversions.max}") int conversionsMax,
      @Value("${emc2.conversions.input-queue-bytes}") long conversionInputQueue,
      @Value("${emc2.conversions.ffmpeg:}") String conversionFfmpeg,
      @Value("${emc2.conversions.max-pixels}") long conversionMaxPixels,
      @Value("${emc2.conversions.restart-seconds}") int conversionRestartSeconds,
      @Value("${emc2.compute.max-threads:}") String computeMaxThreads,
      ListenerProperties listeners,
      TlsProperties tls,
      ClassificationProperties classifications,
      HttpProperties http) {
    if (connectionTasks < 1) {
      throw new IllegalStateException("emc2.connections.max-per-plugin must be at least 1: " + connectionTasks);
    }
    if (channels < 1) {
      throw new IllegalStateException("emc2.channels.max-per-plugin must be at least 1: " + channels);
    }
    StreamLimits streams;
    try {
      streams = new StreamLimits(streamStartBuffer, streamViewerQueue, streamViewersPerStream, streamViewers);
    } catch (IllegalArgumentException e) {
      throw new IllegalStateException("emc2.streams.*: " + e.getMessage(), e);
    }
    ConversionLimits conversions;
    try { // SDK 1.8.0 (CR-0044 E2, T-211): empty ffmpeg is the release's tools/ffmpeg/
      conversions = new ConversionLimits(conversionsMax, conversionInputQueue,
          conversionFfmpeg.isBlank() ? ConversionLimits.DEFAULT.ffmpeg() : Path.of(conversionFfmpeg.strip()), conversionMaxPixels,
          conversionRestartSeconds);
    } catch (IllegalArgumentException e) {
      throw new IllegalStateException("emc2.conversions.*: " + e.getMessage(), e);
    }
    int computeCap; // SDK 1.9.0 (ADR-0064 point 4): empty is the cores minus one, at least one
    try {
      computeCap = computeMaxThreads.isBlank() ? ComputeHub.defaultCap() : Integer.parseInt(computeMaxThreads.strip());
    } catch (NumberFormatException e) {
      throw new IllegalStateException("emc2.compute.max-threads is not a whole number: " + computeMaxThreads, e);
    }
    if (computeCap < 1 || computeCap > 1024) {
      throw new IllegalStateException("emc2.compute.max-threads must be 1 to 1024: " + computeCap);
    }
    ListenerConfig listenerConfig = listeners.toConfig(tls.credentials(), LOG::warn) // a missing key or file stops the start
        .withMaxTasksPerPlugin(connectionTasks).withHttpTokens(http.tokens()); // a wrong token stops the start
    readTlsCredentials(listenerConfig);
    SecurityLabel defaultLabel = SecurityLabel.of(labelPolicy, labelClassification);
    // An admin may run emcc on a Java of their own (M9 C5): which one runs, for the log and support
    LOG.info("Java {} ({}) at {}", Runtime.version(), System.getProperty("java.vendor", "?"), System.getProperty("java.home", "?"));
    this.core = new ECore(ECoreConfig.defaults()
        .dataDirectory(Path.of(dataDirectory))
        .pluginsDirectory(Path.of(pluginsDirectory))
        .liveSessions(liveSessions)
        .liveMaxBudget(liveBudget)
        .pluginLimits(new OwnerLimits(pluginAsks, pluginTimers))
        .defaultLabel(defaultLabel)
        .listeners(listenerConfig)
        .classificationOrders(classifications.checkedForPlugins(defaultLabel)) // a wrong order stops the start
        .maxChannelsPerPlugin(channels)
        .allocationSampling(allocationSampling)
        .streams(streams) // SDK 1.8.0 (CR-0044 E1)
        .conversions(conversions) // SDK 1.8.0 (CR-0044 E2, T-211)
        .computeCap(computeCap)); // SDK 1.9.0 (ADR-0064)
  }

  ECore core() {
    return core;
  }

  /**
   * ADR-0062 (M9 C3): every TLS credential is read at start, so that the log says at once which cannot be read or
   * expires soon; the server starts all the same (owner, C3), and the Monitor shows the same.
   */
  private static void readTlsCredentials(ListenerConfig config) {
    Instant now = Instant.now();
    new TreeMap<>(config.credentials()).forEach((name, credential) -> {
      switch (credential.read()) {
        case TlsCredentials.Unreadable u -> LOG.warn("TLS credential {} cannot be used: {}", name, u.reason());
        case TlsCredentials.Usable u -> {
          if (!u.identity().isEmpty()) {
            Instant notAfter = u.identity().getFirst().getNotAfter().toInstant();
            if (notAfter.isBefore(now)) {
              LOG.warn("TLS credential {}: its certificate expired on {}", name, notAfter);
            } else if (notAfter.isBefore(now.plus(Duration.ofDays(TlsCredentials.EXPIRY_WARNING_DAYS)))) {
              LOG.warn("TLS credential {}: its certificate expires on {}", name, notAfter);
            }
          }
          LOG.info("TLS credential {} read from {}.*", name, credential.setting());
        }
      }
    });
  }

  @Override
  public void start() {
    core.start();
  }

  @Override
  public void stop() {
    core.stop();
  }

  @Override
  public boolean isRunning() {
    return core.state() == ECore.State.RUNNING;
  }

  @Override
  public int getPhase() {
    return PHASE;
  }
}
