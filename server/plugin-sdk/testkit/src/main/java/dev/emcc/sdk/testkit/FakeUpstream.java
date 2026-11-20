package dev.emcc.sdk.testkit;

import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.http.Headers;
import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * Scripted answers for outbound HTTP in a {@link FakePluginContext}, by exact URI. An unscripted
 * URI fails ("no fake response scripted"). A script stays in place for repeated calls.
 *
 * <pre>{@code
 * ctx.upstream().respond("https://tile.openstreetmap.org/5/17/9.png", 200, Headers.of("Content-Type", "image/png"), png);
 * ctx.upstream().respondAfter(Duration.ofSeconds(10), "https://tile.openstreetmap.org/5/17/10.png", 200, Headers.empty(), png);
 * ctx.upstream().fail("https://tile.openstreetmap.org/0/0/0.png", "connection refused");
 * ctx.upstream().never("https://tile.openstreetmap.org/1/0/0.png");   // times out
 * }</pre>
 */
public final class FakeUpstream {

  /** What the fake upstream does for one URI. */
  sealed interface Script permits Respond, Fail, Never {}

  record Respond(int status, Headers headers, Bytes body, Duration delay) implements Script {}

  record Fail(String reason) implements Script {}

  record Never() implements Script {}

  private final Map<String, Script> scripts = new HashMap<>();

  FakeUpstream() {}

  /** Answers at once. */
  public FakeUpstream respond(String uri, int status, Headers headers, Bytes body) {
    return respondAfter(Duration.ZERO, uri, status, headers, body);
  }

  /** Answers after {@code delay} of virtual time; if that exceeds the call's timeout, the call times out. */
  public FakeUpstream respondAfter(Duration delay, String uri, int status, Headers headers, Bytes body) {
    scripts.put(Objects.requireNonNull(uri), new Respond(status, headers, body, delay));
    return this;
  }

  /** Fails at once, like a refused connection. */
  public FakeUpstream fail(String uri, String reason) {
    scripts.put(Objects.requireNonNull(uri), new Fail(reason));
    return this;
  }

  /** Never answers: the call times out. */
  public FakeUpstream never(String uri) {
    scripts.put(Objects.requireNonNull(uri), new Never());
    return this;
  }

  @Nullable Script scriptFor(String uri) {
    return scripts.get(uri);
  }
}
