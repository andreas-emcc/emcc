package dev.emcc.app;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.ecore.store.Requester;
import dev.emcc.sdk.model.EntityType;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.junit.jupiter.api.Test;
import org.springframework.security.oauth2.core.oidc.OidcIdToken;
import org.springframework.security.oauth2.core.oidc.user.DefaultOidcUser;

/** The logged-in user as the edge sees it: the IAM's sub, a name, and permissions from roles (ADR-0022). */
class CurrentUserTest {

  private static DefaultOidcUser login(Map<String, Object> claims) {
    Map<String, Object> all = new java.util.HashMap<>(claims);
    all.putIfAbsent("sub", "u-42");
    OidcIdToken token = new OidcIdToken("t", Instant.now(), Instant.now().plusSeconds(60), all);
    return new DefaultOidcUser(List.of(), token);
  }

  private static OidcProperties oidc(String claim, Map<String, List<String>> permissions) {
    return new OidcProperties("http://iam", "c", "s", List.of("openid"), claim, permissions, "{baseUrl}/logout");
  }

  @Test
  void pluginsSeeTheLoggedInUserWithItsPermissionsOrTheLocalUserWithEveryOne() {
    dev.emcc.sdk.User alice = PluginController.sdkUser(new User("u-alice", "alice", false, Set.of("objects.edit")), LoginMode.OIDC);
    assertThat(alice.id()).isEqualTo("u-alice");
    assertThat(alice.name()).isEqualTo("alice");
    assertThat(alice.noLogin()).isFalse();
    assertThat(alice.has("objects.edit")).isTrue();
    assertThat(alice.has("settings.admin")).isFalse();

    dev.emcc.sdk.User local = PluginController.sdkUser(User.LOCAL, LoginMode.NONE);
    assertThat(local.noLogin()).isTrue();
    assertThat(local.has("settings.admin")).isTrue();
  }

  @Test
  void theLivePictureChecksChangesAgainstTheLoginsPermissionsOrTheLocalUsersEveryOne() {
    Requester.User alice = LiveWebSocketHandler.requester(new User("u-alice", "alice", false, Set.of("objects.edit")));
    assertThat(alice.id()).isEqualTo("u-alice");
    assertThat(alice.mayChange(EntityType.OBJECT)).isTrue();
    assertThat(alice.mayChange(EntityType.LAYER)).isFalse();

    Requester.User local = LiveWebSocketHandler.requester(User.LOCAL);
    assertThat(local.id()).isEqualTo("local");
    assertThat(local.mayChange(EntityType.OBJECT)).isTrue();
    assertThat(local.mayChange(EntityType.LAYER)).isTrue();
  }

  @Test
  void theIdIsTheSubAndTheNameThePreferredUsername() {
    User user = CurrentUser.user(login(Map.of("preferred_username", "alice", "name", "Alice A.")), oidc("groups", Map.of()));
    assertThat(user.id()).isEqualTo("u-42");
    assertThat(user.name()).isEqualTo("alice");
    assertThat(user.allPermissions()).isFalse();
    assertThat(CurrentUser.user(login(Map.of("name", "Alice A.")), oidc("groups", Map.of())).name()).isEqualTo("Alice A.");
    assertThat(CurrentUser.user(login(Map.of()), oidc("groups", Map.of())).name()).as("never empty").isEqualTo("u-42");
  }

  @Test
  void permissionsComeFromTheRolesInTheConfiguredClaim() {
    OidcProperties config = oidc("groups", Map.of("objects.edit", List.of("editors", "admins"), "settings.admin", List.of("admins"),
        "plugin.cot-in.streams", List.of("tak")));

    assertThat(CurrentUser.user(login(Map.of("groups", List.of("editors", "viewers"))), config).permissions())
        .containsExactly("objects.edit");
    assertThat(CurrentUser.user(login(Map.of("groups", List.of("admins", "tak"))), config).permissions())
        .containsExactlyInAnyOrder("objects.edit", "settings.admin", "plugin.cot-in.streams");
    assertThat(CurrentUser.user(login(Map.of()), config).permissions()).as("no claim, no permission").isEmpty();
  }

