package dev.emcc.app;

/**
 * Ends the JVM after a requested stop. The server uses {@link System#exit(int)}; tests register a
 * bean of this type instead, so the test JVM keeps running.
 */
@FunctionalInterface
interface JvmExit {

  void exit(int status);
}
