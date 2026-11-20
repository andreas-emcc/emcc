package dev.emcc.plugins.gmti.format;

import java.time.DateTimeException;
import java.time.LocalDate;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * The mission segment, 39 bytes (AEDP 3.3, Table 3-7). Its date is the reference day of every time
 * in the format (Annex C-3).
 *
 * @param missionPlan {@code M1}, empty when none
 * @param flightPlan {@code M2}, empty when none
 * @param platformType {@code M3} (Table 3-8): 0 unidentified, 255 other
 * @param platformConfiguration {@code M4}
 * @param year {@code M5}
 * @param month {@code M6}, 1 to 12
 * @param day {@code M7}, 1 to 31
 */
public record Mission(String missionPlan, String flightPlan, int platformType, String platformConfiguration, int year, int month, int day)
    implements Segment {

  /** The body's size in bytes. */
  public static final int SIZE = 39;

  public Mission {
    Objects.requireNonNull(missionPlan, "missionPlan");
    Objects.requireNonNull(flightPlan, "flightPlan");
    Objects.requireNonNull(platformConfiguration, "platformConfiguration");
  }

  /** A mission on {@code day}. */
  public static Mission on(LocalDate day, int platformType, String missionPlan, String platformConfiguration) {
    return new Mission(missionPlan, "", platformType, platformConfiguration, day.getYear(), day.getMonthValue(), day.getDayOfMonth());
  }

  @Override
  public int type() {
    return MISSION;
  }

  /** The reference day (UTC), or {@code null} when {@code M5}–{@code M7} are not a date (a value out of range). */
  public @Nullable LocalDate referenceDay() {
    try {
      return LocalDate.of(year, month, day);
    } catch (DateTimeException e) {
      return null;
    }
  }
}
