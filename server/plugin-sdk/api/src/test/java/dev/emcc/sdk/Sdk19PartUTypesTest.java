package dev.emcc.sdk;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.emcc.sdk.channel.ChannelInfo;
import dev.emcc.sdk.channel.ChannelRef;
import dev.emcc.sdk.channel.ChannelSpec;
import dev.emcc.sdk.channel.ChannelState;
import dev.emcc.sdk.stream.ConversionSpec;
import dev.emcc.sdk.stream.Conversions;
import dev.emcc.sdk.stream.EncodedPicture;
import dev.emcc.sdk.stream.EncoderSpec;
import dev.emcc.sdk.stream.RawPicture;
import java.time.Instant;
import java.util.Set;
import org.junit.jupiter.api.Test;

/** SDK 1.9.0 part U (CR-0050 points 1 and 2): the encoder's types and a channel's state. */
class Sdk19PartUTypesTest {

  private static final Instant T = Instant.parse("2026-11-17T10:00:00Z");

  @Test
  void anEncoderSpecChecksItsSizeRateAndNameAndHasTheConversionsDefaults() {
    EncoderSpec s = EncoderSpec.of("uav-north", 1280, 720, 25);
    assertThat(s.bitrate()).isEqualTo(ConversionSpec.DEFAULT_BITRATE);
    assertThat(s.keyframeSeconds()).isEqualTo(ConversionSpec.DEFAULT_KEYFRAME_SECONDS);
    assertThat(s.pictureBytes()).isEqualTo(1280 * 720 * 3 / 2);
    assertThat(s.bitrate(20_000_000).keyframeSeconds(0.5)).isEqualTo(new EncoderSpec("uav-north", 1280, 720, 25, 20_000_000, 0.5));
    assertThat(EncoderSpec.of("a", 1920, 1080, 30).pictureBytes()).isEqualTo(3_110_400);
    assertThat(EncoderSpec.of("a", 160, 120, 1).pictureBytes()).isEqualTo(28_800);
    assertThatThrownBy(() -> EncoderSpec.of("UAV", 1280, 720, 25)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> EncoderSpec.of("a/b", 1280, 720, 25)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> EncoderSpec.of("a", 1281, 720, 25)).isInstanceOf(IllegalArgumentException.class); // odd
    assertThatThrownBy(() -> EncoderSpec.of("a", 1922, 1080, 25)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> EncoderSpec.of("a", 158, 120, 25)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> EncoderSpec.of("a", 1280, 1082, 25)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> EncoderSpec.of("a", 1280, 721, 25)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> EncoderSpec.of("a", 1280, 720, 0)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> EncoderSpec.of("a", 1280, 720, 31)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> s.bitrate(20_000_001)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> s.keyframeSeconds(0.4)).isInstanceOf(IllegalArgumentException.class);
  }

  @Test
  void anEncodedPictureHasASequenceFromZeroAndAnAccessUnit() {
    Bytes au = Bytes.of(new byte[] {0, 0, 0, 1, 9, 16});
    assertThat(new EncodedPicture(0, T, true, au).keyframe()).isTrue();
    assertThatThrownBy(() -> new EncodedPicture(-1, T, true, au)).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new EncodedPicture(0, T, true, Bytes.empty())).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> new RawPicture(null, au)).isInstanceOf(NullPointerException.class);
    assertThatThrownBy(() -> new RawPicture(T, null)).isInstanceOf(NullPointerException.class);
  }

  @Test
  void aChannelStartsReadyAndCarriesItsStateAndDetail() {
    ChannelInfo info = ChannelInfo.of("fmv", ChannelSpec.of("uav-north", "UAV North (out)", "stanag-4609"));
    assertThat(info.state()).isEqualTo(ChannelState.READY);
    assertThat(info.stateDetail()).isEmpty();
    ChannelInfo off = info.withState(ChannelState.NOT_SENDING, "No destination");
    assertThat(off.state()).isEqualTo(ChannelState.NOT_SENDING);
    assertThat(off.stateDetail()).isEqualTo("No destination");
    assertThat(off.id()).isEqualTo(info.id());
    assertThat(off.withState(ChannelState.READY, "")).isEqualTo(info);
    assertThat(info.withState(ChannelState.DEGRADED, "x".repeat(ChannelInfo.MAX_STATE_DETAIL)).stateDetail()).hasSize(128);
    assertThatThrownBy(() -> info.withState(ChannelState.DEGRADED, "x".repeat(129))).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> info.withState(ChannelState.DEGRADED, "late\nframes")).isInstanceOf(IllegalArgumentException.class);
    assertThatThrownBy(() -> info.withState(null, "")).isInstanceOf(NullPointerException.class);
    // the part P constructor is kept, READY
    var p = new ChannelInfo(info.id(), info.name(), info.outputType(), info.capabilities(), info.fields(), info.kinds(), null, null, Set.of(), Set.of());
    assertThat(p).isEqualTo(info);
  }

  @Test
  void encodeAndAChannelRefsStateAreAbstractSinceTheFreeze() throws Exception {
    for (var m : java.util.List.of(
        Conversions.class.getMethod("encode", EncoderSpec.class, dev.emcc.sdk.compute.ComputeRef.class, java.util.function.Function.class,
            dev.emcc.sdk.worker.WorkerRef.class, java.util.function.Function.class),
        ChannelRef.class.getMethod("state", ChannelState.class, String.class))) {
      assertThat(m.isDefault()).as(m.getName() + ": a default until the 1.9.0 freeze").isFalse();
      assertThat(java.lang.reflect.Modifier.isAbstract(m.getModifiers())).as(m.getName()).isTrue();
    }
  }
}
