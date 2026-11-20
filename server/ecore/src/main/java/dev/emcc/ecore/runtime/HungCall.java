package dev.emcc.ecore.runtime;

/**
 * What a hung handler call was doing, so that a hang can be traced (MCA, 2026-10-16: the object
 * store over its budget once under load, with nothing in the log to say which call).
 *
 * @param message the type of the message being handled, e.g. {@code StoreMsg.GetArea}, never its
 *     content; "(making the message)" while a mapped message is still being made
 * @param gcMillis the JVM's garbage collection time during the call so far (a pause of the whole
 *     JVM, not slow work of the call), counted from the watchdog's last sample before the call, so it
 *     may include up to one watchdog interval before it; {@link #GC_UNKNOWN} if it could not be read
 * @param gcFromStart false if the GC samples do not reach back to the call's start: then the call had
 *     at least {@code gcMillis}
 */
public record HungCall(String message, long gcMillis, boolean gcFromStart) {

  /** {@link #gcMillis} when the JVM's GC time could not be read. */
  public static final long GC_UNKNOWN = -1;

  /** For the log, e.g. "handling StoreMsg.GetArea; 4870 ms of it JVM garbage collection". */
  public String text() {
    if (gcMillis == GC_UNKNOWN) {
      return "handling " + message + "; JVM garbage collection time unknown";
    }
    return "handling " + message + "; " + (gcFromStart ? "" : "at least ") + gcMillis + " ms of it JVM garbage collection";
  }

  /** A message type as the log names it: without its package, nested types with a dot. Built only for a report. */
  static String typeName(Class<?> type) {
    String name = type.getName();
    return name.substring(name.lastIndexOf('.') + 1).replace('$', '.');
  }
}
