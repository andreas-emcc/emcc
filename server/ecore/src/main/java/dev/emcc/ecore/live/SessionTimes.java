package dev.emcc.ecore.live;

import java.time.Instant;
import java.util.Objects;
import java.util.Set;
import org.jspecify.annotations.Nullable;

/**
 * Where the live picture tells each browser session's time (SDK 1.4.0, ADR-0045 point 4): at the
 * session's start ({@code now}), at each {@code time} message, and when it ends. The plugin host
 * implements it and delivers the times to the temporal plugins, mapped to the SDK's types there (the
 * live picture uses ECore's own, T-015). Called from the session's own threads; never blocks.
 */
public interface SessionTimes {

  /** Nothing is told: an ECore without plugins. */
  SessionTimes NONE = new SessionTimes() {
    @Override
    public void started(String session, SessionUser user) {}

    @Override
    public void changed(String session, Picked time) {}

    @Override
    public void ended(String session) {}
  };

  /** A session has started, at {@code now}. */
  void started(String session, SessionUser user);

  /** The session's user has picked {@code time}, already checked. */
  void changed(String session, Picked time);

  /** The session has ended. */
  void ended(String session);

  /**
   * The session's user, as plugins see it.
   *
   * @param noLogin the no-login mode's local user, who has every permission
   */
  record SessionUser(String id, String name, Set<String> permissions, boolean noLogin) {
    public SessionUser {
      Objects.requireNonNull(id, "id");
      Objects.requireNonNull(name, "name");
      permissions = Set.copyOf(permissions);
    }
  }

  /**
   * The time the user picked, two independent parts (CR-0032, owner JA): the set time {@code at}
   * (null for now) and an optional interval {@code from} to {@code to} (both null for none, else
   * both set, the start not after the end). The set time may lie outside the interval. Now in
   * ADR-0045's sense is all null.
   */
  record Picked(@Nullable Instant at, @Nullable Instant from, @Nullable Instant to) {
    /** Now, with no interval. */
    public static final Picked NOW = new Picked(null, null, null);

    public Picked {
      boolean interval = from != null || to != null;
      if (interval && (from == null || to == null)) {
        throw new IllegalArgumentException("an interval has a start and an end");
      }
      if (interval && from.isAfter(to)) {
        throw new IllegalArgumentException("an interval's start is after its end: " + from + " > " + to);
      }
    }
  }
}
