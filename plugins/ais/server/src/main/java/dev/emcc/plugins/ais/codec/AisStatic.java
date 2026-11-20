package dev.emcc.plugins.ais.codec;

import org.jspecify.annotations.Nullable;

/**
 * What a ship reports about itself, as far as it did; a field that is not there or not available is
 * {@code null}. Immutable.
 *
 * @param name six-bit text with the {@code @} and spaces at the end removed
 * @param callSign likewise
 * @param imo the IMO number, not 0
 * @param shipType 0 to 99
 * @param length metres: to bow plus to stern
 * @param beam metres: to port plus to starboard
 * @param draught metres
 * @param destination likewise name
 * @param cls the class of the transponder
 */
public record AisStatic(
    @Nullable String name,
    @Nullable String callSign,
    @Nullable Integer imo,
    @Nullable Integer shipType,
    @Nullable Integer length,
    @Nullable Integer beam,
    @Nullable Double draught,
    @Nullable String destination,
    @Nullable AisClass cls) {

  public static final AisStatic EMPTY = new AisStatic(null, null, null, null, null, null, null, null, null);

  /** Only the class. */
  public static AisStatic of(AisClass cls) {
    return new AisStatic(null, null, null, null, null, null, null, null, cls);
  }

  /** This, with every field that {@code newer} has put over it. */
  public AisStatic merge(AisStatic newer) {
    return new AisStatic(
        newer.name != null ? newer.name : name,
        newer.callSign != null ? newer.callSign : callSign,
        newer.imo != null ? newer.imo : imo,
        newer.shipType != null ? newer.shipType : shipType,
        newer.length != null ? newer.length : length,
        newer.beam != null ? newer.beam : beam,
        newer.draught != null ? newer.draught : draught,
        newer.destination != null ? newer.destination : destination,
        newer.cls != null ? newer.cls : cls);
  }
}
