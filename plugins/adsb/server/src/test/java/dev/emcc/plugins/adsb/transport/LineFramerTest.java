package dev.emcc.plugins.adsb.transport;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The framing of received bytes: lines, with a limit, whatever the chunks. */
class LineFramerTest {

  private final List<String> frames = new ArrayList<>();
  private final List<Long> tooLong = new ArrayList<>();
  private final LineFramer.Sink sink = new LineFramer.Sink() {
    @Override
    public void frame(String line) {
      frames.add(line);
    }

    @Override
    public void tooLong(long bytes) {
      tooLong.add(bytes);
    }
  };

  private void feed(LineFramer framer, String text) {
    byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
    framer.feed(bytes, 0, bytes.length, sink);
  }

  @Test
  void cutsLinesWithEitherLineEndAndSkipsEmptyOnes() {
    var framer = new LineFramer(100);
    feed(framer, "!AIVDM,1,1,,A,13u?etPv2;0n:dDPwUM1U1Cb069D,0*24\r\n\nMSG,3,1,1,4CA2D6,1\n");
    assertThat(frames).containsExactly("!AIVDM,1,1,,A,13u?etPv2;0n:dDPwUM1U1Cb069D,0*24", "MSG,3,1,1,4CA2D6,1");
  }

  @Test
  void joinsALineThatArrivesInPieces() {
    var framer = new LineFramer(100);
    feed(framer, "MSG,3,");
    feed(framer, "1,1");
    assertThat(frames).isEmpty();
    feed(framer, "\r");
    feed(framer, "\nnext");
    assertThat(frames).containsExactly("MSG,3,1,1");
  }

  @Test
  void dropsALineOverTheLimitAndReadsTheNext() {
    var framer = new LineFramer(10);
    feed(framer, "0123456789\n" + "x".repeat(25) + "\nshort\n");
    assertThat(frames).containsExactly("0123456789", "short");
    assertThat(tooLong).containsExactly(25L);
  }

  @Test
  void endsTheLastLineOfADatagram() {
    var framer = new LineFramer(100);
    feed(framer, "first\nsecond");
    framer.end(sink);
    framer.end(sink); // nothing more
    assertThat(frames).containsExactly("first", "second");
  }
}
