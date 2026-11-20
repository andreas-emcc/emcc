package dev.emcc.ecore;

import dev.emcc.ecore.persistence.Configuration;
import java.util.List;
import java.util.Objects;

/**
 * The installation's default look (ADR-0034 point 2): the look of every user who has not chosen
 * one, kept with ECore's configuration. Every logged-in user's shell reads it (through
 * {@code /api/config}); only {@code settings.admin} changes it, which the edge checks. Browsers get
 * a change at their next load (owner, 2026-10-17). Thread-safe: the configuration is.
 *
 * <p>The permission is the edge's to check ({@code AdminAccess}, as for every settings endpoint);
 * {@link #set} takes no user. The look names are also in the shell ({@code ui/theme.ts}) and the
 * web SDK's {@code Look} type: a fourth look needs all three.
 */
public final class InstallationLook {

  /** The looks emc2 ships ({@code docs/architecture/looks.md}), as the web SDK names them. */
  public static final List<String> LOOKS = List.of("night-watch", "chart-room", "signal");
  /** The built-in default, until an admin chooses one. */
  public static final String BUILT_IN = "night-watch";

  private final Configuration configuration;

  InstallationLook(Configuration configuration) {
    this.configuration = Objects.requireNonNull(configuration, "configuration");
  }

  /** The default look: the one an admin set, else {@link #BUILT_IN} (also for a stored one this version does not know). */
  public String current() {
    String look = configuration.current().defaultLook();
    return look != null && LOOKS.contains(look) ? look : BUILT_IN;
  }

  /**
   * Sets the default look and stores it.
   *
   * @throws IllegalArgumentException for a look that is not one of {@link #LOOKS}
   */
  public void set(String look) {
    if (!LOOKS.contains(look)) {
      throw new IllegalArgumentException("a look is one of " + String.join(", ", LOOKS) + ", not " + look);
    }
    configuration.change(c -> c.withDefaultLook(look), stored -> { });
  }
}
