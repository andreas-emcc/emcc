package dev.emcc.app;

import dev.emcc.ecore.DisplaySettings;
import dev.emcc.ecore.UserDocuments;
import dev.emcc.ecore.json.InvalidDocumentException;
import dev.emcc.ecore.json.Problem;
import dev.emcc.ecore.persistence.UserDocumentStore;
import dev.emcc.ecore.persistence.UserDocumentStore.Result;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.function.Consumer;
import java.util.function.Function;
import org.jspecify.annotations.Nullable;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.request.async.DeferredResult;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.JsonNodeFactory;
import tools.jackson.databind.node.ObjectNode;

/**
 * Each user's display settings (SDK 1.4.0 part 5; ADR-0046, ADR-0052), for the shell. The user is
 * always the login session's (in the no-login mode the local user), never another, and needs no
 * permission beyond being the user (ADR-0046 point 4); the admin's defaults need {@code
 * settings.admin}.
 *
 * <ul>
 *   <li>{@code GET /api/display}: {@code {"choices": {...}, "defaults": {...}}}, the parts the user
 *       has set and the admin's defaults (each {@code {}} when nothing is set).
 *   <li>{@code PUT /api/display} with the user's choices, replacing them ({@code {}}: "Use
 *       defaults"): {@code 204}; the user's browsers get the live notice {@code display}.
 *   <li>{@code PUT /api/settings/display} with the admin's defaults: {@code 200 {"defaults": ...}};
 *       every browser gets the live notice. {@code 403} without {@code settings.admin}; refused
 *       values as every settings call refuses them, {@code 400 {"problems": [{"path", "problem"}]}}.
 *   <li>{@code 400} for a body that is not UTF-8 JSON or not well-formed display settings, as the
 *       web SDK's {@code displayChoicesProblem} says; {@code 413} over {@value #MAX_BODY} bytes or
 *       the user documents' limits; {@code 503} when ECore is busy; {@code 504} without an answer in
 *       time; {@code 500} when the store fails; {@code 401} without login. Problems as {@code
 *       {"problem": "..."}}. The Origin check applies to the {@code PUT}s as to every change.
 * </ul>
 */
@RestController
class DisplayController {

  static final String PATH = "/api/display";
  static final String DEFAULTS_PATH = "/api/settings/display";
  /** The most a request body may have: the user documents' limit for one document. */
  static final int MAX_BODY = UserDocumentStore.MAX_BYTES;

  private final ECoreLifecycle ecore;
  private final CurrentUser currentUser;
  private final AdminAccess admin;

  DisplayController(ECoreLifecycle ecore, CurrentUser currentUser, AdminAccess admin) {
    this.ecore = ecore;
    this.currentUser = currentUser;
    this.admin = admin;
  }

