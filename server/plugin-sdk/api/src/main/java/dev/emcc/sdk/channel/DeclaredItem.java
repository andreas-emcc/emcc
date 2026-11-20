package dev.emcc.sdk.channel;

import dev.emcc.sdk.Message;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.worker.Coalescing;
import java.util.Objects;
import java.util.UUID;
import java.util.regex.Pattern;

/**
 * SDK 1.9.0 (CR-0048 point 4; ADR-0059 point 3, gap G3): an item of a channel kind that a plugin
 * declares, with a JSON payload whose shape that plugin's manifest gives.
 *
 * <p>The declaring plugin names the kind in its manifest's {@code channelKinds}: a {@code name},
 * a {@code title}, a {@code description} and the {@code payload}'s JSON Schema. The kind's id is
 * {@code <plugin-id>.<name>}, e.g. {@code fmv.camera-pose}. Its channels take the kind ({@link
 * ChannelSpec#declaredKinds}); other plugins find them ({@link ChannelInfo#takesDeclared}) and send
 * items with {@link Channels#send(ChannelId, DeclaredItem)}.
 *
 * <pre>{@code
 * JsonObject pose = JsonObject.builder().put("camera", new JsonString(cameraId.toString())) … .build();
 * context.channels().send(output, new DeclaredItem("fmv.camera-pose", cameraId, platformLabel, pose));
 * }</pre>
 *
 * <p><b>Not a {@link ChannelItem}:</b> {@code ChannelItem} stays sealed with its three records, so no
 * plugin's {@code switch} over it changes.
 *
 * @param kind the kind's id, {@code <plugin-id>.<name>}: lowercase words separated by hyphens on each
 *     side of the dot, the name at most 64 characters
 * @param id what the receiving plugin keeps the newest of, e.g. a camera: ECore's channel inbox
 *     keeps only the newest item per id, as for map objects (ADR-0037 point 6), and the item
 *     coalesces by it ({@link Coalescing})
 * @param label the security label of what the item describes (ADR-0007), e.g. the camera's
 *     platform, so that the receiving plugin applies its classification limit (ADR-0037 point 8)
 * @param payload the item's data, immutable; ECore checks it against the kind's schema and {@link
 *     #MAX_PAYLOAD_BYTES} at {@link Channels#send(ChannelId, DeclaredItem)}
 */
public record DeclaredItem(String kind, UUID id, SecurityLabel label, JsonObject payload) implements Message, Coalescing {

  /** The largest payload, as compact UTF-8 JSON, ECore accepts: 64 KiB. */
  public static final int MAX_PAYLOAD_BYTES = 65_536;

  /** The longest name of a declared kind, the part after the plugin id. */
  public static final int MAX_NAME = 64;

  private static final Pattern NAME = Pattern.compile("[a-z][a-z0-9]*(-[a-z0-9]+)*");
  private static final Pattern PLUGIN_ID = Pattern.compile("[a-z][a-z0-9]*(-[a-z0-9]+)*");

  public DeclaredItem {
    checkKind(kind);
    Objects.requireNonNull(id, "id");
    Objects.requireNonNull(label, "label");
    Objects.requireNonNull(payload, "payload");
  }

  @Override
  public Object coalesceKey() {
    return id;
  }

  /** The plugin id in {@link #kind}, before the dot. */
  public String plugin() {
    return kind.substring(0, kind.indexOf('.'));
  }

  /**
   * Checks a declared kind's id, {@code <plugin-id>.<name>}.
   *
   * @throws IllegalArgumentException if it is not one
   */
  public static void checkKind(String kind) {
    Objects.requireNonNull(kind, "kind");
    int dot = kind.indexOf('.');
    if (dot < 1 || dot != kind.lastIndexOf('.')) {
      throw new IllegalArgumentException("a declared kind's id is '<plugin-id>.<name>': " + kind);
    }
    String plugin = kind.substring(0, dot);
    String name = kind.substring(dot + 1);
    if (!PLUGIN_ID.matcher(plugin).matches() || plugin.length() > 64 || !NAME.matcher(name).matches() || name.length() > MAX_NAME) {
      throw new IllegalArgumentException("a declared kind's id is '<plugin-id>.<name>', each lowercase words separated by hyphens, the name at most " + MAX_NAME + " characters: " + kind);
    }
  }
}
