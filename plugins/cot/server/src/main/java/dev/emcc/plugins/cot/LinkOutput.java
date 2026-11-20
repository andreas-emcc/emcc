package dev.emcc.plugins.cot;

import java.time.Instant;
import java.util.ArrayDeque;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * What the worker keeps for the output of one {@code out} or {@code both} link (brief functions 14
 * to 21): what it has sent, what is still to send after the link came up, what it skipped and why.
 * Owned by the {@code applier} worker, like everything else.
 */
final class LinkOutput {

  /**
   * What was sent for an object of a source layer: a digest of the event (without its times), the tick, the layer it
   * came from, and what an event that is stale at once needs: the uid, the type and the position. Nothing else of the
   * object is kept, and nothing else is sent when it leaves, so an object that was raised above the link's
   * classification gives away nothing of its new state.
   */
  record Sent(String digest, long tick, UUID layer, String uid, String type, double lat, double lon, @Nullable Double hae) {}

  /**
   * What a removal needs of a channel item that was sent: the uid, the CoT type and the position, kept until the stale time of the
   * event that was sent (the sender's next item renews it). After that TAK has dropped the track and a removal has nothing to remove.
   */
  record Identity(String uid, String type, double lat, double lon, @Nullable Double hae, Instant staleAt) {}

  /** The layers this link sends from. */
  final Set<UUID> layers = new HashSet<>();
  /** The objects of the source layers that this link has sent, and how. Cleared when the connection comes up, so everything goes out again. */
  final Map<UUID, Sent> sent = new HashMap<>();
  /**
   * The identity (uid, type, position) of the items other plugins sent through the link's channel, so that a removal can be
   * sent as an event that is stale at once. Nothing else of an item is kept, and no digest: channel items always go out as they
   * come. Bounded by {@link Caps#items()}.
   */
  final Map<UUID, Identity> items = new HashMap<>();
  /**
   * The bounds of a link's channel memory: the most item identities remembered at once (past it a removal of an item that was not
   * remembered sends nothing), and the most objects that wait for a link that is down (past it an item is not posted).
   */
  record Caps(int items, int waiting) {
    /** The waiting bound is the task inbox's size ({@code Applier.INBOX}): the worker refuses the next object itself, since a coalescing inbox would evict the oldest. */
    static final Caps DEFAULT = new Caps(200_000, 20_000);
  }

  final Caps caps;

  LinkOutput(Caps caps) {
    this.caps = caps;
  }

  /**
   * The channel items posted while the link was down, by object: they wait in the task's inbox, one per object, until the
   * connection is up. Cleared when it is. No more than {@link Caps#waiting()}: past that an item is not posted.
   */
  final Set<UUID> waiting = new HashSet<>();
  /** The channel items whose first event is still waiting: TAK has never had them, so their removal sends nothing. */
  final Set<UUID> neverSent = new HashSet<>();
  /** The objects still to send after the link came up: paced, so that a large layer does not flood the inbox. */
  final ArrayDeque<UUID> initial = new ArrayDeque<>();
  /** Why objects were skipped, and how many. */
  final Map<String, Long> skipped = new LinkedHashMap<>();
  /** What the output depends on in the link's settings: the source layers and the limit. Compared at each settings change. */
  String key = "";
  /** How many events were posted to the task's inbox since the last tick: a burst beyond the window waits in {@link #initial}. */
  int window;
  /** Whether the link's connection is up: nothing is posted to a task that has no connection. */
  boolean up;
  /** What the runs of the task have written, and what they skipped as expired when they came to write it. */
  private final RunCounts written = new RunCounts();
  private final RunCounts expiredAtSend = new RunCounts();

  /** Events written per second over about five seconds. */
  double rateOut;
  private long rateWrittenAt;
  private long rateTickAt;

  /** The cumulative counts of the last few runs of a link's task, and what the earlier ones came to. */
  private static final class RunCounts {
    private final Map<UUID, Long> perRun = new LinkedHashMap<>();
    private long before;

    void observe(UUID run, long count) {
      perRun.merge(run, count, Math::max);
      if (perRun.size() > 4) {
        var oldest = perRun.entrySet().iterator();
        before += oldest.next().getValue();
        oldest.remove();
      }
    }

    long total() {
      long total = before;
      for (long count : perRun.values()) {
        total += count;
      }
      return total;
    }
  }

  /** Takes in the cumulative counts of a run of the task. */
  void observeWritten(UUID run, long count, long expired) {
    written.observe(run, count);
    expiredAtSend.observe(run, expired);
  }

  long written() {
    return written.total();
  }

  void skip(String reason) {
    skipped.merge(reason, 1L, Long::sum);
  }

  /** The skips by reason: those the worker made, and the expired ones the task found when it came to write. */
  Map<String, Long> skips() {
    var all = new LinkedHashMap<>(skipped);
    long late = expiredAtSend.total();
    if (late > 0) {
      all.merge("expired", late, Long::sum);
    }
    return all;
  }

  long skippedTotal() {
    long total = 0;
    for (long count : skips().values()) {
      total += count;
    }
    return total;
  }

  void tick(long tick) {
    window = 0;
    if (tick - rateTickAt >= 5) {
      long now = written();
      rateOut = (now - rateWrittenAt) / (double) Math.max(1, tick - rateTickAt);
      rateWrittenAt = now;
      rateTickAt = tick;
    }
  }
}
