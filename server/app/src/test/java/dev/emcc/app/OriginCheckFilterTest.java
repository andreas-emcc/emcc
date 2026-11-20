package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;

import org.jspecify.annotations.Nullable;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/** State-changing API requests from another site's page are refused (ADR-0022). */
class OriginCheckFilterTest {

  private final OriginCheckFilter filter = new OriginCheckFilter(new HostCheckInterceptor("", "", "none", ""));

  /** The status of the request, or 0 when it reached the application. */
  private int send(String method, String path, @Nullable String origin, @Nullable String referer) throws Exception {
    MockHttpServletRequest request = new MockHttpServletRequest(method, path);
    request.setScheme("http");
    request.addHeader("Host", "localhost:8080");
    if (origin != null) request.addHeader("Origin", origin);
    if (referer != null) request.addHeader("Referer", referer);
    MockHttpServletResponse response = new MockHttpServletResponse();
    MockFilterChain chain = new MockFilterChain();
    filter.doFilter(request, response, chain);
    return chain.getRequest() == null ? response.getStatus() : 0;
  }

  @Test
  void aPostFromThisServersOwnPageGoesThrough() throws Exception {
    assertThat(send("POST", "/api/plugins/x/do", "http://localhost:8080", null)).isZero();
    assertThat(send("DELETE", "/api/plugins/x/item", "HTTP://LocalHost:8080", null)).isZero();
  }

  @Test
  void aPostFromAnotherSitesPageIsRefused() throws Exception {
    assertThat(send("POST", "/api/plugins/x/do", "http://evil.example", null)).isEqualTo(403);
    assertThat(send("PUT", "/api/plugins/x/do", "http://localhost:8081", null)).as("another port").isEqualTo(403);
    assertThat(send("PATCH", "/api/plugins/x/do", "https://localhost:8080", null)).as("another scheme").isEqualTo(403);
  }

  @Test
  void anOpaqueOriginIsRefused() throws Exception {
    assertThat(send("POST", "/api/plugins/x/do", "null", null)).isEqualTo(403);
  }

  @Test
  void withoutOriginTheRefererDecides() throws Exception {
    assertThat(send("POST", "/api/plugins/x/do", null, "http://evil.example/page")).isEqualTo(403);
    assertThat(send("POST", "/api/plugins/x/do", null, "http://localhost:8080/index.html")).isZero();
  }

  @Test
  void callersThatAreNoBrowserGoThrough() throws Exception {
    assertThat(send("POST", "/api/dev/stop", null, null)).isZero();
  }

  @Test
  void readingRequestsAreNotChecked() throws Exception {
    assertThat(send("GET", "/api/config", "http://evil.example", null)).isZero();
    assertThat(send("HEAD", "/api/config", "http://evil.example", null)).isZero();
  }

  @Test
  void everyPathIsCheckedSoThatNoSpellingGetsAround() throws Exception {
    for (String path : new String[] {"/elsewhere", "/api;x/plugins/x/do", "/%61pi/plugins/x/do", "/api/plugins/x/do;x"}) {
      assertThat(send("POST", path, "http://evil.example", null)).as(path).isEqualTo(403);
    }
  }

  @Test
  void theSchemesDefaultPortIsTheSameOrigin() {
    assertThat(OriginCheckFilter.normalize("http://localhost:80")).isEqualTo("http://localhost");
    assertThat(OriginCheckFilter.normalize("https://emc2.example:443")).isEqualTo("https://emc2.example");
    assertThat(OriginCheckFilter.normalize("https://emc2.example:8443")).isEqualTo("https://emc2.example:8443");
  }
}
