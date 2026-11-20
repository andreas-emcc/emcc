package dev.emcc.ecore.plugin;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;
import org.jspecify.annotations.Nullable;

/**
 * The converter's check when ECore starts (M9 C5; owner, 2026-11-17): an admin may give an ffmpeg of their own (CR-0045,
 * {@code emc2.conversions.ffmpeg}), so ECore asks it once for its version and whether it has what a conversion needs:
 * the {@code h264_mf} encoder, the {@code mpeg2video} decoder, and {@code mpegts} both ways. Each run has an empty
 * environment, a folder of its own and {@link #TIMEOUT_SECONDS}, its output in a file there, so no thread is needed.
 *
 * <p>SDK 1.9.0 (CR-0050 point 1, the MCA's B4; M9 C10): an encoder needs besides {@code h264_mf} the {@code rawvideo}
 * demuxer and decoder, the {@code h264} muxer and the {@code h264_metadata} bitstream filter. What it lacks of these
 * makes only encoders unavailable ({@link Result#encoderProblem}): an older converter still converts MPEG-2.
 */
final class ConverterCheck {

  static final int TIMEOUT_SECONDS = 10;

  /**
   * What the check found: the converter's version line, what conversions miss and what encoders miss ({@code null}:
   * nothing). An encoder also needs what a conversion needs of {@code h264_mf}, so a missing {@code h264_mf} is both.
   */
  record Result(String version, @Nullable String problem, @Nullable String encoderProblem) {}

  /** Runs one command and gives its whole output (stdout and stderr), or throws. Tests give their own. */
  @FunctionalInterface
  interface Runner {
    String run(List<String> command) throws IOException;
  }

  private ConverterCheck() {}

  static Result check(Path ffmpeg, Runner runner) {
    String exe = ffmpeg.toAbsolutePath().toString();
    try {
      String version = firstLine(runner.run(List.of(exe, "-hide_banner", "-version")));
      List<String> missing = new ArrayList<>();
      List<String> encoderMissing = new ArrayList<>();
      if (!listed(runner.run(List.of(exe, "-hide_banner", "-encoders")), "h264_mf", null)) {
        missing.add("the h264_mf encoder");
        encoderMissing.add("the h264_mf encoder");
      }
      String decoders = runner.run(List.of(exe, "-hide_banner", "-decoders"));
      if (!listed(decoders, "mpeg2video", null)) {
        missing.add("the mpeg2video decoder");
      }
      if (!listed(decoders, "rawvideo", null)) {
        encoderMissing.add("the rawvideo decoder");
      }
      String formats = runner.run(List.of(exe, "-hide_banner", "-formats"));
      if (!listed(formats, "mpegts", 'D')) {
        missing.add("the mpegts demuxer");
      }
      if (!listed(formats, "mpegts", 'E')) {
        missing.add("the mpegts muxer");
      }
      if (!listed(formats, "rawvideo", 'D')) {
        encoderMissing.add("the rawvideo demuxer");
      }
      if (!listed(formats, "h264", 'E')) {
        encoderMissing.add("the h264 muxer");
      }
      if (!named(runner.run(List.of(exe, "-hide_banner", "-bsfs")), "h264_metadata")) {
        encoderMissing.add("the h264_metadata bitstream filter");
      }
      return new Result(version, missing.isEmpty() ? null : "the converter " + exe + " has no " + String.join(", no ", missing),
          encoderMissing.isEmpty() ? null : "the converter " + exe + " has no " + String.join(", no ", encoderMissing));
    } catch (IOException | RuntimeException e) {
      String problem = "the converter " + exe + " did not answer: " + ConversionHub.printable(String.valueOf(e.getMessage()));
      return new Result("", problem, problem);
    }
  }

  /** Whether a plain listing (ffmpeg's {@code -bsfs}: a heading, then one name a line) names {@code name}. */
  static boolean named(String listing, String name) {
    return listing.lines().skip(1).anyMatch(line -> line.strip().equals(name));
  }

  /**
   * Whether a listing (after its {@code ---} line) has {@code name} as its second column; with {@code flag}, also with
   * that letter in its first column (the formats' D for demuxing, E for muxing, over all lines of the name).
   */
  static boolean listed(String listing, String name, @Nullable Character flag) {
    boolean after = false;
    for (String line : listing.split("\\R")) {
      String t = line.strip();
      if (!after) {
        after = t.startsWith("---");
        continue;
      }
      String[] cols = t.split("\\s+");
      if (cols.length >= 2 && cols[1].equals(name) && (flag == null || cols[0].indexOf(flag) >= 0)) {
        return true;
      }
    }
    return false;
  }

  private static String firstLine(String text) {
    String first = text.strip().lines().findFirst().orElse("");
    if (!first.toLowerCase(Locale.ROOT).startsWith("ffmpeg version")) {
      throw new IllegalStateException("not ffmpeg: " + first);
    }
    return first;
  }

  /** The real run: an empty environment, a folder of its own, the output in a file there; killed after the timeout. */
  static String run(List<String> command) throws IOException {
    Path folder = Files.createTempDirectory("emcc-conversion-check-");
    try {
      Path out = folder.resolve("out.txt");
      ProcessBuilder pb = new ProcessBuilder(command).directory(folder.toFile()).redirectErrorStream(true)
          .redirectOutput(out.toFile()).redirectInput(ProcessBuilder.Redirect.from(nullFile()));
      pb.environment().clear();
      Process p = pb.start();
      try {
        if (!p.waitFor(TIMEOUT_SECONDS, TimeUnit.SECONDS)) {
          p.destroyForcibly();
          p.waitFor(1, TimeUnit.SECONDS); // so that its folder is free to remove (Windows)
          throw new IOException("no answer within " + TIMEOUT_SECONDS + " s");
        }
      } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
        p.destroyForcibly();
        throw new IOException("interrupted");
      }
      try (InputStream in = Files.newInputStream(out)) {
        return new String(in.readNBytes(1 << 20), StandardCharsets.UTF_8); // at most 1 MiB, whatever it wrote
      }
    } finally {
      delete(folder);
    }
  }

  private static java.io.File nullFile() {
    return new java.io.File(ConversionLimits.windows() ? "NUL" : "/dev/null");
  }

  /** Removes a folder of the converter's and what is in it; what cannot be removed stays (logged by the caller). */
  static boolean delete(Path folder) {
    if (!Files.exists(folder)) {
      return true;
    }
    try (Stream<Path> all = Files.walk(folder)) {
      for (Path p : all.sorted(Comparator.reverseOrder()).toList()) {
        Files.deleteIfExists(p);
      }
      return true;
    } catch (IOException e) {
      return false;
    }
  }
}
