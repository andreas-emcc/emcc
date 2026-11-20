package dev.emcc.ecore;

import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.json.Problem;
import dev.emcc.ecore.live.LiveGateway;
import dev.emcc.ecore.persistence.Configuration;
import dev.emcc.sdk.json.JsonObject;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;
import org.jspecify.annotations.Nullable;
import tools.jackson.databind.JsonNode;

/**
 * Settings › Labeling (T-170, M6): the premade security labels an admin makes, per security policy,
 * kept with ECore's configuration. In M6 they are connected to nothing and every label is cosmetic
 * (owner, 2026-11-10); later milestones offer them elsewhere.
 *
 * <pre>{@code
 * {"policies": {"NATO": {
 *    "releasableTo": ["SWE", "NOR", "FIN", "Exercise Northern Coast"],
 *    "labels": [{"policyIdentifier": {"name": "NATO"}, "classification": "SECRET",
 *                "categories": [{"tagName": "Releasable To", "type": "permissive", "values": ["SWE", "NOR"]}]}]}}}
 * }</pre>
 *
 * <p>The policies and their classifications are the configuration's (owner, OL A): the edge's
 * labeling definitions (round 3b, owner OZ A), each policy with the classifications of its sets
 * (sections), which the caller passes. A policy here is one of them, by its defined name.
 * Each policy has the values its labels may be released to (nation codes or texts naming a group or
 * context) and its labels, each in the model's form ({@code model/schemas/security-label.schema.json})
 * with at most one category, Releasable To, permissive (owner, 2026-11-10), whose values are from the
 * policy's list. No two labels of a policy are the same, whatever the order of their values; no value
 * is in a list twice. Duplicates are found ignoring case.
 *
 * <p>The whole is replaced at once (one Save, owner OJ B). After a change every browser gets the live
 * notice {@value #NOTICE} and reads it again. The permission ({@code settings.admin}) is the edge's to
 * check. Thread-safe: the configuration is, and the notice goes through the live hub.
 */
public final class Labeling {

  /** The live message that tells a browser to read the premade labels again. */
  public static final String NOTICE = "{\"type\":\"labeling\"}";
  /** The category a premade label's releasability is in. */
  public static final String RELEASABLE_TO = "Releasable To";
  /** The most values a policy's list has, and the most labels a policy has. */
  public static final int MAX_VALUES = 200;
  public static final int MAX_LABELS = 500;
  /** The longest value (the model's category values). */
  public static final int MAX_VALUE_LENGTH = 128;

  private final Configuration configuration;
  private final LiveGateway live;
  private final ModelJson json;

  Labeling(Configuration configuration, LiveGateway live, ModelJson json) {
    this.configuration = Objects.requireNonNull(configuration, "configuration");
    this.live = Objects.requireNonNull(live, "live");
    this.json = Objects.requireNonNull(json, "json");
  }

  /** The premade labels as stored, else {@code {"policies": {}}}. */
  public JsonNode current() {
    JsonObject stored = configuration.current().labeling();
    return stored == null ? json.parse("{\"policies\":{}}") : json.toNode(stored);
  }

  /**
   * Replaces the premade labels with {@code value}, stores them and tells every browser, unless
   * {@link #problems} finds something.
   *
   * @param policies each defined policy's classifications
   * @return the problems, each at its JSON Pointer; empty when stored
   */
  public List<Problem> set(JsonNode value, Map<String, List<String>> policies) {
    List<Problem> problems = problems(value, policies);
    if (!problems.isEmpty()) {
      return problems;
    }
    JsonObject premade = (JsonObject) ModelJson.toJsonValue(value);
    configuration.change(c -> c.withLabeling(premade), stored -> { });
    live.broadcast(() -> NOTICE); // outside the configuration's lock (rule C4)
    return List.of();
  }

  /**
   * What is wrong with {@code value} as premade labels, each at its JSON Pointer; empty if nothing.
   *
   * @param orders each defined policy's classifications (any order)
   */
  public static List<Problem> problems(@Nullable JsonNode value, Map<String, List<String>> orders) {
    List<Problem> out = new ArrayList<>();
    if (value == null || !value.isObject()) {
      out.add(new Problem("", "the premade labels are a JSON object with their policies"));
      return out;
    }
    for (String key : value.propertyNames()) {
      if (!key.equals("policies")) {
        out.add(new Problem(pointer("", key), "unknown part: " + key));
      }
    }
    JsonNode policies = value.get("policies");
    if (policies == null || !policies.isObject()) {
      out.add(new Problem("/policies", "the policies are a JSON object, by policy name"));
      return out;
    }
    for (Map.Entry<String, JsonNode> e : policies.properties()) {
      policy(e.getKey(), e.getValue(), orders.get(e.getKey()), pointer("/policies", e.getKey()), out);
    }
    return out;
  }

