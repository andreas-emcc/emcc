package dev.emcc.plugins.cot.stream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class EventFramerTest {

  private static final String A = "<event uid=\"a\" type=\"a-f-G\"><point lat=\"1.5\" lon=\"2.5\"/></event>";
  private static final String B = "<event uid=\"b\" type=\"a-h-G\"><point lat=\"3.5\" lon=\"4.5\"/><detail><x/></detail></event>";

  /** What a sink saw: documents as text, and the sizes of the ones that were too large. */
  private static final class Seen implements EventFramer.Sink {
    final List<String> events = new ArrayList<>();
    final List<Long> tooLarge = new ArrayList<>();

    @Override
    public void event(byte[] data, int length) {
      events.add(new String(data, 0, length, StandardCharsets.UTF_8));
    }

    @Override
    public void tooLarge(long length) {
      tooLarge.add(length);
    }
  }

  private static Seen frame(int max, String... chunks) throws IOException {
    var framer = new EventFramer(max);
    var seen = new Seen();
    for (String chunk : chunks) {
      byte[] bytes = chunk.getBytes(StandardCharsets.UTF_8);
      framer.feed(bytes, 0, bytes.length, seen);
    }
    return seen;
  }

  @Test
  void eventsOneAfterAnotherWithoutASeparator() throws IOException {
    assertThat(frame(65_536, A + B + A).events).containsExactly(A, B, A);
  }

  @Test
  void whiteSpaceAndNewlinesBetweenEventsAreIgnored() throws IOException {
    assertThat(frame(65_536, "\r\n  " + A + "\n\n" + B + " \n").events).containsExactly(A, B);
  }

  @Test
  void aSplitInAnyPlaceGivesTheSameEvents() throws IOException {
    String stream = A + "\n" + B + A;
    byte[] bytes = stream.getBytes(StandardCharsets.UTF_8);
    for (int cut = 1; cut < bytes.length; cut++) {
      var framer = new EventFramer(65_536);
      var seen = new Seen();
      framer.feed(bytes, 0, cut, seen);
      framer.feed(bytes, cut, bytes.length - cut, seen);
      assertThat(seen.events).as("cut at " + cut).containsExactly(A, B, A);
    }
  }

  @Test
  void oneByteAtATime() throws IOException {
    var framer = new EventFramer(65_536);
    var seen = new Seen();
    byte[] bytes = (A + B).getBytes(StandardCharsets.UTF_8);
    for (int i = 0; i < bytes.length; i++) {
      framer.feed(bytes, i, 1, seen);
    }
    assertThat(seen.events).containsExactly(A, B);
  }

  @Test
  void aGreaterThanSignInsideAQuotedValueDoesNotEndTheTag() throws IOException {
    String event = "<event uid=\"a>b\" type='a-f-G'><point lat=\"1.5\" lon=\"2.5\"/><detail note=\"x > y\"/></event>";
    assertThat(frame(65_536, event + A).events).containsExactly(event, A);
  }

  @Test
  void commentsCdataAndInstructionsInsideAnEventDoNotConfuseTheEnd() throws IOException {
    String event = "<event uid=\"a\" type=\"a-f-G\"><point lat=\"1.5\" lon=\"2.5\"/><detail><!-- </event> --><![CDATA[ </event> <x> ]]><?pi </event> ?></detail></event>";
    assertThat(frame(65_536, event + B).events).containsExactly(event, B);
  }

  @Test
  void aPrologAndACommentBeforeAnEventBelongToIt() throws IOException {
    String doc = "<?xml version=\"1.0\" encoding=\"UTF-8\"?><!-- hello -->" + A;
    assertThat(frame(65_536, doc + B).events).containsExactly(doc, B);
  }

  @Test
  void aDoctypeWithAnInternalSubsetIsOneDocumentWithItsEvent() throws IOException {
    String doc = "<?xml version=\"1.0\"?><!DOCTYPE event [<!ENTITY a \"x>y\"><!-- a > and ' in a comment --><!ELEMENT event ANY>]>" + A;
    assertThat(frame(65_536, doc + B).events).containsExactly(doc, B);
  }

  @Test
  void aSelfClosingRootIsADocument() throws IOException {
    assertThat(frame(65_536, "<event uid=\"a\"/>" + A).events).containsExactly("<event uid=\"a\"/>", A);
  }

  @Test
  void textThatIsNotXmlIsReportedAsADocumentSoItIsCounted() throws IOException {
    assertThat(frame(65_536, "garbage\n" + A + "more garbage" + B).events).containsExactly("garbage", A, "more garbage", B);
  }

  @Test
  void aByteOrderMarkIsNotJunk() throws IOException {
    var framer = new EventFramer(65_536);
    var seen = new Seen();
    byte[] bom = {(byte) 0xEF, (byte) 0xBB, (byte) 0xBF};
    framer.feed(bom, 0, 3, seen);
    byte[] bytes = A.getBytes(StandardCharsets.UTF_8);
    framer.feed(bytes, 0, bytes.length, seen);
    assertThat(seen.events).containsExactly(A);
  }

  // ---------------------------------------------------------------- malformed input must not swallow what follows

  @Test
  void aMismatchedEndTagEndsTheBrokenDocumentAndTheNextOneIsFramedAsItIs() throws IOException {
    String broken = "<event uid=\"bad\" type=\"a-f-G\"><point lat=\"1.5\" lon=\"2.5\"></event>";
    assertThat(frame(65_536, broken + A + B).events).containsExactly(broken, A, B);
  }

  @Test
  void aTagWithAnotherTagInsideItButEndingInTheEndTagIsOneBrokenDocument() throws IOException {
    // the ITA's "malformed" document: the point's attribute list is never closed, the event is
    String broken = "<event uid=\"bad\" type=\"a-f-G\"><point lat=\"59.1\" lon=\"18.1\"<detail/></event>";
    assertThat(frame(65_536, broken + A + B).events).containsExactly(broken, A, B);
    assertThat(frame(65_536, "<event uid=\"x\"<eventful/>" + A).events).as("'<eventful' is not '<event'").hasSize(2);
  }

  @Test
  void aTagThatIsNeverClosedEndsAtTheNextTag() throws IOException {
    assertThat(frame(65_536, "<event uid=\"x\"" + A + B).events).containsExactly("<event uid=\"x\"", A, B);
  }

  @Test
  void anEventThatIsCutOffEndsWhereTheNextEventBegins() throws IOException {
    String cut = "<event uid=\"cut\" type=\"a-f-G\"><point lat=\"1.5\" lon=\"2.5\"/><detail>";
    assertThat(frame(65_536, cut + A + B).events).containsExactly(cut, A, B);
    assertThat(frame(65_536, cut + "<event uid=\"s\"/>" + B).events).containsExactly(cut, "<event uid=\"s\"/>", B);
  }

  @Test
  void anEndTagThatClosesNothingIsReportedAndTheStreamGoesOn() throws IOException {
    assertThat(frame(65_536, "</x>" + A).events).containsExactly("</x>", A);
  }

  @Test
  void aVeryDeepDocumentIsReportedAndFramingGoesOn() throws IOException {
    String deep = "<event uid=\"d\">" + "<x>".repeat(300);
    Seen seen = frame(65_536, deep + A);
    assertThat(seen.events).hasSizeGreaterThanOrEqualTo(2);
    assertThat(seen.events.getLast()).isEqualTo(A);
  }

  @Test
  void aStrayEndTagIsReportedAsADocumentSoItIsCounted() throws IOException {
    Seen seen = frame(65_536, "</event>" + A);
    assertThat(seen.events).containsExactly("</event>", A);
  }

  // ---------------------------------------------------------------- criterion 6: the large event

  @Test
  void anEventAboveTheLimitIsDroppedAndTheStreamContinues() throws IOException {
    String big = "<event uid=\"big\" type=\"a-f-G\"><point lat=\"1.5\" lon=\"2.5\"/><detail>" + "x".repeat(1_000_000) + "</detail></event>";
    Seen seen = frame(65_536, A, big, B);
    assertThat(seen.events).containsExactly(A, B);
    assertThat(seen.tooLarge).containsExactly((long) big.length());
  }

  @Test
  void anEventExactlyAtTheLimitIsKept() throws IOException {
    assertThat(frame(A.length(), A).events).containsExactly(A);
    Seen seen = frame(A.length() - 1, A);
    assertThat(seen.events).isEmpty();
    assertThat(seen.tooLarge).hasSize(1);
  }

  @Test
  void aLargeEventSplitOverManyChunksIsStillOneDrop() throws IOException {
    String big = "<event uid=\"big\" type=\"a-f-G\"><detail>" + "y".repeat(300_000) + "</detail></event>";
    var framer = new EventFramer(1024);
    var seen = new Seen();
    byte[] bytes = (big + A).getBytes(StandardCharsets.UTF_8);
    for (int i = 0; i < bytes.length; i += 8192) {
      framer.feed(bytes, i, Math.min(8192, bytes.length - i), seen);
    }
    assertThat(seen.tooLarge).hasSize(1);
    assertThat(seen.events).containsExactly(A);
  }

  @Test
  void aDocumentThatNeverEndsEndsTheStreamAtTheHardLimit() {
    var framer = new EventFramer(1024);
    var seen = new Seen();
    byte[] open = "<event uid=\"a\">".getBytes(StandardCharsets.UTF_8);
    byte[] chunk = new byte[64 * 1024];
    java.util.Arrays.fill(chunk, (byte) 'z');
    assertThatThrownBy(() -> {
      framer.feed(open, 0, open.length, seen);
      for (long sent = 0; sent <= EventFramer.HARD_LIMIT; sent += chunk.length) {
        framer.feed(chunk, 0, chunk.length, seen);
      }
    }).isInstanceOf(IOException.class).hasMessageContaining("has not ended");
    assertThat(seen.events).isEmpty();
  }

  @Test
  void multiByteCharactersPassThroughUnchanged() throws IOException {
    String event = "<event uid=\"å\" type=\"a-f-G\"><point lat=\"1.5\" lon=\"2.5\"/><detail><remarks>Göteborg – 日本</remarks></detail></event>";
    assertThat(frame(65_536, event).events).containsExactly(event);
  }
}
