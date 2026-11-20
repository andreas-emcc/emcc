package dev.emcc.sdk.model;

import java.util.Objects;
import java.util.regex.Pattern;
import org.jspecify.annotations.Nullable;

/**
 * An APP-6 symbol, or (SDK 1.4.0) a vessel symbol. The SIDC's form per standard is checked by the
 * schema (model README, "Conventions"); a vessel's code also here, since its accessors read it.
 *
 * <pre>{@code
 * new Symbol(SymbolStandard.APP_6D, "10031000001211000000",
 *     Modifiers.builder().text(TextModifier.UNIQUE_DESIGNATION, "1").direction(45).build())
 * }</pre>
 *
 * <p><b>Vessel symbols</b> (SDK 1.4.0, ADR-0047): {@code sidc} holds 4 digits: APP-6D's context (0
 * reality, 1 exercise, 2 simulation), APP-6D's standard identity (0 pending to 6 hostile), then the
 * AIS ship and cargo type 00 to 99. {@code symbology} draws them, filled by ship-type group.
 *
 * <pre>{@code
 * Symbol.vessel(Symbol.IDENTITY_NEUTRAL, 70, Modifiers.builder().direction(212.5).speed(6.4).build())   // "0470"
 * }</pre>
 *
 * @param standard the APP-6 edition, or {@link SymbolStandard#VESSEL}
 * @param sidc the symbol identification code
 * @param modifiers the amplifiers, or {@code null} for none
 */
public record Symbol(SymbolStandard standard, String sidc, @Nullable Modifiers modifiers) {

  private static final String TEN_ZEROS = "0000000000";
  private static final Pattern VESSEL_CODE = Pattern.compile("[0-2][0-6][0-9]{2}");

  /** SDK 1.4.0: APP-6D's context digit: reality. */
  public static final int CONTEXT_REALITY = 0;
  /** SDK 1.4.0: APP-6D's context digit: exercise. */
  public static final int CONTEXT_EXERCISE = 1;
  /** SDK 1.4.0: APP-6D's context digit: simulation. */
  public static final int CONTEXT_SIMULATION = 2;

  /** SDK 1.4.0: APP-6D's standard identity digit: pending. */
  public static final int IDENTITY_PENDING = 0;
  /** SDK 1.4.0: APP-6D's standard identity digit: unknown. */
  public static final int IDENTITY_UNKNOWN = 1;
  /** SDK 1.4.0: APP-6D's standard identity digit: assumed friend. */
  public static final int IDENTITY_ASSUMED_FRIEND = 2;
  /** SDK 1.4.0: APP-6D's standard identity digit: friend. */
  public static final int IDENTITY_FRIEND = 3;
  /** SDK 1.4.0: APP-6D's standard identity digit: neutral. */
  public static final int IDENTITY_NEUTRAL = 4;
  /** SDK 1.4.0: APP-6D's standard identity digit: suspect. */
  public static final int IDENTITY_SUSPECT = 5;
  /** SDK 1.4.0: APP-6D's standard identity digit: hostile. */
  public static final int IDENTITY_HOSTILE = 6;

  /**
   * A 30-digit APP-6E SIDC whose digits 21–30 are all zero is stored in its 20-digit form, so the
   * two forms compare equal and writers write the short one (model README, "Conventions").
   */
  public Symbol {
    Objects.requireNonNull(standard, "standard");
    Objects.requireNonNull(sidc, "sidc");
    sidc = canonicalSidc(standard, sidc);
    if (standard == SymbolStandard.VESSEL && !VESSEL_CODE.matcher(sidc).matches()) {
      throw new IllegalArgumentException("a vessel code is 4 digits: context 0-2, identity 0-6, ship type 00-99: " + sidc);
    }
    if (modifiers != null && modifiers.isEmpty()) {
      modifiers = null;
    }
  }

  /**
   * SDK 1.4.0: a vessel symbol.
   *
   * @param context APP-6D's context digit, 0 to 2 ({@link #CONTEXT_REALITY} and on)
   * @param identity APP-6D's standard identity digit, 0 to 6 ({@link #IDENTITY_PENDING} and on)
   * @param shipType the AIS ship and cargo type, 0 to 99 (0: not available)
   * @param modifiers the amplifiers, e.g. direction and speed, or {@code null}
   */
  public static Symbol vessel(int context, int identity, int shipType, @Nullable Modifiers modifiers) {
    if (context < 0 || context > 2 || identity < 0 || identity > 6 || shipType < 0 || shipType > 99) {
      throw new IllegalArgumentException("a vessel needs context 0-2, identity 0-6 and ship type 0-99: " + context + ", " + identity + ", " + shipType);
    }
    return new Symbol(SymbolStandard.VESSEL, "" + context + identity + (shipType < 10 ? "0" : "") + shipType, modifiers);
  }

  /** SDK 1.4.0: a vessel symbol in reality ({@link #CONTEXT_REALITY}). */
  public static Symbol vessel(int identity, int shipType, @Nullable Modifiers modifiers) {
    return vessel(CONTEXT_REALITY, identity, shipType, modifiers);
  }

  /** SDK 1.4.0: whether this is a vessel symbol. */
  public boolean isVessel() {
    return standard == SymbolStandard.VESSEL;
  }

  /** SDK 1.4.0: a vessel's context digit, 0 to 2. */
  public int vesselContext() {
    return vesselDigits(0, 1);
  }

  /** SDK 1.4.0: a vessel's standard identity digit, 0 to 6. */
  public int vesselIdentity() {
    return vesselDigits(1, 2);
  }

  /** SDK 1.4.0: a vessel's AIS ship and cargo type, 0 to 99. */
  public int vesselShipType() {
    return vesselDigits(2, 4);
  }

  private int vesselDigits(int from, int to) {
    if (!isVessel()) {
      throw new IllegalStateException("not a vessel symbol: " + standard.json());
    }
    return Integer.parseInt(sidc.substring(from, to));
  }

  /** The canonical form of a SIDC: for APP-6E, 30 digits ending in ten zeros become 20 digits. Others are unchanged. */
  public static String canonicalSidc(SymbolStandard standard, String sidc) {
    if (standard == SymbolStandard.APP_6E && sidc.length() == 30 && sidc.endsWith(TEN_ZEROS)) {
      return sidc.substring(0, 20);
    }
    return sidc;
  }
}
