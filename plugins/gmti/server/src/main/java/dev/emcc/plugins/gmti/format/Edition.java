package dev.emcc.plugins.gmti.format;

import org.jspecify.annotations.Nullable;

/**
 * The STANAG 4607 edition an {@code out} link writes, its setting {@code edition} (M9.1; owner, 2026-11-20:
 * Edition 3 by default). Both editions have the same bytes (FORMAT-RULES G18); what differs in what gmti
 * writes is {@code P1}, and {@code P10} in a packet without a dwell.
 */
public enum Edition {

  /**
   * STANAG 4607 Edition 3 (2010): {@code P1} "30". A packet without a dwell keeps its job's {@code P10}, which
   * Edition 3 allows ("the task to which the packet pertains"), as gmti sent before M9.1.
   */
  EDITION_3("edition-3", "30", false),

  /**
   * AEDP-4607 Edition A Version 1 (STANAG 4607 Edition 4, 2024): {@code P1} "41". A packet without a dwell, HRR
   * or range-Doppler segment has {@code P10} 0 (AEDP 3.1.10).
   */
  EDITION_4("edition-4", "41", true);

  private final String setting;
  private final String version;
  private final boolean jobIdOnlyWithADwell;

  Edition(String setting, String version, boolean jobIdOnlyWithADwell) {
    this.setting = setting;
    this.version = version;
    this.jobIdOnlyWithADwell = jobIdOnlyWithADwell;
  }

  /** The link setting's value, e.g. "edition-3". */
  public String setting() {
    return setting;
  }

  /** {@code P1}: "30" or "41". */
  public String version() {
    return version;
  }

  /** Whether a packet without a dwell has {@code P10} 0. */
  public boolean jobIdOnlyWithADwell() {
    return jobIdOnlyWithADwell;
  }

  /** The edition a link setting names, or {@code null}. */
  public static @Nullable Edition of(String setting) {
    for (Edition e : values()) {
      if (e.setting.equals(setting)) {
        return e;
      }
    }
    return null;
  }

  /** Whether {@code P1} is one gmti writes, "30" or "41"; others are read by their masks too, and logged once per link. */
  public static boolean written(String version) {
    for (Edition e : values()) {
      if (e.version.equals(version)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Whether {@code P1} names Edition A or later: its first digit 4 or more, the edition letter as a number (AEDP 3.1.1:
   * A is 4). "30", "21" and older are Edition 3 or before.
   */
  public static boolean editionAOrLater(String version) {
    return !version.isEmpty() && version.charAt(0) >= '4' && version.charAt(0) <= '9';
  }
}
