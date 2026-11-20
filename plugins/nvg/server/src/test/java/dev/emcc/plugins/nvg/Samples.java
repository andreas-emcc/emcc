package dev.emcc.plugins.nvg;

import dev.emcc.sdk.Bytes;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.util.Objects;

/** Test resources as bytes. */
public final class Samples {

  private Samples() {}

  public static Bytes resource(String path) {
    try (InputStream in = Objects.requireNonNull(Samples.class.getResourceAsStream(path), path)) {
      return Bytes.of(in.readAllBytes());
    } catch (IOException e) {
      throw new UncheckedIOException(e);
    }
  }

  /** The hand-written sample with every element (brief, section 7). */
  public static Bytes everyElement() {
    return resource("/samples/every-element.nvg");
  }

  /** A minimal document of {@code version} around {@code body}. */
  public static Bytes doc(String version, String body) {
    return Bytes.utf8("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<nvg xmlns=\"https://tide.act.nato.int/schemas/2012/10/nvg\" version=\""
        + version + "\">" + body + "</nvg>");
  }

  public static Bytes doc(String body) {
    return doc("2.0.2", body);
  }
}
