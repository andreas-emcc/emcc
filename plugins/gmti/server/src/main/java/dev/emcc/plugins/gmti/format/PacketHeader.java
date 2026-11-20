package dev.emcc.plugins.gmti.format;

import java.util.Objects;

/**
 * The packet header, 32 bytes (AEDP 3.1, Table 3-1). The packet size {@code P2} is not kept: the
 * decoder checks it and the encoder writes it.
 *
 * @param version {@code P1}, two characters as received: "41" is Edition A Version 1, "30" and "21" older
 * @param nationality {@code P3}, a digraph, e.g. "XN" for NATO
 * @param classification {@code P4}: 1 top secret … 5 unclassified (Table 3-2); other values as received
 * @param classificationSystem {@code P5}: the scheme of {@code P4}, e.g. "XN"; empty when none
 * @param securityCode {@code P6}: releasability bits (Table 3-4), as received
 * @param exercise {@code P7}: 0 to 2 operation, 128 to 130 exercise (Table 3-5)
 * @param platformId {@code P8}, without padding
 * @param missionId {@code P9}, unsigned
 * @param jobId {@code P10}, unsigned; 0 when the packet has no dwell or HRR segment
 */
public record PacketHeader(
    String version,
    String nationality,
    int classification,
    String classificationSystem,
    int securityCode,
    int exercise,
    String platformId,
    long missionId,
    long jobId) {

  /** The version this plugin writes (Edition A Version 1). */
  public static final String VERSION = "41";

  public PacketHeader {
    Objects.requireNonNull(version, "version");
    Objects.requireNonNull(nationality, "nationality");
    Objects.requireNonNull(classificationSystem, "classificationSystem");
    Objects.requireNonNull(platformId, "platformId");
  }

  /** Whether {@code P7} says the data is simulated or synthesized (1, 2, 129, 130). */
  public boolean simulated() {
    return exercise == 1 || exercise == 2 || exercise == 129 || exercise == 130;
  }

  /** Whether {@code P7} says the packet belongs to an exercise (128 to 130). */
  public boolean isExercise() {
    return exercise >= 128 && exercise <= 130;
  }
}
