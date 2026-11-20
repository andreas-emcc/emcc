package dev.emcc.sdk.model;

import java.util.Objects;

/**
 * The identity of an object in an external system, so repeated reports from that system modify
 * the same object (model rule 16). A create request may carry it; the object store copies it to
 * {@link Meta#externalRef()} and keeps it unique per system and id among existing objects.
 *
 * <pre>{@code
 * new ExternalRef("cot", "ANDROID-358240051111110")
 * }</pre>
 *
 * @param system the identity's namespace, e.g. {@code cot}; 1 to 256 characters
 * @param id the id in that system; 1 to 512 characters
 */
public record ExternalRef(String system, String id) {

  public ExternalRef {
    Objects.requireNonNull(system, "system");
    Objects.requireNonNull(id, "id");
    if (system.isEmpty() || system.length() > 256) {
      throw new IllegalArgumentException("system must be 1..256 characters");
    }
    if (id.isEmpty() || id.length() > 512) {
      throw new IllegalArgumentException("id must be 1..512 characters");
    }
  }
}
