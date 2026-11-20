package dev.emcc.ecore.json;

import java.io.Serial;
import java.util.List;

/** A document is not valid JSON, breaks its JSON Schema, or cannot be mapped to its model type. */
public final class InvalidDocumentException extends IllegalArgumentException {

  @Serial private static final long serialVersionUID = 1L;

  /** Problems kept in a rejection's details are limited, like there (change-rejection schema). */
  public static final int MAX_PROBLEMS = 50;

  private final transient List<Problem> problems;

  public InvalidDocumentException(String message, List<Problem> problems) {
    super(message + (problems.isEmpty() ? "" : ": " + problems.getFirst().path() + " " + problems.getFirst().problem()));
    this.problems = List.copyOf(problems.size() > MAX_PROBLEMS ? problems.subList(0, MAX_PROBLEMS) : problems);
  }

  /** What is wrong where, at most {@value #MAX_PROBLEMS} entries. */
  public List<Problem> problems() {
    return problems;
  }
}
