package dev.emcc.ecore.persistence;

import dev.emcc.ecore.persistence.ConfigStore.Config;
import java.util.Objects;
import java.util.function.Consumer;
import java.util.function.UnaryOperator;

/**
 * ECore's configuration while the server runs ({@link ConfigStore}): read from any thread, changed
 * rarely (by users with {@code settings.admin}).
 *
 * <p>Reads see an immutable {@link Config} behind a volatile field, without a lock. Changes take
 * turns under this object's monitor, which is a leaf lock (rule C4): inside it only the new value is
 * computed, written to the file and handed to {@code whenStored}, which must not take a lock or call
 * out either (it sets a volatile field); listeners are called by the caller afterwards.
 */
public final class Configuration {

  private final ConfigStore store;
  private volatile Config current;

  /** Loads the stored configuration. */
  public Configuration(ConfigStore store) {
    this.store = Objects.requireNonNull(store, "store");
    this.current = store.load();
  }

  public Config current() {
    return current;
  }

  /**
   * Applies {@code change} to the current configuration and stores the result before it becomes
   * current: a value that could not be stored is never seen.
   *
   * @param whenStored runs after the file is written, still in turn with other changes: so values
   *     derived from the configuration change in the same order as the file
   * @return the new configuration
   */
  public Config change(UnaryOperator<Config> change, Consumer<Config> whenStored) {
    synchronized (this) {
      Config next = Objects.requireNonNull(change.apply(current), "the changed configuration");
      store.save(next);
      current = next;
      whenStored.accept(next);
      return next;
    }
  }
}
