package dev.emcc.plugins.cot.codec;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import org.junit.jupiter.api.Test;

class CotXmlTest {

  private final CotXml xml = new CotXml();

  @Test
  void readsAnAtomWithEveryPart() throws Exception {
    CotEvent event = xml.parse(Samples.UNIT);
    assertThat(event.uid()).isEqualTo("ANDROID-358240051111110");
    assertThat(event.type()).isEqualTo("a-f-G-U-C-I");
    assertThat(event.how()).isEqualTo("m-g");
    assertThat(event.version()).isEqualTo("2.0");
    assertThat(event.time()).isEqualTo(Instant.parse("2026-10-03T08:20:00.000Z"));
    assertThat(event.start()).isEqualTo(Instant.parse("2026-10-03T08:20:00.000Z"));
    assertThat(event.stale()).isEqualTo(Instant.parse("2026-10-03T08:25:00.000Z"));
    // latitude and longitude differ, so a swap would show
    assertThat(event.lat()).isEqualTo(59.3507);
    assertThat(event.lon()).isEqualTo(18.1012);
    assertThat(event.hae()).isEqualTo(45.2);
    assertThat(event.ce()).isEqualTo("9999999.0");
    assertThat(event.le()).isEqualTo("9999999.0");
    assertThat(event.callsign()).isEqualTo("VIPER 2");
    assertThat(event.remarks()).isEqualTo("On patrol");
    assertThat(event.course()).isEqualTo(270.0);
    assertThat(event.speed()).isEqualTo(4.2);
    assertThat(event.isAtom()).isTrue();
    assertThat(event.isShown()).isTrue();
  }

  @Test
  void keepsTheWholeDetailExactlyAsReceived() throws Exception {
    CotEvent event = xml.parse(Samples.UNIT);
    String detail = event.detail();
    assertThat(detail).isNotNull();
    assertThat(detail).startsWith("<contact callsign=\"VIPER 2\" endpoint=\"*:-1:stcp\"/>").endsWith("</priv:plugin>");
    // a private plugin's element, with a namespace, an escaped attribute and a comment that looks like the end of <detail>
    assertThat(detail).contains("<priv:plugin xmlns:priv=\"urn:example:private\" note=\"a &gt; b, kept\"><!-- </detail> in a comment --></priv:plugin>");
    assertThat(detail).contains("<__group name=\"Cyan\" role=\"Team Member\"/>");
  }

  @Test
  void anEmptyOrMissingDetailIsNull() throws Exception {
    assertThat(xml.parse(Samples.at("a", 0, 10.5, 20.25)).detail()).isNull();
    String noDetail = "<event uid=\"a\" type=\"a-f-G\"><point lat=\"1.5\" lon=\"2.5\"/></event>";
    assertThat(xml.parse(noDetail).detail()).isNull();
    String blank = "<event uid=\"a\" type=\"a-f-G\"><point lat=\"1.5\" lon=\"2.5\"/><detail>  </detail></event>";
    assertThat(xml.parse(blank).detail()).isNull();
  }

  @Test
  void aNestedElementCalledDetailDoesNotEndTheDetail() throws Exception {
    String text = "<event uid=\"a\" type=\"a-f-G\"><point lat=\"1.5\" lon=\"2.5\"/><detail><x><detail k=\"v\"/></x><y/></detail></event>";
    assertThat(xml.parse(text).detail()).isEqualTo("<x><detail k=\"v\"/></x><y/>");
  }

  @Test
  void anUnknownHeightAndBadOptionalValuesDoNotSpoilTheEvent() throws Exception {
    String text = "<event uid=\"a\" type=\"a-f-G\"><point lat=\"1.5\" lon=\"2.5\" hae=\"high\"/>"
        + "<detail><track course=\"NaN\" speed=\"fast\"/></detail></event>";
    CotEvent event = xml.parse(text);
    assertThat(event.hae()).isNull();
    assertThat(event.course()).isNull();
    assertThat(event.speed()).isNull();
  }

  @Test
  void timesWithoutMillisecondsAndWithAnOffsetAreAccepted() throws Exception {
    String text = "<event uid=\"a\" type=\"a-f-G\" time=\"2026-10-03T08:20:00Z\" stale=\"2026-10-03T10:25:00.123456+02:00\">"
        + "<point lat=\"1.5\" lon=\"2.5\"/></event>";
    CotEvent event = xml.parse(text);
    assertThat(event.time()).isEqualTo(Instant.parse("2026-10-03T08:20:00.000Z"));
    assertThat(event.stale()).isEqualTo(Instant.parse("2026-10-03T08:25:00.123Z"));
  }

  @Test
  void whatIsNotAnEventIsRefused() {
    assertThatThrownBy(() -> xml.parse("<event uid=\"a\"")).isInstanceOf(CotParseException.class);
    assertThatThrownBy(() -> xml.parse("not xml")).isInstanceOf(CotParseException.class);
    assertThatThrownBy(() -> xml.parse("<other/>")).isInstanceOf(CotParseException.class).hasMessageContaining("<other>");
    assertThatThrownBy(() -> xml.parse("<event type=\"a-f-G\"><point lat=\"1\" lon=\"2\"/></event>")).hasMessageContaining("no uid");
    assertThatThrownBy(() -> xml.parse("<event uid=\"a\" type=\"a-f-G\"/>")).hasMessageContaining("no <point>");
    assertThatThrownBy(() -> xml.parse("<event uid=\"a\" type=\"a-f-G\"><point lat=\"95\" lon=\"2\"/></event>")).hasMessageContaining("latitude");
    assertThatThrownBy(() -> xml.parse("<event uid=\"a\" type=\"a-f-G\"><point lat=\"1\" lon=\"x\"/></event>")).hasMessageContaining("lon is not a number");
    assertThatThrownBy(() -> xml.parse("<event uid=\"a\" type=\"a-f-G\" time=\"yesterday\"><point lat=\"1\" lon=\"2\"/></event>"))
        .hasMessageContaining("time is not a time");
  }

