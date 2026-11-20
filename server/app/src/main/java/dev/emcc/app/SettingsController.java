package dev.emcc.app;

import dev.emcc.ecore.InstallationLook;
import dev.emcc.ecore.Labeling;
import dev.emcc.ecore.json.InvalidDocumentException;
import dev.emcc.ecore.json.ModelJson;
import dev.emcc.ecore.json.Problem;
import dev.emcc.ecore.plugin.PluginHost;
import dev.emcc.ecore.plugin.PluginManifest;
import dev.emcc.ecore.plugin.PluginSettings;
import dev.emcc.sdk.json.JsonObject;
import jakarta.servlet.http.HttpServletRequest;
import java.util.List;
import java.util.Objects;
import org.jspecify.annotations.Nullable;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

/**
 * A plugin's settings for the settings view (SDK v1, "Settings at runtime"; the view itself is
 * T-039). Both calls need {@code settings.admin}, checked before anything else. The settings
 * themselves are not secret: every logged-in user's web parts get the current values ({@code
 * GET /api/plugins} and the live {@code settings} messages, SDK v1 {@code ctx.settings}), so they
 * must hold no secrets (CLAUDE.md section 4).
 *
 * <ul>
 *   <li>{@code GET /api/settings/plugins/{id}}: {@code {"schema": ..., "values": ...}}; the schema
 *       is null for a plugin without settings.
 *   <li>{@code PUT} with the complete values: {@code 200 {"values": ...}} when they match the
 *       plugin's settings schema (stored, then delivered to the plugin), else {@code 400
 *       {"problems": [{"path", "problem"}]}}.
 *   <li>{@code GET}, {@code PUT} and {@code DELETE /api/settings/data-types/{id}}: a data type with
 *       its manifest's defaults and effective behaviour; the {@code PUT} replaces the behaviour, the
 *       {@code DELETE} sets it back to the defaults. Both answer with the data type as after a {@code
 *       GET}.
 *   <li>{@code PUT /api/settings/general} with {@code {"defaultLook": "chart-room"}}: the
 *       installation's default look (ADR-0034), {@code 200} with the general settings, {@code 400}
 *       for another value. Everyone reads it in {@code /api/config}.
 *   <li>{@code GET /api/settings/labeling}: the premade security labels (Settings › Labeling,
 *       T-170; {@link Labeling}). {@code PUT} with all of them replaces them: {@code 200} with them as
 *       stored, every browser gets the live notice {@code labeling}; {@code 400 {"problems": [...]}}
 *       when {@link Labeling#problems} finds something. Only {@code settings.admin} reads them in M6
 *       (owner, 2026-11-10).
 *   <li>{@code 401} without login, {@code 403} without the permission, {@code 404} for an unknown
 *       plugin or data type. The Origin check applies to the {@code PUT} and {@code DELETE} as to
 *       every change.
 * </ul>
 */
@RestController
class SettingsController {

  static final String PATH = "/api/settings/plugins/{pluginId}";
  static final String DATA_TYPE_PATH = "/api/settings/data-types/{dataType}";
  static final String GENERAL_PATH = "/api/settings/general";
  static final String LABELING_PATH = "/api/settings/labeling";
  /** SDK 1.9.0 (ADR-0064 point 4, PQ1 A): a plugin's compute threads, {@code settings.admin} only. */
  static final String COMPUTE_PATH = "/api/settings/plugins/{pluginId}/compute";
  /** ADR-0062 point 3 (M9 C3, CR-0048 point 1.3): the TLS credentials' names, {@code settings.admin} only. */
  static final String TLS_PATH = "/api/settings/tls-credentials";

  /** The names a settings field of kind {@code tls-credential} offers, sorted; never a path, a password or a certificate. */
  record TlsNames(java.util.List<String> names) {}

