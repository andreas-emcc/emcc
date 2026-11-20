package dev.emcc.plugins.nvg;

import dev.emcc.sdk.Plugin;
import dev.emcc.sdk.RelationKind;
import dev.emcc.sdk.User;
import dev.emcc.sdk.Workspace;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Layer;
import dev.emcc.sdk.model.LayerContent;
import dev.emcc.sdk.model.Meta;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.testkit.FakePluginContext;
import java.util.Set;
import java.util.UUID;

/** The plugin on the test kit's fake context, with the users and workspaces the tests need. */
public final class Rig {

  /** A workspace of another plugin, with its own permissions (ADR-0039). */
  public static final Workspace SIMULATION = new Workspace("simulator.simulation", "Simulation", "plugin.simulator.view", "plugin.simulator.edit", 10);

  public static final User EDITOR = User.of("editor", "Editor", Set.of("objects.edit", "layers.edit"));
  public static final User VIEWER = User.of("viewer", "Viewer", Set.of());
  public static final User ADMIN = User.of("admin", "Admin", Set.of("objects.edit", "layers.edit", "settings.admin", "plugin.simulator.view",
      "plugin.simulator.edit"));

  public final FakePluginContext context;
  public final Plugin plugin;

  private Rig(FakePluginContext context, Plugin plugin) {
    this.context = context;
    this.plugin = plugin;
  }

  /** The plugin's manifest, as the host reads it. */
  public static JsonObject manifest() {
    return Manifest.read();
  }

  /** The default of every setting. */
  public static JsonObject defaults() {
    return Manifest.settingDefaults();
  }

  public static Rig start() {
    return start(Manifest.settingDefaults());
  }

  public static Rig start(JsonObject settings) {
    return start(FakePluginContext.builder(Manifest.id()).settings(settings));
  }

  public static Rig start(FakePluginContext.Builder builder) {
    return start(builder, ctx -> {});
  }

  /** Starts the plugin after {@code setup} has scripted the fake context (e.g. its upstream). */
  public static Rig start(FakePluginContext.Builder builder, java.util.function.Consumer<FakePluginContext> setup) {
    FakePluginContext context = builder
        .workspaces(Workspace.view(), SIMULATION)
        .relationKinds(new RelationKind("nvg.part", "NVG composite", RelationKind.Line.of("#808080"), false))
        .build();
    setup.accept(context);
    try {
      Plugin plugin = (Plugin) Class.forName(Manifest.entryClass()).getConstructor().newInstance();
      plugin.init(context);
      plugin.start();
      context.runUntilIdle();
      return new Rig(context, plugin);
    } catch (ReflectiveOperationException e) {
      throw new IllegalStateException(e);
    }
  }

  /** A layer in a workspace ({@code null}: View), unlocked unless {@code locked}. */
  public Layer layer(String name, String workspace, boolean locked) {
    var audit = new Meta.Audit(context.clock(), Actor.plugin("layer-panel"));
    LayerContent content = new LayerContent(name, context.store().layers().size() + 1, true, SecurityLabel.of("NATO", "UNCLASSIFIED"),
        Extensions.empty()).inWorkspace(workspace).withLocked(locked ? Boolean.TRUE : null);
    Layer layer = new Layer(UUID.randomUUID(), 1, content, new Meta(audit, audit, null));
    context.store().seed(layer);
    return layer;
  }
}
