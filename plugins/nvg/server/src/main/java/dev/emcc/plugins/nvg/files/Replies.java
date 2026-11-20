package dev.emcc.plugins.nvg.files;

import dev.emcc.sdk.Workspace;
import dev.emcc.sdk.http.HttpReply;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.model.Layer;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/** Answers and permission checks shared by the files endpoints. */
public final class Replies {

  private Replies() {}

  /** An error the panel shows: {@code {"error": message}}. */
  public static HttpReply error(int status, String message) {
    return HttpReply.json(status, JsonObject.of(Map.of("error", JsonString.of(message))));
  }

  /** Counters as a JSON object. */
  public static JsonObject counts(Map<String, Long> counts) {
    JsonObject.Builder b = JsonObject.builder();
    counts.forEach((k, v) -> b.put(k, JsonNumber.of(v)));
    return b.build();
  }

  /** The workspace a layer belongs to, or {@code null} when the server has none of that id. */
  public static @Nullable Workspace workspace(List<Workspace> all, Layer layer) {
    String id = layer.content().workspaceOrView();
    for (Workspace w : all) {
      if (w.id().equals(id)) {
        return w;
      }
    }
    return id.equals(Workspace.VIEW) ? Workspace.view() : null;
  }

  /** Whether the user may change a workspace's objects: {@code objects.edit} in View, the workspace's edit permission elsewhere. */
  public static boolean mayEdit(dev.emcc.sdk.User user, Workspace workspace) {
    return user.has(workspace.editPermissionFor(false));
  }

  /** Whether the user may see a workspace's layers: everyone in View, its view permission elsewhere. */
  public static boolean maySee(dev.emcc.sdk.User user, Workspace workspace) {
    return workspace.viewPermission() == null || user.has(workspace.viewPermission());
  }
}
