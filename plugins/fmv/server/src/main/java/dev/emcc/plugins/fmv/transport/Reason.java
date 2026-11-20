package dev.emcc.plugins.fmv.transport;

/** Why a run ended, as the status and the monitor view show it. */
final class Reason {

  private Reason() {}

  static String of(Throwable e) {
    return e.getMessage() == null ? e.toString() : e.getMessage();
  }
}
