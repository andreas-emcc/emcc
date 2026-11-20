package dev.emcc.plugins.cot.codec;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.model.Extensions;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Modifiers;
import dev.emcc.sdk.model.ObjectProperties;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import dev.emcc.sdk.model.TextModifier;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

/**
 * The symbol code and the amplifiers in CoT events (brief functions 26 to 28, T-129; criteria 37 to 39, 41 and 42): ATAK's recorded
 * events (test fixtures, as recorded) and WinTAK's (reconstructed), read into symbols and sent again.
 */
class SymbolCodesTest {

  private static final UUID LAYER = UUID.fromString("0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e02");
  private static final SecurityLabel LABEL = SecurityLabel.of("NATO", "UNCLASSIFIED");
  private static final Placement NORTH = new Placement("tak-north", LAYER, LABEL, null);
  private static final Instant SENT = Instant.parse("2026-11-09T12:00:00Z");
  private static final Instant STALE = Instant.parse("2026-11-09T12:01:00Z");

  private final CotXml xml = new CotXml();

  private static String fixture(String path) throws IOException {
    try (var in = SymbolCodesTest.class.getResourceAsStream("/fixtures/" + path)) {
      assertThat(in).as(path).isNotNull();
      return new String(in.readAllBytes(), StandardCharsets.UTF_8).strip();
    }
  }

  private CotEvent atak(String name) throws Exception {
    return xml.parse(fixture("atak-5.6/atak-" + name + ".xml"));
  }

  private CotEvent wintak(String name) throws Exception {
    return xml.parse(fixture("wintak-reconstructed/wintak-" + name + ".xml"));
  }

  /** An APP-6D body as the model holds it, without the version: context, identity, set, status, HQ/TF/dummy, amplifier, entity, sectors. */
  private static String body(char context, char identity, String set, char status, char hqtfd, String amplifier, String entity) {
    return "" + context + identity + set + status + hqtfd + amplifier + entity + "0000";
  }

  private static String bodyOf(Symbol symbol) {
    assertThat(symbol.standard()).isEqualTo(SymbolStandard.APP_6D);
    assertThat(symbol.sidc()).hasSize(20);
    return symbol.sidc().substring(2);
  }

  private static MapObjectContent drawn(Symbol symbol, ObjectProperties properties, Extensions extensions) {
    return new MapObjectContent("core.symbol", "core.general", "manual", null, LAYER, new Geometry.Point(Position.of(11.9746, 57.7089)), symbol, null,
        properties, LABEL, extensions);
  }

  private static String typeOf(MapObjectContent content) {
    return ((JsonString) content.extensions().get("cot").get("type")).value();
  }

  private CotEvent sent(MapObjectContent content) {
    CotMapper.Encoded result = CotMapper.encode("u1", content, SENT, STALE);
    assertThat(result.skip()).isNull();
    return result.event();
  }

  private static Symbol app6d(String sidc, String... modifiers) {
    Modifiers.Builder b = Modifiers.builder();
    for (int i = 0; i < modifiers.length; i += 2) {
      b.text(TextModifier.fromJson(modifiers[i]), modifiers[i + 1]);
    }
    return new Symbol(SymbolStandard.APP_6D, sidc, b.build());
  }

  // ---------------------------------------------------------------- criterion 37: ATAK's events in

  @Test
  void theGeneralUnitsFriendHostileAndNeutralAreLandUnitsWithNoFunction() throws Exception {
    assertThat(bodyOf(CotMapper.toContent(atak("T1"), NORTH).symbol())).isEqualTo(body('0', '3', "10", '0', '0', "00", "000000"));
    assertThat(bodyOf(CotMapper.toContent(atak("T2"), NORTH).symbol())).isEqualTo(body('0', '6', "10", '0', '0', "00", "000000"));
    assertThat(bodyOf(CotMapper.toContent(atak("T3"), NORTH).symbol())).isEqualTo(body('0', '4', "10", '0', '0', "00", "000000"));
  }

