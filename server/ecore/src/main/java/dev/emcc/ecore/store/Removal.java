package dev.emcc.ecore.store;

import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.TimeAttributes;
import java.time.Instant;
import org.jspecify.annotations.Nullable;

/**
 * When ECore removes expired objects of one data type (data model rule 15; owner, 2026-10-10): its
 * effective {@code expiresAfterSeconds} and {@code removeAfterExpirySeconds}.
 *
 * <p>An object is expired from {@code time.expires} on; without it, {@code expiresAfterSeconds}
 * after {@code time.observed}; without {@code expiresAfterSeconds}, or (data model 1.5.0, CR-0038
 * point 9) without {@code time.observed}, it does not expire by its data type. Before 1.5.0 the
 * last change ({@code meta.modified.at}) stood in for a missing {@code time.observed}. It is
 * removed {@code removeAfterExpirySeconds} after it expired.
 */
public record Removal(@Nullable Long expiresAfterSeconds, long removeAfterExpirySeconds) {

  public Removal {
    if (expiresAfterSeconds != null && expiresAfterSeconds < 1) {
      throw new IllegalArgumentException("expiresAfterSeconds must be >= 1: " + expiresAfterSeconds);
    }
    if (removeAfterExpirySeconds < 0) {
      throw new IllegalArgumentException("removeAfterExpirySeconds must be >= 0: " + removeAfterExpirySeconds);
    }
  }

  /** When the object expires, or null if it never does. */
  public @Nullable Instant expiresAt(MapObject object) {
    TimeAttributes time = object.content().time();
    Instant expires = time == null ? null : time.expires();
    if (expires != null) {
      return expires;
    }
    if (expiresAfterSeconds == null) {
      return null;
    }
    Instant observed = time == null ? null : time.observed();
    return observed == null ? null : observed.plusSeconds(expiresAfterSeconds);
  }

  /** True if the object is due for removal at {@code now}. */
  public boolean due(MapObject object, Instant now) {
    Instant expiresAt = expiresAt(object);
    return expiresAt != null && !expiresAt.plusSeconds(removeAfterExpirySeconds).isAfter(now);
  }
}
