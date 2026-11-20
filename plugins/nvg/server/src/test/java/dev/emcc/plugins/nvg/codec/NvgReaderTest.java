package dev.emcc.plugins.nvg.codec;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.nvg.Samples;
import dev.emcc.sdk.Bytes;
import dev.emcc.sdk.model.SecurityLabel;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** The reader: versions, the brief's XML safety, limits, groups, composites and labels. */
class NvgReaderTest {

  private static NvgDocument read(Bytes bytes) {
    ReadResult result = NvgReader.read(bytes, Limits.DEFAULT);
    assertThat(result.reason()).isNull();
    return result.document();
  }

  private static ReadResult refused(Bytes bytes, Limits limits) {
    ReadResult result = NvgReader.read(bytes, limits);
    assertThat(result.isRefused()).as("refused").isTrue();
    return result;
  }

  @ParameterizedTest
  @ValueSource(strings = {"2.0.0", "2.0.1", "2.0.2"})
  void criterion1_readsVersions2_0_0To2_0_2(String version) {
    NvgDocument doc = read(Samples.doc(version, "<point uri=\"u\" x=\"15.2\" y=\"58.4\"/>"));
    assertThat(doc.version()).isEqualTo(version);
    assertThat(doc.items()).hasSize(1);
  }

  @ParameterizedTest
  @ValueSource(strings = {"1.5", "3.0"})
  void criterion1_refusesOtherVersionsWithTheReason(String version) {
    ReadResult r = refused(Samples.doc(version, "<point uri=\"u\" x=\"15.2\" y=\"58.4\"/>"), Limits.DEFAULT);
    assertThat(r.counter()).isEqualTo("refused: version");
    assertThat(r.reason()).isEqualTo("NVG " + version + " is not supported; 2.0.x only");
  }

  @Test
  void criterion2_aDocumentWithADtdIsRefused() {
    ReadResult r = refused(Bytes.utf8("<?xml version=\"1.0\"?><!DOCTYPE nvg [<!ELEMENT nvg ANY>]>"
        + "<nvg xmlns=\"https://tide.act.nato.int/schemas/2012/10/nvg\" version=\"2.0.2\"/>"), Limits.DEFAULT);
    assertThat(r.counter()).isEqualTo("refused: DTD");
  }

  @Test
  void criterion2_anExternalEntityIsNeverResolved() {
    // The entity points at a file that exists on every Windows and Linux machine; nothing may be read.
    for (String target : List.of("file:///c:/windows/win.ini", "file:///etc/hostname", "http://127.0.0.1:1/x")) {
      ReadResult r = refused(Bytes.utf8("<?xml version=\"1.0\"?><!DOCTYPE nvg [<!ENTITY x SYSTEM \"" + target + "\">]>"
          + "<nvg xmlns=\"https://tide.act.nato.int/schemas/2012/10/nvg\" version=\"2.0.2\"><text uri=\"t\" x=\"1\" y=\"2\"><content>&x;</content></text></nvg>"),
          Limits.DEFAULT);
      assertThat(r.counter()).isEqualTo("refused: DTD");
    }
  }

  @Test
  void criterion2_entityExpansionIsRefused() {
    ReadResult r = refused(Bytes.utf8("<?xml version=\"1.0\"?><!DOCTYPE nvg [<!ENTITY a \"aaaaaaaaaa\"><!ENTITY b \"&a;&a;&a;&a;&a;&a;&a;&a;\">]>"
        + "<nvg xmlns=\"https://tide.act.nato.int/schemas/2012/10/nvg\" version=\"2.0.2\"><text uri=\"t\" x=\"1\" y=\"2\"><content>&b;</content></text></nvg>"),
        Limits.DEFAULT);
    assertThat(r.counter()).isEqualTo("refused: DTD");
  }

  @Test
  void criterion2_deeperThan64IsRefused() {
    String open = "<g uri=\"g\">".repeat(64);
    String close = "</g>".repeat(64);
    ReadResult r = refused(Samples.doc(open + close), Limits.DEFAULT);
    assertThat(r.counter()).isEqualTo("refused: limit depth");
    // 63 groups inside the root are depth 64: read.
    assertThat(NvgReader.read(Samples.doc("<g uri=\"g\">".repeat(63) + "</g>".repeat(63)), Limits.DEFAULT).isRefused()).isFalse();
  }

