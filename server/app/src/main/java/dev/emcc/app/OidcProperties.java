package dev.emcc.app;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;

/**
 * Login with OpenID Connect (ADR-0022), {@code emc2.login.oidc.*}. The client secret is local
 * a credentials file ({@code settings/credentials/login.properties}, ADR-0060) or an environment variable, never in the
 * repository.
 *
 * @param issuerUri the IAM's issuer, e.g. {@code http://localhost:8180/realms/emc2}; its discovery
 *     document is read at start
 * @param clientId this server's client id at the IAM
 * @param clientSecret this server's client secret: emc2 is a confidential client
 * @param scopes the scopes asked for; {@code openid} is added if missing
 * @param rolesClaim the claim with the user's roles or groups, a list of strings; a dotted name
 *     reaches into an object, e.g. {@code realm_access.roles}
 * @param permissions emc2 permission → the roles or groups that have it, e.g. {@code
 *     emc2.login.oidc.permissions[objects.edit]=editors,admins}; {@value #EVERYONE} among them gives it to every
 *     logged-in user, whatever their groups, so other groups on that line add nothing (owner ACD A)
 * @param backChannelLogoutUri where the server sends itself the logout when the IAM's back-channel
 *     logout arrives: by default its own address as the IAM called it ({@code {baseUrl}/logout});
 *     behind a reverse proxy better a loopback address, e.g. {@code http://127.0.0.1:8080/logout}
 */
@ConfigurationProperties("emc2.login.oidc")
record OidcProperties(
    @Nullable String issuerUri,
    @Nullable String clientId,
    @Nullable String clientSecret,
    @DefaultValue({"openid", "profile"}) List<String> scopes,
    @DefaultValue("groups") String rolesClaim,
    @DefaultValue Map<String, List<String>> permissions,
    @DefaultValue("{baseUrl}/logout") String backChannelLogoutUri) {

  /** In a permission's list: every logged-in user has it (owner ACD A). Only with login; the no-login mode has all. */
  static final String EVERYONE = "*";

  /** A permission name as the plugin manifest allows it (the SDK's {@code Permissions}). */
  static final Pattern PERMISSION = Pattern.compile("[a-z][a-z0-9-]*(\\.[a-z][a-z0-9-]*)+");

  OidcProperties {
    scopes = scopes.contains("openid") ? List.copyOf(scopes)
        : java.util.stream.Stream.concat(java.util.stream.Stream.of("openid"), scopes.stream()).toList();
    permissions = Map.copyOf(permissions);
  }

  /** Without the client secret: settings are logged, and the secret must never be (R3 of the security review). */
  @Override
  public String toString() {
    return "OidcProperties[issuerUri=" + issuerUri + ", clientId=" + clientId + ", clientSecret="
        + (clientSecret == null ? null : "(set, not shown)") + ", scopes=" + scopes + ", rolesClaim=" + rolesClaim
        + ", permissions=" + permissions + ", backChannelLogoutUri=" + backChannelLogoutUri + "]";
  }

  /**
   * Refuses to start with incomplete settings, naming what is missing and how to run without login
   * instead. Never a fallback to the no-login mode (ADR-0022).
   */
  void check() {
    List<String> missing = new ArrayList<>();
    if (issuerUri == null || issuerUri.isBlank()) missing.add("emc2.login.oidc.issuer-uri");
    if (clientId == null || clientId.isBlank()) missing.add("emc2.login.oidc.client-id");
    if (clientSecret == null || clientSecret.isBlank()) missing.add("emc2.login.oidc.client-secret");
    if (!missing.isEmpty()) {
      throw new IllegalStateException(missingText(missing));
    }
    for (String permission : permissions.keySet()) {
      if (!PERMISSION.matcher(permission).matches()) {
        throw new IllegalStateException("emc2.login.oidc.permissions: '" + permission + "' is no permission name "
            + "(e.g. objects.edit or plugin.cot-in.streams); write it in brackets: permissions[objects.edit]=...");
      }
    }
  }

  /**
   * The stop text for missing login settings: what is missing, where an installation sets it (server/README.md,
   * "Settings"), and the two ways to run without login. A release user has no README, so the text says it all.
   */
  static String missingText(List<String> missing) {
    List<String> settings = missing.stream().filter(k -> !k.endsWith(".client-secret")).toList();
    List<String> where = new ArrayList<>();
    if (!settings.isEmpty()) where.add("set " + String.join(" and ", settings) + " in settings/emcc.properties");
    if (settings.size() < missing.size()) {
      where.add((where.isEmpty() ? "set " : "") + "the client secret in settings/credentials/login.properties");
    }
    return "Login with OpenID Connect (" + LoginMode.SETTING + "=oidc, the default) is missing "
        + String.join(", ", missing) + ": " + String.join(", ", where) + " (never in the repository). "
        + "Or, for no login on this computer only, start with -standalone (start.bat or start.sh) or set "
        + LoginMode.SETTING + "=none (in settings/emcc.properties, or --" + LoginMode.SETTING
        + "=none on the command line).";
  }
}
