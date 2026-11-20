package dev.emcc.plugins.gmti.in;

import dev.emcc.plugins.gmti.format.Edition;
import java.util.Locale;
import java.util.Map;
import org.jspecify.annotations.Nullable;

/**
 * The target classes of {@code D32.10} (AEDP 3.4.32.10, Table 3-11): 0 to 127 live, 128 to 255
 * simulated. Table 3-11 itself is the source: 1 and 129 are <b>tracked</b> vehicles, 2 and 130
 * <b>wheeled</b> (the brief's Q8 table has these two the other way round; the standard wins, brief
 * line 5). An unknown value keeps its number ("reserved (n)", reference 3.6).
 */
public final class Classes {

  /** The live classes with a name; the simulated ones are named by {@link #SIMULATED}. */
  private static final Map<Integer, String> LIVE = Map.ofEntries(
      Map.entry(0, "no information"),
      Map.entry(1, "tracked vehicle"),
      Map.entry(2, "wheeled vehicle"),
      Map.entry(3, "rotary wing aircraft"),
      Map.entry(4, "fixed wing aircraft"),
      Map.entry(5, "stationary rotator"),
      Map.entry(6, "maritime"),
      Map.entry(7, "beacon"),
      Map.entry(8, "amphibious"),
      Map.entry(9, "person"),
      Map.entry(10, "vehicle"),
      Map.entry(11, "animal"),
      Map.entry(12, "large multiple-return, land"),
      Map.entry(13, "large multiple-return, maritime"),
      Map.entry(14, "clutter"),
      Map.entry(15, "phantom"),
      Map.entry(16, "ground rotator"),
      Map.entry(17, "small vehicle"),
      Map.entry(18, "low-slow flyer"),
      Map.entry(126, "other"),
      Map.entry(127, "unknown"));

  /** The simulated classes: the live value + 128 for 0 to 13, then their own (Table 3-11). */
  private static final Map<Integer, String> SIMULATED = Map.ofEntries(
      Map.entry(142, "tagging device"),
      Map.entry(144, "clutter"),
      Map.entry(145, "phantom"),
      Map.entry(146, "ground rotator"),
      Map.entry(147, "small vehicle"),
      Map.entry(148, "low-slow flyer"),
      Map.entry(254, "other"),
      Map.entry(255, "unknown"));

  /** What a class is drawn as (the brief's Q8). */
  public enum Kind { TRACKED, WHEELED, ROTARY_WING, FIXED_WING, SURFACE_VESSEL, GROUND_TRACK }

  private Classes() {}

  /**
   * The class's name with its number as the packet's edition ({@code P1}) defines it (M9.1). Edition 3 and older print the
   * tagging device as 143 (their table lists no 142, and 143 also opens the reserved range); Edition A moved it to 142 and
   * reserved 143. Every other value means the same in both.
   */
  public static String name(int value, String version) {
    if (value == 143 && !Edition.editionAOrLater(version)) {
      return "tagging device, simulated (143)";
    }
    return name(value);
  }

  /** The class's name with its number in Edition A, e.g. "wheeled vehicle, simulated (130)". */
  public static String name(int value) {
    String name = base(value);
    if (name == null) {
      return "reserved (" + value + ")";
    }
    return name + (value >= 128 ? ", simulated" : "") + " (" + value + ")";
  }

  /** The class's kind, live or simulated alike; anything else, or none, is a ground track. */
  public static Kind kind(@Nullable Integer value) {
    if (value == null) {
      return Kind.GROUND_TRACK;
    }
    int live = value >= 128 && value <= 141 ? value - 128 : value;
    return switch (live) {
      case 1 -> Kind.TRACKED;
      case 2 -> Kind.WHEELED;
      case 3 -> Kind.ROTARY_WING;
      case 4 -> Kind.FIXED_WING;
      case 6, 13 -> Kind.SURFACE_VESSEL; // maritime, and large multiple-return maritime
      default -> Kind.GROUND_TRACK;
    };
  }

  private static @Nullable String base(int value) {
    if (value < 128) {
      return LIVE.get(value);
    }
    if (value <= 141) {
      return LIVE.get(value - 128);
    }
    String s = SIMULATED.get(value);
    return s == null ? null : s.toLowerCase(Locale.ROOT);
  }
}
