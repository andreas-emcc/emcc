package dev.emcc.sdk.listener;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Duration;
import org.junit.jupiter.api.Test;

class ListenerSpecTest {

  @Test
  void defaultsAndWithers() {
    ListenerSpec tcp = ListenerSpec.tcp("tak-north", "tak.example.local", 8087);
    assertThat(tcp.transport()).isEqualTo(new Transport.Tcp());
    assertThat(tcp.connectTimeout()).isEqualTo(ListenerSpec.DEFAULT_CONNECT_TIMEOUT);
    assertThat(tcp.idleTimeout()).isEqualTo(ListenerSpec.DEFAULT_IDLE_TIMEOUT);
    assertThat(tcp.reconnect()).as("no reconnect unless asked").isNull();

    Backoff backoff = Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(60));
    ListenerSpec tls = ListenerSpec.tls("tak-north", "tak.example.local", 8089, "tak-north")
        .idleTimeout(Duration.ofMinutes(2))
        .connectTimeout(Duration.ofSeconds(3))
        .reconnect(backoff);
    assertThat(tls.transport()).isEqualTo(new Transport.Tls("tak-north"));
    assertThat(tls.idleTimeout()).isEqualTo(Duration.ofMinutes(2));
    assertThat(tls.connectTimeout()).isEqualTo(Duration.ofSeconds(3));
    assertThat(tls.reconnect()).isEqualTo(backoff);
  }

  @Test
  void rejectsBadValues() {
    assertThatThrownBy(() -> ListenerSpec.tcp("TAK North", "h", 1)).hasMessageContaining("listener name");
    assertThatThrownBy(() -> ListenerSpec.tcp("tak", "", 1)).hasMessageContaining("host");
    assertThatThrownBy(() -> ListenerSpec.tcp("tak", "h", 0)).hasMessageContaining("port");
    assertThatThrownBy(() -> ListenerSpec.tcp("tak", "h", 65_536)).hasMessageContaining("port");
    assertThatThrownBy(() -> ListenerSpec.tcp("tak", "h", 1).idleTimeout(Duration.ofMillis(500))).hasMessageContaining("idle");
    assertThatThrownBy(() -> ListenerSpec.tcp("tak", "h", 1).connectTimeout(Duration.ofMinutes(2))).hasMessageContaining("connect");
    assertThatThrownBy(() -> ListenerSpec.tls("tak", "h", 1, "../keystore")).hasMessageContaining("credentials");
  }

  @Test
  void backoffDoublesUpToItsMaximum() {
    Backoff backoff = Backoff.exponential(Duration.ofSeconds(1), Duration.ofSeconds(60));
    assertThat(backoff.delay(0)).isEqualTo(Duration.ofSeconds(1));
    assertThat(backoff.delay(1)).isEqualTo(Duration.ofSeconds(2));
    assertThat(backoff.delay(5)).isEqualTo(Duration.ofSeconds(32));
    assertThat(backoff.delay(6)).isEqualTo(Duration.ofSeconds(60));
    assertThat(backoff.delay(1_000_000)).isEqualTo(Duration.ofSeconds(60));
    assertThatThrownBy(() -> Backoff.exponential(Duration.ofSeconds(5), Duration.ofSeconds(1))).hasMessageContaining("max");
    assertThatThrownBy(() -> backoff.delay(-1)).isInstanceOf(IllegalArgumentException.class);
  }
}
