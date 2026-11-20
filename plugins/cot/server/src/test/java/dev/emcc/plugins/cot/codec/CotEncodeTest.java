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
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** The object to CoT direction of the codec (brief function 17, criterion 14 for what is sent): a symbol with a point becomes an event. */
class CotEncodeTest {

  private static final UUID LAYER = UUID.fromString("0192a5c4-3b1e-7c2d-9f00-1a2b3c4d5e02");
  private static final SecurityLabel LABEL = SecurityLabel.of("NATO", "UNCLASSIFIED");
  private static final Placement NORTH = new Placement("tak-north", LAYER, LABEL, null);
  private static final Instant SENT = Instant.parse("2026-10-26T12:00:00Z");
  private static final Instant STALE = Instant.parse("2026-10-26T12:01:00Z");

  private final CotXml xml = new CotXml();

  /** What every infantry symbol of APP-6B {@code SFGPUCI--------} gets in its detail (brief function 28). */
  private static final String INFANTRY_CODE = "<__milicon id=\"SFGPUCI--------\"/><__milsym id=\"SFGPUCI--------\"/>";

  private CotEvent encoded(MapObjectContent content, String uid) {
    CotMapper.Encoded result = CotMapper.encode(uid, content, SENT, STALE);
    assertThat(result.skip()).isNull();
    return result.event();
  }

  /** Brief function 23 and criterion 33 (owner, LU): a value outside the set's limits is left out; the limits themselves are taken. */
  @Test
  void aValueOutsideTheSetsLimitsIsLeftOutAndTheEventGoesOutWithTheDefaults() throws Exception {
    String longCallsign = "C".repeat(65);
    String outside = "<event uid=\"a\" type=\"a-f-G-U-C-I\" how=\"" + "h".repeat(17) + "\"><point lat=\"1.5\" lon=\"2.5\" ce=\"-5\" le=\"x\"/>"
        + "<detail><contact callsign=\"" + longCallsign + "\"/></detail></event>";
    MapObjectContent content = CotMapper.toContent(xml.parse(outside), NORTH);
    JsonObject ext = content.extensions().get("cot");
    assertThat(ext.get("callsign")).as("65 characters").isNull();
    assertThat(ext.get("how")).as("17 characters").isNull();
    assertThat(ext.get("ce")).as("-5").isNull();
    assertThat(ext.get("le")).as("x").isNull();
    assertThat(content.properties().name()).as("the Name keeps it").isEqualTo(longCallsign);
    String wire = CotXml.write(encoded(content, "a"));
    assertThat(wire).contains(" how=\"h-e\"").contains(" ce=\"9999999.0\"").contains(" le=\"9999999.0\"").contains("callsign=\"" + longCallsign + "\"");

    // the limits themselves are taken
    String at = "<event uid=\"b\" type=\"a-f-G-U-C-I\" how=\"" + "h".repeat(16) + "\"><point lat=\"1.5\" lon=\"2.5\" ce=\"0\" le=\"9999999\"/>"
        + "<detail><contact callsign=\"" + "C".repeat(64) + "\"/></detail></event>";
    JsonObject kept = CotMapper.toContent(xml.parse(at), NORTH).extensions().get("cot");
    assertThat(kept.getString("callsign")).hasSize(64);
    assertThat(kept.getString("how")).hasSize(16);
    assertThat(kept.get("ce")).isNotNull();
    assertThat(kept.get("le")).isNotNull();
  }

