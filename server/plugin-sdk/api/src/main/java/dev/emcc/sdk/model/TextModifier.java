package dev.emcc.sdk.model;

/**
 * The text amplifiers of a symbol, named as in milsymbol's options (the closed list of the data
 * model). {@code direction}, {@code speed}, and from SDK 1.4.0 {@code distances} and {@code azimuths},
 * are numbers and live in {@link Modifiers} directly. SDK 1.4.0 (CR-0030 part 2) adds the text
 * amplifiers that tactical graphics use: {@link #TARGET_NUMBER} (AP), {@link #UNIQUE_DESIGNATION_1}
 * (T1), {@link #UNIQUE_DESIGNATION_2} (T2) and {@link #DTG_1} (W1). Single-point symbols ignore them.
 *
 * <pre>{@code
 * TextModifier.fromJson("uniqueDesignation") == TextModifier.UNIQUE_DESIGNATION
 * }</pre>
 */
public enum TextModifier {
  ADDITIONAL_INFORMATION("additionalInformation"),
  ALTITUDE_DEPTH("altitudeDepth"),
  AUXILIARY_EQUIPMENT_INDICATOR("auxiliaryEquipmentIndicator"),
  COMBAT_EFFECTIVENESS("combatEffectiveness"),
  COMMON_IDENTIFIER("commonIdentifier"),
  COUNTRY("country"),
  DTG("dtg"),
  /** SDK 1.4.0: W1, a graphic's second date-time group. */
  DTG_1("dtg1"),
  ENGAGEMENT_BAR("engagementBar"),
  ENGAGEMENT_TYPE("engagementType"),
  EQUIPMENT_TEARDOWN_TIME("equipmentTeardownTime"),
  EVALUATION_RATING("evaluationRating"),
  GUARDED_UNIT("guardedUnit"),
  HEADQUARTERS_ELEMENT("headquartersElement"),
  HIGHER_FORMATION("higherFormation"),
  HOSTILE("hostile"),
  IFF_SIF("iffSif"),
  INSTALLATION_COMPOSITION("installationComposition"),
  LOCATION("location"),
  PLATFORM_TYPE("platformType"),
  QUANTITY("quantity"),
  REINFORCED_REDUCED("reinforcedReduced"),
  SIGINT("sigint"),
  SIGNATURE_EQUIPMENT("signatureEquipment"),
  SPECIAL_DESIGNATOR("specialDesignator"),
  SPECIAL_HEADQUARTERS("specialHeadquarters"),
  STAFF_COMMENTS("staffComments"),
  /** SDK 1.4.0: AP, a graphic's target number. */
  TARGET_NUMBER("targetNumber"),
  TYPE("type"),
  UNIQUE_DESIGNATION("uniqueDesignation"),
  /** SDK 1.4.0: T1, a graphic's second unique designation. */
  UNIQUE_DESIGNATION_1("uniqueDesignation1"),
  /** SDK 1.4.0: T2, a graphic's third unique designation (APP-6 E). */
  UNIQUE_DESIGNATION_2("uniqueDesignation2");

  /** The maximum length of a text amplifier. */
  public static final int MAX_LENGTH = 128;

  private final String json;

  TextModifier(String json) {
    this.json = json;
  }

  /** The JSON member name, e.g. {@code "uniqueDesignation"}. */
  public String json() {
    return json;
  }

  public static TextModifier fromJson(String name) {
    for (TextModifier m : values()) {
      if (m.json.equals(name)) {
        return m;
      }
    }
    throw new IllegalArgumentException("unknown modifier: " + name);
  }
}
