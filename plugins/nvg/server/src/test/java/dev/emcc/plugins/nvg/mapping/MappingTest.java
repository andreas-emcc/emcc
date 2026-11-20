package dev.emcc.plugins.nvg.mapping;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import dev.emcc.plugins.nvg.Samples;
import dev.emcc.plugins.nvg.Xsd;
import dev.emcc.plugins.nvg.codec.Item;
import dev.emcc.plugins.nvg.codec.Kind;
import dev.emcc.plugins.nvg.codec.Limits;
import dev.emcc.plugins.nvg.codec.NvgDocument;
import dev.emcc.plugins.nvg.codec.NvgReader;
import dev.emcc.plugins.nvg.codec.NvgWriter;
import dev.emcc.sdk.Classifications;
import dev.emcc.sdk.geo.Geodesy;
import dev.emcc.sdk.json.JsonArray;
import dev.emcc.sdk.json.JsonObject;
import dev.emcc.sdk.json.JsonString;
import dev.emcc.sdk.model.Actor;
import dev.emcc.sdk.model.ExternalRef;
import dev.emcc.sdk.model.Geometry;
import dev.emcc.sdk.model.MapObject;
import dev.emcc.sdk.model.MapObjectContent;
import dev.emcc.sdk.model.Meta;
import dev.emcc.sdk.model.Position;
import dev.emcc.sdk.model.SecurityLabel;
import dev.emcc.sdk.model.Style;
import dev.emcc.sdk.model.Symbol;
import dev.emcc.sdk.model.SymbolStandard;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * The mapping both ways (brief, section 3; acceptance criteria 3 to 11). Every position has
 * latitude ≠ longitude, and the ellipses have different axes (ADR-0055 point 7).
 */
class MappingTest {

  private static final UUID LAYER = UUID.fromString("00000000-0000-0000-0000-00000000000a");
  private static final SecurityLabel DEFAULT = SecurityLabel.of("NATO", "UNCLASSIFIED");
  private static final ItemMapper.Context CTX = new ItemMapper.Context("nvg-file", LAYER, DEFAULT, Classifications.nato());
  private static final Instant NOW = Instant.parse("2026-11-12T10:00:00Z");

  private static Item item(String body) {
    NvgDocument doc = NvgReader.read(Samples.doc(body), Limits.DEFAULT).document();
    assertThat(doc.items()).hasSize(1);
    return doc.items().getFirst();
  }

  private static MapObjectContent in(String body) {
    ItemMapper.Mapped m = ItemMapper.map(item(body), CTX);
    assertThat(m.skipped()).isNull();
    return m.content();
  }

  /** As the store would hold it after an import: with the item's uri as its external identity. */
  private static MapObject stored(MapObjectContent content, String uri) {
    var audit = new Meta.Audit(NOW, Actor.plugin("nvg"));
    return new MapObject(UUID.nameUUIDFromBytes(uri.getBytes()), 1, content, new Meta(audit, audit, new ExternalRef("nvg-file:x.nvg", uri)));
  }

  private static Item out(String body) {
    Item before = item(body);
    Item after = ObjectMapper.toItem(stored(ItemMapper.map(before, CTX).content(), before.uri()));
    // Whatever goes out is valid NVG.
    Xsd.validate(NvgWriter.write(null, NOW, List.of(new NvgWriter.Group("urn:g", "G", List.of(after)))));
    return after;
  }

  private static Position at(MapObjectContent c) {
    return ((Geometry.Point) c.geometry()).coordinates();
  }

  // --- criterion 3 --------------------------------------------------------------------------

  @Test
  void criterion3_anApp6bPointWithSpeedAndCourse() {
    MapObjectContent c = in("<point uri=\"u\" x=\"15.2\" y=\"58.4\" symbol=\"app6b:SFGPUCI----D---\" speed=\"36\" course=\"45\"/>");
    assertThat(c.type()).isEqualTo(MapObjectContent.SYMBOL);
    assertThat(c.dataType()).isEqualTo(MapObjectContent.GENERAL);
    assertThat(at(c)).isEqualTo(Position.of(15.2, 58.4));
    assertThat(c.symbol().standard()).isEqualTo(SymbolStandard.APP_6B);
    assertThat(c.symbol().sidc()).isEqualTo("SFGPUCI----D---");
    assertThat(c.symbol().modifiers().speed()).isCloseTo(10, within(1e-9));
    assertThat(c.symbol().modifiers().direction()).isEqualTo(45);

    Item back = out("<point uri=\"u\" x=\"15.2\" y=\"58.4\" symbol=\"app6b:SFGPUCI----D---\" speed=\"36\" course=\"45\"/>");
    assertThat(back.attributes()).containsEntry("symbol", "app6b:SFGPUCI----D---").containsEntry("x", "15.2").containsEntry("y", "58.4")
        .containsEntry("speed", "36").containsEntry("course", "45");
  }