  @Test
  void theEchelonsAreTheCodesTwelfthCharacterAndTheEntityIsNotCommandAndControl() throws Exception {
    String[][] expected = {{"T4", "11"}, {"T5", "14"}, {"T6", "15"}, {"T7", "16"}, {"T8", "18"}};
    for (String[] e : expected) {
      MapObjectContent content = CotMapper.toContent(atak(e[0]), NORTH);
      assertThat(bodyOf(content.symbol())).as(e[0]).isEqualTo(body('0', '3', "10", '0', '0', e[1], "000000"));
      assertThat(typeOf(content)).as("the type is kept in the extension").isEqualTo("a-f-G-U");
    }
  }

  @Test
  void theSuspectIsIdentityFiveWithItsEchelon() throws Exception {
    MapObjectContent content = CotMapper.toContent(atak("suspect-F.9.120619"), NORTH);
    assertThat(bodyOf(content.symbol())).isEqualTo(body('0', '5', "10", '0', '0', "15", "000000"));
    assertThat(typeOf(content)).isEqualTo("a-s-G-U");
    assertThat(content.properties().name()).isEqualTo("F.9.120619");
  }

  @Test
  void reinforcedAndReducedAreTheTextModifierAndTheEmptyOneIsLeftOut() throws Exception {
    assertThat(CotMapper.toContent(atak("T12"), NORTH).symbol().modifiers().text(TextModifier.REINFORCED_REDUCED)).isEqualTo("+");
    assertThat(CotMapper.toContent(atak("T13"), NORTH).symbol().modifiers().text(TextModifier.REINFORCED_REDUCED)).isEqualTo("-");
    Symbol higher = CotMapper.toContent(atak("T14-higher-formation"), NORTH).symbol();
    assertThat(higher.modifiers().text(TextModifier.HIGHER_FORMATION)).isEqualTo("1st BDE");
    assertThat(higher.modifiers().text(TextModifier.REINFORCED_REDUCED)).as("ATAK's empty F").isNull();
  }

  @Test
  void equipmentIsSymbolSetFifteenWithItsQuantity() throws Exception {
    MapObjectContent content = CotMapper.toContent(atak("T14-equipment"), NORTH);
    assertThat(bodyOf(content.symbol())).isEqualTo(body('0', '3', "15", '0', '0', "00", "000000"));
    assertThat(content.symbol().modifiers().text(TextModifier.QUANTITY)).isEqualTo("12");
    assertThat(typeOf(content)).isEqualTo("a-f-G-E");
  }

  @Test
  void theUniqueDesignationBeatsTheCallsignAndTheNameStaysTheCallsign() throws Exception {
    MapObjectContent t16 = CotMapper.toContent(atak("T16"), NORTH);
    assertThat(t16.symbol().modifiers().text(TextModifier.UNIQUE_DESIGNATION)).isEqualTo("A CO");
    assertThat(t16.properties().name()).isEqualTo("T16");
    assertThat(JsonObjectText.of(t16, "callsign")).isEqualTo("T16");
    MapObjectContent t1 = CotMapper.toContent(atak("T1"), NORTH);
    assertThat(t1.symbol().modifiers().text(TextModifier.UNIQUE_DESIGNATION)).as("without a T, the callsign, as before").isEqualTo("T1");
  }

  @Test
  void aPlannedUnitIsStatusOne() throws Exception {
    assertThat(bodyOf(CotMapper.toContent(atak("T18"), NORTH).symbol())).isEqualTo(body('0', '3', "10", '1', '0', "15", "000000"));
  }

  /** The text of a field of the {@code cot} extension. */
  private static final class JsonObjectText {
    static String of(MapObjectContent content, String field) {
      JsonObject ext = content.extensions().get("cot");
      return ((JsonString) ext.get(field)).value();
    }
  }

  // ---------------------------------------------------------------- criterion 38: WinTAK's events in

  @Test
  void winTaksBaselineIsInfantryAndItsTypeSuffixIsNotRead() throws Exception {
    MapObjectContent s1 = CotMapper.toContent(wintak("S1"), NORTH);
    assertThat(bodyOf(s1.symbol())).isEqualTo(body('0', '3', "10", '0', '0', "00", "121100"));
    MapObjectContent s2 = CotMapper.toContent(wintak("S2"), NORTH);
    assertThat(bodyOf(s2.symbol())).as("the code's G: echelon 17").isEqualTo(body('0', '3', "10", '0', '0', "17", "121100"));
    assertThat(typeOf(s2)).isEqualTo("a-f-G-U-C-I-B");
  }

