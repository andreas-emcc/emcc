package dev.emcc.plugins.cot;

import java.time.Duration;
import java.time.Instant;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

/**
 * The uids that emc2 made up for the objects of source layers its output links sent, and the layer each was sent from, so that the
 * echo of one, coming back in through an input link whose target is that same layer, is recognised and not stored as a second object
 * in it (brief function 19, criterion 16). Through an input link that targets another layer the same event is a round trip and is
 * stored (criterion 15).
 *
 * <p>Only the id of an object that was not made from CoT is kept, since no TAK peer can have made it up. Not kept: a channel item's
 * id (owner, 2026-10-28: echo loops come from source layers, not from a sender, and a sender such as the simulator expects its
 * tracks back through another link), and a uid that came in from CoT and went out again (a relay; it is the object's external
 * identity, and an event for it finds that object). Each uid is kept until the stale time of what was sent for it plus {@link #GRACE}, so that the echo of an event
 * that is stale at once (a delete) is recognised too; a new send renews it. At most {@code cap} uids are kept, the longest unrenewed
 * dropped first. Used by the applier worker only: no locks.
 */
final class SentUids {

  /** How long after its stale time a sent uid is still recognised: the echo of a delete comes after it was sent stale at once. */
  static final Duration GRACE = Duration.ofSeconds(60);

  private static final Duration SWEEP_EVERY = Duration.ofSeconds(5);

  private final int cap;
  /** Until when a uid is recognised, and the layer it was sent from. */
  private record Entry(Instant until, UUID layer) {}

  /** The uid and what is known of it, in the order of the last send. */
  private final LinkedHashMap<String, Entry> until = new LinkedHashMap<>();
  private Instant swept = Instant.EPOCH;

  SentUids(int cap) {
    this.cap = cap;
  }

  /** An event for {@code uid}, an object of {@code layer}, was sent at {@code now}, with the stale time {@code stale}. */
  void remember(String uid, UUID layer, Instant stale, Instant now) {
    Instant end = (stale.isAfter(now) ? stale : now).plus(GRACE);
    until.remove(uid);
    until.put(uid, new Entry(end, layer));
    for (Iterator<Map.Entry<String, Entry>> it = until.entrySet().iterator(); until.size() > cap && it.hasNext(); ) {
      it.next(); // the longest unrenewed: one entry at a cost of one
      it.remove();
    }
    if (Duration.between(swept, now).compareTo(SWEEP_EVERY) >= 0) {
      swept = now;
      until.values().removeIf(entry -> !entry.until().isAfter(now)); // what has run out, at most every few seconds
    }
  }

  /** Whether {@code uid} was sent from {@code layer} and is still recognised at {@code now}. */
  boolean sentFrom(String uid, UUID layer, Instant now) {
    Entry entry = until.get(uid);
    return entry != null && entry.until().isAfter(now) && entry.layer().equals(layer);
  }

  int size() {
    return until.size();
  }
}