  @Test
  void criterion3_app6dApp06AndApp6eSymbols() {
    assertThat(in("<point uri=\"u\" x=\"15.2\" y=\"58.4\" symbol=\"app6d:10031000001211000000\"/>").symbol())
        .isEqualTo(new Symbol(SymbolStandard.APP_6D, "10031000001211000000", null));
    assertThat(in("<point uri=\"u\" x=\"15.2\" y=\"58.4\" symbol=\"app06:10031000001211000000\"/>").symbol())
        .isEqualTo(new Symbol(SymbolStandard.APP_6D, "10031000001211000000", null));
    assertThat(in("<point uri=\"u\" x=\"15.2\" y=\"58.4\" symbol=\"app6e:130310000012110000000000000001\"/>").symbol())
        .isEqualTo(new Symbol(SymbolStandard.APP_6E, "130310000012110000000000000001", null));
    // NV3: ANET's APP-6D, 30 digits whose last ten are zeros.
    assertThat(in("<point uri=\"u\" x=\"15.2\" y=\"58.4\" symbol=\"app06:100340000013100000000000000000\"/>").symbol())
        .isEqualTo(new Symbol(SymbolStandard.APP_6D, "10034000001310000000", null));
  }

  @Test
  void criterion3_anotherSchemeGivesTheUnknownSymbolWithTheCodeKept() {
    MapObjectContent c = in("<point uri=\"u\" x=\"15.2\" y=\"58.4\" symbol=\"2525b:SFGPUCI----D---\"/>");
    assertThat(c.symbol()).isEqualTo(new Symbol(SymbolStandard.APP_6D, "10000000000000000000", null));
    assertThat(c.extensions().get("nvg").getString("symbol")).isEqualTo("2525b:SFGPUCI----D---");
  }

  @Test
  void criterion3_eachGoesOutAsItCame() {
    for (String symbol : List.of("app6b:SFGPUCI----D---", "app6d:10031000001211000000", "app06:10031000001211000000",
        "app6e:130310000012110000000000000001", "app06:100340000013100000000000000000", "2525b:SFGPUCI----D---")) {
      assertThat(out("<point uri=\"u\" x=\"15.2\" y=\"58.4\" symbol=\"" + symbol + "\"/>").attribute("symbol")).isEqualTo(symbol);
    }
  }

  @Test
  void aChangedSymbolGoesOutInTheOwnersSchemes() {
    Item item = item("<point uri=\"u\" x=\"15.2\" y=\"58.4\" symbol=\"app06:10031000001211000000\"/>");
    MapObjectContent c = ItemMapper.map(item, CTX).content();
    MapObjectContent changed = new MapObjectContent(c.type(), c.dataType(), c.dataSource(), c.time(), c.layerId(), c.geometry(),
        new Symbol(SymbolStandard.APP_6D, "10061000001211000000", null), c.style(), c.properties(), c.label(), c.extensions());
    assertThat(ObjectMapper.toItem(stored(changed, "u")).attribute("symbol")).isEqualTo("app6d:10061000001211000000");
  }

  @Test
  void aVesselGoesOutAsTheSeaSurfaceSymbolOfItsIdentity() {
    MapObjectContent vessel = new MapObjectContent(MapObjectContent.SYMBOL, "ais.vessel", "vernon", null, LAYER,
        new Geometry.Point(Position.of(11.9, 57.7)), Symbol.vessel(Symbol.IDENTITY_NEUTRAL, 70, null), null, null, DEFAULT,
        dev.emcc.sdk.model.Extensions.empty());
    var audit = new Meta.Audit(NOW, Actor.plugin("ais"));
    Item item = ObjectMapper.toItem(new MapObject(UUID.randomUUID(), 1, vessel, new Meta(audit, audit, new ExternalRef("ais", "265547250"))));
    assertThat(item.attribute("symbol")).isEqualTo("app6d:10043000001400000000");
    assertThat(item.uri()).startsWith("urn:uuid:");
  }