  @Test
  void winTaksPositionTenAIsPartOfTheFunctionAndGivesNoHeadquarters() throws Exception {
    assertThat(bodyOf(CotMapper.toContent(wintak("S3"), NORTH).symbol())).isEqualTo(body('0', '3', "10", '0', '0', "17", "121100"));
  }

  @Test
  void winTaksAmpAttributesAreTheModifiersAndTheRemarksStayTheDescription() throws Exception {
    MapObjectContent s4 = CotMapper.toContent(wintak("S4"), NORTH);
    assertThat(bodyOf(s4.symbol())).as("echelon 16").isEqualTo(body('0', '3', "10", '0', '0', "16", "121100"));
    Modifiers m = s4.symbol().modifiers();
    assertThat(m.text(TextModifier.UNIQUE_DESIGNATION)).isEqualTo("Alpha Co");
    assertThat(m.text(TextModifier.HIGHER_FORMATION)).isEqualTo("1st Mech Div");
    assertThat(m.text(TextModifier.QUANTITY)).isEqualTo("120");
    assertThat(m.text(TextModifier.COMBAT_EFFECTIVENESS)).as("status=\"Excellent\"").isEqualTo("Excellent");
    assertThat(s4.properties().description()).isEqualTo("Qty: 120, Higher: 1st Mech Div, Status: Green");
    assertThat(s4.properties().name()).isEqualTo("S4");
  }

  @Test
  void winTaksSeaSymbolIsSymbolSetThirty() throws Exception {
    MapObjectContent s5 = CotMapper.toContent(wintak("S5"), NORTH);
    assertThat(s5.symbol().sidc().substring(4, 16)).isEqualTo("30" + "0" + "0" + "00" + "120200");
  }

  // ---------------------------------------------------------------- criterion 39: the fallbacks

  private CotEvent event(String type, String detail) throws Exception {
    return xml.parse("<event version=\"2.0\" uid=\"x1\" type=\"" + type + "\" how=\"h-g\"><point lat=\"57.7089\" lon=\"11.9746\"/><detail>"
        + detail + "</detail></event>");
  }

  @Test
  void anEventWithoutACodeGivesTheSymbolOfItsTypeAsBefore() throws Exception {
    Symbol symbol = CotMapper.toContent(event("a-f-G-U-C-I", "<contact callsign=\"A\"/>"), NORTH).symbol();
    assertThat(symbol.standard()).isEqualTo(SymbolStandard.APP_6B);
    assertThat(symbol.sidc()).isEqualTo("SFGPUCI--------");
  }

  @Test
  void milsymWinsOverMil2525cAndMilIconIsTheSecondChoice() throws Exception {
    String both = "<__milsym id=\"SFG*UCI---*E***\"/><mil2525c SIDC=\"SHGPUCA----F---\"/>";
    assertThat(bodyOf(CotMapper.toContent(event("a-f-G-U", both), NORTH).symbol())).isEqualTo(body('0', '3', "10", '0', '0', "15", "121100"));
    String icon = "<__milicon id=\"SHG*UCI---*F***\"/><mil2525c SIDC=\"SFGPUCA----E---\"/>";
    assertThat(bodyOf(CotMapper.toContent(event("a-f-G-U", icon), NORTH).symbol())).isEqualTo(body('0', '6', "10", '0', '0', "16", "121100"));
    assertThat(bodyOf(CotMapper.toContent(event("a-f-G-U", "<__milsym id=\"sfg*uci---*e***\"/>"), NORTH).symbol())).as("upper-cased").isEqualTo(body('0', '3', "10", '0', '0', "15", "121100"));
  }

