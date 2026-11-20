package dev.emcc.plugins.terrain;

/** A DTED file that does not read as the cell its name says; the message is for the log. */
final class DtedException extends RuntimeException {

  private static final long serialVersionUID = 1L;

  DtedException(String message) {
    super(message);
  }
}