  @Test
  void criterion2_moreThan100000ItemsIsRefused() {
    String item = "<point uri=\"u\" x=\"15.2\" y=\"58.4\"/>";
    ReadResult r = refused(Samples.doc(item.repeat(100_001)), Limits.DEFAULT);
    assertThat(r.counter()).isEqualTo("refused: limit items");
    assertThat(NvgReader.read(Samples.doc(item.repeat(100_000)), Limits.DEFAULT).document().items()).hasSize(100_000);
  }

  @Test
  void criterion2_over16MibIsRefusedBeforeParsing() {
    byte[] big = new byte[16 * 1024 * 1024 + 1];
    java.util.Arrays.fill(big, (byte) ' ');
    ReadResult r = refused(Bytes.of(big), Limits.DEFAULT);
    assertThat(r.counter()).isEqualTo("refused: limit size");
    assertThat(r.reason()).isEqualTo("the document is larger than 16 MiB");
  }

  @Test
  void criterion2_moreThanTheLimitOfPointsOrTextIsRefused() {
    Limits small = new Limits(Limits.MIB, 64, 100, 3, 20);
    assertThat(refused(Samples.doc("<polyline uri=\"u\" points=\"1,2 3,4 5,6 7,8\"/>"), small).counter()).isEqualTo("refused: limit points");
    assertThat(refused(Samples.doc("<point uri=\"u\" x=\"1\" y=\"2\" label=\"" + "x".repeat(21) + "\"/>"), small).counter()).isEqualTo("refused: limit text");
    assertThat(refused(Samples.doc("<text uri=\"u\" x=\"1\" y=\"2\"><content>" + "x".repeat(21) + "</content></text>"), small).counter())
        .isEqualTo("refused: limit text");
  }

  @Test
  void notXmlAndNotNvgAreRefused() {
    assertThat(refused(Bytes.utf8("this is not XML"), Limits.DEFAULT).counter()).isEqualTo("refused: not XML");
    assertThat(refused(Bytes.utf8("<nvg version=\"2.0.2\"><point></nvg>"), Limits.DEFAULT).counter()).isEqualTo("refused: not XML");
    assertThat(refused(Bytes.utf8("<kml version=\"2.0.2\"/>"), Limits.DEFAULT).counter()).isEqualTo("refused: not NVG");
    assertThat(refused(Bytes.empty(), Limits.DEFAULT).counter()).isEqualTo("refused: not XML");
  }

  @Test
  void theSampleIsFlattenedWithGroupsCompositesAndLabels() {
    NvgDocument doc = read(Samples.everyElement());
    assertThat(doc.label()).isEqualTo(new SecurityLabel(new SecurityLabel.Policy("NATO", null), "RESTRICTED", List.of(), Instant.parse("2026-11-12T08:00:00Z"), null));
    Item point = doc.items().getFirst();
    assertThat(point.kind()).isEqualTo(Kind.POINT);
    assertThat(point.uri()).isEqualTo("urn:sample:point");
    assertThat(point.groupPath()).containsExactly("A", "B");
    assertThat(point.label().classification()).isEqualTo("UNCLASSIFIED");
    assertThat(point.label().categories()).containsExactly(
        new SecurityLabel.Category("Releasable to", SecurityLabel.CategoryType.PERMISSIVE, null, List.of("SWE", "NATO")));
    assertThat(point.attributes()).containsEntry("symbol", "app6b:SFGPUCI----D---").containsEntry("speed", "36").containsEntry("z", "12.5");
    assertThat(point.textInfo()).isEqualTo("Second company, dug in.");
    assertThat(point.timeStamp()).isEqualTo("2026-11-12T07:30:00Z");
    assertThat(point.timeBegin()).isEqualTo("2026-11-12T06:00:00Z");
    assertThat(point.timeEnd()).isEqualTo("2026-11-13T06:00:00Z");
    assertThat(point.extendedData()).contains("SimpleData").contains("strength").contains("120");
    assertThat(point.extension()).isNull();

    // Items without their own label take the document's.
    Item text = byUri(doc, "urn:sample:text");
    assertThat(text.label().classification()).isEqualTo("RESTRICTED");
    assertThat(text.content()).isEqualTo("Karlskrona");

    Item polygon = byUri(doc, "urn:sample:polygon");
    assertThat(polygon.excludes()).containsExactly(new Ring("linear-ring", Map.of("points", "11.95,57.65 12.05,57.65 12.05,57.75 11.95,57.75")));

    List<Item> parts = doc.items().stream().filter(i -> i.part() > 0).toList();
    assertThat(parts).extracting(Item::uri).containsExactly("urn:sample:composite:1", "urn:sample:composite:2", "urn:sample:composite:3");
    assertThat(parts).allSatisfy(p -> assertThat(p.compositeUri()).isEqualTo("urn:sample:composite"));
    assertThat(parts).extracting(Item::part).containsExactly(1, 2, 3);

    assertThat(doc.skipped()).containsEntry("skipped: content-item", 1L);
    assertThat(doc.items()).hasSize(23);
  }

