package dev.emcc.app;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * {@code emc2.http.*}: the bearer tokens of plugins' outbound HTTP calls (SDK 1.6.0, {@code
 * HttpCall.credential}; CR-0041 part A). Shared by name, as the TLS credentials are (owner,
 * 2026-11-12). They go in a credentials file only ({@code settings/credentials/http-<name>.properties}, ADR-0060) or
 * an environment variable, never in the settings or the repository:
 *
 * <pre>
 * emc2.http.credentials.anet.token=...
 * EMC2_HTTP_CREDENTIALS_ANET_TOKEN=...      (the same as an environment variable)
 * </pre>
 *
 * <p>A name that is not a credential's name, or a missing or blank token, stops the start, naming
 * the setting. The tokens are never shown.
 *
 * @param credentials the tokens by the name a plugin's {@code HttpCall.credential} gives
 */
@ConfigurationProperties("emc2.http")
record HttpProperties(@Nullable Map<String, Credential> credentials) {

  /** As {@code HttpCall} checks a credential's name. */
  private static final Pattern NAME = Pattern.compile("[A-Za-z0-9][A-Za-z0-9._-]{0,63}");

  /** One name's token. */
  record Credential(@Nullable String token) {

    /** Never shows the token. */
    @Override
    public String toString() {
      return "Credential[token not shown]";
    }
  }

  /**
   * The tokens by name, for ECore.
   *
   * @throws IllegalStateException naming the setting that is wrong
   */
  Map<String, String> tokens() {
    Map<String, String> tokens = new LinkedHashMap<>();
    if (credentials != null) {
      credentials.forEach((name, c) -> {
        String prefix = "emc2.http.credentials." + name;
        if (!NAME.matcher(name).matches()) {
          throw new IllegalStateException(prefix + ": a credential's name is 1 to 64 letters, digits, '.', '_' or '-'");
        }
        String token = c.token();
        if (token == null || token.isBlank()) {
          throw new IllegalStateException(prefix + ".token is missing");
        }
        if (token.chars().anyMatch(ch -> ch < 0x21 || ch > 0x7e)) {
          throw new IllegalStateException(prefix + ".token may hold only visible ASCII characters, no spaces");
        }
        tokens.put(name, token);
      });
    }
    return tokens;
  }

  /** Never shows the tokens. */
  @Override
  public String toString() {
    return "HttpProperties[credentials=" + (credentials == null ? "[]" : credentials.keySet()) + ", tokens not shown]";
  }
}