  // --- criterion 4 --------------------------------------------------------------------------

  @Test
  void criterion4_shapesComeInAndGoOutWithTheSameValues() {
    MapObjectContent line = in("<polyline uri=\"u\" points=\"11.9746,57.7089 12.1,57.8 12.3,57.75\"/>");
    assertThat(line.type()).isEqualTo(MapObjectContent.SHAPE);
    assertThat(line.geometry()).isEqualTo(new Geometry.LineString(List.of(Position.of(11.9746, 57.7089), Position.of(12.1, 57.8), Position.of(12.3, 57.75))));
    assertThat(out("<polyline uri=\"u\" points=\"11.9746,57.7089 12.1,57.8 12.3,57.75\"/>").attribute("points"))
        .isEqualTo("11.9746,57.7089 12.1,57.8 12.3,57.75");

    String polygon = "<polygon uri=\"u\" points=\"11.9,57.6 12.1,57.6 12.1,57.8 11.9,57.8\"><exclude>"
        + "<linear-ring points=\"11.95,57.65 12.05,57.65 12.05,57.75 11.95,57.75\"/></exclude></polygon>";
    Geometry.Polygon p = (Geometry.Polygon) in(polygon).geometry();
    assertThat(p.rings()).hasSize(2);
    assertThat(p.rings().get(0)).hasSize(5).startsWith(Position.of(11.9, 57.6)).endsWith(Position.of(11.9, 57.6));
    assertThat(p.rings().get(1)).hasSize(5).startsWith(Position.of(11.95, 57.65));
    Item back = out(polygon);
    assertThat(back.attribute("points")).isEqualTo("11.9,57.6 12.1,57.6 12.1,57.8 11.9,57.8");
    assertThat(back.excludes()).hasSize(1);
    assertThat(back.excludes().getFirst().attributes()).containsEntry("points", "11.95,57.65 12.05,57.65 12.05,57.75 11.95,57.75");

    assertThat(in("<circle uri=\"u\" cx=\"11.9746\" cy=\"57.7089\" r=\"2500\"/>").geometry())
        .isEqualTo(new Geometry.Circle(Position.of(11.9746, 57.7089), 2500));
    assertThat(out("<circle uri=\"u\" cx=\"11.9746\" cy=\"57.7089\" r=\"2500\"/>").attributes())
        .containsEntry("cx", "11.9746").containsEntry("cy", "57.7089").containsEntry("r", "2500");

    assertThat(in("<corridor uri=\"u\" points=\"12.0,56.9 12.4,57.0\" width=\"2000\"/>").geometry())
        .isEqualTo(new Geometry.Corridor(List.of(Position.of(12.0, 56.9), Position.of(12.4, 57.0)), 2000));
    assertThat(out("<corridor uri=\"u\" points=\"12.0,56.9 12.4,57.0\" width=\"2000\"/>").attributes())
        .containsEntry("points", "12,56.9 12.4,57").containsEntry("width", "2000");

    assertThat(in("<arcband uri=\"u\" cx=\"13.5\" cy=\"56.4\" minr=\"1000\" maxr=\"5000\" startangle=\"300\" endangle=\"60\"/>").geometry())
        .isEqualTo(new Geometry.ArcBand(Position.of(13.5, 56.4), 1000, 5000, 300, 60));
    assertThat(out("<arcband uri=\"u\" cx=\"13.5\" cy=\"56.4\" minr=\"1000\" maxr=\"5000\" startangle=\"300\" endangle=\"60\"/>").attributes())
        .containsEntry("minr", "1000").containsEntry("maxr", "5000").containsEntry("startangle", "300").containsEntry("endangle", "60");
  }

