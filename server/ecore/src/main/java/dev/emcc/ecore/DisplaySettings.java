package dev.emcc.ecore;

import dev.emcc.ecore.json.InvalidDocumentException;
import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.live.LiveGateway;
import dev.emcc.ecore.persistence.Configuration;
import dev.emcc.ecore.persistence.UserDocumentStore;
import dev.emcc.ecore.persistence.UserDocumentStore.Result;
import dev.emcc.sdk.json.JsonObject;
import java.math.BigDecimal;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Consumer;
import org.jspecify.annotations.Nullable;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import tools.jackson.databind.JsonNode;

/**
 * Each user's display settings (SDK 1.4.0 part 5; ADR-0046, ADR-0052): the parts a user has set
 * (the web SDK's {@code DisplayChoices}) as the user's own document {@value UserDocuments#DISPLAY}
 * in {@code core} (ADR-0027; the no-login mode's single local user), and the admin's defaults, in
 * the same shape, in ECore's configuration (ADR-0046 point 3). Both are checked with the web SDK's
 * {@code displayChoicesProblem} rules ({@link #problem}); a switch for a relation kind that no
 * loaded plugin declares is kept (the ACA's R5 on CR-0031). The shell resolves what plugins get
 * ({@code resolveDisplay}).
 *
 * <p>After a user's write, that user's browsers get the live notice {@value #NOTICE}, after a
 * change of the defaults every browser: each then reads both again (owner, 2026-11-07), so all end
 * on what was stored last (ADR-0046 point 6). Thread-safe: the user documents go through their
 * worker, the configuration is thread-safe, and the notices go through the live hub.
 */
public final class DisplaySettings {

  /** The smallest and largest symbol size, CSS pixels (the web SDK's {@code SYMBOL_SIZE_MIN}, {@code _MAX}). */
  public static final int SYMBOL_SIZE_MIN = 16;
  public static final int SYMBOL_SIZE_MAX = 96;
  /**
   * The longest speed vector, in minutes (the web SDK's {@code SPEED_VECTOR_MAX_MINUTES}): what 1.4.0
   * stored, still accepted and read by the shell as its nearest step (SDK 1.5.0, CR-0039 point 5).
   */
  public static final int SPEED_VECTOR_MAX_MINUTES = 60;
  /** SDK 1.5.0 (CR-0039 point 5; T-164): the web SDK's {@code SPEED_VECTOR_STEPS_SECONDS}; 0 hides it. */
  public static final List<Integer> SPEED_VECTOR_STEPS_SECONDS = List.of(5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800);
  /** The web SDK's {@code LABEL_IDS}, a closed list in 1.4.0. */
  public static final List<String> LABEL_IDS = List.of("name", "uniqueDesignation", "higherFormation", "additionalInformation",
      "staffComments", "type", "dtg", "altitudeDepth", "speed", "direction");
  /** SDK 1.8.0 (CR-0043 part A): the web SDK's {@code LABEL_PLACES}, the places round a symbol. */
  public static final List<String> LABEL_PLACES = List.of("topLeft", "topRight", "bottomLeft", "bottomRight", "below");
  /** SDK 1.8.0: the web SDK's {@code TEXT_LABEL_IDS}, every label but {@code direction}, the arrow. */
  public static final List<String> TEXT_LABEL_IDS = LABEL_IDS.stream().filter(l -> !l.equals("direction")).toList();
  /** The live message that tells a browser to read its display settings again. */
  public static final String NOTICE = "{\"type\":\"display\"}";

  private static final Set<String> PARTS = Set.of("symbolSize", "speedVectorMinutes", "speedVectorSeconds", "labels", "labelPlaces",
      "directionArrow", "relations", "classes", "friendlyGraphicColour");
  private static final Logger LOG = LoggerFactory.getLogger(DisplaySettings.class);

  private final UserDocuments documents;
  private final Configuration configuration;
  private final LiveGateway live;
  private final ModelJson json;

  DisplaySettings(UserDocuments documents, Configuration configuration, LiveGateway live, ModelJson json) {
    this.documents = Objects.requireNonNull(documents, "documents");
    this.configuration = Objects.requireNonNull(configuration, "configuration");
    this.live = Objects.requireNonNull(live, "live");
    this.json = Objects.requireNonNull(json, "json");
  }