  private static void policy(String name, JsonNode policy, @Nullable List<String> order, String at, List<Problem> out) {
    if (order == null) {
      out.add(new Problem(at, name + " is not a policy in the labeling definitions"));
      return;
    }
    if (!policy.isObject()) {
      out.add(new Problem(at, "a policy is a JSON object with its releasableTo and labels"));
      return;
    }
    for (String key : policy.propertyNames()) {
      if (!key.equals("releasableTo") && !key.equals("labels")) {
        out.add(new Problem(pointer(at, key), "unknown part: " + key));
      }
    }
    Set<String> values = new HashSet<>();
    JsonNode list = policy.get("releasableTo");
    if (list != null) {
      String listAt = at + "/releasableTo";
      if (!list.isArray()) {
        out.add(new Problem(listAt, "releasableTo is a list of texts"));
      } else if (list.size() > MAX_VALUES) {
        out.add(new Problem(listAt, "a policy has at most " + MAX_VALUES + " values"));
      } else {
        Set<String> seen = new HashSet<>();
        for (int i = 0; i < list.size(); i++) {
          JsonNode v = list.get(i);
          String problem = valueProblem(v);
          if (problem == null && !seen.add(key(v.stringValue()))) {
            problem = v.stringValue() + " is in the list already";
          }
          if (problem != null) {
            out.add(new Problem(listAt + "/" + i, problem));
          } else {
            values.add(v.stringValue());
          }
        }
      }
    }
    JsonNode labels = policy.get("labels");
    if (labels == null) {
      return;
    }
    String labelsAt = at + "/labels";
    if (!labels.isArray()) {
      out.add(new Problem(labelsAt, "labels is a list of security labels"));
      return;
    }
    if (labels.size() > MAX_LABELS) {
      out.add(new Problem(labelsAt, "a policy has at most " + MAX_LABELS + " labels"));
      return;
    }
    Map<String, Integer> made = new HashMap<>();
    for (int i = 0; i < labels.size(); i++) {
      String labelAt = labelsAt + "/" + i;
      String same = label(name, order, values, labels.get(i), labelAt, out);
      if (same != null) {
        Integer earlier = made.putIfAbsent(same, i);
        if (earlier != null) {
          out.add(new Problem(labelAt, "the same label as " + labelsAt + "/" + earlier + ": the order of the values does not matter"));
        }
      }
    }
  }

  /** Checks one label; returns what makes it the same as another (null if it is wrong). */
  private static @Nullable String label(String policy, List<String> order, Set<String> values, JsonNode label, String at,
      List<Problem> out) {
    if (!label.isObject()) {
      out.add(new Problem(at, "a label is a JSON object"));
      return null;
    }
    int before = out.size();
    for (String key : label.propertyNames()) {
      if (!Set.of("policyIdentifier", "classification", "categories").contains(key)) {
        out.add(new Problem(pointer(at, key), "a premade label has no " + key));
      }
    }
    JsonNode id = label.get("policyIdentifier");
    if (id == null || !id.isObject() || id.size() != 1 || !id.path("name").isString()) {
      out.add(new Problem(at + "/policyIdentifier", "the policy identifier is {\"name\": \"" + policy + "\"}"));
    } else if (!id.get("name").stringValue().equals(policy)) {
      out.add(new Problem(at + "/policyIdentifier/name", "the label's policy is " + policy + ", the policy it is listed under"));
    }
    JsonNode classification = label.get("classification");
    if (classification == null || !classification.isString() || !order.contains(classification.stringValue())) {
      out.add(new Problem(at + "/classification", (classification != null && classification.isString() ? classification.stringValue()
          : "the classification") + " is not one of " + policy + "'s classifications in the labeling definitions (" + String.join(", ", order) + ")"));
    }
    Set<String> released = new TreeSet<>();
    JsonNode categories = label.get("categories");
    if (categories != null) {
      String categoriesAt = at + "/categories";
      if (!categories.isArray() || categories.size() > 1) {
        out.add(new Problem(categoriesAt, "a premade label has one category at most: " + RELEASABLE_TO));
      } else if (categories.size() == 1) {
        released = releasable(categories.get(0), values, categoriesAt + "/0", out);
      }
    }
    return out.size() > before ? null : classification.stringValue() + "\n" + String.join("\n", released);
  }

  private static Set<String> releasable(JsonNode category, Set<String> values, String at, List<Problem> out) {
    Set<String> released = new TreeSet<>();
    if (!category.isObject()) {
      out.add(new Problem(at, "a category is a JSON object"));
      return released;
    }
    for (String key : category.propertyNames()) {
      if (!Set.of("tagName", "type", "values").contains(key)) {
        out.add(new Problem(pointer(at, key), "a premade label's category has no " + key));
      }
    }
    if (!category.path("tagName").isString() || !RELEASABLE_TO.equals(category.get("tagName").stringValue())) {
      out.add(new Problem(at + "/tagName", "the category's tagName is " + RELEASABLE_TO));
    }
    if (!category.path("type").isString() || !"permissive".equals(category.get("type").stringValue())) {
      out.add(new Problem(at + "/type", "the category's type is permissive"));
    }
    JsonNode list = category.get("values");
    if (list == null || !list.isArray() || list.isEmpty()) {
      out.add(new Problem(at + "/values", "the category has one value or more; a label released to none has no category"));
      return released;
    }
    for (int i = 0; i < list.size(); i++) {
      JsonNode v = list.get(i);
      String problem = valueProblem(v);
      if (problem == null && !values.contains(v.stringValue())) {
        problem = v.stringValue() + " is not in the policy's Releasable To list";
      }
      if (problem == null && !released.add(key(v.stringValue()))) {
        problem = v.stringValue() + " is in the label already";
      }
      if (problem != null) {
        out.add(new Problem(at + "/values/" + i, problem));
      }
    }
    return released;
  }

  private static @Nullable String valueProblem(JsonNode v) {
    if (!v.isString() || v.stringValue().isEmpty() || v.stringValue().length() > MAX_VALUE_LENGTH) {
      return "a value is a text of 1 to " + MAX_VALUE_LENGTH + " characters";
    }
    if (!v.stringValue().strip().equals(v.stringValue())) {
      return "a value has no spaces at its start or end";
    }
    return null;
  }

  private static String key(String value) {
    return value.toLowerCase(Locale.ROOT);
  }

  /** {@code at} and one more key, escaped as JSON Pointer (RFC 6901). */
  private static String pointer(String at, String key) {
    return at + "/" + key.replace("~", "~0").replace("/", "~1");
  }
}