  @Test
  void aRhumbLineIsDensifiedAndItsLegTypeKept() {
    MapObjectContent c = in("<polyline uri=\"u\" points=\"11.0,57.0 12.0,58.0\" leg-type=\"rhumb-line\"/>");
    Geometry.LineString l = (Geometry.LineString) c.geometry();
    assertThat(l.coordinates().size()).isGreaterThan(10);
    assertThat(l.coordinates().getFirst()).isEqualTo(Position.of(11.0, 57.0));
    assertThat(l.coordinates().getLast()).isEqualTo(Position.of(12.0, 58.0));
    assertThat(c.extensions().get("nvg").getString("legType")).isEqualTo("rhumb-line");
    // A rhumb line keeps its bearing: every leg's initial azimuth is the same within a tenth of a degree.
    double first = Geodesy.inverse(l.coordinates().get(0), l.coordinates().get(1)).initialAzimuth();
    double last = Geodesy.inverse(l.coordinates().get(l.coordinates().size() - 2), l.coordinates().getLast()).initialAzimuth();
    assertThat(last).isCloseTo(first, within(0.1));
  }

  // --- criterion 5 --------------------------------------------------------------------------

  @Test
  void criterion5_theEllipse() {
    Geometry.Ellipse wide = (Geometry.Ellipse) in("<ellipse uri=\"u\" cx=\"11.9746\" cy=\"57.7089\" rx=\"2000\" ry=\"1000\" rotation=\"30\"/>").geometry();
    assertThat(wide.semiMajorAxis()).isEqualTo(2000);
    assertThat(wide.semiMinorAxis()).isEqualTo(1000);
    assertThat(wide.rotation()).isCloseTo(60, within(1e-9));
    Geometry.Ellipse tall = (Geometry.Ellipse) in("<ellipse uri=\"u\" cx=\"11.9746\" cy=\"57.7089\" rx=\"1000\" ry=\"2000\" rotation=\"30\"/>").geometry();
    assertThat(tall.rotation()).isCloseTo(150, within(1e-9));

    for (String ellipse : List.of("<ellipse uri=\"u\" cx=\"11.9746\" cy=\"57.7089\" rx=\"2000\" ry=\"1000\" rotation=\"30\"/>",
        "<ellipse uri=\"u\" cx=\"11.9746\" cy=\"57.7089\" rx=\"1000\" ry=\"2000\" rotation=\"30\"/>")) {
      Item before = item(ellipse);
      Item after = out(ellipse);
      // The same footprint: four points of each, in the directions of the axes, within 1 m.
      for (double angle : new double[] {0, 90, 180, 270}) {
        Position p1 = Geo.onEllipse(Position.of(11.9746, 57.7089), num(before, "rx"), num(before, "ry"), num(before, "rotation"), angle);
        Position p2 = nearestOnEllipse(after, p1);
        assertThat(Geodesy.inverse(p1, p2).distanceMetres()).as("footprint at %s°", angle).isLessThan(1);
      }
    }
  }

  private static Position nearestOnEllipse(Item e, Position target) {
    Position best = null;
    double bestDistance = Double.MAX_VALUE;
    for (int i = 0; i < 36_000; i++) {
      Position p = Geo.onEllipse(Position.of(num(e, "cx"), num(e, "cy")), num(e, "rx"), num(e, "ry"), num(e, "rotation"), i / 100.0);
      double d = Geodesy.inverse(p, target).distanceMetres();
      if (d < bestDistance) {
        bestDistance = d;
        best = p;
      }
    }
    return best;
  }

  private static double num(Item item, String name) {
    return Double.parseDouble(item.attribute(name));
  }

  // --- criterion 6 --------------------------------------------------------------------------

  @Test
  void criterion6_rectCornersLieOnItsGeodesicOutline() {
    Geometry.Polygon p = (Geometry.Polygon) in("<rect uri=\"u\" cx=\"12.5\" cy=\"57.5\" rx=\"3000\" ry=\"1000\" rotation=\"20\"/>").geometry();
    List<Position> ring = p.rings().getFirst();
    assertThat(ring).hasSize(5);
    Position center = Position.of(12.5, 57.5);
    // Opposite sides have the same ground length, the sides' middles lie rx and ry from the centre.
    double north = Geodesy.inverse(ring.get(0), ring.get(1)).distanceMetres();
    double south = Geodesy.inverse(ring.get(2), ring.get(3)).distanceMetres();
    double west = Geodesy.inverse(ring.get(1), ring.get(2)).distanceMetres();
    double east = Geodesy.inverse(ring.get(3), ring.get(0)).distanceMetres();
    assertThat(north).isCloseTo(south, within(1.0));
    assertThat(west).isCloseTo(2000, within(1.0));
    assertThat(east).isCloseTo(2000, within(1.0));
    Position eastMiddle = Geodesy.path(List.of(ring.get(3), ring.get(0))).at(1000).position();
    assertThat(Geodesy.inverse(center, eastMiddle).distanceMetres()).isCloseTo(3000, within(1.0));
    assertThat(Geodesy.inverse(center, eastMiddle).initialAzimuth()).isCloseTo(70, within(0.01));
  }