  /**
   * A plugin's compute threads (SDK 1.9.0): what it declares and why, and what the admin allows it
   * now, 0 to {@code declared}; the declaration until an admin sets a number.
   */
  record Compute(int declared, String reason, int allowed) {}

  /** The admin's new number for a plugin. */
  record ComputeChange(int allowed) {}

  /** The general settings (Settings › General): the installation's default look (ADR-0034). */
  record General(String defaultLook) {}

  record View(@Nullable JsonNode schema, JsonNode values) {}

  record Values(JsonNode values) {}

  record Refused(List<Problem> problems) {}

  private final ECoreLifecycle ecore;
  private final CurrentUser currentUser;
  private final AdminAccess admin;
  private final LabelingDefinitions labelingDefinitions;

  SettingsController(ECoreLifecycle ecore, CurrentUser currentUser, AdminAccess admin, LabelingDefinitions labelingDefinitions) {
    this.ecore = ecore;
    this.currentUser = currentUser;
    this.admin = admin;
    this.labelingDefinitions = labelingDefinitions;
  }

  @GetMapping(PATH)
  ResponseEntity<?> get(@PathVariable("pluginId") String pluginId, HttpServletRequest request) {
    ResponseEntity<?> denied = denied(request);
    if (denied != null) {
      return denied;
    }
    PluginSettings.View view = ecore.core().plugins().settings().view(pluginId);
    if (view == null) {
      return ResponseEntity.notFound().build();
    }
    return ResponseEntity.ok(new View(view.schema(), json().toNode(view.values())));
  }

  @PutMapping(path = PATH, consumes = MediaType.APPLICATION_JSON_VALUE)
  ResponseEntity<?> put(@PathVariable("pluginId") String pluginId, @RequestBody String body, HttpServletRequest request) {
    ResponseEntity<?> denied = denied(request);
    if (denied != null) {
      return denied;
    }
    User user = currentUser.of(request);
    JsonObject values;
    try {
      // ECore's codec, not Spring's: numbers keep their exact value (ADR-0007).
      if (!(ModelJson.toJsonValue(json().parse(body)) instanceof JsonObject object)) {
        return ResponseEntity.badRequest().body(new Refused(List.of(new Problem("", "the settings are a JSON object"))));
      }
      values = object;
    } catch (InvalidDocumentException e) {
      return ResponseEntity.badRequest().body(new Refused(e.problems()));
    }
    PluginSettings.Change change = ecore.core().plugins().settings()
        .change(pluginId, values, PluginController.sdkUser(Objects.requireNonNull(user), currentUser.mode()));
    return switch (change) {
      case PluginSettings.Change.Applied applied -> ResponseEntity.ok(new Values(json().toNode(applied.values())));
      case PluginSettings.Change.Refused refused -> ResponseEntity.badRequest().body(new Refused(refused.problems()));
      case PluginSettings.Change.Forbidden forbidden -> ResponseEntity.status(HttpStatus.FORBIDDEN).build();
      case PluginSettings.Change.NotFound notFound -> ResponseEntity.notFound().build();
    };
  }

  @GetMapping(COMPUTE_PATH)
  ResponseEntity<?> compute(@PathVariable("pluginId") String pluginId, HttpServletRequest request) {
    ResponseEntity<?> denied = denied(request);
    if (denied != null) {
      return denied;
    }
    PluginManifest manifest = computeManifest(pluginId);
    if (manifest == null) {
      return ResponseEntity.notFound().build();
    }
    return ResponseEntity.ok(new Compute(manifest.computeThreads(), Objects.requireNonNull(manifest.compute()).reason(),
        ecore.core().plugins().computeThreads(manifest)));
  }

