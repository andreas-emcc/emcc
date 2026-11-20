package dev.emcc.plugins.cot;

import dev.emcc.plugins.cot.Config.LinkConfig;
import dev.emcc.sdk.channel.ChannelRef;
import dev.emcc.sdk.connection.ConnectionRef;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/** The state of one link, owned by the {@code applier} worker: its connection task, its layer and its counters. */
final class LinkRuntime {

  /** How many runs' counters are kept apart; older ones are folded into the total. */
  private static final int RUNS_KEPT = 4;

  LinkConfig config;
  @Nullable ConnectionRef<LinkInbox> task;
  /** Identifies the task started last: its messages carry it, so that those of a task stopped meanwhile are not taken for the new one's. */
  UUID generation = new UUID(0, 0);
  /** What the output of an out or both link keeps; {@code null} for a link that does not run or only receives. */
  @Nullable LinkOutput output;
  /** The link's output channel, offered to other plugins while the link is enabled, has no problem and sends. */
  @Nullable ChannelRef channel;
  /** The task runs (ECore says so), or its connection is up (the task says so). */
  boolean running;
  boolean connected;
  @Nullable Instant since;
  @Nullable String lastError;
  @Nullable Instant retryAt;

  /** The layer the link's objects go into, once it is known to exist. */
  @Nullable UUID layerId;
  /** The tick at which a layer that could not be made is tried again. */
  long layerRetryTick;
  /** The uids whose first event waits for the layer. */
  final Set<String> parked = new LinkedHashSet<>();

  long created;
  long updated;
  long older;
  long rejected;
  /** Events that were the echo of what this plugin sent: not stored, and not a loss. */
  long echoes;
  /** How many times the link was closed and connected again because the peer took nothing of a write (it stopped reading). */
  long stalls;
  /** The write of the link's task that is in progress, if any. */
  final WriteWatch writes = new WriteWatch();

  /** The warning limit of the worker's warnings about this link, drops included: the tick of the last one. */
  long lastWarnTick = Long.MIN_VALUE / 2;
  /** How many malformed and too large events had been counted when the last drop was logged. */
  long warnedDrops;

  /** Events read per second over the last few seconds, from the tick. */
  private double rateIn;
  private long rateReadAt;
  private long rateTickAt;

  private Counters folded = Counters.ZERO;
  private final Map<UUID, Counters> runs = new LinkedHashMap<>();

  LinkRuntime(LinkConfig config) {
    this.config = config;
  }

  /** Takes in the cumulative counters of a run of the task. */
  void observe(UUID run, Counters counters) {
    runs.merge(run, counters, Counters::max);
    if (runs.size() > RUNS_KEPT) {
      Iterator<Map.Entry<UUID, Counters>> oldest = runs.entrySet().iterator();
      folded = folded.plus(oldest.next().getValue());
      oldest.remove();
    }
  }

  /** What the runs of this link's task have read and dropped so far, all connections together. */
  Counters reader() {
    Counters total = folded;
    for (Counters c : runs.values()) {
      total = total.plus(c);
    }
    return total;
  }

  long droppedInWorker() {
    return older + rejected;
  }

  /** Called once a second: the rate of events read, over about five seconds. */
  void tick(long tick) {
    if (tick - rateTickAt >= 5) {
      long read = reader().read();
      rateIn = (read - rateReadAt) / (double) Math.max(1, tick - rateTickAt);
      rateReadAt = read;
      rateTickAt = tick;
    }
  }

  /**
   * One line for the plugin status: {@code name: state, counts, layer [direction transport where]}.
   * The line begins with the name and the state, and the counts read "N read, N created, N updated",
   * so that a test or a person can find them (the ITA's cot specs do).
   */
  String summary(@Nullable String layerName) {
    String where = " [" + config.direction().json() + " " + config.transport().json() + " " + config.where() + "]";
    if (!config.enabled()) {
      return config.name() + ": disabled";
    }
    if (config.problem() != null) {
      return config.name() + ": stopped (" + config.problem() + ")" + where;
    }
    var line = new StringBuilder(config.name()).append(": ");
    if (connected) {
      line.append(config.transport().isTcp() ? "connected since " : config.direction().receives() ? "listening since " : "sending since ").append(seconds(since));
    } else if (lastError != null) {
      line.append("not connected (").append(lastError).append(')');
      if (retryAt != null) {
        line.append(", next try ").append(seconds(retryAt));
      }
    } else {
      line.append(task == null ? "not started" : "connecting");
    }
    Counters c = reader();
    boolean receives = config.direction().receives();
    if (receives) { // an out link reads nothing: its line is short, the status holds 512 characters for all the links
      line.append(", ").append(c.read()).append(" read, ").append(created).append(" created, ").append(updated).append(" updated");
    }
    long dropped = c.dropped() + droppedInWorker();
    if (receives && dropped > 0) {
      var why = new ArrayList<String>();
      add(why, "malformed", c.malformed());
      add(why, "too large", c.tooLarge());
      add(why, "not shown", c.ignored());
      add(why, "older", older);
      add(why, "rejected", rejected);
      add(why, "backlog", c.overflow());
      line.append(", dropped ").append(dropped).append(" (").append(String.join(", ", why)).append(')');
    }
    if (receives && echoes > 0) {
      line.append(", ").append(echoes).append(" echoes ignored");
    }
    if (rateIn > 0) {
      line.append(", ").append(String.format(Locale.ROOT, "%.1f", rateIn)).append(" events/s in");
    }
    LinkOutput out = output;
    if (out != null) {
      line.append(", ").append(out.written()).append(" sent");
      if (out.rateOut > 0) {
        line.append(" (").append(String.format(Locale.ROOT, "%.1f", out.rateOut)).append("/s)");
      }
      if (out.skippedTotal() > 0) {
        var why = new ArrayList<String>();
        out.skips().forEach((reason, n) -> why.add(reason + " " + n));
        line.append(", skipped ").append(out.skippedTotal()).append(" (").append(String.join(", ", why)).append(')');
      }
      if (!out.items.isEmpty()) {
        line.append(", ").append(out.items.size()).append(" channel items tracked"); // each is forgotten at its stale time
      }
    }
    if (stalls > 0) {
      line.append(", ").append(stalls).append(stalls == 1 ? " write stall" : " write stalls");
    }
    String warning = refreshWarning();
    if (warning != null) {
      line.append(", WARNING: ").append(warning);
    }
    if (receives && layerName != null) {
      line.append(", layer '").append(layerName).append("'");
    }
    return line.append(where).toString();
  }

  /** Brief function 18: static markers go stale in TAK when nothing sends them again in time. */
  @Nullable String refreshWarning() {
    if (!config.direction().sends() || !config.enabled() || config.problem() != null) {
      return null;
    }
    if (config.refreshSeconds() == 0) {
      return "refresh 0: static objects go stale in TAK";
    }
    if (config.refreshSeconds() > config.staleSeconds()) {
      return "refresh longer than stale: static objects go stale in TAK";
    }
    return null;
  }

  private static void add(List<String> why, String name, long count) {
    if (count > 0) {
      why.add(name + " " + count);
    }
  }

  private static String seconds(@Nullable Instant time) {
    return time == null ? "?" : time.truncatedTo(ChronoUnit.SECONDS).toString();
  }
}