  @Test
  void criterion6_arcPointsLieOnTheEllipseAtMostADegreeApart() {
    Geometry.LineString l = (Geometry.LineString) in("<arc uri=\"u\" cx=\"13.0\" cy=\"56.5\" rx=\"5000\" ry=\"3000\" rotation=\"10\" startangle=\"0\" endangle=\"90\"/>").geometry();
    assertThat(l.coordinates()).hasSize(91);
    Position center = Position.of(13.0, 56.5);
    // The first point is on the north-south axis rotated by 10° counter-clockwise: ry away, bearing 350.
    assertThat(Geodesy.inverse(center, l.coordinates().getFirst()).distanceMetres()).isCloseTo(3000, within(1.0));
    assertThat(Geodesy.inverse(center, l.coordinates().getFirst()).initialAzimuth()).isCloseTo(350, within(0.01));
    assertThat(Geodesy.inverse(center, l.coordinates().getLast()).distanceMetres()).isCloseTo(5000, within(1.0));
    assertThat(Geodesy.inverse(center, l.coordinates().getLast()).initialAzimuth()).isCloseTo(80, within(0.01));
  }

  @Test
  void criterion6_theOrbitIsARacetrackWidthWide() {
    Geometry.Polygon p = (Geometry.Polygon) in("<orbit uri=\"u\" points=\"13.0,57.0 13.5,57.2\" width=\"4000\"/>").geometry();
    Position a = Position.of(13.0, 57.0);
    Position b = Position.of(13.5, 57.2);
    List<Position> ring = p.rings().getFirst();
    assertThat(ring.getFirst()).isEqualTo(ring.getLast());
    for (Position q : ring) {
      double toNearest = Math.min(Geodesy.inverse(a, q).distanceMetres(), Geodesy.inverse(b, q).distanceMetres());
      // Every point of the half circles is 2000 m from its end point; the side points are the half circles' ends.
      assertThat(toNearest).isCloseTo(2000, within(1.0));
    }
  }

  // --- criterion 7 --------------------------------------------------------------------------

  @Test
  void criterion7_text() {
    MapObjectContent c = in("<text uri=\"u\" x=\"15.2\" y=\"58.4\" rotation=\"30\"><content>Karlskrona</content></text>");
    assertThat(c.type()).isEqualTo(MapObjectContent.TEXT);
    assertThat(at(c)).isEqualTo(Position.of(15.2, 58.4));
    assertThat(c.text().value()).isEqualTo("Karlskrona");
    assertThat(c.text().rotation()).isEqualTo(330);
    Item back = out("<text uri=\"u\" x=\"15.2\" y=\"58.4\" rotation=\"30\"><content>Karlskrona</content></text>");
    assertThat(back.kind()).isEqualTo(Kind.TEXT);
    assertThat(back.attribute("rotation")).isEqualTo("30");
    assertThat(back.content()).isEqualTo("Karlskrona");
  }