  /** Stores and applies the admin's number at once: lowering it stops the plugin's newest compute tasks first. */
  @PutMapping(path = COMPUTE_PATH, consumes = MediaType.APPLICATION_JSON_VALUE)
  ResponseEntity<?> compute(@PathVariable("pluginId") String pluginId, @RequestBody String body, HttpServletRequest request) {
    ResponseEntity<?> denied = denied(request);
    if (denied != null) {
      return denied;
    }
    PluginManifest manifest = computeManifest(pluginId);
    if (manifest == null) {
      return ResponseEntity.notFound().build();
    }
    JsonNode allowed;
    try {
      allowed = json().parse(body).get("allowed");
    } catch (InvalidDocumentException e) {
      return ResponseEntity.badRequest().body(new Refused(e.problems()));
    }
    int declared = manifest.computeThreads();
    if (allowed == null || !allowed.isIntegralNumber() || !allowed.canConvertToInt() || allowed.intValue() < 0 || allowed.intValue() > declared) {
      return ResponseEntity.badRequest().body(new Refused(List.of(new Problem("/allowed",
          "a whole number from 0 to " + declared + ", the plugin's declaration"))));
    }
    int stored = ecore.core().plugins().computeThreads(pluginId, allowed.intValue());
    return ResponseEntity.ok(new Compute(declared, Objects.requireNonNull(manifest.compute()).reason(), stored));
  }

  @GetMapping(TLS_PATH)
  ResponseEntity<?> tlsCredentials(HttpServletRequest request) {
    ResponseEntity<?> denied = denied(request);
    if (denied != null) {
      return denied;
    }
    return ResponseEntity.ok(new TlsNames(java.util.List.copyOf(ecore.core().plugins().tlsCredentials().keySet())));
  }

  /** The manifest of a plugin here that declares compute threads, or null. */
  private @Nullable PluginManifest computeManifest(String pluginId) {
    return ecore.core().plugins().plugins().stream()
        .filter(p -> p.id().equals(pluginId) && p.manifest() != null && p.manifest().computeThreads() > 0)
        .map(p -> p.manifest()).findFirst().orElse(null);
  }

  /** A data type as the settings view shows it: the manifest's defaults and the effective behaviour. */
  @GetMapping(DATA_TYPE_PATH)
  ResponseEntity<?> getDataType(@PathVariable("dataType") String dataType, HttpServletRequest request) {
    ResponseEntity<?> denied = denied(request);
    if (denied != null) {
      return denied;
    }
    for (JsonNode type : ecore.core().plugins().dataTypesJson()) {
      if (type.get("id").asString().equals(dataType)) {
        return ResponseEntity.ok(type);
      }
    }
    return ResponseEntity.notFound().build();
  }

  /** Changes a data type's behaviour: the complete behaviour; every browser gets the new {@code data-types}. */
  @PutMapping(path = DATA_TYPE_PATH, consumes = MediaType.APPLICATION_JSON_VALUE)
  ResponseEntity<?> putDataType(@PathVariable("dataType") String dataType, @RequestBody String body, HttpServletRequest request) {
    ResponseEntity<?> denied = denied(request);
    if (denied != null) {
      return denied;
    }
    User user = currentUser.of(request);
    JsonObject values;
    try {
      if (!(ModelJson.toJsonValue(json().parse(body)) instanceof JsonObject object)) {
        return ResponseEntity.badRequest().body(new Refused(List.of(new Problem("", "the behaviour is a JSON object"))));
      }
      values = object;
    } catch (InvalidDocumentException e) {
      return ResponseEntity.badRequest().body(new Refused(e.problems()));
    }
    PluginHost.BehaviourChange change = ecore.core().plugins()
        .changeBehaviour(dataType, values, PluginController.sdkUser(Objects.requireNonNull(user), currentUser.mode()));
    return switch (change) {
      case PluginHost.BehaviourChange.Applied applied -> getDataType(dataType, request);
      case PluginHost.BehaviourChange.Refused refused -> ResponseEntity.badRequest().body(new Refused(refused.problems()));
      case PluginHost.BehaviourChange.Forbidden forbidden -> ResponseEntity.status(HttpStatus.FORBIDDEN).build();
      case PluginHost.BehaviourChange.NotFound notFound -> ResponseEntity.notFound().build();
    };
  }