  @Test
  void aStarGivesThePermissionToEveryLoggedInUserWithOrWithoutGroups() { // owner ACD A
    OidcProperties config = oidc("groups", Map.of("plugin.fmv.view", List.of("*"), "objects.edit", List.of("*", "admins"),
        "settings.admin", List.of("admins")));

    assertThat(CurrentUser.user(login(Map.of()), config).permissions()).as("no claim at all")
        .containsExactlyInAnyOrder("plugin.fmv.view", "objects.edit");
    assertThat(CurrentUser.user(login(Map.of("groups", List.of("viewers"))), config).permissions())
        .as("* with groups on one line: everyone; the groups add nothing").containsExactlyInAnyOrder("plugin.fmv.view", "objects.edit");
    assertThat(CurrentUser.user(login(Map.of("groups", List.of("admins"))), config).permissions())
        .containsExactlyInAnyOrder("plugin.fmv.view", "objects.edit", "settings.admin");
    assertThat(CurrentUser.user(login(Map.of("groups", List.of("*"))), oidc("groups", Map.of("settings.admin", List.of("admins"))))
        .permissions()).as("a group named * in the token gives nothing of its own").isEmpty();
  }

  @Test
  void aDottedClaimReachesIntoAnObjectAsKeycloaksRealmRoles() {
    assertThat(CurrentUser.roles(Map.of("realm_access", Map.of("roles", List.of("editors", "offline_access"))), "realm_access.roles"))
        .isEqualTo(Set.of("editors", "offline_access"));
    assertThat(CurrentUser.roles(Map.of("roles", "a b,c"), "roles")).isEqualTo(Set.of("a", "b", "c"));
  }

  @Test
  void theClientSecretIsNeverPrinted() {
    String text = new OidcProperties("http://iam", "c", "s3cr3t-value", List.of("openid"), "groups", Map.of(), "{baseUrl}/logout").toString();
    assertThat(text).doesNotContain("s3cr3t-value").contains("clientSecret=(set, not shown)").contains("clientId=c");
  }

  @Test
  void theSettingsAreCheckedAtStart() {
    assertThatThrownBy(() -> new OidcProperties(null, "c", null, List.of(), "groups", Map.of(), "{baseUrl}/logout").check())
        .hasMessageContaining("emc2.login.oidc.issuer-uri").hasMessageContaining("emc2.login.oidc.client-secret")
        .hasMessageNotContaining("emc2.login.oidc.client-id").hasMessageContaining("--emc2.login.mode=none");
    assertThat(OidcProperties.missingText(List.of("emc2.login.oidc.issuer-uri", "emc2.login.oidc.client-secret")))
        .as("a release user has no README: what is missing, where to set it, and how to run without login")
        .isEqualTo("Login with OpenID Connect (emc2.login.mode=oidc, the default) is missing emc2.login.oidc.issuer-uri, "
            + "emc2.login.oidc.client-secret: set emc2.login.oidc.issuer-uri in settings/emcc.properties, the client "
            + "secret in settings/credentials/login.properties (never in the repository). Or, for no login on this "
            + "computer only, start with -standalone (start.bat or start.sh) or set emc2.login.mode=none (in "
            + "settings/emcc.properties, or --emc2.login.mode=none on the command line).");
    assertThat(OidcProperties.missingText(List.of("emc2.login.oidc.client-secret")))
        .startsWith("Login with OpenID Connect (emc2.login.mode=oidc, the default) is missing emc2.login.oidc.client-secret: "
            + "set the client secret in settings/credentials/login.properties (never");
    assertThatThrownBy(() -> oidc("groups", Map.of("Objects Edit", List.of("x"))).check()).hasMessageContaining("'Objects Edit'");
    assertThat(oidc("groups", Map.of()).scopes()).as("openid is always asked for").contains("openid");
    assertThat(new OidcProperties("i", "c", "s", List.of("profile"), "groups", Map.of(), "{baseUrl}/logout").scopes())
        .containsExactly("openid", "profile");
  }
}
