package dev.emcc.sdk.testkit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.tngtech.archunit.core.domain.JavaClasses;
import com.tngtech.archunit.core.importer.ClassFileImporter;
import com.tngtech.archunit.lang.ArchRule;
import dev.emcc.sdk.testkit.sample.bad.BadSamples;
import dev.emcc.sdk.testkit.sample.good.GoodPlugin;
import dev.emcc.sdk.testkit.sample.unmarked.Unmarked;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;

class PluginRulesTest {

  private static final String GOOD = "dev.emcc.sdk.testkit.sample.good";
  private static final String BAD = "dev.emcc.sdk.testkit.sample.bad";

  @Test
  void aPluginThatFollowsTheRulesPasses() {
    JavaClasses classes = new ClassFileImporter().importPackages(GOOD);
    PluginRules.check(GOOD, classes);
  }

  /** Each sample class breaks exactly the rule whose description starts with the given name. */
  static Stream<Arguments> violations() {
    return Stream.of(
        Arguments.of(BadSamples.StartsThread.class, "concurrency"),
        Arguments.of(BadSamples.UsesExecutorSubclass.class, "concurrency"),
        Arguments.of(BadSamples.UsesLock.class, "concurrency"),
        Arguments.of(BadSamples.Sleeps.class, "concurrency"),
        Arguments.of(BadSamples.WaitsWithNanos.class, "concurrency"),
        Arguments.of(BadSamples.TimedJoin.class, "concurrency"),
        Arguments.of(BadSamples.TimedWait.class, "concurrency"),
        Arguments.of(BadSamples.SynchronizedMethod.class, "synchronized methods"),
        Arguments.of(BadSamples.UsesFile.class, "I/O"),
        Arguments.of(BadSamples.UsesZip.class, "I/O"),
        Arguments.of(BadSamples.StaticArray.class, "static constants"),
        Arguments.of(BadSamples.StaticAtomic.class, "static constants"),
        Arguments.of(BadSamples.StaticMutableList.class, "static constants"),
        Arguments.of(BadSamples.StaticConcurrentMap.class, "static constants"),
        Arguments.of(BadSamples.MessageWithLog.class, "message fields"),
        Arguments.of(BadSamples.MessageWithContext.class, "message fields"),
        Arguments.of(BadSamples.MessageWithSpec.class, "message fields"),
        Arguments.of(BadSamples.MessageWithStore.class, "message fields"),
        Arguments.of(BadSamples.MessageWithConnection.class, "message fields"),
        Arguments.of(BadSamples.ParallelStream.class, "parallel streams"),
        Arguments.of(BadSamples.OwnHttpClient.class, "I/O"),
        Arguments.of(BadSamples.ReadsFiles.class, "I/O"),
        Arguments.of(BadSamples.OpensUrl.class, "I/O"),
        Arguments.of(BadSamples.Exits.class, "process control"),
        Arguments.of(BadSamples.StartsProcess.class, "process control"),
        Arguments.of(BadSamples.UsesSpring.class, "Spring"),
        Arguments.of(BadSamples.UsesGeographicLib.class, "GeographicLib"),
        Arguments.of(BadSamples.UsesEcore.class, "SDK only"),
        Arguments.of(BadSamples.UsesOtherPlugin.class, "SDK only"),
        Arguments.of(BadSamples.UsesTestKit.class, "SDK only"),
        Arguments.of(BadSamples.MutableStatic.class, "static state"),
        Arguments.of(BadSamples.NotARecordMessage.class, "message types"),
        Arguments.of(BadSamples.ArrayMessage.class, "message fields"),
        Arguments.of(BadSamples.MutableListMessage.class, "message fields"),
        Arguments.of(BadSamples.OptionalMessage.class, "message fields"),
        Arguments.of(BadSamples.ForeignTypeMessage.class, "message fields"),
        Arguments.of(BadSamples.NestedBadMessage.class, "message fields"),
        Arguments.of(BadSamples.ListOfForeignMessage.class, "message fields"),
        Arguments.of(BadSamples.OpensSocketOutsideTask.class, "sockets"),
        Arguments.of(BadSamples.LooksUpNameOutsideTask.class, "sockets"),
        Arguments.of(BadSamples.ResolvesInConstructorOutsideTask.class, "sockets"),
        Arguments.of(BadSamples.UsesTlsFactoryOutsideTask.class, "sockets"),
        Arguments.of(BadSamples.OpensSelectorOutsideTask.class, "sockets"),
        Arguments.of(BadSamples.OpensSocketChannelOutsideTask.class, "sockets"),
        Arguments.of(BadSamples.AsksHostNameOutsideTask.class, "sockets"),
        Arguments.of(BadSamples.ProbesOutsideTask.class, "sockets"),
        Arguments.of(BadSamples.LambdaTask.class, "sockets"),
        Arguments.of(BadSamples.HelperTakesSocket.class, "sockets"),
        Arguments.of(BadSamples.TaskReadsFiles.class, "I/O"),
        Arguments.of(BadSamples.TaskUsesHttpClient.class, "I/O"),
        Arguments.of(BadSamples.MessageWithTaskContext.class, "message fields"),
        Arguments.of(BadSamples.MessageWithConnections.class, "message fields"),
        Arguments.of(BadSamples.MessageWithChannels.class, "message fields"),
        Arguments.of(BadSamples.ComputeUsesStore.class, "compute tasks"),
        Arguments.of(BadSamples.ComputeUsesContext.class, "compute tasks"),
        Arguments.of(BadSamples.ComputeHelperSendsOnChannel.Helper.class, "compute tasks"),
        Arguments.of(BadSamples.ComputeUsesTimers.class, "compute tasks"),
        Arguments.of(BadSamples.ComputeSleeps.class, "concurrency"),
        Arguments.of(BadSamples.ComputeOpensSocket.class, "sockets"),
        Arguments.of(BadSamples.ComputeAndConnection.class, "compute or connection"),
        Arguments.of(BadSamples.MessageWithComputeContext.class, "message fields"),
        Arguments.of(BadSamples.MessageWithComputes.class, "message fields"),
        Arguments.of(Unmarked.class, "null handling"));
  }

  @ParameterizedTest(name = "{0} breaks \"{1}\"")
  @MethodSource("violations")
  void everyRuleCatchesItsViolation(Class<?> sample, String rule) {
    JavaClasses classes = new ClassFileImporter().importClasses(sample, BadSamples.Holder.class);
    List<String> violated =
        PluginRules.all(BAD).stream().filter(r -> r.evaluate(classes).hasViolation()).map(ArchRule::getDescription).toList();
    assertThat(violated).as("violated rules").anyMatch(d -> d.startsWith(rule));
  }

  @Test
  void pluginPackagesFollowTheConvention() {
    assertThat(PluginRules.packageFor("basemap-osm")).isEqualTo("dev.emcc.plugins.basemaposm");
    assertThat(PluginRules.packageFor("map-view-2d")).isEqualTo("dev.emcc.plugins.mapview2d");
    assertThatThrownBy(() -> PluginRules.packageFor("Bad_Id")).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> PluginRules.checkPlugin("no-such-plugin")).hasMessageContaining("no classes found");
  }
}
