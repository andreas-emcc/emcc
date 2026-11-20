package dev.emcc.service;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;

/**
 * Calls the entry as procrun's jvm mode does, in a JVM of its own: {@link Service#start} on one thread, then, when a line
 * comes on standard input, {@link Service#stop} on another (ServiceStopTest).
 */
public final class ProcrunHarness {

  private ProcrunHarness() {}

  public static void main(String[] args) throws IOException {
    Thread.ofPlatform().name("procrun-start").start(() -> Service.start(args));
    BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
    if (in.readLine() != null) {
      Thread.ofPlatform().name("procrun-stop").start(() -> Service.stop(new String[0]));
    }
  }
}
