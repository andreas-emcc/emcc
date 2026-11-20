package dev.emcc.plugins.cot.codec;

import static org.assertj.core.api.Assertions.assertThat;

import dev.emcc.plugins.cot.codec.DetailEditor.Values;
import org.junit.jupiter.api.Test;

class DetailEditorTest {

  private static final Values NONE = new Values(null, null, null, null, null, null);

  private static String apply(String raw, Values values) {
    return DetailEditor.apply(raw, values);
  }

  @Test
  void nothingToSayLeavesTheDetailExactlyAsItWas() {
    String raw = "<contact callsign=\"A\" endpoint=\"*:-1:stcp\"/>  <!-- keep --><priv x='1'>t</priv>";
    assertThat(apply(raw, NONE)).isEqualTo(raw);
    assertThat(apply(null, NONE)).isNull();
  }

  @Test
  void valuesThatAreAlreadyThereTouchNothing() {
    String raw = "<contact callsign=\"A &amp; B\"/><__group role='Medic' name='Red'/><track speed='4.20' course='270'/><remarks>  Hello &lt;you&gt;  </remarks>";
    var same = new Values("A & B", "Hello <you>", 270.0, 4.2, "Red", "Medic");
    assertThat(apply(raw, same)).isEqualTo(raw);
    assertThat(apply(raw, new Values(null, null, 630.0, null, null, null))).as("630 degrees is 270").isEqualTo(raw);
  }

  @Test
  void aChangedCallsignChangesOnlyThatAttributeAndAddsItWhereItIsMissing() {
    assertThat(apply("<contact endpoint=\"x\" callsign=\"A\" phone=\"1\"/><priv/>", new Values("B<", null, null, null, null, null)))
        .isEqualTo("<contact endpoint=\"x\" callsign=\"B&lt;\" phone=\"1\"/><priv/>");
    assertThat(apply("<contact endpoint=\"x\"/>", new Values("B", null, null, null, null, null))).isEqualTo("<contact endpoint=\"x\" callsign=\"B\"/>");
    assertThat(apply("<contact endpoint=\"x\"></contact>", new Values("B", null, null, null, null, null))).isEqualTo("<contact endpoint=\"x\" callsign=\"B\"></contact>");
    assertThat(apply("<priv/>", new Values("B", null, null, null, null, null))).as("a missing element is added at the end").isEqualTo("<priv/><contact callsign=\"B\"/>");
  }

  @Test
  void changedRemarksReplaceTheTextAndKeepTheAttributes() {
    assertThat(apply("<remarks source=\"s\" to=\"all\">old</remarks><priv/>", new Values(null, "new & better", null, null, null, null)))
        .isEqualTo("<remarks source=\"s\" to=\"all\">new &amp; better</remarks><priv/>");
    assertThat(apply("<remarks/>", new Values(null, "now", null, null, null, null))).isEqualTo("<remarks>now</remarks>");
    assertThat(apply("<priv/>", new Values(null, "added", null, null, null, null))).isEqualTo("<priv/><remarks>added</remarks>");
  }

  @Test
  void courseAndSpeedAreSetOneByOneAndAddedWhenTrackIsMissing() {
    assertThat(apply("<track course=\"270.0\" slope=\"3\"/>", new Values(null, null, 90.0, 5.0, null, null))).isEqualTo("<track course=\"90.0\" slope=\"3\" speed=\"5.0\"/>");
    assertThat(apply("<track course=\"270.0\" speed=\"5.0\"/>", new Values(null, null, 270.0, 6.5, null, null))).isEqualTo("<track course=\"270.0\" speed=\"6.5\"/>");
    assertThat(apply("", new Values(null, null, -90.0, 2.0, null, null))).as("-90 is 270").isEqualTo("<track course=\"270.0\" speed=\"2.0\"/>");
    assertThat(apply("<priv/>", new Values(null, null, null, 2.0, null, null))).isEqualTo("<priv/><track speed=\"2.0\"/>");
  }

  @Test
  void teamAndRoleAreSetInTheGroupAndNeverRemoved() {
    assertThat(apply("<__group name=\"Cyan\" role=\"Team Member\"/>", new Values(null, null, null, null, "Red", null))).isEqualTo("<__group name=\"Red\" role=\"Team Member\"/>");
    assertThat(apply("<__group name=\"Cyan\" role=\"Team Member\"/>", new Values(null, null, null, null, null, null))).isEqualTo("<__group name=\"Cyan\" role=\"Team Member\"/>");
    assertThat(apply("<priv/>", new Values(null, null, null, null, "Blue", "HQ"))).isEqualTo("<priv/><__group name=\"Blue\" role=\"HQ\"/>");
    assertThat(apply("<__group name=\"Chartreuse\"/>", new Values(null, null, null, null, null, "K9"))).as("a name outside TAK's own stays").isEqualTo("<__group name=\"Chartreuse\" role=\"K9\"/>");
  }

  @Test
  void onlyDirectChildrenAreEditedNotWhatIsInACommentCdataOrNested() {
    String raw = "<!-- <contact callsign=\"X\"/> --><![CDATA[<track course=\"1\"/>]]><outer><contact callsign=\"Y\"/></outer>";
    String result = apply(raw, new Values("Z", null, 5.0, null, null, null));
    assertThat(result).startsWith(raw);
    assertThat(result).endsWith("<contact callsign=\"Z\"/><track course=\"5.0\"/>");
  }

  @Test
  void aGreaterThanSignInAnAttributeDoesNotEndTheTagAndSeveralChangesAtOnceKeepTheirPlaces() {
    String raw = "<contact callsign=\"a > b\" x=\"1\"/><priv/><track course=\"1.0\"/>";
    assertThat(apply(raw, new Values("new", null, 2.0, null, null, null))).isEqualTo("<contact callsign=\"new\" x=\"1\"/><priv/><track course=\"2.0\"/>");
  }

  @Test
  void aDetailBuiltFromNothingHasTheElementsInTheUsualOrder() {
    String built = DetailEditor.build(new Values("A", "r", 10.0, 2.0, "Red", "HQ"));
    assertThat(built).isEqualTo("<contact callsign=\"A\"/><remarks>r</remarks><track course=\"10.0\" speed=\"2.0\"/><__group name=\"Red\" role=\"HQ\"/>");
    assertThat(DetailEditor.build(NONE)).isNull();
  }

  @Test
  void whatItWritesIsWellFormedEvenForOddText() throws Exception {
    String built = DetailEditor.build(new Values("A\"B<C>&'D E", "x]]>y", null, null, null, null));
    var event = new CotXml().parse("<event uid=\"u\" type=\"a-f-G\"><point lat=\"1.5\" lon=\"2.5\"/><detail>" + built + "</detail></event>");
    assertThat(event.callsign()).isEqualTo("A\"B<C>&'D E");
    assertThat(event.remarks()).isEqualTo("x]]>y");
  }

  @Test
  void remarksWithCdataOrCommentsThatSayWhatTheObjectSaysAreLeftAlone() {
    String cdata = "<remarks><![CDATA[a & b < c]]></remarks>";
    assertThat(apply(cdata, new Values(null, "a & b < c", null, null, null, null))).isEqualTo(cdata);
    String comment = "<remarks>x<!-- a" + (char) 10 + "multi-line" + (char) 10 + "comment -->y</remarks>";
    assertThat(apply(comment, new Values(null, "xy", null, null, null, null))).isEqualTo(comment);
    assertThat(apply(cdata, new Values(null, "other", null, null, null, null))).isEqualTo("<remarks>other</remarks>");
  }
}