  @GetMapping(PATH)
  DeferredResult<ResponseEntity<?>> get(HttpServletRequest request) {
    User user = currentUser.of(request);
    if (user == null) {
      return done(problem(HttpStatus.UNAUTHORIZED, "not logged in"));
    }
    DisplaySettings display = ecore.core().display();
    return call(answer -> display.choices(user.id(), answer), found -> {
      ObjectNode both = JsonNodeFactory.instance.objectNode();
      both.set("choices", ecore.core().json().parse(found.json()));
      both.set("defaults", display.defaults());
      return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.APPLICATION_JSON).body(both.toString());
    });
  }

  @PutMapping(PATH)
  DeferredResult<ResponseEntity<?>> put(HttpServletRequest request) throws IOException {
    User user = currentUser.of(request);
    if (user == null) {
      return done(problem(HttpStatus.UNAUTHORIZED, "not logged in"));
    }
    Object body = body(request);
    if (body instanceof ResponseEntity<?> refused) {
      return done(refused);
    }
    return call(answer -> ecore.core().display().setChoices(user.id(), (JsonNode) body, answer), null);
  }

  @PutMapping(DEFAULTS_PATH)
  ResponseEntity<?> putDefaults(HttpServletRequest request) throws IOException {
    ResponseEntity<?> denied = admin.denied(request);
    if (denied != null) {
      return denied;
    }
    Object body = body(request);
    if (body instanceof ResponseEntity<?> refused) {
      return refused;
    }
    DisplaySettings display = ecore.core().display();
    try {
      display.setDefaults((JsonNode) body);
    } catch (IllegalArgumentException e) {
      // As every settings call: the problems per JSON Pointer (SettingsController).
      return ResponseEntity.badRequest().body(new SettingsController.Refused(List.of(new Problem("", String.valueOf(e.getMessage())))));
    }
    return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("defaults", display.defaults()));
  }

  /** The body as JSON, or the answer that refuses it. */
  private Object body(HttpServletRequest request) throws IOException {
    byte[] bytes = request.getInputStream().readNBytes(MAX_BODY + 1);
    if (bytes.length > MAX_BODY) {
      return problem(HttpStatus.CONTENT_TOO_LARGE, "the request body has more than " + MAX_BODY + " bytes");
    }
    String text;
    try {
      text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
          .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(bytes)).toString();
    } catch (CharacterCodingException e) {
      return problem(HttpStatus.BAD_REQUEST, "the body is not UTF-8");
    }
    try {
      return ecore.core().json().parse(text);
    } catch (InvalidDocumentException e) {
      return problem(HttpStatus.BAD_REQUEST, "the body is not JSON: " + e.getMessage());
    }
  }

  /**
   * Starts {@code start} and answers with its one result: {@code found} for {@link Result.Found},
   * {@code 204} for {@link Result.Written}, else the problem.
   */
  private static DeferredResult<ResponseEntity<?>> call(Consumer<Consumer<Result>> start,
      @Nullable Function<Result.Found, ResponseEntity<?>> found) {
    DeferredResult<ResponseEntity<?>> result = new DeferredResult<>(UserDocuments.ANSWER_WITHIN.toMillis(),
        (Object) problem(HttpStatus.GATEWAY_TIMEOUT, "no answer within " + UserDocuments.ANSWER_WITHIN.toSeconds() + " s"));
    start.accept(answer -> {
      ResponseEntity<?> response;
      try {
        response = answer instanceof Result.Found f && found != null ? found.apply(f) : response(answer);
      } catch (RuntimeException e) {
        response = problem(HttpStatus.INTERNAL_SERVER_ERROR, "the display settings could not be read");
      }
      result.setResult(response);
    });
    return result;
  }

  private static ResponseEntity<?> response(Result answer) {
    return switch (answer) {
      case Result.Written written -> ResponseEntity.noContent().build();
      case Result.Refused refused -> problem(switch (refused.reason()) {
        case INVALID, UNKNOWN_NAMESPACE -> HttpStatus.BAD_REQUEST;
        case TOO_LARGE -> HttpStatus.CONTENT_TOO_LARGE;
        case USER_FULL -> HttpStatus.INSUFFICIENT_STORAGE;
        case TOO_MANY -> HttpStatus.CONFLICT;
      }, refused.message());
      case Result.Busy busy -> problem(HttpStatus.SERVICE_UNAVAILABLE, "busy; try again");
      case Result.Failed failed -> problem(HttpStatus.INTERNAL_SERVER_ERROR, failed.reason());
      case Result.Found f -> problem(HttpStatus.INTERNAL_SERVER_ERROR, "an answer the call does not give");
      case Result.Names n -> problem(HttpStatus.INTERNAL_SERVER_ERROR, "an answer the call does not give");
      case Result.Missing m -> problem(HttpStatus.INTERNAL_SERVER_ERROR, "an answer the call does not give");
    };
  }

  private static ResponseEntity<?> problem(HttpStatus status, String problem) {
    return ResponseEntity.status(status).cacheControl(CacheControl.noStore()).body(Map.of("problem", problem));
  }

  private static DeferredResult<ResponseEntity<?>> done(ResponseEntity<?> response) {
    DeferredResult<ResponseEntity<?>> result = new DeferredResult<>();
    result.setResult(response);
    return result;
  }
}
