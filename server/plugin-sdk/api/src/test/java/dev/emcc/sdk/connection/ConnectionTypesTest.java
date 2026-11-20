package dev.emcc.sdk.connection;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.worker.Coalescing;
import dev.emcc.sdk.worker.Overflow;
import java.time.Duration;
import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;

/** SDK 1.2.0 (CR-0025 part 2): the value types of connection tasks. */
class ConnectionTypesTest {

  record Plain(int n) implements Message {}

  record Keyed(String uid) implements Message, Coalescing {
    @Override
    public @Nullable Object coalesceKey() {
      return uid;
    }
  }

  @Test
  void aSpecHasTheDefaultsAndItsWithersReturnNewSpecs() {
    ConnectionSpec<Plain> spec = ConnectionSpec.of("tak-out", Plain.class);
    assertThat(spec.inboxCapacity()).isEqualTo(ConnectionSpec.DEFAULT_INBOX_CAPACITY);
    assertThat(spec.overflow()).isEqualTo(Overflow.dropNewest());
    assertThat(spec.restart()).isEqualTo(Restart.never());

    Backoff backoff = Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(60));
    ConnectionSpec<Plain> changed = spec.inbox(10, Overflow.dropOldest()).restart(Restart.onFailure(backoff));
    assertThat(changed.inboxCapacity()).isEqualTo(10);
    assertThat(changed.overflow()).isEqualTo(Overflow.dropOldest());
    assertThat(changed.restart()).isEqualTo(new Restart.OnFailure(backoff));
    assertThat(spec.inboxCapacity()).as("the original is unchanged").isEqualTo(ConnectionSpec.DEFAULT_INBOX_CAPACITY);
  }

  @Test
  void aSpecRefusesBadNamesCapacitiesAndCoalescingWithoutAKey() {
    assertThatThrownBy(() -> ConnectionSpec.of("Tak Out", Plain.class)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> ConnectionSpec.of("tak-out/child", Plain.class)).as("a slash is the parent's").isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> ConnectionSpec.of("tak-out", Plain.class).inbox(0, Overflow.dropNewest())).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> ConnectionSpec.of("tak-out", Plain.class).inbox(100_001, Overflow.dropNewest())).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> ConnectionSpec.of("tak-out", Plain.class).inbox(10, Overflow.coalesceByKey()))
        .hasMessageContaining("Coalescing");
    assertThat(ConnectionSpec.of("tak-out", Keyed.class).inbox(10, Overflow.coalesceByKey()).overflow()).isEqualTo(Overflow.coalesceByKey());
    assertThat(ConnectionSpec.of("tak-out", Message.class).inbox(10, Overflow.coalesceByKey()).overflow())
        .as("an interface whose items may implement Coalescing, as for mailboxes").isEqualTo(Overflow.coalesceByKey());
  }

  @Test
  void theBackoffDoublesUpToItsMaximum() {
    Backoff b = Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(10));
    assertThat(b.delay(0)).isEqualTo(Duration.ofSeconds(1));
    assertThat(b.delay(3)).isEqualTo(Duration.ofSeconds(8));
    assertThat(b.delay(10)).isEqualTo(Duration.ofSeconds(10));
    assertThatThrownBy(() -> Backoff.exponential(Duration.ofMillis(50), Duration.ofSeconds(1))).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> b.delay(-1)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void aListenAddressBindsToLoopbackUnlessTheSettingsNameAnother() {
    ListenAddress at = ListenAddress.from(JsonObject.builder().put("port", JsonNumber.of(4242)).build());
    assertThat(at).isEqualTo(new ListenAddress(ListenAddress.LOOPBACK, 4242, null));
    assertThat(at.allInterfaces()).isFalse();
    assertThat(at.unresolved().isUnresolved()).as("it only parses").isTrue();

    ListenAddress all = ListenAddress.from(JsonObject.builder().put("address", JsonString.of("0.0.0.0")).put("port", JsonNumber.of(4242)).build());
    assertThat(all.allInterfaces()).isTrue();
    for (String unspecified : new String[] {"::", "[::]", "0:0:0:0:0:0:0:0"}) {
      assertThat(new ListenAddress(unspecified, 1, null).allInterfaces()).as(unspecified).isTrue();
    }
    assertThat(new ListenAddress("::1", 1, null).allInterfaces()).isFalse();
    ListenAddress blank = ListenAddress.from(JsonObject.builder().put("address", JsonString.of(" ")).put("port", JsonNumber.of(1)).build());
    assertThat(blank.address()).as("a blank address is no address").isEqualTo(ListenAddress.LOOPBACK);
  }

  @Test
  void aListenAddressNeedsAWholePortInRange() {
    assertThatThrownBy(() -> ListenAddress.from(JsonObject.empty())).hasMessageContaining("port");
    assertThatThrownBy(() -> ListenAddress.from(JsonObject.builder().put("port", JsonNumber.of(1.5)).build())).hasMessageContaining("port");
    assertThatThrownBy(() -> ListenAddress.from(JsonObject.builder().put("port", JsonNumber.of(70_000)).build())).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> ListenAddress.from(JsonObject.builder().put("port", JsonNumber.of(1)).put("address", JsonNumber.of(7)).build()))
        .hasMessageContaining("string");
  }

  @Test
  void aMulticastLinkNeedsItsGroupAndAnInterfaceThatAnAdminNames() {
    JsonObject withInterface = JsonObject.builder()
        .put("address", JsonString.of("239.2.3.1"))
        .put("port", JsonNumber.of(6969))
        .put("interface", JsonString.of("eth0"))
        .build();
    assertThat(ListenAddress.multicast(withInterface)).isEqualTo(new ListenAddress("239.2.3.1", 6969, "eth0"));
    assertThatThrownBy(() -> ListenAddress.multicast(withInterface.without("interface"))).hasMessageContaining("an admin names one");
    assertThatThrownBy(() -> ListenAddress.multicast(withInterface.without("address"))).hasMessageContaining("group");
  }

  @Test
  void eventsAndRestartsAreValues() {
    var at = java.time.Instant.parse("2026-01-01T00:00:00Z");
    assertThat(new ConnectionEvent.Running("tak-out", at)).isEqualTo(new ConnectionEvent.Running("tak-out", at));
    assertThat(new ConnectionEvent.Restarting("tak-out", at, "connection reset", at.plusSeconds(1)).retryAt()).isEqualTo(at.plusSeconds(1));
    assertThat(Restart.always(Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(2)))).isInstanceOf(Restart.Always.class);
  }
}
