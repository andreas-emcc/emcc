package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;

import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/** Every request must name this server (DNS rebinding), also one without a Host header (live-hardening (d)). */
class HostCheckFilterTest {

  private final HostCheckFilter filter = new HostCheckFilter(new HostCheckInterceptor("", "", "none", ""));

  /** The status of the request on port 8080, or 0 when it reached the application. */
  private int send(String protocol, @Nullable String host, String serverName) throws Exception {
    MockHttpServletRequest request = new MockHttpServletRequest("GET", "/api/config");
    request.setProtocol(protocol);
    request.setScheme("http");
    request.setServerName(serverName); // what the container resolved: the request line's or the Host's name
    request.setServerPort(8080);
    request.setLocalPort(8080);
    if (host != null) {
      request.addHeader("Host", host);
    }
    MockHttpServletResponse response = new MockHttpServletResponse();
    MockFilterChain chain = new MockFilterChain();
    filter.doFilter(request, response, chain);
    return chain.getRequest() == null ? response.getStatus() : 0;
  }

  @Test
  void aRequestThatNamesThisServerGoesThrough() throws Exception {
    assertThat(send("HTTP/1.1", "localhost:8080", "localhost")).isZero();
    assertThat(send("HTTP/1.1", "127.0.0.1:8080", "127.0.0.1")).isZero();
    assertThat(send("HTTP/1.1", "[::1]:8080", "::1")).isZero();
  }

  @Test
  void anotherNameOrPortIsRefused() throws Exception {
    assertThat(send("HTTP/1.1", "evil.example:8080", "evil.example")).isEqualTo(403);
    assertThat(send("HTTP/1.1", "localhost:8081", "localhost")).as("another port").isEqualTo(403);
    assertThat(send("HTTP/1.1", "", "localhost")).as("an empty Host").isEqualTo(403);
  }

  @Test
  void withoutAHostHeaderTheNameTheContainerResolvedDecides() throws Exception {
    assertThat(send("HTTP/1.0", null, "127.0.0.1")).as("HTTP/1.0 to this server's address").isZero();
    assertThat(send("HTTP/1.0", null, "localhost")).isZero();
    assertThat(send("HTTP/1.0", null, "evil.example")).as("an absolute request line naming another site").isEqualTo(403);
  }
}
