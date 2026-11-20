package dev.emcc.ecore.plugin;

import dev.emcc.ecore.live.SessionTimes;
import dev.emcc.ecore.live.SessionTimes.Picked;
import dev.emcc.ecore.live.SessionTimes.SessionUser;
import dev.emcc.sdk.PluginState;
import dev.emcc.sdk.User;
import dev.emcc.sdk.UserTime;
import dev.emcc.sdk.capability.SessionTimeChange;
import dev.emcc.sdk.capability.Temporal;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The browser sessions' times and the temporal plugins that get them (SDK 1.4.0, ADR-0045; the
 * capability {@code temporal}, ADR-0044). Each session starts at {@code now}; each temporal plugin
 * gets a {@link SessionTimeChange} at a session's start, at each change, and {@code now} once when
 * it ends (owner, Q10, 2026-11-06), through the {@link Temporal.Delivery} it gave after {@code init}.
 * A plugin that starts while sessions are open gets each of them at once.
 *
 * <p>An endpoint request carries its session's time ({@link #timeFor}): the shell names the page's
 * session in the header {@value #SESSION_HEADER} (owner, 2026-11-06), and the time counts only for a
 * temporal plugin and a session of the request's own user; otherwise it is {@code now}.
 *
 * <p>Shared between the live sessions' threads, the endpoints' and the plugin host's: concurrent
 * maps, no lock. A delivery runs the plugin's mapper on the caller's thread and sends to its worker,
 * which never blocks; a mapper that throws makes its plugin DEGRADED.
 */
public final class UserTimes implements SessionTimes {

  /** The request header with the page's live session id (owner, 2026-11-06: the shell adds it). */
  public static final String SESSION_HEADER = "X-Emc2-Session";

  private static final Logger LOG = LoggerFactory.getLogger(UserTimes.class);

  private record Session(User user, UserTime time) {}

  private final Map<String, Session> sessions = new ConcurrentHashMap<>();
  private final Map<String, Temporal.Delivery<?>> plugins = new ConcurrentHashMap<>();
  private final PluginStatuses statuses;

  UserTimes(PluginStatuses statuses) {
    this.statuses = Objects.requireNonNull(statuses, "statuses");
  }

  /** {@code plugin} is temporal and running: from now on it gets the sessions' times, the open ones at once. */
  void add(String plugin, Temporal.Delivery<?> delivery) {
    plugins.put(plugin, delivery);
    sessions.forEach((id, s) -> deliver(plugin, delivery, new SessionTimeChange(id, s.user(), s.time())));
  }

  /** {@code plugin} has stopped: it gets no more times. */
  void remove(String plugin) {
    plugins.remove(plugin);
  }

  /** Whether {@code plugin} gets the sessions' times. */
  boolean isTemporal(String plugin) {
    return plugins.containsKey(plugin);
  }

  @Override
  public void started(String session, SessionUser who) {
    User user = who.noLogin() ? User.noLoginUser() : User.of(who.id(), who.name(), who.permissions());
    sessions.put(session, new Session(user, UserTime.now()));
    deliverAll(new SessionTimeChange(session, user, UserTime.now()));
  }

  @Override
  public void changed(String session, Picked picked) {
    UserTime time = picked.at() == null ? UserTime.now() : UserTime.at(picked.at());
    changed(session, picked.from() != null && picked.to() != null ? time.withInterval(picked.from(), picked.to()) : time);
  }

  /** The session's user has picked {@code time}. */
  void changed(String session, UserTime time) {
    Session s = sessions.computeIfPresent(session, (id, old) -> new Session(old.user(), time));
    if (s != null) {
      deliverAll(new SessionTimeChange(session, s.user(), time));
      if (!sessions.containsKey(session) && !time.isNow()) {
        // The session ended while this change was on its way: its now may have gone first, so the
        // last word is now again (no lock: a plugin may get now twice then, never a time after it).
        deliverAll(new SessionTimeChange(session, s.user(), UserTime.now()));
      }
    }
  }

  @Override
  public void ended(String session) {
    Session s = sessions.remove(session);
    if (s != null) {
      deliverAll(new SessionTimeChange(session, s.user(), UserTime.now()));
    }
  }

  /**
   * The time of an endpoint request to {@code plugin} from {@code user}: the time of the session its
   * {@value #SESSION_HEADER} header names, when the plugin is temporal and the session is that
   * user's; otherwise {@code now}.
   */
  UserTime timeFor(String plugin, @Nullable String session, User user) {
    if (session == null || !plugins.containsKey(plugin)) {
      return UserTime.now();
    }
    Session s = sessions.get(session);
    return s != null && s.user().id().equals(user.id()) ? s.time() : UserTime.now();
  }

  /** How many sessions are open. */
  int sessions() {
    return sessions.size();
  }

  private void deliverAll(SessionTimeChange change) {
    plugins.forEach((plugin, delivery) -> deliver(plugin, delivery, change));
  }

  private void deliver(String plugin, Temporal.Delivery<?> delivery, SessionTimeChange change) {
    try {
      delivery.deliver(change); // the plugin's mapper, then a send that never blocks
    } catch (RuntimeException e) {
      LOG.warn("Plugin {}: delivering a session's time failed", plugin, e);
      statuses.setByEcore(plugin, PluginState.DEGRADED, "delivering a session's time failed: " + e);
    }
  }
}
