package dev.emcc.plugins.simulator;

import dev.emcc.sdk.json.JsonBoolean;
import dev.emcc.sdk.json.JsonNull;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.FieldValue;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Modifiers;
import dev.emcc.sdk.model.ObjectProperties;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.TextModifier;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * What events do to a track (brief function 13), and how a reset undoes it.
 *
 * <p>"Change a field" sets core fields (the name, the description, the SIDC, the symbol's text
 * modifiers) and other plugins' declared fields (through {@code Change.withFields}, ADR-0038).
 * "Hide" marks the track hidden. Both are saved updates (A18, A19).
 *
 * <p><b>What a reset restores lives on the track</b> (the owner's Q8, 2026-10-27): in the
 * simulator's extension of the track, next to its hidden mark, written in the same update as the
 * change, so it survives any crash. The first value an event replaces is kept; a reset writes it
 * back and clears both:
 *
 * <pre>{@code
 * "simulator": { "hidden": true,
 *   "restore": { "core": {"name": "Alpha", "description": null}, "texts": {"uniqueDesignation": "A1"},
 *                "fields": {"cot.team": "Cyan", "cot.role": null} } }
 * }</pre>
 *
 * A {@code null} means the field was absent.
 */
final class Effects {

  static final String HIDDEN = "hidden";
  static final String RESTORE = "restore";
  private static final List<String> CORE = List.of("name", "description", "sidc");

  /** What an event, a reset or "Put on route" does to a track. */
  sealed interface Effect {}

  /**
   * "Change a field".
   *
   * @param core the core fields it sets, by name; a null value clears the name or the description
   * @param texts the text modifiers it sets; a null value removes one
   * @param fields declared fields of other plugins
   */
  record SetValues(Map<String, @Nullable String> core, Map<TextModifier, @Nullable String> texts, List<FieldValue> fields) implements Effect {
    SetValues {
      core = java.util.Collections.unmodifiableMap(new LinkedHashMap<>(core));
      texts = texts.isEmpty() ? Map.of() : java.util.Collections.unmodifiableMap(new EnumMap<>(texts));
      fields = List.copyOf(fields);
    }
  }

  /** "Hide": the track stops and is marked hidden. */
  record Hide() implements Effect {}

  /** "Put on route" again: shown again (Q18). */
  record Show() implements Effect {}

  /**
   * "Put on route" names an object that has no name (T-121, A73 to A76). An ordinary name: a reset
   * does not undo it, and a name set meanwhile wins.
   */
  record Name(String name) implements Effect {}

  /** A reset: the values events changed come back, and the track is shown. */
  record Restore() implements Effect {}

  /** A track's new content, and the declared fields to write with it. */
  record Result(MapObjectContent content, List<FieldValue> fields) {}

  private Effects() {}

  /**
   * Reads an event's effect (README, "Events"); a problem is added for anything it cannot use.
   * Declared fields are checked by the store when the event fires (A18).
   */
  static @Nullable Effect parse(JsonObject event, List<String> problems) {
    String kind = event.get("kind") instanceof JsonString s ? s.value() : "";
    switch (kind) {
      case "hide" -> {
        return new Hide();
      }
      case "set" -> {
        Map<String, @Nullable String> core = new LinkedHashMap<>();
        Map<TextModifier, @Nullable String> texts = new EnumMap<>(TextModifier.class);
        List<FieldValue> fields = new ArrayList<>();
        if (event.get("core") instanceof JsonObject c) {
          for (var e : c.members().entrySet()) {
            String name = e.getKey();
            JsonValue value = e.getValue();
            if (name.equals("texts") && value instanceof JsonObject t) {
              texts(t, texts, problems);
            } else if (!CORE.contains(name)) {
              problems.add("an event cannot change '" + name + "'");
            } else if (value instanceof JsonString s && !s.value().isEmpty() && s.value().length() <= (name.equals("description") ? 4096 : name.equals("sidc") ? 30 : 256)) {
              core.put(name, s.value());
            } else if (value instanceof JsonNull && !name.equals("sidc")) {
              core.put(name, null);
            } else {
              problems.add("an event's " + name + " is not a fitting text");
            }
          }
        } else if (event.has("core")) {
          problems.add("an event's 'core' is not an object");
        }
        if (event.get("fields") instanceof dev.emcc.sdk.json.JsonArray list) {
          for (JsonValue v : list.values()) {
            FieldValue f = field(v, problems);
            if (f != null) {
              fields.add(f);
            }
          }
        } else if (event.has("fields")) {
          problems.add("an event's 'fields' is not a list");
        }
        if (core.isEmpty() && texts.isEmpty() && fields.isEmpty()) {
          problems.add("a \"set\" event changes nothing");
          return null;
        }
        return new SetValues(core, texts, fields);
      }
      default -> {
        problems.add("an event's kind must be \"set\" or \"hide\"");
        return null;
      }
    }
  }

  private static void texts(JsonObject t, Map<TextModifier, @Nullable String> texts, List<String> problems) {
    for (var e : t.members().entrySet()) {
      TextModifier m;
      try {
        m = TextModifier.fromJson(e.getKey());
      } catch (IllegalArgumentException ex) {
        problems.add("no text modifier " + e.getKey());
        continue;
      }
      if (e.getValue() instanceof JsonString s && !s.value().isEmpty() && s.value().length() <= TextModifier.MAX_LENGTH) {
        texts.put(m, s.value());
      } else if (e.getValue() instanceof JsonNull) {
        texts.put(m, null);
      } else {
        problems.add("the text modifier " + e.getKey() + " is not a fitting text");
      }
    }
  }

  private static @Nullable FieldValue field(JsonValue v, List<String> problems) {
    if (v instanceof JsonObject o && o.get("plugin") instanceof JsonString p && o.get("name") instanceof JsonString n) {
      try {
        return new FieldValue(p.value(), n.value(), o.get("value"));
      } catch (IllegalArgumentException e) {
        problems.add("an event's field is not usable: " + e.getMessage());
        return null;
      }
    }
    problems.add("an event's field needs a plugin and a name");
    return null;
  }

  /** Whether the content is marked hidden by the simulator. */
  static boolean hidden(MapObjectContent content, String pluginId) {
    JsonObject own = content.extensions().get(pluginId);
    return own != null && own.get(HIDDEN) instanceof JsonBoolean b && b.value();
  }

  /**
   * {@code content} with declared {@code fields} applied as the object store applies them: a value
   * sets {@code extensions.<plugin>.<name>}, {@code null} removes it, and a namespace left empty
   * goes. The outputs send this, so that a field and the name an event sets with it arrive in the
   * same tick (T-112).
   */
  static MapObjectContent withFields(MapObjectContent content, List<FieldValue> fields) {
    if (fields.isEmpty()) {
      return content;
    }
    Map<String, JsonObject> namespaces = new LinkedHashMap<>(content.extensions().namespaces());
    for (FieldValue f : fields) {
      JsonObject namespace = namespaces.getOrDefault(f.plugin(), JsonObject.empty());
      JsonValue value = f.value();
      namespace = value == null ? namespace.without(f.name()) : namespace.with(f.name(), value);
      if (namespace.isEmpty()) {
        namespaces.remove(f.plugin());
      } else {
        namespaces.put(f.plugin(), namespace);
      }
    }
    MapObjectContent c = content;
    return new MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), c.layerId(), c.geometry(), c.symbol(), c.style(),
        c.properties(), c.label(), new Extensions(namespaces), c.fieldSets(), c.relations());
  }

  /** The content with {@code effects} applied in order, and the declared fields to write with it. */
  static Result apply(MapObjectContent content, List<Effect> effects, String pluginId) {
    JsonObject own = content.extensions().get(pluginId);
    boolean hidden = own != null && own.get(HIDDEN) instanceof JsonBoolean b && b.value();
    JsonObject restore = own != null && own.get(RESTORE) instanceof JsonObject r ? r : JsonObject.empty();
    Map<String, JsonValue> core = members(restore, "core");
    Map<String, JsonValue> texts = members(restore, "texts");
    Map<String, JsonValue> fieldsBefore = members(restore, "fields");
    ObjectProperties properties = content.properties();
    String name = properties == null ? null : properties.name();
    String description = properties == null ? null : properties.description();
    Symbol symbol = content.symbol();
    String sidc = symbol == null ? null : symbol.sidc();
    Modifiers modifiers = symbol == null ? null : symbol.modifiers();
    Map<TextModifier, String> textNow = new EnumMap<>(TextModifier.class);
    if (modifiers != null) {
      textNow.putAll(modifiers.texts());
    }
    Map<String, FieldValue> fields = new LinkedHashMap<>();
    for (Effect effect : effects) {
      switch (effect) {
        case SetValues s -> {
          for (var e : s.core().entrySet()) {
            String now = switch (e.getKey()) {
              case "name" -> name;
              case "description" -> description;
              default -> sidc;
            };
            core.putIfAbsent(e.getKey(), text(now));
            switch (e.getKey()) {
              case "name" -> name = e.getValue();
              case "description" -> description = e.getValue();
              default -> sidc = e.getValue() == null ? sidc : e.getValue();
            }
          }
          for (var e : s.texts().entrySet()) {
            texts.putIfAbsent(e.getKey().json(), text(textNow.get(e.getKey())));
            if (e.getValue() == null) {
              textNow.remove(e.getKey());
            } else {
              textNow.put(e.getKey(), e.getValue());
            }
          }
          for (FieldValue f : s.fields()) {
            String key = f.plugin() + "." + f.name();
            JsonObject theirs = content.extensions().get(f.plugin());
            JsonValue before = theirs == null ? null : theirs.get(f.name());
            fieldsBefore.putIfAbsent(key, before == null ? JsonNull.INSTANCE : before);
            fields.put(key, f);
          }
        }
        case Hide h -> hidden = true;
        case Show s -> hidden = false;
        case Name n -> name = name == null || name.isBlank() ? n.name() : name;
        case Restore r -> {
          for (var e : core.entrySet()) {
            String value = e.getValue() instanceof JsonString t ? t.value() : null;
            switch (e.getKey()) {
              case "name" -> name = value != null && value.length() > 256 ? name : value;
              case "description" -> description = value != null && value.length() > 4096 ? description : value;
              case "sidc" -> sidc = value == null ? sidc : value;
              default -> { } // not a field events change
            }
          }
          // The record is the simulator's own, but read leniently: an entry it cannot use is skipped.
          for (var e : texts.entrySet()) {
            TextModifier m = textModifier(e.getKey());
            if (m != null && e.getValue() instanceof JsonString t && !t.value().isEmpty() && t.value().length() <= TextModifier.MAX_LENGTH) {
              textNow.put(m, t.value());
            } else if (m != null) {
              textNow.remove(m);
            }
          }
          for (var e : fieldsBefore.entrySet()) {
            FieldValue f = restoredField(e.getKey(), e.getValue());
            if (f != null) {
              fields.put(e.getKey(), f);
            }
          }
          core.clear();
          texts.clear();
          fieldsBefore.clear();
          hidden = false;
        }
      }
    }
    var mark = new LinkedHashMap<String, JsonValue>();
    if (own != null) {
      mark.putAll(own.members());
    }
    mark.remove(HIDDEN);
    mark.remove(RESTORE);
    if (hidden) {
      mark.put(HIDDEN, JsonBoolean.of(true));
    }
    var record = new LinkedHashMap<String, JsonValue>();
    putIfAny(record, "core", core);
    putIfAny(record, "texts", texts);
    putIfAny(record, "fields", fieldsBefore);
    if (!record.isEmpty()) {
      mark.put(RESTORE, JsonObject.of(record));
    }
    var namespaces = new LinkedHashMap<>(content.extensions().namespaces());
    if (!mark.isEmpty()) {
      namespaces.put(pluginId, JsonObject.of(mark));
    } else if (own != null) {
      namespaces.put(pluginId, JsonObject.empty()); // the store removes an emptied namespace (model rule 13)
    }
    Symbol newSymbol = symbol == null || sidc == null ? symbol
        : new Symbol(symbol.standard(), sidc, new Modifiers(textNow, modifiers == null ? null : modifiers.direction(), modifiers == null ? null : modifiers.speed()));
    ObjectProperties newProperties = name == null && description == null ? null : new ObjectProperties(name, description);
    var after = new MapObjectContent(content.type(), content.dataType(), content.dataSource(), content.time(), content.layerId(), content.geometry(),
        newSymbol, content.style(), newProperties, content.label(), new Extensions(namespaces), content.fieldSets(), content.relations());
    return new Result(after, List.copyOf(fields.values()));
  }

  private static @Nullable TextModifier textModifier(String name) {
    try {
      return TextModifier.fromJson(name);
    } catch (IllegalArgumentException e) {
      return null;
    }
  }

  private static @Nullable FieldValue restoredField(String key, JsonValue value) {
    int dot = key.indexOf('.');
    if (dot <= 0) {
      return null;
    }
    try {
      return new FieldValue(key.substring(0, dot), key.substring(dot + 1), value);
    } catch (IllegalArgumentException e) {
      return null;
    }
  }

  private static Map<String, JsonValue> members(JsonObject restore, String name) {
    return restore.get(name) instanceof JsonObject o ? new LinkedHashMap<>(o.members()) : new LinkedHashMap<>();
  }

  private static void putIfAny(Map<String, JsonValue> record, String name, Map<String, JsonValue> values) {
    if (!values.isEmpty()) {
      record.put(name, JsonObject.of(values));
    }
  }

  private static JsonValue text(@Nullable String value) {
    return value == null ? JsonNull.INSTANCE : JsonString.of(value);
  }
}
