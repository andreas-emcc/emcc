package dev.emcc.plugins.ais.codec;

import java.util.LinkedHashMap;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * Joins the fragments of multi-sentence messages (type 5 and some 19s) by sequence id and channel,
 * in order. <b>It lives in the task, one per connection</b>: fragments of one message arrive on one
 * connection, and a reconnection starts empty. At most {@value #MAX_WAITING} messages wait; one that is
 * not complete {@value #EXPIRY_MILLIS} ms after its first fragment, a fragment out of order, and the
 * oldest waiting message when a further one starts are dropped and counted as lost fragments. Not
 * thread-safe: one task uses it.
 */
public final class Fragments {

  public static final int MAX_WAITING = 16;
  public static final long EXPIRY_MILLIS = 5_000;

  /** A message that is complete: its payload and the fill bits of its last fragment. */
  public record Joined(String payload, int fillBits) {}

  /** What one sentence did: the joined message if it completed one, and how many fragments were lost on the way. */
  public record Result(@Nullable Joined joined, int lost) {}

  private record Key(String sequenceId, String channel) {}

  private static final class Waiting {
    final long since;
    final int count;
    int next = 2;
    final StringBuilder payload;

    Waiting(long since, int count, String first) {
      this.since = since;
      this.count = count;
      this.payload = new StringBuilder(first);
    }
  }

  /** In order of the first fragment, so the oldest is first. */
  private final Map<Key, Waiting> waiting = new LinkedHashMap<>();

  /** Takes one sentence, at time {@code nowMillis} (any monotonic clock in milliseconds). */
  public Result add(Sentence s, long nowMillis) {
    int lost = expire(nowMillis);
    if (s.count() == 1) {
      return new Result(new Joined(s.payload(), s.fillBits()), lost);
    }
    var key = new Key(s.sequenceId(), s.channel());
    if (s.number() == 1) {
      if (waiting.remove(key) != null) {
        lost++; // the earlier message of this key never completed
      }
      if (waiting.size() >= MAX_WAITING) {
        var oldest = waiting.keySet().iterator();
        oldest.next();
        oldest.remove();
        lost++;
      }
      waiting.put(key, new Waiting(nowMillis, s.count(), s.payload()));
      return new Result(null, lost);
    }
    Waiting w = waiting.get(key);
    if (w == null) {
      return new Result(null, lost + 1); // the first fragment never came
    }
    if (w.count != s.count() || w.next != s.number()) {
      waiting.remove(key);
      return new Result(null, lost + 1); // out of order: the message is lost with it
    }
    w.payload.append(s.payload());
    if (s.number() == w.count) {
      waiting.remove(key);
      return new Result(new Joined(w.payload.toString(), s.fillBits()), lost);
    }
    w.next++;
    return new Result(null, lost);
  }

  /** Drops the messages whose first fragment is too old; returns how many. Also called by {@link #add}. */
  public int expire(long nowMillis) {
    int lost = 0;
    for (var it = waiting.values().iterator(); it.hasNext(); ) {
      if (nowMillis - it.next().since < EXPIRY_MILLIS) {
        break; // the oldest comes first: the rest are younger
      }
      it.remove();
      lost++;
    }
    return lost;
  }

  /** How many messages wait. */
  public int size() {
    return waiting.size();
  }
}