  @Test
  void aTextsFillIsItsColourAndItsOtherCssIsKept() {
    // Owner, 2026-11-12: a core.text's colour is style.strokeColor (data model 1.6.0), and an NVG
    // text's fill colours its letters, so fill ↔ strokeColor; its own stroke is kept, not mapped.
    String red = "<text uri=\"u\" x=\"15.2\" y=\"58.4\" style=\"fill:#f00;stroke:#000000;font-size:12px\"><content>K</content></text>";
    MapObjectContent c = in(red);
    assertThat(c.style()).isEqualTo(new Style("#FF0000", null, null, null, null, null));
    assertThat(c.extensions().get("nvg").getString("style")).isEqualTo("fill:#f00;stroke:#000000;font-size:12px");
    assertThat(out(red).attribute("style")).isEqualTo("fill:#FF0000;stroke:#000000;font-size:12px");

    MapObjectContent plain = in("<text uri=\"u\" x=\"15.2\" y=\"58.4\" style=\"fill:#00ff00\"><content>K</content></text>");
    assertThat(plain.style().strokeColor()).isEqualTo("#00FF00");
    assertThat(plain.style().fillColor()).isNull();
    assertThat(plain.extensions().get("nvg").has("style")).isFalse();

    // A new colour goes out as the fill, never next to the old one; a fill that is not a colour is kept.
    assertThat(Css.writeText(new Style("#0000FF", null, null, null, null, null), "fill:#f00;stroke:#000000"))
        .isEqualTo("fill:#0000FF;stroke:#000000");
    assertThat(Css.writeText(null, "fill:#f00;stroke:#000000")).isEqualTo("stroke:#000000");
    assertThat(Css.readText("fill:none").style()).isNull();
    assertThat(Css.writeText(null, "fill:none")).isEqualTo("fill:none");
  }

  // --- criterion 8 --------------------------------------------------------------------------

  @Test
  void criterion8_aGraphicKeepsItsPointsInTheOrderSent() {
    String multipoint = "<multipoint uri=\"u\" symbol=\"app6d:10002500001101000000\" points=\"15.3,56.1 15.1,56.1 15.2,56.15\"/>";
    MapObjectContent c = in(multipoint);
    assertThat(c.type()).isEqualTo(MapObjectContent.MULTIPOINT);
    assertThat(c.geometry()).isEqualTo(new Geometry.MultiPoint(List.of(Position.of(15.3, 56.1), Position.of(15.1, 56.1), Position.of(15.2, 56.15))));
    Item back = out(multipoint);
    assertThat(back.kind()).isEqualTo(Kind.MULTIPOINT);
    assertThat(back.attribute("points")).isEqualTo("15.3,56.1 15.1,56.1 15.2,56.15");
    assertThat(back.attribute("symbol")).isEqualTo("app6d:10002500001101000000");
    // A line with a graphic's code is a graphic too, and goes back as a line.
    MapObjectContent line = in("<polyline uri=\"u\" symbol=\"app6b:GFGPGLB----K---\" points=\"15.3,56.1 15.1,56.2\"/>");
    assertThat(line.type()).isEqualTo(MapObjectContent.MULTIPOINT);
    assertThat(out("<polyline uri=\"u\" symbol=\"app6b:GFGPGLB----K---\" points=\"15.3,56.1 15.1,56.2\"/>").kind()).isEqualTo(Kind.POLYLINE);
  }

  // --- criterion 9 --------------------------------------------------------------------------

  @Test
  void criterion9_groupPathsAndCompositeParts() {
    NvgDocument doc = NvgReader.read(Samples.doc("<g uri=\"a\" label=\"A\"><g uri=\"b\" label=\"B\"><point uri=\"p\" x=\"15.2\" y=\"58.4\"/></g></g>"
        + "<composite uri=\"c\"><polyline uri=\"c1\" points=\"14.0,56.0 14.1,56.1\"/><polyline uri=\"c2\" points=\"14.1,56.1 14.2,56.0\"/>"
        + "<point uri=\"c3\" x=\"14.1\" y=\"56.05\"/></composite>"), Limits.DEFAULT).document();
    MapObjectContent p = ItemMapper.map(doc.items().getFirst(), CTX).content();
    assertThat(p.extensions().get("nvg").get("groupPath")).isEqualTo(JsonArray.of(JsonString.of("A"), JsonString.of("B")));
    List<MapObjectContent> parts = doc.items().subList(1, 4).stream().map(i -> ItemMapper.map(i, CTX).content()).toList();
    assertThat(parts).hasSize(3);
    assertThat(parts).allSatisfy(c -> assertThat(c.extensions().get("nvg").getString("composite")).isEqualTo("c"));
    // The relations themselves are added by the writer, which knows the first part's id (SyncTest).
  }

  // --- criterion 10 -------------------------------------------------------------------------