  /**
   * Why {@code value} is not well-formed display choices (each part optional), or null: as the web
   * SDK's {@code displayChoicesProblem}, word for word.
   */
  public static @Nullable String problem(@Nullable JsonNode value) {
    if (value == null || !value.isObject()) {
      return "display settings are an object";
    }
    for (String key : value.propertyNames()) {
      if (!PARTS.contains(key)) {
        return "unknown display setting: " + key;
      }
    }
    // SDK 1.8.0 (CR-0043 part A): a stored 1.7.0 list, or the places and the arrow, never both
    if (value.has("labels") && (value.has("labelPlaces") || value.has("directionArrow"))) {
      return "labels is not stored together with labelPlaces or directionArrow";
    }
    if (value.has("labelPlaces")) {
      JsonNode places = value.get("labelPlaces");
      if (!places.isObject()) {
        return "labelPlaces maps a place to a label or null";
      }
      Set<String> seen = new HashSet<>();
      for (Map.Entry<String, JsonNode> e : places.properties()) {
        if (!LABEL_PLACES.contains(e.getKey())) {
          return "unknown label place: " + e.getKey();
        }
        JsonNode l = e.getValue();
        if (l.isNull()) {
          continue;
        }
        if (!l.isString() || !TEXT_LABEL_IDS.contains(l.stringValue())) {
          return "unknown text label: " + text(l);
        }
        if (!seen.add(l.stringValue())) {
          return "label placed twice: " + l.stringValue();
        }
      }
    }
    if (value.has("directionArrow") && !value.get("directionArrow").isBoolean()) {
      return "directionArrow is true or false";
    }
    // SDK 1.9.0 (CR-0048 section 6): black or blue friendly control measures
    if (value.has("friendlyGraphicColour") && !(value.get("friendlyGraphicColour").isString()
        && List.of("black", "blue").contains(value.get("friendlyGraphicColour").stringValue()))) {
      return "friendlyGraphicColour is black or blue";
    }
    if (value.has("symbolSize") && !wholeIn(value.get("symbolSize"), SYMBOL_SIZE_MIN, SYMBOL_SIZE_MAX)) {
      return "symbolSize is a whole number from " + SYMBOL_SIZE_MIN + " to " + SYMBOL_SIZE_MAX;
    }
    if (value.has("speedVectorMinutes") && !wholeIn(value.get("speedVectorMinutes"), 0, SPEED_VECTOR_MAX_MINUTES)) {
      return "speedVectorMinutes is a whole number from 0 to " + SPEED_VECTOR_MAX_MINUTES;
    }
    if (value.has("speedVectorSeconds") && !isStep(value.get("speedVectorSeconds"))) {
      return "speedVectorSeconds is 0 or one of " + String.join(", ", SPEED_VECTOR_STEPS_SECONDS.stream().map(String::valueOf).toList());
    }
    if (value.has("labels")) {
      JsonNode labels = value.get("labels");
      if (!labels.isArray()) {
        return "labels is a list of label ids";
      }
      Set<String> seen = new HashSet<>();
      for (JsonNode l : labels) {
        if (!l.isString() || !LABEL_IDS.contains(l.stringValue())) {
          return "unknown label: " + text(l);
        }
        if (!seen.add(l.stringValue())) {
          return "label listed twice: " + l.stringValue();
        }
      }
    }
    if (value.has("relations")) {
      JsonNode relations = value.get("relations");
      if (!relations.isObject()) {
        return "relations maps a relation kind to true or false";
      }
      for (Map.Entry<String, JsonNode> e : relations.properties()) {
        if (!e.getValue().isBoolean()) {
          return "the switch of " + e.getKey() + " is true or false";
        }
      }
    }
    // SDK 1.6.0 (CR-0041 part D): a switch per known display class, as displayChoicesProblem checks it
    if (value.has("classes")) {
      JsonNode classes = value.get("classes");
      if (!classes.isObject()) {
        return "classes maps a display class to true or false";
      }
      for (Map.Entry<String, JsonNode> e : classes.properties()) {
        if (!dev.emcc.sdk.model.DisplayClass.ALL.contains(e.getKey())) {
          return "unknown display class: " + e.getKey();
        }
        if (!e.getValue().isBoolean()) {
          return "the switch of " + e.getKey() + " is true or false";
        }
      }
    }
    return null;
  }