  private static MapObjectContent withSymbol(MapObjectContent c, Symbol symbol) {
    return new MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), c.layerId(), c.geometry(), symbol, c.style(), c.properties(), c.label(), c.extensions());
  }

  private static MapObjectContent drawn(Symbol symbol, ObjectProperties properties, Extensions extensions) {
    return new MapObjectContent("core.symbol", "core.general", "manual", null, LAYER, new Geometry.Point(Position.of(11.9746, 57.7089, 120.0)), symbol, null,
        properties, LABEL, extensions);
  }

  // ---------------------------------------------------------------- an object that came from CoT

  @Test
  void anObjectThatCameFromCotGivesTheSameEventApartFromTheTimes() throws Exception {
    CotEvent original = xml.parse(Samples.UNIT);
    MapObjectContent content = CotMapper.toContent(original, NORTH);
    CotEvent back = encoded(content, original.uid());
    assertThat(back.time()).isEqualTo(SENT);
    assertThat(back.start()).isEqualTo(SENT);
    assertThat(back.stale()).isEqualTo(STALE);
    // what is written reads back as the original, with the new times
    assertThat(xml.parse(CotXml.write(back))).isEqualTo(original.withTimes(SENT, SENT, STALE).withDetail(original.detail() + INFANTRY_CODE));
    assertThat(back.detail()).as("not a byte changed; the symbol code is added (function 28)").isEqualTo(original.detail() + INFANTRY_CODE);
  }

  @Test
  void aRoundTripKeepsTheSouthernWesternPositionAndTheUnknownHeight() throws Exception {
    CotEvent original = xml.parse(Samples.at("r1", 0, -33.8688, -70.6693));
    CotEvent back = xml.parse(CotXml.write(encoded(CotMapper.toContent(original, NORTH), "r1")));
    assertThat(back.lat()).isEqualTo(-33.8688);
    assertThat(back.lon()).isEqualTo(-70.6693);
    assertThat(back.hae()).isNull();
    assertThat(back).isEqualTo(original.withTimes(SENT, SENT, STALE).withDetail(INFANTRY_CODE));
  }

  @Test
  void aMovedObjectGivesTheNewPositionAndKeepsTheRest() throws Exception {
    CotEvent original = xml.parse(Samples.UNIT);
    MapObjectContent content = CotMapper.toContent(original, NORTH);
    var moved = new MapObjectContent(content.type(), content.dataType(), content.dataSource(), content.time(), content.layerId(),
        new Geometry.Point(Position.of(11.9746, 57.7089)), content.symbol(), content.style(), content.properties(), content.label(), content.extensions());
    CotEvent back = encoded(moved, original.uid());
    assertThat(back.lat()).isEqualTo(57.7089);
    assertThat(back.lon()).isEqualTo(11.9746);
    assertThat(back.hae()).as("the new position has no altitude").isNull();
    assertThat(back.detail()).isEqualTo(original.detail() + INFANTRY_CODE);
    assertThat(back.type()).isEqualTo(original.type());
    assertThat(back.how()).isEqualTo("m-g");
  }

  @Test
  void changedCoreValuesArePutOverTheRawDetailAndNothingElseInItChanges() throws Exception {
    CotEvent original = xml.parse(Samples.UNIT);
    MapObjectContent content = CotMapper.toContent(original, NORTH);
    Modifiers modifiers = Modifiers.builder().text(TextModifier.UNIQUE_DESIGNATION, "VIPER 2").direction(90).speed(7.5).build();
    JsonObject ext = content.extensions().get("cot");
    var builder = JsonObject.builder();
    ext.members().forEach((name, value) -> {
      if (!name.equals("team") && !name.equals("role") && !name.equals("callsign")) { // no Callsign field: the Name is the callsign
        builder.put(name, value);
      }
    });
    builder.put("team", JsonString.of("Red")).put("role", JsonString.of("Medic"));
    var changed = new MapObjectContent(content.type(), content.dataType(), content.dataSource(), content.time(), content.layerId(), content.geometry(),
        new Symbol(content.symbol().standard(), content.symbol().sidc(), modifiers), content.style(), new ObjectProperties("VIPER 3", "Moving out"),
        content.label(), Extensions.empty().with("cot", builder.build()));
    String detail = encoded(changed, original.uid()).detail();
    assertThat(detail).contains("<contact callsign=\"VIPER 3\" endpoint=\"*:-1:stcp\"/>");
    assertThat(detail).contains("<__group name=\"Red\" role=\"Medic\"/>");
    assertThat(detail).contains("<track course=\"90.0\" speed=\"7.5\"/>");
    assertThat(detail).contains("<remarks>Moving out</remarks>");
    assertThat(detail).as("the private element is kept as it was").contains(
        "<priv:plugin xmlns:priv=\"urn:example:private\" note=\"a &gt; b, kept\"><!-- </detail> in a comment --></priv:plugin>");
    CotEvent back = xml.parse(CotXml.write(encoded(changed, original.uid())));
    assertThat(back.callsign()).isEqualTo("VIPER 3");
    assertThat(back.course()).isEqualTo(90.0);
    assertThat(back.group()).isEqualTo(new CotGroup("Red", "Medic"));
  }

  @Test
  void aMapPointKeepsItsTypeAndASymbolThatWasChangedGetsTheTypeOfItsSidc() throws Exception {
    CotEvent point = xml.parse("<event uid=\"wp-1\" type=\"b-m-p-w\" how=\"h-e\"><point lat=\"57.7\" lon=\"11.9\"/><detail><contact callsign=\"WP 1\"/></detail></event>");
    MapObjectContent content = CotMapper.toContent(point, NORTH);
    assertThat(encoded(content, "wp-1").type()).isEqualTo("b-m-p-w");

    CotEvent unit = xml.parse(Samples.UNIT);
    MapObjectContent changed = withSymbol(CotMapper.toContent(unit, NORTH), new Symbol(SymbolStandard.APP_6B, "SHGPUCR--------", null));
    assertThat(encoded(changed, unit.uid()).type()).as("a user changed the symbol to hostile reconnaissance").isEqualTo("a-h-G-U-C-R");
  }

  @Test
  void theLabelsAndTheErrorsOfTheOriginalComeAlong() throws Exception {
    CotEvent original = xml.parse("<event uid=\"l1\" type=\"a-f-G-U-C\" how=\"h-g-i-g-o\" access=\"Unclassified\" qos=\"1-r-c\" caveat=\"FVEY\" releasableTo=\"SWE\">"
        + "<point lat=\"59.5\" lon=\"18.5\" hae=\"10.0\" ce=\"12.5\" le=\"7.25\"/><detail/></event>");
    CotEvent back = encoded(CotMapper.toContent(original, NORTH), "l1");
    assertThat(back.how()).isEqualTo("h-g-i-g-o");
    assertThat(back.access()).isEqualTo("Unclassified");
    assertThat(back.qos()).isEqualTo("1-r-c");
    assertThat(back.caveat()).isEqualTo("FVEY");
    assertThat(back.releasableTo()).isEqualTo("SWE");
    assertThat(back.ce()).isEqualTo("12.5");
    assertThat(back.le()).isEqualTo("7.25");
  }

  // ---------------------------------------------------------------- an object that did not

  @Test
  void aDrawnSymbolBecomesAnEventFromItsOwnValues() throws Exception {
    Modifiers modifiers = Modifiers.builder().direction(45).speed(3.5).build();
    var content = drawn(new Symbol(SymbolStandard.APP_6D, "10031000001211000000", modifiers), new ObjectProperties("ALPHA & 1", "A <test>"),
        Extensions.empty().with("cot", JsonObject.builder().put("team", JsonString.of("Dark Blue")).put("role", JsonString.of("RTO")).build()));
    CotEvent event = encoded(content, "0192a5c4-3b1e-7c2d-9f00-aaaaaaaaaaaa");
    assertThat(event.uid()).isEqualTo("0192a5c4-3b1e-7c2d-9f00-aaaaaaaaaaaa");
    assertThat(event.type()).isEqualTo("a-f-G-U-C-I");
    assertThat(event.how()).isEqualTo("h-e");
    assertThat(event.version()).isEqualTo("2.0");
    // [lon, lat] = [11.9746, 57.7089]: latitude and longitude differ
    assertThat(event.lat()).isEqualTo(57.7089);
    assertThat(event.lon()).isEqualTo(11.9746);
    assertThat(event.hae()).isEqualTo(120.0);
    String text = CotXml.write(event);
    assertThat(text).contains("lat=\"57.7089\"").contains("lon=\"11.9746\"").contains("hae=\"120.0\"").contains("ce=\"9999999.0\"").contains("le=\"9999999.0\"");
    CotEvent back = xml.parse(text);
    assertThat(back.callsign()).isEqualTo("ALPHA & 1");
    assertThat(back.remarks()).isEqualTo("A <test>");
    assertThat(back.course()).isEqualTo(45.0);
    assertThat(back.speed()).isEqualTo(3.5);
    assertThat(back.group()).isEqualTo(new CotGroup("Dark Blue", "RTO"));
  }

  @Test
  void theNameIsTheCallsignAndWithoutOneTheUniqueDesignationIs() throws Exception {
    Modifiers modifiers = Modifiers.builder().text(TextModifier.UNIQUE_DESIGNATION, "UD-7").build();
    var content = drawn(new Symbol(SymbolStandard.APP_6B, "SFGPUCI--------", modifiers), null, Extensions.empty());
    assertThat(xml.parse(CotXml.write(encoded(content, "d1"))).callsign()).isEqualTo("UD-7");
    var nothing = drawn(new Symbol(SymbolStandard.APP_6B, "SFGPUCI--------", null), null, Extensions.empty());
    assertThat(encoded(nothing, "d2").detail()).as("nothing but the symbol code (function 28)").isEqualTo(INFANTRY_CODE);
  }

  @Test
  void aDeclaredFieldAloneDoesNotMakeAnObjectAnObjectFromCot() throws Exception {
    // an editor's "+" gave a drawn symbol a team: the cot extension has no type, so nothing of CoT is invented
    var content = drawn(new Symbol(SymbolStandard.APP_6B, "SHAPMFF--------", null), null,
        Extensions.empty().with("cot", JsonObject.builder().put("team", JsonString.of("Green")).build()));
    CotEvent event = encoded(content, "d3");
    assertThat(event.type()).isEqualTo("a-h-A-M-F-F");
    assertThat(event.how()).isEqualTo("h-e");
    assertThat(event.group()).isEqualTo(new CotGroup("Green", null));
  }

  // ---------------------------------------------------------------- what is not sent

  @Test
  void aShapeIsSkippedAsNotASymbol() {
    var polygon = new MapObjectContent("core.shape", "core.general", "manual", null, LAYER,
        new Geometry.Polygon(List.of(List.of(Position.of(1.0, 50.0), Position.of(2.0, 50.0), Position.of(2.0, 51.0), Position.of(1.0, 50.0)))), null, null, null, LABEL, Extensions.empty());
    assertThat(CotMapper.encode("p", polygon, SENT, STALE).skip()).isEqualTo(CotMapper.Skip.NOT_A_SYMBOL);
  }

  @Test
  void aSymbolWithNoCotTypeIsSkipped() {
    // a tactical graphic (APP-6B scheme G), a control measure (APP-6D symbol set 25), an activity (40), and a weather symbol
    for (Symbol symbol : List.of(
        new Symbol(SymbolStandard.APP_6B, "GFGPGPP--------", null),
        new Symbol(SymbolStandard.APP_6D, "10032500001401000000", null),
        new Symbol(SymbolStandard.APP_6D, "10034000001100000000", null),
        new Symbol(SymbolStandard.APP_6B, "WAS-WSVP-------", null))) {
      var content = drawn(symbol, null, Extensions.empty());
      assertThat(CotMapper.encode("g", content, SENT, STALE).skip()).as(symbol.sidc()).isEqualTo(CotMapper.Skip.NO_COT_TYPE);
    }
  }

  // ---------------------------------------------------------------- only real changes (function 19)

  @Test
  void theSignatureIgnoresTheTimesAndTAKsFlowTagsAndNothingElse() throws Exception {
    CotEvent a = xml.parse(Samples.UNIT);
    CotEvent later = xml.parse(Samples.UNIT.replace("08:20:00.000Z", "08:21:00.000Z").replace("08:25:00.000Z", "08:26:00.000Z"));
    assertThat(CotXml.signature(later)).isEqualTo(CotXml.signature(a));

    CotEvent relayed = xml.parse(Samples.UNIT.replace("</detail>", "<_flow-tags_ TAK-Server-ab12=\"2026-10-03T08:20:01Z\"/></detail>"));
    assertThat(CotXml.signature(relayed)).as("a relayed event differs from the original in its flow tags only").isEqualTo(CotXml.signature(a));

    CotEvent moved = xml.parse(Samples.UNIT.replace("lat=\"59.3507\"", "lat=\"59.3508\""));
    assertThat(CotXml.signature(moved)).isNotEqualTo(CotXml.signature(a));
    CotEvent renamed = xml.parse(Samples.UNIT.replace("VIPER 2", "VIPER 3"));
    assertThat(CotXml.signature(renamed)).isNotEqualTo(CotXml.signature(a));
    CotEvent otherHow = xml.parse(Samples.UNIT.replace("how=\"m-g\"", "how=\"h-e\""));
    assertThat(CotXml.signature(otherHow)).isNotEqualTo(CotXml.signature(a));
  }
}
