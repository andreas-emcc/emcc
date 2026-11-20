package dev.emcc.plugins.cot.codec;

import dev.emcc.sdk.model.Modifiers;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import java.util.Arrays;
import java.util.Map;
import java.util.Set;
import org.jspecify.annotations.Nullable;

/**
 * The symbol of a CoT event as an APP-6B SIDC (interop note, section 7).
 *
 * <p>CoT's atom types are MIL-STD-2525B function codes with a hyphen between the characters:
 * {@code a-f-G-U-C-I} is affiliation {@code f}, battle dimension {@code G} and function {@code
 * UCI} (infantry). The 15-character APP-6B SIDC is {@code S}, the affiliation, the battle
 * dimension, {@code P} (present), the function padded to six characters, and dashes.
 *
 * <p>The functions are a <b>closed table</b>: the codes that milsymbol 3.0.4 knows for each battle
 * dimension, up to three characters. Each was checked with the symbology plugin's rule (the
 * model's pattern, then milsymbol's own validity check); {@code CotSymbolsTest} checks the shape,
 * and {@code plugins/cot/verify-sidc.mjs} checks the table against milsymbol. A function the
 * table lacks falls back to its nearest known parent (the same code without its last characters),
 * and without any parent to the battle dimension's generic symbol.
 *
 * <pre>{@code
 * CotSymbols.sidc("a-f-G-U-C-I")   // "SFGPUCI--------"
 * CotSymbols.sidc("a-h-A-M-F-Q-Z") // "SHAPMFQ--------" (the parent MFQ)
 * CotSymbols.sidc("a-u-G")         // "SUGP-----------" (generic ground)
 * }</pre>
 */
public final class CotSymbols {

  /** The generic symbol of a map point (a tactical graphic point, unknown affiliation). */
  public static final String POINT_SIDC = "GUGPGPP--------";

  /** Function codes by battle dimension: P space, A air, G ground, S sea surface, U subsurface, F special operations, Z unknown. */
  private static final Map<Character, Set<String>> FUNCTIONS = Map.of(
      'G', words("E ES ESE ESR EV EVA EVC EVD EVE EVM EVS EVT EVU EW EWA EWD EWG EWH EWM EWO EWR EWS EWT EWX EWZ EX EXF EXI EXL EXM EXN"
          + " GL I IB IBA IBN IE IG IM IMA IMC IME IMF IMG IMM IMN IMS IMV IP IPD IR IRM IRN IRP IRR IT IU IUE IUP IUR IUT IX IXH"
          + " U UC UCA UCD UCE UCF UCI UCM UCR UCS UCV UH US USA USM USS UST USX UU UUA UUD UUE UUI UUL UUM UUP UUS UUT UUX"),
      'A', words("C CF CH CL M ME MF MFA MFB MFC MFD MFF MFH MFJ MFK MFL MFM MFO MFP MFQ MFR MFS MFT MFU MFY MH MHA MHC MHD MHH MHI MHJ MHK MHM"
          + " MHO MHQ MHR MHS MHT MHU ML MV W WB WD WM WMA WMB WML WMS WMU"),
      'S', words("C CA CD CH CL CM CP CU CUM CUN CUR CUS E ED EP EV G GC GE GF GG GT GU N NF NFT NH NI NM NN NNR NR NRA NRO NS NTS O S SA SP"
          + " X XA XAR XAS XF XH XL XM XMC XMD XME XMF XMH XMO XMP XMR XMT XP XR Z ZI ZM ZN"),
      'U', words("E N NA NB NBR NBS NBW ND NM S SB SC SCA SCB SCF SCG SCM SF SK SL SN SNA SNB SNF SNG SNM SO SOF SR SS SSA SU SUM SUN SUS SX"
          + " V W WD WDM WM WMA WMB WMC WMD WME WMF WMG WMM WMN WMO WMR WMS WMX WT WV X"),
      'P', words("L S T V"),
      'F', words("A AF AFA AFK AFU AH AHA AHH AHU AV B G GB GC GCA GP GPA GR GS GSP GSR N NB NN NS NU SN SNB SNN SNS SNU"));

  /** CoT's affiliation letter to the SIDC's standard identity. Anything else is unknown. */
  private static final Map<Character, Character> AFFILIATION = Map.of(
      'p', 'P', 'u', 'U', 'a', 'A', 'f', 'F', 'n', 'N', 's', 'S', 'h', 'H', 'j', 'J', 'k', 'K');

  private CotSymbols() {}

  /** The table: battle dimension to its known function codes. For tests and the verification script. */
  public static Map<Character, Set<String>> functions() {
    return FUNCTIONS;
  }

  /** The symbol of an atom or a map point, with the event's direction and speed as modifiers. */
  public static Symbol symbol(CotEvent event, @Nullable Modifiers modifiers) {
    return new Symbol(SymbolStandard.APP_6B, event.isMapPoint() ? POINT_SIDC : sidc(event.type()), modifiers);
  }

  /** The APP-6B SIDC for a CoT atom type, e.g. {@code SFGPUCI--------} for {@code a-f-G-U-C-I}. */
  public static String sidc(String cotType) {
    String[] parts = cotType.split("-");
    char affiliation = 'U';
    char dimension = 'Z';
    var function = new StringBuilder();
    if (parts.length > 1 && parts[1].length() == 1) {
      affiliation = AFFILIATION.getOrDefault(Character.toLowerCase(parts[1].charAt(0)), 'U');
    }
    if (parts.length > 2 && parts[2].length() == 1) {
      char d = Character.toUpperCase(parts[2].charAt(0));
      dimension = FUNCTIONS.containsKey(d) ? d : 'Z';
    }
    for (int i = 3; i < parts.length && parts[i].length() == 1 && Character.isLetter(parts[i].charAt(0)); i++) {
      function.append(Character.toUpperCase(parts[i].charAt(0)));
    }
    String known = knownFunction(dimension, function.toString());
    return "S" + affiliation + dimension + "P" + (known + "------").substring(0, 6) + "-----";
  }

