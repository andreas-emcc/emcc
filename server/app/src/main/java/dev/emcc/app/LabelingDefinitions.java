package dev.emcc.app;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.core.StreamReadFeature;
import tools.jackson.core.json.JsonReadFeature;
import tools.jackson.databind.DeserializationFeature;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The definitions of Settings › Labeling (T-170 round 3b; owner OY and OZ A, 2026-11-10): the
 * classification sets, each an ordered list, highest first, of classifications with their names and
 * colours, then the policies, each naming the sets it offers (its sections). In M6 they serve the
 * Labeling setting alone (owner, T-170 3b Q1); Settings › Layers and the plugins keep {@code
 * emc2.classifications.order.*}.
 *
 * <p>Read once at the start from the first of: the file {@code emc2.labeling.definitions} names; {@value
 * #LOCAL} in the working directory (ignored by git, as {@code application-local.properties}); the
 * {@value #FILE} the server ships beside {@code application.properties}. The one found replaces the
 * shipped one whole. A file that is not as {@code server/README.md} describes stops the start, naming
 * the file and what is wrong.
 */
@Component
class LabelingDefinitions {

  static final String FILE = "labeling-definitions.json";
  static final String LOCAL = "labeling-definitions.local.json";
  /** A hand-edited file: {@code //} and {@code /* *}{@code /} comments allowed (ADR-0060 point 2); one value, no duplicate names. */
  static final JsonMapper COMMENTED = JsonMapper.builder()
      .enable(JsonReadFeature.ALLOW_JAVA_COMMENTS)
      .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS)
      .enable(StreamReadFeature.STRICT_DUPLICATE_DETECTION)
      .build();
  /** The longest name of a set, a classification or a policy (the model's classification). */
  static final int MAX_NAME = 64;
  private static final Pattern ID = Pattern.compile("[a-z0-9][a-z0-9-]{0,31}");
  private static final Pattern COLOR = Pattern.compile("#[0-9a-fA-F]{6}");

  private final JsonNode definitions;
  private final Map<String, List<String>> classifications;
  private final String source;

  @Autowired
  LabelingDefinitions(@Value("${emc2.labeling.definitions:}") String named) {
    this(read(named.isBlank() ? null : Path.of(named.strip())));
  }

  private LabelingDefinitions(Read read) {
    this.source = read.source();
    JsonNode parsed;
    try {
      parsed = COMMENTED.readTree(read.text());
    } catch (JacksonException e) {
      throw new IllegalStateException(source + " is not JSON: " + e.getOriginalMessage(), e);
    }
    List<String> problems = new ArrayList<>();
    this.classifications = checked(parsed, problems);
    if (!problems.isEmpty()) {
      throw new IllegalStateException(source + " is not valid labeling definitions: " + String.join("; ", problems));
    }
    this.definitions = parsed;
  }

  /** For tests: the definitions in {@code text}. */
  static LabelingDefinitions of(String text) {
    return new LabelingDefinitions(new Read(text, "the labeling definitions"));
  }

  /** The definitions as the file has them, for the browsers ({@code /api/config}'s {@code labelDefinitions}). */
  JsonNode json() {
    return definitions;
  }

  /** Each policy's classifications, its sets' in their order; what {@code Labeling} checks labels against. */
  Map<String, List<String>> classificationsByPolicy() {
    return classifications;
  }

  /** Where they were read from. */
  String source() {
    return source;
  }

  private record Read(String text, String source) {}

  private static Read read(@Nullable Path named) {
    try {
      if (named != null) {
        return new Read(Files.readString(named, StandardCharsets.UTF_8), named.toString() + " (emc2.labeling.definitions)");
      }
      Path local = Path.of(LOCAL);
      if (Files.isRegularFile(local)) {
        return new Read(Files.readString(local, StandardCharsets.UTF_8), local.toAbsolutePath().toString());
      }
      try (InputStream in = LabelingDefinitions.class.getResourceAsStream("/" + FILE)) {
        if (in == null) {
          throw new IllegalStateException("the server has no " + FILE);
        }
        return new Read(new String(in.readAllBytes(), StandardCharsets.UTF_8), FILE + " (shipped)");
      }
    } catch (IOException e) {
      throw new IllegalStateException("cannot read the labeling definitions " + (named == null ? LOCAL : named) + ": " + e.getMessage(), e);
    }
  }

  /** Checks the whole; returns each policy's classifications, or adds what is wrong to {@code problems}. */
  static Map<String, List<String>> checked(JsonNode root, List<String> problems) {
    Map<String, List<String>> out = new LinkedHashMap<>();
    if (!root.isObject()) {
      problems.add("it is a JSON object with classificationSets and policies");
      return out;
    }
    unknown(root, Set.of("classificationSets", "policies"), "", problems);
    Map<String, List<String>> sets = new LinkedHashMap<>();
    JsonNode setList = root.get("classificationSets");
    if (setList == null || !setList.isArray() || setList.isEmpty()) {
      problems.add("classificationSets is a list of one set or more");
    } else {
      for (int i = 0; i < setList.size(); i++) {
        set(setList.get(i), "classificationSets[" + i + "]", sets, problems);
      }
    }
    JsonNode policies = root.get("policies");
    if (policies == null || !policies.isArray() || policies.isEmpty()) {
      problems.add("policies is a list of one policy or more");
      return out;
    }
    Set<String> names = new HashSet<>();
    for (int i = 0; i < policies.size(); i++) {
      String at = "policies[" + i + "]";
      JsonNode p = policies.get(i);
      if (!p.isObject()) {
        problems.add(at + " is an object with a name and its classificationSets");
        continue;
      }
      unknown(p, Set.of("name", "classificationSets"), at + ".", problems);
      String name = name(p, at, problems);
      if (name != null && !names.add(name.toLowerCase(Locale.ROOT))) {
        problems.add(at + " names the policy " + name + " a second time");
      }
      JsonNode named = p.get("classificationSets");
      if (named == null || !named.isArray() || named.isEmpty()) {
        problems.add(at + ".classificationSets is a list of one set id or more");
        continue;
      }
      List<String> all = new ArrayList<>();
      Set<String> seenSets = new HashSet<>();
      for (JsonNode id : named) {
        String setId = id.isString() ? id.stringValue() : id.toString();
        if (!sets.containsKey(setId)) {
          problems.add(at + " names the set " + setId + ", which classificationSets does not have");
        } else if (!seenSets.add(setId)) {
          problems.add(at + " names the set " + setId + " twice");
        } else {
          for (String c : sets.get(setId)) {
            if (all.contains(c)) {
              problems.add(at + " has " + c + " in two of its sets; within a policy a classification is in one set only");
            } else {
              all.add(c);
            }
          }
        }
      }
      if (name != null) {
        out.put(name, List.copyOf(all));
      }
    }
    return Collections.unmodifiableMap(out);
  }

  private static void set(JsonNode s, String at, Map<String, List<String>> sets, List<String> problems) {
    if (!s.isObject()) {
      problems.add(at + " is an object with an id, a name and its classifications");
      return;
    }
    unknown(s, Set.of("id", "name", "classifications"), at + ".", problems);
    JsonNode id = s.get("id");
    if (id == null || !id.isString() || !ID.matcher(id.stringValue()).matches()) {
      problems.add(at + ".id is 1 to 32 lower-case letters, digits and hyphens");
      return;
    }
    if (sets.containsKey(id.stringValue())) {
      problems.add(at + " has the id " + id.stringValue() + " of another set");
      return;
    }
    name(s, at, problems);
    List<String> names = new ArrayList<>();
    JsonNode list = s.get("classifications");
    if (list == null || !list.isArray() || list.isEmpty()) {
      problems.add(at + ".classifications is a list of one classification or more, highest first");
    } else {
      for (int i = 0; i < list.size(); i++) {
        String cAt = at + ".classifications[" + i + "]";
        JsonNode c = list.get(i);
        if (!c.isObject()) {
          problems.add(cAt + " is an object with a name and a color");
          continue;
        }
        unknown(c, Set.of("name", "color"), cAt + ".", problems);
        String name = name(c, cAt, problems);
        if (!c.path("color").isString() || !COLOR.matcher(c.get("color").stringValue()).matches()) {
          problems.add(cAt + ".color is #rrggbb, e.g. #b8423a");
        }
        if (name != null && names.contains(name)) {
          problems.add(cAt + " names " + name + " a second time");
        } else if (name != null) {
          names.add(name);
        }
      }
    }
    sets.put(id.stringValue(), names);
  }

  private static @Nullable String name(JsonNode n, String at, List<String> problems) {
    JsonNode name = n.get("name");
    if (name == null || !name.isString() || name.stringValue().isBlank() || name.stringValue().length() > MAX_NAME
        || !name.stringValue().strip().equals(name.stringValue())) {
      problems.add(at + ".name is a text of 1 to " + MAX_NAME + " characters, without spaces at its ends");
      return null;
    }
    return name.stringValue();
  }

  private static void unknown(JsonNode n, Set<String> known, String at, List<String> problems) {
    for (String key : n.propertyNames()) {
      if (!known.contains(key)) {
        problems.add(at + key + " is not a part of the labeling definitions");
      }
    }
  }
}
