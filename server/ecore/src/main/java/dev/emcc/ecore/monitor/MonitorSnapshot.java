package dev.emcc.ecore.monitor;

import dev.emcc.ecore.plugin.PluginHost;
import dev.emcc.ecore.plugin.PluginManifest;
import dev.emcc.ecore.plugin.ConversionHub;
import dev.emcc.ecore.plugin.StreamHub;
import dev.emcc.ecore.runtime.WorkerStats;
import java.util.List;
import org.jspecify.annotations.Nullable;

/**
 * The live health of the core and of each plugin at one moment, for the monitor view (overview 4.10,
 * ADR-0013). Counters are totals since the start: the view takes rates from two snapshots, so the
 * server keeps no state between requests. Times are plain numbers (milliseconds since the epoch,
 * seconds, microseconds), named so.
 *
 * @param atMillis when it was taken
 * @param core the core
 * @param plugins every plugin, active ones first, in start order
 * @param coreWorkers ECore's own workers (store, persistence, expiry, browser sessions)
 */
public record MonitorSnapshot(long atMillis, Core core, List<Plugin> plugins, List<Worker> coreWorkers) {

  public MonitorSnapshot {
    plugins = List.copyOf(plugins);
    coreWorkers = List.copyOf(coreWorkers);
  }

  /**
   * @param state ECore's state ({@code RUNNING} while it serves this)
   * @param uptimeSeconds since ECore started
   * @param liveSessions browser sessions of the live picture
   * @param layers layers in the live picture
   * @param objects objects in the live picture
   * @param sequenceNo the last applied change event
   */
  public record Core(String state, long uptimeSeconds, Jvm jvm, int liveSessions, int layers, int objects, long sequenceNo,
      Compute compute, List<TlsCredential> tls) {

    public Core {
      tls = List.copyOf(tls);
    }
  }

  /**
   * ADR-0062 point 4 (M9 C3): a TLS credential of the server, with its certificates' expiry. Never a path or a
   * password.
   *
   * @param name its name, which a link picks
   * @param setting the keys it was read from ({@code emc2.tls.<name>}, or the deprecated {@code
   *     emc2.listeners.credentials.<name>})
   * @param error why its files cannot be read, or null
   * @param identity the client's chain, its own certificate first; empty without an identity or with an error
   * @param trusted the trust store's certificates
   */
  public record TlsCredential(String name, String setting, @Nullable String error, List<Certificate> identity,
      List<Certificate> trusted) {

    public TlsCredential {
      identity = List.copyOf(identity);
      trusted = List.copyOf(trusted);
    }
  }

  /**
   * One certificate.
   *
   * @param state {@code valid}, {@code soon} (within {@value dev.emcc.ecore.plugin.TlsCredentials#EXPIRY_WARNING_DAYS} days of its expiry) or
   *     {@code expired}
   */
  public record Certificate(String subject, String issuer, long notAfterMillis, String state) {}

  /**
   * SDK 1.9.0 (ADR-0064 point 4): the server's cap on compute tasks.
   *
   * @param cap {@code emc2.compute.max-threads}
   * @param held the compute tasks that count against it now, hung ones included
   */
  public record Compute(int cap, int held) {}

  /**
   * The Java process. Memory is not measured per plugin: plugins' workers share virtual threads,
   * and the JVM cannot split their bytes (spike S5; owner, 2026-11-05, T-148).
   *
   * @param heapUsed bytes of heap in use
   * @param heapCommitted bytes of heap the JVM holds
   * @param heapMax the most heap the JVM may take, or -1 if not limited
   * @param platformThreads live platform threads (virtual threads, e.g. the workers, are not counted)
   * @param processors processors available to the JVM
   * @param allocation the bytes allocated, in total and by ECore (T-148), totals since the start
   */
  public record Jvm(long heapUsed, long heapCommitted, long heapMax, int platformThreads, int processors,
      Allocation.Reading allocation) {}

  /**
   * One plugin.
   *
   * @param state its effective status ({@code OK}, {@code DEGRADED}, {@code FAILED}): the worse of
   *     its own and ECore's
   * @param caps its asks and timers against their caps (CR-0005), with the refusals
   * @param internet its manifest's declared internet use, or {@code null} for none (ADR-0030)
   * @param notSavedUpdates its updates that were not saved (ADR-0041), since the start
   * @param connections its manifest's declared connections (SDK 1.2.0, ADR-0036 point 7)
   * @param tasks its connection tasks (ADR-0036 point 6)
   * @param channels the output channels it offers (SDK 1.2.0, ADR-0037), by link
   * @param folders the local folders its manifest declares (SDK 1.4.0, ADR-0049 point 4), while it runs:
   *     each with its path and whether it is readable
   * @param compute SDK 1.9.0 (ADR-0064 point 5): its compute threads, declared, allowed and running, its refusals and
   *     tasks, while it runs and declares some; null otherwise
   */
  public record Plugin(String id, String name, boolean active, String state, String detail, Caps caps, List<Worker> workers,
      List<PluginHost.ListenerStatus> listeners, PluginManifest.@Nullable Internet internet, long notSavedUpdates,
      List<PluginManifest.Connection> connections, List<PluginHost.TaskStatus> tasks, List<PluginHost.ChannelStatus> channels,
      List<String> capabilities, PluginHost.@Nullable CapabilityFault capabilityFault, List<PluginHost.FolderStatus> folders,
      List<StreamHub.StreamStatus> streams, List<ConversionHub.ConversionStatus> conversions,
      dev.emcc.ecore.plugin.PluginComputes.@Nullable Status compute) {
    public Plugin {
      streams = List.copyOf(streams);
      folders = List.copyOf(folders);
      capabilities = List.copyOf(capabilities);
      workers = List.copyOf(workers);
      listeners = List.copyOf(listeners);
      connections = List.copyOf(connections);
      tasks = List.copyOf(tasks);
      channels = List.copyOf(channels);
    }
  }

  /** An owner's asks and timers now, their caps, and how many were refused since the start (CR-0005). */
  public record Caps(int outstandingAsks, int maxAsks, long refusedAsks, int activeTimers, int maxTimers, long refusedTimers) {}

  /**
   * One worker ({@link WorkerStats}, with the handler times in microseconds).
   *
   * @param state {@code RUNNING}, {@code HUNG}, {@code STOPPED} or {@code FAILED}
   */
  public record Worker(String owner, String name, String state, int queued, int capacity, long accepted, long dropped,
      long evicted, long coalesced, long processed, long failures, long hung, long restarts, long maxHandlerMicros,
      long totalHandlerMicros) {

    static Worker of(WorkerStats s) {
      return new Worker(s.worker().owner(), s.worker().name(), s.state().name(), s.queued(), s.capacity(), s.accepted(),
          s.dropped(), s.evicted(), s.coalesced(), s.processed(), s.failures(), s.hung(), s.restarts(),
          s.maxHandlerTime().toNanos() / 1_000, s.totalHandlerTime().toNanos() / 1_000);
    }
  }
}