  @Test
  void aCompositePartWithoutUriIsNumberedAndAnotherItemWithoutUriSkipped() {
    NvgDocument doc = read(Samples.doc("<composite uri=\"c\"><point uri=\"p\" x=\"1\" y=\"2\"/><point x=\"1\" y=\"2\"/></composite><point x=\"1\" y=\"2\"/>"));
    assertThat(doc.items()).extracting(Item::uri).containsExactly("p", "c#2");
    assertThat(doc.skipped()).containsEntry("skipped: no uri", 1L);
  }

  @Test
  void foreignElementsInAnItemAreKeptAndOutsideOnesCounted() {
    NvgDocument doc = read(Samples.doc("<x:note xmlns:x=\"urn:other\">outside</x:note>"
        + "<point uri=\"u\" x=\"1\" y=\"2\"><x:note xmlns:x=\"urn:other\" x:level=\"3\">inside</x:note></point>"));
    assertThat(doc.skipped()).containsEntry("skipped: foreign element", 1L);
    assertThat(doc.items().getFirst().foreign()).contains("urn:other").contains("inside").contains("level");
  }

  @Test
  void aBrokenLabelIsMarkedUnreadable() {
    NvgDocument doc = read(Samples.doc("<point uri=\"u\" x=\"1\" y=\"2\"><metadata>"
        + "<slab:ConfidentialityLabel xmlns:slab=\"urn:nato:stanag:4774:confidentialitymetadatalabel:1:0\">"
        + "<slab:ConfidentialityInformation><slab:PolicyIdentifier>NATO</slab:PolicyIdentifier></slab:ConfidentialityInformation>"
        + "</slab:ConfidentialityLabel></metadata></point>"));
    assertThat(doc.items().getFirst().label()).isNull();
    assertThat(doc.items().getFirst().labelUnreadable()).isTrue();
  }

  @Test
  void aLabelInExtensionIsReadAndOtherExtensionContentKept() {
    NvgDocument doc = read(Samples.doc("<point uri=\"u\" x=\"1\" y=\"2\"><extension>"
        + "<slab:ConfidentialityLabel xmlns:slab=\"urn:nato:stanag:4774:confidentialitymetadatalabel:1:0\">"
        + "<slab:ConfidentialityInformation><slab:PolicyIdentifier>NATO</slab:PolicyIdentifier><slab:Classification>SECRET</slab:Classification>"
        + "</slab:ConfidentialityInformation></slab:ConfidentialityLabel><y:z xmlns:y=\"urn:y\">kept</y:z></extension></point>"));
    assertThat(doc.items().getFirst().label()).isEqualTo(SecurityLabel.of("NATO", "SECRET"));
    assertThat(doc.items().getFirst().extension()).contains("urn:y").contains("kept");
  }

  private static Item byUri(NvgDocument doc, String uri) {
    return doc.items().stream().filter(i -> i.uri().equals(uri)).findFirst().orElseThrow();
  }
}
