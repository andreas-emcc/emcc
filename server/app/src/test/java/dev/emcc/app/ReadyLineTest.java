package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

/** M9 B3: the ready line's text, a contract for the release's start scripts. */
class ReadyLineTest {

  @Test
  void hasItsFixedFormsForHttpHttpsAndTheRedirectPort() {
    assertThat(ReadyLine.line(false, "localhost", 8080, null)).isEqualTo("emcc ready at http://localhost:8080/");
    assertThat(ReadyLine.line(true, "localhost", 8443, null)).isEqualTo("emcc ready at https://localhost:8443/");
    assertThat(ReadyLine.line(true, "localhost", 8443, 8081))
        .isEqualTo("emcc ready at https://localhost:8443/ (http://localhost:8081/ redirects to it)");
  }

  @Test
  void namesTheHostAsABrowserWritesIt() {
    assertThat(ReadyLine.host("")).isEqualTo("localhost");
    assertThat(ReadyLine.host("0.0.0.0")).isEqualTo("localhost");
    assertThat(ReadyLine.host("::")).isEqualTo("localhost");
    assertThat(ReadyLine.host("127.0.0.1")).isEqualTo("127.0.0.1");
    assertThat(ReadyLine.host("::1")).isEqualTo("[::1]");
    assertThat(ReadyLine.host("emcc.example.org")).isEqualTo("emcc.example.org");
  }
}
