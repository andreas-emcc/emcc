package dev.emcc.plugins.nvg.links;

import dev.emcc.sdk.ClassificationLimit;
import dev.emcc.sdk.LayerChoice;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNumber;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.SecurityLabel;
import java.net.URI;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.jspecify.annotations.Nullable;

/**
 * The {@code links} setting, read (brief, section 5). ECore has validated it against the manifest's
 * schema; this class reads it defensively anyway and reports a link it cannot use, with the reason,
 * instead of failing.
 */
public final class LinkSettings {

  private LinkSettings() {}

  /**
   * A {@code soap-consumer} link.
   *
   * @param name its name: data source, external system, status entry, credential name's default
   * @param url the provider's endpoint, from the admin's settings only (ADR-0030)
   * @param credential the name of a token in local configuration, or {@code null}
   * @param filter the answers sent in {@code nvg_filter}
   * @param targetLayer the picked layer, or {@code null} for a new one named like the link
   * @param label the label of items without one, or {@code null} for the server's default
   */
  public record Consumer(String name, boolean enabled, URI url, @Nullable String credential, int intervalSeconds, int timeoutSeconds,
      List<Soap.FilterAnswer> filter, @Nullable LayerChoice targetLayer, @Nullable SecurityLabel label, boolean clearOnEmpty) {
    public Consumer {
      filter = List.copyOf(filter);
    }

    /** The layer the link writes into: the pick, else a new one named like the link. */
    public LayerChoice target() {
      return targetLayer != null ? targetLayer : new LayerChoice(null, name);
    }
  }

  /**
   * A {@code soap-provider} link.
   *
   * @param sourceLayers the layers it serves
   * @param highest the highest classification it serves (ADR-0037 point 8)
   */
  public record Provider(String name, boolean enabled, List<LayerChoice> sourceLayers, ClassificationLimit highest) {
    public Provider {
      sourceLayers = List.copyOf(sourceLayers);
    }
  }

  /**
   * The links.
   *
   * @param consumers the consumer links, by name, in order
   * @param providers the provider links, by name, in order
   * @param bad the links that cannot be used, by name, with the reason
   */
  public record Links(Map<String, Consumer> consumers, Map<String, Provider> providers, Map<String, String> bad) {
    public Links {
      consumers = java.util.Collections.unmodifiableMap(new LinkedHashMap<>(consumers));
      providers = java.util.Collections.unmodifiableMap(new LinkedHashMap<>(providers));
      bad = java.util.Collections.unmodifiableMap(new LinkedHashMap<>(bad));
    }
  }

  /** Names a link may not have: they are the data sources of drawn and imported objects. */
  static final Set<String> RESERVED = Set.of("manual", "nvg-file");

  public static Links read(JsonObject settings, SecurityLabel defaultLabel) {
    Map<String, Consumer> consumers = new LinkedHashMap<>();
    Map<String, Provider> providers = new LinkedHashMap<>();
    Map<String, String> bad = new LinkedHashMap<>();
    if (!(settings.get("links") instanceof JsonArray links)) {
      return new Links(consumers, providers, bad);
    }
    for (int i = 0; i < links.size(); i++) {
      if (!(links.get(i) instanceof JsonObject link) || !(link.get("name") instanceof JsonString n)) {
        bad.put("#" + (i + 1), "a link without a name");
        continue;
      }
      String name = n.value();
      if (consumers.containsKey(name) || providers.containsKey(name) || bad.containsKey(name)) {
        bad.put(name + " (" + (i + 1) + ")", "a second link named " + name);
        continue;
      }
      if (RESERVED.contains(name)) {
        bad.put(name, "the name " + name + " is reserved");
        continue;
      }
      boolean enabled = !(link.get("enabled") instanceof JsonBoolean b) || b.value();
      String kind = string(link, "kind", "soap-consumer");
      try {
        if (kind.equals("soap-provider")) {
          providers.put(name, new Provider(name, enabled, LayerChoice.list(link.get("sourceLayers")),
              ClassificationLimit.from(link.get("highestClassification"), defaultLabel)));
        } else {
          consumers.put(name, consumer(name, enabled, link));
        }
      } catch (IllegalArgumentException e) {
        bad.put(name, String.valueOf(e.getMessage()));
      }
    }
    return new Links(consumers, providers, bad);
  }

  private static Consumer consumer(String name, boolean enabled, JsonObject link) {
    String url = string(link, "url", "");
    URI uri;
    try {
      uri = URI.create(url);
    } catch (IllegalArgumentException e) {
      throw new IllegalArgumentException("its url is not a URL");
    }
    if (uri.getScheme() == null || !(uri.getScheme().equals("http") || uri.getScheme().equals("https")) || uri.getHost() == null) {
      throw new IllegalArgumentException("its url is not an http or https URL");
    }
    String credential = string(link, "credential", "");
    List<Soap.FilterAnswer> filter = new ArrayList<>();
    if (link.get("filter") instanceof JsonArray answers) {
      for (int i = 0; i < answers.size(); i++) {
        if (answers.get(i) instanceof JsonObject a && a.get("refid") instanceof JsonString r && a.get("value") instanceof JsonString v) {
          filter.add(new Soap.FilterAnswer(r.value(), v.value()));
        }
      }
    }
    SecurityLabel label = null;
    if (link.get("label") instanceof JsonObject l && l.get("policy") instanceof JsonString p && l.get("classification") instanceof JsonString c) {
      label = SecurityLabel.of(p.value(), c.value());
    }
    return new Consumer(name, enabled, uri, credential.isEmpty() ? null : credential, integer(link, "intervalSeconds", 60, 10, 3600),
        integer(link, "timeoutSeconds", 30, 5, 55), filter, LayerChoice.from(link.get("targetLayer")), label,
        link.get("clearOnEmpty") instanceof JsonBoolean b && b.value());
  }

  private static String string(JsonObject o, String key, String fallback) {
    return o.get(key) instanceof JsonString s ? s.value() : fallback;
  }

  private static int integer(JsonObject o, String key, int fallback, int min, int max) {
    JsonValue v = o.get(key);
    if (v instanceof JsonNumber n) {
      double d = n.doubleValue();
      if (d >= min && d <= max) {
        return (int) d;
      }
    }
    return fallback;
  }
}
