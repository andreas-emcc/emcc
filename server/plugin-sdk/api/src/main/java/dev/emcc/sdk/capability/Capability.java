package dev.emcc.sdk.capability;

import java.util.EnumSet;
import java.util.Optional;
import java.util.Set;

/**
 * SDK 1.4.0: the capabilities a plugin may declare in its manifest's {@code capabilities} (ADR-0044,
 * CR-0030 part 4), each with its id and, for the server part, the interface the plugin's class
 * implements. Declaration and code must agree (ADR-0044 point 4; owner, Q11, 2026-11-06): <b>every
 * declared capability is implemented by at least one part, and a part implements only declared
 * ones.</b> At load, ECore refuses a server part that implements an undeclared capability, or a
 * declared one when the plugin has no web part to implement it, and names the capability in the
 * Monitor's reason (the ACA's R3). When the shell reports that the web part lacks a declared
 * capability the server part also lacks, or implements an undeclared one, ECore records the fault
 * in the Monitor, naming the capability, and the shell does not use the web part's capabilities:
 * the plugin is running by then, so it is not stopped (the ACA's R1 on part 4). An unknown id fails
 * the manifest's schema, with the id named the same way (point 5).
 */
public enum Capability {
  /** {@code temporal}: the user's time (ADR-0045); the server part implements {@link Temporal}. */
  TEMPORAL("temporal", Temporal.class);

  private final String id;
  private final Class<?> type;

  Capability(String id, Class<?> type) {
    this.id = id;
    this.type = type;
  }

  /** The manifest's id, e.g. {@code temporal}. */
  public String id() {
    return id;
  }

  /** The interface a server part implements for it. */
  public Class<?> type() {
    return type;
  }

  /** The capability with this manifest id, if this SDK knows it. */
  public static Optional<Capability> fromId(String id) {
    for (Capability c : values()) {
      if (c.id.equals(id)) {
        return Optional.of(c);
      }
    }
    return Optional.empty();
  }

  /** The capabilities whose interfaces {@code pluginClass} implements. */
  public static Set<Capability> implementedBy(Class<?> pluginClass) {
    var set = EnumSet.noneOf(Capability.class);
    for (Capability c : values()) {
      if (c.type.isAssignableFrom(pluginClass)) {
        set.add(c);
      }
    }
    return set;
  }
}
