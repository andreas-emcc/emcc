package dev.emcc.sdk.stream;

import dev.emcc.sdk.Permissions;
import dev.emcc.sdk.model.SecurityLabel;
import java.util.Objects;
import java.util.regex.Pattern;

/**
 * SDK 1.8.0 (CR-0044 E1): a stream to open. Immutable.
 *
 * <pre>{@code
 * StreamSpec.of("link-1", "video/mp2t", Permissions.ofPlugin("fmv", "view"), label)
 * }</pre>
 *
 * @param name the stream's name in its URL: {@code [a-z0-9][a-z0-9-]{0,63}}, e.g. from a link's id
 * @param mediaType its {@code Content-Type}: lower case, without parameters, e.g. {@code video/mp2t}
 * @param permission the permission a viewer needs, required: the plugin's own ({@code
 *     Permissions.ofPlugin}) or a core one; ECore checks it at every viewer's start
 * @param label the stream's security label, for the clearance check when access by label comes
 *     (ADR-0057 point 4); changed with {@link StreamRef#label}
 */
public record StreamSpec(String name, String mediaType, String permission, SecurityLabel label) {

  private static final Pattern NAME = Pattern.compile("[a-z0-9][a-z0-9-]{0,63}");
  private static final Pattern MEDIA_TYPE = Pattern.compile("[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9][a-z0-9!#$&^_.+-]*");

  public StreamSpec {
    Objects.requireNonNull(name, "name");
    Objects.requireNonNull(mediaType, "mediaType");
    Objects.requireNonNull(permission, "permission");
    Objects.requireNonNull(label, "label");
    if (!NAME.matcher(name).matches()) {
      throw new IllegalArgumentException("a stream's name is [a-z0-9][a-z0-9-]{0,63}: " + name);
    }
    if (mediaType.length() > 128 || !MEDIA_TYPE.matcher(mediaType).matches()) {
      throw new IllegalArgumentException("a stream's media type is lower case, without parameters: " + mediaType);
    }
    Permissions.check(permission);
  }

  public static StreamSpec of(String name, String mediaType, String permission, SecurityLabel label) {
    return new StreamSpec(name, mediaType, permission, label);
  }
}
