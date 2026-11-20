package dev.emcc.ecore.plugin;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;

/** M9 C5: reading a converter's listings (as ffmpeg 9.0.2 prints them). */
class ConverterCheckTest {

  static final String ENCODERS = """
      Encoders:
       V..... = Video
       ------
       V....D h264_mf              H264 via MediaFoundation (codec h264)
      """;
  static final String FORMATS = """
      Formats:
       D.. = Demuxing supported
       .E. = Muxing supported
       ---
        E  adts            ADTS AAC (Advanced Audio Coding)
       DE  mpegts          MPEG-TS (MPEG-2 Transport Stream)
      """;

  @Test
  void findsANameInTheSecondColumnAfterTheRule() {
    assertThat(ConverterCheck.listed(ENCODERS, "h264_mf", null)).isTrue();
    assertThat(ConverterCheck.listed(ENCODERS, "h264", null)).as("a word of a description").isFalse();
    assertThat(ConverterCheck.listed(" V....D h264_mf  x", "h264_mf", null)).as("before the rule: the legend").isFalse();
    assertThat(ConverterCheck.listed(FORMATS, "mpegts", 'D')).isTrue();
    assertThat(ConverterCheck.listed(FORMATS, "mpegts", 'E')).isTrue();
    assertThat(ConverterCheck.listed(FORMATS, "adts", 'D')).isFalse();
  }

  /** SDK 1.9.0 (the MCA's B4): an encoder's parts apart from a conversion's, so an M8 converter still converts MPEG-2. */
  @Test
  void anEncodersPartsAreCheckedApartFromAConversions() {
    Path ffmpeg = Path.of("ffmpeg.exe");
    ConverterCheck.Runner m8 = c -> switch (c.getLast()) {
      case "-version" -> "ffmpeg version 9.0.2";
      case "-encoders" -> ENCODERS;
      case "-decoders" -> " ------\n V.S.BD mpeg2video  MPEG-2 video";
      case "-formats" -> FORMATS;
      default -> "Bitstream filters:\nh264_mp4toannexb\n";
    };
    ConverterCheck.Result old = ConverterCheck.check(ffmpeg, m8);
    assertThat(old.problem()).isNull();
    assertThat(old.encoderProblem()).isEqualTo("the converter " + ffmpeg.toAbsolutePath() + " has no the rawvideo decoder, no the "
        + "rawvideo demuxer, no the h264 muxer, no the h264_metadata bitstream filter");

    ConverterCheck.Runner b4 = c -> switch (c.getLast()) {
      case "-version" -> "ffmpeg version 9.0.2";
      case "-encoders" -> ENCODERS;
      case "-decoders" -> " ------\n V.S.BD mpeg2video  MPEG-2 video\n V..... rawvideo  raw video";
      case "-formats" -> FORMATS + "  E  h264            raw H.264 video\n D   rawvideo        raw video\n";
      default -> "Bitstream filters:\naac_adtstoasc\nh264_metadata\n";
    };
    ConverterCheck.Result full = ConverterCheck.check(ffmpeg, b4);
    assertThat(List.of(String.valueOf(full.problem()), String.valueOf(full.encoderProblem()))).containsExactly("null", "null");
    assertThat(ConverterCheck.named("Bitstream filters:\nh264_metadata", "Bitstream filters:")).as("not the heading").isFalse();
  }

  @Test
  void aProgramThatDoesNotAnswerOrIsNoFfmpegIsAProblem() {
    Path ffmpeg = Path.of("ffmpeg.exe");
    assertThat(ConverterCheck.check(ffmpeg, c -> {
      throw new IOException("no answer within 10 s");
    }).problem()).contains("did not answer").contains("no answer within 10 s");
    assertThat(ConverterCheck.check(ffmpeg, c -> "Usage: something else").problem()).contains("not ffmpeg");
  }
}
