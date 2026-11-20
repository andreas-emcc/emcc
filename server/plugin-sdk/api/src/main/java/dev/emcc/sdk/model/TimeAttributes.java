package dev.emcc.sdk.model;

import java.time.Instant;
import org.jspecify.annotations.Nullable;

/**
 * Time attributes of a map object ({@code time} in JSON, model rule 15), e.g. from CoT's {@code
 * time}, {@code start} and {@code stale}. What happens after the expiry is configured per data
 * type (ADR-0023).
 *
 * <p>The record does not check that {@code validFrom} is not after {@code expires}: that is a rule
 * the object store checks ({@code VALIDATION_FAILED}).
 *
 * <pre>{@code
 * new TimeAttributes(time, start, stale)
 * }</pre>
 *
 * @param observed when the source observed or reported the information, or {@code null}
 * @param validFrom from when it is valid, or {@code null}
 * @param expires when it becomes stale, or {@code null}
 */
public record TimeAttributes(@Nullable Instant observed, @Nullable Instant validFrom, @Nullable Instant expires) {

  public boolean isEmpty() {
    return observed == null && validFrom == null && expires == null;
  }
}
