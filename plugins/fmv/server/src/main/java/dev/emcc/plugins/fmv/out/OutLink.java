package dev.emcc.plugins.fmv.out;

import dev.emcc.plugins.fmv.in.LabelRule;
import dev.emcc.sdk.ClassificationLimit;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.SecurityLabel;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import org.jspecify.annotations.Nullable;

/**
 * One output link: an entry of the {@code links} setting with {@code direction} {@code out} (brief
 * section 10.2). Its destination comes only from here, never from a pose (ADR-0030, ADR-0058 point
 * 2); a new output link has none and sends nothing (O1).
 *
 * @param id the link's stable id (CR-0047): its channel, compute task and sender are known by it
 * @param name the name an admin sees: the channel's name, and the platform's name in ST 0601 when a pose names none
 * @param enabled whether it offers its channel
 * @param destination where it sends, or {@code null}: none set
 * @param highest the release limit, or {@code null}: the highest classification of a pose's policy
 * @param bitrateMbps the H.264 bit rate
 * @param keyframeSeconds the time between keyframes
 * @param metadataEvery an ST 0601 set every Nth frame
 * @param maxRateMbps the pacing
 * @param bilinear {@code bilinear} or {@code nearest} sampling
 * @param haze whether the picture has haze
 * @param imagerySet the imagery set's folder, or {@code null}: the first that covers the camera (B3)
 * @param classificationNames the names of ST 0102's classifications 1 to 5
 * @param classifyingCountry ST 0102's tag 3
 */
