package dev.emcc.ecore.monitor;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import java.net.URL;
import java.net.URLClassLoader;
import java.time.Duration;
import org.junit.jupiter.api.Test;

/** The monitor's allocation line (T-148): the JVM's total, and ECore's share from JFR (spike S5). */
class AllocationTest {

  private static final long MIB = 1024 * 1024;

  @Test
  void withoutSamplingOnlyTheTotalIsCounted() {
    try (Allocation allocation = Allocation.totalOnly()) {
      long before = allocation.read().totalBytes();
      PluginAllocator.allocate(8 * MIB);
      Allocation.Reading after = allocation.read();

      assertThat(after.totalBytes()).as("the JDK's counter, HotSpot counts it").isGreaterThanOrEqualTo(before + 8 * MIB);
      assertThat(after.sampling()).isFalse();
      assertThat(after.sampledBytes()).isZero();
      assertThat(after.ecoreBytes()).isZero();
    }
  }

  @Test
  void aSampleWithAPluginFrameIsNotECoresAndOneWithoutIs() {
    try (Allocation allocation = Allocation.totalOnly()) {
      allocation.add(1_000, true);
      allocation.add(300, false);

      assertThat(allocation.read()).extracting(Allocation.Reading::sampledBytes, Allocation.Reading::ecoreBytes).containsExactly(1_300L, 300L);
    }
    assertThat(Allocation.hasPluginFrame(null)).as("a sample without a stack is ECore's").isFalse();
  }

  @Test
  void jfrLeavesWhatAPluginsCodeAllocatesOutOfECoresShare() throws Exception {
    try (Allocation allocation = Allocation.sampling()) {
      assumeTrue(allocation.read().sampling(), "JFR is available in this JVM");
      URL classes = PluginAllocator.class.getProtectionDomain().getCodeSource().getLocation();
      // Named like a plugin's (PluginClassLoader); its parent cannot see the test classes, so it loads its own copy.
      try (URLClassLoader loader = new URLClassLoader("plugin-t148", new URL[] {classes}, ClassLoader.getPlatformClassLoader())) {
        Runnable plugin = (Runnable) loader.loadClass(PluginAllocator.class.getName()).getDeclaredConstructor().newInstance();
        assertThat(plugin.getClass().getClassLoader()).isSameAs(loader);
        Thread thread = Thread.ofPlatform().name("t148-plugin").start(plugin);
        PluginAllocator.allocate(64 * MIB); // meanwhile ECore's: the test's own class loader
        thread.join();
      }

      // JFR hands its samples over about once a second (S5).
      long deadline = System.nanoTime() + Duration.ofSeconds(20).toNanos();
      Allocation.Reading r = allocation.read();
      while ((r.sampledBytes() - r.ecoreBytes() < 150 * MIB || r.ecoreBytes() < 40 * MIB) && System.nanoTime() < deadline) {
        Thread.sleep(200);
        r = allocation.read();
      }

      assertThat(r.sampledBytes() - r.ecoreBytes()).as("the plugin's 200 MiB, on a platform thread (S5: within 4 %)")
          .isBetween(150 * MIB, 250 * MIB);
      assertThat(r.ecoreBytes()).as("ECore's 64 MiB at least").isGreaterThanOrEqualTo(40 * MIB);
      assertThat(r.totalBytes()).isGreaterThanOrEqualTo(r.sampledBytes() - 64 * MIB);
    }
  }
}
