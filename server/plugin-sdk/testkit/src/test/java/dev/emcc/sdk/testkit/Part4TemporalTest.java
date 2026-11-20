package dev.emcc.sdk.testkit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.PluginContext;
import dev.emcc.sdk.User;
import dev.emcc.sdk.UserTime;
import dev.emcc.sdk.capability.Temporal;
import java.time.Instant;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** SDK 1.4.0 part 4: the test kit's temporal plugin, session times on the fake context, and the capability check. */
class Part4TemporalTest {

  private static final Instant T1 = Instant.parse("2026-11-06T08:00:00Z");
  private static final Instant T2 = Instant.parse("2026-11-06T09:30:00Z");
  private static final User ALICE = new User("alice", "Alice", Set.of(), false);
  private static final User BOB = new User("bob", "Bob", Set.of(), false);

  @Test
  void aTemporalPluginGetsEachSessionsTimeAndForgetsAnEndedSession() {
    var ctx = FakePluginContext.builder("temporal-test").build();
    var plugin = new TemporalTestPlugin();
    plugin.init(ctx);
    plugin.start();
    ctx.setSessionTime(plugin, "s1", ALICE, UserTime.at(T1));
    ctx.setSessionTime(plugin, "s2", BOB, UserTime.now().withInterval(T1, T2));
    ctx.runUntilIdle();
    assertThat(plugin.received()).hasSize(2);
    assertThat(plugin.sessions()).isEqualTo(Map.of("s1", UserTime.at(T1), "s2", UserTime.now().withInterval(T1, T2)));
    ctx.setSessionTime(plugin, "s1", ALICE, UserTime.now()); // the session ended (owner, Q10)
    ctx.runUntilIdle();
    assertThat(plugin.sessions()).containsOnlyKeys("s2");
  }

  @Test
  void anEndpointRequestCarriesTheSessionsTime() {
    var ctx = FakePluginContext.builder("temporal-test").build();
    var plugin = new TemporalTestPlugin();
    plugin.init(ctx);
    plugin.start();
    var before = ctx.call("/time", ALICE);
    ctx.runUntilIdle();
    assertThat(before.reply().body().toUtf8()).isEqualTo("now");
    ctx.setSessionTime(plugin, "s1", ALICE, UserTime.at(T1));
    var at = ctx.call("/time", ALICE);
    var other = ctx.call("/time", BOB);
    ctx.runUntilIdle();
    assertThat(at.reply().body().toUtf8()).isEqualTo("at 2026-11-06T08:00:00Z");
    assertThat(other.reply().body().toUtf8()).isEqualTo("now");
    ctx.setSessionTime(plugin, "s1", ALICE, UserTime.at(T1).withInterval(T1, T2));
    ctx.setSessionTime(plugin, "s2", BOB, UserTime.now().withInterval(T1, T2));
    var both = ctx.call("/time", ALICE);
    var intervalOnly = ctx.call("/time", BOB);
    ctx.runUntilIdle();
    assertThat(both.reply().body().toUtf8()).isEqualTo("at 2026-11-06T08:00:00Z interval 2026-11-06T08:00:00Z 2026-11-06T09:30:00Z");
    assertThat(intervalOnly.reply().body().toUtf8()).isEqualTo("now interval 2026-11-06T08:00:00Z 2026-11-06T09:30:00Z");
  }

  static final class Undeclared implements Plugin, Temporal {
    public void init(PluginContext context) {}

    public void start() {}

    public void stop() {}

    public Delivery<?> timeDelivery() {
      throw new UnsupportedOperationException();
    }
  }

  static final class Plain implements Plugin {
    public void init(PluginContext context) {}

    public void start() {}

    public void stop() {}
  }

  @Test
  void theCapabilityCheckNamesEachMismatch() {
    var declared = TestJson.parse("{\"capabilities\": [\"temporal\"]}");
    var none = TestJson.parse("{}");
    var unknown = TestJson.parse("{\"capabilities\": [\"history\"]}");
    assertThat(CapabilityCheck.problem(TemporalTestPlugin.class, declared)).isNull();
    assertThat(CapabilityCheck.problem(Plain.class, none)).isNull();
    assertThat(CapabilityCheck.problem(Plain.class, declared)).contains("temporal").contains("declared but not implemented");
    assertThat(CapabilityCheck.problem(Undeclared.class, none)).contains("temporal").contains("not declared");
    assertThat(CapabilityCheck.problem(Plain.class, unknown)).contains("unknown capability history");
    // Owner, Q11: a declared capability may be the web part's; the server part implements only declared ones.
    var withWeb = TestJson.parse("{\"capabilities\": [\"temporal\"], \"web\": {\"entry\": \"index.js\"}}");
    assertThat(CapabilityCheck.problem(Plain.class, withWeb)).isNull();
    assertThat(CapabilityCheck.problem(Undeclared.class, TestJson.parse("{\"web\": {\"entry\": \"index.js\"}}"))).contains("not declared");
    CapabilityCheck.assertMatches(TemporalTestPlugin.class, TestJsonTest.MODEL.resolve("examples/valid/manifest-capabilities.json"));
    assertThatThrownBy(() -> CapabilityCheck.assertMatches(Undeclared.class, TestJsonTest.MODEL.resolve("examples/valid/manifest-fields.json")))
        .isInstanceOf(AssertionError.class).hasMessageContaining("temporal");
  }
}