  @Test
  void criterion10_commonAttributesComeInAndGoBack() {
    String point = "<point uri=\"u\" x=\"15.2\" y=\"58.4\" z=\"12.5\" label=\"Rifle company\" href=\"https://example.invalid/1\" "
        + "style=\"stroke:#112233;font-weight:bold\" rotation=\"15\">"
        + "<ExtendedData schemaRef=\"#s\"><SimpleData key=\"strength\">120</SimpleData></ExtendedData>"
        + "<textInfo>Dug in.</textInfo><TimeStamp>2026-11-12T07:30:00Z</TimeStamp>"
        + "<TimeSpan><begin>2026-11-12T06:00:00Z</begin><end>2026-11-13T06:00:00Z</end></TimeSpan></point>";
    MapObjectContent c = in(point);
    assertThat(c.properties().name()).isEqualTo("Rifle company");
    assertThat(c.properties().description()).isEqualTo("Dug in.");
    assertThat(c.time().observed()).isEqualTo(Instant.parse("2026-11-12T07:30:00Z"));
    assertThat(c.time().validFrom()).isEqualTo(Instant.parse("2026-11-12T06:00:00Z"));
    assertThat(c.time().expires()).isEqualTo(Instant.parse("2026-11-13T06:00:00Z"));
    assertThat(c.style().strokeColor()).isEqualTo("#112233");
    JsonObject ext = c.extensions().get("nvg");
    assertThat(ext.getString("href")).isEqualTo("https://example.invalid/1");
    assertThat(ext.getNumber("z").doubleValue()).isEqualTo(12.5);
    assertThat(ext.getString("style")).contains("font-weight:bold");
    assertThat(ext.getString("extendedData")).contains("strength");
    assertThat(ext.getObject("attributes").getString("rotation")).isEqualTo("15");

    Item back = out(point);
    assertThat(back.attributes()).containsEntry("label", "Rifle company").containsEntry("href", "https://example.invalid/1")
        .containsEntry("z", "12.5").containsEntry("rotation", "15");
    assertThat(back.attribute("style")).isEqualTo("stroke:#112233;font-weight:bold");
    assertThat(back.textInfo()).isEqualTo("Dug in.");
    assertThat(back.timeStamp()).isEqualTo("2026-11-12T07:30:00Z");
    assertThat(back.timeBegin()).isEqualTo("2026-11-12T06:00:00Z");
    assertThat(back.timeEnd()).isEqualTo("2026-11-13T06:00:00Z");
    assertThat(back.extendedData()).contains("strength").contains("120");
  }

  @Test
  void cssMapsTheStrokeAndFillAndDashes() {
    Style s = in("<polyline uri=\"u\" points=\"1,2 3,4\" style=\"stroke:#f00;stroke-width:3px;stroke-dasharray:8,4;fill:#00ff00;fill-opacity:0.25\"/>").style();
    assertThat(s).isEqualTo(new Style("#FF0000", 3.0, null, Style.Dash.DASH, "#00FF00", 0.25));
    assertThat(in("<polyline uri=\"u\" points=\"1,2 3,4\" style=\"stroke-dasharray:2 4\"/>").style().strokeDash()).isEqualTo(Style.Dash.DOT);
  }

  @Test
  void anArrowHasAnArrowheadAndKeepsItsWidth() {
    MapObjectContent c = in("<arrow uri=\"u\" points=\"12.0,57.0 12.2,57.1\" width=\"500\"/>");
    assertThat(c.style().arrowhead()).isEqualTo(Style.Arrowhead.END);
    assertThat(c.extensions().get("nvg").getNumber("width").doubleValue()).isEqualTo(500);
    Item back = out("<arrow uri=\"u\" points=\"12.0,57.0 12.2,57.1\" width=\"500\"/>");
    assertThat(back.kind()).isEqualTo(Kind.ARROW);
    assertThat(back.attribute("width")).isEqualTo("500");
  }

  // --- criterion 11 -------------------------------------------------------------------------

  @Test
  void criterion11_itemLabelElseDocumentElseLink() {
    NvgDocument doc = NvgReader.read(Samples.everyElement(), Limits.DEFAULT).document();
    assertThat(ItemMapper.map(doc.items().getFirst(), CTX).content().label().classification()).isEqualTo("UNCLASSIFIED");
    Item text = doc.items().stream().filter(i -> i.uri().equals("urn:sample:text")).findFirst().orElseThrow();
    assertThat(ItemMapper.map(text, CTX).content().label().classification()).isEqualTo("RESTRICTED");
    // Without either, the link's (here the context's fallback).
    SecurityLabel link = SecurityLabel.of("NATO", "CONFIDENTIAL");
    var linkCtx = new ItemMapper.Context("anet", LAYER, link, Classifications.nato());
    assertThat(ItemMapper.map(item("<point uri=\"u\" x=\"15.2\" y=\"58.4\"/>"), linkCtx).content().label()).isEqualTo(link);
  }

