package dev.emcc.plugins.template.transport;

/** Why a run or a socket ended, as the status and the monitor view show it. */
final class Reason {

  private Reason() {}

  static String of(Throwable e) {
    return e.getMessage() == null ? e.toString() : e.getMessage();
  }
}
