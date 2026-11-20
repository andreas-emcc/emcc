package dev.emcc.ecore.runtime;

import java.lang.management.GarbageCollectorMXBean;
import java.lang.management.ManagementFactory;

/** The JVM's total time in garbage collection so far, in milliseconds (tests give their own). */
@FunctionalInterface
public interface GcTime {

  long totalMillis();

  /** The JVM's collectors, summed; a collector that cannot tell (-1) counts as 0. */
  static GcTime jvm() {
    return () -> {
      long total = 0;
      for (GarbageCollectorMXBean gc : ManagementFactory.getGarbageCollectorMXBeans()) {
        total += Math.max(0, gc.getCollectionTime());
      }
      return total;
    };
  }
}