  /** Sets a data type's behaviour back to its manifest's defaults; every browser gets the new {@code data-types}. */
  @DeleteMapping(DATA_TYPE_PATH)
  ResponseEntity<?> resetDataType(@PathVariable("dataType") String dataType, HttpServletRequest request) {
    ResponseEntity<?> denied = denied(request);
    if (denied != null) {
      return denied;
    }
    User user = Objects.requireNonNull(currentUser.of(request));
    PluginHost.BehaviourChange change = ecore.core().plugins().resetBehaviour(dataType, PluginController.sdkUser(user, currentUser.mode()));
    return switch (change) {
      case PluginHost.BehaviourChange.Applied applied -> getDataType(dataType, request);
      case PluginHost.BehaviourChange.Refused refused -> ResponseEntity.badRequest().body(new Refused(refused.problems()));
      case PluginHost.BehaviourChange.Forbidden forbidden -> ResponseEntity.status(HttpStatus.FORBIDDEN).build();
      case PluginHost.BehaviourChange.NotFound notFound -> ResponseEntity.notFound().build();
    };
  }

  /**
   * Changes the general settings: {@code {"defaultLook": "chart-room"}}. Users who have not chosen a
   * look get it at their next load (owner, 2026-10-17); everyone reads it in {@code /api/config}.
   */
  @PutMapping(path = GENERAL_PATH, consumes = MediaType.APPLICATION_JSON_VALUE)
  ResponseEntity<?> putGeneral(@RequestBody String body, HttpServletRequest request) {
    ResponseEntity<?> denied = denied(request);
    if (denied != null) {
      return denied;
    }
    JsonNode look;
    try {
      look = json().parse(body).get("defaultLook");
    } catch (InvalidDocumentException e) {
      return ResponseEntity.badRequest().body(new Refused(e.problems()));
    }
    if (look == null || !look.isString() || !InstallationLook.LOOKS.contains(look.stringValue())) {
      return ResponseEntity.badRequest().body(new Refused(List.of(
          new Problem("/defaultLook", "the default look is one of " + String.join(", ", InstallationLook.LOOKS)))));
    }
    ecore.core().look().set(look.stringValue());
    return ResponseEntity.ok(new General(ecore.core().look().current()));
  }

  /** The premade security labels (T-170), for {@code settings.admin} only. */
  @GetMapping(LABELING_PATH)
  ResponseEntity<?> getLabeling(HttpServletRequest request) {
    ResponseEntity<?> denied = denied(request);
    if (denied != null) {
      return denied;
    }
    return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.APPLICATION_JSON)
        .body(ecore.core().labeling().current().toString());
  }

  /** Replaces the premade security labels (one Save for the whole entry, owner OJ B); every browser is told. */
  @PutMapping(path = LABELING_PATH, consumes = MediaType.APPLICATION_JSON_VALUE)
  ResponseEntity<?> putLabeling(@RequestBody String body, HttpServletRequest request) {
    ResponseEntity<?> denied = denied(request);
    if (denied != null) {
      return denied;
    }
    JsonNode value;
    try {
      value = json().parse(body);
    } catch (InvalidDocumentException e) {
      return ResponseEntity.badRequest().body(new Refused(e.problems()));
    }
    List<Problem> problems = ecore.core().labeling().set(value, labelingDefinitions.classificationsByPolicy());
    if (!problems.isEmpty()) {
      return ResponseEntity.badRequest().body(new Refused(problems));
    }
    return getLabeling(request);
  }

  /** {@code 401} without login, {@code 403} without {@code settings.admin}, else null ({@link AdminAccess}). */
  private @Nullable ResponseEntity<?> denied(HttpServletRequest request) {
    return admin.denied(request);
  }

  private ModelJson json() {
    return ecore.core().json();
  }
}