  @Test
  void invalidUtf8IsRefused() {
    byte[] bad = "<event uid=\"a\" type=\"a-f-G\"><point lat=\"1\" lon=\"2\"/><detail>XX</detail></event>".getBytes(StandardCharsets.UTF_8);
    bad[bad.length - 20] = (byte) 0xC3; // a lead byte without its continuation
    bad[bad.length - 19] = (byte) 0x28;
    assertThatThrownBy(() -> xml.parse(bad, bad.length)).isInstanceOf(CotParseException.class).hasMessageContaining("UTF-8");
  }

  // ---------------------------------------------------------------- criterion 6: no XXE

  @Test
  void aDocumentWithADoctypeIsRefusedAndNothingIsResolved() {
    String xxe = "<?xml version=\"1.0\"?><!DOCTYPE event [<!ENTITY secret SYSTEM \"file:///c:/windows/win.ini\">]>"
        + "<event uid=\"a\" type=\"a-f-G\"><point lat=\"1\" lon=\"2\"/><detail><remarks>&secret;</remarks></detail></event>";
    assertThatThrownBy(() -> xml.parse(xxe)).isInstanceOf(CotParseException.class);
  }

  @Test
  void aDoctypeIsRefusedEvenWhenTheEventDoesNotUseIt() {
    String doctypeOnly = "<!DOCTYPE event [<!ENTITY a \"b\">]><event uid=\"a\" type=\"a-f-G\"><point lat=\"1\" lon=\"2\"/></event>";
    assertThatThrownBy(() -> xml.parse(doctypeOnly)).isInstanceOf(CotParseException.class);
  }

  @Test
  void anExternalDtdIsNeverFetched() {
    // The URL would fail to resolve or hang if the parser tried; the parser must refuse the DOCTYPE before it looks.
    String external = "<!DOCTYPE event SYSTEM \"http://192.0.2.1:9/evil.dtd\"><event uid=\"a\" type=\"a-f-G\"><point lat=\"1\" lon=\"2\"/></event>";
    long started = System.nanoTime();
    assertThatThrownBy(() -> xml.parse(external)).isInstanceOf(CotParseException.class);
    assertThat((System.nanoTime() - started) / 1_000_000).as("milliseconds: no network access").isLessThan(2_000);
  }

  @Test
  void aBillionLaughsIsRefused() {
    String laughs = "<!DOCTYPE event [<!ENTITY a \"aaaaaaaaaa\"><!ENTITY b \"&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;\">"
        + "<!ENTITY c \"&b;&b;&b;&b;&b;&b;&b;&b;&b;&b;\">]><event uid=\"a\" type=\"a-f-G\"><point lat=\"1\" lon=\"2\"/><detail>&c;</detail></event>";
    assertThatThrownBy(() -> xml.parse(laughs)).isInstanceOf(CotParseException.class);
  }

  @Test
  void aTooDeepDocumentIsRefused() {
    String deep = "<event uid=\"a\" type=\"a-f-G\"><point lat=\"1\" lon=\"2\"/><detail>" + "<x>".repeat(500) + "</x>".repeat(500) + "</detail></event>";
    assertThatThrownBy(() -> xml.parse(deep)).isInstanceOf(CotParseException.class);
  }

  // ---------------------------------------------------------------- writing

  @Test
  void aWrittenEventReadsBackAsTheSameEvent() throws Exception {
    CotEvent event = xml.parse(Samples.UNIT);
    assertThat(xml.parse(CotXml.write(event))).isEqualTo(event);
  }

  @Test
  void writingEscapesAndFillsInTheUnknownValues() throws Exception {
    var event = new CotEvent("a&b\"<c>", "a-f-G", null, null, Instant.parse("2026-10-12T08:00:00Z"), null, null,
        null, null, null, null, null, -33.5, 151.25, null, null, null, null, null, null, null, null, null);
    String text = CotXml.write(event);
    assertThat(text).contains("uid=\"a&amp;b&quot;&lt;c&gt;\"").contains("hae=\"9999999.0\"").contains("lat=\"-33.5\"").contains("lon=\"151.25\"")
        .contains("time=\"2026-10-12T08:00:00.000Z\"").contains("<detail/>");
    assertThat(xml.parse(text).uid()).isEqualTo("a&b\"<c>");
  }

  @Test
  void theCoordinatesAreWrittenAsPlainDecimals() throws Exception {
    var event = new CotEvent("a", "a-f-G", null, null, null, null, null, null, null, null, null, null,
        0.00001, -0.000025, null, null, null, null, null, null, null, null, null);
    assertThat(CotXml.write(event)).contains("lat=\"0.00001\"").contains("lon=\"-0.000025\"");
  }

  @Test
  void thePresenceEventIsAPingFromTheCallsign() throws Exception {
    String text = CotXml.presence("emc2 <north>", Instant.parse("2026-10-12T08:00:00Z"));
    CotEvent ping = xml.parse(text);
    assertThat(ping.type()).isEqualTo("t-x-c-t");
    assertThat(ping.uid()).isEqualTo("emc2-emc2-north");
    assertThat(ping.callsign()).isEqualTo("emc2 <north>");
    assertThat(ping.time()).isEqualTo(Instant.parse("2026-10-12T08:00:00Z"));
    assertThat(ping.stale()).isEqualTo(Instant.parse("2026-10-12T08:01:00Z"));
    assertThat(ping.isShown()).as("a ping is not shown on the map").isFalse();
  }
}