  private static boolean wholeIn(JsonNode v, int min, int max) {
    if (!v.isNumber()) {
      return false;
    }
    BigDecimal d = v.decimalValue();
    return (d.signum() == 0 || d.stripTrailingZeros().scale() <= 0)
        && d.compareTo(BigDecimal.valueOf(min)) >= 0 && d.compareTo(BigDecimal.valueOf(max)) <= 0;
  }

  /** 0 or one of the steps, as the web SDK's {@code isStep} (a JSON number; {@code 5.0} is 5). */
  private static boolean isStep(JsonNode v) {
    return wholeIn(v, 0, SPEED_VECTOR_STEPS_SECONDS.getLast())
        && (v.intValue() == 0 || SPEED_VECTOR_STEPS_SECONDS.contains(v.intValue()));
  }

  /** A value as JavaScript's {@code String(l)} shows it, near enough for a problem text. */
  private static String text(JsonNode l) {
    return l.isString() ? l.stringValue() : l.toString();
  }

  /** The admin's defaults: what an admin set, else {@code {}} (the SDK's defaults apply). */
  public JsonNode defaults() {
    JsonObject stored = configuration.current().displayDefaults();
    return stored == null ? json.parse("{}") : json.toNode(stored);
  }

  /**
   * Sets the admin's defaults, stores them and tells every browser. The permission ({@code
   * settings.admin}) is the edge's to check, as for every setting.
   *
   * @throws IllegalArgumentException with {@link #problem}'s text for values it refuses
   */
  public void setDefaults(JsonNode value) {
    String problem = problem(value);
    if (problem != null) {
      throw new IllegalArgumentException(problem);
    }
    JsonObject defaults = (JsonObject) ModelJson.toJsonValue(value);
    configuration.change(c -> c.withDisplayDefaults(defaults), stored -> { });
    live.broadcast(() -> NOTICE); // outside the configuration's lock (rule C4)
  }

  /**
   * Gives {@code answer} the user's choices: {@link Result.Found} with them ({@code {}} when the user
   * has set none, or when what is stored is no longer well formed), or the store's {@link
   * Result.Busy} or {@link Result.Failed}.
   *
   * @param user the user id ({@code source.user}: the IAM's {@code sub}, {@code local} without login)
   */
  public void choices(String user, Consumer<Result> answer) {
    Objects.requireNonNull(answer, "answer");
    documents.send(new UserDocuments.Call(UserDocuments.Kind.GET, user, UserDocumentStore.CORE, UserDocuments.DISPLAY, null), result -> {
      if (result instanceof Result.Missing) {
        answer.accept(new Result.Found("{}"));
      } else if (result instanceof Result.Found found && !wellFormed(user, found.json())) {
        answer.accept(new Result.Found("{}"));
      } else {
        answer.accept(result);
      }
    });
  }

  private boolean wellFormed(String user, String stored) {
    String problem;
    try {
      problem = problem(json.parse(stored));
    } catch (InvalidDocumentException e) {
      problem = e.getMessage();
    }
    if (problem != null) {
      LOG.warn("The display settings stored for a user are not well formed ({}); the defaults apply", problem);
    }
    return problem == null;
  }

  /**
   * Replaces the user's choices with {@code value} ({@code {}}: every part back to the admin's
   * defaults, "Use defaults") and, once stored, tells the user's browsers. {@code answer} gets {@link
   * Result.Written}, {@link Result.Refused} ({@link UserDocumentStore.Reason#INVALID} with {@link
   * #problem}'s text, or the store's limits), {@link Result.Busy} or {@link Result.Failed}.
   */
  public void setChoices(String user, JsonNode value, Consumer<Result> answer) {
    Objects.requireNonNull(user, "user");
    Objects.requireNonNull(answer, "answer");
    String problem = problem(value);
    if (problem != null) {
      answer.accept(new Result.Refused(UserDocumentStore.Reason.INVALID, problem));
      return;
    }
    documents.send(new UserDocuments.Call(UserDocuments.Kind.PUT, user, UserDocumentStore.CORE, UserDocuments.DISPLAY, value), result -> {
      if (result instanceof Result.Written) {
        live.toUser(user, NOTICE);
      }
      answer.accept(result);
    });
  }
}
