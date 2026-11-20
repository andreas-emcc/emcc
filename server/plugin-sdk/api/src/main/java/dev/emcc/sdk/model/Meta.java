package dev.emcc.sdk.model;

import java.time.Instant;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * Set by the object store: when and by whom an entity was created and last modified, and its
 * identity in an external system, copied from the create request (model rules 4 and 16). Clients
 * never send it.
 *
 * <pre>{@code
 * meta.externalRef()   // e.g. system "cot", id "ANDROID-358240051111110"
 * }</pre>
 *
 * @param created creation
 * @param modified last modification
 * @param externalRef the identity in an external system, or {@code null}
 */
public record Meta(Audit created, Audit modified, @Nullable ExternalRef externalRef) {

  public Meta {
    Objects.requireNonNull(created, "created");
    Objects.requireNonNull(modified, "modified");
  }

  /**
   * When and by whom.
   *
   * @param at the time, millisecond precision
   * @param by the actor
   */
  public record Audit(Instant at, Actor by) {
    public Audit {
      Objects.requireNonNull(at, "at");
      Objects.requireNonNull(by, "by");
    }
  }
}
