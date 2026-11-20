package dev.emcc.ecore.plugin;

import dev.emcc.ecore.json.InvalidDocumentException;
import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.json.ModelSchemas.Document;
import dev.emcc.ecore.json.Problem;
import dev.emcc.sdk.DataType;
import dev.emcc.sdk.DeclaredField;
import dev.emcc.sdk.FieldSet;
import dev.emcc.sdk.RelationKind;
import dev.emcc.sdk.capability.Capability;
import dev.emcc.sdk.Workspace;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonValue;
import dev.emcc.sdk.model.Style;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.jspecify.annotations.Nullable;
import tools.jackson.databind.JsonNode;

/**
 * A plugin's {@code plugin.json}, validated against {@code model/schemas/plugin-manifest.schema.json}
 * (SDK v1 design, "Plugin manifest"). Only the fields the plugin host and the shell use are mapped.
 *
 * @param id the plugin id, also its extension namespace and its worker owner
 * @param settings the defaults of the manifest's settings schema; the configured values replace them
 *     ({@link PluginSettings})
 * @param internet its declared internet use, or {@code null} if it declares none: shown in the
 *     monitor view, not enforced (ADR-0030, CR-0013)
 * @param entryClass the server part's entry class, or {@code null} for a web-only plugin
 * @param web the web part, or {@code null}
 * @param uses web service keys the web part uses when a provider is there (CR-0011; for the shell)
 * @param permissions the permissions the plugin declares or checks
 * @param dataTypes the data types it declares (ADR-0023), as written: the plugin host checks them
 * @param network where its listeners' endpoints are in its settings, or {@code null} for none
 * @param settingsSchema the JSON Schema of its settings, or {@code null} if it has none
 * @param connections its declared connections (SDK 1.2.0, ADR-0036 point 7): shown in the monitor
 *     view, not an allow-list; empty if it declares none
 * @param fields the fields it declares in its namespace (SDK 1.2.0, ADR-0038), as written: the
 *     plugin host checks that each name comes once
 * @param workspaces the workspaces it declares (SDK 1.2.0, ADR-0039), as written: the plugin host
 *     checks their ids and permissions
 * @param fieldSets the field sets it declares (SDK 1.4.0, ADR-0050), as written: the plugin host
 *     checks that each comes once and names only the plugin's own fields
 * @param relationKinds the relation kinds it declares (SDK 1.4.0, ADR-0051 point 2), the line's
 *     defaults filled in: the plugin host checks that each is in the plugin's namespace and comes once
 * @param capabilities the capabilities it declares (SDK 1.4.0, ADR-0044), each one this SDK knows
 *     (the schema refuses others, and {@link #read} names them): the plugin host checks them against
 *     the server part's class, and the shell against the web part
 * @param folders the local folders its server part reads (SDK 1.4.0, ADR-0049 point 4), as written:
 *     the plugin host checks rule 19; shown in the monitor view
 * @param category data model 1.6.0 (CR-0041 part F; T-174): the Settings workspace's category, one of the
 *     schema's fixed list; {@code null} when the manifest names none (General)
 * @param symbolPalettes data model 1.6.0 (CR-0041 part G; T-156): the manifest's {@code symbolPalettes}
 *     as written (the schema checked them; the plugin host checks that no id repeats), for the
 *     shell's {@code ctx.symbolPalettes}; {@code null} when it has none
 * @param icon SDK 1.8.0 (CR-0043 part D; T-203): the Settings list's icon, a name from the web SDK's
 *     {@code PLUGIN_ICONS} as written (the schema checked its form; the shell draws a neutral icon for
 *     an unknown one); {@code null} when the manifest names none
 * @param channelKinds SDK 1.9.0 (CR-0048 point 4): the channel kinds it declares, each name once, each
 *     payload schema self-contained and compiled (model rule 23); empty if it declares none
 * @param compute SDK 1.9.0 (CR-0048 point 5, ADR-0064 point 1): the compute threads it declares and
 *     why, or {@code null} for none
 */
