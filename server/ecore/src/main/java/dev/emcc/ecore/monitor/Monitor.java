package dev.emcc.ecore.monitor;

import dev.emcc.ecore.live.LiveGateway;
import dev.emcc.ecore.plugin.PluginHost;
import dev.emcc.ecore.plugin.StreamHub;
import dev.emcc.ecore.plugin.TlsCredentials;
import dev.emcc.ecore.runtime.Owner;
import dev.emcc.ecore.runtime.OwnerLimits;
import dev.emcc.ecore.runtime.WorkerRuntime;
import dev.emcc.ecore.runtime.WorkerStats;
import dev.emcc.ecore.store.StoreCounts;
import java.lang.management.ManagementFactory;
import java.lang.management.MemoryUsage;
import java.security.cert.X509Certificate;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.function.Supplier;
import org.jspecify.annotations.Nullable;

/**
 * Takes {@link MonitorSnapshot}s (overview 4.10). It only reads counters that ECore keeps anyway
 * (workers, owners, listeners, connection tasks, output channels, local folders, store counts, browser sessions): no worker is asked and nothing
 * waits, so a hung plugin or store cannot hold up the monitor that is to show it. Any thread.
 *
 * <p>It owns the {@link Allocation} it is given and closes it with {@link #close()}.
 *
 * <p>Who may see a snapshot is the caller's business: the edge serves it to {@code settings.admin}
 * only (it names hosts and ports).
 */
public final class Monitor implements AutoCloseable {

  private final WorkerRuntime runtime;
  private final PluginHost plugins;
  private final LiveGateway live;
  private final StoreCounts counts;
  private final Clock clock;
  private final Instant startedAt;
  private final Supplier<String> state;
  private final Allocation allocation;

  public Monitor(WorkerRuntime runtime, PluginHost plugins, LiveGateway live, StoreCounts counts, Clock clock, Instant startedAt,
      Supplier<String> state, Allocation allocation) {
    this.runtime = Objects.requireNonNull(runtime, "runtime");
    this.plugins = Objects.requireNonNull(plugins, "plugins");
    this.live = Objects.requireNonNull(live, "live");
    this.counts = Objects.requireNonNull(counts, "counts");
    this.clock = Objects.requireNonNull(clock, "clock");
    this.startedAt = Objects.requireNonNull(startedAt, "startedAt");
    this.state = Objects.requireNonNull(state, "state");
    this.allocation = Objects.requireNonNull(allocation, "allocation");
  }

  public MonitorSnapshot snapshot() {
    Instant now = clock.instant();
    Map<String, List<MonitorSnapshot.Worker>> workersByOwner = new HashMap<>();
    for (WorkerStats s : runtime.stats()) {
      workersByOwner.computeIfAbsent(s.worker().owner(), o -> new ArrayList<>()).add(MonitorSnapshot.Worker.of(s));
    }
    Map<String, Owner> owners = new HashMap<>();
    runtime.owners().forEach(o -> owners.put(o.id(), o));
    Map<String, List<PluginHost.ListenerStatus>> listeners = new HashMap<>();
    plugins.listeners().forEach(l -> listeners.computeIfAbsent(l.plugin(), p -> new ArrayList<>()).add(l));
    Map<String, List<PluginHost.TaskStatus>> tasks = new HashMap<>();
    plugins.connectionTasks().forEach(t -> tasks.computeIfAbsent(t.plugin(), p -> new ArrayList<>()).add(t));
    Map<String, List<PluginHost.ChannelStatus>> channels = new HashMap<>();
    plugins.channels().forEach(c -> channels.computeIfAbsent(c.plugin(), p -> new ArrayList<>()).add(c));
    Map<String, List<PluginHost.FolderStatus>> folders = new HashMap<>();
    plugins.localFolders().forEach(f -> folders.computeIfAbsent(f.plugin(), p -> new ArrayList<>()).add(f));
    Map<String, List<StreamHub.StreamStatus>> streams = new HashMap<>();
    plugins.streams().stats().forEach(s -> streams.computeIfAbsent(s.plugin(), p -> new ArrayList<>()).add(s));

    List<MonitorSnapshot.Plugin> pluginViews = new ArrayList<>();
    for (PluginHost.Health h : plugins.health()) {
      pluginViews.add(new MonitorSnapshot.Plugin(h.id(), h.name(), h.active(), h.state(), h.detail(), caps(owners.get(h.id())),
          workersByOwner.getOrDefault(h.id(), List.of()), listeners.getOrDefault(h.id(), List.of()), h.internet(),
          counts.notSaved(h.id()), h.connections(), tasks.getOrDefault(h.id(), List.of()), channels.getOrDefault(h.id(), List.of()),
          h.capabilities(), h.capabilityFault(), folders.getOrDefault(h.id(), List.of()), streams.getOrDefault(h.id(), List.of()),
          plugins.conversions().stats(h.id()), declaresCompute(plugins.computeStatus(h.id()))));
      workersByOwner.remove(h.id());
    }
    List<MonitorSnapshot.Worker> core = new ArrayList<>();
    workersByOwner.values().forEach(core::addAll);
    core.sort((a, b) -> a.owner().equals(b.owner()) ? a.name().compareTo(b.name()) : a.owner().compareTo(b.owner()));

    StoreCounts.Counts c = counts.current();
    return new MonitorSnapshot(now.toEpochMilli(), new MonitorSnapshot.Core(state.get(),
        Math.max(0, Duration.between(startedAt, now).toSeconds()), jvm(), live.openSessions(), c.layers(), c.objects(),
        c.sequenceNo(), new MonitorSnapshot.Compute(plugins.computeHub().cap(), plugins.computeHub().held()), tls(now)),
        pluginViews, core);
  }

