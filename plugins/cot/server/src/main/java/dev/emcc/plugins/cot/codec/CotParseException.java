package dev.emcc.plugins.cot.codec;

/** A CoT event that cannot be read: not well-formed XML, a DTD, or a missing or invalid required part. */
public final class CotParseException extends Exception {

  private static final long serialVersionUID = 1L;

  public CotParseException(String message) {
    super(message);
  }

  public CotParseException(String message, Throwable cause) {
    super(message, cause);
  }
}
