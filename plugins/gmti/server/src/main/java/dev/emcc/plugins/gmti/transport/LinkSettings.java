package dev.emcc.plugins.gmti.transport;

import dev.emcc.plugins.gmti.format.Edition;
import dev.emcc.plugins.gmti.in.LabelRule;
import dev.emcc.plugins.gmti.in.Receiver;
import dev.emcc.plugins.gmti.in.StandardIdentity;
import dev.emcc.sdk.ClassificationLimit;
import dev.emcc.sdk.LayerChoice;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonBoolean;
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
 * @param targetLayer {@code in}: the layer picker's choice, or {@code null} for a new layer named like the link
 * @param label {@code in}: the objects' label (and that of a layer the writer makes); {@code out}: the least a packet says; {@code null}: the server's default
 * @param platformSymbol {@code in}: the platform's APP-6D SIDC, or {@code null} for the default from {@code M3}
 * @param platformIdentity {@code in}: the platform's standard identity
 * @param maxReportsPerDwell {@code in}: the cap per dwell
 * @param time {@code in}: as recorded or as received (A1)
 * @param mapClassification {@code in}: {@code map} ({@code true}) or {@code link label} (A2)
 * @param classificationNames the policy's classifications for {@code P4} 1 to 5 (in: to map; out: to map back)
 * @param highestClassification {@code out}: detections above it are not sent; {@code null}: the policy's highest
 * @param nationality {@code out}: {@code P3} and {@code P5}
 * @param exercise {@code out}: {@code P7} 129 instead of 1
 * @param maxReportsPerSegment {@code out}: at most this many reports per dwell segment
 * @param coverage {@code in}: draw each sensor's coverage, the job's bounding area (T-158; on by default)
 * @param oneSegmentPerPacket {@code out}: each segment in its own packet (T-159; on by default, owner MY)
 * @param edition {@code out}: the STANAG 4607 edition the packets follow (M9.1; Edition 3 by default, owner 2026-11-20)
 */
public record LinkSettings(
    @Nullable LayerChoice targetLayer,
    @Nullable SecurityLabel label,
    @Nullable String platformSymbol,
    StandardIdentity platformIdentity,
    int maxReportsPerDwell,
    Receiver.TimeMode time,
    boolean mapClassification,
    List<String> classificationNames,
    @Nullable ClassificationLimit highestClassification,
    String nationality,
    boolean exercise,
    int maxReportsPerSegment,
    boolean coverage,
    boolean oneSegmentPerPacket,
    Edition edition) {

  /** The defaults of brief section 5. */
  public static final int DEFAULT_CAP = 1_000;
  public static final int DEFAULT_PER_SEGMENT = 120;

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
      String symbol = text(entry, "platformSymbol");
      if (symbol != null && !symbol.matches("[0-9]{20}")) {
        throw new IllegalArgumentException("platformSymbol must be an APP-6D SIDC of 20 digits");
      }
      StandardIdentity identity = StandardIdentity.UNKNOWN;
      String identityText = text(entry, "platformIdentity");
      if (identityText != null) {
        identity = StandardIdentity.fromJson(identityText);
        if (identity == null) {
          throw new IllegalArgumentException("unknown platformIdentity " + identityText);
        }
      }
      Receiver.TimeMode time = switch (text(entry, "time") == null ? "as-recorded" : text(entry, "time")) {
        case "as-recorded" -> Receiver.TimeMode.AS_RECORDED;
        case "as-received" -> Receiver.TimeMode.AS_RECEIVED;
        default -> throw new IllegalArgumentException("time is as-recorded or as-received");
      };
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
          throw new IllegalArgumentException("classificationNames holds five classifications, for P4 1 (top secret) to 5 (unclassified)");
        }
        names = list;
      }
      ClassificationLimit highest = null;
      JsonValue h = entry.get("highestClassification");
      if (h != null) {
        highest = ClassificationLimit.from(h, SecurityLabel.of("NATO", "UNCLASSIFIED")); // the fallback label is not used when h is set
      }
      String nationality = text(entry, "nationality") == null ? "XN" : text(entry, "nationality");
      if (!nationality.matches("[A-Z]{2}")) {
        throw new IllegalArgumentException("nationality is two capital letters, e.g. XN for NATO");
      }
      boolean exercise = entry.get("exercise") instanceof JsonBoolean b && b.value();
      String editionText = text(entry, "edition");
      Edition edition = editionText == null ? Edition.EDITION_3 : Edition.of(editionText);
      if (edition == null) {
        throw new IllegalArgumentException("edition is edition-3 or edition-4");
      }
      return new LinkSettings(LayerChoice.from(entry.get("targetLayer")), label, symbol, identity,
          number(entry, "maxReportsPerDwell", DEFAULT_CAP), time, map, names, highest, nationality, exercise,
          number(entry, "maxReportsPerSegment", DEFAULT_PER_SEGMENT), flag(entry, "coverage"), flag(entry, "oneSegmentPerPacket"), edition);
    } catch (IllegalArgumentException e) {
      throw new IllegalArgumentException("link " + name + ": " + e.getMessage(), e);
    }
  }

  /** A switch that is on unless the entry says {@code false}. */
  private static boolean flag(JsonObject entry, String key) {
    return !(entry.get(key) instanceof JsonBoolean b) || b.value();
  }

  private static int number(JsonObject entry, String key, int fallback) {
    JsonValue v = entry.get(key);
    if (v == null) {
      return fallback;
    }
    if (v instanceof JsonNumber n) {
      long value = n.longValueExact();
      if (value >= 1 && value <= 65_535) {
        return (int) value;
      }
    }
    throw new IllegalArgumentException(key + " is 1 to 65535");
  }

  private static @Nullable String text(JsonObject entry, String key) {
    return entry.get(key) instanceof JsonString s && !s.value().isBlank() ? s.value().strip() : null;
  }
}
