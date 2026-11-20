package dev.emcc.sdk;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.LayerContent;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.store.ObjectQuery;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** SDK 1.2.0 (CR-0025 part 5): workspaces in the API, with the 1.1.0 constructors kept (N5). */
class WorkspacesTest {

  private static final SecurityLabel LABEL = SecurityLabel.of("NATO", "UNCLASSIFIED");

  @Test
  void viewIsFirstAndADeclaredWorkspaceHasBothPermissions() {
    Workspace view = Workspace.view();
    assertThat(view.isView()).isTrue();
    assertThat(view.editPermissionFor(true)).isEqualTo(Permissions.LAYERS_EDIT);
    assertThat(view.editPermissionFor(false)).isEqualTo(Permissions.OBJECTS_EDIT);
    var sim = new Workspace("simulator.simulation", "Simulation", "plugin.simulator.view", "plugin.simulator.edit", 100);
    assertThat(sim.editPermissionFor(true)).isEqualTo("plugin.simulator.edit");
    assertThat(sim.editPermissionFor(false)).isEqualTo("plugin.simulator.edit");
    assertThat(view.order()).isLessThan(sim.order());
    assertThatThrownBy(() -> new Workspace("simulator.simulation", "Simulation", "plugin.simulator.view", null, 1)).hasMessageContaining("edit permission");
    assertThatThrownBy(() -> new Workspace("Simulation", "Simulation", "plugin.simulator.view", "plugin.simulator.edit", 1)).hasMessageContaining("type name");
    assertThatThrownBy(() -> new Workspace("simulator.simulation", "", "plugin.simulator.view", "plugin.simulator.edit", 1)).hasMessageContaining("name");
  }

  @Test
  void aLayerIsInViewUnlessItNamesAWorkspace() {
    var view = new LayerContent("Own forces", 1, true, LABEL, Extensions.empty());
    assertThat(view.workspace()).as("the 1.1.0 constructor: View").isNull();
    assertThat(view.workspaceOrView()).isEqualTo(Workspace.VIEW);
    var sim = view.inWorkspace("simulator.simulation");
    assertThat(sim.workspace()).isEqualTo("simulator.simulation");
    assertThat(sim.name()).isEqualTo("Own forces");
    assertThat(view.inWorkspace(Workspace.VIEW).workspaceOrView()).isEqualTo(Workspace.VIEW);
    assertThatThrownBy(() -> view.inWorkspace("Simulation")).hasMessageContaining("type name");
  }

  @Test
  void aQueryWithoutAWorkspaceFilterTakesEveryWorkspace() {
    ObjectQuery all = ObjectQuery.all();
    assertThat(all.workspaces()).isEmpty();
    assertThat(all.matchesWorkspace(null)).isTrue();
    assertThat(all.matchesWorkspace("simulator.simulation")).isTrue();
    ObjectQuery viewOnly = ObjectQuery.byDataSource("tak-north").inWorkspaces(Workspace.VIEW);
    assertThat(viewOnly.matchesWorkspace(null)).as("a layer without workspace is in View").isTrue();
    assertThat(viewOnly.matchesWorkspace("simulator.simulation")).isFalse();
    assertThat(viewOnly.limit(10).workspaces()).as("the withers keep it").containsExactly(Workspace.VIEW);
    assertThat(ObjectQuery.all().inWorkspaces(Workspace.VIEW, Workspace.VIEW).workspaces()).as("named twice counts once").containsExactly(Workspace.VIEW);
    assertThatThrownBy(() -> ObjectQuery.all().inWorkspaces()).as("an empty filter would take every workspace").hasMessageContaining("at least one");
    var old = new ObjectQuery(null, null, "tak-north", null, null, null, 10);
    assertThat(old.workspaces()).as("the 1.1.0 constructor: every workspace").isEqualTo(Set.of());
  }
}