public record PluginManifest(
    String id,
    String name,
    String version,
    String sdkVersion,
    String kind,
    List<String> dependsOn,
    List<String> provides,
    List<String> requires,
    boolean required,
    @Nullable Internet internet,
    @Nullable String entryClass,
    @Nullable WebPart web,
    JsonObject settings,
    List<String> uses,
    List<String> permissions,
    List<DeclaredDataType> dataTypes,
    @Nullable Network network,
    @Nullable JsonNode settingsSchema,
    List<Connection> connections,
    List<DeclaredField> fields,
    List<Workspace> workspaces,
    List<FieldSet> fieldSets,
    List<RelationKind> relationKinds,
    List<Capability> capabilities,
    List<Folder> folders,
    @Nullable String category,
    @Nullable JsonNode symbolPalettes,
    @Nullable String icon,
    List<ChannelKind> channelKinds,
    @Nullable Compute compute) {

  /** The manifest's file name in a plugin folder. */
  public static final String FILE = "plugin.json";

  /** A declared workspace's {@code order} when its manifest names none (the schema's default). */
  static final int DEFAULT_WORKSPACE_ORDER = 100;

  public PluginManifest {
    dependsOn = List.copyOf(dependsOn);
    provides = List.copyOf(provides);
    requires = List.copyOf(requires);
    uses = List.copyOf(uses);
    permissions = List.copyOf(permissions);
    dataTypes = List.copyOf(dataTypes);
    connections = List.copyOf(connections);
    fields = List.copyOf(fields);
    workspaces = List.copyOf(workspaces);
    fieldSets = List.copyOf(fieldSets);
    relationKinds = List.copyOf(relationKinds);
    capabilities = List.copyOf(capabilities);
    folders = List.copyOf(folders);
    channelKinds = List.copyOf(channelKinds);
  }

  /**
   * A channel kind the plugin declares (SDK 1.9.0, CR-0048 point 4): its id is {@code
   * <plugin-id>.<name>}; its payload schema is compiled once, when the manifest is read.
   */
  public record ChannelKind(String id, String title, String description, JsonNode payload, PayloadSchema schema) {}

  /** The compute threads a plugin declares (ADR-0064 point 1): at most {@code threads} tasks at once, and why. */
  public record Compute(int threads, String reason) {}

  /** Its declared compute threads, 0 without the declaration. */
  public int computeThreads() {
    return compute == null ? 0 : compute.threads();
  }

  /** Its declared channel kinds by id. */
  public Map<String, ChannelKind> channelKindsById() {
    Map<String, ChannelKind> byId = new LinkedHashMap<>();
    channelKinds.forEach(k -> byId.put(k.id(), k));
    return byId;
  }

  /** Its capabilities' ids, as the manifest names them. */
  public List<String> capabilityIds() {
    return capabilities.stream().map(Capability::id).toList();
  }

  /** A manifest without the SDK v1 additions: no uses, permissions, data types, network or settings schema. */
  public static PluginManifest of(String id, String name, String version, String sdkVersion, String kind,
      List<String> dependsOn, List<String> provides, List<String> requires, boolean required, @Nullable Internet internet,
      @Nullable String entryClass, @Nullable WebPart web, JsonObject settings) {
    return new PluginManifest(id, name, version, sdkVersion, kind, dependsOn, provides, requires, required, internet,
        entryClass, web, settings, List.of(), List.of(), List.of(), null, null, List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), List.of(),
        null, null, null, List.of(), null);
  }

  /**
   * A data type as the manifest declares it; {@link #toDataType} checks its namespace.
   *
   * @param fieldSets SDK 1.5.0 (CR-0038): the ids of the plugin's own sets as written, without the
   *     plugin's id; the plugin host checks rule 20
   * @param manual SDK 1.5.0: whether users make its objects by hand (default true)
   * @param sensorReport SDK 1.5.0 part 3 (CR-0039 point 6): whether its objects are sensor reports (default false)
   * @param fadeSetting SDK 1.7.0 (CR-0042): a JSON Pointer into the plugin's settings to its stepped
   *     fade, as written; ECore only keeps it for the browsers, which resolve it (null: none)
   */
  public record DeclaredDataType(String id, String name, @Nullable String description, DataType.Defaults defaults,
      List<String> fieldSets, boolean manual, boolean sensorReport, @Nullable String fadeSetting) {

    public DeclaredDataType {
      fieldSets = List.copyOf(fieldSets);
    }

    /** A data type without field sets that users make by hand, as before SDK 1.5.0. */
    public DeclaredDataType(String id, String name, @Nullable String description, DataType.Defaults defaults) {
      this(id, name, description, defaults, List.of(), true, false, null);
    }

    /** A data type without a stepped fade, as before SDK 1.7.0. */
    public DeclaredDataType(String id, String name, @Nullable String description, DataType.Defaults defaults,
        List<String> fieldSets, boolean manual, boolean sensorReport) {
      this(id, name, description, defaults, fieldSets, manual, sensorReport, null);
    }

    /** @throws IllegalArgumentException if the id does not start with the plugin's id and a dot */
    public DataType toDataType(String pluginId) {
      return new DataType(id, name, description, pluginId, defaults,
          fieldSets.stream().map(set -> pluginId + "." + set).toList(), manual, sensorReport);
    }
  }

  /**
   * The manifest's {@code internet}: a declaration that the server part reaches outside hosts, why,
   * and the hosts of its default settings (ADR-0030). Not an allow-list: the server part may reach
   * other hosts too, and ECore does not check them. The hosts in lower case, as host names compare.
   */
  public record Internet(List<String> hosts, String reason) {
    public Internet {
      hosts = hosts.stream().map(h -> h.toLowerCase(Locale.ROOT)).toList();
    }
  }

  /**
   * One of the manifest's {@code connections} (SDK 1.2.0, ADR-0036 point 7): the kinds its links
   * may use ({@code tcp-client}, {@code tcp-server}, {@code udp}, {@code multicast}, {@code other}),
   * whether it receives, sends or both ({@code in}, {@code out}, {@code both}), where in its settings
   * the links are (a JSON Pointer, or {@code null}), and why. A declaration, not an allow-list.
   */
  public record Connection(List<String> kinds, String direction, @Nullable String settings, String reason) {
    public Connection {
      kinds = List.copyOf(kinds);
    }
  }

  /**
   * The manifest's {@code network}: JSON Pointers into the settings to the listeners' endpoints.
   */
  public record Network(List<String> endpoints, String reason) {
    public Network {
      endpoints = List.copyOf(endpoints);
    }
  }

  /**
   * The web part.
   *
   * @param entry the ES module the shell imports, relative to the plugin's web folder
   * @param css style sheets loaded first
   * @param shared shared library versions the web part was built against
   */
  public record WebPart(String entry, List<String> css, Map<String, String> shared) {
    public WebPart {
      css = List.copyOf(css);
      shared = Map.copyOf(shared);
    }
  }

  /**
   * Reads and validates a manifest file.
   *
   * @throws InvalidDocumentException if it is not valid JSON or breaks the schema
   * @throws UncheckedIOException if it cannot be read
   */
  static PluginManifest read(Path file, ModelJson json) {
    String text;
    try {
      text = Files.readString(file);
    } catch (IOException e) {
      throw new UncheckedIOException("cannot read " + file, e);
    }
    JsonNode tree = json.parse(text);
    List<Problem> problems = json.validate(Document.PLUGIN_MANIFEST, tree);
    if (!problems.isEmpty()) {
      throw new InvalidDocumentException("invalid " + Document.PLUGIN_MANIFEST.schemaId(), namingCapabilities(tree, problems));
    }
    JsonNode server = tree.get("server");
    JsonNode web = tree.get("web");
    JsonNode internet = tree.get("internet");
    String id = tree.get("id").asString();
    return new PluginManifest(
        id,
        tree.get("name").asString(),
        tree.get("version").asString(),
        tree.get("sdkVersion").asString(),
        tree.get("kind").asString(),
        strings(tree.get("dependsOn")),
        strings(tree.get("provides")),
        strings(tree.get("requires")),
        tree.has("required") && tree.get("required").booleanValue(),
        internet == null ? null : new Internet(strings(internet.get("hosts")), internet.get("reason").asString()),
        server == null ? null : server.get("entryClass").asString(),
        web == null ? null : webPart(web),
        settingDefaults(tree.get("settings")),
        strings(tree.get("uses")),
        strings(tree.get("permissions")),
        dataTypes(tree.get("dataTypes")),
        network(tree.get("network")),
        tree.get("settings"),
        connections(tree.get("connections")),
        fields(id, tree.get("fields")),
        workspaces(tree.get("workspaces")),
        fieldSets(id, tree.get("fieldSets")),
        relationKinds(tree.get("relationKinds")),
        capabilities(tree.get("capabilities")),
        folders(tree.get("folders")),
        tree.has("category") ? tree.get("category").asString() : null, // data model 1.6.0 (CR-0041 part F): the schema checked it
        tree.get("symbolPalettes"), // data model 1.6.0 (CR-0041 part G)
        tree.has("icon") ? tree.get("icon").asString() : null, // SDK 1.8.0 (CR-0043 part D): passed on, as the category
        channelKinds(id, tree.get("channelKinds")),
        tree.has("compute") // SDK 1.9.0: the schema checked its shape (1 to 64 threads, a reason)
            ? new Compute(tree.get("compute").get("threads").intValue(), tree.get("compute").get("reason").asString()) : null);
  }

  /**
   * The manifest's {@code channelKinds} (SDK 1.9.0, CR-0048 point 4), each payload schema compiled.
   * The schema checks their shape; here each name comes once and each payload schema is
   * self-contained and usable (model rule 23), else the manifest is refused.
   */
  private static List<ChannelKind> channelKinds(String pluginId, @Nullable JsonNode array) {
    List<ChannelKind> all = new ArrayList<>();
    if (array != null) {
      Set<String> names = new HashSet<>();
      int i = 0;
      for (JsonNode k : array) {
        String name = k.get("name").asString();
        if (!names.add(name)) {
          throw new InvalidDocumentException("invalid channel kind", List.of(new Problem("/channelKinds/" + i + "/name", "the kind " + name + " is declared twice")));
        }
        String id = pluginId + "." + name;
        try {
          all.add(new ChannelKind(id, k.get("title").asString(), k.get("description").asString(), k.get("payload"),
              PayloadSchema.compile(id, k.get("payload"))));
        } catch (IllegalArgumentException e) {
          throw new InvalidDocumentException("invalid channel kind", List.of(new Problem("/channelKinds/" + i + "/payload", e.getMessage())));
        }
        i++;
      }
    }
    return all;
  }

  /**
   * One of the manifest's {@code folders} (SDK 1.4.0, CR-0030 part 6, ADR-0049 point 4): its id,
   * the JSON Pointer into the settings to the string that holds its absolute path, and why the
   * plugin reads it. ECore reads it for the plugin, read only ({@link PluginLocalFolders}).
   */
  public record Folder(String id, String setting, String reason) {}

  /** The manifest's {@code folders}, which the schema has checked; the plugin host checks rule 19. */
  private static List<Folder> folders(@Nullable JsonNode array) {
    List<Folder> all = new ArrayList<>();
    if (array != null) {
      array.forEach(f -> all.add(new Folder(f.get("id").asString(), f.get("setting").asString(), f.get("reason").asString())));
    }
    return all;
  }

  /** The manifest's {@code capabilities} (SDK 1.4.0), which the schema has checked: each a known id, once. */
  private static List<Capability> capabilities(@Nullable JsonNode array) {
    List<Capability> all = new ArrayList<>();
    if (array != null) {
      array.forEach(c -> all.add(Capability.fromId(c.asString()).orElseThrow()));
    }
    return all;
  }

  /**
   * The schema's problems, with each one about an unknown capability id saying which id (the ACA's
   * R3; ADR-0044 point 5), e.g. {@code /capabilities/1: unknown capability history (ADR-0044
   * point 5)}, instead of the schema's words about its enumeration.
   */
  private static List<Problem> namingCapabilities(JsonNode tree, List<Problem> problems) {
    JsonNode declared = tree.get("capabilities");
    List<Problem> named = new ArrayList<>();
    for (Problem p : problems) {
      java.util.regex.Matcher m = CAPABILITY_PATH.matcher(p.path());
      JsonNode value = m.matches() && declared != null && declared.isArray() ? declared.get(Integer.parseInt(m.group(1))) : null;
      if (value != null && value.isString() && Capability.fromId(value.asString()).isEmpty()) {
        named.add(new Problem(p.path(), "unknown capability " + value.asString() + " (ADR-0044 point 5)"));
      } else {
        named.add(p);
      }
    }
    return named;
  }

  private static final java.util.regex.Pattern CAPABILITY_PATH = java.util.regex.Pattern.compile("/capabilities/(\\d{1,4})");

  /**
   * The manifest's {@code fieldSets} (SDK 1.4.0, ADR-0050). The schema checks their shape; the plugin
   * host checks the ids and the fields.
   */
  private static List<FieldSet> fieldSets(String pluginId, @Nullable JsonNode array) {
    List<FieldSet> all = new ArrayList<>();
    if (array != null) {
      int i = 0;
      for (JsonNode s : array) {
        try {
          all.add(new FieldSet(pluginId, s.get("id").asString(), s.get("label").asString(), strings(s.get("fields"))));
        } catch (IllegalArgumentException e) {
          throw new InvalidDocumentException("invalid field set", List.of(new Problem("/fieldSets/" + i, e.getMessage())));
        }
        i++;
      }
    }
    return all;
  }

  /**
   * The manifest's {@code relationKinds} (SDK 1.4.0, ADR-0051 point 2), with the line's defaults for
   * absent members (width 1, solid, no arrowhead) and {@code defaultOn} false when absent. The schema
   * checks their shape; the plugin host checks the ids.
   */
  private static List<RelationKind> relationKinds(@Nullable JsonNode array) {
    List<RelationKind> all = new ArrayList<>();
    if (array != null) {
      int i = 0;
      for (JsonNode k : array) {
        JsonNode line = k.get("line");
        try {
          RelationKind.Line drawn = RelationKind.Line.of(
              line.get("strokeColor").asString(), line.has("strokeWidth") ? line.get("strokeWidth").doubleValue() : null,
              line.has("strokeDash") ? Style.Dash.fromJson(line.get("strokeDash").asString()) : null,
              line.has("arrowhead") ? Style.Arrowhead.fromJson(line.get("arrowhead").asString()) : null);
          if (line.has("strokeColorSetting")) { // SDK 1.6.0 (CR-0041 part C): kept for the shell
            drawn = drawn.withStrokeColorSetting(line.get("strokeColorSetting").asString());
          }
          all.add(new RelationKind(k.get("id").asString(), k.get("label").asString(), drawn,
              k.has("defaultOn") && k.get("defaultOn").booleanValue()));
        } catch (IllegalArgumentException e) {
          throw new InvalidDocumentException("invalid relation kind", List.of(new Problem("/relationKinds/" + i, e.getMessage())));
        }
        i++;
      }
    }
    return all;
  }

  /**
   * The manifest's {@code workspaces} (SDK 1.2.0, ADR-0039), each with the order 100 unless it names
   * one. The schema checks their shape; the plugin host checks their ids and permissions.
   */
  private static List<Workspace> workspaces(@Nullable JsonNode array) {
    List<Workspace> all = new ArrayList<>();
    if (array != null) {
      int i = 0;
      for (JsonNode w : array) {
        try {
          all.add(new Workspace(w.get("id").asString(), w.get("name").asString(), w.get("viewPermission").asString(),
              w.get("editPermission").asString(), w.has("order") ? w.get("order").intValue() : DEFAULT_WORKSPACE_ORDER));
        } catch (IllegalArgumentException e) {
          throw new InvalidDocumentException("invalid workspace", List.of(new Problem("/workspaces/" + i, e.getMessage())));
        }
        i++;
      }
    }
    return all;
  }

  /**
   * The manifest's {@code fields} (SDK 1.2.0, ADR-0038). The schema checks each one's shape; what it
   * cannot (a minimum above the maximum) the SDK's {@link DeclaredField} refuses, at {@code /fields/<i>}.
   */
  private static List<DeclaredField> fields(String pluginId, @Nullable JsonNode array) {
    List<DeclaredField> all = new ArrayList<>();
    if (array != null) {
      int i = 0;
      for (JsonNode f : array) {
        List<DeclaredField.Choice> choices = new ArrayList<>();
        if (f.has("choices")) {
          f.get("choices").forEach(c -> choices.add(new DeclaredField.Choice(c.get("value").asString(), c.get("label").asString())));
        }
        try {
          all.add(new DeclaredField(pluginId, f.get("name").asString(),
              DeclaredField.Type.valueOf(f.get("type").asString().toUpperCase(Locale.ROOT)), f.get("label").asString(),
              text(f, "description"), text(f, "unit"), number(f, "minimum"), number(f, "maximum"),
              f.has("maxLength") ? f.get("maxLength").intValue() : null, f.has("required") && f.get("required").booleanValue(),
              choices, f.has("editableByOthers") && f.get("editableByOthers").booleanValue(), strings(f.get("dataTypes"))));
        } catch (IllegalArgumentException e) {
          throw new InvalidDocumentException("invalid field", List.of(new Problem("/fields/" + i, e.getMessage())));
        }
        i++;
      }
    }
    return all;
  }

  private static @Nullable String text(JsonNode node, String name) {
    return node.has(name) ? node.get(name).asString() : null;
  }

  private static @Nullable BigDecimal number(JsonNode node, String name) {
    return node.has(name) ? node.get(name).decimalValue() : null;
  }

  private static List<Connection> connections(@Nullable JsonNode array) {
    List<Connection> all = new ArrayList<>();
    if (array != null) {
      for (JsonNode c : array) {
        all.add(new Connection(strings(c.get("kinds")), c.get("direction").asString(),
            c.has("settings") ? c.get("settings").asString() : null, c.get("reason").asString()));
      }
    }
    return all;
  }

  private static List<DeclaredDataType> dataTypes(@Nullable JsonNode array) {
    List<DeclaredDataType> types = new ArrayList<>();
    if (array != null) {
      for (JsonNode t : array) {
        JsonNode d = t.get("defaults");
        DataType.Defaults defaults = d == null ? DataType.Defaults.NONE : new DataType.Defaults(
            d.has("expiresAfterSeconds") ? d.get("expiresAfterSeconds").longValue() : null,
            d.has("fadeWhenExpired") && d.get("fadeWhenExpired").booleanValue(),
            d.has("removeAfterExpirySeconds") ? d.get("removeAfterExpirySeconds").longValue() : null);
        types.add(new DeclaredDataType(t.get("id").asString(), t.get("name").asString(),
            t.has("description") ? t.get("description").asString() : null, defaults, strings(t.get("fieldSets")),
            !t.has("manual") || t.get("manual").booleanValue(), t.has("sensorReport") && t.get("sensorReport").booleanValue(),
            t.has("fadeSetting") ? t.get("fadeSetting").asString() : null)); // SDK 1.7.0 (CR-0042): kept for the browsers
      }
    }
    return types;
  }

  private static @Nullable Network network(@Nullable JsonNode network) {
    return network == null ? null : new Network(strings(network.get("endpoints")), network.get("reason").asString());
  }

  private static WebPart webPart(JsonNode web) {
    Map<String, String> shared = new LinkedHashMap<>();
    JsonNode sharedNode = web.get("shared");
    if (sharedNode != null) {
      for (var entry : sharedNode.properties()) {
        shared.put(entry.getKey(), entry.getValue().asString());
      }
    }
    return new WebPart(web.get("entry").asString(), strings(web.get("css")), shared);
  }

  /** The {@code default} of each top-level setting; settings without one are left out. */
  private static JsonObject settingDefaults(@Nullable JsonNode settings) {
    Map<String, JsonValue> defaults = new LinkedHashMap<>();
    if (settings != null) {
      for (var entry : settings.get("properties").properties()) {
        JsonNode value = entry.getValue().get("default");
        if (value != null) {
          defaults.put(entry.getKey(), ModelJson.toJsonValue(value));
        }
      }
    }
    return JsonObject.of(defaults);
  }

  private static List<String> strings(@Nullable JsonNode array) {
    List<String> values = new ArrayList<>();
    if (array != null) {
      array.forEach(v -> values.add(v.asString()));
    }
    return values;
  }
}