public record OutLink(
    String id,
    String name,
    boolean enabled,
    @Nullable Destination destination,
    @Nullable ClassificationLimit highest,
    double bitrateMbps,
    double keyframeSeconds,
    int metadataEvery,
    double maxRateMbps,
    boolean bilinear,
    boolean haze,
    @Nullable String imagerySet,
    List<String> classificationNames,
    String classifyingCountry) {

  /** Where an output link sends: an address for {@code udp}, or a group, its interface and a TTL for {@code multicast}. */
  public record Destination(boolean multicast, String host, int port, @Nullable String networkInterface, int ttl) {
    /** For the status: {@code udp 127.0.0.1:15200}, {@code multicast 239.1.2.3:15200 on eth0}. */
    public String where() {
      return (multicast ? "multicast " : "udp ") + host + ":" + port + (networkInterface != null ? " on " + networkInterface : "");
    }
  }

  public OutLink {
    classificationNames = List.copyOf(classificationNames);
  }

  /** Whether an entry of the {@code links} setting is an output link. */
  public static boolean isOut(JsonObject entry) {
    return entry.get("direction") instanceof JsonString d && d.value().equals("out");
  }

  /**
   * Reads one output link.
   *
   * @throws IllegalArgumentException with a problem an admin can act on
   */
  public static OutLink from(JsonObject entry) {
    String name = text(entry, "name");
    String id = text(entry, "id");
    if (id == null) {
      id = name;
    }
    if (id == null) {
      throw new IllegalArgumentException("a link needs a name");
    }
    if (name == null) {
      name = id;
    }
    try {
      boolean enabled = !(entry.get("enabled") instanceof JsonBoolean b) || b.value();
      boolean multicast = false;
      if (entry.get("mode") instanceof JsonString m) {
        multicast = switch (m.value()) {
          case "udp" -> false;
          case "multicast" -> true;
          default -> throw new IllegalArgumentException("mode is udp or multicast");
        };
      }
      Destination destination = destination(entry, multicast);
      ClassificationLimit highest = entry.get("highestClassification") instanceof JsonObject
          ? ClassificationLimit.from(entry.get("highestClassification"), SecurityLabel.of("NATO", "UNCLASSIFIED")) // the fallback is not used when it is set
          : null;
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
      String country = text(entry, "classifyingCountry");
      if (country == null) {
        country = "//NATO";
      } else if (!country.matches("//[A-Z]{1,4}")) {
        throw new IllegalArgumentException("classifyingCountry is // and 1 to 4 capital letters, e.g. //NATO");
      }
      String sampling = text(entry, "sampling");
      if (sampling != null && !sampling.equals("bilinear") && !sampling.equals("nearest")) {
        throw new IllegalArgumentException("sampling is bilinear or nearest");
      }
      return new OutLink(id, name, enabled, destination, highest,
          number(entry, "bitrate", 4, 0.5, 20),
          number(entry, "keyframeSeconds", 1, 0.5, 10),
          (int) whole(entry, "metadataEvery", 1, 1, 25),
          number(entry, "maxRate", 20, 1, 50),
          !"nearest".equals(sampling),
          !(entry.get("haze") instanceof JsonBoolean h) || h.value(),
          text(entry, "imagerySet"),
          names, country);
    } catch (IllegalArgumentException e) {
      throw new IllegalArgumentException("link " + name + ": " + e.getMessage(), e);
    }
  }

  /** The destination, or {@code null} while one of its parts is not set (O1). */
  private static @Nullable Destination destination(JsonObject entry, boolean multicast) {
    String host = text(entry, multicast ? "group" : "address");
    if (host == null || !(entry.get("port") instanceof JsonNumber)) {
      return null;
    }
    int port = (int) whole(entry, "port", 0, 1, 65535);
    String nic = text(entry, "interface");
    if (multicast) {
      if (!host.matches("2(2[4-9]|3[0-9])(\\.[0-9]{1,3}){3}|(?i)ff[0-9a-f]{2}:[0-9a-f:]*")) {
        throw new IllegalArgumentException("group " + host + " is not a multicast group (224.0.0.0 to 239.255.255.255)");
      }
      if (nic == null) {
        throw new IllegalArgumentException("a multicast output needs the interface an admin names");
      }
    } else if (host.equals("0.0.0.0") || host.equals("::")) {
      throw new IllegalArgumentException("address " + host + " is not a destination");
    }
    int ttl = (int) whole(entry, "ttl", 1, 1, 32);
    return new Destination(multicast, host, port, multicast ? nic : null, ttl);
  }

  /**
   * The channel's link name: {@code out-} and the id, made to fit. A channel's link name starts
   * with a letter (the SDK's {@code ChannelSpec}), so the id itself (a UUID v7, which starts with a
   * digit) cannot be it, as the brief's section 10.2 point 5 writes; the prefix keeps it stable
   * across a rename all the same.
   */
  public String channelLink() {
    return "out-" + key();
  }

  /** The compute task's name (section 10.3 point 9): {@code render-} and the id, made to fit. */
  public String renderTask() {
    return "render-" + key();
  }

  /** The sender's connection task's name. */
  public String sendTask() {
    return "send-" + key();
  }

  /**
   * The name of the link's {@code generation}th encoder: {@code out-<key>-<generation mod 1000>}, at
   * most 64 characters. A new name for each start, since ECore frees a name only once the old
   * encoder's process has ended.
   */
  public String encoderName(int generation) {
    return "out-" + key() + "-" + Math.floorMod(generation, 1000);
  }

  /** The id as lowercase words joined by hyphens, at most 56 characters. */
  public String key() {
    String s = id.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]+", "-").replaceAll("^-+|-+$", "");
    if (s.isEmpty()) {
      s = "link";
    }
    if (s.length() > 56) {
      s = s.substring(0, 56).replaceAll("-+$", "");
    }
    return s;
  }

  /** ST 0102's classification for a label: its name's place in the list; else the release limit's, and {@code unmapped} (section 10.6 point 20). */
  public Classification classification(SecurityLabel label, ClassificationLimit limit) {
    int at = classificationNames.indexOf(label.classification());
    if (at >= 0) {
      return new Classification(at + 1, false);
    }
    int fallback = classificationNames.indexOf(limit.classification());
    return new Classification(fallback >= 0 ? fallback + 1 : 5, true);
  }

  /** ST 0102's classification, 1 to 5, and whether the label's name was not in the list. */
  public record Classification(int value, boolean unmapped) {}

  private static double number(JsonObject entry, String key, double fallback, double min, double max) {
    if (!(entry.get(key) instanceof JsonNumber n)) {
      return fallback;
    }
    double v = n.doubleValue();
    if (!(v >= min && v <= max)) {
      throw new IllegalArgumentException(key + " is " + min + " to " + max);
    }
    return v;
  }

  private static long whole(JsonObject entry, String key, long fallback, long min, long max) {
    if (!(entry.get(key) instanceof JsonNumber n)) {
      return fallback;
    }
    double v = n.doubleValue();
    if (v != Math.rint(v) || v < min || v > max) {
      throw new IllegalArgumentException(key + " is a whole number, " + min + " to " + max);
    }
    return (long) v;
  }

  private static @Nullable String text(JsonObject entry, String key) {
    return entry.get(key) instanceof JsonString s && !s.value().isBlank() ? s.value().strip() : null;
  }
}
