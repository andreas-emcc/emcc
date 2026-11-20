package dev.emcc.app;

import jakarta.servlet.http.HttpServletRequest;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import org.jspecify.annotations.Nullable;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.security.oauth2.client.authentication.OAuth2AuthenticationToken;
import org.springframework.security.oauth2.core.oidc.user.OidcUser;
import org.springframework.stereotype.Component;

/**
 * The user of an HTTP request (ADR-0022), the one place the edge asks. In the no-login mode every
 * request is the {@linkplain User#LOCAL local user}. With login it is the user of the login session:
 * the id is the IAM's {@code sub} (stable, never the display name), the name its {@code
 * preferred_username}, and the permissions those whose roles or groups ({@link
 * OidcProperties#rolesClaim()}) the user has ({@link OidcProperties#permissions()}).
 */
@Component
class CurrentUser {

  private final LoginMode mode;
  private final ObjectProvider<OidcProperties> oidc;

  CurrentUser(LoginMode mode, ObjectProvider<OidcProperties> oidc) {
    this.mode = mode;
    this.oidc = oidc;
  }

  LoginMode mode() {
    return mode;
  }

  /** The request's user, or null when nobody is logged in. */
  @Nullable User of(HttpServletRequest request) {
    return switch (mode) {
      case NONE -> User.LOCAL;
      case OIDC -> request.getUserPrincipal() instanceof OAuth2AuthenticationToken login
          && login.getPrincipal() instanceof OidcUser user ? user(user, oidc.getObject()) : null;
    };
  }

  static User user(OidcUser login, OidcProperties oidc) {
    String name = firstText(login.getClaims(), "preferred_username", "name");
    Set<String> roles = roles(login.getClaims(), oidc.rolesClaim());
    Set<String> permissions = new TreeSet<>();
    oidc.permissions().forEach((permission, granted) -> {
      if (granted.contains(OidcProperties.EVERYONE) || granted.stream().anyMatch(roles::contains)) {
        permissions.add(permission);
      }
    });
    return new User(login.getSubject(), name == null ? login.getSubject() : name, false, permissions);
  }

  /** The strings at a claim; a dotted name reaches into objects ({@code realm_access.roles}). */
  static Set<String> roles(Map<String, Object> claims, String claim) {
    Object value = claims.get(claim);
    if (value == null && claim.contains(".")) {
      Object current = claims;
      for (String part : claim.split("\\.")) {
        current = current instanceof Map<?, ?> map ? map.get(part) : null;
      }
      value = current;
    }
    Set<String> roles = new TreeSet<>();
    if (value instanceof Collection<?> list) {
      list.forEach(r -> roles.add(String.valueOf(r)));
    } else if (value instanceof String one) {
      roles.addAll(List.of(one.split("[,\\s]+")));
    }
    return roles;
  }

  private static @Nullable String firstText(Map<String, Object> claims, String... names) {
    for (String name : names) {
      if (claims.get(name) instanceof String text && !text.isBlank()) {
        return text;
      }
    }
    return null;
  }
}
