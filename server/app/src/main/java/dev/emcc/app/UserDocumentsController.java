package dev.emcc.app;

import dev.emcc.ecore.UserDocuments;
import dev.emcc.ecore.json.InvalidDocumentException;
import dev.emcc.ecore.persistence.UserDocumentStore.Result;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.ByteBuffer;
import java.nio.charset.CharacterCodingException;
import java.nio.charset.CodingErrorAction;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import org.jspecify.annotations.Nullable;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.context.request.async.DeferredResult;
import tools.jackson.databind.JsonNode;

/**
 * The user's own documents (ADR-0027; CR-0015 item 17, web parts): {@code GET
 * /api/user-documents/{namespace}} lists the names, {@code GET}, {@code PUT} and {@code DELETE
 * /api/user-documents/{namespace}/{name}} read, write and remove one. Always the login session's
 * user (in the no-login mode the local user), never another; the namespace is {@code core} (the
 * shell) or a running plugin with a web part, as the shell names it for the calling web part.
 *
 * <p>Answers: a document as its JSON; the names as {@code {"names": [...]}}; {@code 204} for a
 * write or removal; {@code 404} for a missing document or an unknown namespace; {@code 400} for a
 * bad name or a body that is not UTF-8 JSON; {@code 413} for a document over the size limit (also a
 * body over {@value #MAX_BODY} bytes as sent); {@code 507} when the user's documents in all would be
 * over theirs; {@code 409} with the most documents in the namespace; {@code
 * 500} when the store fails (the detail is in the server log only); {@code 503} when ECore is busy;
 * {@code 504} without an answer in time (the call may still be done later: the last write wins);
 * {@code 401} without login. Problems as {@code {"problem": "..."}}.
 */
@RestController
@RequestMapping(UserDocumentsController.PATH)
class UserDocumentsController {

  static final String PATH = "/api/user-documents";
  /** The most a request body may have, white space included; the document itself is limited by ECore. */
  static final int MAX_BODY = 1024 * 1024;

  private final ECoreLifecycle ecore;
  private final CurrentUser currentUser;

  UserDocumentsController(ECoreLifecycle ecore, CurrentUser currentUser) {
    this.ecore = ecore;
    this.currentUser = currentUser;
  }

  @GetMapping("/{namespace}")
  DeferredResult<ResponseEntity<?>> list(@PathVariable("namespace") String namespace, HttpServletRequest request) {
    return call(UserDocuments.Kind.LIST, namespace, null, null, request);
  }

  @GetMapping("/{namespace}/{name}")
  DeferredResult<ResponseEntity<?>> get(@PathVariable("namespace") String namespace, @PathVariable("name") String name,
      HttpServletRequest request) {
    return call(UserDocuments.Kind.GET, namespace, name, null, request);
  }

  @PutMapping("/{namespace}/{name}")
  DeferredResult<ResponseEntity<?>> put(@PathVariable("namespace") String namespace, @PathVariable("name") String name,
      HttpServletRequest request) throws IOException {
    byte[] body = request.getInputStream().readNBytes(MAX_BODY + 1);
    if (body.length > MAX_BODY) {
      return done(problem(HttpStatus.CONTENT_TOO_LARGE, "the request body has more than " + MAX_BODY + " bytes"));
    }
    String text;
    try {
      // Strict: a body that is not UTF-8 is refused, never repaired with replacement characters.
      text = StandardCharsets.UTF_8.newDecoder().onMalformedInput(CodingErrorAction.REPORT)
          .onUnmappableCharacter(CodingErrorAction.REPORT).decode(ByteBuffer.wrap(body)).toString();
    } catch (CharacterCodingException e) {
      return done(problem(HttpStatus.BAD_REQUEST, "the body is not UTF-8"));
    }
    JsonNode value;
    try {
      value = ecore.core().json().parse(text);
    } catch (InvalidDocumentException e) {
      return done(problem(HttpStatus.BAD_REQUEST, "the body is not JSON: " + e.getMessage()));
    }
    return call(UserDocuments.Kind.PUT, namespace, name, value, request);
  }

  @DeleteMapping("/{namespace}/{name}")
  DeferredResult<ResponseEntity<?>> delete(@PathVariable("namespace") String namespace, @PathVariable("name") String name,
      HttpServletRequest request) {
    return call(UserDocuments.Kind.DELETE, namespace, name, null, request);
  }

  private DeferredResult<ResponseEntity<?>> call(UserDocuments.Kind kind, String namespace, @Nullable String name, @Nullable JsonNode value,
      HttpServletRequest request) {
    User user = currentUser.of(request);
    if (user == null) {
      return done(problem(HttpStatus.UNAUTHORIZED, "not logged in"));
    }
    DeferredResult<ResponseEntity<?>> result = new DeferredResult<>(UserDocuments.ANSWER_WITHIN.toMillis(),
        (Object) problem(HttpStatus.GATEWAY_TIMEOUT, "no answer within " + UserDocuments.ANSWER_WITHIN.toSeconds() + " s"));
    ecore.core().userDocuments().call(new UserDocuments.Call(kind, user.id(), namespace, name, value), answer -> result.setResult(response(answer)));
    return result;
  }

  private static ResponseEntity<?> response(Result answer) {
    return switch (answer) {
      case Result.Found found -> ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.APPLICATION_JSON).body(found.json());
      case Result.Names names -> ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(Map.of("names", List.copyOf(names.names())));
      case Result.Written written -> ResponseEntity.noContent().build();
      case Result.Missing missing -> problem(HttpStatus.NOT_FOUND, "no such document");
      case Result.Refused refused -> problem(switch (refused.reason()) {
        case INVALID -> HttpStatus.BAD_REQUEST;
        case UNKNOWN_NAMESPACE -> HttpStatus.NOT_FOUND;
        case TOO_LARGE -> HttpStatus.CONTENT_TOO_LARGE;
        case USER_FULL -> HttpStatus.INSUFFICIENT_STORAGE;
        case TOO_MANY -> HttpStatus.CONFLICT;
      }, refused.message());
      case Result.Busy busy -> problem(HttpStatus.SERVICE_UNAVAILABLE, "busy; try again");
      case Result.Failed failed -> problem(HttpStatus.INTERNAL_SERVER_ERROR, failed.reason());
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