  /** The longest prefix of {@code function} the table knows for {@code dimension}, or the empty string. */
  static String knownFunction(char dimension, String function) {
    Set<String> known = FUNCTIONS.getOrDefault(dimension, Set.of());
    String candidate = function.length() > 3 ? function.substring(0, 3) : function;
    while (!candidate.isEmpty() && !known.contains(candidate)) {
      candidate = candidate.substring(0, candidate.length() - 1);
    }
    return candidate;
  }

  // ---------------------------------------------------------------- the way back: a symbol to a CoT type (brief function 17)

  /** The standard identity of an APP-6B SIDC (its second character) to CoT's affiliation letter; exercise identities count as their real ones. */
  private static final Map<Character, Character> AFFILIATION_BACK = Map.ofEntries(
      Map.entry('P', 'p'), Map.entry('U', 'u'), Map.entry('A', 'a'), Map.entry('F', 'f'), Map.entry('N', 'n'), Map.entry('S', 's'),
      Map.entry('H', 'h'), Map.entry('J', 'j'), Map.entry('K', 'k'),
      Map.entry('G', 'p'), Map.entry('W', 'u'), Map.entry('M', 'a'), Map.entry('D', 'f'), Map.entry('L', 'n'));

  /** The standard identity digit of an APP-6D or APP-6E SIDC to CoT's affiliation letter; the others count as unknown. */
  private static final Map<Character, Character> IDENTITY_BACK = Map.of(
      '0', 'p', '1', 'u', '2', 'a', '3', 'f', '4', 'n', '5', 's', '6', 'h');

  /** The symbol sets that have a CoT battle dimension: the others (control measures, activities, weather, signals intelligence) have none. */
  private static final Map<String, Character> SET_DIMENSION = Map.ofEntries(
      Map.entry("01", 'A'), Map.entry("02", 'A'), Map.entry("05", 'P'), Map.entry("06", 'P'), Map.entry("10", 'G'), Map.entry("11", 'G'),
      Map.entry("15", 'G'), Map.entry("20", 'G'), Map.entry("27", 'G'), Map.entry("30", 'S'), Map.entry("35", 'U'), Map.entry("36", 'U'));

  /**
   * The CoT atom type of a symbol, e.g. {@code a-f-G-U-C-I} for {@code SFGPUCI--------} or for the APP-6D
   * {@code 10031000001211000000}; {@code null} if CoT has none for it: a symbol that is not a warfighting symbol
   * (tactical graphics, weather, activities, ...), or one of a symbol set with no CoT battle dimension.
   *
   * <p>APP-6B uses the table above in reverse. APP-6D and APP-6E (their first 20 digits) use {@link
   * CotSymbolsNumeric}, which is made from milsymbol's own correspondence. <b>A function the table lacks falls
   * back to its parent</b> (APP-6B: the same code without its last characters; APP-6D: the entity without its
   * subtype, then without its type), <b>then to the dimension's generic symbol.</b>
   */
  public static @Nullable String cotType(Symbol symbol) {
    String sidc = symbol.sidc();
    if (sidc.length() == 15) {
      return fromLetters(sidc);
    }
    if (sidc.length() >= 20 && sidc.chars().limit(20).allMatch(c -> c >= '0' && c <= '9')) {
      return fromNumbers(sidc);
    }
    return null;
  }

  private static @Nullable String fromLetters(String sidc) {
    if (sidc.charAt(0) != 'S') {
      return null;
    }
    char dimension = sidc.charAt(2);
    if (!FUNCTIONS.containsKey(dimension) && dimension != 'Z') {
      return null;
    }
    char affiliation = AFFILIATION_BACK.getOrDefault(sidc.charAt(1), 'u');
    String function = sidc.substring(4, 10).replace("-", "");
    return type(affiliation, dimension, dimension == 'Z' ? "" : knownFunction(dimension, function));
  }

  private static @Nullable String fromNumbers(String sidc) {
    Character dimension = SET_DIMENSION.get(sidc.substring(4, 6));
    if (dimension == null) {
      return null;
    }
    char affiliation = IDENTITY_BACK.getOrDefault(sidc.charAt(3), 'u');
    String set = sidc.substring(4, 6);
    String entity = sidc.substring(10, 16);
    String row = null;
    for (String key : new String[] {entity, entity.substring(0, 4) + "00", entity.substring(0, 2) + "0000"}) {
      row = CotSymbolsNumeric.of(set + key);
      if (row != null) {
        break;
      }
    }
    return type(affiliation, row == null ? dimension : row.charAt(0), row == null ? "" : row.substring(1));
  }

  private static String type(char affiliation, char dimension, String function) {
    var type = new StringBuilder("a-").append(affiliation).append('-').append(dimension);
    for (char c : function.toCharArray()) {
      type.append('-').append(c);
    }
    return type.toString();
  }

  private static Set<String> words(String list) {
    return Set.copyOf(Arrays.asList(list.trim().split("\\s+")));
  }
}
