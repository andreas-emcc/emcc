package dev.emcc.plugins.fmv.transport;

import dev.emcc.plugins.fmv.in.LabelRule;
import dev.emcc.plugins.fmv.in.Mapper;
import dev.emcc.plugins.fmv.in.StandardIdentity;
import dev.emcc.sdk.LayerChoice;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.SecurityLabel;
import java.util.ArrayList;
import java.util.List;
import org.jspecify.annotations.Nullable;

/**
 * A link's settings other than its connection (brief section 5): they change at once, without a
 * reconnect (work package 3).
 *
 * @param targetLayer the layer picker's choice, or {@code null} for a new layer named like the link
 * @param label the objects' label (and that of a layer the writer makes), or {@code null}: the server's default
 * @param mapClassification {@code map} ({@code true}) or {@code link label}
 * @param classificationNames the policy's classifications for ST 0102 tag 1's values 1 to 5
 * @param cameraSymbol the camera's APP-6D SIDC, 20 digits
 * @param cameraIdentity the camera's standard identity
 * @param fovColour the arc's line, {@code #RRGGBB}
 * @param time which clock {@code time.observed} follows
 * @param staleSeconds after this long without a set, the panel says Stale (2 to 300)
 */
public record LinkSettings(
    @Nullable LayerChoice targetLayer,
    @Nullable SecurityLabel label,
    boolean mapClassification,
    List<String> classificationNames,
    String cameraSymbol,
    StandardIdentity cameraIdentity,
    String fovColour,
    Mapper.TimeSource time,
    int staleSeconds) {

  public static final String DEFAULT_COLOUR = "#FFD400";
  public static final int DEFAULT_STALE_SECONDS = 10;

  public LinkSettings {
    classificationNames = List.copyOf(classificationNames);
  }

  /**
   * Reads them from one entry of the {@code links} setting.
   *
   * @throws IllegalArgumentException with a problem an admin can act on
   */
  public static LinkSettings from(JsonObject entry, String name) {
    try {
      SecurityLabel label = null;
      if (entry.get("label") instanceof JsonObject l) {
        if (!(l.get("policy") instanceof JsonString p) || !(l.get("classification") instanceof JsonString c)) {
          throw new IllegalArgumentException("a label is {\"policy\": ..., \"classification\": ...}");
        }
        label = SecurityLabel.of(p.value(), c.value());
      }
      String symbol = text(entry, "cameraSymbol");
      if (symbol == null) {
        symbol = Mapper.DEFAULT_CAMERA_SYMBOL;
      } else if (!symbol.matches("[0-9]{20}")) {
        throw new IllegalArgumentException("cameraSymbol must be an APP-6D SIDC of 20 digits");
      }
      StandardIdentity identity = StandardIdentity.FRIEND;
      String identityText = text(entry, "cameraIdentity");
      if (identityText != null) {
        identity = StandardIdentity.fromJson(identityText);
        if (identity == null) {
          throw new IllegalArgumentException("unknown cameraIdentity " + identityText);
        }
      }
      String colour = text(entry, "fovColour");
      if (colour == null) {
        colour = DEFAULT_COLOUR;
      } else if (!colour.matches("#[0-9A-Fa-f]{6}")) {
        throw new IllegalArgumentException("fovColour is #RRGGBB");
      }
      String time = text(entry, "time") == null ? "received" : text(entry, "time");
      if (!time.equals("received") && !time.equals("stream")) {
        throw new IllegalArgumentException("time is received or stream");
      }
      boolean map = switch (text(entry, "classification") == null ? "map" : text(entry, "classification")) {
        case "map" -> true;
        case "link-label" -> false;
        default -> throw new IllegalArgumentException("classification is map or link-label");
      };
      List<String> names = LabelRule.NATO;
      if (entry.get("classificationNames") instanceof JsonArray a) {
        var list = new ArrayList<String>();
        for (JsonValue v : a.values()) {
          if (!(v instanceof JsonString s) || s.value().isBlank() || s.value().length() > 64) {
            throw new IllegalArgumentException("classificationNames holds five classifications of 1 to 64 characters");
          }
          list.add(s.value());
        }
        if (list.size() != 5) {
          throw new IllegalArgumentException("classificationNames holds five classifications, for ST 0102's 1 (unclassified) to 5 (top secret)");
        }
        names = list;
      }
      int stale = DEFAULT_STALE_SECONDS;
      if (entry.get("staleSeconds") instanceof JsonNumber n) {
        long v = n.longValueExact();
        if (v < 2 || v > 300) {
          throw new IllegalArgumentException("staleSeconds is 2 to 300");
        }
        stale = (int) v;
      }
      return new LinkSettings(LayerChoice.from(entry.get("targetLayer")), label, map, names, symbol, identity, colour.toUpperCase(java.util.Locale.ROOT),
          Mapper.TimeSource.fromJson(time), stale);
    } catch (IllegalArgumentException e) {
      throw new IllegalArgumentException("link " + name + ": " + e.getMessage(), e);
    }
  }

  private static @Nullable String text(JsonObject entry, String key) {
    return entry.get(key) instanceof JsonString s && !s.value().isBlank() ? s.value().strip() : null;
  }
}