  @Test
  void aFunctionTheTableLacksGivesItsParent() throws Exception {
    // SFG*EWDLS-*****: version 15, left out of the table: its parent
    MapObjectContent content = CotMapper.toContent(event("a-f-G-E", "<__milsym id=\"SFG*EWDLS-*****\"/>"), NORTH);
    assertThat(content.symbol().standard()).isEqualTo(SymbolStandard.APP_6D);
    assertThat(content.symbol().sidc().substring(4, 6)).isEqualTo("15");
    assertThat(Sidc2525c.toApp6d("SFG*EWDLS-*****")).isEqualTo(content.symbol().sidc());
  }

  @Test
  void aGraphicAndACodeOf14CharactersGiveTheTypesSymbolAndTheElementStaysInTheRawDetail() throws Exception {
    for (String code : new String[] {"GFGPGPP----****", "SFG*UCI---*E**", "", "not a code!!!!"}) {
      String detail = "<contact callsign=\"A\"/><__milsym id=\"" + code + "\"/>";
      MapObjectContent content = CotMapper.toContent(event("a-f-G-U-C-I", detail), NORTH);
      assertThat(content.symbol().standard()).as(code).isEqualTo(SymbolStandard.APP_6B);
      assertThat(content.symbol().sidc()).isEqualTo("SFGPUCI--------");
      assertThat(JsonObjectText.of(content, "detail")).as("kept").contains("<__milsym id=\"" + code + "\"/>");
    }
  }

  @Test
  void anAmplifierNotInTheTableAndAValueOf129CharactersAreLeftOutAndKept() throws Exception {
    String detail = "<__milsym id=\"SFG*UCI---*E***\"><unitmodifier code=\"AH\">x</unitmodifier><unitmodifier code=\"G\">" + "g".repeat(129)
        + "</unitmodifier><unitmodifier code=\"H\">" + "h".repeat(128) + "</unitmodifier><unitmodifier code=\"Q\">q</unitmodifier></__milsym>";
    MapObjectContent content = CotMapper.toContent(event("a-f-G-U", detail), NORTH);
    Modifiers m = content.symbol().modifiers();
    assertThat(m.text(TextModifier.STAFF_COMMENTS)).as("129 characters").isNull();
    assertThat(m.text(TextModifier.ADDITIONAL_INFORMATION)).as("128 characters").hasSize(128);
    assertThat(m.text(TextModifier.TYPE)).isNull();
    assertThat(JsonObjectText.of(content, "detail")).contains("code=\"AH\"").contains("code=\"Q\"").contains("g".repeat(129));
  }

  @Test
  void anEventWithoutAmplifiersLeavesNoneAndEveryAmplifierOfTheTableIsRead() throws Exception {
    StringBuilder all = new StringBuilder("<__milsym id=\"SFG*UCI---*E***\">");
    UnitModifiers.letters().forEach((letter, modifier) -> all.append("<unitmodifier code=\"").append(letter).append("\">v-").append(letter).append("</unitmodifier>"));
    all.append("</__milsym>");
    Modifiers m = CotMapper.toContent(event("a-f-G-U", all.toString()), NORTH).symbol().modifiers();
    UnitModifiers.letters().forEach((letter, modifier) -> assertThat(m.text(modifier)).as(letter).isEqualTo("v-" + letter));
    assertThat(UnitModifiers.letters()).hasSize(22);
    Symbol none = CotMapper.toContent(event("a-f-G-U", "<__milsym id=\"SFG*UCI---*E***\"/>"), NORTH).symbol();
    assertThat(none.modifiers()).isNull();
  }

  @Test
  void anAtakModifierBeatsWinTaksAmpAndAnUnknownAmpAttributeIsLeftOut() throws Exception {
    String detail = "<__milsym id=\"SFG*UCI---*E***\"><unitmodifier code=\"C\">7</unitmodifier></__milsym><amp quantity=\"9\" higher_formation=\"H\" mobility=\"x\" status=\"\"/>";
    Modifiers m = CotMapper.toContent(event("a-f-G-U", detail), NORTH).symbol().modifiers();
    assertThat(m.text(TextModifier.QUANTITY)).isEqualTo("7");
    assertThat(m.text(TextModifier.HIGHER_FORMATION)).isEqualTo("H");
    assertThat(m.text(TextModifier.COMBAT_EFFECTIVENESS)).isNull();
  }

