package dev.emcc.app;

import dev.emcc.ecore.json.InvalidDocumentException;
import java.util.ArrayList;
import java.util.List;
import org.jspecify.annotations.Nullable;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.JsonNode;

/**
 * What a browser's shell found with a plugin's web part (SDK 1.4.0, ADR-0044 point 4; owner,
 * 2026-11-06). {@code POST /api/web-parts/{pluginId}/capabilities} with {@code {"implemented":
 * [ids], "problem": text or null}}: the capabilities the module implements and the shell's
 * {@code capabilityMismatch}. ECore judges the whole with the server part and shows a fault in the
 * Monitor; the plugin keeps running. Any logged-in user's browser reports (no permission: it changes
 * nothing but the Monitor's note), and {@code OriginCheckFilter} refuses a cross-site one.
 *
 * <p>Not under {@code /api/plugins/{id}/}, which is the plugin's own endpoints. Answers {@code 204},
 * {@code 404} for a plugin that is not running, {@code 400} for a body it cannot read.
 */
@RestController
class WebPartController {

  static final String PATH = "/api/web-parts/{pluginId}/capabilities";
  /** At most this many ids (the manifest's limit), each at most 64 characters. */
  static final int MAX_IDS = 16;
  /** The most characters of a body. */
  static final int MAX_BODY = 4_096;

  private final ECoreLifecycle ecore;

  WebPartController(ECoreLifecycle ecore) {
    this.ecore = ecore;
  }

  @PostMapping(path = PATH, consumes = MediaType.APPLICATION_JSON_VALUE)
  ResponseEntity<?> report(@PathVariable("pluginId") String pluginId, @RequestBody String body) {
    if (body.length() > MAX_BODY) {
      return ResponseEntity.badRequest().body("a report is at most " + MAX_BODY + " characters");
    }
    JsonNode tree;
    try {
      tree = ecore.core().json().parse(body);
    } catch (InvalidDocumentException e) {
      return ResponseEntity.badRequest().body("not JSON");
    }
    JsonNode implemented = tree.get("implemented");
    JsonNode problem = tree.get("problem");
    List<String> ids = new ArrayList<>();
    if (implemented == null || !implemented.isArray() || implemented.size() > MAX_IDS) {
      return ResponseEntity.badRequest().body("implemented is a list of at most " + MAX_IDS + " capability ids");
    }
    for (JsonNode id : implemented) {
      if (!id.isString() || id.asString().isEmpty() || id.asString().length() > 64) {
        return ResponseEntity.badRequest().body("a capability id is a string of 1 to 64 characters");
      }
      ids.add(id.asString());
    }
    @Nullable String text = null;
    if (problem != null && !problem.isNull()) {
      if (!problem.isString()) {
        return ResponseEntity.badRequest().body("problem is a string or null");
      }
      text = problem.asString();
    }
    return ecore.core().plugins().webCapabilities(pluginId, ids, text)
        ? ResponseEntity.noContent().build()
        : ResponseEntity.notFound().build();
  }
}