  @Test
  void criterion11_anUnknownClassificationIsSkippedAndCounted() {
    Item item = item("<point uri=\"u\" x=\"15.2\" y=\"58.4\"><metadata>"
        + "<slab:ConfidentialityLabel xmlns:slab=\"urn:nato:stanag:4774:confidentialitymetadatalabel:1:0\"><slab:ConfidentialityInformation>"
        + "<slab:PolicyIdentifier>NATO</slab:PolicyIdentifier><slab:Classification>VERY SECRET</slab:Classification>"
        + "</slab:ConfidentialityInformation></slab:ConfidentialityLabel></metadata></point>");
    assertThat(ItemMapper.map(item, CTX).skipped()).isEqualTo("label not understood");
  }

  // --- the rest -----------------------------------------------------------------------------

  @Test
  void everyItemOfTheSampleMapsAndGoesOutAsValidNvg() {
    NvgDocument doc = NvgReader.read(Samples.everyElement(), Limits.DEFAULT).document();
    List<Item> out = doc.items().stream().map(i -> {
      ItemMapper.Mapped m = ItemMapper.map(i, CTX);
      assertThat(m.skipped()).as(i.uri()).isNull();
      return ObjectMapper.toItem(stored(m.content(), i.uri()));
    }).toList();
    Xsd.validate(NvgWriter.write(doc.label(), NOW, List.of(new NvgWriter.Group("urn:g", "G", out))));
    assertThat(out).extracting(Item::uri).isEqualTo(doc.items().stream().map(Item::uri).toList());
  }

  @Test
  void badGeometryIsSkippedWithItsCounter() {
    assertThat(ItemMapper.map(item("<point uri=\"u\" x=\"215.2\" y=\"58.4\"/>"), CTX).skipped()).isEqualTo("skipped: bad geometry");
    assertThat(ItemMapper.map(item("<polyline uri=\"u\" points=\"1,2\"/>"), CTX).skipped()).isEqualTo("skipped: bad geometry");
    assertThat(ItemMapper.map(item("<circle uri=\"u\" cx=\"1\" cy=\"2\" r=\"0\"/>"), CTX).skipped()).isEqualTo("skipped: bad geometry");
    // An optional value out of range is left out, and the rest used.
    ItemMapper.Mapped m = ItemMapper.map(item("<point uri=\"u\" x=\"15.2\" y=\"58.4\" course=\"400\"/>"), CTX);
    assertThat(m.skipped()).isNull();
    assertThat(m.notes()).containsExactly("value out of range");
  }

  @Test
  void anObjectNotFromNvgGetsAUuidUriAndAShapePointGetsTheUnknownSymbol() {
    MapObjectContent shape = new MapObjectContent(MapObjectContent.SHAPE, MapObjectContent.GENERAL, "manual", null, LAYER,
        new Geometry.Point(Position.of(15.2, 58.4)), null, null, null, DEFAULT, dev.emcc.sdk.model.Extensions.empty());
    var audit = new Meta.Audit(NOW, Actor.plugin("draw-shapes"));
    UUID id = UUID.randomUUID();
    Item item = ObjectMapper.toItem(new MapObject(id, 1, shape, new Meta(audit, audit, null)));
    assertThat(item.uri()).isEqualTo("urn:uuid:" + id);
    assertThat(item.kind()).isEqualTo(Kind.POINT);
    assertThat(item.attribute("symbol")).isEqualTo("unknown:unknown");
    MapObjectContent route = new MapObjectContent("simulator.route", "core.general", "manual", null, LAYER,
        new Geometry.LineString(List.of(Position.of(15.2, 58.4), Position.of(15.3, 58.5))), null, null, null, DEFAULT,
        dev.emcc.sdk.model.Extensions.empty());
    assertThat(ObjectMapper.toItem(new MapObject(id, 1, route, new Meta(audit, audit, null))).kind()).isEqualTo(Kind.POLYLINE);
  }
}