  /** The TLS credentials, each read once (the first Monitor request may read the files). */
  private List<MonitorSnapshot.TlsCredential> tls(Instant now) {
    List<MonitorSnapshot.TlsCredential> out = new ArrayList<>();
    plugins.tlsCredentials().forEach((name, credential) -> out.add(switch (credential.read()) {
      case TlsCredentials.Unreadable u -> new MonitorSnapshot.TlsCredential(name, credential.setting(), u.reason(), List.of(), List.of());
      case TlsCredentials.Usable u -> new MonitorSnapshot.TlsCredential(name, credential.setting(), null,
          u.identity().stream().map(x -> certificate(x, now)).toList(), u.trusted().stream().map(x -> certificate(x, now)).toList());
    }));
    return out;
  }

  private static MonitorSnapshot.Certificate certificate(X509Certificate x, Instant now) {
    Instant notAfter = x.getNotAfter().toInstant();
    String state = notAfter.isBefore(now) ? "expired" : notAfter.isBefore(now.plus(Duration.ofDays(TlsCredentials.EXPIRY_WARNING_DAYS))) ? "soon" : "valid";
    return new MonitorSnapshot.Certificate(x.getSubjectX500Principal().getName(), x.getIssuerX500Principal().getName(),
        notAfter.toEpochMilli(), state);
  }

  /** A plugin's compute threads only when it declares some: the Monitor shows nothing for the others. */
  private static dev.emcc.ecore.plugin.PluginComputes.@Nullable Status declaresCompute(
      dev.emcc.ecore.plugin.PluginComputes.@Nullable Status status) {
    return status == null || status.declared() == 0 ? null : status;
  }

  private static MonitorSnapshot.Caps caps(@Nullable Owner owner) {
    if (owner == null) { // a disabled plugin has no owner
      return new MonitorSnapshot.Caps(0, 0, 0, 0, 0, 0);
    }
    OwnerLimits limits = owner.limits();
    return new MonitorSnapshot.Caps(owner.outstandingAsks(), limits.outstandingAsks(), owner.refusedAsks(),
        owner.activeTimers(), limits.activeTimers(), owner.refusedTimers());
  }

  private MonitorSnapshot.Jvm jvm() {
    MemoryUsage heap = ManagementFactory.getMemoryMXBean().getHeapMemoryUsage();
    return new MonitorSnapshot.Jvm(heap.getUsed(), heap.getCommitted(), heap.getMax(),
        ManagementFactory.getThreadMXBean().getThreadCount(), Runtime.getRuntime().availableProcessors(), allocation.read());
  }

  /** Stops the allocation sampling. */
  @Override
  public void close() {
    allocation.close();
  }
}