  // ---------------------------------------------------------------- criterion 41: out

  private static final Pattern MILSYM = Pattern.compile("<__milsym id=\"([^\"]*)\"(?:/>|>(.*?)</__milsym>)");
  private static final Pattern MILICON = Pattern.compile("<__milicon id=\"([^\"]*)\"(?:/>|>(.*?)</__milicon>)");

  private static Matcher found(Pattern p, String detail) {
    Matcher m = p.matcher(detail);
    assertThat(m.find()).as(p + " in " + detail).isTrue();
    return m;
  }

  @Test
  void aBattalionHeadquartersGoesOutWithMilsymAndMiliconAndItsQuantity() {
    var content = drawn(app6d("10031002161211000000", "quantity", "12"), null, Extensions.empty());
    CotEvent event = sent(content);
    assertThat(event.type()).isEqualTo("a-f-G-U-C-I");
    String detail = event.detail();
    String unit = "<unitmodifier code=\"C\">12</unitmodifier>";
    assertThat(found(MILSYM, detail).group(1)).isEqualTo("SFG*UCI---AF***");
    assertThat(found(MILSYM, detail).group(2)).isEqualTo(unit);
    assertThat(found(MILICON, detail).group(1)).isEqualTo("SFG*UCI---AF***");
    assertThat(found(MILICON, detail).group(2)).isEqualTo(unit);
    assertThat(detail).doesNotContain("mil2525c").doesNotContain("<amp");
  }

  @Test
  void plannedMobilityExerciseAndSimulationGoOutAsTheirLetters() {
    assertThat(codeOut("10031010001211000000")).as("planned").isEqualTo("SFGAUCI---*****");
    assertThat(codeOut("10031000330000000000")).as("set 10, mobility 33").isEqualTo("SFG*------MQ***");
    assertThat(codeOut("10031500331100000000")).as("equipment, tracked").startsWith("SFG*").endsWith("MQ***");
    assertThat(codeOut("10161000001211000000")).as("exercise hostile").isEqualTo("SKG*UCI---*****");
    assertThat(codeOut("10231000001211000000")).as("simulation friend: the reality letter").isEqualTo("SFG*UCI---*****");
    assertThat(codeOut("10031000151100000000").substring(0, 4)).isEqualTo("SFG*");
  }

  private String codeOut(String sidc) {
    return found(MILSYM, sent(drawn(app6d(sidc), null, Extensions.empty())).detail()).group(1);
  }

  @Test
  void aUnitWithNoFunctionAndAnEchelonAnArmourCodeAndASectorNoIdHasGoOutAsTheBriefSays() {
    assertThat(codeOut("10031000150000000000")).isEqualTo("SFG*U-----*E***");
    assertThat(codeOut("10031000001205000000")).as("UCA, not UCAT").isEqualTo("SFG*UCA---*****");
    assertThat(codeOut("10031000001211009900")).as("an unknown sector: its parent's code").isEqualTo("SFG*UCI---*****");
  }

  @Test
  void anAppSixBCodeGoesOutAsStoredAndAVesselAndAnUnconvertibleCodeGetNeither() {
    var b = drawn(new Symbol(SymbolStandard.APP_6B, "SFGPUCI--------", null), null, Extensions.empty());
    assertThat(found(MILSYM, sent(b).detail()).group(1)).isEqualTo("SFGPUCI--------");
    var vessel = drawn(Symbol.vessel(4, 70, null), null, Extensions.empty());
    CotEvent event = sent(vessel);
    assertThat(event.type()).isEqualTo("a-n-S");
    assertThat(event.detail() == null ? "" : event.detail()).doesNotContain("__milsym").doesNotContain("__milicon");
    var cannot = drawn(app6d("10031099991211000000"), null, Extensions.empty());
    CotMapper.Encoded result = CotMapper.encode("u2", cannot, SENT, STALE);
    assertThat(result.event() == null || result.event().detail() == null || !result.event().detail().contains("__milsym")).isTrue();
  }

