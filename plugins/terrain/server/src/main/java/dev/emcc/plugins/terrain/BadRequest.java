package dev.emcc.plugins.terrain;

/** A request body that is not what the endpoint takes; the message is the reason, in English, for the answer's {@code error}. */
final class BadRequest extends RuntimeException {

  private static final long serialVersionUID = 1L;

  BadRequest(String message) {
    super(message);
  }
}
