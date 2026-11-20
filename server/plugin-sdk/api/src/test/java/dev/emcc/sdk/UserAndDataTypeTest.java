package dev.emcc.sdk;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.http.Endpoint;
import java.util.Set;
import org.junit.jupiter.api.Test;

class UserAndDataTypeTest {

  @Test
  void aUserHasExactlyTheirPermissionsAndTheNoLoginUserHasAll() {
    User editor = User.of("3f2c9a10", "Editor", Set.of(Permissions.OBJECTS_EDIT));
    assertThat(editor.has(Permissions.OBJECTS_EDIT)).isTrue();
    assertThat(editor.has(Permissions.LAYERS_EDIT)).isFalse();
    assertThat(editor.noLogin()).isFalse();
    User local = User.noLoginUser();
    assertThat(local.has(Permissions.SETTINGS_ADMIN)).isTrue();
    assertThat(local.has(Permissions.ofPlugin("cot-in", "replay"))).isTrue();
    assertThat(local.id()).isEqualTo(User.NO_LOGIN_ID);
    assertThatThrownBy(() -> User.of("x", "X", Set.of("Objects Edit"))).hasMessageContaining("permission");
  }

  @Test
  void permissionNamesAreChecked() {
    assertThat(Permissions.ofPlugin("cot-in", "replay")).isEqualTo("plugin.cot-in.replay");
    assertThatThrownBy(() -> Permissions.check("objects")).isInstanceOf(IllegalArgumentException.class);
    assertThat(Endpoint.get("/streams").requires(Permissions.SETTINGS_ADMIN).permission()).isEqualTo("settings.admin");
    assertThat(Endpoint.get("/streams").permission()).isNull();
    assertThatThrownBy(() -> Endpoint.get("/streams").requires("admin")).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void dataTypesAreInTheirPluginsNamespace() {
    assertThat(DataType.general().id()).isEqualTo("core.general");
    assertThat(DataType.general().declaredBy()).isNull();
    var cot = new DataType("cot-in.cot", "CoT", null, "cot-in", new DataType.Defaults(null, true, 600L));
    assertThat(cot.defaults().removeAfterExpirySeconds()).isEqualTo(600L);
    assertThatThrownBy(() -> new DataType("cot-in.cot", "CoT", null, "draw-symbols", DataType.Defaults.NONE)).hasMessageContaining("its plugin");
    assertThatThrownBy(() -> new DataType("core.cot", "CoT", null, null, DataType.Defaults.NONE)).hasMessageContaining("core.general");
    assertThatThrownBy(() -> new DataType("cot-in.cot", "CoT", null, "cot-in", new DataType.Defaults(0L, false, null)))
        .hasMessageContaining("expiresAfterSeconds");
  }
}