  @Test
  void theUniqueDesignationIsSentOnlyWhenItIsNotTheCallsign() {
    var named = drawn(app6d("10031000150000000000", "uniqueDesignation", "A CO"), new ObjectProperties("T16", null), Extensions.empty());
    assertThat(found(MILSYM, sent(named).detail()).group(2)).isEqualTo("<unitmodifier code=\"T\">A CO</unitmodifier>");
    var same = drawn(app6d("10031000150000000000", "uniqueDesignation", "T16"), new ObjectProperties("T16", null), Extensions.empty());
    assertThat(found(MILSYM, sent(same).detail()).group(1)).isEqualTo("SFG*U-----*E***");
    assertThat(sent(same).detail()).doesNotContain("unitmodifier");
  }

  @Test
  void theAmplifiersGoOutInTheTablesOrder() {
    var content = drawn(app6d("10031000150000000000", "uniqueDesignation", "U", "quantity", "Q", "higherFormation", "H", "reinforcedReduced", "+"), new ObjectProperties("N1", null), Extensions.empty());
    assertThat(found(MILSYM, sent(content).detail()).group(2)).isEqualTo(
        "<unitmodifier code=\"C\">Q</unitmodifier><unitmodifier code=\"F\">+</unitmodifier><unitmodifier code=\"M\">H</unitmodifier><unitmodifier code=\"T\">U</unitmodifier>");
  }

  @Test
  void aWinTakObjectGoesOutWithMilsymAndWithoutMil2525cAndAmpAndKeepsItsType() throws Exception {
    CotEvent original = wintak("S4");
    MapObjectContent content = CotMapper.toContent(original, NORTH);
    CotEvent back = sent(content);
    assertThat(back.detail()).doesNotContain("mil2525c").doesNotContain("<amp");
    assertThat(found(MILSYM, back.detail()).group(1)).isEqualTo("SFG*UCI---*F***");
    assertThat(found(MILSYM, back.detail()).group(2)).contains("code=\"C\">120<").contains("code=\"K\">Excellent<").contains("code=\"M\">1st Mech Div<").contains("code=\"T\">Alpha Co<");
    assertThat(back.detail()).contains("<remarks>Qty: 120");
    assertThat(back.type()).as("function 17: the type it came with").isEqualTo("a-f-G-U-C-I-C");
    // changed in emcc: the type is the symbol's again and the old elements are not contradicted
    MapObjectContent changed = drawn(app6d("10031000001211000000"), content.properties(), content.extensions());
    CotEvent edited = sent(changed);
    assertThat(edited.type()).isEqualTo("a-f-G-U-C-I");
    assertThat(edited.detail()).doesNotContain("mil2525c").doesNotContain("<amp");
    assertThat(found(MILSYM, edited.detail()).group(1)).isEqualTo("SFG*UCI---*****");
    assertThat(found(MILSYM, edited.detail()).group(2)).as("the symbol's own amplifiers: none").isNull();
  }

  // ---------------------------------------------------------------- criterion 42: round trips

  @Test
  void everyAtakFixtureReadAndSentAgainGivesTheSameCodeAndAmplifiers() throws Exception {
    String[] names = {"T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "suspect-F.9.120619", "T12", "T13", "T14-equipment", "T14-higher-formation", "T16", "T18"};
    for (String name : names) {
      CotEvent original = atak(name);
      CotEvent back = sent(CotMapper.toContent(original, NORTH));
      assertThat(back.type()).as(name).isEqualTo(original.type());
      Matcher before = found(MILSYM, original.detail());
      Matcher after = found(MILSYM, back.detail());
      assertThat(after.group(1)).as(name + " code").isEqualTo(before.group(1));
      assertThat(after.group(2)).as(name + " amplifiers").isEqualTo(before.group(2));
      assertThat(found(MILICON, back.detail()).group(1)).isEqualTo(before.group(1));
      // an object that is not changed gives its detail back as it came, ATAK's empty F in T14 included
      assertThat(back.detail()).as(name + ": not a byte changed").isEqualTo(original.detail());
    }
  }
}
