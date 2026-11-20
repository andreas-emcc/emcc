package dev.emcc.sdk.stream;

import java.time.Instant;
import java.util.Objects;

/**
 * SDK 1.8.0 (CR-0044 E2): what happened to a conversion, reported to the worker given to {@link
 * Conversions#start}. Always delivered, in order. {@code Stopped} and {@code Failed} are its last.
 *
 * <pre>{@code
 * switch (event) {
 *   case ConversionEvent.Waiting w -> status.waiting(w.stream());     // "Waiting for a conversion slot"
 *   case ConversionEvent.Running r -> status.converting(r.stream());
 *   case ConversionEvent.Stopped s -> status.stopped(s.stream());
 *   case ConversionEvent.Failed f -> status.failed(f.stream(), f.failure());   // start again after RETRY_AFTER
 * }
 * }</pre>
 */
public sealed interface ConversionEvent permits ConversionEvent.Waiting, ConversionEvent.Running, ConversionEvent.Stopped, ConversionEvent.Failed {

  /** The target stream's name. */
  String stream();

  /** When it happened. */
  Instant at();

  /** Why a conversion failed. */
  enum Failure {
    /** No converter is installed (the release has no ffmpeg, or the setting names none). */
    UNAVAILABLE,
    /** No output {@link Conversions#START_TIMEOUT} after its first input. */
    START,
    /** No output for {@link Conversions#STALL_TIMEOUT} while input arrived. */
    STALLED,
    /** The process ended by itself. */
    EXITED
  }

  /** No slot is free; it takes the next one. Its input is dropped meanwhile. */
  record Waiting(String stream, Instant at) implements ConversionEvent {
    public Waiting {
      Objects.requireNonNull(stream, "stream");
      Objects.requireNonNull(at, "at");
    }
  }

  /** It has a slot and its process runs. */
  record Running(String stream, Instant at) implements ConversionEvent {
    public Running {
      Objects.requireNonNull(stream, "stream");
      Objects.requireNonNull(at, "at");
    }
  }

  /**
   * It ended without failing.
   *
   * @param reason e.g. "stopped" ({@link ConversionRef#stop}), "stream closed" or "plugin stopped"
   */
  record Stopped(String stream, Instant at, String reason) implements ConversionEvent {
    public Stopped {
      Objects.requireNonNull(stream, "stream");
      Objects.requireNonNull(at, "at");
      Objects.requireNonNull(reason, "reason");
    }
  }

  /**
   * It ended because it failed; ECore does not restart it.
   *
   * @param detail what ECore knows more, e.g. the process's exit code; may be empty
   */
  record Failed(String stream, Instant at, Failure failure, String detail) implements ConversionEvent {
    public Failed {
      Objects.requireNonNull(stream, "stream");
      Objects.requireNonNull(at, "at");
      Objects.requireNonNull(failure, "failure");
      Objects.requireNonNull(detail, "detail");
    }
  }
}
