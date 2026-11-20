package dev.emcc.sdk.capability;

import dev.emcc.sdk.User;
import dev.emcc.sdk.UserTime;
import java.util.Objects;

/**
 * SDK 1.4.0: a browser session's time, as ECore delivers it to a {@link Temporal} plugin: at the
 * session's start, at each change of either part of its {@code UserTime} (CR-0032), and {@code
 * UserTime.NOW} once when the session ends, also a session that was at now (ADR-0045 point 4;
 * owner, Q10).
 *
 * @param session the session's opaque id, 1 to 128 characters, fixed for the session's life; an
 *     endpoint request carries its session's time as {@code userTime()}
 * @param user the session's user
 * @param time the time the user picked
 */
public record SessionTimeChange(String session, User user, UserTime time) {
  public SessionTimeChange {
    Objects.requireNonNull(session, "session");
    Objects.requireNonNull(user, "user");
    Objects.requireNonNull(time, "time");
    if (session.isEmpty() || session.length() > 128) {
      throw new IllegalArgumentException("a session id is 1..128 characters");
    }
  }
}
